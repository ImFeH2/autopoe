use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    Native,
    Wsl(String),
}

impl Target {
    fn parse(value: &Value) -> Result<Self, String> {
        match value.get("kind").and_then(Value::as_str) {
            Some("native") => Ok(Self::Native),
            Some("wsl") => value
                .get("distribution")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty() && !name.contains(['\0', '\n', '\r']))
                .map(|name| Self::Wsl(name.to_owned()))
                .ok_or_else(|| "Choose a WSL distribution".to_owned()),
            _ => Err("Unknown backend".to_owned()),
        }
    }

    fn json(&self) -> Value {
        match self {
            Self::Native => json!({"kind": "native"}),
            Self::Wsl(distribution) => json!({"kind": "wsl", "distribution": distribution}),
        }
    }
}

fn load(path: &Path) -> Result<Target, String> {
    match fs::read(path) {
        Ok(bytes) => Target::parse(
            &serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| "Cannot read backend configuration".to_owned())?,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Target::Native),
        Err(_) => Err("Cannot read backend configuration".to_owned()),
    }
}

fn persist(path: &Path, target: &Target) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid configuration path")?;
    fs::create_dir_all(parent).map_err(|_| "Cannot create App configuration directory")?;
    let temporary = path.with_extension("tmp");
    let result = fs::write(&temporary, target.json().to_string())
        .and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_| "Cannot save backend configuration".to_owned())
}

pub struct BackendSettings {
    path: PathBuf,
    pub active: Result<Target, String>,
    pub startup_error: Mutex<Option<String>>,
    save_lock: Mutex<()>,
}

impl BackendSettings {
    pub fn new(path: PathBuf) -> Self {
        Self {
            active: load(&path),
            path,
            startup_error: Mutex::new(None),
            save_lock: Mutex::new(()),
        }
    }

    pub fn status(&self) -> Value {
        let configured = load(&self.path);
        let (distributions, probe_error) = if cfg!(target_os = "windows") {
            match distributions() {
                Ok(names) => (names, None),
                Err(error) => (Vec::new(), Some(error)),
            }
        } else {
            (Vec::new(), None)
        };
        json!({
            "platform": std::env::consts::OS,
            "active": self.active.as_ref().ok().map(Target::json),
            "configured": configured.as_ref().ok().map(Target::json),
            "restart_required": configured.as_ref().ok() != self.active.as_ref().ok(),
            "error": self.startup_error.lock().ok().and_then(|error| error.clone())
                .or_else(|| self.active.as_ref().err().cloned())
                .or_else(|| configured.err()),
            "distributions": distributions,
            "probe_error": probe_error,
        })
    }

    pub fn save(&self, value: &Value) -> Result<Value, String> {
        let target = Target::parse(value)?;
        if let Target::Wsl(name) = &target {
            if !cfg!(target_os = "windows") {
                return Err("WSL requires Windows".to_owned());
            }
            if !distributions()?.contains(name) {
                return Err("WSL distribution is unavailable".to_owned());
            }
        }
        let _saving = self
            .save_lock
            .lock()
            .map_err(|_| "Backend configuration lock poisoned")?;
        persist(&self.path, &target)?;
        Ok(self.status())
    }
}

fn command_output(command: &mut Command) -> Result<std::process::Output, String> {
    use std::{
        io::Read,
        process::Stdio,
        thread,
        time::{Duration, Instant},
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot start WSL")?;
    let mut stdout = child.stdout.take().ok_or("Cannot read WSL output")?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(std::process::Output {
                    status,
                    stdout: reader
                        .join()
                        .map_err(|_| "Cannot read WSL output")?
                        .map_err(|_| "Cannot read WSL output")?,
                    stderr: Vec::new(),
                });
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("WSL did not respond".to_owned());
            }
        }
    }
}

