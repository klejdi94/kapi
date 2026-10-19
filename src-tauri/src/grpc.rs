//! gRPC without generated code.
//!
//! A schema comes either from `.proto` files the user picked (compiled here by
//! protox, a pure-Rust protoc, imports and well-known types included) or from
//! the server's own reflection service. Either way it becomes a serialized
//! `FileDescriptorSet` the frontend keeps with the request, so a saved gRPC
//! request is self-contained. Messages travel as protobuf JSON and are
//! converted to and from wire format here with prost-reflect's dynamic
//! messages. All four method kinds are supported; client-streaming and bidi
//! calls send a list of messages, and every response message is pushed to
//! the frontend as it arrives.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, Kind, MessageDescriptor, MethodDescriptor, SerializeOptions};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{AsciiMetadataKey, AsciiMetadataValue, BinaryMetadataKey, BinaryMetadataValue, KeyAndValueRef, MetadataMap};
use tonic::transport::{Certificate, Channel as GrpcChannel, ClientTlsConfig, Endpoint, Identity};
use tonic::{Code, Status};

/* ------------------------------------------------------------- schema */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMethodInfo {
    name: String,
    client_streaming: bool,
    server_streaming: bool,
    input_type: String,
    output_type: String,
    /// A JSON skeleton of the input message, to start editing from.
    input_template: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcServiceInfo {
    name: String,
    methods: Vec<GrpcMethodInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcSchema {
    /// Base64 `FileDescriptorSet` — stored with the request and sent back on every call.
    descriptor_set: String,
    services: Vec<GrpcServiceInfo>,
}

fn is_internal_service(name: &str) -> bool {
    name.starts_with("grpc.reflection.") || name == "grpc.health.v1.Health"
}

fn schema_from_pool(pool: &DescriptorPool, bytes: &[u8]) -> GrpcSchema {
    let mut services: Vec<GrpcServiceInfo> = pool
        .services()
        .filter(|s| !is_internal_service(s.full_name()))
        .map(|service| GrpcServiceInfo {
            name: service.full_name().to_string(),
            methods: service
                .methods()
                .map(|m| GrpcMethodInfo {
                    name: m.name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                    input_type: m.input().full_name().to_string(),
                    output_type: m.output().full_name().to_string(),
                    input_template: serde_json::to_string_pretty(&template(&m.input(), 0)).unwrap_or_else(|_| "{}".into()),
                })
                .collect(),
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    GrpcSchema {
        descriptor_set: base64::engine::general_purpose::STANDARD.encode(bytes),
        services,
    }
}

/// A starting point for editing a message: every field with a placeholder of
/// the right JSON shape (protobuf's canonical JSON mapping), nested messages
/// filled in a few levels deep, and only the first member of each oneof.
fn template(desc: &MessageDescriptor, depth: usize) -> serde_json::Value {
    use serde_json::{json, Map, Value};
    match desc.full_name() {
        "google.protobuf.Timestamp" => return json!("1970-01-01T00:00:00Z"),
        "google.protobuf.Duration" => return json!("0s"),
        "google.protobuf.Struct" | "google.protobuf.Any" => return json!({}),
        "google.protobuf.Value" => return Value::Null,
        "google.protobuf.ListValue" => return json!([]),
        "google.protobuf.FieldMask" => return json!(""),
        "google.protobuf.Empty" => return json!({}),
        name if name.starts_with("google.protobuf.") && name.ends_with("Value") => {
            if let Some(field) = desc.get_field_by_name("value") {
                return scalar(&field.kind(), depth);
            }
        }
        _ => {}
    }
    let mut out = Map::new();
    let mut seen_oneofs = HashSet::new();
    for field in desc.fields() {
        if let Some(oneof) = field.containing_oneof() {
            if !oneof.is_synthetic() && !seen_oneofs.insert(oneof.full_name().to_string()) {
                continue;
            }
        }
        let value = if field.is_map() {
            json!({})
        } else if field.is_list() {
            json!([scalar(&field.kind(), depth)])
        } else {
            scalar(&field.kind(), depth)
        };
        out.insert(field.json_name().to_string(), value);
    }
    Value::Object(out)
}

fn scalar(kind: &Kind, depth: usize) -> serde_json::Value {
    use serde_json::json;
    match kind {
        Kind::Message(m) => {
            if depth < 3 {
                template(m, depth + 1)
            } else {
                json!({})
            }
        }
        Kind::Enum(e) => json!(e.values().next().map(|v| v.name().to_string()).unwrap_or_default()),
        Kind::String | Kind::Bytes => json!(""),
        Kind::Bool => json!(false),
        Kind::Int64 | Kind::Sint64 | Kind::Sfixed64 | Kind::Uint64 | Kind::Fixed64 => json!("0"),
        Kind::Double | Kind::Float => json!(0.0),
        _ => json!(0),
    }
}

fn compile_protos(paths: Vec<String>) -> Result<GrpcSchema, String> {
    if paths.is_empty() {
        return Err("Pick at least one .proto file".into());
    }
    // Each file's own folder is an include path, so `import "other.proto";`
    // next to it resolves; protox bundles the google/protobuf well-known types.
    let mut includes: Vec<String> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for path in &paths {
        let p = Path::new(path);
        let parent = p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_else(|| ".".into());
        if !includes.contains(&parent) {
            includes.push(parent);
        }
        names.push(
            p.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .ok_or_else(|| format!("Not a file: {path}"))?,
        );
    }
    let mut compiler = protox::Compiler::new(includes).map_err(|e| e.to_string())?;
    compiler.include_imports(true);
    compiler.open_files(names).map_err(|e| e.to_string())?;
    let bytes = compiler.file_descriptor_set().encode_to_vec();
    let pool = DescriptorPool::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
    Ok(schema_from_pool(&pool, &bytes))
}

#[tauri::command]
pub async fn kapi_grpc_load_protos(paths: Vec<String>) -> Result<GrpcSchema, String> {
    tauri::async_runtime::spawn_blocking(move || compile_protos(paths))
        .await
        .map_err(|e| format!("Proto compiler task failed: {e}"))?
}

/* --------------------------------------------------------- connection */

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTarget {
    /// `host:port`, `http://host:port` (plaintext) or `https://host:port` (TLS).
    url: String,
    #[serde(default)]
    metadata: Vec<(String, String)>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    ca_cert_pem: Option<String>,
    #[serde(default)]
    client_cert_pem: Option<String>,
    #[serde(default)]
    client_key_pem: Option<String>,
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("grpcs://") {
        return format!("https://{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("grpc://") {
        return format!("http://{rest}");
    }
    // No scheme: local addresses are almost always plaintext, everything else TLS.
    let host = trimmed.split(':').next().unwrap_or("");
    if host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "0.0.0.0" {
        format!("http://{trimmed}")
    } else {
        format!("https://{trimmed}")
    }
}

async fn connect(target: &GrpcTarget) -> Result<GrpcChannel, String> {
    let url = normalize_url(&target.url);
    let mut endpoint = Endpoint::from_shared(url.clone())
        .map_err(|e| format!("Invalid address {url}: {e}"))?
        .connect_timeout(Duration::from_secs(10));
    if url.starts_with("https://") {
        let mut tls = ClientTlsConfig::new().with_native_roots();
        if let Some(ca) = target.ca_cert_pem.as_deref().filter(|s| !s.trim().is_empty()) {
            tls = tls.ca_certificate(Certificate::from_pem(ca));
        }
        if let (Some(cert), Some(key)) = (
            target.client_cert_pem.as_deref().filter(|s| !s.trim().is_empty()),
            target.client_key_pem.as_deref().filter(|s| !s.trim().is_empty()),
        ) {
            tls = tls.identity(Identity::from_pem(cert, key));
        }
        endpoint = endpoint.tls_config(tls).map_err(|e| format!("TLS setup failed: {e}"))?;
    }
    endpoint.connect().await.map_err(|e| {
        let mut message = format!("Could not connect to {url}: {e}");
        let mut source = std::error::Error::source(&e);
        while let Some(inner) = source {
            message.push_str(&format!(" — {inner}"));
            source = inner.source();
        }
        message
    })
}

fn apply_metadata(map: &mut MetadataMap, metadata: &[(String, String)]) -> Result<(), String> {
    for (key, value) in metadata {
        let key = key.trim().to_ascii_lowercase();
        if key.is_empty() {
            continue;
        }
        if key.ends_with("-bin") {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(value.trim())
                .map_err(|_| format!("Metadata {key} ends in -bin, so its value must be base64"))?;
            let k = BinaryMetadataKey::from_bytes(key.as_bytes()).map_err(|_| format!("Invalid metadata key {key}"))?;
            map.append_bin(k, BinaryMetadataValue::from_bytes(&bytes));
        } else {
            let k = AsciiMetadataKey::from_bytes(key.as_bytes()).map_err(|_| format!("Invalid metadata key {key}"))?;
            let v =
                AsciiMetadataValue::try_from(value.as_str()).map_err(|_| format!("Metadata {key} has a value that isn't plain ASCII"))?;
            map.append(k, v);
        }
    }
    Ok(())
}

fn metadata_pairs(map: &MetadataMap) -> Vec<(String, String)> {
    map.iter()
        .map(|entry| match entry {
            KeyAndValueRef::Ascii(k, v) => (k.to_string(), v.to_str().unwrap_or("").to_string()),
            KeyAndValueRef::Binary(k, v) => (
                k.to_string(),
                base64::engine::general_purpose::STANDARD.encode(v.as_encoded_bytes()),
            ),
        })
        .collect()
}

/* --------------------------------------------------------- reflection */

async fn reflect_v1(channel: GrpcChannel, target: &GrpcTarget) -> Result<Vec<prost_types::FileDescriptorProto>, Status> {
    use tonic_reflection::pb::v1::{
        server_reflection_client::ServerReflectionClient, server_reflection_request::MessageRequest,
        server_reflection_response::MessageResponse, ServerReflectionRequest,
    };
    let client = ServerReflectionClient::new(channel);
    let ask = |message: MessageRequest| ServerReflectionRequest {
        host: String::new(),
        message_request: Some(message),
    };

    let call = |message: MessageRequest| {
        let mut request = tonic::Request::new(tokio_stream::iter(vec![ask(message)]));
        let _ = apply_metadata(request.metadata_mut(), &target.metadata);
        let mut client = client.clone();
        async move {
            let mut stream = client.server_reflection_info(request).await?.into_inner();
            stream
                .message()
                .await?
                .and_then(|r| r.message_response)
                .ok_or_else(|| Status::unknown("empty reflection response"))
        }
    };

    let services = match call(MessageRequest::ListServices(String::new())).await? {
        MessageResponse::ListServicesResponse(list) => list.service.into_iter().map(|s| s.name).collect::<Vec<_>>(),
        MessageResponse::ErrorResponse(e) => return Err(Status::new(Code::from(e.error_code), e.error_message)),
        _ => return Err(Status::unknown("unexpected reflection response")),
    };

    let mut files: HashMap<String, prost_types::FileDescriptorProto> = HashMap::new();
    let mut pending: Vec<MessageRequest> = services
        .iter()
        .filter(|s| !is_internal_service(s))
        .map(|s| MessageRequest::FileContainingSymbol(s.clone()))
        .collect();
    while let Some(next) = pending.pop() {
        let response = call(next).await?;
        let MessageResponse::FileDescriptorResponse(found) = response else {
            continue;
        };
        for bytes in found.file_descriptor_proto {
            let file = prost_types::FileDescriptorProto::decode(bytes.as_slice()).map_err(|e| Status::internal(e.to_string()))?;
            let name = file.name().to_string();
            if files.contains_key(&name) {
                continue;
            }
            for dep in &file.dependency {
                if !files.contains_key(dep) {
                    pending.push(MessageRequest::FileByFilename(dep.clone()));
                }
            }
            files.insert(name, file);
        }
    }
    Ok(files.into_values().collect())
}

async fn reflect_v1alpha(channel: GrpcChannel, target: &GrpcTarget) -> Result<Vec<prost_types::FileDescriptorProto>, Status> {
    use tonic_reflection::pb::v1alpha::{
        server_reflection_client::ServerReflectionClient, server_reflection_request::MessageRequest,
        server_reflection_response::MessageResponse, ServerReflectionRequest,
    };
    let client = ServerReflectionClient::new(channel);
    let call = |message: MessageRequest| {
        let mut request = tonic::Request::new(tokio_stream::iter(vec![ServerReflectionRequest {
            host: String::new(),
            message_request: Some(message),
        }]));
        let _ = apply_metadata(request.metadata_mut(), &target.metadata);
        let mut client = client.clone();
        async move {
            let mut stream = client.server_reflection_info(request).await?.into_inner();
            stream
                .message()
                .await?
                .and_then(|r| r.message_response)
                .ok_or_else(|| Status::unknown("empty reflection response"))
        }
    };
    let services = match call(MessageRequest::ListServices(String::new())).await? {
        MessageResponse::ListServicesResponse(list) => list.service.into_iter().map(|s| s.name).collect::<Vec<_>>(),
        MessageResponse::ErrorResponse(e) => return Err(Status::new(Code::from(e.error_code), e.error_message)),
        _ => return Err(Status::unknown("unexpected reflection response")),
    };
    let mut files: HashMap<String, prost_types::FileDescriptorProto> = HashMap::new();
    let mut pending: Vec<MessageRequest> = services
        .iter()
        .filter(|s| !is_internal_service(s))
        .map(|s| MessageRequest::FileContainingSymbol(s.clone()))
        .collect();
    while let Some(next) = pending.pop() {
        let MessageResponse::FileDescriptorResponse(found) = call(next).await? else {
            continue;
        };
        for bytes in found.file_descriptor_proto {
            let file = prost_types::FileDescriptorProto::decode(bytes.as_slice()).map_err(|e| Status::internal(e.to_string()))?;
            let name = file.name().to_string();
            if files.contains_key(&name) {
                continue;
            }
            for dep in &file.dependency {
                if !files.contains_key(dep) {
                    pending.push(MessageRequest::FileByFilename(dep.clone()));
                }
            }
            files.insert(name, file);
        }
    }
    Ok(files.into_values().collect())
}

pub async fn reflect(target: GrpcTarget) -> Result<GrpcSchema, String> {
    let channel = connect(&target).await?;
    let files = match reflect_v1(channel.clone(), &target).await {
        Ok(files) => files,
        Err(status) if status.code() == Code::Unimplemented => {
            reflect_v1alpha(channel, &target).await.map_err(|s| describe_reflection_error(&s))?
        }
        Err(status) => return Err(describe_reflection_error(&status)),
    };
    let set = prost_types::FileDescriptorSet { file: files };
    let bytes = set.encode_to_vec();
    let pool =
        DescriptorPool::decode(bytes.as_slice()).map_err(|e| format!("The server's reflection data didn't make a complete schema: {e}"))?;
    Ok(schema_from_pool(&pool, &bytes))
}

fn describe_reflection_error(status: &Status) -> String {
    if status.code() == Code::Unimplemented {
        "This server doesn't offer gRPC reflection — load its .proto files instead.".into()
    } else {
        format!("Reflection failed: {} ({:?})", status.message(), status.code())
    }
}

#[tauri::command]
pub async fn kapi_grpc_reflect(target: GrpcTarget) -> Result<GrpcSchema, String> {
    reflect(target).await
}

/* --------------------------------------------------------------- call */

#[derive(Clone)]
struct DynamicCodec {
    output: MessageDescriptor,
}

struct DynamicEncoder;
struct DynamicDecoder(MessageDescriptor);

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;
    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }
    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder(self.output.clone())
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst).map_err(|e| Status::internal(format!("encode failed: {e}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        DynamicMessage::decode(self.0.clone(), src)
            .map(Some)
            .map_err(|e| Status::internal(format!("decode failed: {e}")))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallRequest {
    /// Lets the frontend cancel a long-running stream.
    call_id: String,
    target: GrpcTarget,
    descriptor_set: String,
    service: String,
    method: String,
    /// One JSON message for unary/server-streaming, any number for client-streaming/bidi.
    messages: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GrpcEvent {
    Headers {
        metadata: Vec<(String, String)>,
    },
    Message {
        json: String,
        #[serde(rename = "atMs")]
        at_ms: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcCallResult {
    /// 0 = OK; see https://grpc.io/docs/guides/status-codes/
    status_code: i32,
    status_name: String,
    status_message: String,
    headers: Vec<(String, String)>,
    trailers: Vec<(String, String)>,
    messages_received: usize,
    duration_ms: u64,
}

#[derive(Default)]
pub struct GrpcCalls(Mutex<HashMap<String, tokio::task::AbortHandle>>);

fn find_method(pool: &DescriptorPool, service: &str, method: &str) -> Result<MethodDescriptor, String> {
    let service_desc = pool
        .get_service_by_name(service)
        .ok_or_else(|| format!("Service {service} isn't in the loaded schema"))?;
    let found = service_desc.methods().find(|m| m.name() == method);
    found.ok_or_else(|| format!("Method {method} isn't in service {service}"))
}

fn parse_message(desc: &MessageDescriptor, json: &str, index: usize) -> Result<DynamicMessage, String> {
    let text = if json.trim().is_empty() { "{}" } else { json };
    let mut de = serde_json::Deserializer::from_str(text);
    let message = DynamicMessage::deserialize(desc.clone(), &mut de)
        .map_err(|e| format!("Message {} doesn't match {}: {e}", index + 1, desc.full_name()))?;
    de.end().map_err(|e| format!("Message {}: {e}", index + 1))?;
    Ok(message)
}

fn to_json(message: &DynamicMessage) -> String {
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::pretty(&mut out);
    let options = SerializeOptions::new().skip_default_fields(false);
    if message.serialize_with_options(&mut ser, &options).is_err() {
        return "{}".into();
    }
    String::from_utf8(out).unwrap_or_default()
}

fn status_name(code: Code) -> String {
    format!("{code:?}")
        .chars()
        .enumerate()
        .flat_map(|(i, c)| {
            if i > 0 && c.is_uppercase() {
                vec!['_', c]
            } else {
                vec![c.to_ascii_uppercase()]
            }
        })
        .collect()
}

/// Request metadata and the `grpc-timeout` deadline, for any request body type.
fn prepare_request<T>(message: T, metadata: &[(String, String)], timeout: Option<Duration>) -> Result<tonic::Request<T>, Status> {
    let mut request = tonic::Request::new(message);
    apply_metadata(request.metadata_mut(), metadata).map_err(Status::invalid_argument)?;
    if let Some(t) = timeout {
        request.set_timeout(t);
    }
    Ok(request)
}

async fn perform_call(request: GrpcCallRequest, events: Channel<GrpcEvent>) -> Result<GrpcCallResult, String> {
    let started = Instant::now();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.descriptor_set.trim())
        .map_err(|_| "The saved schema is corrupt — load the .proto files or reflect again".to_string())?;
    let pool = DescriptorPool::decode(bytes.as_slice()).map_err(|e| e.to_string())?;
    let method = find_method(&pool, &request.service, &request.method)?;
    let messages = request
        .messages
        .iter()
        .enumerate()
        .map(|(i, json)| parse_message(&method.input(), json, i))
        .collect::<Result<Vec<_>, _>>()?;
    if messages.is_empty() {
        return Err("Add at least one message to send".into());
    }

    let channel = connect(&request.target).await?;
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready().await.map_err(|e| format!("Connection not ready: {e}"))?;
    let path = http::uri::PathAndQuery::try_from(format!("/{}/{}", method.parent_service().full_name(), method.name()))
        .map_err(|e| e.to_string())?;
    let codec = DynamicCodec { output: method.output() };

    let timeout = request.target.timeout_ms.filter(|ms| *ms > 0).map(Duration::from_millis);
    let metadata = request.target.metadata.clone();
    let prepare = |message| prepare_request(message, &metadata, timeout);
    let prepare_stream = |messages: Vec<DynamicMessage>| prepare_request(tokio_stream::iter(messages), &metadata, timeout);

    let elapsed = || started.elapsed().as_millis() as u64;
    let emit_message = |m: &DynamicMessage| {
        let _ = events.send(GrpcEvent::Message {
            json: to_json(m),
            at_ms: elapsed(),
        });
    };
    let mut received = 0usize;
    let mut headers = Vec::new();
    let mut trailers = Vec::new();

    let outcome: Result<(), Status> = async {
        match (method.is_client_streaming(), method.is_server_streaming()) {
            (false, false) => {
                let req = prepare(messages.into_iter().next().unwrap())?;
                let response = grpc.unary(req, path, codec).await?;
                headers = metadata_pairs(response.metadata());
                let _ = events.send(GrpcEvent::Headers { metadata: headers.clone() });
                emit_message(response.get_ref());
                received = 1;
            }
            (true, false) => {
                let req = prepare_stream(messages)?;
                let response = grpc.client_streaming(req, path, codec).await?;
                headers = metadata_pairs(response.metadata());
                let _ = events.send(GrpcEvent::Headers { metadata: headers.clone() });
                emit_message(response.get_ref());
                received = 1;
            }
            (client_streaming, true) => {
                let response = if client_streaming {
                    let req = prepare_stream(messages)?;
                    grpc.streaming(req, path, codec).await?
                } else {
                    let req = prepare(messages.into_iter().next().unwrap())?;
                    grpc.server_streaming(req, path, codec).await?
                };
                headers = metadata_pairs(response.metadata());
                let _ = events.send(GrpcEvent::Headers { metadata: headers.clone() });
                let mut stream = response.into_inner();
                while let Some(message) = stream.message().await? {
                    emit_message(&message);
                    received += 1;
                }
                if let Some(t) = stream.trailers().await? {
                    trailers = metadata_pairs(&t);
                }
            }
        }
        Ok(())
    }
    .await;

    let (code, message) = match &outcome {
        Ok(()) => (Code::Ok, String::new()),
        Err(status) => {
            trailers = metadata_pairs(status.metadata());
            (status.code(), status.message().to_string())
        }
    };
    Ok(GrpcCallResult {
        status_code: code as i32,
        status_name: status_name(code),
        status_message: message,
        headers,
        trailers,
        messages_received: received,
        duration_ms: elapsed(),
    })
}

#[tauri::command]
pub async fn kapi_grpc_call(
    request: GrpcCallRequest,
    events: Channel<GrpcEvent>,
    calls: State<'_, GrpcCalls>,
) -> Result<GrpcCallResult, String> {
    let call_id = request.call_id.clone();
    let started = Instant::now();
    let tauri::async_runtime::JoinHandle::Tokio(task) = tauri::async_runtime::spawn(perform_call(request, events));
    calls.0.lock().unwrap().insert(call_id.clone(), task.abort_handle());
    let result = task.await;
    calls.0.lock().unwrap().remove(&call_id);
    match result {
        Ok(outcome) => outcome,
        // Aborted by kapi_grpc_cancel.
        Err(_) => Ok(GrpcCallResult {
            status_code: Code::Cancelled as i32,
            status_name: "CANCELLED".into(),
            status_message: "Cancelled in kapi".into(),
            headers: vec![],
            trailers: vec![],
            messages_received: 0,
            duration_ms: started.elapsed().as_millis() as u64,
        }),
    }
}

#[tauri::command]
pub fn kapi_grpc_cancel(call_id: String, calls: State<'_, GrpcCalls>) {
    if let Some(handle) = calls.0.lock().unwrap().remove(&call_id) {
        handle.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROTO: &str = r#"
syntax = "proto3";
package demo.v1;
import "google/protobuf/timestamp.proto";
import "common.proto";

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc Chat (stream HelloRequest) returns (stream HelloReply);
}

message HelloRequest {
  string name = 1;
  int64 count = 2;
  repeated string tags = 3;
  map<string, int32> scores = 4;
  google.protobuf.Timestamp at = 5;
  oneof target { string email = 6; string phone = 7; }
  common.Level level = 8;
}
message HelloReply { string message = 1; }
"#;

    const COMMON: &str = r#"
syntax = "proto3";
package common;
enum Level { LEVEL_UNSPECIFIED = 0; LEVEL_HIGH = 1; }
"#;

    fn write_protos() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kapi-grpc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("greeter.proto"), PROTO).unwrap();
        std::fs::write(dir.join("common.proto"), COMMON).unwrap();
        dir
    }

    #[test]
    fn compiles_protos_with_imports_and_builds_templates() {
        let dir = write_protos();
        let schema = compile_protos(vec![dir.join("greeter.proto").to_string_lossy().to_string()]).unwrap();
        assert_eq!(schema.services.len(), 1);
        let service = &schema.services[0];
        assert_eq!(service.name, "demo.v1.Greeter");
        let hello = service.methods.iter().find(|m| m.name == "SayHello").unwrap();
        assert!(!hello.client_streaming && !hello.server_streaming);
        let chat = service.methods.iter().find(|m| m.name == "Chat").unwrap();
        assert!(chat.client_streaming && chat.server_streaming);

        let template: serde_json::Value = serde_json::from_str(&hello.input_template).unwrap();
        assert_eq!(template["name"], "");
        assert_eq!(template["count"], "0");
        assert_eq!(template["tags"], serde_json::json!([""]));
        assert_eq!(template["at"], "1970-01-01T00:00:00Z");
        assert_eq!(template["level"], "LEVEL_UNSPECIFIED");
        assert!(
            template.get("email").is_some() && template.get("phone").is_none(),
            "only one oneof member"
        );

        // The template must be a valid message for the method it came from.
        let bytes = base64::engine::general_purpose::STANDARD.decode(&schema.descriptor_set).unwrap();
        let pool = DescriptorPool::decode(bytes.as_slice()).unwrap();
        let method = find_method(&pool, "demo.v1.Greeter", "SayHello").unwrap();
        parse_message(&method.input(), &hello.input_template, 0).unwrap();
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reports_bad_messages_clearly() {
        let dir = write_protos();
        let schema = compile_protos(vec![dir.join("greeter.proto").to_string_lossy().to_string()]).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD.decode(&schema.descriptor_set).unwrap();
        let pool = DescriptorPool::decode(bytes.as_slice()).unwrap();
        let method = find_method(&pool, "demo.v1.Greeter", "SayHello").unwrap();
        let err = parse_message(&method.input(), r#"{"nope": 1}"#, 0).unwrap_err();
        assert!(err.contains("Message 1"), "{err}");
        assert!(find_method(&pool, "demo.v1.Greeter", "Missing").is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn normalizes_addresses() {
        assert_eq!(normalize_url("localhost:50051"), "http://localhost:50051");
        assert_eq!(normalize_url("api.example.com:443"), "https://api.example.com:443");
        assert_eq!(normalize_url("grpcs://x:1/"), "https://x:1");
        assert_eq!(normalize_url("http://x:1"), "http://x:1");
    }

    #[test]
    fn names_status_codes_like_grpc_does() {
        assert_eq!(status_name(Code::Ok), "OK");
        assert_eq!(status_name(Code::DeadlineExceeded), "DEADLINE_EXCEEDED");
        assert_eq!(status_name(Code::Unauthenticated), "UNAUTHENTICATED");
    }
}

/// End-to-end against a real server: reflection, all four method kinds,
/// metadata both ways and error statuses. Needs a server, so it only runs when
/// `KAPI_GRPC_TEST_ADDR` points at one implementing `demo.v1.Greeter` (see
/// CONTRIBUTING.md for the tiny Node server used in development).
#[cfg(test)]
mod live_tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    fn addr() -> Option<String> {
        std::env::var("KAPI_GRPC_TEST_ADDR").ok()
    }

    fn target(addr: &str) -> GrpcTarget {
        GrpcTarget {
            url: addr.to_string(),
            metadata: vec![("authorization".into(), "Bearer t0k".into())],
            timeout_ms: Some(5000),
            ca_cert_pem: None,
            client_cert_pem: None,
            client_key_pem: None,
        }
    }

    async fn call(addr: &str, descriptor_set: &str, method: &str, messages: &[&str]) -> (GrpcCallResult, Vec<String>) {
        let received = Arc::new(StdMutex::new(Vec::new()));
        let sink = received.clone();
        let channel: Channel<GrpcEvent> = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let event: serde_json::Value = serde_json::from_str(&json).unwrap();
                if event["kind"] == "message" {
                    let message: serde_json::Value = serde_json::from_str(event["json"].as_str().unwrap()).unwrap();
                    sink.lock().unwrap().push(message.to_string());
                }
            }
            Ok(())
        });
        let request = GrpcCallRequest {
            call_id: "t".into(),
            target: target(addr),
            descriptor_set: descriptor_set.into(),
            service: "demo.v1.Greeter".into(),
            method: method.into(),
            messages: messages.iter().map(|m| m.to_string()).collect(),
        };
        let result = perform_call(request, channel).await.unwrap();
        let messages = received.lock().unwrap().clone();
        (result, messages)
    }

    #[test]
    fn reflects_and_calls_every_method_kind() {
        let Some(addr) = addr() else { return };
        tauri::async_runtime::block_on(async {
            let schema = reflect(target(&addr)).await.unwrap();
            let service = schema
                .services
                .iter()
                .find(|s| s.name == "demo.v1.Greeter")
                .expect("reflected service");
            assert_eq!(service.methods.len(), 4);
            let ds = schema.descriptor_set.clone();

            let (unary, messages) = call(&addr, &ds, "SayHello", &[r#"{"name":"Ada"}"#]).await;
            assert_eq!(unary.status_name, "OK");
            assert_eq!(messages, vec![r#"{"auth":"Bearer t0k","message":"Hello Ada"}"#]);
            assert!(unary.headers.iter().any(|(k, v)| k == "x-served-by" && v == "node"));

            let (stream, messages) = call(&addr, &ds, "CountTo", &[r#"{"n":3}"#]).await;
            assert_eq!(stream.messages_received, 3);
            assert_eq!(messages, vec![r#"{"n":1}"#, r#"{"n":2}"#, r#"{"n":3}"#]);

            let (sum, messages) = call(&addr, &ds, "Sum", &[r#"{"n":2}"#, r#"{"n":5}"#, r#"{"n":10}"#]).await;
            assert_eq!(sum.status_name, "OK");
            assert_eq!(messages, vec![r#"{"n":17}"#]);

            let (chat, messages) = call(&addr, &ds, "Chat", &[r#"{"name":"a"}"#, r#"{"name":"b"}"#]).await;
            assert_eq!(chat.status_name, "OK");
            assert_eq!(
                messages,
                vec![r#"{"auth":"","message":"echo a"}"#, r#"{"auth":"","message":"echo b"}"#]
            );

            let (denied, messages) = call(&addr, &ds, "SayHello", &[r#"{"name":"fail"}"#]).await;
            assert_eq!(denied.status_name, "PERMISSION_DENIED");
            assert_eq!(denied.status_message, "no fail allowed");
            assert!(messages.is_empty());
        });
    }
}
