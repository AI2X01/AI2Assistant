use crate::db::Database;
use crate::models::{
    AIParseResult, AppConfig, ExtractedTodo, LogItem, Matter, SuggestedMatter, TodoItem,
};
use crate::services::ai_service::AIService;
use crate::services::clipboard_service::ClipboardService;
use chrono::Local;
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

pub type DbState = Arc<Mutex<Database>>;

#[derive(Debug, Deserialize)]
pub struct ConfirmRoutePayload {
    pub choice: String, // "EXISTING" | "CREATE_NEW" | "DISCARD"
    pub matter_id: Option<String>,
    pub new_matter: Option<SuggestedMatter>,
    pub raw_snippet: String,
    pub source_app: String,
    pub source_window: String,
    pub extracted_facts_delta: Option<String>,
    pub extracted_todos: Vec<ExtractedTodo>,
}

// ==================== 事项 Commands ====================

#[tauri::command]
pub fn get_matters(
    db: State<DbState>,
    status_filter: Option<String>,
    category_filter: Option<String>,
    sort_by: Option<String>,
) -> Result<Vec<Matter>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard
        .get_matters(status_filter, category_filter, sort_by)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_matter_by_id(db: State<DbState>, id: String) -> Result<Option<Matter>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_matter_by_id(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_matter(
    db: State<DbState>,
    title: String,
    overview: Option<String>,
    fact_summary: Option<String>,
    category: String,
    priority: String,
    importance: Option<i32>,
) -> Result<Matter, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let matter = Matter {
        id: Uuid::new_v4().to_string(),
        title,
        overview: overview.unwrap_or_default(),
        fact_summary: fact_summary.unwrap_or_default(),
        category,
        priority,
        importance: importance.unwrap_or(3),
        status: "active".to_string(),
        is_pinned: false,
        created_at: now.clone(),
        updated_at: now,
        pending_todos_count: 0,
        total_todos_count: 0,
        latest_log_snippet: None,
        latest_log_time: None,
    };
    guard.create_matter(&matter).map_err(|e| e.to_string())?;
    Ok(matter)
}

