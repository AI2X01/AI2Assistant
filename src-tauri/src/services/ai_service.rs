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
        image_base64: Option<&str>,
    ) -> AIParseResult {
        println!("\n╔══════════════════════════════════════════════════════════════════════╗");
        println!("║               【AI2Assistant】事件归集与语义意图感知                 ║");
        println!("╠══════════════════════════════════════════════════════════════════════╣");
        println!("│ 来源应用: {}", source_app);
        println!("│ 来源会话/群聊: {}", source_window);
        if let Some(img) = image_base64 {
            println!("│ 随附多模态应用截图: 是 (大小: {} 字符 Base64)", img.len());
        } else {
            println!("│ 随附多模态应用截图: 否");
        }
        let profile_summary: String = if config.user_profile.trim().is_empty() {
            "未配置个人情况".to_string()
        } else {
            config.user_profile.chars().take(60).collect()
        };
        println!("│ 用户个人情况: {}", profile_summary);
        println!(
            "│ 划选文本片段 (长度: {} 字符):\n│   {}",
            snippet.chars().count(),
            snippet.replace('\n', "\n│   ")
        );
        println!("│ 当前进行中事项库 (共 {} 项):", active_matters.len());
        for (i, m_ctx) in active_matters.iter().enumerate() {
            let m = &m_ctx.matter;
            let contacts = if m.related_contacts.trim().is_empty() {
                "未配置"
            } else {
                &m.related_contacts
            };
            let overview_snippet: String = m.overview.chars().take(25).collect();
            println!(
                "│   [{}] 【{}】 (ID: {}, 待办: {}条, 关联人/群: [{}], 背景: '{}')",
                i + 1,
                m.title,
                m.id,
                m_ctx.pending_todos.len(),
                contacts,
                overview_snippet
            );
            for t in &m_ctx.pending_todos {
                println!(
                    "│         ↳ [未完成待办 ID: {}] {} (截止: {})",
                    t.id,
                    t.content,
                    t.due_time.as_deref().unwrap_or("无")
                );
            }
        }

        // 如果未配置 API Key，直接走本地高质量规则引擎
        if config.api_key.trim().is_empty() {
            println!("│ [提示] 未配置 API Key，直接启用本地智能规则引擎进行意图归集");
            println!("╚══════════════════════════════════════════════════════════════════════╝\n");
            return Self::local_fallback_parser(active_matters, snippet, source_app, source_window);
        }

        match Self::call_llm_api(
            config,
            active_matters,
            snippet,
            source_app,
            source_window,
            image_base64,
        )
        .await
        {
            Ok(result) => {
                println!(
                    "╚══════════════════════════════════════════════════════════════════════╝\n"
                );
                result
            }
            Err(e) => {
                eprintln!("│ [LLM 调用失败/异常] 原因: {}", e);
                eprintln!("│ 正在启用本地智能规则引擎进行降级归集与事实提炼...");
                println!(
                    "╚══════════════════════════════════════════════════════════════════════╝\n"
                );
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
        image_base64: Option<&str>,
    ) -> Result<AIParseResult, String> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(60))
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

请根据用户在外部应用（如微信群聊、钉钉、邮件或文档）中划选的文本，结合用户个人身份背景与进行中事项（包括各事项当前未完成的待办任务），专注做出精准的【事项归集】与【待办生成/关闭/更新】决策。

必须严格输出纯 JSON 对象，格式如下：
{{
  "action": "MATCH_EXISTING" | "AMBIGUOUS" | "CREATE_NEW" | "IGNORE",
  "confidence": 0.0到1.0的浮点数,
  "detected_chat_target": "若随附了微信/企微等聊天窗口截图，请从截图顶部标题栏提取出真实完整的会话或群聊名称；若无截图或无法看清则填写推断的会话名称或原窗口名",
  "matched_matter_id": "明确归属于某个进行中事项时填写其ID，否则为 null",
  "candidate_matters": [
    {{ "id": "事项ID", "title": "事项标题", "confidence": 0.65 }}
  ],
  "suggested_new_matter": {{
    "title": "根据文本提炼的事项简练标题",
    "category": "work" 或 "life",
    "priority": "high" | "medium" | "low",
    "summary": "事项总体概述",
    "related_contacts": "根据当前会话群名或联系人提取的关键关联对象，例如：项目交付组, 王经理"
  }} 或 null,
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
      "reason": "为什么核销关闭或更新（如：日志表明方案已定稿提交，该任务已达成）",
      "updated_content": "若action为UPDATE时填写修改后的新内容，CLOSE时为null",
      "updated_due_time": "若更新了截止时间则填写换算后的绝对时间，否则为null"
    }}
  ]
}}

