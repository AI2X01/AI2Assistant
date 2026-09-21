use crate::models::{AppConfig, LogItem, Matter, TodoItem};
use chrono::Local;
use rusqlite::{params, Connection, Result};
use std::path::PathBuf;

pub struct Database {
    pub conn: Connection,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(db_path)?;
        let db = Database { conn };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS matters (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                overview TEXT DEFAULT '',
                fact_summary TEXT DEFAULT '',
                category TEXT NOT NULL CHECK(category IN ('work', 'life')),
                priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
                importance INTEGER DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
                status TEXT NOT NULL CHECK(status IN ('active', 'pending', 'completed', 'archived')) DEFAULT 'active',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_matters_status ON matters(status);
            CREATE INDEX IF NOT EXISTS idx_matters_updated ON matters(updated_at DESC);

            CREATE TABLE IF NOT EXISTS logs (
                id TEXT PRIMARY KEY,
                matter_id TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                source_app TEXT DEFAULT '',
                source_window_title TEXT DEFAULT '',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(matter_id) REFERENCES matters(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_logs_matter_id ON logs(matter_id);
            CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);

            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                matter_id TEXT NOT NULL,
                log_id TEXT,
                content TEXT NOT NULL,
                due_time DATETIME,
                reminder_time DATETIME,
                is_reminder_sent INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK(status IN ('pending', 'completed')) DEFAULT 'pending',
                is_focused INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY(matter_id) REFERENCES matters(id) ON DELETE CASCADE,
                FOREIGN KEY(log_id) REFERENCES logs(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
            CREATE INDEX IF NOT EXISTS idx_todos_due ON todos(due_time);

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ",
        )?;
        Ok(())
    }

    // ==================== Matter 操作 ====================

    pub fn get_matters(&self, status_filter: Option<String>, category_filter: Option<String>, sort_by: Option<String>) -> Result<Vec<Matter>> {
        let mut sql = String::from(
            "SELECT m.id, m.title, m.overview, m.fact_summary, m.category, m.priority, m.importance, 
                    m.status, m.is_pinned, m.created_at, m.updated_at,
                    (SELECT COUNT(*) FROM todos t WHERE t.matter_id = m.id AND t.status = 'pending') as pending_count,
                    (SELECT COUNT(*) FROM todos t WHERE t.matter_id = m.id) as total_count,
                    (SELECT l.raw_content FROM logs l WHERE l.matter_id = m.id ORDER BY l.created_at DESC LIMIT 1) as latest_log,
                    (SELECT l.created_at FROM logs l WHERE l.matter_id = m.id ORDER BY l.created_at DESC LIMIT 1) as latest_log_time
             FROM matters m WHERE 1=1"
        );

        let mut conditions = Vec::new();
        if let Some(ref st) = status_filter {
            if st != "all" {
                conditions.push(format!("m.status = '{}'", st));
            }
        }
        if let Some(ref cat) = category_filter {
            if cat != "all" {
                conditions.push(format!("m.category = '{}'", cat));
            }
        }

        for c in conditions {
            sql.push_str(" AND ");
            sql.push_str(&c);
        }

        let order_clause = match sort_by.as_deref() {
            Some("priority") => "m.is_pinned DESC, CASE m.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, m.updated_at DESC",
            Some("importance") => "m.is_pinned DESC, m.importance DESC, m.updated_at DESC",
            Some("created") => "m.is_pinned DESC, m.created_at DESC",
            _ => "m.is_pinned DESC, m.updated_at DESC",
        };

        sql.push_str(" ORDER BY ");
        sql.push_str(order_clause);

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let is_pinned_int: i32 = row.get(8)?;
            Ok(Matter {
                id: row.get(0)?,
                title: row.get(1)?,
                overview: row.get(2)?,
                fact_summary: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                importance: row.get(6)?,
                status: row.get(7)?,
                is_pinned: is_pinned_int == 1,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                pending_todos_count: row.get(11)?,
                total_todos_count: row.get(12)?,
                latest_log_snippet: row.get(13)?,
                latest_log_time: row.get(14)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_matter_by_id(&self, id: &str) -> Result<Option<Matter>> {
        let sql = "SELECT m.id, m.title, m.overview, m.fact_summary, m.category, m.priority, m.importance, 
                          m.status, m.is_pinned, m.created_at, m.updated_at,
                          (SELECT COUNT(*) FROM todos t WHERE t.matter_id = m.id AND t.status = 'pending') as pending_count,
                          (SELECT COUNT(*) FROM todos t WHERE t.matter_id = m.id) as total_count,
                          (SELECT l.raw_content FROM logs l WHERE l.matter_id = m.id ORDER BY l.created_at DESC LIMIT 1) as latest_log,
                          (SELECT l.created_at FROM logs l WHERE l.matter_id = m.id ORDER BY l.created_at DESC LIMIT 1) as latest_log_time
                   FROM matters m WHERE m.id = ?1";
        let mut stmt = self.conn.prepare(sql)?;
        let mut rows = stmt.query_map([id], |row| {
            let is_pinned_int: i32 = row.get(8)?;
            Ok(Matter {
                id: row.get(0)?,
                title: row.get(1)?,
                overview: row.get(2)?,
                fact_summary: row.get(3)?,
                category: row.get(4)?,
                priority: row.get(5)?,
                importance: row.get(6)?,
                status: row.get(7)?,
                is_pinned: is_pinned_int == 1,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                pending_todos_count: row.get(11)?,
                total_todos_count: row.get(12)?,
                latest_log_snippet: row.get(13)?,
                latest_log_time: row.get(14)?,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn create_matter(&self, matter: &Matter) -> Result<()> {
        self.conn.execute(
            "INSERT INTO matters (id, title, overview, fact_summary, category, priority, importance, status, is_pinned, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                matter.id,
                matter.title,
                matter.overview,
                matter.fact_summary,
                matter.category,
                matter.priority,
                matter.importance,
                matter.status,
                if matter.is_pinned { 1 } else { 0 },
                matter.created_at,
                matter.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_matter(&self, matter: &Matter) -> Result<()> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "UPDATE matters SET title = ?1, overview = ?2, fact_summary = ?3, category = ?4, priority = ?5, importance = ?6, updated_at = ?7
             WHERE id = ?8",
            params![
                matter.title,
                matter.overview,
                matter.fact_summary,
                matter.category,
                matter.priority,
                matter.importance,
                now,
                matter.id,
            ],
        )?;
        Ok(())
    }

    pub fn update_matter_status(&self, id: &str, status: &str) -> Result<()> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "UPDATE matters SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, id],
        )?;
        Ok(())
    }

    pub fn toggle_matter_pinned(&self, id: &str) -> Result<bool> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "UPDATE matters SET is_pinned = 1 - is_pinned, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        let mut stmt = self.conn.prepare("SELECT is_pinned FROM matters WHERE id = ?1")?;
        let is_pinned: i32 = stmt.query_row([id], |row| row.get(0))?;
        Ok(is_pinned == 1)
    }

    pub fn delete_matter(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM matters WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn touch_matter_updated(&self, id: &str) -> Result<()> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        self.conn.execute(
            "UPDATE matters SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    // ==================== Log 操作 ====================

    pub fn get_logs_by_matter(&self, matter_id: &str) -> Result<Vec<LogItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, matter_id, raw_content, source_app, source_window_title, created_at
             FROM logs WHERE matter_id = ?1 ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([matter_id], |row| {
            Ok(LogItem {
                id: row.get(0)?,
                matter_id: row.get(1)?,
                raw_content: row.get(2)?,
                source_app: row.get(3)?,
                source_window_title: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn create_log(&self, log: &LogItem) -> Result<()> {
        self.conn.execute(
            "INSERT INTO logs (id, matter_id, raw_content, source_app, source_window_title, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                log.id,
                log.matter_id,
                log.raw_content,
                log.source_app,
                log.source_window_title,
                log.created_at,
            ],
        )?;
        self.touch_matter_updated(&log.matter_id)?;
        Ok(())
    }

    pub fn delete_log(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM logs WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ==================== Todo 操作 ====================

    pub fn get_todos_by_matter(&self, matter_id: &str) -> Result<Vec<TodoItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.matter_id, t.log_id, t.content, t.due_time, t.reminder_time, 
                    t.is_reminder_sent, t.status, t.is_focused, t.created_at, t.completed_at, m.title
             FROM todos t
             LEFT JOIN matters m ON t.matter_id = m.id
             WHERE t.matter_id = ?1
             ORDER BY t.is_focused DESC, t.status ASC, t.due_time ASC"
        )?;
        let rows = stmt.query_map([matter_id], |row| {
            let is_reminder_sent: i32 = row.get(6)?;
            let is_focused: i32 = row.get(8)?;
            Ok(TodoItem {
                id: row.get(0)?,
                matter_id: row.get(1)?,
                log_id: row.get(2)?,
                content: row.get(3)?,
                due_time: row.get(4)?,
                reminder_time: row.get(5)?,
                is_reminder_sent: is_reminder_sent == 1,
                status: row.get(7)?,
                is_focused: is_focused == 1,
                created_at: row.get(9)?,
                completed_at: row.get(10)?,
                matter_title: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_all_todos(&self, status_filter: Option<String>) -> Result<Vec<TodoItem>> {
        let mut sql = String::from(
            "SELECT t.id, t.matter_id, t.log_id, t.content, t.due_time, t.reminder_time, 
                    t.is_reminder_sent, t.status, t.is_focused, t.created_at, t.completed_at, m.title
             FROM todos t
             LEFT JOIN matters m ON t.matter_id = m.id
             WHERE 1=1"
        );

        if let Some(ref st) = status_filter {
            if st != "all" {
                sql.push_str(&format!(" AND t.status = '{}'", st));
            }
        }

        sql.push_str(" ORDER BY t.is_focused DESC, t.status ASC, CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END, t.due_time ASC, t.created_at DESC");

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let is_reminder_sent: i32 = row.get(6)?;
            let is_focused: i32 = row.get(8)?;
            Ok(TodoItem {
                id: row.get(0)?,
                matter_id: row.get(1)?,
                log_id: row.get(2)?,
                content: row.get(3)?,
                due_time: row.get(4)?,
                reminder_time: row.get(5)?,
                is_reminder_sent: is_reminder_sent == 1,
                status: row.get(7)?,
                is_focused: is_focused == 1,
                created_at: row.get(9)?,
                completed_at: row.get(10)?,
                matter_title: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn create_todo(&self, todo: &TodoItem) -> Result<()> {
        self.conn.execute(
            "INSERT INTO todos (id, matter_id, log_id, content, due_time, reminder_time, is_reminder_sent, status, is_focused, created_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                todo.id,
                todo.matter_id,
                todo.log_id,
                todo.content,
                todo.due_time,
                todo.reminder_time,
                if todo.is_reminder_sent { 1 } else { 0 },
                todo.status,
                if todo.is_focused { 1 } else { 0 },
                todo.created_at,
                todo.completed_at,
            ],
        )?;
        self.touch_matter_updated(&todo.matter_id)?;
        Ok(())
    }

    pub fn toggle_todo_status(&self, id: &str, completed: bool) -> Result<()> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        if completed {
            self.conn.execute(
                "UPDATE todos SET status = 'completed', completed_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;
        } else {
            self.conn.execute(
                "UPDATE todos SET status = 'pending', completed_at = NULL WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(())
    }

    pub fn toggle_todo_focus(&self, id: &str) -> Result<bool> {
        self.conn.execute(
            "UPDATE todos SET is_focused = 1 - is_focused WHERE id = ?1",
            params![id],
        )?;
        let mut stmt = self.conn.prepare("SELECT is_focused FROM todos WHERE id = ?1")?;
        let is_focused: i32 = stmt.query_row([id], |row| row.get(0))?;
        Ok(is_focused == 1)
    }

    pub fn update_todo_reminder(&self, id: &str, reminder_time: Option<String>) -> Result<()> {
        self.conn.execute(
            "UPDATE todos SET reminder_time = ?1, is_reminder_sent = 0 WHERE id = ?2",
            params![reminder_time, id],
        )?;
        Ok(())
    }

    pub fn delete_todo(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM todos WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_due_reminders(&self) -> Result<Vec<TodoItem>> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.matter_id, t.log_id, t.content, t.due_time, t.reminder_time, 
                    t.is_reminder_sent, t.status, t.is_focused, t.created_at, t.completed_at, m.title
             FROM todos t
             LEFT JOIN matters m ON t.matter_id = m.id
             WHERE t.status = 'pending' 
               AND t.reminder_time IS NOT NULL 
               AND t.reminder_time <= ?1 
               AND t.is_reminder_sent = 0"
        )?;
        let rows = stmt.query_map([now], |row| {
            let is_reminder_sent: i32 = row.get(6)?;
            let is_focused: i32 = row.get(8)?;
            Ok(TodoItem {
                id: row.get(0)?,
                matter_id: row.get(1)?,
                log_id: row.get(2)?,
                content: row.get(3)?,
                due_time: row.get(4)?,
                reminder_time: row.get(5)?,
                is_reminder_sent: is_reminder_sent == 1,
                status: row.get(7)?,
                is_focused: is_focused == 1,
                created_at: row.get(9)?,
                completed_at: row.get(10)?,
                matter_title: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn mark_reminder_sent(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE todos SET is_reminder_sent = 1 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    // ==================== App Settings 配置 ====================

    pub fn get_config(&self) -> Result<AppConfig> {
        let mut config = AppConfig::default();
        let mut stmt = self.conn.prepare("SELECT key, value FROM app_settings")?;
        let rows = stmt.query_map([], |row| {
            let k: String = row.get(0)?;
            let v: String = row.get(1)?;
            Ok((k, v))
        })?;

        for r in rows {
            let (k, v) = r?;
            match k.as_str() {
                "api_base_url" => config.api_base_url = v,
                "api_key" => config.api_key = v,
                "model_name" => config.model_name = v,
                "capture_shortcut" => config.capture_shortcut = v,
                "main_window_shortcut" => config.main_window_shortcut = v,
                "auto_archive_confidence" => {
                    if let Ok(c) = v.parse::<f64>() {
                        config.auto_archive_confidence = c;
                    }
                }
                _ => {}
            }
        }
        Ok(config)
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<()> {
        let pairs = [
            ("api_base_url", config.api_base_url.clone()),
            ("api_key", config.api_key.clone()),
            ("model_name", config.model_name.clone()),
            ("capture_shortcut", config.capture_shortcut.clone()),
            ("main_window_shortcut", config.main_window_shortcut.clone()),
            ("auto_archive_confidence", config.auto_archive_confidence.to_string()),
        ];

        for (k, v) in pairs {
            self.conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
                params![k, v],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Database {
        // 使用内存数据库进行极速测试
        let conn = Connection::open_in_memory().unwrap();
        let db = Database { conn };
        db.init_tables().unwrap();
        db
    }

    #[test]
    fn test_matter_crud_and_status() {
        let db = setup_test_db();
        let matter = Matter {
            id: "m_test_1".to_string(),
            title: "测试事项标题".to_string(),
            overview: "测试概述".to_string(),
            fact_summary: "• 关键事实".to_string(),
            category: "work".to_string(),
            priority: "high".to_string(),
            importance: 4,
            status: "active".to_string(),
            is_pinned: false,
            created_at: "2026-09-21 00:00:00".to_string(),
            updated_at: "2026-09-21 00:00:00".to_string(),
            pending_todos_count: 0,
            total_todos_count: 0,
            latest_log_snippet: None,
            latest_log_time: None,
        };

        // 创建
        db.create_matter(&matter).unwrap();

        // 读取
        let loaded = db.get_matter_by_id("m_test_1").unwrap().expect("应找到事项");
        assert_eq!(loaded.title, "测试事项标题");
        assert_eq!(loaded.status, "active");

        // 置顶切换
        let is_pinned = db.toggle_matter_pinned("m_test_1").unwrap();
        assert!(is_pinned);

        // 归档流转
        db.update_matter_status("m_test_1", "archived").unwrap();
        let loaded_archived = db.get_matter_by_id("m_test_1").unwrap().unwrap();
        assert_eq!(loaded_archived.status, "archived");

        // 过滤查询
        let active_list = db.get_matters(Some("active".to_string()), None, None).unwrap();
        assert!(active_list.is_empty());

        let archived_list = db.get_matters(Some("archived".to_string()), None, None).unwrap();
        assert_eq!(archived_list.len(), 1);
    }

    #[test]
    fn test_log_and_todo_lifecycle() {
        let db = setup_test_db();
        let matter = Matter {
            id: "m_test_2".to_string(),
            title: "日志与待办测试事项".to_string(),
            overview: "".to_string(),
            fact_summary: "".to_string(),
            category: "life".to_string(),
            priority: "medium".to_string(),
            importance: 3,
            status: "active".to_string(),
            is_pinned: false,
            created_at: "2026-09-21 00:00:00".to_string(),
            updated_at: "2026-09-21 00:00:00".to_string(),
            pending_todos_count: 0,
            total_todos_count: 0,
            latest_log_snippet: None,
            latest_log_time: None,
        };
        db.create_matter(&matter).unwrap();

        // 插入日志
        let log = LogItem {
            id: "l_test_1".to_string(),
            matter_id: "m_test_2".to_string(),
            raw_content: "收到微信通知：明天下午准备去超市采购。".to_string(),
            source_app: "微信".to_string(),
            source_window_title: "家庭群".to_string(),
            created_at: "2026-09-21 00:01:00".to_string(),
        };
        db.create_log(&log).unwrap();

        let logs = db.get_logs_by_matter("m_test_2").unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].source_app, "微信");

        // 插入待办
        let todo = TodoItem {
            id: "t_test_1".to_string(),
            matter_id: "m_test_2".to_string(),
            log_id: Some("l_test_1".to_string()),
            content: "去超市采购生鲜".to_string(),
            due_time: Some("2026-09-22 18:00:00".to_string()),
            reminder_time: Some("2026-09-22 17:30:00".to_string()),
            is_reminder_sent: false,
            status: "pending".to_string(),
            is_focused: false,
            created_at: "2026-09-21 00:02:00".to_string(),
            completed_at: None,
            matter_title: None,
        };
        db.create_todo(&todo).unwrap();

        // 查询待办
        let todos = db.get_todos_by_matter("m_test_2").unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].status, "pending");

        // 勾选完成
        db.toggle_todo_status("t_test_1", true).unwrap();
        let todos_after = db.get_todos_by_matter("m_test_2").unwrap();
        assert_eq!(todos_after[0].status, "completed");
        assert!(todos_after[0].completed_at.is_some());
    }

    #[test]
    fn test_app_config_persistence() {
        let db = setup_test_db();
        let custom_config = AppConfig {
            api_base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: "sk-test123456".to_string(),
            model_name: "deepseek-chat".to_string(),
            capture_shortcut: "Alt+X".to_string(),
            main_window_shortcut: "Alt+Space".to_string(),
            auto_archive_confidence: 0.85,
        };

        db.save_config(&custom_config).unwrap();
        let loaded = db.get_config().unwrap();

        assert_eq!(loaded.api_base_url, "https://api.deepseek.com/v1");
        assert_eq!(loaded.api_key, "sk-test123456");
        assert_eq!(loaded.model_name, "deepseek-chat");
        assert_eq!(loaded.capture_shortcut, "Alt+X");
        assert_eq!(loaded.auto_archive_confidence, 0.85);
    }
}
