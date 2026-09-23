use crate::db::Database;
use crate::models::{
    AIParseResult, AppConfig, CategorizePayload, ExtractedTodo, InboxLogItem, LogItem, Matter,
    MatterContextWithTodos, RecategorizePayload, SuggestedMatter, TodoItem, TodoUpdateSuggestion,
    UncategorizePayload,
};
use crate::services::ai_service::AIService;
use crate::services::clipboard_service::ClipboardService;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[cfg(windows)]
use windows::Win32::Foundation::POINT;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

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
    #[serde(default)]
    pub todo_updates: Vec<TodoUpdateSuggestion>,
    pub log_id: Option<String>,
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
    app: AppHandle,
    db: State<DbState>,
    title: String,
    overview: Option<String>,
    fact_summary: Option<String>,
    category: String,
    priority: String,
    importance: Option<i32>,
    related_contacts: Option<String>,
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
        latest_todo_content: None,
        latest_todo_due_time: None,
        latest_todo_status: None,
        related_contacts: related_contacts.unwrap_or_default(),
    };
    guard.create_matter(&matter).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(matter)
}

#[tauri::command]
pub fn update_matter(app: AppHandle, db: State<DbState>, matter: Matter) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_matter(&matter).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn update_matter_status(app: AppHandle, db: State<DbState>, id: String, status: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard
        .update_matter_status(&id, &status)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn toggle_matter_pinned(app: AppHandle, db: State<DbState>, id: String) -> Result<bool, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let res = guard.toggle_matter_pinned(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(res)
}

#[tauri::command]
pub fn delete_matter(app: AppHandle, db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_matter(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

// ==================== 日志 Commands ====================

#[tauri::command]
pub fn get_logs_by_matter(db: State<DbState>, matter_id: String) -> Result<Vec<LogItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_logs_by_matter(&matter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_log(
    app: AppHandle,
    db: State<DbState>,
    matter_id: Option<String>,
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
    let _ = app.emit("refresh-data", ());
    Ok(log)
}

#[tauri::command]
pub fn delete_log(app: AppHandle, db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_log(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

// ==================== AI 收件箱 Commands ====================

#[tauri::command]
pub fn get_inbox_logs(db: State<DbState>) -> Result<Vec<InboxLogItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_all_inbox_logs().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn categorize_inbox_log(
    app: AppHandle,
    db: State<DbState>,
    payload: CategorizePayload,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let target_matter_id = match payload.choice.as_str() {
        "EXISTING" => payload.matter_id.ok_or_else(|| "未指定目标事项ID".to_string())?,
        "CREATE_NEW" => {
            let suggested = payload.new_matter.ok_or_else(|| "未提供新建事项信息".to_string())?;
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
                latest_todo_content: None,
                latest_todo_due_time: None,
                latest_todo_status: None,
                related_contacts: suggested.related_contacts.unwrap_or_default(),
            };
            guard.create_matter(&new_matter).map_err(|e| e.to_string())?;
            new_id
        }
        _ => return Err("未知的归集选项".to_string()),
    };

    guard.categorize_log(
        &payload.log_id,
        &target_matter_id,
        payload.extracted_facts_delta.as_deref(),
        &payload.new_todos,
    ).map_err(|e| e.to_string())?;

    for update in &payload.todo_updates {
        if update.action == "CLOSE" {
            let _ = guard.toggle_todo_status(&update.todo_id, true);
            println!("│ [待办核销] 已关闭待办: {} (ID: {})", update.original_content, update.todo_id);
        } else if update.action == "UPDATE" {
            let _ = guard.update_todo(
                &update.todo_id,
                update.updated_content.as_deref().unwrap_or(&update.original_content),
                update.updated_due_time.clone(),
                None,
            );
            println!("│ [待办更新] 已修改待办: {} (ID: {})", update.original_content, update.todo_id);
        }
    }

    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn uncategorize_log(
    app: AppHandle,
    db: State<DbState>,
    payload: UncategorizePayload,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;

    // 1. 调用 db 的撤销归集方法
    guard.uncategorize_log(
        &payload.log_id,
        payload.matter_id.as_deref(),
        payload.facts_delta.as_deref(),
    ).map_err(|e| e.to_string())?;

    // 2. 还原受影响的已有待办状态
    for update in &payload.todo_updates {
        if update.action == "CLOSE" {
            let _ = guard.toggle_todo_status(&update.todo_id, false);
            println!("│ [撤销归集] 恢复已核销待办: {} (ID: {})", update.original_content, update.todo_id);
        } else if update.action == "UPDATE" {
            let _ = guard.update_todo(
                &update.todo_id,
                &update.original_content,
                None,
                None,
            );
            println!("│ [撤销归集] 还原待办内容: {} (ID: {})", update.original_content, update.todo_id);
        }
    }

    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn recategorize_log(
    app: AppHandle,
    db: State<DbState>,
    payload: RecategorizePayload,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 1. 清理原事项关联、待办与事实
    guard.uncategorize_log(
        &payload.log_id,
        payload.old_matter_id.as_deref(),
        payload.old_facts_delta.as_deref(),
    ).map_err(|e| e.to_string())?;

    // 还原原事项受影响的已有待办
    for update in &payload.old_todo_updates {
        if update.action == "CLOSE" {
            let _ = guard.toggle_todo_status(&update.todo_id, false);
        } else if update.action == "UPDATE" {
            let _ = guard.update_todo(
                &update.todo_id,
                &update.original_content,
                None,
                None,
            );
        }
    }

    // 2. 确定新目标事项ID
    let target_matter_id = match payload.choice.as_str() {
        "EXISTING" => payload.new_matter_id.ok_or_else(|| "未指定目标事项ID".to_string())?,
        "CREATE_NEW" => {
            let suggested = payload.new_matter.ok_or_else(|| "未提供新建事项信息".to_string())?;
            let new_id = Uuid::new_v4().to_string();
            let new_matter = Matter {
                id: new_id.clone(),
                title: suggested.title,
                overview: suggested.summary,
                fact_summary: payload.new_facts_delta.clone().unwrap_or_default(),
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
                latest_todo_content: None,
                latest_todo_due_time: None,
                latest_todo_status: None,
                related_contacts: suggested.related_contacts.unwrap_or_default(),
            };
            guard.create_matter(&new_matter).map_err(|e| e.to_string())?;
            new_id
        }
        _ => return Err("未知的调整选项".to_string()),
    };

    // 3. 归集到新事项
    guard.categorize_log(
        &payload.log_id,
        &target_matter_id,
        payload.new_facts_delta.as_deref(),
        &payload.new_todos,
    ).map_err(|e| e.to_string())?;

    let _ = app.emit("refresh-data", ());
    Ok(())
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
    app: AppHandle,
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
    let _ = app.emit("refresh-data", ());
    Ok(todo)
}

#[tauri::command]
pub fn toggle_todo_status(app: AppHandle, db: State<DbState>, id: String, completed: bool) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.toggle_todo_status(&id, completed).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn toggle_todo_focus(app: AppHandle, db: State<DbState>, id: String) -> Result<bool, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let res = guard.toggle_todo_focus(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(res)
}

#[tauri::command]
pub fn update_todo_reminder(
    app: AppHandle,
    db: State<DbState>,
    id: String,
    reminder_time: Option<String>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_todo_reminder(&id, reminder_time).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn update_todo(
    app: AppHandle,
    db: State<DbState>,
    id: String,
    content: String,
    due_time: Option<String>,
    reminder_time: Option<String>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_todo(&id, &content, due_time, reminder_time).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn delete_todo(app: AppHandle, db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_todo(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("refresh-data", ());
    Ok(())
}

// ==================== 配置 Commands ====================

#[tauri::command]
pub fn get_app_config(db: State<DbState>) -> Result<AppConfig, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_config(app: AppHandle, db: State<DbState>, config: AppConfig) -> Result<(), String> {
    // 1. 尝试动态更新全局快捷键
    crate::shortcuts::update_global_shortcuts(&app, &config)?;

    // 2. 快捷键验证与注册成功后，持久化配置
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.save_config(&config).map_err(|e| e.to_string())
}

// ==================== 核心：划选抓取与 AI 智能意图路由 ====================

pub async fn process_captured_context_internal(
    app: &AppHandle,
    db: &State<'_, DbState>,
    captured: &crate::services::clipboard_service::CapturedContext,
) -> Result<AIParseResult, String> {
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let log_id = Uuid::new_v4().to_string();

    // 1. 核心安全保障：划选文本第一时间无条件落库存入收件箱，100% 杜绝丢失
    {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let log = LogItem {
            id: log_id.clone(),
            matter_id: None, // 初始未归集
            raw_content: captured.text.clone(),
            source_app: captured.source_app.clone(),
            source_window_title: captured.source_window.clone(),
            created_at: now.clone(),
        };
        let _ = guard.create_log(&log);
    }
    // 通知收件箱与未归集数字角标有新内容
    let _ = app.emit("refresh-data", ());

    // 2. 读取当前活跃事项与配置，并附带未完成待办
    let (config, active_matters) = {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let config = guard.get_config().map_err(|e| e.to_string())?;
        let matters = guard
            .get_matters(Some("active".to_string()), None, Some("updated".to_string()))
            .map_err(|e| e.to_string())?;
        let mut matters_with_todos = Vec::new();
        for m in matters {
            let todos = guard.get_todos_by_matter(&m.id).unwrap_or_default();
            let pending_todos = todos.into_iter().filter(|t| t.status == "pending").collect();
            matters_with_todos.push(MatterContextWithTodos {
                matter: m,
                pending_todos,
            });
        }
        (config, matters_with_todos)
    };

    // 3. 执行 AI 解析与路由判定
    let mut result = AIService::parse_and_route(
        &config,
        &active_matters,
        &captured.text,
        &captured.source_app,
        &captured.source_window,
    )
    .await;
    result.log_id = Some(log_id.clone());

    // 4. 判断是否达到自动归档阈值 (高置信度且已有明确事项)
    if result.action == "MATCH_EXISTING" && result.confidence >= config.auto_archive_confidence {
        if let Some(ref mid) = result.matched_matter_id {
            println!("│ [自动沉淀] 置信度 {:.2} 达到自动归档阈值 {:.2}，已直接归集入库！", result.confidence, config.auto_archive_confidence);
            let guard = db.lock().map_err(|e| e.to_string())?;
            let _ = guard.categorize_log(
                &log_id,
                mid,
                result.extracted_facts_delta.as_deref(),
                &result.extracted_todos,
            );

            // 自动执行检测到的已有待办更新/关闭建议
            for update in &result.todo_updates {
                if update.action == "CLOSE" {
                    let _ = guard.toggle_todo_status(&update.todo_id, true);
                    println!("│ [自动核销待办] 已完成待办: {} (ID: {})", update.original_content, update.todo_id);
                } else if update.action == "UPDATE" {
                    let _ = guard.update_todo(
                        &update.todo_id,
                        update.updated_content.as_deref().unwrap_or(&update.original_content),
                        update.updated_due_time.clone(),
                        None,
                    );
                    println!("│ [自动更新待办] 已修改待办: {} (ID: {})", update.original_content, update.todo_id);
                }
            }

            // 自动归集入库与待办变更完成，立即广播全局数据刷新！
            let _ = app.emit("refresh-data", ());
        }
    } else if result.action == "MATCH_EXISTING" {
        println!("│ [提示] 虽判定 MATCH_EXISTING 但置信度 {:.2} 低于自动沉淀阈值 {:.2}，等待用户在 HUD 确认", result.confidence, config.auto_archive_confidence);
    }

    Ok(result)
}

#[tauri::command]
pub async fn process_captured_context(
    app: AppHandle,
    db: State<'_, DbState>,
    captured: crate::services::clipboard_service::CapturedContext,
) -> Result<AIParseResult, String> {
    process_captured_context_internal(&app, &db, &captured).await
}

#[tauri::command]
pub async fn trigger_capture_and_analyze(
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<AIParseResult, String> {
    // 安全抓取前台选中文本与窗口元数据
    let captured = ClipboardService::capture_selected_text_safe().await?;
    process_captured_context_internal(&app, &db, &captured).await
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
        let mut matters_with_todos = Vec::new();
        for m in matters {
            let todos = guard.get_todos_by_matter(&m.id).unwrap_or_default();
            let pending_todos = todos.into_iter().filter(|t| t.status == "pending").collect();
            matters_with_todos.push(MatterContextWithTodos {
                matter: m,
                pending_todos,
            });
        }
        (config, matters_with_todos)
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
    app: AppHandle,
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
                related_contacts: None,
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
                latest_todo_content: None,
                latest_todo_due_time: None,
                latest_todo_status: None,
                related_contacts: suggested.related_contacts.unwrap_or_default(),
            };
            guard.create_matter(&new_matter).map_err(|e| e.to_string())?;
            new_id
        }
        "DISCARD" => return Ok(()),
        _ => return Err("未知的决策选项".to_string()),
    };

    // 如果前端传递了 log_id，则对该条既有日志进行归集；若未传递，则新建一条日志
    let log_id = if let Some(ref lid) = payload.log_id {
        lid.clone()
    } else {
        let lid = Uuid::new_v4().to_string();
        let log = LogItem {
            id: lid.clone(),
            matter_id: Some(target_matter_id.clone()),
            raw_content: payload.raw_snippet,
            source_app: payload.source_app,
            source_window_title: payload.source_window,
            created_at: now.clone(),
        };
        guard.create_log(&log).map_err(|e| e.to_string())?;
        lid
    };

    guard.categorize_log(
        &log_id,
        &target_matter_id,
        payload.extracted_facts_delta.as_deref(),
        &payload.extracted_todos,
    ).map_err(|e| e.to_string())?;

    // 执行确认的已有待办更新/关闭建议
    for update in &payload.todo_updates {
        if update.action == "CLOSE" {
            let _ = guard.toggle_todo_status(&update.todo_id, true);
            println!("│ [待办核销] 已完成待办: {} (ID: {})", update.original_content, update.todo_id);
        } else if update.action == "UPDATE" {
            let _ = guard.update_todo(
                &update.todo_id,
                update.updated_content.as_deref().unwrap_or(&update.original_content),
                update.updated_due_time.clone(),
                None,
            );
            println!("│ [待办更新] 已修改待办: {} (ID: {})", update.original_content, update.todo_id);
        }
    }

    let _ = app.emit("refresh-data", ());
    Ok(())
}

#[tauri::command]
pub fn undo_todo_update(
    app: AppHandle,
    db: State<DbState>,
    todo_id: String,
    action: String,
    previous_content: Option<String>,
    previous_due_time: Option<String>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    if action == "CLOSE" {
        guard.toggle_todo_status(&todo_id, false).map_err(|e| e.to_string())?;
        println!("│ [撤销待办操作] 已恢复待办为未完成状态: {}", todo_id);
    } else if action == "UPDATE" {
        if let Some(content) = previous_content {
            guard.update_todo(&todo_id, &content, previous_due_time, None).map_err(|e| e.to_string())?;
            println!("│ [撤销待办操作] 已还原待办内容/时间: {}", todo_id);
        }
    }
    let _ = app.emit("refresh-data", ());
    Ok(())
}

// ==================== 窗口显隐 Commands ====================

#[tauri::command]
pub fn hide_hud_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.hide();
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 360.0, height: 76.0 }));
        crate::shortcuts::position_hud_window_bottom_right(&win);
    }
    Ok(())
}

#[tauri::command]
pub fn resize_hud_window(app: AppHandle, mode: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let (w, h) = match mode.as_str() {
            "capsule" => (360.0, 76.0),
            "expanded" => (380.0, 240.0),
            "reminder" => (380.0, 260.0),
            _ => (360.0, 76.0),
        };
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
        crate::shortcuts::position_hud_window_bottom_right(&win);
    }
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    crate::show_or_create_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn is_autostart_enabled() -> Result<bool, String> {
    Ok(crate::services::autostart_service::AutostartService::is_enabled())
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    crate::services::autostart_service::AutostartService::set_enabled(enabled)
}

#[tauri::command]
pub async fn summarize_matter_facts(
    db: State<'_, DbState>,
    matter_id: String,
) -> Result<String, String> {
    let (config, matter, logs) = {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let config = guard.get_config().map_err(|e| e.to_string())?;
        let matter = guard
            .get_matter_by_id(&matter_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "未找到指定事项".to_string())?;
        let logs = guard.get_logs_by_matter(&matter_id).map_err(|e| e.to_string())?;
        (config, matter, logs)
    };

    let summary = AIService::summarize_matter_facts(
        &config,
        &matter.title,
        &matter.overview,
        &matter.related_contacts,
        &matter.fact_summary,
        &logs,
    )
    .await;

    // 自动持久化更新到数据库中
    {
        let guard = db.lock().map_err(|e| e.to_string())?;
        let mut updated_matter = matter;
        updated_matter.fact_summary = summary.clone();
        guard.update_matter(&updated_matter).map_err(|e| e.to_string())?;
    }

    Ok(summary)
}

// ==================== 缩略模式与贴边停靠/抽拉动画 ====================

// 记录进入缩略模式前的主窗口位置与尺寸 (物理像素)
static SAVED_WINDOW_STATE: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>> =
    Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactDockEdge {
    None,
    Top,
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactDockState {
    pub edge: CompactDockEdge,
    pub is_hidden: bool,
    pub is_locked: bool,
}

static COMPACT_DOCK_STATE: Mutex<CompactDockState> = Mutex::new(CompactDockState {
    edge: CompactDockEdge::None,
    is_hidden: false,
    is_locked: false,
});

// 记录展开状态下的物理坐标 (x, y)，无论拖动到哪，均保持该位置展开
static EXPANDED_PHYSICAL_POS: Mutex<Option<tauri::PhysicalPosition<i32>>> = Mutex::new(None);

pub static IS_COMPACT_MODE: AtomicBool = AtomicBool::new(false);
pub static IS_ANIMATING: AtomicBool = AtomicBool::new(false);
pub static IS_COMPACT_BUSY: AtomicBool = AtomicBool::new(false);

const VISIBLE_MARGIN_PX: i32 = 15; // 收起后露出 15 像素精致边框，指示停靠位置
const EDGE_DOCK_THRESHOLD_PX: i32 = 35; // 贴边吸附判定阈值

/// 获取当前显示器的工作区边界 (left, top, right, bottom)
fn get_monitor_bounds(win: &tauri::WebviewWindow) -> Result<(i32, i32, i32, i32), String> {
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "无法获取当前显示器".to_string())?;

    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let mut bound_left = mon_pos.x;
    let mut bound_top = mon_pos.y;
    let mut bound_right = mon_pos.x + mon_size.width as i32;
    let mut bound_bottom = mon_pos.y + mon_size.height as i32;

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
        };

        let mut work_area = RECT::default();
        let success = unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                Some(&mut work_area as *mut _ as *mut _),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        };

        if success.is_ok() && work_area.right > work_area.left {
            if mon_pos.x == 0 && mon_pos.y == 0 {
                bound_left = work_area.left;
                bound_top = work_area.top;
                bound_right = work_area.right;
                bound_bottom = work_area.bottom;
            }
        }
    }

    Ok((bound_left, bound_top, bound_right, bound_bottom))
}