fn distributions() -> Result<Vec<String>, String> {
    let output = command_output(Command::new("wsl.exe").args(["-l", "-q"]))?;
    if !output.status.success() {
        return Err("Cannot list WSL distributions".to_owned());
    }
    let text = if output.stdout.contains(&0) {
        String::from_utf16_lossy(
            &output
                .stdout
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| u16::from_le_bytes(*pair))
                .collect::<Vec<_>>(),
        )
    } else {
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    Ok(text
        .lines()
        .map(|line| line.trim().trim_start_matches('\u{feff}'))
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

fn wsl_path(distribution: &str, path: &Path) -> Result<String, String> {
    let output = command_output(
        Command::new("wsl.exe")
            .args(["-d", distribution, "--exec", "wslpath", "-u"])
            .arg(path),
    )?;
    if !output.status.success() {
        return Err("Cannot resolve backend component in WSL".to_owned());
    }
    let path = String::from_utf8(output.stdout).map_err(|_| "Invalid WSL path")?;
    let path = path.trim();
    if !path.starts_with('/') {
        return Err("Invalid WSL path".to_owned());
    }
    Ok(path.to_owned())
}

pub struct Launcher {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub kind: &'static str,
}

pub fn launcher(
    target: &Target,
    development: bool,
    project: &Path,
    resources: &Path,
) -> Result<Launcher, String> {
    match target {
        Target::Native if development => Ok(Launcher {
            program: "uv".into(),
            args: vec![
                "run".into(),
                "--project".into(),
                project.to_string_lossy().into_owned(),
                "python".into(),
                "-m".into(),
                "huddol".into(),
            ],
            kind: "development_python",
        }),
        Target::Native => Ok(Launcher {
            program: resources.join("core/huddol"),
            args: vec![],
            kind: "bundled_core",
        }),
        Target::Wsl(distribution) => {
            if !cfg!(target_os = "windows") {
                return Err("WSL requires Windows".to_owned());
            }
            if !distributions()?.contains(distribution) {
                return Err("WSL distribution is unavailable".to_owned());
            }
            let script = if development {
                project.join("../scripts/start-wsl-backend.sh")
            } else {
                resources.join("core/start-wsl-backend.sh")
            };
            let component = if development {
                project.to_owned()
            } else {
                resources.join("core/wsl-core.tar")
            };
            if !script.is_file() || !component.exists() {
                return Err("WSL backend component is missing".to_owned());
            }
            let script = wsl_path(distribution, &script)?;
            let component = wsl_path(distribution, &component)?;
            let mode = if development {
                "development"
            } else {
                "bundled"
            };
            let preflight = command_output(Command::new("wsl.exe").args([
                "-d",
                distribution,
                "--exec",
                "/bin/sh",
                &script,
                &format!("check-{mode}"),
                &component,
            ]))?;
            if !preflight.status.success() {
                let message = String::from_utf8_lossy(&preflight.stdout).trim().to_owned();
                return Err(if message.is_empty() {
                    "WSL backend preflight failed".to_owned()
                } else {
                    message
                });
            }
            Ok(Launcher {
                program: "wsl.exe".into(),
                args: vec![
                    "-d".into(),
                    distribution.clone(),
                    "--exec".into(),
                    "/bin/sh".into(),
                    script,
                    mode.into(),
                    component,
                ],
                kind: "wsl_core",
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_backend_identity() {
        assert_eq!(
            Target::parse(&json!({"kind":"native"})).unwrap(),
            Target::Native
        );
        assert_eq!(
            Target::parse(&json!({"kind":"wsl","distribution":"Debian"})).unwrap(),
            Target::Wsl("Debian".into())
        );
        for value in [
            json!({}),
            json!({"kind":"other"}),
            json!({"kind":"wsl"}),
            json!({"kind":"wsl","distribution":""}),
        ] {
            assert!(Target::parse(&value).is_err());
        }
    }

    #[test]
    fn saving_only_changes_the_next_start() {
        let directory = std::env::temp_dir().join(format!(
            "huddol-backend-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = directory.join("backend.json");
        let settings = BackendSettings::new(path.clone());
        assert_eq!(settings.active, Ok(Target::Native));
        persist(&path, &Target::Wsl("Debian".into())).unwrap();
        assert_eq!(settings.active, Ok(Target::Native));
        assert_eq!(load(&path), Ok(Target::Wsl("Debian".into())));
        persist(&path, &Target::Native).unwrap();
        assert_eq!(load(&path), Ok(Target::Native));
        fs::write(&path, "invalid").unwrap();
        assert!(load(&path).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn concurrent_saves_are_atomic() {
        use std::sync::{Arc, Barrier};
        let directory = std::env::temp_dir().join(format!(
            "huddol-backend-concurrent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let settings = Arc::new(BackendSettings::new(directory.join("backend.json")));
        let barrier = Arc::new(Barrier::new(8));
        let workers = (0..8)
            .map(|_| {
                let settings = Arc::clone(&settings);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    settings.save(&json!({"kind": "native"})).is_ok()
                })
            })
            .collect::<Vec<_>>();
        let results = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect::<Vec<_>>();
        let saved = load(&directory.join("backend.json"));
        fs::remove_dir_all(directory).unwrap();
        assert!(results.into_iter().all(|success| success));
        assert_eq!(saved, Ok(Target::Native));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "Requires a WSL distribution and cached development dependencies"]
    fn starts_wsl_backend_with_isolated_data() {
        use std::{
            io::Write,
            process::Stdio,
            time::{Duration, Instant},
        };
        let distribution =
            std::env::var("HUDDOL_TEST_WSL_DISTRIBUTION").expect("Choose a test distribution");
        let created = command_output(Command::new("wsl.exe").args([
            "-d",
            &distribution,
            "--exec",
            "mktemp",
            "-d",
            "/tmp/huddol-backend-test.XXXXXX",
        ]))
        .unwrap();
        assert!(created.status.success());
        let directory = String::from_utf8(created.stdout).unwrap().trim().to_owned();
        assert!(directory.starts_with("/tmp/huddol-backend-test."));
        let result = (|| -> anyhow::Result<()> {
            let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../core");
            let plan = launcher(
                &Target::Wsl(distribution.clone()),
                true,
                &project,
                Path::new("."),
            )
            .map_err(anyhow::Error::msg)?;
            let mut args = plan.args;
            args.splice(
                3..3,
                [
                    "/usr/bin/env".to_owned(),
                    format!("HUDDOL_DATA_DIR={directory}"),
                    "UV_OFFLINE=1".to_owned(),
                ],
            );
            let mut child = Command::new(plan.program)
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()?;
            child.stdin.take().unwrap().write_all(
                b"{\"id\":1,\"method\":\"ping\"}\n{\"id\":2,\"method\":\"system.shutdown\"}\n",
            )?;
            let deadline = Instant::now() + Duration::from_secs(60);
            while child.try_wait()?.is_none() {
                if Instant::now() >= deadline {
                    child.kill()?;
                    child.wait()?;
                    anyhow::bail!("WSL backend startup timed out");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let output = child.wait_with_output()?;
            anyhow::ensure!(output.status.success(), "WSL backend failed");
            let frames = String::from_utf8(output.stdout)?
                .lines()
                .map(serde_json::from_str::<Value>)
                .collect::<Result<Vec<_>, _>>()?;
            let ready = frames
                .iter()
                .find(|frame| frame["type"] == "ready")
                .ok_or_else(|| anyhow::anyhow!("Missing ready"))?;
            anyhow::ensure!(ready["data_directory"] == directory);
            anyhow::ensure!(ready["working_directory"] == format!("{directory}/workspace"));
            anyhow::ensure!(ready["model_configured"] == false);
            anyhow::ensure!(
                frames
                    .iter()
                    .any(|frame| frame["id"] == 2 && frame["result"]["stopped"] == true)
            );
            Ok(())
        })();
        let cleanup = command_output(Command::new("wsl.exe").args([
            "-d",
            &distribution,
            "--exec",
            "rm",
            "-rf",
            "--",
            &directory,
        ]))
        .unwrap();
        assert!(cleanup.status.success());
        result.unwrap();
    }

    #[test]
    fn native_launch_does_not_depend_on_current_directory() {
        let plan = launcher(
            &Target::Native,
            true,
            Path::new("/source/core"),
            Path::new("/resources"),
        )
        .unwrap();
        assert!(plan.args.contains(&"/source/core".to_owned()));
        let bundled = launcher(
            &Target::Native,
            false,
            Path::new("/source/core"),
            Path::new("/resources"),
        )
        .unwrap();
        assert_eq!(bundled.program, Path::new("/resources/core/huddol"));
    }
}
