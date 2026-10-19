//! Secrets that stay in an external manager and are read at send time.
//!
//! An environment or global variable whose value is a reference —
//! `op://vault/item/field` (1Password), `awssm://secret-id#key?region=…`
//! (AWS Secrets Manager), `vault://path#field` (HashiCorp Vault) — is
//! resolved by running that manager's own CLI, which the user has installed
//! and signed in to. kapi never sees the manager's credentials and doesn't
//! store the secret; the frontend keeps the value in memory for a few minutes.
//!
//! No shell is involved: each provider has a fixed argument list, and every
//! piece taken from the reference is validated (no whitespace, no control
//! characters, no leading `-` that a CLI could read as an option).
//!
//! **Consent.** A reference is only a string, and strings can arrive from
//! places the user doesn't control — an imported environment, or a script
//! calling `pm.environment.set('x', 'op://Private/Bank/password')` and then
//! sending `{{x}}` somewhere. So the first time each reference is used, this
//! module itself asks with a native dialog, and remembers the answer in a file
//! only it writes (`secret-ref-approvals.json` in the app data folder). The
//! webview can list and revoke approvals, never grant one.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Debug, PartialEq)]
pub enum SecretRef {
    OnePassword {
        reference: String,
    },
    AwsSecretsManager {
        secret_id: String,
        region: Option<String>,
        json_key: Option<String>,
    },
    Vault {
        path: String,
        field: String,
    },
}

fn safe_piece(piece: &str, what: &str) -> Result<String, String> {
    if piece.is_empty() {
        return Err(format!("The reference is missing its {what}"));
    }
    if piece.starts_with('-') {
        return Err(format!("The {what} can't start with '-'"));
    }
    if piece.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("The {what} can't contain spaces or control characters"));
    }
    Ok(piece.to_string())
}

pub fn parse(reference: &str) -> Result<SecretRef, String> {
    let reference = reference.trim();
    if let Some(rest) = reference.strip_prefix("op://") {
        // 1Password's own syntax, passed through whole: op://vault/item[/section]/field
        if rest.split('/').filter(|s| !s.is_empty()).count() < 3 {
            return Err("1Password references look like op://vault/item/field".into());
        }
        return Ok(SecretRef::OnePassword {
            reference: safe_piece(reference, "1Password reference")?,
        });
    }
    if let Some(rest) = reference.strip_prefix("awssm://") {
        let (rest, json_key) = match rest.split_once('#') {
            Some((r, k)) => (r, Some(safe_piece(k, "JSON key")?)),
            None => (rest, None),
        };
        let (secret_id, region) = match rest.split_once("?region=") {
            Some((id, region)) => (id, Some(safe_piece(region, "region")?)),
            None => (rest, None),
        };
        return Ok(SecretRef::AwsSecretsManager {
            secret_id: safe_piece(secret_id, "secret id")?,
            region,
            json_key,
        });
    }
    if let Some(rest) = reference.strip_prefix("vault://") {
        let (path, field) = rest
            .split_once('#')
            .ok_or("Vault references look like vault://path/to/secret#field")?;
        return Ok(SecretRef::Vault {
            path: safe_piece(path, "path")?,
            field: safe_piece(field, "field")?,
        });
    }
    Err("Not a secret reference (op://, awssm:// or vault://)".into())
}

/// The program and argument list for a reference — fixed shapes, nothing interpolated into a shell.
pub fn command_for(secret: &SecretRef) -> (&'static str, Vec<String>) {
    match secret {
        SecretRef::OnePassword { reference } => ("op", vec!["read".into(), "--no-newline".into(), reference.clone()]),
        SecretRef::AwsSecretsManager { secret_id, region, .. } => {
            let mut args = vec![
                "secretsmanager".into(),
                "get-secret-value".into(),
                "--secret-id".into(),
                secret_id.clone(),
                "--query".into(),
                "SecretString".into(),
                "--output".into(),
                "text".into(),
            ];
            if let Some(region) = region {
                args.push("--region".into());
                args.push(region.clone());
            }
            ("aws", args)
        }
        SecretRef::Vault { path, field } => ("vault", vec!["kv".into(), "get".into(), format!("-field={field}"), path.clone()]),
    }
}

/// A packaged app launched from the Dock/Explorer doesn't inherit a shell's
/// PATH, so the usual install locations are searched too.
fn find_program(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
    }
    for extra in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "C:/Program Files/Amazon/AWSCLIV2",
        "C:/Program Files/1Password CLI",
    ] {
        dirs.push(PathBuf::from(extra));
    }
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

