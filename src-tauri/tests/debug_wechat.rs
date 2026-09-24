use ai2assistant_lib::services::wechat_detector::{is_system_keyword, WechatDetector};

#[test]
fn test_system_keywords() {
    assert!(is_system_keyword("微信"));
    assert!(is_system_keyword("ChatWnd"));
    assert!(is_system_keyword("按住鼠标 语音输入文字"));
    assert!(is_system_keyword("16:52"));
    assert!(!is_system_keyword("【标贝-曦瀚】潮汕话标注对接 (7)"));
    assert!(!is_system_keyword("华东交付协同群"));
    assert!(!is_system_keyword("陈浩、兰斌、陈祺"));
    assert!(!is_system_keyword("007逆袭 (10)"));
}

#[test]
fn test_clean_candidate() {
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
        WechatDetector::clean_ocr_candidate("陈 浩 、 兰 斌 、 陈 祺"),
        "陈浩、兰斌、陈祺"
    );
}

#[test]
fn test_ocr_candidate_scoring() {
    let s1 = WechatDetector::score_ocr_candidate("【标贝-曦瀚】潮汕话标注对接 (7)");
    assert!(s1 >= 180, "带人数和方括号的群名应获得极高分: {}", s1);

    let s2 = WechatDetector::score_ocr_candidate("梁简微");
    assert!(s2 >= 40, "普通联系人应有及格分: {}", s2);

    let s3 = WechatDetector::score_ocr_candidate("搜索");
    assert!(s3 < 0, "系统保留词应严重扣分: {}", s3);

    let s4 = WechatDetector::score_ocr_candidate("陈浩、兰斌、陈祺");
    assert!(s4 >= 90, "多人顿号群名应有高分: {}", s4);
}

#[test]
fn test_printwindow_ocr() {
    use windows::core::{w, HSTRING};
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::Foundation::{BOOL, HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, HDC, HGDIOBJ, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::System::StationsAndDesktops::{
        OpenInputDesktop, OpenWindowStationW, SetProcessWindowStation, SetThreadDesktop,
        DESKTOP_ACCESS_FLAGS, DESKTOP_CONTROL_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    extern "system" {
        fn PrintWindow(hwnd: HWND, hdcblt: HDC, nflags: u32) -> BOOL;
    }

    unsafe {
        if let Ok(winsta) = OpenWindowStationW(w!("WinSta0"), false, 0x037F) {
            let _ = SetProcessWindowStation(winsta);
        }
        if let Ok(desk) = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_ACCESS_FLAGS(0x01FF)) {
            let _ = SetThreadDesktop(desk);
        }

        let hwnd = HWND(133084 as *mut _);
        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let win_w = rect.right - rect.left;
        let win_h = rect.bottom - rect.top;
        if win_w < 200 || win_h < 150 {
            println!("微信窗口不可用或未运行，跳过现场 PrintWindow 测试");
            return;
        }

        // 创建全窗口的内存 DC 并使用 PrintWindow 抓取
        let screen_dc = GetDC(HWND(std::ptr::null_mut()));
        let full_dc = CreateCompatibleDC(screen_dc);
        let full_bmp = CreateCompatibleBitmap(screen_dc, win_w, win_h);
        let old_full = SelectObject(full_dc, HGDIOBJ(full_bmp.0));

        let pw_res = PrintWindow(hwnd, full_dc, 2); // PW_RENDERFULLCONTENT
        println!("PrintWindow PW_RENDERFULLCONTENT result: {:?}", pw_res);

        let left_offset = (win_w as f64 * 0.28).max(220.0) as i32;
        let right_margin = (win_w as f64 * 0.15).clamp(120.0, 200.0) as i32;
        let crop_x = left_offset;
        let crop_w = (win_w - left_offset - right_margin).max(100);
        let crop_y = (win_h as f64 * 0.025).clamp(25.0, 35.0) as i32;
        let crop_h = (win_h as f64 * 0.10).clamp(85.0, 110.0) as i32;
        println!("win: {}x{}, crop: x={}, y={}, w={}, h={}", win_w, win_h, crop_x, crop_y, crop_w, crop_h);

        let crop_dc = CreateCompatibleDC(screen_dc);
        let crop_bmp = CreateCompatibleBitmap(screen_dc, crop_w, crop_h);
        let old_crop = SelectObject(crop_dc, HGDIOBJ(crop_bmp.0));

        let _ = BitBlt(crop_dc, 0, 0, crop_w, crop_h, full_dc, crop_x, crop_y, SRCCOPY);
        SelectObject(crop_dc, old_crop);
        SelectObject(full_dc, old_full);

        // 提取 BGRA 像素
        let mut buffer = vec![0u8; (crop_w * crop_h * 4) as usize];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: crop_w,
                biHeight: -crop_h,
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
        assert!(lines > 0);

        let _ = DeleteObject(HGDIOBJ(crop_bmp.0));
        let _ = DeleteDC(crop_dc);
        let _ = DeleteObject(HGDIOBJ(full_bmp.0));
        let _ = DeleteDC(full_dc);
        ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);

        // 将截取的 BMP 保存到当前目录以供排查
        let file_header_size = 14u32;
        let info_header_size = 40u32;
        let file_size = file_header_size + info_header_size + buffer.len() as u32;
        let mut bmp_data = Vec::with_capacity(file_size as usize);
        bmp_data.extend_from_slice(b"BM");
        bmp_data.extend_from_slice(&file_size.to_le_bytes());
        bmp_data.extend_from_slice(&[0, 0, 0, 0]);
        bmp_data.extend_from_slice(&(file_header_size + info_header_size).to_le_bytes());
        bmp_data.extend_from_slice(&info_header_size.to_le_bytes());
        bmp_data.extend_from_slice(&crop_w.to_le_bytes());
        bmp_data.extend_from_slice(&(-crop_h).to_le_bytes());
        bmp_data.extend_from_slice(&1u16.to_le_bytes());
        bmp_data.extend_from_slice(&32u16.to_le_bytes());
        bmp_data.extend_from_slice(&0u32.to_le_bytes());
        bmp_data.extend_from_slice(&(buffer.len() as u32).to_le_bytes());
        bmp_data.extend_from_slice(&[0; 16]);
        bmp_data.extend_from_slice(&buffer);
        let _ = std::fs::write("test_captured_title.bmp", bmp_data);
        println!("已保存截取图像: test_captured_title.bmp ({}x{})", crop_w, crop_h);

        // OCR 识别
        let writer = DataWriter::new().unwrap();
        writer.WriteBytes(&buffer).unwrap();
        let ibuffer = writer.DetachBuffer().unwrap();

        let software_bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &ibuffer,
            BitmapPixelFormat::Bgra8,
            crop_w,
            crop_h,
        ).unwrap();

        let engine = Language::CreateLanguage(&HSTRING::from("zh-Hans-CN"))
            .ok()
            .and_then(|lang| OcrEngine::TryCreateFromLanguage(&lang).ok())
            .or_else(|| OcrEngine::TryCreateFromUserProfileLanguages().ok())
            .unwrap();

        let async_op = engine.RecognizeAsync(&software_bitmap).unwrap();
        let result = async_op.get().unwrap();
        let full_text = result.Text().unwrap_or_default().to_string();
        println!("===> OCR 识别原图文字: '{}'", full_text);
        assert!(!full_text.is_empty(), "OCR 应成功识别出文字");

        let cleaned = WechatDetector::clean_ocr_candidate(&full_text);
        println!("===> 清洗后会话/群聊名称: '{}'", cleaned);
        assert!(!cleaned.is_empty(), "清洗后结果不应为空");

        // 对比测试：如果经过 smooth_linear_stretch 平滑拉伸
        let mut enhanced_buffer = buffer.clone();
        WechatDetector::smooth_linear_stretch(&mut enhanced_buffer);
        let writer2 = DataWriter::new().unwrap();
        writer2.WriteBytes(&enhanced_buffer).unwrap();
        let ibuffer2 = writer2.DetachBuffer().unwrap();
        let software_bitmap2 = SoftwareBitmap::CreateCopyFromBuffer(
            &ibuffer2,
            BitmapPixelFormat::Bgra8,
            crop_w,
            crop_h,
        ).unwrap();
        let async_op2 = engine.RecognizeAsync(&software_bitmap2).unwrap();
        let result2 = async_op2.get().unwrap();
        let full_text2 = result2.Text().unwrap_or_default().to_string();
        println!("===> 经过 smooth_linear_stretch 后的 OCR 结果: '{}'", full_text2);
    }
}