/// 用户手动拖动主窗口后的实时贴边判定与坐标更新 (完全支持自由拖拽与随处停靠)
pub fn handle_main_window_moved(win: &tauri::WebviewWindow, pos: tauri::PhysicalPosition<i32>) {
    if IS_ANIMATING.load(Ordering::SeqCst) || !IS_COMPACT_MODE.load(Ordering::SeqCst) {
        return;
    }

    if let Ok(guard) = COMPACT_DOCK_STATE.lock() {
        if guard.is_hidden {
            return;
        }
    }

    if let Ok(bounds) = get_monitor_bounds(win) {
        let (bound_left, bound_top, bound_right, _bound_bottom) = bounds;
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize { width: 360, height: 580 });

        let is_top = (pos.y - bound_top).abs() <= EDGE_DOCK_THRESHOLD_PX || pos.y < bound_top;
        let is_left = (pos.x - bound_left).abs() <= EDGE_DOCK_THRESHOLD_PX || pos.x < bound_left;
        let is_right = ((pos.x + size.width as i32) - bound_right).abs() <= EDGE_DOCK_THRESHOLD_PX
            || (pos.x + size.width as i32) > bound_right;

        let edge = if is_top {
            CompactDockEdge::Top
        } else if is_right {
            CompactDockEdge::Right
        } else if is_left {
            CompactDockEdge::Left
        } else {
            CompactDockEdge::None
        };

        let is_locked = if let Ok(guard) = COMPACT_DOCK_STATE.lock() {
            guard.is_locked
        } else {
            false
        };

        let new_state = CompactDockState {
            edge,
            is_hidden: false,
            is_locked,
        };

        if let Ok(mut guard) = COMPACT_DOCK_STATE.lock() {
            *guard = new_state.clone();
        }

        // 核心：记录用户当前拖动停留的位置！
        // 拖到哪就在哪个位置吸附，展开时也精确回到该位置！
        if edge == CompactDockEdge::Top {
            if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
                *exp_pos = Some(tauri::PhysicalPosition { x: pos.x, y: bound_top });
            }
        } else if edge == CompactDockEdge::Right {
            if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
                *exp_pos = Some(tauri::PhysicalPosition { x: bound_right - size.width as i32, y: pos.y });
            }
        } else if edge == CompactDockEdge::Left {
            if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
                *exp_pos = Some(tauri::PhysicalPosition { x: bound_left, y: pos.y });
            }
        } else {
            // 自由悬浮状态，更新记录当前坐标
            if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
                *exp_pos = Some(pos);
            }
        }

        let _ = win.emit("compact-dock-changed", &new_state);
    }
}

