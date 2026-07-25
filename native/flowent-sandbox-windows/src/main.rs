fn main() {
    std::process::exit(flowent_sandbox_windows::run_cli(
        std::env::args_os().skip(1),
    ));
}
