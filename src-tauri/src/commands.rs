use crate::db::Database;
use crate::models::{
    AIParseResult, AppConfig, CategorizePayload, ExtractedTodo, InboxLogItem, LogItem, Matter,
    MatterContextWithTodos, SuggestedMatter, TodoItem, TodoUpdateSuggestion,
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
    Ok(log)
}

#[tauri::command]
pub fn delete_log(db: State<DbState>, id: String) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_log(&id).map_err(|e| e.to_string())
}

// ==================== AI 收件箱 Commands ====================

#[tauri::command]
pub fn get_inbox_logs(db: State<DbState>) -> Result<Vec<InboxLogItem>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_all_inbox_logs().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn categorize_inbox_log(
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
pub fn update_todo(
    db: State<DbState>,
    id: String,
    content: String,
    due_time: Option<String>,
    reminder_time: Option<String>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.update_todo(&id, &content, due_time, reminder_time).map_err(|e| e.to_string())
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
pub fn save_app_config(app: AppHandle, db: State<DbState>, config: AppConfig) -> Result<(), String> {
    // 1. 尝试动态更新全局快捷键
    crate::shortcuts::update_global_shortcuts(&app, &config)?;

    // 2. 快捷键验证与注册成功后，持久化配置
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.save_config(&config).map_err(|e| e.to_string())
}

// ==================== 核心：划选抓取与 AI 智能意图路由 ====================

pub async fn process_captured_context_internal(
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
        }
    } else if result.action == "MATCH_EXISTING" {
        println!("│ [提示] 虽判定 MATCH_EXISTING 但置信度 {:.2} 低于自动沉淀阈值 {:.2}，等待用户在 HUD 确认", result.confidence, config.auto_archive_confidence);
    }

    Ok(result)
}

#[tauri::command]
pub async fn process_captured_context(
    db: State<'_, DbState>,
    captured: crate::services::clipboard_service::CapturedContext,
) -> Result<AIParseResult, String> {
    process_captured_context_internal(&db, &captured).await
}

#[tauri::command]
pub async fn trigger_capture_and_analyze(
    _app: AppHandle,
    db: State<'_, DbState>,
) -> Result<AIParseResult, String> {
    // 安全抓取前台选中文本与窗口元数据
    let captured = ClipboardService::capture_selected_text_safe().await?;
    process_captured_context_internal(&db, &captured).await
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

    Ok(())
}

#[tauri::command]
pub fn undo_todo_update(
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

// 记录进入缩略模式前的主窗口位置与尺寸 (物理像素)
static SAVED_WINDOW_STATE: Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>> =
    Mutex::new(None);

/// 进入缩略模式：缩小窗口为 360x580，吸附至桌面右上角，并常驻置顶
#[tauri::command]
pub fn enter_compact_mode(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    // 1. 保存进入缩略模式前的窗口位置与大小
    if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
        if let Ok(mut saved) = SAVED_WINDOW_STATE.lock() {
            *saved = Some((pos, size));
        }
    }

    // 2. 调小最小尺寸限制（原默认是 800x600）
    let _ = win.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 280.0,
        height: 320.0,
    })));

    // 3. 设置缩略微窗逻辑尺寸 (360x580)
    let target_w = 360.0;
    let target_h = 580.0;
    let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: target_w,
        height: target_h,
    }));

    // 4. 精准计算工作区，定位到当前屏幕的桌面右上角
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
            let win_size = win.outer_size().unwrap_or(tauri::PhysicalSize {
                width: 360,
                height: 580,
            });
            let margin = 16;
            let x = work_area.right - (win_size.width as i32) - margin;
            let y = work_area.top + margin;
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        } else if let Ok(Some(monitor)) = win.current_monitor() {
            let screen_size = monitor.size();
            let scale = monitor.scale_factor();
            let win_width = (target_w * scale) as i32;
            let margin_x = (16.0 * scale) as i32;
            let margin_y = (16.0 * scale) as i32;
            let x = (screen_size.width as i32) - win_width - margin_x;
            let y = margin_y;
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(Some(monitor)) = win.current_monitor() {
            let screen_size = monitor.size();
            let scale = monitor.scale_factor();
            let win_width = (target_w * scale) as i32;
            let margin_x = (16.0 * scale) as i32;
            let margin_y = (16.0 * scale) as i32;
            let x = (screen_size.width as i32) - win_width - margin_x;
            let y = margin_y;
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
    }

    // 5. 确保窗口非置顶、正常显示与焦点唤醒
    let _ = win.set_always_on_top(false);
    let _ = win.show();
    let _ = win.set_focus();

    Ok(())
}

/// 退出缩略模式：恢复进入前的全屏/居中尺寸与位置，取消常驻置顶
#[tauri::command]
pub fn exit_compact_mode(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    // 1. 取消常驻置顶
    let _ = win.set_always_on_top(false);

    // 2. 恢复原默认最小尺寸限制 (800x600)
    let _ = win.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: 800.0,
        height: 600.0,
    })));

    // 3. 恢复进入缩略模式前保存的窗口尺寸与位置
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

    Ok(())
}