/// 窗口位置平滑插值动画 (Ease-Out 二次缓动，丝滑抽拉)
async fn animate_window_position(
    win: &tauri::WebviewWindow,
    start: tauri::PhysicalPosition<i32>,
    target: tauri::PhysicalPosition<i32>,
    steps: usize,
    step_duration_ms: u64,
) {
    if steps <= 1 || (start.x == target.x && start.y == target.y) {
        let _ = win.set_position(tauri::Position::Physical(target));
        return;
    }

    IS_ANIMATING.store(true, Ordering::SeqCst);

    for i in 1..=steps {
        let progress = i as f32 / steps as f32;
        let ease = 1.0 - (1.0 - progress) * (1.0 - progress);
        let curr_x = start.x + (((target.x - start.x) as f32) * ease).round() as i32;
        let curr_y = start.y + (((target.y - start.y) as f32) * ease).round() as i32;

        let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: curr_x,
            y: curr_y,
        }));
        tokio::time::sleep(Duration::from_millis(step_duration_ms)).await;
    }

    let _ = win.set_position(tauri::Position::Physical(target));
    IS_ANIMATING.store(false, Ordering::SeqCst);
}

/// 启动全局后台鼠标探测守护任务 (类似 QQ 边栏停靠：鼠标移入露出的边边即自动下滑展开，移出 400ms 自动收缩)
pub fn start_compact_mouse_monitor(app: AppHandle) {
    #[cfg(windows)]
    tauri::async_runtime::spawn(async move {
        let mut mouse_leave_start: Option<std::time::Instant> = None;

        loop {
            tokio::time::sleep(Duration::from_millis(35)).await;

            if !IS_COMPACT_MODE.load(Ordering::SeqCst) || IS_ANIMATING.load(Ordering::SeqCst) {
                mouse_leave_start = None;
                continue;
            }

            let win = match app.get_webview_window("main") {
                Some(w) => w,
                None => continue,
            };

            let state = match COMPACT_DOCK_STATE.lock() {
                Ok(g) => g.clone(),
                Err(_) => continue,
            };

            // 未贴边吸附（自由悬浮在屏幕中），不执行自动收起/展开
            if state.edge == CompactDockEdge::None {
                mouse_leave_start = None;
                continue;
            }

            let mut pt = POINT::default();
            if unsafe { GetCursorPos(&mut pt) }.is_err() {
                continue;
            }

            let win_pos = match win.outer_position() {
                Ok(p) => p,
                Err(_) => continue,
            };
            let win_size = match win.outer_size() {
                Ok(s) => s,
                Err(_) => continue,
            };
            let bounds = match get_monitor_bounds(&win) {
                Ok(b) => b,
                Err(_) => continue,
            };

            let (bound_left, bound_top, bound_right, _bound_bottom) = bounds;

            if state.is_hidden {
                // 处于收起状态：检测鼠标是否碰到屏幕顶端/边栏露出的那条边边
                let in_edge = match state.edge {
                    CompactDockEdge::Top => {
                        pt.x >= win_pos.x && pt.x <= win_pos.x + win_size.width as i32
                            && pt.y >= bound_top && pt.y <= bound_top + VISIBLE_MARGIN_PX + 6
                    }
                    CompactDockEdge::Right => {
                        pt.x >= bound_right - VISIBLE_MARGIN_PX - 6 && pt.x <= bound_right
                            && pt.y >= win_pos.y && pt.y <= win_pos.y + win_size.height as i32
                    }
                    CompactDockEdge::Left => {
                        pt.x >= bound_left && pt.x <= bound_left + VISIBLE_MARGIN_PX + 6
                            && pt.y >= win_pos.y && pt.y <= win_pos.y + win_size.height as i32
                    }
                    CompactDockEdge::None => false,
                };

                if in_edge {
                    // 鼠标移到了露出的一点点边边！无需点击，自动向下滑出展开！
                    mouse_leave_start = None;
                    let _ = compact_slide_out(app.clone()).await;
                }
            } else {
                // 处于展开状态：检测鼠标是否在窗体内
                let margin_tolerance = 12;
                let inside_win = match state.edge {
                    CompactDockEdge::Top => {
                        pt.x >= win_pos.x - margin_tolerance
                            && pt.x <= win_pos.x + win_size.width as i32 + margin_tolerance
                            && pt.y >= bound_top
                            && pt.y <= win_pos.y + win_size.height as i32 + margin_tolerance
                    }
                    CompactDockEdge::Right => {
                        pt.x >= win_pos.x - margin_tolerance
                            && pt.x <= bound_right
                            && pt.y >= win_pos.y - margin_tolerance
                            && pt.y <= win_pos.y + win_size.height as i32 + margin_tolerance
                    }
                    CompactDockEdge::Left => {
                        pt.x >= bound_left
                            && pt.x <= win_pos.x + win_size.width as i32 + margin_tolerance
                            && pt.y >= win_pos.y - margin_tolerance
                            && pt.y <= win_pos.y + win_size.height as i32 + margin_tolerance
                    }
                    CompactDockEdge::None => true,
                };

                #[cfg(windows)]
                let is_lbutton_down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
                #[cfg(not(windows))]
                let is_lbutton_down = false;

                // 用户鼠标左键正按下（正在拖动或点击窗口），绝不自动收起！
                if is_lbutton_down {
                    mouse_leave_start = None;
                    continue;
                }

                if inside_win {
                    mouse_leave_start = None;
                } else {
                    if state.is_locked || IS_COMPACT_BUSY.load(Ordering::SeqCst) {
                        mouse_leave_start = None;
                    } else {
                        let now = std::time::Instant::now();
                        match mouse_leave_start {
                            None => {
                                mouse_leave_start = Some(now);
                            }
                            Some(start_time) => {
                                if now.duration_since(start_time).as_millis() >= 400 {
                                    // 移出超过 400ms，自动平滑收纳回边栏！
                                    mouse_leave_start = None;
                                    let _ = compact_slide_in(app.clone()).await;
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}

/// 进入缩略模式：缩小为无边框 360x580 便签微窗，吸附至屏幕顶端偏右，常驻置顶
#[tauri::command]
pub async fn enter_compact_mode(app: AppHandle) -> Result<CompactDockState, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    // 1. 保存进入缩略模式前的主窗口位置与大小
    if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
        if let Ok(mut saved) = SAVED_WINDOW_STATE.lock() {
            *saved = Some((pos, size));
        }
    }

    // 2. 去除系统原生标题栏
    let _ = win.set_decorations(false);

    // 3. 调小最小尺寸限制
    let _ = win.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 280.0,
        height: 320.0,
    })));

    // 4. 设置缩略微窗逻辑尺寸 (360x580)
    let target_w = 360.0;
    let target_h = 580.0;
    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: target_w,
        height: target_h,
    }));

    // 5. 定位到当前屏幕右上角并贴近顶边
    let bounds = get_monitor_bounds(&win).unwrap_or((0, 0, 1920, 1080));
    let win_size = win.outer_size().unwrap_or(tauri::PhysicalSize {
        width: 360,
        height: 580,
    });

    let margin_x = 32;
    let x = bounds.2 - (win_size.width as i32) - margin_x;
    let y = bounds.1; // 贴齐顶边

    let init_pos = tauri::PhysicalPosition { x, y };
    let _ = win.set_position(tauri::Position::Physical(init_pos));

    // 6. 缩略模式下常驻置顶
    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let _ = win.set_focus();

    // 7. 贴边状态初始化
    let initial_state = CompactDockState {
        edge: CompactDockEdge::Top,
        is_hidden: false,
        is_locked: false,
    };

    if let Ok(mut state) = COMPACT_DOCK_STATE.lock() {
        *state = initial_state.clone();
    }
    if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
        *exp_pos = Some(init_pos);
    }

    IS_COMPACT_MODE.store(true, Ordering::SeqCst);
    IS_COMPACT_BUSY.store(false, Ordering::SeqCst);

    let _ = win.emit("compact-dock-changed", &initial_state);

    Ok(initial_state)
}

