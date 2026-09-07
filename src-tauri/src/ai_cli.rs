use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

/// The AI copilot panel can talk to any CLI the user already has installed
/// and authenticated — kapi never asks for or stores an API key of its own,
/// it only shells out to a binary the user set up themselves (same principle
/// as `claude_cli.rs`, generalized to more than one CLI).
#[derive(Clone, Copy)]
enum Cli {
    Claude,
    Codex,
    Gemini,
}

impl Cli {
    fn parse(name: &str) -> Result<Cli, String> {
        match name {
            "claude" => Ok(Cli::Claude),
            "codex" => Ok(Cli::Codex),
            "gemini" => Ok(Cli::Gemini),
            other => Err(format!("Unknown AI CLI \"{other}\"")),
        }
    }

    fn bare_name(self) -> &'static str {
        match self {
            Cli::Claude => {
                if cfg!(windows) {
                    "claude.cmd"
                } else {
                    "claude"
                }
            }
            Cli::Codex => {
                if cfg!(windows) {
                    "codex.cmd"
                } else {
                    "codex"
                }
            }
            Cli::Gemini => {
                if cfg!(windows) {
                    "gemini.cmd"
                } else {
                    "gemini"
                }
            }
        }
    }

    /// Paths under $HOME/%USERPROFILE% worth checking before falling back to
    /// a bare PATH lookup — a packaged app launched from Finder/Dock/Explorer
    /// does not inherit the PATH customizations a login shell would (see
    /// `claude_cli.rs::find_claude_binary`, which this mirrors for the other
    /// two CLIs).
    fn home_candidates(self) -> &'static [&'static str] {
        match (self, cfg!(windows)) {
            (Cli::Claude, true) => &["AppData/Roaming/npm/claude.cmd", ".local/bin/claude.exe", ".claude/local/claude.exe"],
            (Cli::Claude, false) => &[".local/bin/claude", ".claude/local/claude"],
            (Cli::Codex, true) => &["AppData/Roaming/npm/codex.cmd", ".local/bin/codex.exe"],
            (Cli::Codex, false) => &[".local/bin/codex"],
            (Cli::Gemini, true) => &["AppData/Roaming/npm/gemini.cmd", ".local/bin/gemini.exe"],
            (Cli::Gemini, false) => &[".local/bin/gemini"],
        }
    }

    fn system_candidates(self) -> &'static [&'static str] {
        match (self, cfg!(windows)) {
            (Cli::Claude, true) => &["C:/Program Files/nodejs/claude.cmd"],
            (Cli::Claude, false) => &["/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
            (Cli::Codex, true) => &["C:/Program Files/nodejs/codex.cmd"],
            (Cli::Codex, false) => &["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
            (Cli::Gemini, true) => &["C:/Program Files/nodejs/gemini.cmd"],
            (Cli::Gemini, false) => &["/opt/homebrew/bin/gemini", "/usr/local/bin/gemini"],
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn find_binary(cli: Cli) -> PathBuf {
    if let Some(home) = home_dir() {
        for relative in cli.home_candidates() {
            let path = home.join(relative);
            if path.is_file() {
                return path;
            }
        }
    }
    for path in cli.system_candidates() {
        let path = PathBuf::from(path);
        if path.is_file() {
            return path;
        }
    }
    PathBuf::from(cli.bare_name())
}

/// Windows cannot spawn a `.cmd` shim directly — it is a batch script, so it
/// has to go through the command interpreter.
fn base_command(binary: &Path) -> Command {
    #[cfg(windows)]
    if binary.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(binary);
        return command;
    }
    Command::new(binary)
}

fn unique_temp_path(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()))
}

/// Every CLI here is a one-shot text answer, not an agent turned loose on the
/// user's machine — Claude fully disables its tools; Codex and Gemini have no
/// equivalent all-off switch (verified against real installs), so they get
/// their strictest available read-only mode instead, run from a scratch temp
/// directory rather than kapi's own working directory. That is a real,
/// narrower guarantee than Claude's — worth knowing, not worth hiding.
fn run_prompt(cli: Cli, prompt: &str, system_prompt: &str) -> Result<String, String> {
    let binary = find_binary(cli);

    match cli {
        Cli::Claude => {
            let output = base_command(&binary)
                .arg("-p")
                .arg(prompt)
                .arg("--tools")
                .arg("")
                .arg("--append-system-prompt")
                .arg(system_prompt)
                .stdin(Stdio::null())
                .output()
                .map_err(|e| format!("Could not run the claude CLI ({}): {}", binary.display(), e))?;
            finish(output, &binary)
        }

        Cli::Codex => {
            let combined = format!("{system_prompt}\n\n---\n\n{prompt}");
            let scratch_dir = std::env::temp_dir();
            let output_path = unique_temp_path("kapi-codex-out");

            let output = base_command(&binary)
                .arg("exec")
                .arg("-s")
                .arg("read-only")
                .arg("--skip-git-repo-check")
                .arg("--ephemeral")
                .arg("-C")
                .arg(&scratch_dir)
                .arg("-o")
                .arg(&output_path)
                .arg(&combined)
                .stdin(Stdio::null())
                .output()
                .map_err(|e| format!("Could not run the codex CLI ({}): {}", binary.display(), e))?;

            if !output.status.success() {
                return finish(output, &binary);
            }
            let text = std::fs::read_to_string(&output_path)
                .map_err(|e| format!("codex finished but its output file couldn't be read: {e}"))?;
            let _ = std::fs::remove_file(&output_path);
            Ok(text.trim().to_string())
        }

        Cli::Gemini => {
            let combined = format!("{system_prompt}\n\n---\n\n{prompt}");
            let output = base_command(&binary)
                .arg("-p")
                .arg(&combined)
                .arg("--approval-mode")
                .arg("plan")
                .arg("--skip-trust")
                .arg("-o")
                .arg("text")
                .current_dir(std::env::temp_dir())
                .stdin(Stdio::null())
                .output()
                .map_err(|e| format!("Could not run the gemini CLI ({}): {}", binary.display(), e))?;
            finish(output, &binary)
        }
    }
}

fn finish(output: std::process::Output, binary: &Path) -> Result<String, String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("{} exited with status {}", binary.display(), output.status)
        } else {
            stderr.trim().to_string()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Checked with a real invocation (`--version`), not just a path stat — the
/// bare-name fallback only actually works if PATH lookup succeeds at spawn
/// time, which stat() can't tell us.
fn is_available(cli: Cli) -> bool {
    let binary = find_binary(cli);
    base_command(&binary).arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

/// Which of claude/codex/gemini are actually installed on this machine, so
/// the panel can offer a choice only when there's a real one to make.
#[tauri::command]
pub async fn kapi_ai_list_available() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        [("claude", Cli::Claude), ("codex", Cli::Codex), ("gemini", Cli::Gemini)]
            .into_iter()
            .filter(|(_, cli)| is_available(*cli))
            .map(|(name, _)| name.to_string())
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn kapi_ai_prompt(cli: String, prompt: String, system_prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = Cli::parse(&cli)?;
        run_prompt(parsed, &prompt, &system_prompt)
    })
    .await
    .map_err(|e| format!("AI CLI task failed: {e}"))?
}
