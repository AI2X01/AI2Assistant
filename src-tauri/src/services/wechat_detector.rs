use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants,
    UIA_ButtonControlTypeId, UIA_ListItemControlTypeId, UIA_TextControlTypeId,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GA_ROOT,
};

/// 过滤微信中常见的固定系统控件、内部类名、状态词与按钮名称
pub fn is_system_keyword(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return true;
    }

    // 排除包含换行（长消息内容）或超长的文本
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.len() > 60 {
        return true;
    }

    // 排除纯时间格式（如 "16:52", "09:49", "15:44"）
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
        "mmuirendersubwindow",
        "wechatmainwndforpc",
        "chatwnd",
        "sessionlistwnd",
        "contactmanagerwindow",
        "ftsmainwnd",
        "imagepreviewwnd",
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
        "关闭",
        "置顶",
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

    let lower = trimmed.to_lowercase();
    for &kw in SYSTEM_KEYWORDS {
        if lower == kw {
            return true;
        }
    }
    false
}

/// 微信对话对象与群聊名称探测器
pub struct WechatDetector;

impl WechatDetector {
    /// 综合识别当前微信的聊天对象或群名称
    pub fn detect_chat_target(
        hwnd: HWND,
        raw_window_title: &str,
        selected_text: &str,
    ) -> String {
        println!("\n┌──────────────── 微信会话/群聊探测 ────────────────┐");
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
        println!("│ 宿主 HWND: {:?}, 类名: '{}'", target_hwnd.0, root_class);

        // 1. 检查独立聊天窗口（ChatWnd 或非系统保留标题的独立窗口）
        if !trimmed_title.is_empty()
            && !is_system_keyword(trimmed_title)
            && !trimmed_title.starts_with("图片查看")
            && !trimmed_title.starts_with("微信（")
        {
            let clean = trimmed_title
                .trim_end_matches(" - 微信")
                .trim_end_matches(" - WeChat")
                .trim();
            if !clean.is_empty() && !is_system_keyword(clean) {
                println!("│ [匹配] 从窗口原生标题直接提取成功: '{}'", clean);
                println!("└───────────────────────────────────────────────────┘");
                return clean.to_string();
            }
        }

        // 如果明确是独立聊天窗口类名 ChatWnd
        if root_class == "ChatWnd" || raw_class == "ChatWnd" {
            let win_text = Self::get_window_title(target_hwnd);
            let clean = win_text
                .trim_end_matches(" - 微信")
                .trim_end_matches(" - WeChat")
                .trim();
            if !clean.is_empty() && !is_system_keyword(clean) {
                println!("│ [匹配] 从独立聊天窗口(ChatWnd)标题提取成功: '{}'", clean);
                println!("└───────────────────────────────────────────────────┘");
                return clean.to_string();
            }
        }

        // 2. 核心：通过 UI Automation 深入扫描微信主窗口控件树提取会话/群聊名称
        if let Some(target_from_uia) = Self::detect_from_ui_automation(target_hwnd) {
            if !is_system_keyword(&target_from_uia) {
                println!("│ [匹配] 从 UI Automation 控件树探测成功: '{}'", target_from_uia);
                println!("└───────────────────────────────────────────────────┘");
                return target_from_uia;
            }
        }

        // 3. 若宿主未探测到且前台窗口与宿主不同，针对前台子窗口再试一次
        if hwnd != target_hwnd {
            if let Some(target_from_sub) = Self::detect_from_ui_automation(hwnd) {
                if !is_system_keyword(&target_from_sub) {
                    println!("│ [匹配] 从子窗口 UI Automation 探测成功: '{}'", target_from_sub);
                    println!("└───────────────────────────────────────────────────┘");
                    return target_from_sub;
                }
            }
        }

        // 4. 从选中文本的聊天格式中兜底分析发件人/群前缀
        if let Some(sender) = Self::detect_sender_from_text(selected_text) {
            if !is_system_keyword(&sender) {
                println!("│ [兜底] 从划选文本聊天格式分析发件人: '{}'", sender);
                println!("└───────────────────────────────────────────────────┘");
                return sender;
            }
        }

        // 5. 兜底返回有效标题，否则返回 "微信"
        let fallback = if !trimmed_title.is_empty() && !is_system_keyword(trimmed_title) {
            trimmed_title.to_string()
        } else {
            "微信".to_string()
        };
        println!("│ [未探得明确群名] 兜底使用: '{}'", fallback);
        println!("└───────────────────────────────────────────────────┘");
        fallback
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

    /// 基于 UI Automation COM 接口与视觉布局特征评分算法探测微信聊天/群名称
    fn detect_from_ui_automation(hwnd: HWND) -> Option<String> {
        unsafe {
            // 初始化 COM 运行环境
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            // 创建 UI Automation 实例
            let uia: IUIAutomation = match CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                Ok(instance) => instance,
                Err(e) => {
                    println!("│ [UIA] 创建 IUIAutomation 失败: {:?}", e);
                    return None;
                }
            };

            // 获取窗口根元素
            let root_elem: IUIAutomationElement = match uia.ElementFromHandle(hwnd) {
                Ok(elem) => elem,
                Err(e) => {
                    println!("│ [UIA] ElementFromHandle 失败: {:?}", e);
                    return None;
                }
            };

            // 获取宿主窗口的物理包围盒，用于相对坐标计算
            let mut win_rect: RECT = std::mem::zeroed();
            let _ = GetWindowRect(hwnd, &mut win_rect);
            let win_width = (win_rect.right - win_rect.left).max(400);

            // 创建无条件匹配查找全部后代控件
            let true_cond = match uia.CreateTrueCondition() {
                Ok(c) => c,
                Err(_) => return None,
            };

            let elements = match root_elem.FindAll(TreeScope_Descendants, &true_cond) {
                Ok(arr) => arr,
                Err(e) => {
                    println!("│ [UIA] FindAll 失败: {:?}", e);
                    return None;
                }
            };

            let count = elements.Length().unwrap_or(0);
            if count == 0 {
                println!("│ [UIA] 遍历后代控件数量为 0");
                return None;
            }

            let mut best_name: Option<String> = None;
            let mut max_score = 0;

            // 扫描上限提高至 800 个控件，确保覆盖深层标题与选中项
            let scan_limit = count.min(800);
            let mut top_candidates: Vec<(String, i32, i32, i32)> = Vec::new();

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

                // 获取元素的物理矩形坐标 (x, y, w, h)
                let elem_rect = elem.CurrentBoundingRectangle().unwrap_or_default();
                let rel_top = elem_rect.top - win_rect.top;
                let rel_left = elem_rect.left - win_rect.left;

                let score = Self::calculate_chat_target_score(
                    clean,
                    ctrl_type,
                    rel_top,
                    rel_left,
                    win_width,
                );

                if score > 0 {
                    top_candidates.push((clean.to_string(), score, rel_left, rel_top));
                }

                // 如果命中极高置信度（如明确带有群成员人数 "潮汕话标注群 (18)"），立即采纳
                if score >= 1000 {
                    println!("│ [UIA 满分命中] 名称: '{}', 得分: {}, rel_pos: ({}, {})", clean, score, rel_left, rel_top);
                    return Some(clean.to_string());
                }

                if score > max_score {
                    max_score = score;
                    best_name = Some(clean.to_string());
                }
            }

            // 按得分排序输出前 3 个探测到的候选项供排查
            top_candidates.sort_by(|a, b| b.1.cmp(&a.1));
            if !top_candidates.is_empty() {
                println!("│ [UIA 候选排查] 扫描 {} 元素，前 {} 个有效候选:", scan_limit, top_candidates.len().min(3));
                for (name, sc, l, t) in top_candidates.iter().take(3) {
                    println!("│   ├ 得分 {:4} | 相对坐标 ({:4}, {:4}) | 候选名: '{}'", sc, l, t, name);
                }
            } else {
                println!("│ [UIA 候选排查] 扫描 {} 个元素，未发现非系统控件文本", scan_limit);
            }

            if max_score >= 180 {
                best_name
            } else {
                None
            }
        }
    }

    /// 针对元素名称、控件类型和在微信主窗口内的布局位置进行多维度综合评分
    pub fn calculate_chat_target_score(
        name: &str,
        ctrl_type: i32,
        rel_top: i32,
        rel_left: i32,
        win_width: i32,
    ) -> i32 {
        if is_system_keyword(name) {
            return 0;
        }

        let mut score = 0;

        // 特征 1：群聊名称带人数后缀，如 "(11)"、"（15）"、"[32]"
        let has_member_count = (name.contains('(') && name.ends_with(')'))
            || (name.contains('（') && name.ends_with('）'))
            || (name.contains('[') && name.ends_with(']'));

        if has_member_count {
            score += 800;
        }

        // 特征 2：位于微信顶部会话标题区域（Y 在 10px ~ 130px 之间，X 在左侧栏右方 rel_left >= 160 或 win_width 的 1/5 以上）
        let is_header_area = rel_top >= 10 && rel_top <= 130 && (rel_left >= 160 || rel_left > (win_width / 5));
        if is_header_area {
            score += 500;
        }

        // 特征 3：常见群聊、项目或业务特征词（如“群”、“组”、“标注”、“项目”、“翻译”、“质检”、“语”、“交流”、“团队”、“工作”）
        let group_keywords = ["群", "组", "标注", "项目", "翻译", "质检", "语", "交流", "团队", "工作", "中心", "交付", "测试"];
        for kw in &group_keywords {
            if name.contains(kw) {
                score += 350;
                break;
            }
        }

        // 特征 4：控件类型偏好（微信顶部标题通常为 Text 或 Button）
        if ctrl_type == UIA_ButtonControlTypeId.0 || ctrl_type == UIA_TextControlTypeId.0 {
            score += 150;
        } else if ctrl_type == UIA_ListItemControlTypeId.0 {
            // 左侧会话栏选中的会话项
            score += 200;
        }

        // 特征 5：合理字符长度（2 到 35 字之间最常见）
        if name.chars().count() >= 2 && name.chars().count() <= 35 {
            score += 100;
        }

        score
    }

    /// 从划选内容分析发件人昵称或群名前缀
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

        // 模式 0: 微信消息复制格式，如 "[群聊: 潮汕话标注群]" 或 "【潮汕话标注群】"
        if (first_line.starts_with('【') && first_line.contains('】'))
            || (first_line.starts_with('[') && first_line.contains(']'))
        {
            let end_idx = first_line.find(&['】', ']'][..]).unwrap_or(0);
            let inside = &first_line[1..end_idx].trim();
            let clean = inside.trim_start_matches("群聊:").trim_start_matches("群聊：").trim();
            if !clean.is_empty() && clean.chars().count() <= 30 && !is_system_keyword(clean) {
                return Some(clean.to_string());
            }
        }

        // 模式 1: "张三 2026-09-21 17:31" 或 "李四 17:31:00"
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            let last_part = parts.last().unwrap();
            if last_part.contains(':') && parts[0].len() <= 20 {
                return Some(parts[0].to_string());
            }
        }

        // 模式 2: "张三: 具体内容" 或 "张三：具体内容"
        if let Some((sender, _)) = first_line.split_once(':') {
            let s = sender.trim();
            if !s.is_empty() && s.len() <= 20 && !s.contains('\n') {
                return Some(s.to_string());
            }
        }
        if let Some((sender, _)) = first_line.split_once('：') {
            let s = sender.trim();
            if !s.is_empty() && s.len() <= 20 && !s.contains('\n') {
                return Some(s.to_string());
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_keywords_filter() {
        assert!(is_system_keyword("微信"));
        assert!(is_system_keyword("WeChat"));
        assert!(is_system_keyword("MMUIRenderSubWindow"));
        assert!(is_system_keyword("WeChatMainWndForPC"));
        assert!(is_system_keyword("ChatWnd"));
        assert!(is_system_keyword("按住鼠标 语音输入文字"));
        assert!(is_system_keyword("16:52"));
        assert!(is_system_keyword("09:49"));
        assert!(!is_system_keyword("信实-西语 (11)"));
        assert!(!is_system_keyword("广州鸿图-信实翻译公司-西语标注"));
        assert!(!is_system_keyword("11国小语种"));
        assert!(!is_system_keyword("张三"));
    }

    #[test]
    fn test_calculate_chat_target_score() {
        // 群聊带人数且在顶部标题区域：满分级
        let score_group = WechatDetector::calculate_chat_target_score(
            "信实-西语 (11)",
            UIA_TextControlTypeId.0,
            40,
            450,
            1200,
        );
        assert!(score_group >= 1000);

        // 系统关键词如 MMUIRenderSubWindow 或 输入文字：0 分
        let score_sys = WechatDetector::calculate_chat_target_score(
            "MMUIRenderSubWindow",
            UIA_ButtonControlTypeId.0,
            40,
            450,
            1200,
        );
        assert_eq!(score_sys, 0);

        // 普通联系人姓名在顶部标题区域：高分通过
        let score_user = WechatDetector::calculate_chat_target_score(
            "李棠佳",
            UIA_ButtonControlTypeId.0,
            45,
            500,
            1200,
        );
        assert!(score_user >= 600);
    }

    #[test]
    fn test_detect_sender_from_text() {
        let snippet1 = "张三 2026-09-21 17:31:32\n下午我会重点检查下练习的情况哈";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet1),
            Some("张三".to_string())
        );

        let snippet2 = "李棠佳: 下午我会重点检查下练习的情况哈";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet2),
            Some("李棠佳".to_string())
        );

        let snippet3 = "下午我会重点检查下练习的情况哈";
        assert_eq!(WechatDetector::detect_sender_from_text(snippet3), None);
    }
}

