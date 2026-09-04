import type { SentRequest } from '@/types';

export type CodegenTarget =
  | 'curl' | 'httpie' | 'js-fetch' | 'js-axios' | 'node-https' | 'python-requests'
  | 'go' | 'php-curl' | 'java-okhttp' | 'csharp-httpclient' | 'ruby-nethttp';

export const CODEGEN_LABELS: Record<CodegenTarget, string> = {
  curl: 'cURL',
  httpie: 'HTTPie',
  'js-fetch': 'JavaScript · fetch',
  'js-axios': 'JavaScript · axios',
  'node-https': 'Node.js · https',
  'python-requests': 'Python · requests',
  go: 'Go · net/http',
  'php-curl': 'PHP · cURL',
  'java-okhttp': 'Java · OkHttp',
  'csharp-httpclient': 'C# · HttpClient',
  'ruby-nethttp': 'Ruby · Net::HTTP',
};

function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
function pyStr(v: string): string {
  return JSON.stringify(v);
}
function jsonBody(sent: SentRequest): string | null {
  return sent.bodyText;
}

export function generate(target: CodegenTarget, sent: SentRequest): string {
  switch (target) {
    case 'curl': return curl(sent);
    case 'httpie': return httpie(sent);
    case 'js-fetch': return jsFetch(sent);
    case 'js-axios': return jsAxios(sent);
    case 'node-https': return nodeHttps(sent);
    case 'python-requests': return pythonRequests(sent);
    case 'go': return goHttp(sent);
    case 'php-curl': return phpCurl(sent);
    case 'java-okhttp': return javaOkHttp(sent);
    case 'csharp-httpclient': return csharpHttpClient(sent);
    case 'ruby-nethttp': return rubyNetHttp(sent);
  }
}

function curl(sent: SentRequest): string {
  const parts = [`curl ${shQuote(sent.url)}`];
  if (sent.method !== 'GET') parts.push(`-X ${sent.method}`);
  for (const [name, value] of sent.headers) parts.push(`-H ${shQuote(`${name}: ${value}`)}`);
  const body = jsonBody(sent);
  if (body) parts.push(`--data-raw ${shQuote(body)}`);
  return parts.join(' \\\n  ');
}

function httpie(sent: SentRequest): string {
  const parts = ['http', sent.method, shQuote(sent.url)];
  for (const [name, value] of sent.headers) parts.push(shQuote(`${name}:${value}`));
  const body = jsonBody(sent);
  const lines = [parts.join(' \\\n  ')];
  if (body) lines.push(`# body:\n${body}`);
  return lines.join('\n');
}

function jsFetch(sent: SentRequest): string {
  const headers = sent.headers.length ? `{\n${sent.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  }` : '{}';
  const body = jsonBody(sent);
  return [
    `fetch(${JSON.stringify(sent.url)}, {`,
    `  method: ${JSON.stringify(sent.method)},`,
    `  headers: ${headers},`,
    body ? `  body: ${JSON.stringify(body)},` : null,
    `})`,
    `  .then((res) => res.text())`,
    `  .then(console.log);`,
  ].filter(Boolean).join('\n');
}

function jsAxios(sent: SentRequest): string {
  const headers = sent.headers.length ? `{\n${sent.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  }` : undefined;
  const body = jsonBody(sent);
  const config = [
    `  method: ${JSON.stringify(sent.method)},`,
    `  url: ${JSON.stringify(sent.url)},`,
    headers ? `  headers: ${headers},` : null,
    body ? `  data: ${JSON.stringify(body)},` : null,
  ].filter(Boolean).join('\n');
  return [`import axios from 'axios';`, ``, `axios({`, config, `}).then((res) => console.log(res.data));`].join('\n');
}

function nodeHttps(sent: SentRequest): string {
  const url = safeUrl(sent.url);
  const headerObj = sent.headers.length ? `{\n${sent.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  }` : '{}';
  const body = jsonBody(sent);
  return [
    `const https = require('node:https');`,
    ``,
    `const req = https.request(${JSON.stringify(url)}, {`,
    `  method: ${JSON.stringify(sent.method)},`,
    `  headers: ${headerObj},`,
    `}, (res) => {`,
    `  let data = '';`,
    `  res.on('data', (chunk) => (data += chunk));`,
    `  res.on('end', () => console.log(data));`,
    `});`,
    body ? `req.write(${JSON.stringify(body)});` : null,
    `req.end();`,
  ].filter(Boolean).join('\n');
}

function pythonRequests(sent: SentRequest): string {
  const headers = sent.headers.length ? `{\n${sent.headers.map(([k, v]) => `    ${pyStr(k)}: ${pyStr(v)},`).join('\n')}\n}` : 'None';
  const body = jsonBody(sent);
  const isJson = sent.headers.some(([k, v]) => k.toLowerCase() === 'content-type' && v.includes('json'));
  return [
    `import requests`,
    ``,
    `response = requests.request(`,
    `    ${pyStr(sent.method)},`,
    `    ${pyStr(sent.url)},`,
    `    headers=${headers},`,
    body ? (isJson ? `    json=${tryPyJson(body)},` : `    data=${pyStr(body)},`) : null,
    `)`,
    ``,
    `print(response.status_code)`,
    `print(response.text)`,
  ].filter(Boolean).join('\n');
}

function tryPyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return pyStr(body);
  }
}

function goHttp(sent: SentRequest): string {
  const body = jsonBody(sent);
  return [
    `package main`,
    ``,
    `import (`,
    `\t"fmt"`,
    `\t"io"`,
    `\t"net/http"`,
    body ? `\t"strings"` : null,
    `)`,
    ``,
    `func main() {`,
    body ? `\tbody := strings.NewReader(${JSON.stringify(body)})` : `\tvar body io.Reader`,
    `\treq, _ := http.NewRequest(${JSON.stringify(sent.method)}, ${JSON.stringify(sent.url)}, ${body ? 'body' : 'nil'})`,
    ...sent.headers.map(([k, v]) => `\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`),
    `\tresp, err := http.DefaultClient.Do(req)`,
    `\tif err != nil {`,
    `\t\tpanic(err)`,
    `\t}`,
    `\tdefer resp.Body.Close()`,
    `\tdata, _ := io.ReadAll(resp.Body)`,
    `\tfmt.Println(string(data))`,
    `}`,
  ].filter(Boolean).join('\n');
}

function phpCurl(sent: SentRequest): string {
  const body = jsonBody(sent);
  const headers = sent.headers.map(([k, v]) => `    ${JSON.stringify(`${k}: ${v}`)},`).join('\n');
  return [
    `<?php`,
    `$ch = curl_init();`,
    `curl_setopt($ch, CURLOPT_URL, ${JSON.stringify(sent.url)});`,
    `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ${JSON.stringify(sent.method)});`,
    sent.headers.length ? `curl_setopt($ch, CURLOPT_HTTPHEADER, [\n${headers}\n]);` : null,
    body ? `curl_setopt($ch, CURLOPT_POSTFIELDS, ${JSON.stringify(body)});` : null,
    `$response = curl_exec($ch);`,
    `curl_close($ch);`,
    `echo $response;`,
  ].filter(Boolean).join('\n');
}

function javaOkHttp(sent: SentRequest): string {
  const body = jsonBody(sent);
  const contentType = sent.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || 'application/octet-stream';
  const builderHeaders = sent.headers.map(([k, v]) => `    .addHeader(${JSON.stringify(k)}, ${JSON.stringify(v)})`).join('\n');
  return [
    `OkHttpClient client = new OkHttpClient();`,
    body ? `MediaType mediaType = MediaType.parse(${JSON.stringify(contentType)});` : null,
    body ? `RequestBody body = RequestBody.create(${JSON.stringify(body)}, mediaType);` : null,
    `Request request = new Request.Builder()`,
    `    .url(${JSON.stringify(sent.url)})`,
    `    .method(${JSON.stringify(sent.method)}, ${body ? 'body' : 'null'})`,
    builderHeaders,
    `    .build();`,
    `Response response = client.newCall(request).execute();`,
    `System.out.println(response.body().string());`,
  ].filter(Boolean).join('\n');
}

function csharpHttpClient(sent: SentRequest): string {
  const body = jsonBody(sent);
  const contentType = sent.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || 'application/json';
  const otherHeaders = sent.headers.filter(([k]) => k.toLowerCase() !== 'content-type');
  return [
    `using var client = new HttpClient();`,
    `using var request = new HttpRequestMessage(new HttpMethod(${JSON.stringify(sent.method)}), ${JSON.stringify(sent.url)});`,
    ...otherHeaders.map(([k, v]) => `request.Headers.Add(${JSON.stringify(k)}, ${JSON.stringify(v)});`),
    body ? `request.Content = new StringContent(${JSON.stringify(body)}, System.Text.Encoding.UTF8, ${JSON.stringify(contentType)});` : null,
    `var response = await client.SendAsync(request);`,
    `Console.WriteLine(await response.Content.ReadAsStringAsync());`,
  ].filter(Boolean).join('\n');
}

function rubyNetHttp(sent: SentRequest): string {
  const body = jsonBody(sent);
  return [
    `require 'net/http'`,
    `require 'uri'`,
    ``,
    `uri = URI(${JSON.stringify(sent.url)})`,
    `http = Net::HTTP.new(uri.host, uri.port)`,
    `http.use_ssl = uri.scheme == 'https'`,
    ``,
    `request = Net::HTTP::${capitalize(sent.method)}.new(uri)`,
    ...sent.headers.map(([k, v]) => `request[${JSON.stringify(k)}] = ${JSON.stringify(v)}`),
    body ? `request.body = ${JSON.stringify(body)}` : null,
    ``,
    `response = http.request(request)`,
    `puts response.body`,
  ].filter(Boolean).join('\n');
}

function capitalize(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
}

function safeUrl(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}
