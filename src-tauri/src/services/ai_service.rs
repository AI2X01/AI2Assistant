use crate::models::{
    AIParseResult, AppConfig, CandidateMatter, ExtractedTodo, MatterContextWithTodos,
    SuggestedMatter, TodoUpdateSuggestion,
};
use chrono::{Duration, Local};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::{Duration as StdDuration, Instant};

pub struct AIService;

impl AIService {
    pub async fn parse_and_route(
        config: &AppConfig,
        active_matters: &[MatterContextWithTodos],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> AIParseResult {
        println!("\n╔══════════════════════════════════════════════════════════════════════╗");
        println!("║               【AI2Assistant】事件归集与语义意图感知                 ║");
        println!("╠══════════════════════════════════════════════════════════════════════╣");
        println!("│ 来源应用: {}", source_app);
        println!("│ 来源会话/群聊: {}", source_window);
        let profile_summary: String = if config.user_profile.trim().is_empty() {
            "未配置个人情况".to_string()
        } else {
            config.user_profile.chars().take(60).collect()
        };
        println!("│ 用户个人情况: {}", profile_summary);
        println!("│ 划选文本片段 (长度: {} 字符):\n│   {}", snippet.chars().count(), snippet.replace('\n', "\n│   "));
        println!("│ 当前进行中事项库 (共 {} 项):", active_matters.len());
        for (i, m_ctx) in active_matters.iter().enumerate() {
            let m = &m_ctx.matter;
            let contacts = if m.related_contacts.trim().is_empty() { "未配置" } else { &m.related_contacts };
            let overview_snippet: String = m.overview.chars().take(25).collect();
            println!("│   [{}] 【{}】 (ID: {}, 待办: {}条, 关联人/群: [{}], 背景: '{}')", i + 1, m.title, m.id, m_ctx.pending_todos.len(), contacts, overview_snippet);
            for t in &m_ctx.pending_todos {
                println!("│         ↳ [未完成待办 ID: {}] {} (截止: {})", t.id, t.content, t.due_time.as_deref().unwrap_or("无"));
            }
        }

        // 如果未配置 API Key，直接走本地高质量规则引擎
        if config.api_key.trim().is_empty() {
            println!("│ [提示] 未配置 API Key，直接启用本地智能规则引擎进行意图归集");
            println!("╚══════════════════════════════════════════════════════════════════════╝\n");
            return Self::local_fallback_parser(active_matters, snippet, source_app, source_window);
        }

        match Self::call_llm_api(config, active_matters, snippet, source_app, source_window).await {
            Ok(result) => {
                println!("╚══════════════════════════════════════════════════════════════════════╝\n");
                result
            }
            Err(e) => {
                eprintln!("│ [LLM 调用失败/异常] 原因: {}", e);
                eprintln!("│ 正在启用本地智能规则引擎进行降级归集与事实提炼...");
                println!("╚══════════════════════════════════════════════════════════════════════╝\n");
                Self::local_fallback_parser(active_matters, snippet, source_app, source_window)
            }
        }
    }

    async fn call_llm_api(
        config: &AppConfig,
        active_matters: &[MatterContextWithTodos],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> Result<AIParseResult, String> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(25))
            .build()
            .map_err(|e| e.to_string())?;

        let now = Local::now();
        let current_time_str = now.format("%Y-%m-%d %H:%M:%S (%A)").to_string();

        let matters_context: Vec<Value> = active_matters
            .iter()
            .map(|mw| {
                let m = &mw.matter;
                json!({
                    "id": m.id,
                    "title": m.title,
                    "overview": m.overview,
                    "fact_summary": m.fact_summary,
                    "category": m.category,
                    "related_contacts": m.related_contacts,
                    "pending_todos": mw.pending_todos.iter().map(|t| json!({
                        "id": t.id,
                        "content": t.content,
                        "due_time": t.due_time,
                        "status": t.status
                    })).collect::<Vec<_>>()
                })
            })
            .collect();

        let user_profile_desc = if config.user_profile.trim().is_empty() {
            "（用户暂未配置个人情况，请从通用办公与生活场景推断）".to_string()
        } else {
            config.user_profile.trim().to_string()
        };

        let system_prompt = format!(
            r#"你是一个高度敏锐、严谨的个人事务整理与归集决策引擎。
当前系统标准基准时间是: {current_time_str}。

【用户个人情况 / 身份背景】：
{user_profile_desc}

请根据用户在外部应用（如微信群聊、钉钉、邮件或文档）中划选的文本，结合用户个人身份背景与进行中事项（包括各事项当前未完成的待办任务），做出精准的事项匹配、新待办提取、核心事实提取以及【已有待办关闭或更新】决策。

必须严格输出纯 JSON 对象，格式如下：
{{
  "action": "MATCH_EXISTING" | "AMBIGUOUS" | "CREATE_NEW" | "IGNORE",
  "confidence": 0.0到1.0的浮点数,
  "matched_matter_id": "明确归属于某个进行中事项时填写其ID，否则为 null",
  "candidate_matters": [
    {{ "id": "事项ID", "title": "事项标题", "confidence": 0.65 }}
  ],
  "suggested_new_matter": {{
    "title": "根据文本提炼的事项简练标题",
    "category": "work" 或 "life",
    "priority": "high" | "medium" | "low",
    "summary": "事项总体概述",
    "related_contacts": "根据当前群名/联系人提取的关联人或群配置，例如：潮汕话标注群"
  }} 或 null,
  "extracted_facts_delta": "从该碎片文本中提取出的核心客观事实（如时间节点、质量指标、业务要求、财务金额、责任人等），按 Markdown 要点格式输出（每项以 '• ' 开头）。无新事实则为 null",
  "extracted_todos": [
    {{
      "content": "具体新行动项待办内容",
      "due_time": "换算后的绝对时间 YYYY-MM-DD HH:MM:SS，如果文本未提及明确时间则为 null"
    }}
  ],
  "todo_updates": [
    {{
      "todo_id": "需核销关闭或更新的已有待办ID",
      "original_content": "该待办原内容",
      "action": "CLOSE" 或 "UPDATE",
      "reason": "为什么核销关闭或更新（如：日志表明南非荷兰语已返修提交，该待办已完成）",
      "updated_content": "若action为UPDATE时填写修改后的新内容，CLOSE时为null",
      "updated_due_time": "若更新了截止时间则填写换算后的绝对时间，否则为null"
    }}
  ]
}}

【核心判定准则 - 务必严格执行】：
1. 事项“关联人/群配置”与“聊天窗口/群名”是决定性线索（最高优先级）：
   - 每个事项配置了【关联人/群】（related_contacts，例如“潮汕话标注群, 陈伟豪”）。
   - 即时通讯中，source_window_title 通常是具体的【微信群聊名称】或【联系人姓名】（如“潮汕话标注群 (18)”或“陈伟豪”）。
   - 若聊天群名或联系人与某个事项的名称具有核心专有名词重合，或命中该事项的【关联人/群配置】：
     即使划选的文本里没有重复提及事项全名，只要是该群内的日常任务、规范、交接或沟通，必须强判定为 MATCH_EXISTING，指向该事项（matched_matter_id），并将 confidence 提升至 0.90 以上！
   - 严禁将泛化词（如“质检”、“文本”、“要求”、“标注”）当作判断依据而误将其他不相关的语言/项目（如“泰语质检”、“西语质检”）作为并列候选！必须优先匹配独有的专有名词与关联人/群。
2. 结合“用户个人情况”精准提取新待办（extracted_todos）与【截止提醒时间规范】：
   - 结合用户的职责范围判断：如果是对话对方指派给用户、或者需要用户跟进处理的行动事项，必须提取为待办（extracted_todos）；如果只是其他人的汇报或用户安排他人的事情，归为事实沉淀而非自己待办。
   - 提取需要执行的具体动作指令，相对时间（如“明天下午”、“下周一”）必须基于给定基准时间准确换算为绝对日期时间。
   - 【时间范围极其重要规范】：若提取出的截止提醒时间过于宽泛到全天、天级别或某天截止（例如：“今天”、“明天”、“这两天完成”、“本周五前”、“9月22日前”等），默认统一设为当天的晚上10点整（即 22:00:00）！
   - 【严禁深夜提醒】：绝对严禁将截止提醒时间设为深更半夜的 23:59:59 或 23:59:00！办公与生活场景下深夜提醒严重干扰休息，凡未指定具体时分秒的全天范围任务，截止时间必须设为 22:00:00。
3. 核心事实提取（extracted_facts_delta）：
   - 只要文本中包含具体事实（如指标要求、进度、时间节点、责任人、注意事项），必须提炼成精炼的 Markdown 事实要点（以 '• ' 开头），不得返回 null。
4. 现有待办核销/关闭与更新检查（todo_updates，重要）：
   - 针对匹配到事项的【pending_todos（现有未完成待办清单）】进行逐条比对。
   - 如果新划选的文本/日志表明某个待办已经完成、提交、交付、修复、解决、取消或不再需要执行：
     【典型场景示例】：
     - 原待办：“南非荷兰语我只能自己上了，提示预计8点左右开始，10点结束”
     - 新日志：“21:22 南非荷兰语已返修提交”
     - 决策：这说明该项待办已经完成提交！必须在 todo_updates 中生成 action 为 "CLOSE" 的项，包含该 todo_id，并将 reason 设为“日志表明已返修提交，完成该任务”。
   - 如果新文本表明某待办被顺延、推迟或修改了执行要求，生成 action 为 "UPDATE" 的项，更新其 updated_content 或 updated_due_time。
   - 如果没有需要关闭或更新的现有待办，todo_updates 返回空数组 []。"#,
            current_time_str = current_time_str,
            user_profile_desc = user_profile_desc
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

        println!("│ [LLM 请求] 发送至: {} (模型: {})", url, config.model_name);

        let body = json!({
            "model": config.model_name,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content.to_string() }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2
        });

        let start_time = Instant::now();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("网络请求错误: {}", e))?;

