use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants,
    UIA_ButtonControlTypeId, UIA_CustomControlTypeId, UIA_GroupControlTypeId,
    UIA_HeaderControlTypeId, UIA_ListItemControlTypeId, UIA_PaneControlTypeId,
    UIA_TextControlTypeId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetCursorPos, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GA_ROOT,
};

/// 过滤即时通讯软件中通用的系统保留控件、状态词与功能按钮
pub fn is_system_keyword(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return true;
    }

    // 排除包含换行（长正文内容）或超长的文本
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.chars().count() > 50 {
        return true;
    }

    let lower = trimmed.to_lowercase();

    // 排除内部窗口类名特征
    if lower.contains("mmuirender")
        || lower.contains("subwindow")
        || lower.contains("wechatmainwnd")
        || lower.contains("chatwnd")
        || lower.contains("sessionlistwnd")
        || lower.contains("contactmanager")
        || lower.contains("ftsmainwnd")
        || lower.contains("imagepreviewwnd")
        || lower.contains("chrome_widget")
        || lower.contains("qwindow")
        || lower.contains("qt5")
        || lower.starts_with("mmui")
    {
        return true;
    }

    // 排除纯时间格式（如 "16:52", "09:49"）
    if trimmed.len() <= 8 && trimmed.contains(':') {
        let is_time = trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || c == ':' || c == ' ');
        if is_time {
            return true;
        }
    }

    const SYSTEM_KEYWORDS: &[&str] = &[
        "微信",
        "wechat",
        "weixin",
        "聊天",
        "通讯录",
        "收藏",
        "朋友圈",
        "看一看",
        "搜一搜",
        "视频号",
        "小程序",
        "文件传输助手",
        "聊天信息",
        "发起群聊",
        "搜索",
        "最小化",
        "最大化",
        "还原",
        "关闭",
        "置顶",
        "取消置顶",
        "发送",
        "发送(s)",
        "表情",
        "发送文件",
        "截图",
        "聊天记录",
        "语音通话",
        "视频通话",
        "音视频通话",
        "更多",
        "设置",
        "切换账号",
        "退出",
        "按住鼠标 语音输入文字",
        "按住鼠标语音输入文字",
        "输入文字",
        "星期一",
        "星期二",
        "星期三",
        "星期四",
        "星期五",
        "星期六",
        "星期日",
        "昨天",
        "今天",
        "前天",
    ];

    for &kw in SYSTEM_KEYWORDS {
        if lower == kw {
            return true;
        }
    }
    false
}

/// 微信及即时通讯软件会话探测器（原生接口分层探测架构）
pub struct WechatDetector;

