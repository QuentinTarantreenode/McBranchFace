use std::path::{Path, PathBuf};
use crate::process::std_command;

use anyhow::Result;

use crate::model::{AppError, ErrorCode};

pub fn open_terminal(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Err(AppError::new(ErrorCode::PathMissing, dir.display().to_string()).into());
    }
    #[cfg(windows)]
    {
        if std_command("wt.exe").args(["-d", "."]).current_dir(dir).spawn().is_ok() {
            return Ok(());
        }
        std_command("cmd.exe").args(["/c", "start", "cmd.exe"]).current_dir(dir).spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std_command("open").args(["-a", "Terminal"]).arg(dir).spawn()?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"] {
            if std_command(term).current_dir(dir).spawn().is_ok() {
                return Ok(());
            }
        }
        return Err(AppError::new(ErrorCode::NoTerminal, "").into());
    }
}

/// Opens a terminal that runs `command` and stays open, so the user sees prompts and results.
/// `command` is never text from the UI: an allowlisted install or login command, or the line that
/// runs a custom command's script file (`custom::terminal_line`, quoted for cmd there).
pub fn run_in_terminal(command: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if std_command("wt.exe").args(["new-tab", "--title", "McBranchFace", "cmd", "/k"]).raw_arg(command).spawn().is_ok() {
            return Ok(());
        }
        std_command("cmd.exe").raw_arg(format!("/c start \"McBranchFace\" cmd /k {command}")).spawn()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"{}\"", command.replace('"', "\\\""));
        std_command("osascript").args(["-e", &script, "-e", "tell application \"Terminal\" to activate"]).spawn()?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let keep = format!("{command}; exec \"${{SHELL:-sh}}\"");
        for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"] {
            let spawned = match term {
                "gnome-terminal" => std_command(term).args(["--", "sh", "-c", &keep]).spawn(),
                _ => std_command(term).args(["-e", "sh", "-c", &keep]).spawn(),
            };
            if spawned.is_ok() {
                return Ok(());
            }
        }
        return Err(AppError::new(ErrorCode::NoTerminal, "").into());
    }
}

pub fn github_desktop() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let p = dirs::data_local_dir()?.join("GitHubDesktop").join("bin").join("github.bat");
        p.is_file().then_some(p)
    }
    #[cfg(target_os = "macos")]
    {
        let p = PathBuf::from("/Applications/GitHub Desktop.app");
        p.exists().then_some(p)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::process::search_path().and_then(|paths| {
            std::env::split_paths(&paths).map(|d| d.join("github")).find(|p| p.is_file())
        })
    }
}

pub fn open_in_github_desktop(dir: &Path) -> Result<()> {
    let Some(tool) = github_desktop() else { return Err(AppError::new(ErrorCode::GitHubDesktopMissing, "").into()) };
    #[cfg(target_os = "macos")]
    {
        let _ = tool;
        std_command("open").args(["-a", "GitHub Desktop"]).arg(dir).spawn()?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut cmd = std_command(tool);
        cmd.arg(dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(crate::process::CREATE_NO_WINDOW);
        }
        cmd.spawn()?;
    }
    Ok(())
}

/// Extensions Windows runs instead of opening. A changed `build.cmd` in a repo must never execute
/// because someone wanted to look at it.
const RUNS_ON_OPEN: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "msc", "scr", "lnk", "url", "hta",
    "cpl", "jar", "reg", "pif", "appref-ms", "application", "gadget", "inf", "sh", "app", "command",
];

/// Whether the system's "open" would run the file instead of showing it.
pub fn runs_on_open(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| RUNS_ON_OPEN.contains(&e.to_ascii_lowercase().as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programs_are_never_opened() {
        for f in ["build.CMD", "setup.exe", "x.js", "a.ps1", "link.lnk"] {
            assert!(runs_on_open(Path::new(f)), "{f}");
        }
        for f in ["readme.md", "src/a.cs", "Makefile", "notes.txt"] {
            assert!(!runs_on_open(Path::new(f)), "{f}");
        }
    }
}
