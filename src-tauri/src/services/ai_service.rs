use crate::models::{
    AIParseResult, AppConfig, CandidateMatter, ExtractedTodo, Matter, SuggestedMatter,
};
use chrono::{Duration, Local};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration as StdDuration;

pub struct AIService;

impl AIService {
    pub async fn parse_and_route(
        config: &AppConfig,
        active_matters: &[Matter],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> AIParseResult {
        // 如果未配置 API Key，或者使用本地快速规则模式，走离线规则引擎
        if config.api_key.trim().is_empty() {
            return Self::local_fallback_parser(active_matters, snippet, source_app, source_window);
        }

        match Self::call_llm_api(config, active_matters, snippet, source_app, source_window).await {
            Ok(result) => result,
            Err(e) => {
                eprintln!("[AIService] LLM 调用失败或超时: {}, 启用规则引擎降级", e);
                Self::local_fallback_parser(active_matters, snippet, source_app, source_window)
            }
        }
    }

    async fn call_llm_api(
        config: &AppConfig,
        active_matters: &[Matter],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> Result<AIParseResult, String> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;

        let now = Local::now();
        let current_time_str = now.format("%Y-%m-%d %H:%M:%S (%A)").to_string();

        let matters_context: Vec<Value> = active_matters
            .iter()
            .map(|m| {
                json!({
                    "id": m.id,
                    "title": m.title,
                    "fact_summary": m.fact_summary,
                    "category": m.category
                })
            })
            .collect();

        let system_prompt = format!(
            r#"你是一个高度严谨的桌面个人事务与AI伴侣引擎。
当前系统标准基准时间是: {current_time_str}。
请分析用户从外部应用抓取到的一段文本碎片，判断其属于现有进行中事项、还是建议创建全新事项、或多重模糊。
必须严格输出纯 JSON 对象，格式如下：
{{
  "action": "MATCH_EXISTING" | "AMBIGUOUS" | "CREATE_NEW" | "IGNORE",
  "confidence": 0.0到1.0的浮点数,
  "matched_matter_id": "如果明确匹配到某个进行中事项，填写其ID，否则为 null",
  "candidate_matters": [
    {{ "id": "事项ID", "title": "事项标题", "confidence": 0.65 }}
  ],
  "suggested_new_matter": {{
    "title": "根据文本提炼的事项简练标题",
    "category": "work" 或 "life",
    "priority": "high" | "medium" | "low",
    "summary": "事项总体概述"
  }} 或 null,
  "extracted_facts_delta": "从该碎片信息中提取出的客观关键事实（如商务、财务、进度共识、参数约束），无新事实则为 null",
  "extracted_todos": [
    {{
      "content": "具体的行动项待办内容",
      "due_time": "换算后的绝对时间 YYYY-MM-DD HH:MM:SS，如果文本未提及明确时间则为 null"
    }}
  ]
}}
注意：
1. 相对时间换算必须以给定的当前时间为基准，例如'明天'即是当前日期的下一天，'周三'指紧接着的周三。
2. 只有置信度大于等于0.75且明显针对已有事项时才返回 MATCH_EXISTING。
3. 如果与2个以上事项存在相似度但都不确定，返回 AMBIGUOUS，并在 candidate_matters 列出。
4. 如果是全新的项目、任务或生活安排，返回 CREATE_NEW。
"#,
            current_time_str = current_time_str
        );

        let user_content = json!({
            "source_application": source_app,
            "source_window_title": source_window,
            "captured_text": snippet,
            "active_matters": matters_context
        });

        let mut url = config.api_base_url.trim_end_matches('/').to_string();
        if !url.ends_with("/chat/completions") {
            url.push_str("/chat/completions");
        }

        let body = json!({
            "model": config.model_name,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content.to_string() }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2
        });

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("网络请求错误: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("大模型接口返回异常 HTTP {}: {}", status, text));
        }

        let resp_json: Value = resp.json().await.map_err(|e| format!("响应解析失败: {}", e))?;
        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "返回内容为空".to_string())?;

