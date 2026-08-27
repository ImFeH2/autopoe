#[cfg(unix)]
mod unix {
    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::env;
    use std::fs::{self, OpenOptions};
    use std::io::{self, BufRead, BufWriter, Read, Write};
    use std::os::unix::process::CommandExt;
    use std::os::unix::process::ExitStatusExt;
    use std::path::{Path, PathBuf};
    use std::process::{Command, ExitStatus, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};

    #[derive(Deserialize)]
    struct Request {
        id: u64,
        method: String,
        #[serde(default)]
        params: Value,
    }

    #[derive(Deserialize)]
    struct RunParams {
        argv: Vec<String>,
        cwd: Option<String>,
        timeout_seconds: u64,
        output_limit: usize,
    }

    #[derive(Deserialize)]
    struct EditParams {
        path: String,
        old_text: String,
        new_text: String,
        replace_all: bool,
    }

    #[derive(Serialize)]
    struct Response {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<ErrorBody>,
    }

    #[derive(Serialize)]
    struct ErrorBody {
        message: String,
    }

    type Writer = Arc<Mutex<BufWriter<io::Stdout>>>;
    type ActiveGroups = Arc<Mutex<HashMap<u64, i32>>>;

    struct ProcessGuard {
        request_id: u64,
        process_group: i32,
        active: ActiveGroups,
    }

    impl Drop for ProcessGuard {
        fn drop(&mut self) {
            terminate_group(self.process_group);
            if let Ok(mut active) = self.active.lock() {
                active.remove(&self.request_id);
            }
        }
    }

    pub fn main() -> Result<(), String> {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not configured".to_string())?
            .canonicalize()
            .map_err(|error| format!("Cannot resolve HOME: {error}"))?;
        let writer = Arc::new(Mutex::new(BufWriter::new(io::stdout())));
        let active = Arc::new(Mutex::new(HashMap::new()));
        let edit_lock = Arc::new(Mutex::new(()));
        let stopping = Arc::new(AtomicBool::new(false));
        let stdin = io::stdin();
        let mut workers: Vec<JoinHandle<()>> = Vec::new();

        for line in stdin.lock().lines() {
            let line = line.map_err(|error| format!("Cannot read request: {error}"))?;
            let request: Request = match serde_json::from_str(&line) {
                Ok(request) => request,
                Err(error) => {
                    eprintln!("[huddol-host] Invalid request: {error}");
                    continue;
                }
            };
            match request.method.as_str() {
                "hello" => {
                    let distro = env::var("WSL_DISTRO_NAME").unwrap_or_else(|_| "WSL".to_string());
                    send_result(
                        &writer,
                        request.id,
                        json!({
                            "backend": "wsl",
                            "system": "linux",
                            "distribution": distro,
                            "home": home,
                            "pid": std::process::id(),
                        }),
                    );
                }
                "run" | "edit" => {
                    if stopping.load(Ordering::SeqCst) {
                        send_error(&writer, request.id, "Host tools are stopped".to_string());
                        continue;
                    }
                    let worker_writer = Arc::clone(&writer);
                    let worker_active = Arc::clone(&active);
                    let worker_stopping = Arc::clone(&stopping);
                    let worker_edit_lock = Arc::clone(&edit_lock);
                    let worker_home = home.clone();
                    workers.push(thread::spawn(move || {
                        let result = match request.method.as_str() {
                            "run" => serde_json::from_value::<RunParams>(request.params)
                                .map_err(|error| format!("Invalid run params: {error}"))
                                .and_then(|params| {
                                    run_command(
                                        request.id,
                                        params,
                                        &worker_home,
                                        &worker_active,
                                        &worker_stopping,
                                    )
                                }),
                            "edit" => serde_json::from_value::<EditParams>(request.params)
                                .map_err(|error| format!("Invalid edit params: {error}"))
                                .and_then(|params| {
                                    let _guard = worker_edit_lock
                                        .lock()
                                        .map_err(|_| "Edit lock is poisoned".to_string())?;
                                    edit_file(request.id, params, &worker_home)
                                }),
                            _ => unreachable!(),
                        };
                        match result {
                            Ok(result) => send_result(&worker_writer, request.id, result),
                            Err(error) => send_error(&worker_writer, request.id, error),
                        }
                    }));
                }
                "shutdown" => {
                    stopping.store(true, Ordering::SeqCst);
                    terminate_all(&active);
                    join_workers(&mut workers);
                    send_result(&writer, request.id, json!({"stopped": true}));
                    return Ok(());
                }
                _ => send_error(
                    &writer,
                    request.id,
                    format!("Unknown method: {}", request.method),
                ),
            }
        }

        stopping.store(true, Ordering::SeqCst);
        terminate_all(&active);
        join_workers(&mut workers);
        Ok(())
    }