/// 退出缩略模式：恢复进入前的全屏/居中尺寸与位置，恢复系统标题栏，取消置顶
#[tauri::command]
pub async fn exit_compact_mode(app: AppHandle) -> Result<(), String> {
    IS_COMPACT_MODE.store(false, Ordering::SeqCst);

    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let _ = win.set_always_on_top(false);
    let _ = win.set_decorations(true);

    let _ = win.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 800.0,
        height: 600.0,
    })));

    let reset_state = CompactDockState {
        edge: CompactDockEdge::None,
        is_hidden: false,
        is_locked: false,
    };
    if let Ok(mut state) = COMPACT_DOCK_STATE.lock() {
        *state = reset_state.clone();
    }
    if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
        *exp_pos = None;
    }

    let saved_opt = {
        if let Ok(saved) = SAVED_WINDOW_STATE.lock() {
            *saved
        } else {
            None
        }
    };

    if let Some((pos, size)) = saved_opt {
        let _ = win.set_size(tauri::Size::Physical(size));
        let _ = win.set_position(tauri::Position::Physical(pos));
    } else {
        let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 1080.0,
            height: 720.0,
        }));
        let _ = win.center();
    }

    let _ = win.set_focus();
    let _ = win.emit("compact-dock-changed", &reset_state);

    Ok(())
}

