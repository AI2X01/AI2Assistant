use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Matter {
    pub id: String,
    pub title: String,
    pub overview: String,
    pub fact_summary: String,
    pub category: String,   // "work" | "life"
    pub priority: String,   // "high" | "medium" | "low"
    pub importance: i32,    // 1 - 5
    pub status: String,     // "active" | "pending" | "completed" | "archived"
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
    // 扩展前端统计字段
    #[serde(default)]
    pub pending_todos_count: i32,
    #[serde(default)]
    pub total_todos_count: i32,
    #[serde(default)]
    pub latest_log_snippet: Option<String>,
    #[serde(default)]
    pub latest_log_time: Option<String>,
    #[serde(default)]
    pub latest_todo_content: Option<String>,
    #[serde(default)]
    pub latest_todo_due_time: Option<String>,
    #[serde(default)]
    pub latest_todo_status: Option<String>,
    #[serde(default)]
    pub related_contacts: String, // 关联人/群配置，如 "潮汕话标注群, 陈伟豪, 李总"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogItem {
    pub id: String,
    pub matter_id: Option<String>,
    pub raw_content: String,
    pub source_app: String,
    pub source_window_title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxLogItem {
    pub id: String,
    pub matter_id: Option<String>,
    pub matter_title: Option<String>,
    pub raw_content: String,
    pub source_app: String,
    pub source_window_title: String,
    pub created_at: String,
    #[serde(default)]
    pub todos: Vec<TodoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    pub matter_id: String,
    pub log_id: Option<String>,
    pub content: String,
    pub due_time: Option<String>,
    pub reminder_time: Option<String>,
    pub is_reminder_sent: bool,
    pub status: String, // "pending" | "completed"
    pub is_focused: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    #[serde(default)]
    pub matter_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatterContextWithTodos {
    pub matter: Matter,
    pub pending_todos: Vec<TodoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub api_base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub capture_shortcut: String,
    pub main_window_shortcut: String,
    pub auto_archive_confidence: f64,
    #[serde(default)]
    pub user_profile: String, // 个人情况配置，如角色身份、负责语种与项目、主要对接人与团队成员等
    #[serde(default = "default_theme")]
    pub theme: String, // "light" | "dark" | "system"
}

fn default_theme() -> String {
    "system".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_base_url: "https://api.openai.com/v1".to_string(),
            api_key: "".to_string(),
            model_name: "gpt-4o-mini".to_string(),
            capture_shortcut: "Alt+A".to_string(),
            main_window_shortcut: "Alt+Shift+Space".to_string(),
            auto_archive_confidence: 0.8,
            user_profile: "我是项目负责人兼质检主管，负责多语种与方言数据标注质检项目。常见团队与对接人包括张总、Leo、陈伟豪、李棠佳等。".to_string(),
            theme: "system".to_string(),
        }
    }
}

// AI 解析出参数据协议
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedTodo {
    pub content: String,
    pub due_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedMatter {
    pub title: String,
    pub category: String,
    pub priority: String,
    pub summary: String,
    #[serde(default)]
    pub related_contacts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateMatter {
    pub id: String,
    pub title: String,
    pub confidence: f64,
}

// 待办更新/关闭建议协议
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoUpdateSuggestion {
    pub todo_id: String,
    pub original_content: String,
    pub action: String, // "CLOSE" (完成/关闭) | "UPDATE" (更新文本/截止时间)
    pub reason: String, // 判定理由，例如 "日志表明南非荷兰语已返修提交"
    #[serde(default)]
    pub updated_content: Option<String>,
    #[serde(default)]
    pub updated_due_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIParseResult {
    pub action: String, // "MATCH_EXISTING" | "AMBIGUOUS" | "CREATE_NEW" | "IGNORE"
    pub confidence: f64,
    pub matched_matter_id: Option<String>,
    pub matched_matter_title: Option<String>,
    pub candidate_matters: Vec<CandidateMatter>,
    pub suggested_new_matter: Option<SuggestedMatter>,
    pub extracted_facts_delta: Option<String>,
    pub extracted_todos: Vec<ExtractedTodo>,
    #[serde(default)]
    pub todo_updates: Vec<TodoUpdateSuggestion>,
    pub raw_snippet: String,
    pub source_app: String,
    pub source_window: String,
    #[serde(default)]
    pub log_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategorizePayload {
    pub log_id: String,
    pub choice: String, // "EXISTING" | "CREATE_NEW"
    pub matter_id: Option<String>,
    pub new_matter: Option<SuggestedMatter>,
    pub extracted_facts_delta: Option<String>,
    #[serde(default)]
    pub new_todos: Vec<ExtractedTodo>,
    #[serde(default)]
    pub todo_updates: Vec<TodoUpdateSuggestion>,
}
