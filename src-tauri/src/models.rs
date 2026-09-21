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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogItem {
    pub id: String,
    pub matter_id: String,
    pub raw_content: String,
    pub source_app: String,
    pub source_window_title: String,
    pub created_at: String,
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
pub struct AppConfig {
    pub api_base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub capture_shortcut: String,
    pub main_window_shortcut: String,
    pub auto_archive_confidence: f64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateMatter {
    pub id: String,
    pub title: String,
    pub confidence: f64,
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
    pub raw_snippet: String,
    pub source_app: String,
    pub source_window: String,
}