impl WechatDetector {
    /// 综合识别当前会话的群聊名称或联系人
    ///
    /// 现代化多层自适应探测模型：
    /// 1. Win32 原生独立窗口标题探测（零延迟、100% 精确）
    /// 2. 光标实时空间命中穿透探测（用户划选文字处精准锚定）
    /// 3. UI Automation 全局空间与特征融合加权评分（深度兼容微信 4.x Qt 与 3.x）
    /// 4. 划选文本自带聊天消息格式发件人提取
    /// 5. 优雅中立兜底与透明诊断追踪
    pub fn detect_chat_target(
        hwnd: HWND,
        raw_window_title: &str,
        selected_text: &str,
    ) -> String {
        println!("\n┌──────────────── 微信会话/群聊原生探测 ────────────────┐");
        let root_hwnd = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let target_hwnd = if !root_hwnd.0.is_null() {
            root_hwnd
        } else {
            hwnd
        };

        let raw_class = Self::get_window_class(hwnd);
        let root_class = Self::get_window_class(target_hwnd);
        let trimmed_title = raw_window_title.trim();
        println!("│ 前台 HWND: {:?}, 类名: '{}', 原生标题: '{}'", hwnd.0, raw_class, trimmed_title);
        if hwnd != target_hwnd {
            println!("│ 宿主 HWND: {:?}, 类名: '{}'", target_hwnd.0, root_class);
        }

        // 1. 优先检查独立聊天窗口的原生标题
        if let Some(independent_title) = Self::detect_independent_window_title(hwnd, target_hwnd, trimmed_title) {
            println!("│ [探测成功 (Layer 1)] 从独立窗口原生标题获取: '{}'", independent_title);
            println!("└───────────────────────────────────────────────────────┘");
            return independent_title;
        }

        // 2. 检查光标命中与焦点空间探测（Layer 2）
        if let Some(cursor_title) = Self::detect_from_cursor_point(target_hwnd) {
            println!("│ [探测成功 (Layer 2)] 从光标悬停上下文获取: '{}'", cursor_title);
            println!("└───────────────────────────────────────────────────────┘");
            return cursor_title;
        }

        // 3. UI Automation 智能语义加权空间评分扫描（Layer 3）
        // 优先在前台子窗口扫描，若无再在宿主窗口扫描
        if let Some(uia_title) = Self::detect_from_ui_automation(hwnd) {
            println!("│ [探测成功 (Layer 3)] 从前台窗口 UI Automation 获取: '{}'", uia_title);
            println!("└───────────────────────────────────────────────────────┘");
            return uia_title;
        }

        if hwnd != target_hwnd {
            if let Some(uia_root_title) = Self::detect_from_ui_automation(target_hwnd) {
                println!("│ [探测成功 (Layer 3)] 从宿主窗口 UI Automation 获取: '{}'", uia_root_title);
                println!("└───────────────────────────────────────────────────────┘");
                return uia_root_title;
            }
        }

        // 4. 从划选文本自带的聊天消息格式中提取发件人/成员昵称（Layer 4）
        if let Some(sender) = Self::detect_sender_from_text(selected_text) {
            println!("│ [探测成功 (Layer 4)] 从划选文本消息格式获取发件人: '{}'", sender);
            println!("└───────────────────────────────────────────────────────┘");
            return sender;
        }

        // 5. 优雅中立兜底：返回“微信”，交由下游大模型语义路由引擎结合事项关联人/群做精准归集
        let fallback = if !trimmed_title.is_empty() && !is_system_keyword(trimmed_title) {
            trimmed_title.to_string()
        } else {
            "微信".to_string()
        };
        println!("│ [未探得明确群名] 优雅使用中立标识: '{}' (交由AI语义路由引擎)", fallback);
        println!("└───────────────────────────────────────────────────────┘");
        fallback
    }

    /// Layer 1: 检查是否为独立聊天窗口，并获取原生标题
    fn detect_independent_window_title(
        hwnd: HWND,
        target_hwnd: HWND,
        trimmed_title: &str,
    ) -> Option<String> {
        let raw_class_lower = Self::get_window_class(hwnd).to_lowercase();
        let root_class_lower = Self::get_window_class(target_hwnd).to_lowercase();

        // 排除纯主窗口框架及内部自绘子窗口
        let is_main_or_subwnd = raw_class_lower.contains("subwindow")
            || raw_class_lower.contains("mmuirender")
            || raw_class_lower.contains("wechatmainwnd")
            || root_class_lower.contains("wechatmainwnd");

        if is_main_or_subwnd {
            return None;
        }

        let title_to_check = if !trimmed_title.is_empty() {
            trimmed_title.to_string()
        } else {
            Self::get_window_title(target_hwnd)
        };

        if title_to_check.is_empty()
            || is_system_keyword(&title_to_check)
            || title_to_check.starts_with("图片查看")
            || title_to_check.starts_with("微信（")
        {
            return None;
        }

        let clean = title_to_check
            .trim_end_matches(" - 微信")
            .trim_end_matches(" - WeChat")
            .trim();

        if !clean.is_empty() && !is_system_keyword(clean) {
            Some(clean.to_string())
        } else {
            None
        }
    }

    /// Layer 2: 基于光标位置命中穿透（Cursor Hit-Test）探测当前聊天上下文
    fn detect_from_cursor_point(win_hwnd: HWND) -> Option<String> {
        unsafe {
            let mut pt: POINT = std::mem::zeroed();
            if GetCursorPos(&mut pt).is_err() {
                return None;
            }

            let mut win_rect: RECT = std::mem::zeroed();
            if GetWindowRect(win_hwnd, &mut win_rect).is_err() {
                return None;
            }

            // 确保光标落在微信窗口内部
            if pt.x < win_rect.left || pt.x > win_rect.right || pt.y < win_rect.top || pt.y > win_rect.bottom {
                return None;
            }

            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let hit_elem: IUIAutomationElement = uia.ElementFromPoint(pt).ok()?;

            let walker = uia.ControlViewWalker().ok()?;
            let mut current = hit_elem;

            // 沿着父链向上追溯至多 6 层，检查是否有直接携带群名/会话名的容器或同级控件
            for _ in 0..6 {
                if let Ok(parent) = walker.GetParentElement(&current) {
                    if let Ok(name_bstr) = parent.CurrentName() {
                        let name_str = name_bstr.to_string();
                        let clean = name_str.trim();
                        if !clean.is_empty() && !is_system_keyword(clean) {
                            let score = Self::score_candidate_element(clean, win_rect, win_rect, 0);
                            if score >= 50 {
                                return Some(clean.to_string());
                            }
                        }
                    }
                    current = parent;
                } else {
                    break;
                }
            }

            None
        }
    }