        let status = resp.status();
        let elapsed = start_time.elapsed().as_millis();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("大模型接口返回异常 HTTP {}: {}", status, text));
        }

        let resp_text = resp.text().await.map_err(|e| format!("读取响应体失败: {}", e))?;
        let resp_json: Value = serde_json::from_str(&resp_text).map_err(|e| {
            format!(
                "响应 JSON 解析失败: {} (前200字符: {})",
                e,
                resp_text.chars().take(200).collect::<String>()
            )
        })?;

        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "大模型返回 choices 内容为空".to_string())?;

        let clean_json = content
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        println!("│ [LLM 响应] 耗时: {}ms, HTTP: {}", elapsed, status);
        println!("│ [LLM 原始输出]:\n│   {}", clean_json.replace('\n', "\n│   "));

        let parsed: Value = serde_json::from_str(clean_json).map_err(|e| format!("JSON解析错误: {}", e))?;

        let action = parsed["action"].as_str().unwrap_or("CREATE_NEW").to_string();
        let confidence = parsed["confidence"].as_f64().unwrap_or(0.8);
        let matched_matter_id = parsed["matched_matter_id"].as_str().map(|s| s.to_string());

        let matched_matter_title = if let Some(ref mid) = matched_matter_id {
            active_matters.iter().find(|m| &m.matter.id == mid).map(|m| m.matter.title.clone())
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
                related_contacts: obj.get("related_contacts").and_then(|v| v.as_str()).map(|s| s.to_string()),
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
                        due_time: Self::normalize_due_time_str(t["due_time"].as_str().map(|s| s.to_string())),
                    });
                }
            }
        }

        let mut todo_updates = Vec::new();
        if let Some(updates_arr) = parsed["todo_updates"].as_array() {
            for u in updates_arr {
                if let (Some(tid), Some(act)) = (u["todo_id"].as_str(), u["action"].as_str()) {
                    todo_updates.push(TodoUpdateSuggestion {
                        todo_id: tid.to_string(),
                        original_content: u["original_content"].as_str().unwrap_or("").to_string(),
                        action: act.to_string(),
                        reason: u["reason"].as_str().unwrap_or("根据最新日志更新").to_string(),
                        updated_content: u["updated_content"].as_str().map(|s| s.to_string()),
                        updated_due_time: Self::normalize_due_time_str(u["updated_due_time"].as_str().map(|s| s.to_string())),
                    });
                }
            }
        }

        println!("│ ──────────────── 解析与决策结果 ────────────────");
        println!("│ 动作判定: {}", action);
        println!("│ 置信度: {:.2}", confidence);
        if let Some(ref title) = matched_matter_title {
            println!("│ 命中归集事项: 【{}】 (ID: {})", title, matched_matter_id.as_deref().unwrap_or(""));
        }
        if !candidate_matters.is_empty() {
            println!("│ 候选事项 ({} 项):", candidate_matters.len());
            for c in &candidate_matters {
                println!("│   • 【{}】 (匹配度: {:.0}%)", c.title, c.confidence * 100.0);
            }
        }
        if let Some(ref facts) = extracted_facts_delta {
            println!("│ 提炼核心事实:\n│   {}", facts.replace('\n', "\n│   "));
        } else {
            println!("│ 提炼核心事实: (未识别到新事实)");
        }
        if !extracted_todos.is_empty() {
            println!("│ 提取行动待办 ({} 项):", extracted_todos.len());
            for (idx, t) in extracted_todos.iter().enumerate() {
                println!("│   [{}] {} (截止: {})", idx + 1, t.content, t.due_time.as_deref().unwrap_or("未指定"));
            }
        }
        if !todo_updates.is_empty() {
            println!("│ 建议更新/关闭待办 ({} 项):", todo_updates.len());
            for (idx, u) in todo_updates.iter().enumerate() {
                println!("│   [{}] 待办ID: {} | 动作: {} | 理由: '{}' | 原内容: '{}'", idx + 1, u.todo_id, u.action, u.reason, u.original_content);
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
            todo_updates,
            raw_snippet: snippet.to_string(),
            source_app: source_app.to_string(),
            source_window: source_window.to_string(),
            log_id: None,
        })
    }

    /// 本地轻量规则兜底引擎（离线、免配置 Key 或大模型调用异常时使用）
    pub fn local_fallback_parser(
        active_matters: &[MatterContextWithTodos],
        snippet: &str,
        source_app: &str,
        source_window: &str,
    ) -> AIParseResult {
        let clean = snippet.trim();
        let win_clean = source_window.trim();
        println!("│ ┌────────────── 本地规则引擎评分分析 ──────────────┐");
        println!("│ │ 来源窗口/群聊: '{}'", win_clean);

        // 通用泛化停用词（避免由于都含有这些词造成误匹配）
        const STOP_WORDS: &[&str] = &[
            "质检", "文本", "语言", "任务", "要求", "事项", "工作", "进行", "完成",
            "处理", "测试", "标注", "转写", "音频", "项目", "沟通", "通知",
        ];

        let mut matched_matter: Option<&MatterContextWithTodos> = None;
        let mut max_score = 0.0f64;
        let mut candidates = Vec::new();

        for m_ctx in active_matters {
            let m = &m_ctx.matter;
            let mut score = 0.0f64;

            // 0. 事项配置的【关联人/群】最高优先级判定
            if !m.related_contacts.trim().is_empty() {
                let contacts_list: Vec<&str> = m
                    .related_contacts
                    .split(&[',', '，', '、', ';', '；', ' '][..])
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect();

                for contact in contacts_list {
                    // 若聊天窗口/群名包含关联人或群名
                    if !win_clean.is_empty() && (win_clean.contains(contact) || contact.contains(win_clean)) {
                        score += 0.90;
                        println!("│ │   -> 命中事项关联人/群: '{}' (窗口名: '{}')，加分 +0.90", contact, win_clean);
                        break;
                    }
                    // 若划选文本内容包含关联人或群名
                    if clean.contains(contact) {
                        score += 0.50;
                        println!("│ │   -> 划选内容包含关联人/群: '{}'，加分 +0.50", contact);
                    }
                }
            }

            // 1. 聊天窗口/群名高优先级强线索
            if !win_clean.is_empty() && win_clean != "微信" && win_clean != "未知应用" {
                if win_clean == m.title {
                    score += 0.90;
                } else if win_clean.contains(&m.title) || m.title.contains(win_clean) {
                    score += 0.80;
                } else {
                    // 提取事项专有名词（过滤通用词）
                    let distinct_terms: Vec<String> = m
                        .title
                        .chars()
                        .collect::<Vec<_>>()
                        .windows(2)
                        .map(|w| w.iter().collect::<String>())
                        .filter(|w| !STOP_WORDS.contains(&w.as_str()))
                        .collect();

                    for term in &distinct_terms {
                        if win_clean.contains(term) {
                            score += 0.45; // 命中专有方言/业务核心词，如“潮汕”
                        }
                    }
                }
            }

            // 2. 划选内容核心专有名词匹配
            if clean.contains(&m.title) {
                score += 0.65;
            } else {
                let distinct_terms: Vec<String> = m
                    .title
                    .chars()
                    .collect::<Vec<_>>()
                    .windows(2)
                    .map(|w| w.iter().collect::<String>())
                    .filter(|w| !STOP_WORDS.contains(&w.as_str()))
                    .collect();

                for term in &distinct_terms {
                    if clean.contains(term) {
                        score += 0.35;
                    }
                }
            }

            if !m.overview.is_empty() && clean.contains(&m.overview) {
                score += 0.40;
            }

            println!("│ │ 事项 【{:20}】 得分: {:.2}", m.title, score);

            if score > 0.35 {
                candidates.push(CandidateMatter {
                    id: m.id.clone(),
                    title: m.title.clone(),
                    confidence: (score.min(0.95) * 100.0).round() / 100.0,
                });
            }

            if score > max_score {
                max_score = score;
                matched_matter = Some(m_ctx);
            }
        }

        candidates.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

        // 提取建议的关联人/群（若来源为具体微信群或人名）
        let fallback_contacts = if !win_clean.is_empty() && win_clean != "微信" && win_clean != "未知应用" {
            Some(win_clean.to_string())
        } else {
            None
        };

        // 2. 规则提取时间、行动项与事实
        let (todos, fact_delta) = Self::extract_rules_todos_and_facts(clean);

        // 3. 规则检测是否核销/关闭待办
        let mut todo_updates = Vec::new();
        if let Some(m_ctx) = matched_matter {
            let finish_keywords = ["已返修", "已提交", "已完成", "搞定了", "搞定", "做完了", "已发", "已解决", "已处理", "已关闭"];
            let has_finish_keyword = finish_keywords.iter().any(|k| clean.contains(k));
            if has_finish_keyword {
                for t in &m_ctx.pending_todos {
                    let key_terms: Vec<String> = t.content
                        .chars()
                        .collect::<Vec<_>>()
                        .windows(2)
                        .map(|w| w.iter().collect::<String>())
                        .filter(|w| !STOP_WORDS.contains(&w.as_str()))
                        .collect();
                    let matches_content = key_terms.iter().any(|k| clean.contains(k));
                    if matches_content || m_ctx.pending_todos.len() == 1 {
                        todo_updates.push(TodoUpdateSuggestion {
                            todo_id: t.id.clone(),
                            original_content: t.content.clone(),
                            action: "CLOSE".to_string(),
                            reason: format!("日志表明任务已完成/提交: {}", clean.chars().take(20).collect::<String>()),
                            updated_content: None,
                            updated_due_time: None,
                        });
                        println!("│ │   -> [规则引擎] 识别到待办可关闭: 【{}】 (ID: {})", t.content, t.id);
                    }
                }
            }
        }

        // 如果最高分与第二高分有明显差距或达到 0.70，直接自动归档
        let is_clear_winner = if candidates.len() >= 2 {
            candidates[0].confidence - candidates[1].confidence >= 0.20
        } else {
            true
        };

        if max_score >= 0.65 && is_clear_winner && matched_matter.is_some() {
            let m_ctx = matched_matter.unwrap();
            let m = &m_ctx.matter;
            println!("│ │ [决策结果] 明确归集到事项: 【{}】(得分: {:.2})", m.title, max_score);
            println!("│ └──────────────────────────────────────────────────┘");
            AIParseResult {
                action: "MATCH_EXISTING".to_string(),
                confidence: max_score.min(0.95),
                matched_matter_id: Some(m.id.clone()),
                matched_matter_title: Some(m.title.clone()),
                candidate_matters: candidates,
                suggested_new_matter: None,
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                todo_updates,
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
                log_id: None,
            }
        } else if candidates.len() >= 2 {
            println!("│ │ [决策结果] 存在多项模糊候选 (共 {} 项)", candidates.len());
            println!("│ └──────────────────────────────────────────────────┘");
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
                    related_contacts: fallback_contacts.clone(),
                }),
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                todo_updates: Vec::new(),
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
                log_id: None,
            }
        } else {
            println!("│ │ [决策结果] 未匹配到现有事项，建议新建");
            println!("│ └──────────────────────────────────────────────────┘");
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
                    related_contacts: fallback_contacts,
                }),
                extracted_facts_delta: fact_delta,
                extracted_todos: todos,
                todo_updates: Vec::new(),
                raw_snippet: clean.to_string(),
                source_app: source_app.to_string(),
                source_window: source_window.to_string(),
                log_id: None,
            }
        }
    }

    /// 对待办截止/提醒时间进行归一化：若时间宽泛到全天或设为深夜 23:59:59，统一规整为当晚 22:00:00
    pub fn normalize_due_time_str(time_str: Option<String>) -> Option<String> {
        time_str.and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            if trimmed.ends_with("23:59:59") {
                Some(trimmed.replace("23:59:59", "22:00:00"))
            } else if trimmed.ends_with("23:59:00") {
                Some(trimmed.replace("23:59:00", "22:00:00"))
            } else if trimmed.ends_with("23:59") {
                Some(trimmed.replace("23:59", "22:00:00"))
            } else if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') && trimmed.chars().nth(7) == Some('-') {
                Some(format!("{} 22:00:00", trimmed))
            } else {
                Some(trimmed.to_string())
            }
        })
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

        // 识别常见时间词（宽泛到全天的，默认设为当晚 10 点 22:00:00）
        if text.contains("明天") {
            let tomorrow = now + Duration::days(1);
            let target = if text.contains("下午") || text.contains("18") {
                tomorrow.date_naive().and_hms_opt(18, 0, 0)
            } else if text.contains("上午") || text.contains("10") {
                tomorrow.date_naive().and_hms_opt(10, 0, 0)
            } else {
                tomorrow.date_naive().and_hms_opt(22, 0, 0)
            };
            if let Some(t) = target {
                due_time_str = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
            }
        } else if text.contains("这两天") || text.contains("2天内") || text.contains("两天内") {
            let d = now + Duration::days(2);
            due_time_str = Some(d.format("%Y-%m-%d 22:00:00").to_string());
        } else if text.contains("后天") {
            let d = now + Duration::days(2);
            due_time_str = Some(d.format("%Y-%m-%d 22:00:00").to_string());
        } else if text.contains("下周") || text.contains("周三") || text.contains("星期三") {
            let d = now + Duration::days(3);
            due_time_str = Some(d.format("%Y-%m-%d 22:00:00").to_string());
        } else if text.contains("今天") {
            let target = if text.contains("下午") || text.contains("18") {
                now.date_naive().and_hms_opt(18, 0, 0)
            } else if text.contains("上午") || text.contains("10") {
                now.date_naive().and_hms_opt(10, 0, 0)
            } else {
                now.date_naive().and_hms_opt(22, 0, 0)
            };
            if let Some(t) = target {
                due_time_str = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
            }
        }

        // 判断是否有明显行动词
        let action_words = ["提交", "完成", "发送", "确认", "汇报", "开会", "联系", "跟进", "整理", "打款", "购买", "质检", "核对"];
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

        // 事实沉淀细节
        if text.contains("指标")
            || text.contains("金额")
            || text.contains("价格")
            || text.contains("合同")
            || text.contains("要求")
            || text.contains("数据")
            || text.contains("标准")
            || text.contains("通过率")
            || text.contains("群")
        {
            facts.push(format!("• 核心细节: {}", text));
        }

        let facts_delta = if !facts.is_empty() {
            Some(facts.join("\n"))
        } else {
            None
        };

        (todos, facts_delta)
    }

    /// 针对特定事项的所有碎片日志，重新提炼生成结构化的核心事实沉淀
    pub async fn summarize_matter_facts(
        config: &AppConfig,
        matter_title: &str,
        matter_overview: &str,
        matter_related_contacts: &str,
        existing_facts: &str,
        logs: &[crate::models::LogItem],
    ) -> String {
        println!("\n╔══════════════════════════════════════════════════════════════════════╗");
        println!("║               【AI2Assistant】事项核心事实重新提炼                   ║");
        println!("╠══════════════════════════════════════════════════════════════════════╣");
        println!("│ 事项标题: 【{}】", matter_title);
        println!("│ 事项概述: {}", matter_overview);
        println!("│ 关联人/群: {}", if matter_related_contacts.trim().is_empty() { "未配置" } else { matter_related_contacts });
        println!("│ 现有事实沉淀:\n│   {}", existing_facts.replace('\n', "\n│   "));
        println!("│ 参与提炼的碎片日志数: {} 条", logs.len());

        if logs.is_empty() {
            println!("│ [提示] 当前事项尚无碎片日志，返回现有事实或默认占位");
            println!("╚══════════════════════════════════════════════════════════════════════╝\n");
            return if !existing_facts.trim().is_empty() {
                existing_facts.to_string()
            } else {
                "• 暂无相关日志记录，尚未沉淀事实。".to_string()
            };
        }

        // 如果配置了 API Key，尝试大模型专业提炼
        if !config.api_key.trim().is_empty() {
            match Self::call_llm_summarize(config, matter_title, matter_overview, matter_related_contacts, existing_facts, logs).await {
                Ok(summary) => {
                    if !summary.trim().is_empty() {
                        println!("│ [提炼完成] 大模型提炼事实成果:\n│   {}", summary.trim().replace('\n', "\n│   "));
                        println!("╚══════════════════════════════════════════════════════════════════════╝\n");
                        return summary.trim().to_string();
                    }
                }
                Err(e) => {
                    eprintln!("│ [LLM 提炼异常]: {}, 切换为本地智能规则提炼兜底", e);
                }
            }
        } else {
            println!("│ [提示] 未配置 API Key，启用本地高质量规则进行事实提取");
        }

        // 本地高质量规则提炼
        let local_summary = Self::local_summarize_facts(matter_title, matter_overview, existing_facts, logs);
        println!("│ [规则提炼结果]:\n│   {}", local_summary.replace('\n', "\n│   "));
        println!("╚══════════════════════════════════════════════════════════════════════╝\n");
        local_summary
    }

    async fn call_llm_summarize(
        config: &AppConfig,
        matter_title: &str,
        matter_overview: &str,
        matter_related_contacts: &str,
        existing_facts: &str,
        logs: &[crate::models::LogItem],
    ) -> Result<String, String> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(25))
            .build()
            .map_err(|e| e.to_string())?;

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let logs_content: Vec<String> = logs
            .iter()
            .enumerate()
            .map(|(idx, l)| {
                format!(
                    "[{}] 时间: {}, 来源: {}({})\n内容: {}",
                    idx + 1,
                    l.created_at,
                    l.source_app,
                    l.source_window_title,
                    l.raw_content
                )
            })
            .collect();

        let user_profile_desc = if config.user_profile.trim().is_empty() {
            "（用户暂未配置个人情况）".to_string()
        } else {
            config.user_profile.trim().to_string()
        };

        let system_prompt = format!(
            r#"你是一个高度严谨、富有前瞻洞察的个人事务高级顾问与整理助手。
当前时间: {now}

【用户个人情况 / 关注视角】：
{user_profile_desc}

【事项关联人/群配置】：
{matter_related_contacts}

你的任务是：根据事项标题、当前背景、关联人/群及该事项下的全部碎片日志，全面梳理分析，输出条理清晰、言简意赅的【总结与建议】。

必须且仅能严格分为以下两部分输出：

【事项总结】
- 根据识别的日志进行言简意赅的总结。
- 归纳总结当前事项的核心推进现状、最新关键决定与共识、关键商务/财务要求（如结算数据量、单价预算、周期等）、以及硬性指标参数。
- 语言高度精炼，逻辑紧密，去除一切客套闲聊，每条以 "• " 开头。

【推进建议】
- 根据整体日志对当前事项的推进全貌，提出针对性、前瞻性、切实可行的专业建议（持续更新）。
- 重点包含：下一步应优先推动的关键动作、潜在风险点预警与规避方案（如AI代标风险、交付延期风险、双方口径不一致等）、以及催办与协同对齐要点。
- 每条以 "• " 开头，观点明确、指引清晰。

格式要求：
1. 必须严格包含【事项总结】和【推进建议】两个段落大纲，示例：
【事项总结】
• 进展与共识: 明确当前阶段与最新共识...
• 关键指标: 明确量化数据、商务要求等...

【推进建议】
• 推进动作: 下一步应落实的核心行动...
• 风险防范: 需重点核验与关注的潜在问题...

2. 严禁输出任何开场白、前言、解释说明或结束语，直接输出正文。"#,
            now = now,
            user_profile_desc = user_profile_desc,
            matter_related_contacts = if matter_related_contacts.trim().is_empty() { "无" } else { matter_related_contacts }
        );

        let user_content = format!(
            "事项标题: {}\n事项背景/概述: {}\n关联人/群: {}\n参考现有内容: {}\n\n相关碎片日志列表:\n{}",
            matter_title,
            matter_overview,
            if matter_related_contacts.trim().is_empty() { "未配置" } else { matter_related_contacts },
            existing_facts,
            logs_content.join("\n---\n")
        );

        let mut url = config.api_base_url.trim_end_matches('/').to_string();
        if !url.ends_with("/chat/completions") {
            url.push_str("/chat/completions");
        }

        println!("│ [LLM 提炼请求] 发送至: {} (模型: {})", url, config.model_name);

        let body = json!({
            "model": config.model_name,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_content }
            ],
            "temperature": 0.3
        });

        let start_time = Instant::now();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("网络请求错误: {}", e))?;

        let status = resp.status();
        let elapsed = start_time.elapsed().as_millis();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        let resp_text = resp.text().await.map_err(|e| format!("读取响应体失败: {}", e))?;
        let resp_json: Value = serde_json::from_str(&resp_text).map_err(|e| {
            format!("响应 JSON 解析失败: {} (内容: {})", e, resp_text.chars().take(200).collect::<String>())
        })?;

        println!("│ [LLM 提炼响应] 耗时: {}ms, HTTP: {}", elapsed, status);

        let content = resp_json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "返回内容为空".to_string())?;

        Ok(content.trim().to_string())
    }

    fn local_summarize_facts(
        matter_title: &str,
        _matter_overview: &str,
        existing_facts: &str,
        logs: &[crate::models::LogItem],
    ) -> String {
        let mut summary_lines: Vec<String> = Vec::new();
        let mut suggestion_lines: Vec<String> = Vec::new();

        // 1. 保留原有有效条目并分类
        for line in existing_facts.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.contains("暂无") {
                continue;
            }
            if trimmed.contains("【事项总结】") || trimmed.contains("【推进建议】") {
                continue;
            }
            if trimmed.contains("建议") || trimmed.contains("风险") || trimmed.contains("需关注") || trimmed.contains("防范") {
                if !suggestion_lines.contains(&trimmed.to_string()) {
                    suggestion_lines.push(trimmed.to_string());
                }
            } else if !summary_lines.contains(&trimmed.to_string()) {
                summary_lines.push(trimmed.to_string());
            }
        }

        // 2. 从碎片日志中提炼关键信息
        for log in logs {
            let text = log.raw_content.trim();
            if text.is_empty() {
                continue;
            }

            let sentences: Vec<&str> = text
                .split(&['\n', '。', '；', ';', '！', '!'][..])
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();

            for s in &sentences {
                let is_key_info = s.contains("指标")
                    || s.contains("金额")
                    || s.contains("元")
                    || s.contains("价格")
                    || s.contains("合同")
                    || s.contains("要求")
                    || s.contains("数据")
                    || s.contains("负责")
                    || s.contains("承诺")
                    || s.contains("完成")
                    || s.contains("时间")
                    || s.contains("周")
                    || s.contains("日")
                    || s.contains("号")
                    || s.contains("对接")
                    || s.contains("推进")
                    || s.contains("交付")
                    || s.contains("群");

                if is_key_info {
                    let formatted = format!("• 关键纪要: {}", s);
                    if !summary_lines.contains(&formatted) {
                        summary_lines.push(formatted);
                    }
                }
            }
        }

        if summary_lines.is_empty() {
            for log in logs.iter().take(3) {
                let snippet: String = log.raw_content.chars().take(50).collect();
                summary_lines.push(format!("• 进展记录 ({}): {}", log.created_at, snippet));
            }
        }

        // 3. 基于日志与状态生成前瞻推进建议（持续更新）
        if suggestion_lines.is_empty() {
            suggestion_lines.push("• 进度跟进: 建议关注本事项最新关键节点，及时与核心对接人锁定交付/核对明细。".to_string());
            suggestion_lines.push("• 风险防范: 建议对关键指标与交付物进行抽样核查，防范质量偏差或口径不一致风险。".to_string());
        }

        format!(
            "【事项总结】\n{}\n\n【推进建议】\n{}",
            if summary_lines.is_empty() {
                format!("• 【{}】当前记录了 {} 条日志，整体进展顺利。", matter_title, logs.len())
            } else {
                summary_lines.join("\n")
            },
            suggestion_lines.join("\n")
        )
    }
}