【核心判定准则 - 务必严格执行】：
1. 事项“关联人/群配置”与“聊天窗口/群名”是决定性线索（最高优先级）：
   - 每个事项支持配置【关联人/群】（related_contacts，例如：“核心交付攻坚群, 张总, 李组长”）。
   - 即时通讯或协作软件中，source_window_title 通常是具体的群聊名称或联系人姓名（例如：“供应链二期对接群 (12)”或“王工”）。
   - 若群名或联系人与某个事项的名称具有独占的核心项目/业务专有名词重合，或明确命中该事项的【关联人/群配置】：
     即使划选的文本片段中没有重复提及事项全称，只要属于该会话内的日常事务推进、交付、交接或协同沟通，必须强判定为 MATCH_EXISTING，优先指向该事项（matched_matter_id），并将 confidence 提升至 0.90 以上！
   - 严禁将跨行业通用泛化词（如“沟通”、“对接”、“进度”、“测试”、“方案”、“文档”、“总结”、“确认”、“要求”、“评审”）当作判断依据而误将其他不相关的事项作为并列候选！必须优先基于独有的项目专有名词、合作方主体、专项代号或关联人/群进行精准判定。
2. 结合“用户个人情况”精准提取新待办（extracted_todos）与【截止提醒时间规范】：
   - 结合用户的职责范围判断：如果是对话对方指派给用户、或者需要用户跟进处理的行动事项，必须提取为待办（extracted_todos）；如果只是其他人的汇报或用户安排他人的事情，归为日常推进日志而非自己待办。
   - 提取需要执行的具体动作指令，相对时间（如“明天下午”、“下周一”）必须基于给定基准时间准确换算为绝对日期时间。
   - 【时间范围极其重要规范】：若提取出的截止提醒时间过于宽泛到全天、天级别或某天截止（例如：“今天”、“明天”、“这两天完成”、“本周五前”、“9月22日前”等），默认统一设为当天的晚上10点整（即 22:00:00）！
   - 【严禁深夜提醒】：绝对严禁将截止提醒时间设为深更半夜的 23:59:59 或 23:59:00！办公与生活场景下深夜提醒严重干扰休息，凡未指定具体时分秒的全天范围任务，截止时间必须设为 22:00:00。
3. 现有待办核销/关闭与更新检查（todo_updates，重要）：
   - 针对匹配到事项的【pending_todos（现有未完成待办清单）】进行逐条比对。
   - 如果新划选的文本/日志表明某个待办已经完成、提交、交付、修复、解决、取消或不再需要执行：
     【典型场景示例】：
     - 原待办：“催促合作方提供本月对账单明细，并在下午5点前完成核对发给财务”
     - 新日志：“16:40 对账单明细已核对无误，发给财务李会计了”
     - 决策：这说明该项待办已完成落实！必须在 todo_updates 中生成 action 为 "CLOSE" 的项，包含该 todo_id，并将 reason 设为“日志表明已完成对账并同步财务，该任务已达成”。
   - 如果新文本表明某待办被顺延、推迟或修改了执行要求，生成 action 为 "UPDATE" 的项，更新其 updated_content 或 updated_due_time。
   - 如果没有需要关闭或更新的现有待办，todo_updates 返回空数组 []。
