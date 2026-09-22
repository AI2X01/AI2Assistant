pub mod commands;
pub mod db;
pub mod models;
pub mod services;
pub mod shortcuts;

use commands::*;
use db::Database;
use models::Matter;
use services::reminder_service::ReminderService;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

static IS_QUITTING: AtomicBool = AtomicBool::new(false);

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

            // 2. 配置 HUD 窗口初始位置在右下角（精准避开任务栏并兼容 DPI 缩放）
            if let Some(hud_win) = app.get_webview_window("hud") {
                shortcuts::position_hud_window_bottom_right(&hud_win);
            }

            let window_keys: Vec<_> = app.webview_windows().keys().cloned().collect();
            println!("[AI2Assistant] 已创建的窗口列表: {:?}", window_keys);

            // 确保主窗口显式显示并获取焦点
            if let Some(main_win) = app.get_webview_window("main") {
                println!("[AI2Assistant] 主窗口找到，正在显式调用 show() 与 set_focus()");
                let _ = main_win.show();
                let _ = main_win.set_focus();
            } else {
                eprintln!("[AI2Assistant] 警告: 未能通过 label 'main' 找到主窗口！");
            }

            // 3. 启动本地后台待办定时提醒调度器
            ReminderService::start_scheduler(app.handle().clone(), db_state.clone());

            // 4. 创建系统托盘
            let show_i = MenuItem::with_id(app, "show", "打开主看板", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出应用", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let tray_builder = if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::with_id("main-tray").icon(icon.clone())
            } else {
                TrayIconBuilder::with_id("main-tray")
            };

            let tray = tray_builder
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let id_str = event.id.as_ref();
                    println!("[TrayMenu] 触发托盘菜单项: {}", id_str);
                    match id_str {
                        "show" => {
                            show_or_create_main_window(app);
                        }
                        "quit" => {
                            println!("[TrayMenu] 用户点击退出应用，执行安全退出流程...");
                            IS_QUITTING.store(true, Ordering::SeqCst);
                            app.exit(0);
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        println!("[TrayIcon] 左键点击托盘图标，唤起主窗口");
                        show_or_create_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 极为关键：通过 app.manage 长期持有 tray 实例，防止局部变量在 setup 退出时被 Drop
            app.manage(tray);

            // 5. 注册用户持久化的全局快捷键
            if let Ok(guard) = db_state.lock() {
                if let Ok(config) = guard.get_config() {
                    if let Err(e) = shortcuts::register_global_shortcuts(app.handle(), &config) {
                        eprintln!("初始化注册全局快捷键失败: {}", e);
                    }
                }
            }

            // 6. 默认开启 Windows 开机自启动
            let _ = crate::services::autostart_service::AutostartService::set_enabled(true);

            // 7. 启动桌面缩略模式贴边鼠标感应守护任务 (类似 QQ 边栏停靠自动下滑)
            crate::commands::start_compact_mouse_monitor(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Moved(physical_pos) => {
                    if window.label() == "main" {
                        if let Some(main_webview) = window.get_webview_window("main") {
                            crate::commands::handle_main_window_moved(&main_webview, *physical_pos);
                        }
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        println!("[WindowEvent] 主窗口收到关闭事件，转为隐藏至托盘");
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
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
            update_todo,
            get_app_config,
            save_app_config,
            get_inbox_logs,
            categorize_inbox_log,
            trigger_capture_and_analyze,
            manual_parse_text,
            process_captured_context,
            confirm_route_decision,
            hide_hud_window,
            show_main_window,
            summarize_matter_facts,
            enter_compact_mode,
            exit_compact_mode,
            compact_slide_in,
            compact_slide_out,
            update_compact_dock_state,
            get_compact_dock_state,
            toggle_compact_dock_lock,
            set_compact_busy,
            start_dragging_window,
            undo_todo_update,
            resize_hud_window,
            is_autostart_enabled,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("运行 Tauri 应用程序时发生异常")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if IS_QUITTING.load(Ordering::SeqCst) {
                    println!("[AppRun] 用户请求退出应用，放行退出流程");
                } else {
                    // 阻止非用户主动退出的系统级事件，保持托盘后台常驻
                    api.prevent_exit();
                }
            }
        });
}

/// 显示或重新创建主看板窗口（双保险）
pub fn show_or_create_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        println!("[MainWin] 正在还原并激活主看板窗口...");
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        // 瞬间置顶再恢复，突破 Windows 后台窗口防抢焦限制
        let _ = win.set_always_on_top(true);
        let _ = win.set_always_on_top(false);
    } else {
        println!("[MainWin] main 窗口不存在，正在通过 WebviewWindowBuilder 动态重新拉起...");
        if let Ok(win) = tauri::WebviewWindowBuilder::new(
            app,
            "main",
            tauri::WebviewUrl::App("index.html".into()),
        )
        .title("AI助手 - 个人事项智能整理小助手")
        .inner_size(1080.0, 720.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .build() {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
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
                latest_todo_content: Some("补全白皮书性能指标与基准压测数据".to_string()),
                latest_todo_due_time: Some("2026-09-23 10:00:00".to_string()),
                latest_todo_status: Some("pending".to_string()),
                related_contacts: "A银行项目交付群, 张总, 架构师李工".to_string(),
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
                latest_todo_content: Some("催促两家核心供应商在周五前提交二期红外传感器阶梯报价单".to_string()),
                latest_todo_due_time: Some("2026-09-25 18:00:00".to_string()),
                latest_todo_status: Some("pending".to_string()),
                related_contacts: "二期巡检硬件组, 传感器供应商交流群, Leo".to_string(),
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
                latest_todo_content: Some("周六上午等待师傅上门FTTR光纤布线与测速验收".to_string()),
                latest_todo_due_time: Some("2026-09-26 10:00:00".to_string()),
                latest_todo_status: Some("pending".to_string()),
                related_contacts: "中国联通客户经理, 安装师傅小周, 家庭群".to_string(),
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
