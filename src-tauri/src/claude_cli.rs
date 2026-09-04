use std::path::PathBuf;
use std::process::Command;

/// A packaged macOS app launched from Finder/Dock does not inherit the PATH
/// customizations a login shell picks up from ~/.zshrc etc. — so a bare
/// `Command::new("claude")` can fail to find a CLI installed the normal way
/// (the official installer puts it in ~/.local/bin) even though it works
/// fine from a terminal. Checking the common install locations directly
/// sidesteps that instead of asking the user to relaunch kapi from a shell.
fn find_claude_binary() -> Option<PathBuf> {
    if let Some(home) = dirs_next_home() {
        let candidates = [
            home.join(".local/bin/claude"),
            home.join(".claude/local/claude"),
        ];
        for path in candidates {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    for path in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    // Falls back to a plain PATH lookup for anyone whose GUI-launch
    // environment does carry the right PATH already.
    Some(PathBuf::from("claude"))
}

fn dirs_next_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Actually tries to run the resolved binary rather than just checking that a
/// path string was produced — the final fallback is a bare "claude" that
/// only works if PATH lookup succeeds at spawn time, which a stat() can't tell us.
#[tauri::command]
pub fn kapi_claude_available() -> bool {
    let Some(binary) = find_claude_binary() else { return false };
    Command::new(&binary)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Runs `claude -p <prompt>` with every built-in tool disabled — this is a
/// one-shot text answer, not an agent session, so it should never touch the
/// filesystem, run bash, or otherwise act on the user's machine.
#[tauri::command]
pub fn kapi_claude_prompt(prompt: String, system_prompt: String) -> Result<String, String> {
    let binary = find_claude_binary().ok_or("claude CLI not found")?;

    let output = Command::new(&binary)
        .arg("-p")
        .arg(&prompt)
        .arg("--tools")
        .arg("")
        .arg("--append-system-prompt")
        .arg(&system_prompt)
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
}