    /// Layer 3: 基于 UI Automation 智能加权评分架构探测会话标题与会话项
    fn detect_from_ui_automation(hwnd: HWND) -> Option<String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                Ok(u) => u,
                Err(e) => {
                    println!("│ [UIA 警告] CoCreateInstance 失败: {:?}", e);
                    return None;
                }
            };

            let root_elem: IUIAutomationElement = match uia.ElementFromHandle(hwnd) {
                Ok(el) => el,
                Err(e) => {
                    println!("│ [UIA 警告] ElementFromHandle 失败: {:?}", e);
                    return None;
                }
            };

            let mut win_rect: RECT = std::mem::zeroed();
            let _ = GetWindowRect(hwnd, &mut win_rect);
            let win_w = win_rect.right - win_rect.left;
            let win_h = win_rect.bottom - win_rect.top;

            if win_w < 200 || win_h < 150 {
                return None;
            }

            let true_cond = uia.CreateTrueCondition().ok()?;
            let elements = match root_elem.FindAll(TreeScope_Descendants, &true_cond) {
                Ok(els) => els,
                Err(e) => {
                    println!("│ [UIA 警告] FindAll Descendants 失败: {:?}", e);
                    return None;
                }
            };

            let count = elements.Length().unwrap_or(0);
            if count == 0 {
                return None;
            }

            let scan_limit = count.min(500);
            let mut best_candidate: Option<(String, i32)> = None;

            for i in 0..scan_limit {
                let elem = match elements.GetElement(i) {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let name = match elem.CurrentName() {
                    Ok(bstr) => bstr.to_string(),
                    Err(_) => continue,
                };

                let clean = name.trim();
                if clean.is_empty() || is_system_keyword(clean) {
                    continue;
                }

                let ctrl_type = elem.CurrentControlType().map(|c| c.0).unwrap_or(0);
                let elem_rect = elem.CurrentBoundingRectangle().unwrap_or_default();

                let score = Self::score_candidate_element(clean, elem_rect, win_rect, ctrl_type);

                if score > 0 {
                    match &best_candidate {
                        Some((_, best_score)) => {
                            if score > *best_score {
                                best_candidate = Some((clean.to_string(), score));
                            }
                        }
                        None => {
                            best_candidate = Some((clean.to_string(), score));
                        }
                    }
                }
            }

            if let Some((title, score)) = best_candidate {
                if score >= 35 {
                    println!("│ [UIA 命中] 最佳会话候选: '{}' (加权得分: {})", title, score);
                    return Some(title);
                }
            }

            None
        }
    }

    /// 通用空间与语义特征加权评分函数
    ///
    /// 综合考虑：
    /// 1. 业务标识特征（群人数后缀、项目方括号、人名顿号等极高置信度标志）
    /// 2. 界面空间位置（窗口顶部标题栏、左侧激活会话列表、排除底部输入框与右侧控制区）
    /// 3. 控件类型宽容适配（不仅支持 Text/Button，还兼容 Qt 5.15 的 Custom/Pane/Group）
    pub fn score_candidate_element(
        name: &str,
        elem_rect: RECT,
        win_rect: RECT,
        ctrl_type: i32,
    ) -> i32 {
        let clean = name.trim();
        if clean.is_empty() || is_system_keyword(clean) {
            return -1000;
        }

        let char_count = clean.chars().count();
        if char_count < 2 || char_count > 50 {
            return -1000;
        }

        let mut score = 10; // 基础通过分

        // 1. 群特征/业务特征（极高置信度）
        // 带有群人数特征，如 (7), （12）, [5]
        if (clean.contains('(') && clean.contains(')'))
            || (clean.contains('（') && clean.contains('）'))
            || (clean.contains('[') && clean.contains(']'))
        {
            score += 60;
        }

        // 带有项目/商务专属方括号 【...】
        if clean.contains('【') && clean.contains('】') {
            score += 50;
        }

        // 包含人名顿号（常见于微信多人未命名的临时讨论组，如 "陈浩、兰斌、陈祺"）
        if clean.contains('、') {
            score += 35;
        }

        // 2. 空间位置评分
        let win_w = (win_rect.right - win_rect.left).max(1);
        let win_h = (win_rect.bottom - win_rect.top).max(1);

        let rel_left = elem_rect.left - win_rect.left;
        let rel_top = elem_rect.top - win_rect.top;
        let elem_w = elem_rect.right - elem_rect.left;
        let elem_h = elem_rect.bottom - elem_rect.top;

        // 元素尺寸合理性
        if elem_w >= 10 && elem_h >= 8 && elem_h <= 90 {
            // A. 顶部标题栏区域（Y 在 0~150px，X 偏中偏右）
            let max_header_top = (win_h as f64 * 0.22).clamp(50.0, 150.0) as i32;
            if rel_top >= 0 && rel_top <= max_header_top {
                if rel_left >= 100 && rel_left <= (win_w - 120) {
                    score += 50; // 标准聊天区顶部标题
                } else if rel_left >= 40 {
                    score += 30; // 偏左顶部标题
                }
            }

            // B. 左侧会话列表区域（X 在 40~360px，Y 在 50~列表区）
            if rel_left >= 40 && rel_left <= (win_w as f64 * 0.40).max(320.0) as i32 {
                if rel_top >= 50 && rel_top <= (win_h - 60) {
                    score += 25; // 位于会话列表中
                }
            }
        }

        // 3. 控件类型微调加分（兼容 Qt 5.15 的 Custom/Pane）
        if ctrl_type == UIA_TextControlTypeId.0
            || ctrl_type == UIA_ButtonControlTypeId.0
            || ctrl_type == UIA_HeaderControlTypeId.0
            || ctrl_type == UIA_ListItemControlTypeId.0
        {
            score += 15;
        } else if ctrl_type == UIA_CustomControlTypeId.0
            || ctrl_type == UIA_PaneControlTypeId.0
            || ctrl_type == UIA_GroupControlTypeId.0
        {
            score += 10;
        }

        // 4. 惩罚项
        // 最底部输入框/状态栏
        if rel_top > (win_h - 150) {
            score -= 50;
        }
        // 最右侧窗口关闭/最小化按钮区
        if rel_left > (win_w - 110) && rel_top < 50 {
            score -= 60;
        }
        // 最左侧微型图标导航栏
        if rel_left < 55 {
            score -= 40;
        }

        score
    }

    /// Layer 4: 从划选文本的聊天记录格式中分析发件人昵称或说话人
    pub fn detect_sender_from_text(text: &str) -> Option<String> {
        let lines: Vec<&str> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();

        if lines.is_empty() {
            return None;
        }

        let first_line = lines[0];

        // 模式 A: 微信标准多行复制格式（第一行为发件人昵称，第二行为日期时间戳）
        // 例如：
        // 王经理@远大智造
        // 2026年09月23日 15:15
        // 正文...
        if lines.len() >= 2 {
            let second_line = lines[1].trim();
            let is_timestamp = second_line.contains(':')
                && (second_line.contains('年')
                    || second_line.contains('-')
                    || second_line.contains('/')
                    || second_line.chars().all(|c| c.is_ascii_digit() || c == ':' || c == ' '));
            if is_timestamp {
                let sender = lines[0].trim();
                if !sender.is_empty() && sender.chars().count() <= 35 && !is_system_keyword(sender) {
                    return Some(sender.to_string());
                }
            }
        }

        // 模式 B: 单行带时间格式 "张三 2026-09-21 17:31:32" 或 "李四 17:31:00"
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            let last_part = parts.last().unwrap();
            let is_time_tail = last_part.contains(':')
                || last_part.chars().all(|c| c.is_ascii_digit());
            if is_time_tail {
                // 如果倒数第二部分也是日期（如 "2026-09-21 17:31:32"）
                let name_end_idx = if parts.len() >= 3
                    && (parts[parts.len() - 2].contains('-')
                        || parts[parts.len() - 2].contains('/')
                        || parts[parts.len() - 2].contains('年'))
                {
                    parts.len() - 2
                } else {
                    parts.len() - 1
                };
                let sender = parts[0..name_end_idx].join(" ");
                if !sender.is_empty() && sender.chars().count() <= 35 && !is_system_keyword(&sender) {
                    return Some(sender);
                }
            }
        }

        // 模式 C: 单行冒号发言格式 "张三: 正文内容" 或 "张三：正文内容"
        if let Some(colon_pos) = first_line.find(':').or_else(|| first_line.find('：')) {
            let sender = first_line[..colon_pos].trim();
            let is_time_colon = sender.chars().last().map(|c| c.is_ascii_digit()).unwrap_or(false);
            if !is_time_colon && !sender.is_empty() && sender.chars().count() <= 35 && !is_system_keyword(sender) {
                return Some(sender.to_string());
            }
        }

        None
    }

    /// 获取窗口类名
    fn get_window_class(hwnd: HWND) -> String {
        unsafe {
            let mut class_buf = vec![0u16; 256];
            let len = GetClassNameW(hwnd, &mut class_buf);
            if len > 0 {
                String::from_utf16_lossy(&class_buf[..len as usize])
            } else {
                String::new()
            }
        }
    }

    /// 获取窗口原生标题
    fn get_window_title(hwnd: HWND) -> String {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len > 0 {
                let mut buf = vec![0u16; (len + 1) as usize];
                let read_len = GetWindowTextW(hwnd, &mut buf);
                if read_len > 0 {
                    return String::from_utf16_lossy(&buf[..read_len as usize]);
                }
            }
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::Accessibility::UIA_TextControlTypeId;

    #[test]
    fn test_system_keywords_filter() {
        assert!(is_system_keyword("微信"));
        assert!(is_system_keyword("设置"));
        assert!(is_system_keyword("ChatWnd"));
        assert!(is_system_keyword("按住鼠标 语音输入文字"));
        assert!(is_system_keyword("16:52"));
        assert!(is_system_keyword("09:49"));
        assert!(!is_system_keyword("华东供应链二期 (11)"));
        assert!(!is_system_keyword("项目交付攻坚群"));
        assert!(!is_system_keyword("张三"));
    }

    #[test]
    fn test_candidate_scoring() {
        let win_rect = RECT { left: 100, top: 100, right: 1100, bottom: 800 }; // 1000x700 窗口

        // 标准群聊标题（带人数，带方括号，位于顶部标题栏）
        let elem_group = RECT { left: 450, top: 140, right: 700, bottom: 175 };
        let score_group = WechatDetector::score_candidate_element(
            "【标贝-曦瀚】潮汕话标注对接 (7)",
            elem_group,
            win_rect,
            UIA_TextControlTypeId.0,
        );
        assert!(score_group > 100, "带人数和方括号的群名应获得超高分: {}", score_group);

        // 普通联系人名字（位于顶部标题栏）
        let elem_person = RECT { left: 450, top: 140, right: 550, bottom: 175 };
        let score_person = WechatDetector::score_candidate_element(
            "王经理",
            elem_person,
            win_rect,
            UIA_TextControlTypeId.0,
        );
        assert!(score_person >= 50, "顶部联系人标题应获得及格以上分数: {}", score_person);

        // 位于底部的无关文本
        let elem_bottom = RECT { left: 450, top: 650, right: 700, bottom: 685 };
        let score_bottom = WechatDetector::score_candidate_element(
            "发送文件",
            elem_bottom,
            win_rect,
            UIA_TextControlTypeId.0,
        );
        assert!(score_bottom < 0, "系统词或底部文本应被淘汰: {}", score_bottom);
    }

    #[test]
    fn test_detect_sender_from_text() {
        let snippet_multiline = "王经理@远大智造\n2026年09月23日 15:15\n下午接口联调完成提交测试";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet_multiline),
            Some("王经理@远大智造".to_string())
        );

        let snippet1 = "张三 2026-09-21 17:31:32\n下午我会重点检查进度";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet1),
            Some("张三".to_string())
        );

        let snippet2 = "李总监: 下午我会重点核对明细";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet2),
            Some("李总监".to_string())
        );

        let snippet3 = "下午我会重点检查进度";
        assert_eq!(WechatDetector::detect_sender_from_text(snippet3), None);
    }
}
