use std::ffi::OsString;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliCommand {
    Probe {
        state_dir: PathBuf,
        status_file: PathBuf,
    },
    Setup {
        state_dir: PathBuf,
        status_file: PathBuf,
        owner_sid: Option<String>,
    },
    Run {
        state_dir: PathBuf,
        policy_file: PathBuf,
        command: Vec<String>,
    },
    Worker {
        pipe_name: String,
    },
    Help,
}

pub fn usage() -> &'static str {
    "Usage:\n  flowent-sandbox-windows probe --state-dir <path> --status-file <path>\n  flowent-sandbox-windows setup --state-dir <path> --status-file <path> [--owner-sid <sid>]\n  flowent-sandbox-windows run --state-dir <path> --policy <json-file> -- <command> [args...]"
}

pub fn parse<I>(arguments: I) -> AppResult<CliCommand>
where
    I: IntoIterator<Item = OsString>,
{
    let mut arguments = arguments.into_iter();
    let Some(subcommand) = arguments.next() else {
        return Err(AppError::invalid(usage()));
    };
    match subcommand.to_string_lossy().as_ref() {
        "probe" => parse_probe(arguments.collect()),
        "setup" => parse_setup(arguments.collect()),
        "run" => parse_run(arguments.collect()),
        "__worker" => parse_worker(arguments.collect()),
        "help" | "--help" | "-h" => Ok(CliCommand::Help),
        value => Err(AppError::invalid(format!("Unknown command: {value}."))),
    }
}

fn parse_probe(arguments: Vec<OsString>) -> AppResult<CliCommand> {
    let options = parse_named_options(arguments, &["--state-dir", "--status-file"], &[])?;
    Ok(CliCommand::Probe {
        state_dir: required_path(&options, "--state-dir")?,
        status_file: required_path(&options, "--status-file")?,
    })
}

fn parse_setup(arguments: Vec<OsString>) -> AppResult<CliCommand> {
    let options = parse_named_options(
        arguments,
        &["--state-dir", "--status-file", "--owner-sid"],
        &[],
    )?;
    Ok(CliCommand::Setup {
        state_dir: required_path(&options, "--state-dir")?,
        status_file: required_path(&options, "--status-file")?,
        owner_sid: options
            .iter()
            .find(|(name, _)| name == "--owner-sid")
            .map(|(_, value)| value.to_string_lossy().into_owned()),
    })
}

fn parse_run(arguments: Vec<OsString>) -> AppResult<CliCommand> {
    let separator = arguments
        .iter()
        .position(|value| value == "--")
        .ok_or_else(|| AppError::invalid("run requires -- before the command."))?;
    let command = arguments[separator + 1..]
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    if command.is_empty() || command[0].is_empty() {
        return Err(AppError::invalid("run requires a command after --."));
    }
    let options = parse_named_options(
        arguments[..separator].to_vec(),
        &["--state-dir", "--policy"],
        &[],
    )?;
    Ok(CliCommand::Run {
        state_dir: required_path(&options, "--state-dir")?,
        policy_file: required_path(&options, "--policy")?,
        command,
    })
}

fn parse_worker(arguments: Vec<OsString>) -> AppResult<CliCommand> {
    let options = parse_named_options(arguments, &["--pipe"], &[])?;
    let pipe_name = required_value(&options, "--pipe")?
        .to_string_lossy()
        .into_owned();
    Ok(CliCommand::Worker { pipe_name })
}

fn parse_named_options(
    arguments: Vec<OsString>,
    valued: &[&str],
    flags: &[&str],
) -> AppResult<Vec<(String, OsString)>> {
    let mut parsed = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        let name = arguments[index].to_string_lossy().into_owned();
        if flags.contains(&name.as_str()) {
            parsed.push((name, OsString::new()));
            index += 1;
            continue;
        }
        if !valued.contains(&name.as_str()) {
            return Err(AppError::invalid(format!("Unknown option: {name}.")));
        }
        let Some(value) = arguments.get(index + 1) else {
            return Err(AppError::invalid(format!("Missing value for {name}.")));
        };
        if parsed.iter().any(|(existing, _)| existing == &name) {
            return Err(AppError::invalid(format!("Duplicate option: {name}.")));
        }
        parsed.push((name, value.clone()));
        index += 2;
    }
    Ok(parsed)
}

fn required_value<'a>(options: &'a [(String, OsString)], name: &str) -> AppResult<&'a OsString> {
    options
        .iter()
        .find(|(candidate, _)| candidate == name)
        .map(|(_, value)| value)
        .ok_or_else(|| AppError::invalid(format!("Missing required option: {name}.")))
}

fn required_path(options: &[(String, OsString)], name: &str) -> AppResult<PathBuf> {
    Ok(PathBuf::from(required_value(options, name)?))
}

#[cfg(test)]
mod tests {
    use super::{CliCommand, parse};
    use std::ffi::OsString;
    use std::path::PathBuf;

    fn values(items: &[&str]) -> Vec<OsString> {
        items.iter().map(OsString::from).collect()
    }

    #[test]
    fn parses_run_without_splitting_command_arguments() {
        let command = parse(values(&[
            "run",
            "--state-dir",
            "/state",
            "--policy",
            "/runtime/policy.json",
            "--",
            "program.exe",
            "value with spaces",
        ]))
        .unwrap();
        assert_eq!(
            command,
            CliCommand::Run {
                state_dir: PathBuf::from("/state"),
                policy_file: PathBuf::from("/runtime/policy.json"),
                command: vec!["program.exe".into(), "value with spaces".into()],
            }
        );
    }

    #[test]
    fn rejects_run_without_separator() {
        let error = parse(values(&[
            "run",
            "--state-dir",
            "/state",
            "--policy",
            "/policy.json",
            "program.exe",
        ]))
        .unwrap_err();
        assert_eq!(error.code, "invalid_request");
    }

    #[test]
    fn rejects_duplicate_options() {
        let error = parse(values(&[
            "probe",
            "--state-dir",
            "/state",
            "--state-dir",
            "/other",
            "--status-file",
            "/status.json",
        ]))
        .unwrap_err();
        assert!(error.message.contains("Duplicate option"));
    }
}