fn run(program: &str, args: &[String], timeout: Duration) -> Result<String, String> {
    let path = find_program(program).ok_or_else(|| format!("The `{program}` CLI isn't installed (or isn't on PATH)"))?;
    run_path(&path, program, args, timeout)
}

fn run_path(path: &std::path::Path, program: &str, args: &[String], timeout: Duration) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("Could not run {program}: {e}"))?;
    // Drain both pipes on their own threads while waiting: a child that writes
    // more than a pipe buffer would otherwise block forever on a full pipe.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_string(&mut text);
            }
            text
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{program} didn't answer within {}s (waiting for a sign-in?)",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let out = stdout.join().unwrap_or_default();
    let err = stderr.join().unwrap_or_default();
    if !status.success() {
        let msg = err.trim();
        return Err(if msg.is_empty() {
            format!("{program} exited with {status}")
        } else {
            format!("{program}: {msg}")
        });
    }
    Ok(out
        .strip_suffix('\n')
        .map(|s| s.strip_suffix('\r').unwrap_or(s))
        .unwrap_or(&out)
        .to_string())
}

pub fn resolve(reference: &str) -> Result<String, String> {
    let secret = parse(reference)?;
    let (program, args) = command_for(&secret);
    let value = run(program, &args, Duration::from_secs(60))?;
    pick_json_key(secret, value)
}

fn pick_json_key(secret: SecretRef, value: String) -> Result<String, String> {
    match secret {
        SecretRef::AwsSecretsManager { json_key: Some(key), .. } => {
            let json: serde_json::Value =
                serde_json::from_str(&value).map_err(|_| "The secret isn't JSON, so it has no #key to pick".to_string())?;
            match json.get(&key) {
                Some(serde_json::Value::String(s)) => Ok(s.clone()),
                Some(other) => Ok(other.to_string()),
                None => Err(format!("The secret has no key \"{key}\"")),
            }
        }
        _ => Ok(value),
    }
}

/* -------------------------------------------------------------- consent */

#[derive(Default)]
pub struct SecretRefApprovals {
    loaded: Mutex<Option<BTreeSet<String>>>,
}

fn approvals_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // `tauri dev` uses its own data folder, same rule as the frontend's fileStorage.ts.
    let dir = if tauri::is_dev() { dir.join("dev") } else { dir };
    Ok(dir.join("secret-ref-approvals.json"))
}

fn with_approvals<R: Runtime, T>(
    app: &AppHandle<R>,
    state: &SecretRefApprovals,
    f: impl FnOnce(&mut BTreeSet<String>) -> T,
) -> Result<(T, bool), String> {
    let mut guard = state.loaded.lock().map_err(|_| "approval state poisoned".to_string())?;
    if guard.is_none() {
        let path = approvals_path(app)?;
        let set = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        *guard = Some(set);
    }
    let set = guard.as_mut().expect("loaded above");
    let before = set.clone();
    let result = f(set);
    let changed = *set != before;
    if changed {
        let path = approvals_path(app)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&set.iter().collect::<Vec<_>>()).map_err(|e| e.to_string())?;
        crate::write_atomic(&path, json.as_bytes(), false).map_err(|e| e.to_string())?;
    }
    Ok((result, changed))
}

fn provider_name(secret: &SecretRef) -> &'static str {
    match secret {
        SecretRef::OnePassword { .. } => "1Password",
        SecretRef::AwsSecretsManager { .. } => "AWS Secrets Manager",
        SecretRef::Vault { .. } => "HashiCorp Vault",
    }
}

/// Resolves `reference`, asking the user first if they've never approved it.
/// `purpose` is shown in the dialog only (e.g. the request about to be sent).
#[tauri::command]
pub async fn kapi_resolve_secret_ref<R: Runtime>(
    app: AppHandle<R>,
    approvals: State<'_, SecretRefApprovals>,
    reference: String,
    purpose: Option<String>,
) -> Result<String, String> {
    let secret = parse(&reference)?;
    let reference = reference.trim().to_string();
    let (already, _) = with_approvals(&app, &approvals, |set| set.contains(&reference))?;
    if !already {
        let (program, args) = command_for(&secret);
        let mut message = format!(
            "kapi wants to read a secret from {}:\n\n{reference}\n\nIt will run `{program} {}` now, and again whenever a request uses this reference.",
            provider_name(&secret),
            args.join(" ")
        );
        if let Some(purpose) = purpose.as_deref().filter(|p| !p.trim().is_empty()) {
            message.push_str(&format!("\n\nFirst used by: {}", purpose.chars().take(300).collect::<String>()));
        }
        message.push_str("\n\nOnly allow this if you added the reference yourself.");
        let dialog = app
            .dialog()
            .message(message)
            .title("Allow access to an external secret?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Don't allow".into()));
        let allowed = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
            .await
            .map_err(|e| format!("Dialog failed: {e}"))?;
        if !allowed {
            return Err(format!("Access to {reference} wasn't allowed"));
        }
        with_approvals(&app, &approvals, |set| set.insert(reference.clone()))?;
    }
    tauri::async_runtime::spawn_blocking(move || resolve(&reference))
        .await
        .map_err(|e| format!("Secret lookup failed: {e}"))?
}