#[test]
fn test_live_detect() {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, IsWindowVisible, GetWindowRect};
        use windows::Win32::Foundation::RECT;
        use windows::core::w;

        let hwnd = FindWindowW(w!("Qt51514QWindowIcon"), None).unwrap_or(windows::Win32::Foundation::HWND(std::ptr::null_mut()));
        if !hwnd.0.is_null() && IsWindowVisible(hwnd).as_bool() {
            let mut rc = RECT::default();
            if GetWindowRect(hwnd, &mut rc).is_ok() && (rc.right - rc.left) >= 200 {
                let res = WechatDetector::detect_chat_target(hwnd, "微信");
                println!("现场全流程真机识别结果: {:?}", res);
                assert!(res.is_some(), "当前前台/激活状态微信应成功识别出会话");
            } else {
                println!("微信窗口当前未处于展开激活状态，跳过真机尺寸检测");
            }
        } else {
            println!("未检测到可见的微信 4.0 窗口，跳过 live 检测");
        }
    }
}

#[test]
fn test_multiline_group_name_priority() {
    // 模拟微信顶部双行：第一行为群备注，第二行为实际业务群名
    let sample = "泰语 ~ 标贝 (5)\n兼职团队-泰语文本校对_曦瀚&标贝";
    let lines: Vec<&str> = sample.lines().collect();
    let mut candidates = Vec::new();
    for line in lines {
        let cleaned = WechatDetector::clean_ocr_candidate(line);
        let score = WechatDetector::score_ocr_candidate(&cleaned);
        candidates.push((cleaned, score));
    }
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    println!("双行群聊评分候选: {:?}", candidates);
    assert_eq!(candidates[0].0, "兼职团队-泰语文本校对_曦瀚&标贝");
}
