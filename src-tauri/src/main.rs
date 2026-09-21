// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC DETAILS: {:?}\nLocation: {:?}\nPayload: {:?}", 
            info,
            info.location(),
            info.payload().downcast_ref::<&str>()
        );
        eprintln!("{}", msg);
        let _ = std::fs::write("D:\\code\\AI2Assistant\\panic_info.log", msg);
    }));

    println!("[AI2Assistant] 应用启动中...");
    ai2assistant_lib::run();
    println!("[AI2Assistant] 应用退出。");
}