4. 视觉多模态窗口截图与会话名称识别（最高优先级）：
   - 如果本请求中附带了应用窗口截图，请仔细辨析该截图顶部（标题栏区域）显示的会话名称/群聊名称。
   - 提取完整名称（包括可能包含的组织部门后缀如'@财务部'，或长群名、双行副标题，注意看清真实汉字，不要臆造或看错形近字）。
   - 将识别出的真实名称填入 "detected_chat_target" 字段。
   - 【联动判定】：将识别到的群名/联系人与进行中各事项配置的【关联人/群 (related_contacts)】及事项名称进行深度比对；若命中，必须强判定为 MATCH_EXISTING，并将置信度 confidence 设为 0.90 以上！"#,
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

        let make_request_body = |include_image: bool| {
            let user_content_val = if include_image && image_base64.is_some() {
                let img_b64 = image_base64.unwrap();
                json!([
                    {
                        "type": "text",
                        "text": format!(
                            "【划选上下文与待办归集判定】：\n{}\n\n请仔细观察附带的窗口截图顶部标题栏，识别出当前微信/企微会话或群聊名称，填入 detected_chat_target，并结合划选文本做出一次性归集与待办决策。",
                            serde_json::to_string_pretty(&user_content).unwrap_or_default()
                        )
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/jpeg;base64,{}", img_b64)
                        }
                    }
                ])
            } else {
                json!(user_content.to_string())
            };

            json!({
                "model": config.model_name,
                "messages": [
                    { "role": "system", "content": &system_prompt },
                    { "role": "user", "content": user_content_val }
                ],
                "response_format": { "type": "json_object" },
                "temperature": 0.2
            })
        };

        let start_time = Instant::now();
        let try_with_image = image_base64.is_some();
        let mut body = make_request_body(try_with_image);

        let mut resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config.api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("网络请求错误: {}", e))?;

        let mut status = resp.status();

        // 若多模态请求失败（例如当前模型不支持视觉输入报错 HTTP 400 Bad Request 等），优雅降级为纯文本重试一次
        if try_with_image && !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            eprintln!(
                "│ [多模态降级] 带图请求返回 HTTP {}: {}，尝试自动降级为纯文本模式重试...",
                status, err_text
            );
            body = make_request_body(false);
            resp = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", config.api_key.trim()))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("纯文本降级网络请求错误: {}", e))?;
            status = resp.status();
        }

        let elapsed = start_time.elapsed().as_millis();

        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("大模型接口返回异常 HTTP {}: {}", status, text));
        }

        let resp_text = resp
            .text()
            .await
            .map_err(|e| format!("读取响应体失败: {}", e))?;
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
        println!(
            "│ [LLM 原始输出]:\n│   {}",
            clean_json.replace('\n', "\n│   ")
        );

        let parsed: Value =
            serde_json::from_str(clean_json).map_err(|e| format!("JSON解析错误: {}", e))?;

        let action = parsed["action"]
            .as_str()
            .unwrap_or("CREATE_NEW")
            .to_string();
        let confidence = parsed["confidence"].as_f64().unwrap_or(0.8);
        let matched_matter_id = parsed["matched_matter_id"].as_str().map(|s| s.to_string());
        let detected_chat_target = parsed["detected_chat_target"]
            .as_str()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "null");

        if let Some(ref target) = detected_chat_target {
            println!("│ [多模态视觉识别] 成功从截图识别出群聊/会话: '{}'", target);
        }

        let matched_matter_title = if let Some(ref mid) = matched_matter_id {
            active_matters
                .iter()
                .find(|m| &m.matter.id == mid)
                .map(|m| m.matter.title.clone())
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
                title: obj
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未命名事项")
                    .to_string(),
                category: obj
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("work")
                    .to_string(),
                priority: obj
                    .get("priority")
                    .and_then(|v| v.as_str())
                    .unwrap_or("medium")
                    .to_string(),
                summary: obj
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                related_contacts: obj
                    .get("related_contacts")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
        } else {
            None
        };

        // 彻底废除单次碎片事实沉淀，事项总结与建议由专门服务基于全量日志闭环生成
        let extracted_facts_delta: Option<String> = None;

        let mut extracted_todos = Vec::new();
        if let Some(todos_arr) = parsed["extracted_todos"].as_array() {
            for t in todos_arr {
                if let Some(t_content) = t["content"].as_str() {
                    extracted_todos.push(ExtractedTodo {
                        content: t_content.to_string(),
                        due_time: Self::normalize_due_time_str(
                            t["due_time"].as_str().map(|s| s.to_string()),
                        ),
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
                        reason: u["reason"]
                            .as_str()
                            .unwrap_or("根据最新日志更新")
                            .to_string(),
                        updated_content: u["updated_content"].as_str().map(|s| s.to_string()),
                        updated_due_time: Self::normalize_due_time_str(
                            u["updated_due_time"].as_str().map(|s| s.to_string()),
                        ),
                    });
                }
            }
        }

        println!("│ ──────────────── 解析与决策结果 ────────────────");
        println!("│ 动作判定: {}", action);
        println!("│ 置信度: {:.2}", confidence);
        if let Some(ref title) = matched_matter_title {
            println!(
                "│ 命中归集事项: 【{}】 (ID: {})",
                title,
                matched_matter_id.as_deref().unwrap_or("")
            );
        }
        if !candidate_matters.is_empty() {
            println!("│ 候选事项 ({} 项):", candidate_matters.len());
            for c in &candidate_matters {
                println!(
                    "│   • 【{}】 (匹配度: {:.0}%)",
                    c.title,
                    c.confidence * 100.0
                );
            }
        }
        if !extracted_todos.is_empty() {
            println!("│ 提取行动待办 ({} 项):", extracted_todos.len());
            for (idx, t) in extracted_todos.iter().enumerate() {
                println!(
                    "│   [{}] {} (截止: {})",
                    idx + 1,
                    t.content,
                    t.due_time.as_deref().unwrap_or("未指定")
                );
            }
        }
        if !todo_updates.is_empty() {
            println!("│ 建议更新/关闭待办 ({} 项):", todo_updates.len());
            for (idx, u) in todo_updates.iter().enumerate() {
                println!(
                    "│   [{}] 待办ID: {} | 动作: {} | 理由: '{}' | 原内容: '{}'",
                    idx + 1,
                    u.todo_id,
                    u.action,
                    u.reason,
                    u.original_content
                );
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
            detected_chat_target,
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

        // 通用跨行业泛化停用词（避免由于都含有这些词造成不同事项间误匹配）
        const STOP_WORDS: &[&str] = &[
            "任务", "工作", "事项", "项目", "沟通", "通知", "处理", "进行", "完成", "跟进", "汇报",
            "对接", "讨论", "关于", "相关", "推进", "执行", "落实", "协同", "记录", "内容", "方案",
            "文档", "材料", "表格", "清单", "计划", "测试", "要求",
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
                    if !win_clean.is_empty()
                        && (win_clean.contains(contact) || contact.contains(win_clean))
                    {
                        score += 0.90;
                        println!(
                            "│ │   -> 命中事项关联人/群: '{}' (窗口名: '{}')，加分 +0.90",
                            contact, win_clean
                        );
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
                            score += 0.45; // 命中事项独有的核心专有名词或项目代号
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
        let fallback_contacts =
            if !win_clean.is_empty() && win_clean != "微信" && win_clean != "未知应用" {
                Some(win_clean.to_string())
            } else {
                None
            };

        // 2. 规则提取待办行动项（事实沉淀已彻底移除，由总结与建议统一闭环）
        let todos = Self::extract_rules_todos(clean);
        let fact_delta: Option<String> = None;

        // 3. 规则检测是否核销/关闭待办
        let mut todo_updates = Vec::new();
        if let Some(m_ctx) = matched_matter {
            let finish_keywords = [
                "完成",
                "提交",
                "搞定",
                "交付",
                "做完",
                "完毕",
                "解决",
                "已发",
                "发了",
                "上线",
                "通过",
                "定稿",
                "已办",
                "办结",
                "处理好",
                "已处理",
                "已关闭",
                "已核销",
                "已返修",
            ];
            let has_finish_keyword = finish_keywords.iter().any(|k| clean.contains(k));
            if has_finish_keyword {
                for t in &m_ctx.pending_todos {
                    let key_terms: Vec<String> = t
                        .content
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
                            reason: format!(
                                "日志表明任务已完成/提交: {}",
                                clean.chars().take(20).collect::<String>()
                            ),
                            updated_content: None,
                            updated_due_time: None,
                        });
                        println!(
                            "│ │   -> [规则引擎] 识别到待办可关闭: 【{}】 (ID: {})",
                            t.content, t.id
                        );
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
            println!(
                "│ │ [决策结果] 明确归集到事项: 【{}】(得分: {:.2})",
                m.title, max_score
            );
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
                detected_chat_target: None,
            }
        } else if candidates.len() >= 2 {
            println!(
                "│ │ [决策结果] 存在多项模糊候选 (共 {} 项)",
                candidates.len()
            );
            println!("│ └──────────────────────────────────────────────────┘");
            AIParseResult {
                action: "AMBIGUOUS".to_string(),
                confidence: 0.55,
                matched_matter_id: None,
                matched_matter_title: None,
                candidate_matters: candidates,
                suggested_new_matter: Some(SuggestedMatter {
                    title: Self::generate_fallback_title(clean),
                    category: if clean.contains("买")
                        || clean.contains("家")
                        || clean.contains("生活")
                    {
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
                detected_chat_target: None,
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
                    category: if clean.contains("买")
                        || clean.contains("家")
                        || clean.contains("看电影")
                    {
                        "life".to_string()
                    } else {
                        "work".to_string()
                    },
                    priority: if clean.contains("紧急")
                        || clean.contains("马上")
                        || clean.contains("重要")
                    {
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
                detected_chat_target: None,
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
            } else if trimmed.len() == 10
                && trimmed.chars().nth(4) == Some('-')
                && trimmed.chars().nth(7) == Some('-')
            {
                Some(format!("{} 22:00:00", trimmed))
            } else {
                Some(trimmed.to_string())
            }
        })
    }

    fn generate_fallback_title(text: &str) -> String {
        let first_sentence = text
            .split(&['。', '！', '!', '？', '?', '\n', ';', '；'][..])
            .next()
            .unwrap_or(text);
        let trimmed = first_sentence.trim();
        if trimmed.chars().count() > 20 {
            format!("{}...", trimmed.chars().take(18).collect::<String>())
        } else if trimmed.is_empty() {
            "新事项".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn extract_rules_todos(text: &str) -> Vec<ExtractedTodo> {
        let now = Local::now();
        let mut todos = Vec::new();

        // 1. 拆解为行并过滤聊天记录噪音（发信人、时间戳等）
        let raw_lines: Vec<&str> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        let mut clean_sentences = Vec::new();

        for line in raw_lines {
            // 过滤聊天软件时间戳行，例如 "2026年09月23日 16:48"、"16:48"、"2026-09-23 16:48:00"
            if line.contains("年")
                && line.contains("月")
                && (line.contains("日") || line.contains("号"))
                && line.contains(":")
            {
                continue;
            }
            if line.len() <= 5 && line.contains(":") {
                continue;
            }
            // 过滤类似 "[文件] xxx.docx"、"[图片]"、"手机采集" 等单纯文件或过短标签行
            if line.starts_with("[文件]")
                || line.starts_with("[图片]")
                || line.starts_with("[语音]")
            {
                continue;
            }
            // 过滤过短的独立单行昵称/人名（避免发件人单行被误作为长正文分句）
            if line.chars().count() <= 3
                && !line.contains("做")
                && !line.contains("去")
                && !line.contains("改")
                && !line.contains("发")
            {
                continue;
            }

            // 进一步按中文句号、分号分句
            for s in line.split(&['。', '；', ';', '！', '!'][..]) {
                let trimmed = s.trim();
                if trimmed.chars().count() >= 4 {
                    clean_sentences.push(trimmed);
                }
            }
        }

        // 全行业职场高频行动词库（研发、运营、商务、财务、行政、设计、法务等通用）
        let action_words = [
            "提交",
            "完成",
            "发送",
            "确认",
            "汇报",
            "开会",
            "联系",
            "跟进",
            "整理",
            "打款",
            "购买",
            "核对",
            "上线",
            "对接",
            "催办",
            "索要",
            "审核",
            "审批",
            "交付",
            "验收",
            "签署",
            "对账",
            "报销",
            "发邮件",
            "更新",
            "同步",
            "安排",
            "反馈",
            "回复",
            "起草",
            "复盘",
            "测试",
            "部署",
            "发布",
            "采购",
            "催促",
            "催一下",
            "要一下",
            "问一下",
        ];

        for s in &clean_sentences {
            // 清理开头的 @xxx 和语气词
            let mut cleaned_s = s.to_string();
            if cleaned_s.starts_with('@') || cleaned_s.starts_with(' ') {
                if let Some(space_idx) =
                    cleaned_s.find(|c: char| c.is_whitespace() || c == ' ' || c == '，' || c == ' ')
                {
                    cleaned_s = cleaned_s[space_idx..].trim().to_string();
                }
            }

            // 识别该句的截止时间
            let mut item_due_time = None;
            if cleaned_s.contains("明天") {
                let tomorrow = now + Duration::days(1);
                let target = if cleaned_s.contains("下午") || cleaned_s.contains("18") {
                    tomorrow.date_naive().and_hms_opt(18, 0, 0)
                } else if cleaned_s.contains("上午") || cleaned_s.contains("10") {
                    tomorrow.date_naive().and_hms_opt(10, 0, 0)
                } else {
                    tomorrow.date_naive().and_hms_opt(18, 0, 0)
                };
                if let Some(t) = target {
                    item_due_time = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
                }
            } else if cleaned_s.contains("这两天")
                || cleaned_s.contains("2天内")
                || cleaned_s.contains("两天内")
            {
                let d = now + Duration::days(2);
                item_due_time = Some(d.format("%Y-%m-%d 18:00:00").to_string());
            } else if cleaned_s.contains("后天") {
                let d = now + Duration::days(2);
                item_due_time = Some(d.format("%Y-%m-%d 18:00:00").to_string());
            } else if cleaned_s.contains("下周")
                || cleaned_s.contains("周三")
                || cleaned_s.contains("星期三")
            {
                let d = now + Duration::days(3);
                item_due_time = Some(d.format("%Y-%m-%d 18:00:00").to_string());
            } else if cleaned_s.contains("今天") {
                let target = if cleaned_s.contains("下午") || cleaned_s.contains("18") {
                    now.date_naive().and_hms_opt(18, 0, 0)
                } else if cleaned_s.contains("上午") || cleaned_s.contains("10") {
                    now.date_naive().and_hms_opt(10, 0, 0)
                } else {
                    now.date_naive().and_hms_opt(22, 0, 0)
                };
                if let Some(t) = target {
                    item_due_time = Some(t.format("%Y-%m-%d %H:%M:%S").to_string());
                }
            }

            let has_action = action_words.iter().any(|kw| cleaned_s.contains(kw));
            if has_action || item_due_time.is_some() {
                let todo_title = if cleaned_s.chars().count() > 40 {
                    format!("{}...", cleaned_s.chars().take(38).collect::<String>())
                } else {
                    cleaned_s.clone()
                };

                // 去重
                if !todos
                    .iter()
                    .any(|t: &ExtractedTodo| t.content == todo_title)
                {
                    todos.push(ExtractedTodo {
                        content: todo_title,
                        due_time: item_due_time,
                    });
                }
            }
        }

        todos
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
        println!(
            "│ 关联人/群: {}",
            if matter_related_contacts.trim().is_empty() {
                "未配置"
            } else {
                matter_related_contacts
            }
        );
        println!(
            "│ 现有事实沉淀:\n│   {}",
            existing_facts.replace('\n', "\n│   ")
        );
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
            match Self::call_llm_summarize(
                config,
                matter_title,
                matter_overview,
                matter_related_contacts,
                existing_facts,
                logs,
            )
            .await
            {
                Ok(summary) => {
                    if !summary.trim().is_empty() {
                        println!(
                            "│ [提炼完成] 大模型提炼事实成果:\n│   {}",
                            summary.trim().replace('\n', "\n│   ")
                        );
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
        let local_summary =
            Self::local_summarize_facts(matter_title, matter_overview, existing_facts, logs);
        println!(
            "│ [规则提炼结果]:\n│   {}",
            local_summary.replace('\n', "\n│   ")
        );
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
            .timeout(StdDuration::from_secs(60))
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
- 归纳总结当前事项的核心推进现状、最新关键决定与共识、商务或财务核心约束（如预算报价、款项账期、交付规格、资源配置等）、以及明确的客观指标要求。
- 语言高度精炼，逻辑紧密，去除一切客套闲聊，每条以 "• " 开头。

【推进建议】
- 根据整体日志对当前事项的推进全貌，提出针对性、前瞻性、切实可行的专业建议（持续更新）。
- 重点包含：下一步应优先落实的关键动作、潜在风险预警与规避预案（如交付逾期风险、多方口径不一致风险、验收合规漏洞、资源断档等）、以及催办与跨部门协同对齐要点。
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
            matter_related_contacts = if matter_related_contacts.trim().is_empty() {
                "无"
            } else {
                matter_related_contacts
            }
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

        println!(
            "│ [LLM 提炼请求] 发送至: {} (模型: {})",
            url, config.model_name
        );

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

        let resp_text = resp
            .text()
            .await
            .map_err(|e| format!("读取响应体失败: {}", e))?;
        let resp_json: Value = serde_json::from_str(&resp_text).map_err(|e| {
            format!(
                "响应 JSON 解析失败: {} (内容: {})",
                e,
                resp_text.chars().take(200).collect::<String>()
            )
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
            if trimmed.contains("建议")
                || trimmed.contains("风险")
                || trimmed.contains("需关注")
                || trimmed.contains("防范")
            {
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
            suggestion_lines.push(
                "• 进度跟进: 建议关注本事项最新关键节点，及时与核心对接人锁定交付/核对明细。"
                    .to_string(),
            );
            suggestion_lines.push(
                "• 风险防范: 建议对关键指标与交付物进行抽样核查，防范质量偏差或口径不一致风险。"
                    .to_string(),
            );
        }

        format!(
            "【事项总结】\n{}\n\n【推进建议】\n{}",
            if summary_lines.is_empty() {
                format!(
                    "• 【{}】当前记录了 {} 条日志，整体进展顺利。",
                    matter_title,
                    logs.len()
                )
            } else {
                summary_lines.join("\n")
            },
            suggestion_lines.join("\n")
        )
    }
}
