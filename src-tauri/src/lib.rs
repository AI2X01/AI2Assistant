pub mod commands;
pub mod db;
pub mod models;
pub mod services;

use commands::*;
use db::Database;
use models::Matter;
use services::reminder_service::ReminderService;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Position, PhysicalPosition};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // 1. 初始化数据库存储路径
            let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let db_file = app_data_dir.join("ai2assistant.db");
            let database = Database::new(db_file).expect("初始化本地 SQLite 数据库失败");

            // 预置种子演示数据（若首次启动）
            init_seed_data_if_empty(&database);

            let db_state = Arc::new(Mutex::new(database));
            app.manage(db_state.clone());

            // 2. 配置 HUD 窗口初始位置在右下角
            if let Some(hud_win) = app.get_webview_window("hud") {
                if let Ok(Some(monitor)) = hud_win.current_monitor() {
                    let screen_size = monitor.size();
                    let x = (screen_size.width as i32) - 400;
                    let y = (screen_size.height as i32) - 260;
                    let _ = hud_win.set_position(Position::Physical(PhysicalPosition { x, y }));
                }
            }

            // 3. 启动本地后台待办定时提醒调度器
            ReminderService::start_scheduler(app.handle().clone(), db_state.clone());

            // 4. 创建系统托盘
            let quit_i = MenuItem::with_id(app, "quit", "退出 AI2Assistant", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "打开主看板", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // 5. 注册全局快捷键
            let app_handle = app.handle().clone();
            // 尝试注册默认 Alt+A 快捷键
            if let Ok(shortcut) = "Alt+A".parse::<Shortcut>() {
                let _ = app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let handle = app_handle.clone();
                    tokio::spawn(async move {
                        // 通知前端或直接执行捕获
                        if let Some(hud_win) = handle.get_webview_window("hud") {
                            let _ = hud_win.show();
                            let _ = hud_win.set_always_on_top(true);
                            let _ = hud_win.emit("start-auto-capture", ());
                        }
                    });
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_matters,
            get_matter_by_id,
            create_matter,
            update_matter,
            update_matter_status,
            toggle_matter_pinned,
            delete_matter,
            get_logs_by_matter,
            create_log,
            delete_log,
            get_todos_by_matter,
            get_all_todos,
            create_todo,
            toggle_todo_status,
            toggle_todo_focus,
            update_todo_reminder,
            delete_todo,
            get_app_config,
            save_app_config,
            trigger_capture_and_analyze,
            manual_parse_text,
            confirm_route_decision,
            hide_hud_window,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用程序时发生异常");
}

fn init_seed_data_if_empty(db: &Database) {
    if let Ok(matters) = db.get_matters(None, None, None) {
        if matters.is_empty() {
            let m1 = Matter {
                id: "m_001".to_string(),
                title: "A银行系统技术架构白皮书交付".to_string(),
                overview: "面向A银行核心业务系统升级重构的技术白皮书，包含性能基准与高可用设计。".to_string(),
                fact_summary: "• 商务约束: 本周提交审定版本\n• 性能指标: TPS必须大于5000，P99延迟低于50ms\n• 关键对接人: 客户侧张总，架构师李工".to_string(),
                category: "work".to_string(),
                priority: "high".to_string(),
                importance: 5,
                status: "active".to_string(),
                is_pinned: true,
                created_at: "2026-09-20 10:00:00".to_string(),
                updated_at: "2026-09-20 23:10:00".to_string(),
                pending_todos_count: 2,
                total_todos_count: 3,
                latest_log_snippet: Some("张总在微信群强调周三上午10点前提交白皮书终版".to_string()),
                latest_log_time: Some("2026-09-20 23:10:00".to_string()),
            };
            let _ = db.create_matter(&m1);

            let m2 = Matter {
                id: "m_002".to_string(),
                title: "智能巡检系统二期传感器供应链评估".to_string(),
                overview: "调研二期高精度红外与振动传感器供应商报价及交期周期。".to_string(),
                fact_summary: "• 第一期硬件打样已通过高低温测试\n• 待供应商提供第二批次阶梯报价单".to_string(),
                category: "work".to_string(),
                priority: "medium".to_string(),
                importance: 4,
                status: "active".to_string(),
                is_pinned: false,
                created_at: "2026-09-18 14:00:00".to_string(),
                updated_at: "2026-09-19 16:30:00".to_string(),
                pending_todos_count: 1,
                total_todos_count: 1,
                latest_log_snippet: Some("企微收到供应商技术选型参数手册".to_string()),
                latest_log_time: Some("2026-09-19 16:30:00".to_string()),
            };
            let _ = db.create_matter(&m2);

            let m3 = Matter {
                id: "m_003".to_string(),
                title: "家庭宽带光纤升兆与网络拓扑升级".to_string(),
                overview: "联系运营商完成FTTR全光纤入室改造与NAS局域网万兆升级。".to_string(),
                fact_summary: "• 已预约下周六上午师傅上门测速".to_string(),
                category: "life".to_string(),
                priority: "low".to_string(),
                importance: 2,
                status: "active".to_string(),
                is_pinned: false,
                created_at: "2026-09-17 09:00:00".to_string(),
                updated_at: "2026-09-18 11:20:00".to_string(),
                pending_todos_count: 1,
                total_todos_count: 1,
                latest_log_snippet: Some("联通短信通知套餐升级已生效".to_string()),
                latest_log_time: Some("2026-09-18 11:20:00".to_string()),
            };
            let _ = db.create_matter(&m3);

            // 预置待办
            use crate::models::TodoItem;
            let _ = db.create_todo(&TodoItem {
                id: "t_001".to_string(),
                matter_id: "m_001".to_string(),
                log_id: None,
                content: "补全白皮书性能指标与基准压测数据".to_string(),
                due_time: Some("2026-09-23 10:00:00".to_string()),
                reminder_time: Some("2026-09-23 09:30:00".to_string()),
                is_reminder_sent: false,
                status: "pending".to_string(),
                is_focused: true,
                created_at: "2026-09-20 23:10:00".to_string(),
                completed_at: None,
                matter_title: Some("A银行系统技术架构白皮书交付".to_string()),
            });

            let _ = db.create_todo(&TodoItem {
                id: "t_002".to_string(),
                matter_id: "m_001".to_string(),
                log_id: None,
                content: "向张总邮件发送技术架构正式审定版".to_string(),
                due_time: Some("2026-09-23 17:00:00".to_string()),
                reminder_time: Some("2026-09-23 16:30:00".to_string()),
                is_reminder_sent: false,
                status: "pending".to_string(),
                is_focused: false,
                created_at: "2026-09-20 23:10:00".to_string(),
                completed_at: None,
                matter_title: Some("A银行系统技术架构白皮书交付".to_string()),
            });
        }
    }
}