/// 收起隐藏：窗口平滑缩入对应屏幕边栏，露出 20px 边框
#[tauri::command]
pub async fn compact_slide_in(app: AppHandle) -> Result<CompactDockState, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let state = {
        let guard = COMPACT_DOCK_STATE.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if state.is_locked || state.edge == CompactDockEdge::None || state.is_hidden {
        return Ok(state);
    }

    let current_pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let bounds = get_monitor_bounds(&win)?;

    // 保存当前用户放置的展开物理坐标
    if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
        *exp_pos = Some(current_pos);
    }

    let (bound_left, bound_top, bound_right, _bound_bottom) = bounds;

    // 在用户当前放置的 X 坐标处，向上缩回收纳，露出底部 VISIBLE_MARGIN_PX
    let target_pos = match state.edge {
        CompactDockEdge::Top => tauri::PhysicalPosition {
            x: current_pos.x,
            y: bound_top - (size.height as i32) + VISIBLE_MARGIN_PX,
        },
        CompactDockEdge::Right => tauri::PhysicalPosition {
            x: bound_right - VISIBLE_MARGIN_PX,
            y: current_pos.y,
        },
        CompactDockEdge::Left => tauri::PhysicalPosition {
            x: bound_left - (size.width as i32) + VISIBLE_MARGIN_PX,
            y: current_pos.y,
        },
        CompactDockEdge::None => current_pos,
    };

    animate_window_position(&win, current_pos, target_pos, 7, 10).await;
    let _ = win.set_always_on_top(true);

    let new_state = CompactDockState {
        edge: state.edge,
        is_hidden: true,
        is_locked: state.is_locked,
    };

    if let Ok(mut guard) = COMPACT_DOCK_STATE.lock() {
        *guard = new_state.clone();
    }

    let _ = win.emit("compact-dock-changed", &new_state);
    Ok(new_state)
}

