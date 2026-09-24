use windows::core::{w, HSTRING};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::{BOOL, HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    HDC, HGDIOBJ, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    SRCCOPY,
};
use windows::Win32::System::StationsAndDesktops::{
    OpenInputDesktop, OpenWindowStationW, SetProcessWindowStation, SetThreadDesktop,
    DESKTOP_ACCESS_FLAGS, DESKTOP_CONTROL_FLAGS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GA_ROOT,
};
use base64::prelude::*;
use std::io::Cursor;

extern "system" {
    fn PrintWindow(hwnd: HWND, hdcblt: HDC, nflags: u32) -> BOOL;
}

/// 辅助检查字符是否为汉字
fn is_cjk(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c) || ('\u{3400}'..='\u{4DBF}').contains(&c)
}

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

/// 微信会话/群聊探测器（基于底层 PrintWindow 视觉直绘与原生 OCR）
pub struct WechatDetector;

impl WechatDetector {
    /// 确保当前调用线程安全绑定到用户交互桌面站 (WinSta0\default)
    /// 解决在多线程异步运行时无法访问窗口与位图的技术屏障
    pub fn ensure_desktop_access() {
        unsafe {
            if let Ok(winsta) = OpenWindowStationW(w!("WinSta0"), false, 0x037F) {
                let _ = SetProcessWindowStation(winsta);
            }
            if let Ok(desk) = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_ACCESS_FLAGS(0x01FF)) {
                let _ = SetThreadDesktop(desk);
            }
        }
    }

    /// 精准识别当前前台微信会话的群聊名称或联系人
    ///
    /// 静默抓取微信当前会话的标题栏区域并压缩编码为 Base64 JPEG 图像供多模态大模型分析
    pub fn capture_chat_header_base64(hwnd: HWND) -> Option<String> {
        Self::ensure_desktop_access();
        let root_hwnd = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let target_hwnd = if !root_hwnd.0.is_null() { root_hwnd } else { hwnd };

        unsafe {
            let mut win_rect = RECT::default();
            if GetWindowRect(target_hwnd, &mut win_rect).is_err() {
                return None;
            }
            let win_w = win_rect.right - win_rect.left;
            let win_h = win_rect.bottom - win_rect.top;
            if win_w < 200 || win_h < 150 {
                return None;
            }

            let is_main_window = win_w >= 500;
            let (crop_x, crop_y, crop_w, crop_h) = if is_main_window {
                let left_offset = (win_w as f64 * 0.27).max(220.0) as i32;
                let right_margin = (win_w as f64 * 0.12).clamp(100.0, 180.0) as i32;
                let w = (win_w - left_offset - right_margin).max(120);
                let y = (win_h as f64 * 0.025).clamp(25.0, 35.0) as i32;
                let h = (win_h as f64 * 0.10).clamp(85.0, 110.0) as i32;
                (left_offset, y, w, h)
            } else {
                let left_offset = 15;
                let right_margin = 120;
                let w = (win_w - left_offset - right_margin).max(100);
                (left_offset, 25, w, 95)
            };

            let bgra_bytes = Self::capture_window_rect_bgra(target_hwnd, crop_x, crop_y, crop_w, crop_h, win_w, win_h)?;

            // 将 BGRA 转换为 RGB (去掉 Alpha 通道以适应 JPEG 编码)
            let mut rgb_bytes = Vec::with_capacity((crop_w * crop_h * 3) as usize);
            for chunk in bgra_bytes.chunks_exact(4) {
                let b = chunk[0];
                let g = chunk[1];
                let r = chunk[2];
                rgb_bytes.push(r);
                rgb_bytes.push(g);
                rgb_bytes.push(b);
            }

            let mut jpeg_buf = Vec::new();
            let mut cursor = Cursor::new(&mut jpeg_buf);
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 90);
            encoder.encode(&rgb_bytes, crop_w as u32, crop_h as u32, image::ExtendedColorType::Rgb8).ok()?;

            Some(BASE64_STANDARD.encode(&jpeg_buf))
        }
    }

    /// 精准识别当前前台微信会话的群聊名称或联系人
    pub fn detect_current_chat_title(
        hwnd: HWND,
        raw_window_title: &str,
    ) -> Option<String> {
        println!("\n┌──────────────── 微信会话/群聊真机原生识别 (PrintWindow + OCR) ────────────────┐");
        Self::ensure_desktop_access();

        let root_hwnd = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let target_hwnd = if !root_hwnd.0.is_null() {
            root_hwnd
        } else {
            hwnd
        };

        let raw_class = Self::get_window_class(hwnd);
        let root_class = Self::get_window_class(target_hwnd);
        let trimmed_title = raw_window_title.trim();
        println!("│ 前台 HWND: {:?}, 类名: '{}', 传入标题: '{}'", hwnd.0, raw_class, trimmed_title);
        if hwnd != target_hwnd {
            println!("│ 宿主 HWND: {:?}, 类名: '{}'", target_hwnd.0, root_class);
        }

        // 1. 独立聊天窗口原生标题探测（零延迟、最权威）
        if let Some(independent_title) = Self::detect_independent_window_title(hwnd, target_hwnd, trimmed_title) {
            println!("│ [识别成功 (原生独立标题)] 从独立窗口标题获取: '{}'", independent_title);
            println!("└─────────────────────────────────────────────────────────────────────────────┘");
            return Some(independent_title);
        }

        // 2. 基于 PrintWindow 自绘画布抓取 + 原生 OCR 识别当前会话/群聊
        if let Some(ocr_title) = Self::detect_from_ocr(hwnd, target_hwnd) {
            println!("│ [识别成功 (视觉 OCR)] 成功识别当前会话/群聊名称: '{}'", ocr_title);
            println!("└─────────────────────────────────────────────────────────────────────────────┘");
            return Some(ocr_title);
        }

        println!("│ [识别结果] 未在界面视觉区域内探得高置信度群名/会话");
        println!("└─────────────────────────────────────────────────────────────────────────────┘");
        None
    }

    /// 检查是否为独立聊天窗口，并获取原生标题
    fn detect_independent_window_title(
        hwnd: HWND,
        target_hwnd: HWND,
        trimmed_title: &str,
    ) -> Option<String> {
        let raw_class_lower = Self::get_window_class(hwnd).to_lowercase();
        let root_class_lower = Self::get_window_class(target_hwnd).to_lowercase();

        // 排除主窗口框架及内部自绘子窗口
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

    /// 基于 PrintWindow 自绘画布无遮挡抓取与 Windows 原生 OCR 的微信会话探测
    pub fn detect_from_ocr(hwnd: HWND, target_hwnd: HWND) -> Option<String> {
        Self::ensure_desktop_access();

        unsafe {
            let mut win_rect = RECT::default();
            let mut got_rect = false;

            // 优先从顶级窗口获取整个微信框架的位置与尺寸
            if !target_hwnd.0.is_null() && GetWindowRect(target_hwnd, &mut win_rect).is_ok() {
                let w = win_rect.right - win_rect.left;
                let h = win_rect.bottom - win_rect.top;
                if w >= 200 && h >= 150 {
                    got_rect = true;
                }
            }

            if !got_rect && !hwnd.0.is_null() && GetWindowRect(hwnd, &mut win_rect).is_ok() {
                let w = win_rect.right - win_rect.left;
                let h = win_rect.bottom - win_rect.top;
                if w >= 200 && h >= 150 {
                    got_rect = true;
                }
            }

            if !got_rect {
                println!("│ [OCR] 未能获取到有效的微信窗口尺寸，跳过视觉识别");
                return None;
            }

            let win_w = win_rect.right - win_rect.left;
            let win_h = win_rect.bottom - win_rect.top;
            println!("│ [OCR] 目标微信窗口物理/逻辑尺寸: {}x{}", win_w, win_h);

            // 策略 A: 截取右侧聊天区正顶部的标题栏 (ROI 1)
            // 微信 4.0 与 3.x 结构：
            // - 左侧会话栏占宽度的约 28%~32%
            // - 顶部无边框拖拽空白约 25~35px
            // - 标题栏文字高度约 40px，整体取 Y: 25..125 (高度约 95~100px)，完美包裹文字，绝不切头
            let is_main_window = win_w >= 500;
            let (roi1_x, roi1_w, roi1_y, roi1_h) = if is_main_window {
                let left_offset = (win_w as f64 * 0.28).max(220.0) as i32;
                let right_margin = (win_w as f64 * 0.15).clamp(120.0, 200.0) as i32;
                let w = (win_w - left_offset - right_margin).max(100);
                let y = (win_h as f64 * 0.025).clamp(25.0, 35.0) as i32;
                let h = (win_h as f64 * 0.10).clamp(85.0, 110.0) as i32;
                (left_offset, w, y, h)
            } else {
                // 独立小聊天窗口
                let left_offset = 15;
                let right_margin = 120;
                let w = (win_w - left_offset - right_margin).max(100);
                (left_offset, w, 25, 95)
            };

            println!("│ [OCR] 执行区域 1 截取 (聊天区顶部标题带): X={}, Y={}, 尺寸={}x{}", roi1_x, roi1_y, roi1_w, roi1_h);
            if let Some(target) = Self::perform_ocr_on_rect(target_hwnd, roi1_x, roi1_y, roi1_w, roi1_h, win_w, win_h) {
                return Some(target);
            }

            // 策略 B: 若区域 1 未命中（例如极宽或特殊分栏布局），扩展扫描全顶栏 (ROI 2)
            if is_main_window {
                let full_x = 20;
                let full_w = (win_w - 140).max(100);
                let full_y = 25;
                let full_h = 100;
                println!("│ [OCR] 区域 1 未命中，执行区域 2 全顶栏扫描: X={}, Y={}, 尺寸={}x{}", full_x, full_y, full_w, full_h);
                if let Some(target) = Self::perform_ocr_on_rect(target_hwnd, full_x, full_y, full_w, full_h, win_w, win_h) {
                    return Some(target);
                }

                // 策略 C: 扫描左侧会话列表中激活项 (ROI 3)
                let sess_x = (win_w as f64 * 0.05) as i32;
                let sess_w = (win_w as f64 * 0.23).clamp(160.0, 320.0) as i32;
                let sess_y = 60;
                let sess_h = (win_h as f64 * 0.20).clamp(120.0, 220.0) as i32;
                println!("│ [OCR] 执行区域 3 (左侧会话激活项扫描): X={}, Y={}, 尺寸={}x{}", sess_x, sess_y, sess_w, sess_h);
                if let Some(target) = Self::perform_ocr_on_rect(target_hwnd, sess_x, sess_y, sess_w, sess_h, win_w, win_h) {
                    return Some(target);
                }
            }

            None
        }
    }

    /// 在指定窗口的指定相对矩形执行 PrintWindow 抓取并调用 Windows.Media.Ocr
    /// 使用 Windows 原生离线 OCR 引擎识别 BGRA 图像缓冲区中的文字
    fn recognize_text_from_bgra(bgra_bytes: &[u8], width: i32, height: i32) -> Option<String> {
        let writer = DataWriter::new().ok()?;
        writer.WriteBytes(bgra_bytes).ok()?;
        let ibuffer = writer.DetachBuffer().ok()?;

        let software_bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &ibuffer,
            BitmapPixelFormat::Bgra8,
            width,
            height,
        ).ok()?;

        let engine = Language::CreateLanguage(&HSTRING::from("zh-Hans-CN"))
            .ok()
            .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang).ok())
            .or_else(|| OcrEngine::TryCreateFromUserProfileLanguages().ok())?;

        let async_op = engine.RecognizeAsync(&software_bitmap).ok()?;
        let result = async_op.get().ok()?;
        Some(result.Text().unwrap_or_default().to_string())
    }

    /// 在指定窗口的指定相对矩形执行 PrintWindow 抓取并调用 Windows.Media.Ocr
    pub fn perform_ocr_on_rect(
        target_hwnd: HWND,
        crop_x: i32,
        crop_y: i32,
        crop_w: i32,
        crop_h: i32,
        win_w: i32,
        win_h: i32,
    ) -> Option<String> {
        let mut bgra_bytes = unsafe {
            Self::capture_window_rect_bgra(target_hwnd, crop_x, crop_y, crop_w, crop_h, win_w, win_h)?
        };

        // ══════════════ 第一阶：原生无损识别 (Pass 1 - High Fidelity) ══════════════
        // 直接使用未受篡改的高保真原图进行 OCR，保留 100% 原始抗锯齿细节，
        // 彻底杜绝因粗暴二值化侵蚀汉字纤细笔画（如将“苗”切为“田”、将“财”切为“则”）的问题！
        let mut best_candidate: Option<(String, i32)> = None;

        if let Some(raw_text) = Self::recognize_text_from_bgra(&bgra_bytes, crop_w, crop_h) {
            let trimmed = raw_text.trim();
            if !trimmed.is_empty() {
                println!("│ [OCR Pass 1 原图识别]: '{}'", trimmed.replace('\n', " | "));
                for line in trimmed.lines() {
                    let cleaned = Self::clean_ocr_candidate(line);
                    if cleaned.is_empty() || is_system_keyword(&cleaned) {
                        continue;
                    }
                    let score = Self::score_ocr_candidate(&cleaned);
                    println!("│   Pass 1 候选: '{}' -> 得分: {}", cleaned, score);
                    if score > 0 {
                        match &best_candidate {
                            Some((_, best_score)) => {
                                if score > *best_score {
                                    best_candidate = Some((cleaned, score));
                                }
                            }
                            None => {
                                best_candidate = Some((cleaned, score));
                            }
                        }
                    }
                }
            }
        }

        // 若原图识别已获得高置信度结果（>= 70分），直接返回，无需二次处理
        if let Some((ref title, score)) = best_candidate {
            if score >= 70 {
                return Some(title.clone());
            }
        }

        // ══════════════ 第二阶：平滑线性拉伸兜底 (Pass 2 - Smooth Linear Stretch) ══════════════
        // 仅在原图识别未获得高置信度结果时启动，采用平滑连续动态范围拉伸，
        // 绝不使用硬阈值截断（完整保留渐变抗锯齿像素），提升极暗灰色副标题的辨识度。
        Self::smooth_linear_stretch(&mut bgra_bytes);

        if let Some(enhanced_text) = Self::recognize_text_from_bgra(&bgra_bytes, crop_w, crop_h) {
            let trimmed = enhanced_text.trim();
            if !trimmed.is_empty() {
                println!("│ [OCR Pass 2 平滑增强识别]: '{}'", trimmed.replace('\n', " | "));
                for line in trimmed.lines() {
                    let cleaned = Self::clean_ocr_candidate(line);
                    if cleaned.is_empty() || is_system_keyword(&cleaned) {
                        continue;
                    }
                    let score = Self::score_ocr_candidate(&cleaned);
                    println!("│   Pass 2 候选: '{}' -> 得分: {}", cleaned, score);
                    if score > 0 {
                        match &best_candidate {
                            Some((_, best_score)) => {
                                if score > *best_score {
                                    best_candidate = Some((cleaned, score));
                                }
                            }
                            None => {
                                best_candidate = Some((cleaned, score));
                            }
                        }
                    }
                }
            }
        }

        best_candidate.and_then(|(title, score)| {
            if score >= 30 {
                Some(title)
            } else {
                None
            }
        })
    }

    /// 针对暗色背景与低对比度文字的平滑连续动态范围拉伸（绝不硬切断抗锯齿细节）
    pub fn smooth_linear_stretch(buffer: &mut [u8]) {
        if buffer.len() < 16 {
            return;
        }

        let step = (buffer.len() / 4 / 400).max(1);
        let mut min_lum = 255u8;
        let mut max_lum = 0u8;
        let mut sum_lum = 0u64;
        let mut count = 0u64;

        for i in (0..(buffer.len() / 4)).step_by(step) {
            let b = buffer[i * 4] as f32;
            let g = buffer[i * 4 + 1] as f32;
            let r = buffer[i * 4 + 2] as f32;
            let lum = (r * 0.299 + g * 0.587 + b * 0.114) as u8;
            if lum < min_lum { min_lum = lum; }
            if lum > max_lum { max_lum = lum; }
            sum_lum += lum as u64;
            count += 1;
        }

        if count == 0 || max_lum <= min_lum + 25 {
            return;
        }

        let avg_lum = (sum_lum / count) as u8;
        // 仅在深色模式（平均亮度 < 100 且存在反差）时进行自适应平滑映射
        if avg_lum < 100 {
            let bg = min_lum as f32;
            let range = (max_lum as f32 - bg).max(1.0);

            for chunk in buffer.chunks_exact_mut(4) {
                let b = chunk[0] as f32;
                let g = chunk[1] as f32;
                let r = chunk[2] as f32;
                let lum = r * 0.299 + g * 0.587 + b * 0.114;

                // 保持抗锯齿平滑度的连续 Gamma 拉伸，绝无硬门限断笔
                let normalized = ((lum - bg) / range).clamp(0.0, 1.0);
                let boosted = normalized.powf(0.85) * 255.0;

                let ratio = if lum > 1.0 { boosted / lum } else { 1.0 };
                chunk[0] = (b * ratio).clamp(0.0, 255.0) as u8;
                chunk[1] = (g * ratio).clamp(0.0, 255.0) as u8;
                chunk[2] = (r * ratio).clamp(0.0, 255.0) as u8;
            }
        }
    }

    /// 截取窗口自身自绘内容为 BGRA8 像素格式
    /// 核心优势：使用 PrintWindow(PW_RENDERFULLCONTENT) 彻底规避前台窗口遮挡！
    unsafe fn capture_window_rect_bgra(
        target_hwnd: HWND,
        crop_x: i32,
        crop_y: i32,
        crop_w: i32,
        crop_h: i32,
        win_w: i32,
        win_h: i32,
    ) -> Option<Vec<u8>> {
        if crop_w <= 0 || crop_h <= 0 || win_w <= 0 || win_h <= 0 {
            return None;
        }

        Self::ensure_desktop_access();

        let screen_dc = GetDC(HWND(std::ptr::null_mut()));
        if screen_dc.0.is_null() {
            return None;
        }

        // 1. 尝试 PrintWindow (PW_RENDERFULLCONTENT = 2) 穿透所有遮挡
        let full_dc = CreateCompatibleDC(screen_dc);
        let full_bmp = CreateCompatibleBitmap(screen_dc, win_w, win_h);
        let mut pw_success = false;

        if !full_dc.0.is_null() && !full_bmp.0.is_null() {
            let old_full = SelectObject(full_dc, HGDIOBJ(full_bmp.0));
            let pw_res = PrintWindow(target_hwnd, full_dc, 2);
            SelectObject(full_dc, old_full);
            if pw_res.as_bool() {
                pw_success = true;
            }
        }

        let crop_dc = CreateCompatibleDC(screen_dc);
        let crop_bmp = CreateCompatibleBitmap(screen_dc, crop_w, crop_h);
        if crop_dc.0.is_null() || crop_bmp.0.is_null() {
            if !full_bmp.0.is_null() { let _ = DeleteObject(HGDIOBJ(full_bmp.0)); }
            if !full_dc.0.is_null() { let _ = DeleteDC(full_dc); }
            ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);
            return None;
        }

        let old_crop = SelectObject(crop_dc, HGDIOBJ(crop_bmp.0));

        if pw_success {
            let old_full = SelectObject(full_dc, HGDIOBJ(full_bmp.0));
            let _ = BitBlt(crop_dc, 0, 0, crop_w, crop_h, full_dc, crop_x, crop_y, SRCCOPY);
            SelectObject(full_dc, old_full);
        } else {
            // 兜底回退：若极罕见情况下 PrintWindow 失败，使用绝对屏幕坐标 BitBlt
            let mut win_rect = RECT::default();
            if GetWindowRect(target_hwnd, &mut win_rect).is_ok() {
                let abs_x = win_rect.left + crop_x;
                let abs_y = win_rect.top + crop_y;
                let _ = BitBlt(crop_dc, 0, 0, crop_w, crop_h, screen_dc, abs_x, abs_y, SRCCOPY);
            }
        }

        SelectObject(crop_dc, old_crop);

        if !full_bmp.0.is_null() { let _ = DeleteObject(HGDIOBJ(full_bmp.0)); }
        if !full_dc.0.is_null() { let _ = DeleteDC(full_dc); }

        let mut buffer = vec![0u8; (crop_w * crop_h * 4) as usize];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: crop_w,
                biHeight: -crop_h, // top-down DIB 格式
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let lines = GetDIBits(
            crop_dc,
            crop_bmp,
            0,
            crop_h as u32,
            Some(buffer.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        let _ = DeleteObject(HGDIOBJ(crop_bmp.0));
        let _ = DeleteDC(crop_dc);
        ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);

        if lines > 0 {
            Some(buffer)
        } else {
            None
        }
    }

    /// 清洗 OCR 识别出的候选文字
    /// - 去除开头的干扰图标/免打扰误识单字符（如 'O '、'o '、'C '、'· ' 等）
    /// - 去除尾部可能误识的微信“···”或“...”聊天详情按钮
    /// - 智能合并汉字之间因字距被 OCR 断开的空格（如 "梁 简 微" -> "梁简微"）
    pub fn clean_ocr_candidate(text: &str) -> String {
        let mut s = text.trim();

        // 1. 去除常见的标点前缀
        s = s.trim_start_matches(':')
            .trim_start_matches('：')
            .trim();

        // 2. 去除开头的干扰小图标（例如微信加号按钮 ⊕、免打扰小图标、圆点状态图标等）
        s = s.trim_start_matches(|c: char| {
            c == '⊕' || c == '+' || c == '·' || c == '•' || c == '●' || c == '○' || c == '>' || c == '<' || c == '*'
        }).trim();

        if let Some((first, rest)) = s.split_once(' ') {
            if first.chars().count() == 1 {
                let c = first.chars().next().unwrap();
                if c.is_ascii_alphabetic() || c == '·' || c == '-' || c == '•' || c == '●' || c == '○' || c == '>' || c == '<' || c == '+' || c == '⊕' {
                    s = rest.trim();
                }
            }
        }

        // 3. 去除尾部可能误识的微信“···”或“...”聊天详情按钮、展开箭头等
        s = s.trim_end_matches("···")
            .trim_end_matches("...")
            .trim_end_matches('…')
            .trim_end_matches('·')
            .trim_end_matches('v')
            .trim_end_matches('V')
            .trim_end_matches('^')
            .trim_end_matches('>')
            .trim();

        // 4. 去除汉字之间、汉字与常用全角符号之间因字距断开的虚假空格，保留群名与人数括号间的标准空格
        let chars: Vec<char> = s.chars().collect();
        let mut merged = String::with_capacity(s.len());
        for i in 0..chars.len() {
            if chars[i] == ' ' {
                let prev = if i > 0 { Some(chars[i - 1]) } else { None };
                let next = if i + 1 < chars.len() { Some(chars[i + 1]) } else { None };

                let prev_cjk = prev.map_or(false, is_cjk);
                let next_cjk = next.map_or(false, is_cjk);

                // 两个汉字之间："梁 简 微" -> "梁简微"
                if prev_cjk && next_cjk {
                    continue;
                }
                // 汉字与方括号/顿号/破折号之间："【 标 贝 - 曦 瀚 】" -> "【标贝-曦瀚】"
                if (prev_cjk && next.map_or(false, |c| "【】《》、-—_".contains(c)))
                    || (prev.map_or(false, |c| "【】《》、-—_".contains(c)) && next_cjk)
                {
                    continue;
                }
                // 数字与汉字之间紧挨着被拆开："007 逆 袭" -> "007逆袭"
                if (prev.map_or(false, |c| c.is_ascii_digit()) && next_cjk)
                    || (prev_cjk && next.map_or(false, |c| c.is_ascii_digit()))
                {
                    continue;
                }
                // 括号内部与数字：" ( 7 ) " -> " (7) "
                if (prev.map_or(false, |c| c == '(' || c == '（') && next.map_or(false, |c| c.is_ascii_digit()))
                    || (prev.map_or(false, |c| c.is_ascii_digit()) && next.map_or(false, |c| c == ')' || c == '）'))
                {
                    continue;
                }
            }
            merged.push(chars[i]);
        }

        merged.trim().to_string()
    }

    /// 对 OCR 识别出的文本计算加权置信度得分（重点突出微信群聊特征）
    pub fn score_ocr_candidate(text: &str) -> i32 {
        let clean = text.trim();
        if clean.is_empty() || is_system_keyword(clean) {
            return -100;
        }

        let char_count = clean.chars().count();
        if char_count < 2 || char_count > 45 {
            return -50;
        }

        let mut score = 30; // 基础命中分

        // 1. 群人数特征（如 (7), （12）, [5]）——极高权重
        if (clean.contains('(') && clean.contains(')'))
            || (clean.contains('（') && clean.contains('）'))
            || (clean.contains('[') && clean.contains(']'))
        {
            score += 100;
        }

        // 2. 商务/项目规范方括号特征（如 【标贝-曦瀚】）
        if (clean.contains('【') && clean.contains('】'))
            || (clean.contains('[') && clean.contains(']'))
            || (clean.contains('《') && clean.contains('》'))
        {
            score += 60;
        }

        // 3. 临时多人讨论组特征（如 "陈浩、兰斌、陈祺"）
        if clean.contains('、') {
            score += 50;
        }

        // 4. 包含典型组织、部门、业务群聊词缀（丰富业务词加分）
        let group_keywords = &[
            "群", "组", "项目", "对接", "协同", "沟通", "研发", "技术", "交付", "通知",
            "团队", "兼职", "校对", "文本", "标注", "标贝", "曦瀚", "质检", "翻译", "业务", "交流",
            "部", "公司", "@", "中心", "工作室",
        ];
        for &kw in group_keywords {
            if clean.contains(kw) {
                score += 35;
            }
        }

        // 5. 连接符特征（&、_、-、~ 等通常出现在规范业务群名中）
        if clean.contains('&') || clean.contains('_') || clean.contains('-') || clean.contains('~') {
            score += 30;
        }

        // 6. 字符长度更倾向于完整的群聊全称（8~35字符赋予更长群名额外置信度）
        if char_count >= 8 && char_count <= 35 {
            score += 35;
        } else if char_count >= 2 && char_count <= 7 {
            score += 15;
        }

        // 7. 惩罚项：如果包含“搜索”或纯时间
        if clean.contains("搜索") {
            score -= 80;
        }

        score
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
    fn test_ocr_candidate_scoring() {
        // 带方括号和人数的群名
        let s1 = WechatDetector::score_ocr_candidate("【标贝-曦瀚】潮汕话标注对接 (7)");
        assert!(s1 >= 180, "带人数和方括号的群名应获得极高分: {}", s1);

        // 多人临时群
        let s2 = WechatDetector::score_ocr_candidate("陈浩、兰斌、陈祺");
        assert!(s2 >= 90, "多人顿号群名应有高分: {}", s2);

        // 普通联系人名字
        let s3 = WechatDetector::score_ocr_candidate("梁简微");
        assert!(s3 >= 40, "普通联系人应有及格分: {}", s3);

        // 系统关键词
        let s4 = WechatDetector::score_ocr_candidate("搜索");
        assert!(s4 < 0, "搜索应被严重惩罚淘汰: {}", s4);
    }

    #[test]
    fn test_clean_ocr_candidate() {
        assert_eq!(
            WechatDetector::clean_ocr_candidate("【 标 贝 - 曦 瀚 】 潮 汕 话 标 注 对 接 ( 7 ) ···"),
            "【标贝-曦瀚】潮汕话标注对接 (7)"
        );
        assert_eq!(
            WechatDetector::clean_ocr_candidate("O 梁 简 微"),
            "梁简微"
        );
        assert_eq!(
            WechatDetector::clean_ocr_candidate("007 逆 袭 ( 10 )"),
            "007逆袭 (10)"
        );
        assert_eq!(
            WechatDetector::clean_ocr_candidate("王经理..."),
            "王经理"
        );
        assert_eq!(
            WechatDetector::clean_ocr_candidate("陈 浩 、 兰 斌 、 陈 祺"),
            "陈浩、兰斌、陈祺"
        );
    }
}
