use crate::db::Database;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub struct ReminderService;

impl ReminderService {
    pub fn start_scheduler(app_handle: AppHandle, db: Arc<Mutex<Database>>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
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

                    let _ = app_handle.notification().builder()
                        .title(title)
                        .body(body)
                        .show();

                    if let Ok(guard) = db.lock() {
                        let _ = guard.mark_reminder_sent(&todo.id);
                    }
                }
            }
        });
    }
}