/// 滑出展开：窗口从屏幕边栏平滑向下滑出，展示完整的缩略模式窗体
#[tauri::command]
pub async fn compact_slide_out(app: AppHandle) -> Result<CompactDockState, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let state = {
        let guard = COMPACT_DOCK_STATE.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if !state.is_hidden || state.edge == CompactDockEdge::None {
        return Ok(state);
    }

    let current_pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let bounds = get_monitor_bounds(&win)?;
    let (bound_left, bound_top, bound_right, _bound_bottom) = bounds;

    let saved_pos = {
        if let Ok(guard) = EXPANDED_PHYSICAL_POS.lock() {
            *guard
        } else {
            None
        }
    };

    let target_pos = match state.edge {
        CompactDockEdge::Top => tauri::PhysicalPosition {
            x: saved_pos.map(|p| p.x).unwrap_or(current_pos.x),
            y: bound_top,
        },
        CompactDockEdge::Right => tauri::PhysicalPosition {
            x: bound_right - (size.width as i32),
            y: saved_pos.map(|p| p.y).unwrap_or(current_pos.y),
        },
        CompactDockEdge::Left => tauri::PhysicalPosition {
            x: bound_left,
            y: saved_pos.map(|p| p.y).unwrap_or(current_pos.y),
        },
        CompactDockEdge::None => current_pos,
    };

    animate_window_position(&win, current_pos, target_pos, 7, 10).await;

    if let Ok(mut exp_pos) = EXPANDED_PHYSICAL_POS.lock() {
        *exp_pos = Some(target_pos);
    }

    let new_state = CompactDockState {
        edge: state.edge,
        is_hidden: false,
        is_locked: state.is_locked,
    };

    if let Ok(mut guard) = COMPACT_DOCK_STATE.lock() {
        *guard = new_state.clone();
    }

    let _ = win.emit("compact-dock-changed", &new_state);
    Ok(new_state)
}

