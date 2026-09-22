#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC DETAILS: {:?}\nLocation: {:?}\nPayload: {:?}", 
            info,
            info.location(),
            info.payload().downcast_ref::<&str>()
        );
        eprintln!("{}", msg);
        if let Ok(mut path) = std::env::current_exe() {
            path.pop();
            path.push("panic_info.log");
            let _ = std::fs::write(path, &msg);
        }
    }));

    println!("[AI2Assistant] 应用启动中...");
    ai2assistant_lib::run();
    println!("[AI2Assistant] 应用退出。");
}