#[tauri::command]
pub fn kapi_secret_ref_approvals<R: Runtime>(app: AppHandle<R>, approvals: State<'_, SecretRefApprovals>) -> Result<Vec<String>, String> {
    Ok(with_approvals(&app, &approvals, |set| set.iter().cloned().collect())?.0)
}

#[tauri::command]
pub fn kapi_secret_ref_revoke<R: Runtime>(
    app: AppHandle<R>,
    approvals: State<'_, SecretRefApprovals>,
    reference: String,
) -> Result<(), String> {
    with_approvals(&app, &approvals, |set| set.remove(reference.trim()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_provider() {
        assert_eq!(
            parse("op://Private/GitHub/token").unwrap(),
            SecretRef::OnePassword {
                reference: "op://Private/GitHub/token".into()
            }
        );
        assert_eq!(
            parse("awssm://prod/db?region=eu-west-1#password").unwrap(),
            SecretRef::AwsSecretsManager {
                secret_id: "prod/db".into(),
                region: Some("eu-west-1".into()),
                json_key: Some("password".into())
            }
        );
        assert_eq!(
            parse("awssm://api-key").unwrap(),
            SecretRef::AwsSecretsManager {
                secret_id: "api-key".into(),
                region: None,
                json_key: None
            }
        );
        assert_eq!(
            parse("vault://secret/data/app#token").unwrap(),
            SecretRef::Vault {
                path: "secret/data/app".into(),
                field: "token".into()
            }
        );
    }

    #[test]
    fn rejects_option_injection_and_odd_input() {
        assert!(parse("awssm://--profile=evil").is_err());
        assert!(parse("vault://-address=http://evil#x").is_err());
        assert!(parse("vault://secret/app#-x").is_err());
        assert!(parse("op://a/b").is_err());
        assert!(parse("op://a/b c/d").is_err());
        assert!(parse("awssm://x?region=us-east-1 --debug").is_err());
        assert!(parse("https://example.com").is_err());
    }

    #[test]
    fn builds_fixed_argument_lists() {
        let (program, args) = command_for(&parse("vault://kv/app#token").unwrap());
        assert_eq!(program, "vault");
        assert_eq!(args, vec!["kv", "get", "-field=token", "kv/app"]);
        let (program, args) = command_for(&parse("awssm://db?region=us-east-1").unwrap());
        assert_eq!(program, "aws");
        assert_eq!(args.last().unwrap(), "us-east-1");
    }

    /// A stand-in CLI that prints a large secret: reading must not deadlock on a full pipe.
    #[cfg(unix)]
    #[test]
    fn reads_large_output_and_picks_json_keys() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kapi-secret-ref-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake-aws");
        let big = "x".repeat(300_000);
        std::fs::write(
            &script,
            format!("#!/bin/sh\nprintf '{{\"password\":\"s3cr3t\",\"pad\":\"{big}\"}}\\n'\n"),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let out = run_path(&script, "fake-aws", &[], Duration::from_secs(10)).unwrap();
        assert!(out.len() > 300_000 && !out.ends_with('\n'));
        let picked = pick_json_key(parse("awssm://db#password").unwrap(), out).unwrap();
        assert_eq!(picked, "s3cr3t");
        let missing = pick_json_key(parse("awssm://db#nope").unwrap(), r#"{"a":1}"#.into()).unwrap_err();
        assert!(missing.contains("no key"), "{missing}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn reports_failures_and_timeouts() {
        let err = run_path(
            std::path::Path::new("/bin/sh"),
            "sh",
            &["-c".into(), "echo denied >&2; exit 3".into()],
            Duration::from_secs(5),
        )
        .unwrap_err();
        assert_eq!(err, "sh: denied");
        let err = run_path(
            std::path::Path::new("/bin/sh"),
            "sh",
            &["-c".into(), "sleep 5".into()],
            Duration::from_millis(200),
        )
        .unwrap_err();
        assert!(err.contains("didn't answer"), "{err}");
    }

    #[test]
    fn reports_a_missing_cli() {
        let err = run("kapi-definitely-not-installed", &[], Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("isn't installed"), "{err}");
    }
}
