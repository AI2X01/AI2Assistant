use std::path::PathBuf;

pub struct AutostartService;

impl AutostartService {
    const REG_KEY: &'static str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const APP_NAME: &'static str = "AI2Assistant";

    /// 获取当前正在运行的应用程序可执行文件的绝对路径
    pub fn get_current_exe_path() -> Result<PathBuf, String> {
        std::env::current_exe().map_err(|e| format!("获取当前可执行文件路径失败: {}", e))
    }

    /// 查询当前是否已设置开机自启动
    pub fn is_enabled() -> bool {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let output = Command::new("reg")
                .args(&["query", Self::REG_KEY, "/v", Self::APP_NAME])
                .creation_flags(CREATE_NO_WINDOW)
                .output();

            match output {
                Ok(out) => out.status.success(),
                Err(_) => false,
            }
        }

        #[cfg(not(windows))]
        {
            false
        }
    }

    /// 设置开机自启动开启或关闭
    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            const CREATE_NO_WINDOW: u32 = 0x08000000;

            if enabled {
                let exe_path = Self::get_current_exe_path()?;
                let exe_str = exe_path.to_string_lossy().to_string();
                let reg_val = format!("\"{}\"", exe_str);

                println!("[AutostartService] 正在写入开机自启动注册表项: {} -> {}", Self::APP_NAME, reg_val);

                let output = Command::new("reg")
                    .args(&[
                        "add",
                        Self::REG_KEY,
                        "/v",
                        Self::APP_NAME,
                        "/t",
                        "REG_SZ",
                        "/d",
                        &reg_val,
                        "/f",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|e| format!("执行注册表写入命令失败: {}", e))?;

                if !output.status.success() {
                    let err = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("开启开机自启失败: {}", err));
                }

                println!("[AutostartService] 开机自启动注册成功！");
            } else {
                println!("[AutostartService] 正在移除开机自启动注册表项: {}", Self::APP_NAME);

                let output = Command::new("reg")
                    .args(&["delete", Self::REG_KEY, "/v", Self::APP_NAME, "/f"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|e| format!("执行注册表删除命令失败: {}", e))?;

                // 如果键本来就不存在，reg delete 返回 1，但也算清理干净
                if !output.status.success() {
                    let err = String::from_utf8_lossy(&output.stderr);
                    if !err.contains("unable to find") && !err.contains("找不到") {
                        return Err(format!("关闭开机自启失败: {}", err));
                    }
                }

                println!("[AutostartService] 开机自启动项已成功移除！");
            }

            Ok(())
        }

        #[cfg(not(windows))]
        {
            let _ = enabled;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_autostart_toggle() {
        // 测试读取与设置接口不崩溃
        let initial = AutostartService::is_enabled();
        // 设置为 true
        assert!(AutostartService::set_enabled(true).is_ok());
        assert!(AutostartService::is_enabled());

        // 恢复原状
        assert!(AutostartService::set_enabled(initial).is_ok());
        assert_eq!(AutostartService::is_enabled(), initial);
    }
}
