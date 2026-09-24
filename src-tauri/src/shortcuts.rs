use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use crate::models::AppConfig;
use crate::commands::DbState;

/// 精准计算当前显示器物理工作区，将 HUD 窗口对齐到桌面右下角（避开任务栏并完美适配高分屏 DPI 缩放）
pub fn position_hud_window_bottom_right(hud_win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = hud_win.current_monitor() {
        let screen_size = monitor.size(); // 物理分辨率，如 2240 x 1400
        let scale = monitor.scale_factor(); // 缩放比例，如 1.5
        let win_size = hud_win.outer_size().unwrap_or(tauri::PhysicalSize {
            width: (380.0 * scale) as u32,
            height: (80.0 * scale) as u32,
        });
        let margin_x = (20.0 * scale) as i32;
        let margin_y = (65.0 * scale) as i32; // 预留 Windows 任务栏物理高度
        let x = (screen_size.width as i32) - (win_size.width as i32) - margin_x;
        let y = (screen_size.height as i32) - (win_size.height as i32) - margin_y;
        println!("│ [HUD 窗口定位] 屏幕: {}x{}, 缩放: {}, 窗口: {}x{}, 目标右下角坐标: ({}, {})",
            screen_size.width, screen_size.height, scale, win_size.width, win_size.height, x, y
        );
        let _ = hud_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));

        #[cfg(windows)]
        {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongW, SetWindowPos, GWL_STYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WS_VISIBLE,
            };
            if let Ok(hwnd) = hud_win.hwnd() {
                unsafe {
                    let win_hwnd = HWND(hwnd.0 as _);
                    let style = GetWindowLongW(win_hwnd, GWL_STYLE) as u32;
                    let is_visible = (style & WS_VISIBLE.0) != 0;

                    if is_visible {
                        // 窗口处于可见状态时，保持置顶并移动
                        let _ = SetWindowPos(
                            win_hwnd,
                            HWND_TOPMOST,
                            x,
                            y,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                    } else {
                        // 窗口处于隐藏状态时，仅更新坐标，绝不将其显示到屏幕上
                        let _ = SetWindowPos(
                            win_hwnd,
                            HWND(std::ptr::null_mut()),
                            x,
                            y,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
                        );
                    }
                }
            }
        }
    }
}

/// 注册全局快捷键（划选捕获 & 呼出主看板）
pub fn register_global_shortcuts(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();
    // 1. 注销之前注册的所有全局快捷键
    let _ = global_shortcut.unregister_all();

    // 2. 注册划选捕获快捷键
    let capture_str = config.capture_shortcut.trim();
    if !capture_str.is_empty() {
        let shortcut = Shortcut::from_str(capture_str)
            .map_err(|e| format!("划选快捷键格式错误 [{}] : {:?}", capture_str, e))?;
        
        let handle = app.clone();
        global_shortcut
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    // 1. 抓取必须在显示任何窗口前执行！保证前台焦点 100% 停留在用户的源应用（如微信）
                    let capture_res = crate::services::clipboard_service::ClipboardService::capture_selected_text_safe().await;

                    // 2. 抓取完成后，立即计算位置并唤起 HUD 窗口展示反馈
                    if let Some(hud_win) = handle.get_webview_window("hud") {
                        position_hud_window_bottom_right(&hud_win);
                        let _ = hud_win.unminimize();
                        let _ = hud_win.show();
                        let _ = hud_win.set_always_on_top(true);

                        match capture_res {
                            Ok(captured) => {
                                let _ = hud_win.emit("capture-start", ());
                                let _ = hud_win.emit("captured-context", captured);
                                // 同时通知主窗口有新内容可能进入收件箱
                                let _ = handle.emit("refresh-data", ());
                            }
                            Err(err_msg) => {
                                let _ = hud_win.emit("capture-error", err_msg);
                            }
                        }
                    }
                });
            })
            .map_err(|e| format!("注册划选快捷键 [{}] 失败，可能已被系统或其他软件占用: {}", capture_str, e))?;
    }

    // 3. 注册呼出主看板快捷键
    let main_str = config.main_window_shortcut.trim();
    if !main_str.is_empty() {
        let shortcut = Shortcut::from_str(main_str)
            .map_err(|e| format!("主看板快捷键格式错误 [{}] : {:?}", main_str, e))?;

        let handle = app.clone();
        global_shortcut
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    crate::show_or_create_main_window(&handle);
                });
            })
            .map_err(|e| format!("注册主看板快捷键 [{}] 失败，可能已被系统或其他软件占用: {}", main_str, e))?;
    }

    Ok(())
}

/// 验证并更新全局快捷键，若失败自动恢复旧快捷键
/// 校验快捷键配置合法性
pub fn validate_shortcuts(new_config: &AppConfig) -> Result<(), String> {
    let cap = new_config.capture_shortcut.trim();
    let main = new_config.main_window_shortcut.trim();

    // 1. 若两个快捷键均不为空，不可相同
    if !cap.is_empty() && !main.is_empty() && cap.eq_ignore_ascii_case(main) {
        return Err("划选捕获快捷键与呼出主看板快捷键不能相同".to_string());
    }

    // 2. 预解析校验格式
    if !cap.is_empty() {
        Shortcut::from_str(cap)
            .map_err(|e| format!("划选快捷键格式无效 [{}] : {:?}", cap, e))?;
    }
    if !main.is_empty() {
        Shortcut::from_str(main)
            .map_err(|e| format!("主看板快捷键格式无效 [{}] : {:?}", main, e))?;
    }

    Ok(())
}

/// 验证并更新全局快捷键，若失败自动恢复旧快捷键
pub fn update_global_shortcuts(app: &AppHandle, new_config: &AppConfig) -> Result<(), String> {
    validate_shortcuts(new_config)?;

    // 尝试注册新快捷键
    if let Err(err) = register_global_shortcuts(app, new_config) {
        // 注册失败时尝试恢复原数据库配置中的快捷键
        if let Some(db_state) = app.try_state::<DbState>() {
            if let Ok(guard) = db_state.lock() {
                if let Ok(old_config) = guard.get_config() {
                    let _ = register_global_shortcuts(app, &old_config);
                }
            }
        }
        return Err(err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_shortcuts() {
        let mut config = AppConfig::default();
        config.capture_shortcut = "Alt+A".to_string();
        config.main_window_shortcut = "Alt+Shift+Space".to_string();
        assert!(validate_shortcuts(&config).is_ok());

        config.capture_shortcut = "Ctrl+Shift+K".to_string();
        config.main_window_shortcut = "Ctrl+Alt+S".to_string();
        assert!(validate_shortcuts(&config).is_ok());
    }

    #[test]
    fn test_allow_empty_shortcut() {
        let mut config = AppConfig::default();
        config.capture_shortcut = "".to_string();
        config.main_window_shortcut = "Alt+Shift+Space".to_string();
        assert!(validate_shortcuts(&config).is_ok());
    }

    #[test]
    fn test_duplicate_shortcuts_rejected() {
        let mut config = AppConfig::default();
        config.capture_shortcut = "Alt+A".to_string();
        config.main_window_shortcut = "alt+a".to_string();
        assert!(validate_shortcuts(&config).is_err());
    }

    #[test]
    fn test_invalid_shortcut_format_rejected() {
        let mut config = AppConfig::default();
        config.capture_shortcut = "InvalidUnknownKeyCombo+999".to_string();
        assert!(validate_shortcuts(&config).is_err());
    }
}