#[tauri::command]
pub fn update_matter(db: State<DbState>, matter: Matter) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_matter(&matter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_matter_status(db: State<DbState>, id: String, status: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard
        .update_matter_status(&id, &status)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_matter_pinned(db: State<DbState>, id: String) -> Result<bool, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.toggle_matter_pinned(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_matter(db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_matter(&id).map_err(|e| e.to_string())
}

// ==================== 日志 Commands ====================

#[tauri::command]
pub fn get_logs_by_matter(db: State<DbState>, matter_id: String) -> Result<Vec<LogItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_logs_by_matter(&matter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_log(
    db: State<DbState>,
    matter_id: String,
    raw_content: String,
    source_app: Option<String>,
    source_window_title: Option<String>,
) -> Result<LogItem, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let log = LogItem {
        id: Uuid::new_v4().to_string(),
        matter_id,
        raw_content,
        source_app: source_app.unwrap_or_else(|| "手动录入".to_string()),
        source_window_title: source_window_title.unwrap_or_default(),
        created_at: now,
    };
    guard.create_log(&log).map_err(|e| e.to_string())?;
    Ok(log)
}

#[tauri::command]
pub fn delete_log(db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_log(&id).map_err(|e| e.to_string())
}

// ==================== 待办 Commands ====================

#[tauri::command]
pub fn get_todos_by_matter(db: State<DbState>, matter_id: String) -> Result<Vec<TodoItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_todos_by_matter(&matter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_todos(db: State<DbState>, status_filter: Option<String>) -> Result<Vec<TodoItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_all_todos(status_filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_todo(
    db: State<DbState>,
    matter_id: String,
    content: String,
    due_time: Option<String>,
    reminder_time: Option<String>,
    log_id: Option<String>,
) -> Result<TodoItem, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let todo = TodoItem {
        id: Uuid::new_v4().to_string(),
        matter_id,
        log_id,
        content,
        due_time: due_time.clone(),
        reminder_time: reminder_time.or(due_time),
        is_reminder_sent: false,
        status: "pending".to_string(),
        is_focused: false,
        created_at: now,
        completed_at: None,
        matter_title: None,
    };
    guard.create_todo(&todo).map_err(|e| e.to_string())?;
    Ok(todo)
}

#[tauri::command]
pub fn toggle_todo_status(db: State<DbState>, id: String, completed: bool) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.toggle_todo_status(&id, completed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_todo_focus(db: State<DbState>, id: String) -> Result<bool, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.toggle_todo_focus(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_todo_reminder(
    db: State<DbState>,
    id: String,
    reminder_time: Option<String>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_todo_reminder(&id, reminder_time).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_todo(db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_todo(&id).map_err(|e| e.to_string())
}

// ==================== 配置 Commands ====================

#[tauri::command]
pub fn get_app_config(db: State<DbState>) -> Result<AppConfig, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_config(db: State<DbState>, config: AppConfig) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.save_config(&config).map_err(|e| e.to_string())
}

// ==================== 核心：划选抓取与 AI 智能意图路由 ====================

#[tauri::command]
pub async fn trigger_capture_and_analyze(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<AIParseResult, String> {
    // 1. 安全抓取前台选中文本与窗口元数据
    let captured = ClipboardService::capture_selected_text_safe().await?;

    // 2. 读取当前活跃事项与配置
    let (config, active_matters) = {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let config = guard.get_config().map_err(|e| e.to_string())?;
        let matters = guard
            .get_matters(Some("active".to_string()), None, Some("updated".to_string()))
            .map_err(|e| e.to_string())?;
        (config, matters)
    };

    // 3. 执行 AI 解析与路由判定
    let result = AIService::parse_and_route(
        &config,
        &active_matters,
        &captured.text,
        &captured.source_app,
        &captured.source_window,
    )
    .await;

    // 4. 判断是否达到自动归档阈值 (高置信度且已有明确事项)
    if result.action == "MATCH_EXISTING" && result.confidence >= config.auto_archive_confidence {
        if let Some(ref mid) = result.matched_matter_id {
            let guard = db.lock().map_err(|e| e.to_string())?;
            let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

            // 写入 Log
            let log_id = Uuid::new_v4().to_string();
            let log = LogItem {
                id: log_id.clone(),
                matter_id: mid.clone(),
                raw_content: captured.text.clone(),
                source_app: captured.source_app.clone(),
                source_window_title: captured.source_window.clone(),
                created_at: now.clone(),
            };
            let _ = guard.create_log(&log);

            // 增量事实合并
            if let Some(ref delta) = result.extracted_facts_delta {
                if let Ok(Some(mut matter)) = guard.get_matter_by_id(mid) {
                    if matter.fact_summary.is_empty() {
                        matter.fact_summary = delta.clone();
                    } else {
                        matter.fact_summary = format!("{}\n{}", matter.fact_summary, delta);
                    }
                    let _ = guard.update_matter(&matter);
                }
            }

            // 插入抽取出的待办
            for todo in &result.extracted_todos {
                let new_todo = TodoItem {
                    id: Uuid::new_v4().to_string(),
                    matter_id: mid.clone(),
                    log_id: Some(log_id.clone()),
                    content: todo.content.clone(),
                    due_time: todo.due_time.clone(),
                    reminder_time: todo.due_time.clone(),
                    is_reminder_sent: false,
                    status: "pending".to_string(),
                    is_focused: false,
                    created_at: now.clone(),
                    completed_at: None,
                    matter_title: None,
                };
                let _ = guard.create_todo(&new_todo);
            }
        }
    }

    // 唤起并显示 HUD 浮窗
    if let Some(hud_win) = app.get_webview_window("hud") {
        let _ = hud_win.show();
        let _ = hud_win.set_always_on_top(true);
    }

    Ok(result)
}

#[tauri::command]
pub async fn manual_parse_text(
    db: State<'_, DbState>,
    text: String,
    source_app: Option<String>,
    source_window: Option<String>,
) -> Result<AIParseResult, String> {
    let (config, active_matters) = {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let config = guard.get_config().map_err(|e| e.to_string())?;
        let matters = guard
            .get_matters(Some("active".to_string()), None, Some("updated".to_string()))
            .map_err(|e| e.to_string())?;
        (config, matters)
    };

    let result = AIService::parse_and_route(
        &config,
        &active_matters,
        &text,
        source_app.as_deref().unwrap_or("手动输入"),
        source_window.as_deref().unwrap_or(""),
    )
    .await;

    Ok(result)
}

#[tauri::command]
pub fn confirm_route_decision(
    db: State<DbState>,
    payload: ConfirmRoutePayload,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let target_matter_id = match payload.choice.as_str() {
        "EXISTING" => payload.matter_id.ok_or_else(|| "未指定目标事项ID".to_string())?,
        "CREATE_NEW" => {
            let suggested = payload.new_matter.unwrap_or(SuggestedMatter {
                title: "新捕获事项".to_string(),
                category: "work".to_string(),
                priority: "medium".to_string(),
                summary: "".to_string(),
            });
            let new_id = Uuid::new_v4().to_string();
            let new_matter = Matter {
                id: new_id.clone(),
                title: suggested.title,
                overview: suggested.summary,
                fact_summary: payload.extracted_facts_delta.clone().unwrap_or_default(),
                category: suggested.category,
                priority: suggested.priority,
                importance: 3,
                status: "active".to_string(),
                is_pinned: false,
                created_at: now.clone(),
                updated_at: now.clone(),
                pending_todos_count: 0,
                total_todos_count: 0,
                latest_log_snippet: None,
                latest_log_time: None,
            };
            guard.create_matter(&new_matter).map_err(|e| e.to_string())?;
            new_id
        }
        "DISCARD" => return Ok(()),
        _ => return Err("未知的决策选项".to_string()),
    };

    // 写入日志
    let log_id = Uuid::new_v4().to_string();
    let log = LogItem {
        id: log_id.clone(),
        matter_id: target_matter_id.clone(),
        raw_content: payload.raw_snippet,
        source_app: payload.source_app,
        source_window_title: payload.source_window,
        created_at: now.clone(),
    };
    guard.create_log(&log).map_err(|e| e.to_string())?;

    // 增量事实合并（若是归并到已有事项）
    if payload.choice == "EXISTING" {
        if let Some(ref delta) = payload.extracted_facts_delta {
            if let Ok(Some(mut matter)) = guard.get_matter_by_id(&target_matter_id) {
                if matter.fact_summary.is_empty() {
                    matter.fact_summary = delta.clone();
                } else {
                    matter.fact_summary = format!("{}\n{}", matter.fact_summary, delta);
                }
                let _ = guard.update_matter(&matter);
            }
        }
    }

    // 插入待办
    for todo in payload.extracted_todos {
        let new_todo = TodoItem {
            id: Uuid::new_v4().to_string(),
            matter_id: target_matter_id.clone(),
            log_id: Some(log_id.clone()),
            content: todo.content,
            due_time: todo.due_time.clone(),
            reminder_time: todo.due_time,
            is_reminder_sent: false,
            status: "pending".to_string(),
            is_focused: false,
            created_at: now.clone(),
            completed_at: None,
            matter_title: None,
        };
        let _ = guard.create_todo(&new_todo);
    }

    Ok(())
}

// ==================== 窗口显隐 Commands ====================

#[tauri::command]
pub fn hide_hud_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}