    fn run_command(
        request_id: u64,
        params: RunParams,
        home: &Path,
        active: &ActiveGroups,
        stopping: &AtomicBool,
    ) -> Result<Value, String> {
        validate_argv(&params.argv)?;
        if !(1..=300).contains(&params.timeout_seconds) {
            return Err("timeout_seconds must be an integer between 1 and 300".to_string());
        }
        if params.output_limit < 2 {
            return Err("output_limit must be at least 2".to_string());
        }
        let cwd = resolve_directory(home, params.cwd.as_deref())?;
        let started = Instant::now();
        let mut command = Command::new(&params.argv[0]);
        command
            .args(&params.argv[1..])
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Cannot start command: {error}"))?;
        let process_group = child.id() as i32;
        active
            .lock()
            .map_err(|_| "Host process lock is poisoned".to_string())?
            .insert(request_id, process_group);
        let _process_guard = ProcessGuard {
            request_id,
            process_group,
            active: Arc::clone(active),
        };
        if stopping.load(Ordering::SeqCst) {
            terminate_group(process_group);
        }
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Cannot capture stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Cannot capture stderr".to_string())?;
        let stdout_limit = params.output_limit;
        let stderr_limit = params.output_limit;
        let stdout_reader = thread::spawn(move || read_bounded(stdout, stdout_limit));
        let stderr_reader = thread::spawn(move || read_bounded(stderr, stderr_limit));
        let deadline = started + Duration::from_secs(params.timeout_seconds);
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() >= deadline => {
                    timed_out = true;
                    terminate_group(process_group);
                    break child
                        .wait()
                        .map_err(|error| format!("Cannot wait for command: {error}"))?;
                }
                Ok(None) => thread::sleep(Duration::from_millis(10)),
                Err(error) => {
                    terminate_group(process_group);
                    return Err(format!("Cannot wait for command: {error}"));
                }
            }
        };
        let (stdout, stdout_truncated) = stdout_reader
            .join()
            .map_err(|_| "stdout reader failed".to_string())??;
        let (stderr, stderr_truncated) = stderr_reader
            .join()
            .map_err(|_| "stderr reader failed".to_string())??;
        if stopping.load(Ordering::SeqCst) {
            return Err("Host tools are stopped".to_string());
        }
        Ok(json!({
            "argv": params.argv,
            "cwd": display_path(home, &cwd),
            "exit_code": exit_code(status),
            "timed_out": timed_out,
            "duration_ms": started.elapsed().as_millis(),
            "stdout": stdout,
            "stderr": stderr,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
        }))
    }

    fn edit_file(request_id: u64, params: EditParams, home: &Path) -> Result<Value, String> {
        if params.path.is_empty() {
            return Err("path is required".to_string());
        }
        if params.old_text.is_empty() {
            return Err("old_text is required".to_string());
        }
        if params.old_text == params.new_text {
            return Err("old_text and new_text must differ".to_string());
        }
        let target = resolve_file(home, &params.path)?;
        let bytes = fs::read(&target).map_err(|error| format!("Cannot read edit file: {error}"))?;
        let original = String::from_utf8(bytes)
            .map_err(|_| "Edit path must identify a UTF-8 text file".to_string())?;
        let match_count = original.matches(&params.old_text).count();
        if match_count == 0 {
            return Err("old_text was not found in the file".to_string());
        }
        if match_count > 1 && !params.replace_all {
            return Err(format!(
                "old_text must match exactly once; found {match_count} matches"
            ));
        }
        let replacement_count = if params.replace_all { match_count } else { 1 };
        let updated = if params.replace_all {
            original.replace(&params.old_text, &params.new_text)
        } else {
            original.replacen(&params.old_text, &params.new_text, 1)
        };
        write_atomic(&target, updated.as_bytes(), request_id)?;
        Ok(json!({
            "edited": true,
            "path": display_path(home, &target),
            "replacement_count": replacement_count,
        }))
    }

    fn validate_argv(argv: &[String]) -> Result<(), String> {
        if argv.is_empty() || argv.len() > 128 {
            return Err("argv must contain between 1 and 128 items".to_string());
        }
        if argv
            .iter()
            .any(|item| item.is_empty() || item.contains('\0'))
        {
            return Err("argv items must be non-empty strings".to_string());
        }
        Ok(())
    }

    fn resolve_directory(home: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
        let candidate = match cwd {
            Some(cwd) if !cwd.is_empty() => {
                let path = input_path(cwd)?;
                if path.is_absolute() {
                    path
                } else {
                    home.join(path)
                }
            }
            _ => home.to_path_buf(),
        };
        let resolved = candidate
            .canonicalize()
            .map_err(|error| format!("Cannot resolve cwd: {error}"))?;
        if !resolved.is_dir() {
            return Err("cwd must identify an existing directory".to_string());
        }
        Ok(resolved)
    }

    fn resolve_file(home: &Path, path: &str) -> Result<PathBuf, String> {
        let candidate = input_path(path)?;
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            home.join(candidate)
        };
        let resolved = candidate
            .canonicalize()
            .map_err(|_| "Edit path must identify an existing file".to_string())?;
        if !resolved.is_file() {
            return Err("Edit path must identify an existing file".to_string());
        }
        Ok(resolved)
    }

    fn input_path(path: &str) -> Result<PathBuf, String> {
        let bytes = path.as_bytes();
        let windows_path = (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
            || path.starts_with("\\\\");
        if !windows_path {
            return Ok(PathBuf::from(path));
        }
        let output = Command::new("wslpath")
            .args(["-u", path])
            .output()
            .map_err(|error| format!("Cannot translate Windows path: {error}"))?;
        if !output.status.success() {
            return Err("Cannot translate Windows path".to_string());
        }
        let translated = String::from_utf8(output.stdout)
            .map_err(|_| "Translated Windows path is not UTF-8".to_string())?;
        let translated = translated.trim();
        if !translated.starts_with('/') {
            return Err("Translated Windows path is invalid".to_string());
        }
        Ok(PathBuf::from(translated))
    }

    fn write_atomic(target: &Path, content: &[u8], request_id: u64) -> Result<(), String> {
        let parent = target
            .parent()
            .ok_or_else(|| "Edit path has no parent directory".to_string())?;
        let name = target
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Edit path must be valid UTF-8".to_string())?;
        let permissions = fs::metadata(target)
            .map_err(|error| format!("Cannot inspect edit file: {error}"))?
            .permissions();
        let mut temporary_path = None;
        let result = (|| {
            let mut temporary = None;
            for attempt in 0..100 {
                let path = parent.join(format!(
                    ".{name}.huddol-{}-{request_id}-{attempt}",
                    std::process::id()
                ));
                match OpenOptions::new().write(true).create_new(true).open(&path) {
                    Ok(file) => {
                        temporary = Some((path, file));
                        break;
                    }
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        return Err(format!("Cannot create temporary edit file: {error}"));
                    }
                }
            }
            let (path, mut file) =
                temporary.ok_or_else(|| "Cannot create temporary edit file".to_string())?;
            temporary_path = Some(path.clone());
            file.write_all(content)
                .map_err(|error| format!("Cannot write edit file: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Cannot write edit file: {error}"))?;
            fs::set_permissions(&path, permissions)
                .map_err(|error| format!("Cannot write edit file: {error}"))?;
            drop(file);
            fs::rename(&path, target)
                .map_err(|error| format!("Cannot write edit file: {error}"))?;
            temporary_path = None;
            Ok(())
        })();
        if let Some(path) = temporary_path {
            let _ = fs::remove_file(path);
        }
        result
    }

    fn read_bounded<R: Read>(mut reader: R, limit: usize) -> Result<(String, bool), String> {
        let head_limit = limit / 2;
        let tail_limit = limit - head_limit;
        let mut head = Vec::with_capacity(head_limit);
        let mut tail = Vec::with_capacity(tail_limit);
        let mut total = 0usize;
        let mut buffer = [0u8; 8192];
        loop {
            let count = reader
                .read(&mut buffer)
                .map_err(|error| format!("Cannot read command output: {error}"))?;
            if count == 0 {
                break;
            }
            total += count;
            let mut offset = 0;
            if head.len() < head_limit {
                let take = (head_limit - head.len()).min(count);
                head.extend_from_slice(&buffer[..take]);
                offset = take;
            }
            if offset < count && tail_limit > 0 {
                tail.extend_from_slice(&buffer[offset..count]);
                if tail.len() > tail_limit {
                    let excess = tail.len() - tail_limit;
                    tail.drain(..excess);
                }
            }
        }
        let truncated = total > head_limit + tail_limit;
        let bytes = if truncated {
            let omitted = total - head.len() - tail.len();
            let mut rendered = head;
            rendered.extend_from_slice(format!("\n... {omitted} bytes omitted ...\n").as_bytes());
            rendered.extend_from_slice(&tail);
            rendered
        } else {
            head.extend_from_slice(&tail);
            head
        };
        Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
    }

    fn display_path(home: &Path, path: &Path) -> String {
        match path.strip_prefix(home) {
            Ok(relative) if relative.as_os_str().is_empty() => ".".to_string(),
            Ok(relative) => relative.display().to_string(),
            Err(_) => path.display().to_string(),
        }
    }

    fn exit_code(status: ExitStatus) -> i32 {
        status
            .code()
            .or_else(|| status.signal().map(|signal| -signal))
            .unwrap_or(-1)
    }

    fn terminate_all(active: &ActiveGroups) {
        let groups = active
            .lock()
            .map(|groups| groups.values().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        for process_group in groups {
            terminate_group(process_group);
        }
    }

    fn terminate_group(process_group: i32) {
        unsafe {
            libc::kill(-process_group, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_millis(250);
        while Instant::now() < deadline {
            let alive = unsafe { libc::kill(-process_group, 0) == 0 };
            if !alive {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        unsafe {
            libc::kill(-process_group, libc::SIGKILL);
        }
    }

    fn join_workers(workers: &mut Vec<JoinHandle<()>>) {
        for worker in workers.drain(..) {
            let _ = worker.join();
        }
    }

    fn send_result(writer: &Writer, id: u64, result: Value) {
        send_response(
            writer,
            Response {
                id,
                result: Some(result),
                error: None,
            },
        );
    }

    fn send_error(writer: &Writer, id: u64, message: String) {
        send_response(
            writer,
            Response {
                id,
                result: None,
                error: Some(ErrorBody { message }),
            },
        );
    }

    fn send_response(writer: &Writer, response: Response) {
        if let Ok(mut writer) = writer.lock()
            && serde_json::to_writer(&mut *writer, &response).is_ok()
        {
            let _ = writer.write_all(b"\n");
            let _ = writer.flush();
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::time::{SystemTime, UNIX_EPOCH};

        fn temporary_directory() -> PathBuf {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = env::temp_dir().join(format!("huddol-host-test-{suffix}"));
            fs::create_dir(&path).unwrap();
            path
        }

        #[test]
        fn edit_replaces_exact_text_and_preserves_mode() {
            let root = temporary_directory();
            let target = root.join("source.txt");
            fs::write(&target, "before\n").unwrap();
            fs::set_permissions(&target, fs::Permissions::from_mode(0o744)).unwrap();

            let result = edit_file(
                1,
                EditParams {
                    path: "source.txt".to_string(),
                    old_text: "before".to_string(),
                    new_text: "after".to_string(),
                    replace_all: false,
                },
                &root,
            )
            .unwrap();

            assert_eq!(result["path"], "source.txt");
            assert_eq!(fs::read_to_string(&target).unwrap(), "after\n");
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o744
            );
            fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn bounded_output_keeps_head_and_tail() {
            let (output, truncated) = read_bounded(&b"abcdefghijkl"[..], 6).unwrap();

            assert!(truncated);
            assert!(output.starts_with("abc\n... 6 bytes omitted ...\n"));
            assert!(output.ends_with("jkl"));
        }
    }
}

#[cfg(unix)]
fn main() {
    if let Err(error) = unix::main() {
        eprintln!("[huddol-host] {error}");
        std::process::exit(1);
    }
}

#[cfg(not(unix))]
fn main() {
    eprintln!("huddol-host requires a Unix environment");
    std::process::exit(1);
}
