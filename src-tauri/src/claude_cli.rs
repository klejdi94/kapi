use std::path::PathBuf;
use std::process::{Command, Stdio};

/// A packaged app launched from Finder/Dock/Explorer does not inherit the PATH
/// customizations a login shell picks up from ~/.zshrc etc. — so a bare
/// `Command::new("claude")` can fail to find a CLI installed the normal way
/// (the official installer puts it in ~/.local/bin) even though it works
/// fine from a terminal. Checking the common install locations directly
/// sidesteps that instead of asking the user to relaunch kapi from a shell.
fn find_claude_binary() -> Option<PathBuf> {
    if let Some(home) = home_dir() {
        for relative in HOME_CANDIDATES {
            let path = home.join(relative);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    for path in SYSTEM_CANDIDATES {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    // Falls back to a plain PATH lookup for anyone whose GUI-launch
    // environment does carry the right PATH already.
    Some(PathBuf::from(BARE_NAME))
}

#[cfg(windows)]
const HOME_CANDIDATES: &[&str] = &[
    "AppData/Roaming/npm/claude.cmd",
    ".local/bin/claude.exe",
    ".claude/local/claude.exe",
];
#[cfg(not(windows))]
const HOME_CANDIDATES: &[&str] = &[".local/bin/claude", ".claude/local/claude"];

#[cfg(windows)]
const SYSTEM_CANDIDATES: &[&str] = &["C:/Program Files/nodejs/claude.cmd"];
#[cfg(not(windows))]
const SYSTEM_CANDIDATES: &[&str] = &["/opt/homebrew/bin/claude", "/usr/local/bin/claude"];

#[cfg(windows)]
const BARE_NAME: &str = "claude.cmd";
#[cfg(not(windows))]
const BARE_NAME: &str = "claude";

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Windows cannot spawn a `.cmd` shim directly — it is a batch script, so it
/// has to go through the command interpreter.
fn claude_command(binary: &PathBuf) -> Command {
    #[cfg(windows)]
    if binary.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(binary);
        return command;
    }
    Command::new(binary)
}

/// Actually tries to run the resolved binary rather than just checking that a
/// path string was produced — the final fallback is a bare "claude" that
/// only works if PATH lookup succeeds at spawn time, which a stat() can't tell us.
///
/// This and `kapi_claude_prompt` are `async` and wait inside `spawn_blocking`:
/// a synchronous `#[tauri::command]` runs on the main thread, so blocking there
/// for a CLI call that takes seconds freezes the entire window.
#[tauri::command]
pub async fn kapi_claude_available() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(binary) = find_claude_binary() else { return false };
        claude_command(&binary)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

/// Runs `claude -p <prompt>` with every built-in tool disabled — this is a
/// one-shot text answer, not an agent session, so it should never touch the
/// filesystem, run bash, or otherwise act on the user's machine.
#[tauri::command]
pub async fn kapi_claude_prompt(prompt: String, system_prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let binary = find_claude_binary().ok_or("claude CLI not found")?;

        let output = claude_command(&binary)
            .arg("-p")
            .arg(&prompt)
            .arg("--tools")
            .arg("")
            .arg("--append-system-prompt")
            .arg(&system_prompt)
            // Without this the CLI waits several seconds for piped stdin that
            // is never coming, adding that delay to every single reply.
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Could not run the claude CLI ({}): {}", binary.display(), e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(if stderr.trim().is_empty() {
                format!("claude exited with status {}", output.status)
            } else {
                stderr.trim().to_string()
            });
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .await
    .map_err(|e| format!("claude task failed: {e}"))?
}