/// 窗口拖拽或移动后重新检测贴边吸附状态
#[tauri::command]
pub fn update_compact_dock_state(app: AppHandle) -> Result<CompactDockState, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    if let Ok(pos) = win.outer_position() {
        handle_main_window_moved(&win, pos);
    }

    let guard = COMPACT_DOCK_STATE.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// 获取当前贴边停靠状态
#[tauri::command]
pub fn get_compact_dock_state() -> Result<CompactDockState, String> {
    let guard = COMPACT_DOCK_STATE.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// 切换是否锁定常驻（防止鼠标移出自动收起）
#[tauri::command]
pub fn toggle_compact_dock_lock(app: AppHandle) -> Result<CompactDockState, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let new_state = {
        let mut guard = COMPACT_DOCK_STATE.lock().map_err(|e| e.to_string())?;
        guard.is_locked = !guard.is_locked;
        guard.clone()
    };

    let _ = win.emit("compact-dock-changed", &new_state);
    Ok(new_state)
}

/// 设置前端是否处于忙碌状态（如打开添加待办输入框，防止自动收起）
#[tauri::command]
pub fn set_compact_busy(busy: bool) -> Result<(), String> {
    IS_COMPACT_BUSY.store(busy, Ordering::SeqCst);
    Ok(())
}

/// 原生窗口拖拽接口 (供前端标题栏 onMouseDown 直接调用，彻底保证无边框窗口拖动 100% 灵敏生效)
#[tauri::command]
pub fn start_dragging_window(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;
    win.start_dragging().map_err(|e| e.to_string())
}
