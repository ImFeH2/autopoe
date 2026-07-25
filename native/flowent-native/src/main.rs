fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("--version" | "-V") => {
            println!("flowent-native {}", env!("CARGO_PKG_VERSION"));
        }
        _ => {
            eprintln!("Usage: flowent-native --version");
            std::process::exit(2);
        }
    }
}
