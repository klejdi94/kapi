use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

/// The AI copilot panel can talk to any CLI the user already has installed
/// and authenticated — kapi never asks for or stores an API key of its own,
/// it only shells out to a binary the user set up themselves.
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
    /// does not inherit the PATH customizations a login shell would, so a
    /// bare PATH lookup alone would miss these.
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

/// Spawns the CLI directly — including the `.cmd` npm shims on Windows. Rust's
/// standard library (≥ 1.77.2, this crate's minimum) recognises a `.cmd`/`.bat`
/// program and applies cmd.exe-aware escaping to its arguments, refusing any it
/// can't escape safely. Wrapping it in `cmd /C` by hand used to bypass exactly
/// that escaping (the "BatBadBut" class of bug). On top of that, nothing that
/// comes from a request or response is passed as an argument at all: the
/// prompt always travels over stdin (see `run_prompt`), so every argument
/// below is a fixed string or a path kapi chose.
fn base_command(binary: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: a GUI app shouldn't flash a console for a helper process.
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Runs `command` with `input` written to its stdin, collecting stdout/stderr.
/// The write happens on its own thread so a CLI that starts printing before it
/// has read all of its input can't deadlock against a full pipe.
fn run_with_stdin(mut command: Command, input: String, binary: &Path, label: &str) -> Result<std::process::Output, String> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run the {label} CLI ({}): {}", binary.display(), e))?;
    let mut stdin = child.stdin.take().ok_or_else(|| format!("Could not open stdin for the {label} CLI"))?;
    let writer = std::thread::spawn(move || {
        use std::io::Write;
        // A CLI that exits early closes the pipe; that error is reported via its exit status instead.
        let _ = stdin.write_all(input.as_bytes());
    });
    let output = child.wait_with_output().map_err(|e| format!("The {label} CLI failed: {e}"))?;
    let _ = writer.join();
    Ok(output)
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
    // The system prompt is a fixed string from kapi itself, but it still goes
    // over stdin with everything else rather than as an argument — one rule
    // ("no prompt text in argv") is easier to keep than a list of exceptions.
    let combined = format!("{system_prompt}\n\n---\n\n{prompt}");

    match cli {
        Cli::Claude => {
            // `claude -p` with no prompt argument reads the prompt from stdin.
            let mut command = base_command(&binary);
            command.arg("-p").arg("--tools").arg("").current_dir(std::env::temp_dir());
            let output = run_with_stdin(command, combined, &binary, "claude")?;
            finish(output, &binary)
        }

        Cli::Codex => {
            let scratch_dir = std::env::temp_dir();
            let output_path = unique_temp_path("kapi-codex-out");
            // A prompt of `-` tells `codex exec` to read it from stdin.
            let mut command = base_command(&binary);
            command
                .arg("exec")
                .arg("-s")
                .arg("read-only")
                .arg("--skip-git-repo-check")
                .arg("--ephemeral")
                .arg("-C")
                .arg(&scratch_dir)
                .arg("-o")
                .arg(&output_path)
                .arg("-");
            let output = run_with_stdin(command, combined, &binary, "codex")?;

            if !output.status.success() {
                let _ = std::fs::remove_file(&output_path);
                return finish(output, &binary);
            }
            let text = std::fs::read_to_string(&output_path)
                .map_err(|e| format!("codex finished but its output file couldn't be read: {e}"))?;
            let _ = std::fs::remove_file(&output_path);
            Ok(text.trim().to_string())
        }

        Cli::Gemini => {
            // gemini appends piped stdin to the `-p` prompt, so `-p` carries only
            // a fixed pointer to it.
            let mut command = base_command(&binary);
            command
                .arg("-p")
                .arg("Follow the instructions provided on standard input.")
                .arg("--approval-mode")
                .arg("plan")
                .arg("--skip-trust")
                .arg("-o")
                .arg("text")
                .current_dir(std::env::temp_dir());
            let output = run_with_stdin(command, combined, &binary, "gemini")?;
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
