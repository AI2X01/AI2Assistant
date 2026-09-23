use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
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
use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

/// 过滤微信中常见的固定系统控件、内部类名、状态词与按钮名称
pub fn is_system_keyword(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return true;
    }

    // 排除包含换行（长消息内容）或超长的文本
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.chars().count() > 50 {
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
        "qt51514qwindowicon",
        "chrome_widgetwin_0",
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

        // 1. 检查独立聊天窗口原生标题（微信 3.x ChatWnd 或带有明确会话标题的窗口）
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
                println!("│ [匹配 1/4] 从窗口原生标题直接提取成功: '{}'", clean);
                println!("└───────────────────────────────────────────────────┘");
                return clean.to_string();
            }
        }

        // 2. 核心重点：Windows 原生离线 OCR 视觉感知引擎（专克微信 4.x Qt 自绘无边框黑盒窗口）
        // 微信 4.x 采用 Qt5 自绘架构，操作系统无法通过 UI 树获取文字，但顶部标题栏在屏幕上清晰可见
        if let Some(target_from_ocr) = Self::detect_from_visual_ocr(target_hwnd) {
            if !is_system_keyword(&target_from_ocr) {
                println!("│ [匹配 2/4] 从微信顶部自绘标题栏视觉 OCR 识别成功: '{}'", target_from_ocr);
                println!("└───────────────────────────────────────────────────┘");
                return target_from_ocr;
            }
        }

        // 若宿主窗口与前台子窗口不同，针对前台子窗口也尝试一次视觉识别
        if hwnd != target_hwnd {
            if let Some(target_from_ocr_sub) = Self::detect_from_visual_ocr(hwnd) {
                if !is_system_keyword(&target_from_ocr_sub) {
                    println!("│ [匹配 2/4] 从子窗口顶部自绘标题视觉 OCR 识别成功: '{}'", target_from_ocr_sub);
                    println!("└───────────────────────────────────────────────────┘");
                    return target_from_ocr_sub;
                }
            }
        }

        // 3. 通过 UI Automation 扫描微信窗口控件树（兼容微信 3.x 或已开启 Accessibility 的客户端）
        if let Some(target_from_uia) = Self::detect_from_ui_automation(target_hwnd) {
            if !is_system_keyword(&target_from_uia) {
                println!("│ [匹配 3/4] 从 UI Automation 控件树探测成功: '{}'", target_from_uia);
                println!("└───────────────────────────────────────────────────┘");
                return target_from_uia;
            }
        }

        // 4. 从选中文本的聊天格式中兜底分析发件人/群前缀（支持多行微信复制带时间戳格式与单行消息格式）
        if let Some(sender) = Self::detect_sender_from_text(selected_text) {
            if !is_system_keyword(&sender) {
                println!("│ [匹配 4/4] 从划选文本聊天格式分析发件人: '{}'", sender);
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
    #[allow(dead_code)]
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

    /// 基于 Windows 原生离线 OCR 识别微信顶部自绘标题栏
    pub fn detect_from_visual_ocr(hwnd: HWND) -> Option<String> {
        unsafe {
            // 确保当前调用线程已初始化多线程 COM 环境（tokio worker 线程默认未初始化）
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_err() {
                println!("│ [OCR] GetWindowRect 获取失败");
                return None;
            }

            let win_w = rect.right - rect.left;
            let win_h = rect.bottom - rect.top;
            if win_w < 200 || win_h < 150 {
                println!("│ [OCR] 窗口尺寸过小: {}x{}", win_w, win_h);
                return None;
            }

            // 截取顶部标题区域：
            // 微信独立窗口标题位于 Y 15~55px，主窗口合并模式标题位于 Y 55~110px
            // 因此截取高度设为 110px，完美兼顾两种窗口模式
            let crop_w = (win_w - 160).clamp(250, 950);
            let crop_h = 110.min(win_h);

            let hdc_screen = GetDC(HWND(std::ptr::null_mut()));
            if hdc_screen.0.is_null() {
                println!("│ [OCR] GetDC 屏幕句柄失败");
                return None;
            }

            let hdc_mem = CreateCompatibleDC(hdc_screen);
            let hbm = CreateCompatibleBitmap(hdc_screen, crop_w, crop_h);
            let old_bm = SelectObject(hdc_mem, hbm);

            // 屏幕坐标防负数（最大化窗口物理坐标通常带 -7px 边框）
            let src_x = rect.left.max(0);
            let src_y = rect.top.max(0);

            let blt_res = BitBlt(hdc_mem, 0, 0, crop_w, crop_h, hdc_screen, src_x, src_y, SRCCOPY);
            if blt_res.is_err() {
                println!("│ [OCR] BitBlt 抓取失败: {:?}", blt_res);
                SelectObject(hdc_mem, old_bm);
                let _ = DeleteObject(hbm);
                let _ = DeleteDC(hdc_mem);
                ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);
                return None;
            }

            // 读取像素数据为标准 32 位位图
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: crop_w,
                    biHeight: -crop_h, // 自顶向下
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: (crop_w * crop_h * 4) as u32,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut pixels = vec![0u8; (crop_w * crop_h * 4) as usize];
            let lines_read = GetDIBits(
                hdc_mem,
                hbm,
                0,
                crop_h as u32,
                Some(pixels.as_mut_ptr() as _),
                &mut bi,
                DIB_RGB_COLORS,
            );

            SelectObject(hdc_mem, old_bm);
            let _ = DeleteObject(hbm);
            let _ = DeleteDC(hdc_mem);
            ReleaseDC(HWND(std::ptr::null_mut()), hdc_screen);

            if lines_read == 0 {
                println!("│ [OCR] GetDIBits 未能读取像素");
                return None;
            }

            // 构造标准 BMP 内存文件格式供 Windows.Media.Ocr 解码
            let file_header_size = 14u32;
            let info_header_size = 40u32;
            let pixel_offset = file_header_size + info_header_size;
            let file_size = pixel_offset + pixels.len() as u32;

            let mut bmp_bytes = Vec::with_capacity(file_size as usize);
            bmp_bytes.extend_from_slice(b"BM");
            bmp_bytes.extend_from_slice(&file_size.to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&pixel_offset.to_le_bytes());

            bmp_bytes.extend_from_slice(&info_header_size.to_le_bytes());
            bmp_bytes.extend_from_slice(&crop_w.to_le_bytes());
            bmp_bytes.extend_from_slice(&(-crop_h).to_le_bytes());
            bmp_bytes.extend_from_slice(&1u16.to_le_bytes());
            bmp_bytes.extend_from_slice(&32u16.to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&0u32.to_le_bytes());
            bmp_bytes.extend_from_slice(&pixels);

            // 调用 Windows 原生离线 OCR 引擎
            let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
                Ok(e) => e,
                Err(e) => {
                    println!("│ [OCR] TryCreateFromUserProfileLanguages 失败: {:?}", e);
                    return None;
                }
            };

            let stream = match InMemoryRandomAccessStream::new() {
                Ok(s) => s,
                Err(e) => {
                    println!("│ [OCR] 创建 InMemoryRandomAccessStream 失败: {:?}", e);
                    return None;
                }
            };

            let writer = match DataWriter::CreateDataWriter(&stream) {
                Ok(w) => w,
                Err(e) => {
                    println!("│ [OCR] 创建 DataWriter 失败: {:?}", e);
                    return None;
                }
            };

            if let Err(e) = writer.WriteBytes(&bmp_bytes) {
                println!("│ [OCR] DataWriter 写入字节失败: {:?}", e);
                return None;
            }
            if let Ok(store_op) = writer.StoreAsync() {
                if let Err(e) = store_op.get() {
                    println!("│ [OCR] StoreAsync 失败: {:?}", e);
                    return None;
                }
            }
            let _ = writer.DetachStream();
            let _ = stream.Seek(0);

            let decoder = match BitmapDecoder::CreateAsync(&stream) {
                Ok(op) => match op.get() {
                    Ok(dec) => dec,
                    Err(e) => {
                        println!("│ [OCR] 解码位图等待失败: {:?}", e);
                        return None;
                    }
                },
                Err(e) => {
                    println!("│ [OCR] 创建解码器异步操作失败: {:?}", e);
                    return None;
                }
            };

            let software_bitmap = match decoder.GetSoftwareBitmapAsync() {
                Ok(op) => match op.get() {
                    Ok(bm) => bm,
                    Err(e) => {
                        println!("│ [OCR] 获取 SoftwareBitmap 等待失败: {:?}", e);
                        return None;
                    }
                },
                Err(e) => {
                    println!("│ [OCR] 获取 SoftwareBitmapAsync 失败: {:?}", e);
                    return None;
                }
            };

            let ocr_result = match engine.RecognizeAsync(&software_bitmap) {
                Ok(op) => match op.get() {
                    Ok(res) => res,
                    Err(e) => {
                        println!("│ [OCR] 执行 OCR 识别等待失败: {:?}", e);
                        return None;
                    }
                },
                Err(e) => {
                    println!("│ [OCR] 调用 RecognizeAsync 失败: {:?}", e);
                    return None;
                }
            };

            let raw_text = ocr_result.Text().unwrap_or_default().to_string();
            println!("│ [OCR] 标题栏原始 OCR 输出: {:?}", raw_text);

            let clean_opt = Self::clean_ocr_title(&raw_text);
            println!("│ [OCR] 智能净化提取结果: {:?}", clean_opt);
            clean_opt
        }
    }

    /// 对 OCR 识别出的标题区域文本进行智能净化提取
    pub fn clean_ocr_title(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        // 1. 先按行拆分，过滤纯系统行（如 "搜索"、"微信"）
        let mut lines = Vec::new();
        for line in raw.lines() {
            let l = line.trim();
            if !l.is_empty() {
                lines.push(l);
            }
        }

        // 优先寻找包含群成员人数标识（如 "(50)", "（18）", "[32]", "{50}"）的行
        let mut candidate = String::new();
        for l in &lines {
            if l.contains('(') || l.contains('（') || l.contains('{') || l.contains('[') {
                candidate = l.to_string();
                break;
            }
        }
        if candidate.is_empty() && !lines.is_empty() {
            for l in &lines {
                let cl = l.trim_start_matches(|c: char| c == 'O' || c == 'o' || c == '+' || c == ' ' || c == '0');
                if cl != "搜索" && cl != "微信" && !cl.is_empty() {
                    candidate = l.to_string();
                    break;
                }
            }
            if candidate.is_empty() {
                candidate = lines[0].to_string();
            }
        }

        // 2. 合并 CJK 汉字之间的孤立空格（如 "邹 宗 笑" -> "邹宗笑"）
        let mut merged = String::new();
        let chars: Vec<char> = candidate.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c == ' ' && i > 0 && i + 1 < chars.len() {
                let prev = chars[i - 1];
                let next = chars[i + 1];
                let is_cjk = |ch: char| ch >= '\u{4e00}' && ch <= '\u{9fa5}';
                if is_cjk(prev) && is_cjk(next) {
                    i += 1;
                    continue;
                }
                if (prev == '(' || prev == '（' || prev == '{' || prev == '[') && next.is_ascii_digit() {
                    i += 1;
                    continue;
                }
                if prev.is_ascii_digit() && (next == ')' || next == '）' || next == '}' || next == ']') {
                    i += 1;
                    continue;
                }
                if prev.is_ascii_digit() && next.is_ascii_digit() {
                    i += 1;
                    continue;
                }
            }
            merged.push(c);
            i += 1;
        }

        let mut result = merged.trim().to_string();

        // 3. 规范化括号
        result = result.replace('{', "(").replace('}', ")");
        result = result.replace('（', "(").replace('）', ")");

        // 4. 剥离顶部常见系统杂项前缀
        let noise_prefixes = ["o ", "o", "O ", "O", "+ ", "+", "0 ", "搜索 ", "搜索", "微信", "Weixin", "WeChat"];
        for p in noise_prefixes {
            if result.starts_with(p) {
                result = result[p.len()..].trim().to_string();
            }
        }

        // 5. 规整连字符周边的多余空格
        result = result.replace(" - ", "-");

        // 6. 如果群人数紧跟在末尾，确保群名前有一空格规整格式
        if let Some(paren_idx) = result.rfind('(') {
            if paren_idx > 0 && !result[..paren_idx].ends_with(' ') {
                let name_part = &result[..paren_idx];
                let count_part = &result[paren_idx..];
                if count_part.ends_with(')') && count_part.chars().skip(1).take(count_part.len() - 2).all(|c| c.is_ascii_digit()) {
                    result = format!("{} {}", name_part, count_part);
                }
            }
        }

        if result.is_empty() || result == "微信" || result == "搜索" || result.chars().count() > 50 {
            return None;
        }

        Some(result)
    }

    /// 基于 UI Automation COM 接口与视觉布局特征评分算法探测微信聊天/群名称（兼容微信 3.x）
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

            let mut win_rect: RECT = std::mem::zeroed();
            let _ = GetWindowRect(hwnd, &mut win_rect);
            let win_width = (win_rect.right - win_rect.left).max(400);

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
                return None;
            }

            let mut best_name: Option<String> = None;
            let mut max_score = 0;
            let scan_limit = count.min(800);

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
                let rel_top = elem_rect.top - win_rect.top;
                let rel_left = elem_rect.left - win_rect.left;

                let score = Self::calculate_chat_target_score(
                    clean,
                    ctrl_type,
                    rel_top,
                    rel_left,
                    win_width,
                );

                if score >= 1000 {
                    println!("│ [UIA 满分命中] 名称: '{}', 得分: {}, rel_pos: ({}, {})", clean, score, rel_left, rel_top);
                    return Some(clean.to_string());
                }

                if score > max_score {
                    max_score = score;
                    best_name = Some(clean.to_string());
                }
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

        // 特征 2：位于微信顶部会话标题区域（Y 在 0px ~ 100px 之间，支持独立窗口从 0 开始以及主窗口从 160 开始）
        let is_header_area = rel_top >= 0 && rel_top <= 100 && (rel_left >= 10 || rel_left > (win_width / 5));
        if is_header_area {
            score += 500;
        }

        // 特征 3：常见群聊、项目或业务特征词
        let group_keywords = ["群", "组", "标注", "项目", "翻译", "质检", "语", "交流", "团队", "工作", "中心", "交付", "测试"];
        for kw in &group_keywords {
            if name.contains(kw) {
                score += 350;
                break;
            }
        }

        // 特征 4：控件类型偏好
        if ctrl_type == UIA_ButtonControlTypeId.0 || ctrl_type == UIA_TextControlTypeId.0 {
            score += 150;
        } else if ctrl_type == UIA_ListItemControlTypeId.0 {
            score += 200;
        }

        // 特征 5：合理字符长度
        if name.chars().count() >= 2 && name.chars().count() <= 35 {
            score += 100;
        }

        score
    }

    /// 从划选内容分析发件人昵称或群名前缀（支持微信多行复制格式与单行消息格式）
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
            if !clean.is_empty() && clean.chars().count() <= 35 && !is_system_keyword(clean) {
                return Some(clean.to_string());
            }
        }

        // 模式 1: 微信标准多行消息复制格式（第一行为发件人昵称，第二行为日期时间戳）
        // 例如：
        // Cassie 潮州@信实翻译公司
        // 2026年09月23日 15:15
        // 消息正文...
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

        // 模式 2: 单行混合格式 "张三 2026-09-21 17:31" 或 "李四 17:31:00"
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.len() >= 2 {
            let last_part = parts.last().unwrap();
            if last_part.contains(':') && parts[0].len() <= 25 {
                let name = parts[0].trim();
                if !is_system_keyword(name) {
                    return Some(name.to_string());
                }
            }
        }

        // 模式 3: "张三: 具体内容" 或 "张三：具体内容"
        if let Some((sender, _)) = first_line.split_once(':') {
            let s = sender.trim();
            if !s.is_empty() && s.chars().count() <= 25 && !s.contains('\n') && !is_system_keyword(s) {
                return Some(s.to_string());
            }
        }
        if let Some((sender, _)) = first_line.split_once('：') {
            let s = sender.trim();
            if !s.is_empty() && s.chars().count() <= 25 && !s.contains('\n') && !is_system_keyword(s) {
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
        assert!(is_system_keyword("Qt51514QWindowIcon"));
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
    fn test_clean_ocr_title() {
        assert_eq!(
            WechatDetector::clean_ocr_title("O 邹 宗 笑"),
            Some("邹宗笑".to_string())
        );
        assert_eq!(
            WechatDetector::clean_ocr_title("潮 汕 话 标 注 群 - 信 实 翻 译 公 司 ( 5 0 )"),
            Some("潮汕话标注群-信实翻译公司 (50)".to_string())
        );
        assert_eq!(
            WechatDetector::clean_ocr_title("搜索 丁至@广工淇至科技"),
            Some("丁至@广工淇至科技".to_string())
        );
        assert_eq!(WechatDetector::clean_ocr_title("搜索"), None);
        assert_eq!(WechatDetector::clean_ocr_title("微信"), None);
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
        // 模式 1: 微信多行复制标准格式
        let snippet_multiline = "Cassie 潮州@信实翻译公司\n2026年09月23日 15:15\n住宿前面的tang跟后面的“从星期一”一样写“从”吗";
        assert_eq!(
            WechatDetector::detect_sender_from_text(snippet_multiline),
            Some("Cassie 潮州@信实翻译公司".to_string())
        );

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
