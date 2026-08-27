#![cfg(unix)]

use serde_json::{Value, json};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

fn temporary_directory() -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = env::temp_dir().join(format!("huddol-host-protocol-{suffix}"));
    fs::create_dir(&path).unwrap();
    path
}

fn exchange(input: &mut impl Write, output: &mut impl BufRead, request: Value) -> Value {
    serde_json::to_writer(&mut *input, &request).unwrap();
    input.write_all(b"\n").unwrap();
    input.flush().unwrap();
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

#[test]
fn serves_run_edit_and_shutdown_over_json_lines() {
    let home = temporary_directory();
    let target = home.join("source.txt");
    fs::write(&target, "before\n").unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_huddol-host"))
        .env("HOME", &home)
        .env("WSL_DISTRO_NAME", "TestLinux")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());

    let hello = exchange(&mut input, &mut output, json!({"id": 1, "method": "hello"}));
    assert_eq!(hello["result"]["backend"], "wsl");
    assert_eq!(hello["result"]["distribution"], "TestLinux");
    assert_eq!(hello["result"]["home"], home.to_str().unwrap());

    let run = exchange(
        &mut input,
        &mut output,
        json!({
            "id": 2,
            "method": "run",
            "params": {
                "argv": ["sh", "-c", "printf 'héllo'; printf 'error' >&2"],
                "cwd": null,
                "timeout_seconds": 5,
                "output_limit": 65536
            }
        }),
    );
    assert_eq!(run["result"]["cwd"], ".");
    assert_eq!(run["result"]["exit_code"], 0);
    assert_eq!(run["result"]["stdout"], "héllo");
    assert_eq!(run["result"]["stderr"], "error");

    let edit = exchange(
        &mut input,
        &mut output,
        json!({
            "id": 3,
            "method": "edit",
            "params": {
                "path": "source.txt",
                "old_text": "before",
                "new_text": "after",
                "replace_all": false
            }
        }),
    );
    assert_eq!(edit["result"]["path"], "source.txt");
    assert_eq!(fs::read_to_string(&target).unwrap(), "after\n");

    let shutdown = exchange(
        &mut input,
        &mut output,
        json!({"id": 4, "method": "shutdown"}),
    );
    assert_eq!(shutdown["result"]["stopped"], true);
    drop(input);
    assert!(child.wait().unwrap().success());
    fs::remove_dir_all(home).unwrap();
}