        let clean_json = content
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        let parsed: Value = serde_json::from_str(clean_json).map_err(|e| format!("JSON解析错误: {}", e))?;

        let action = parsed["action"].as_str().unwrap_or("CREATE_NEW").to_string();
        let confidence = parsed["confidence"].as_f64().unwrap_or(0.8);
        let matched_matter_id = parsed["matched_matter_id"].as_str().map(|s| s.to_string());
        
        let matched_matter_title = if let Some(ref mid) = matched_matter_id {
            active_matters.iter().find(|m| &m.id == mid).map(|m| m.title.clone())
        } else {
            None
        };

        let mut candidate_matters = Vec::new();
        if let Some(arr) = parsed["candidate_matters"].as_array() {
            for item in arr {
                if let (Some(cid), Some(ctitle)) = (item["id"].as_str(), item["title"].as_str()) {
                    candidate_matters.push(CandidateMatter {
                        id: cid.to_string(),
                        title: ctitle.to_string(),
                        confidence: item["confidence"].as_f64().unwrap_or(0.6),
                    });
                }
            }
        }

        let suggested_new_matter = if let Some(obj) = parsed["suggested_new_matter"].as_object() {
            Some(SuggestedMatter {
                title: obj.get("title").and_then(|v| v.as_str()).unwrap_or("未命名事项").to_string(),
                category: obj.get("category").and_then(|v| v.as_str()).unwrap_or("work").to_string(),
                priority: obj.get("priority").and_then(|v| v.as_str()).unwrap_or("medium").to_string(),
                summary: obj.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
        } else {
            None
        };

        let extracted_facts_delta = parsed["extracted_facts_delta"].as_str().map(|s| s.to_string());

        let mut extracted_todos = Vec::new();
        if let Some(todos_arr) = parsed["extracted_todos"].as_array() {
            for t in todos_arr {
                if let Some(t_content) = t["content"].as_str() {
                    extracted_todos.push(ExtractedTodo {
                        content: t_content.to_string(),
                        due_time: t["due_time"].as_str().map(|s| s.to_string()),
                    });
                }
            }
        }

        Ok(AIParseResult {
            action,
            confidence,
            matched_matter_id,
            matched_matter_title,
            candidate_matters,
            suggested_new_matter,
            extracted_facts_delta,
            extracted_todos,
            raw_snippet: snippet.to_string(),
            source_app: source_app.to_string(),
            source_window: source_window.to_string(),
        })
    }

    /// 本地轻量规则兜底引擎（离线、免配置 Key 即开即用）
    pub fn local_fallback_parser(
        active_matters: &[Matter],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> AIParseResult {
        let clean = snippet.trim();
        let mut matched_matter: Option<&Matter> = None;
        let mut max_score = 0.0f64;
        let mut candidates = Vec::new();

        // 1. 基于关键词比对已有事项
        for m in active_matters {
            let mut score = 0.0f64;
            // 标题关键词命中
            for word in m.title.chars().collect::<Vec<_>>().windows(2) {
                let term: String = word.iter().collect();
                if clean.contains(&term) {
                    score += 0.25;
                }
            }
            if !m.overview.is_empty() && clean.contains(&m.overview) {
                score += 0.4;
            }
            if clean.contains(&m.title) {
                score += 0.6;
            }

            if score > 0.3 {
                candidates.push(CandidateMatter {
                    id: m.id.clone(),
                    title: m.title.clone(),
                    confidence: (score.min(0.95) * 100.0).round() / 100.0,
                });
            }

            if score > max_score {
                max_score = score;
                matched_matter = Some(m);
            }
        }

        // 2. 提取时间与行动项
        let (todos, fact_delta) = Self::extract_rules_todos_and_facts(clean);

        if max_score >= 0.65 && matched_matter.is_some() {
            let m = matched_matter.unwrap();
            AIParseResult {
                action: "MATCH_EXISTING".to_string(),
                confidence: max_score.min(0.92),
                matched_matter_id: Some(m.id.clone()),
                matched_matter_title: Some(m.title.clone()),
                candidate_matters: candidates,
                suggested_new_matter: None,
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
            }
        } else if candidates.len() >= 2 {
            AIParseResult {
                action: "AMBIGUOUS".to_string(),
                confidence: 0.55,
                matched_matter_id: None,
                matched_matter_title: None,
                candidate_matters: candidates,
                suggested_new_matter: Some(SuggestedMatter {
                    title: Self::generate_fallback_title(clean),
                    category: if clean.contains("买") || clean.contains("家") || clean.contains("生活") {
                        "life".to_string()
                    } else {
                        "work".to_string()
                    },
                    priority: "medium".to_string(),
                    summary: clean.chars().take(40).collect(),
                }),
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
            }
        } else {
            AIParseResult {
                action: "CREATE_NEW".to_string(),
                confidence: 0.85,
                matched_matter_id: None,
                matched_matter_title: None,
                candidate_matters: Vec::new(),
                suggested_new_matter: Some(SuggestedMatter {
                    title: Self::generate_fallback_title(clean),
                    category: if clean.contains("买") || clean.contains("家") || clean.contains("看电影") {
                        "life".to_string()
                    } else {
                        "work".to_string()
                    },
                    priority: if clean.contains("紧急") || clean.contains("马上") || clean.contains("重要") {
                        "high".to_string()
                    } else {
                        "medium".to_string()
                    },
                    summary: clean.chars().take(50).collect(),
                }),
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
            }
        }
    }

    fn generate_fallback_title(text: &str) -> String {
        let first_sentence = text.split(&['。', '！', '!', '？', '?', '\n', ';', '；'][..]).next().unwrap_or(text);
        let trimmed = first_sentence.trim();
        if trimmed.chars().count() > 20 {
            format!("{}...", trimmed.chars().take(18).collect::<String>())
        } else if trimmed.is_empty() {
            "新事项".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn extract_rules_todos_and_facts(text: &str) -> (Vec<ExtractedTodo>, Option<String>) {
        let now = Local::now();
        let mut todos = Vec::new();
        let mut facts = Vec::new();

        let mut due_time_str = None;

        // 识别常见时间词
        if text.contains("明天") {
            let tomorrow = now + Duration::days(1);
            let target = if text.contains("下午") || text.contains("18") {
                tomorrow.date_naive().and_hms_opt(18, 0, 0)
            } else if text.contains("上午") || text.contains("10") {
                tomorrow.date_naive().and_hms_opt(10, 0, 0)
            } else {
                tomorrow.date_naive().and_hms_opt(9, 0, 0)
            };
            if let Some(t) = target {
                due_time_str = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
            }
        } else if text.contains("后天") {
            let d = now + Duration::days(2);
            due_time_str = Some(d.format("%Y-%m-%d 10:00:00").to_string());
        } else if text.contains("下周") || text.contains("周三") || text.contains("星期三") {
            let d = now + Duration::days(3);
            due_time_str = Some(d.format("%Y-%m-%d 10:00:00").to_string());
        } else if text.contains("今天") {
            let target = now.date_naive().and_hms_opt(18, 0, 0);
            if let Some(t) = target {
                due_time_str = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
            }
        }

        // 判断是否有明显行动词（提交、发送、确认、完成、跟进、联系、开会）
        let action_words = ["提交", "完成", "发送", "确认", "汇报", "开会", "联系", "跟进", "整理", "打款", "购买"];
        let mut is_todo = false;
        for kw in &action_words {
            if text.contains(kw) {
                is_todo = true;
                break;
            }
        }

        if is_todo || due_time_str.is_some() {
            let todo_title = if text.chars().count() > 30 {
                format!("{}...", text.chars().take(28).collect::<String>())
            } else {
                text.to_string()
            };
            todos.push(ExtractedTodo {
                content: todo_title,
                due_time: due_time_str,
            });
        }

        if text.contains("指标") || text.contains("金额") || text.contains("价格") || text.contains("合同") || text.contains("要求") || text.contains("数据") {
            facts.push(format!("• 细节记录: {}", text));
        }

        let facts_delta = if !facts.is_empty() {
            Some(facts.join("\n"))
        } else {
            None
        };

        (todos, facts_delta)
    }
}
