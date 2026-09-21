use crate::db::Database;
use crate::shortcuts;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub struct ReminderService;

impl ReminderService {
    pub fn start_scheduler(app_handle: AppHandle, db: Arc<Mutex<Database>>) {
        tauri::async_runtime::spawn(async move {
            // 每 5 秒轮询一次数据库中到期的未提醒待办，确保提醒准时灵敏
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;

                let due_todos = {
                    if let Ok(guard) = db.lock() {
                        guard.get_due_reminders().unwrap_or_default()
                    } else {
                        Vec::new()
                    }
                };

                for todo in due_todos {
                    let title = match &todo.matter_title {
                        Some(m_title) => format!("待办提醒: 【{}】", m_title),
                        None => "待办到期提醒".to_string(),
                    };

                    let body = todo.content.clone();

                    // 1. 发送 Windows 系统原生横幅通知
                    let _ = app_handle.notification().builder()
                        .title(title)
                        .body(body)
                        .show();

                    // 2. 唤醒并置顶右下角透明悬浮 HUD 窗口
                    if let Some(hud_win) = app_handle.get_webview_window("hud") {
                        shortcuts::position_hud_window_bottom_right(&hud_win);
                        let _ = hud_win.unminimize();
                        let _ = hud_win.show();
                        let _ = hud_win.set_focus();
                        let _ = hud_win.set_always_on_top(true);
                    }

                    // 3. 广播 todo-reminder 事件给前端
                    let _ = app_handle.emit("todo-reminder", &todo);

                    // 4. 标记已发送提醒，防止下一次轮询重复触发；用户选择推迟时会将标志位重置为 0
                    if let Ok(guard) = db.lock() {
                        let _ = guard.mark_reminder_sent(&todo.id);
                    }
                }
            }
        });
    }
}
