use std::time::Duration;
use tokio::time::sleep;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedContext {
    pub text: String,
    pub source_app: String,
    pub source_window: String,
    #[serde(default)]
    pub image_base64: Option<String>,
}

pub struct ClipboardService;

impl ClipboardService {
    #[cfg(windows)]
    pub async fn capture_selected_text_safe() -> Result<CapturedContext, String> {
        use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
            IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
        };
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
        use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            VK_C, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VIRTUAL_KEY,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        };

        const CF_UNICODETEXT: u32 = 13;

        // 1. 获取当前前台窗口与应用名称（此时焦点 100% 在用户正在操作的前台应用中）
        let (source_app, source_window, hwnd_val) = unsafe {
            let hwnd = GetForegroundWindow();
            let mut title = String::new();
            let mut app_name = String::from("未知应用");

            if !hwnd.0.is_null() {
                let len = GetWindowTextLengthW(hwnd);
                if len > 0 {
                    let mut buf = vec![0u16; (len + 1) as usize];
                    let read_len = GetWindowTextW(hwnd, &mut buf);
                    if read_len > 0 {
                        title = String::from_utf16_lossy(&buf[..read_len as usize]);
                    }
                }

                let mut process_id = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut process_id));
                if process_id > 0 {
                    if let Ok(process_handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
                        let mut img_buf = vec![0u16; 512];
                        let img_len = GetProcessImageFileNameW(process_handle, &mut img_buf);
                        if img_len > 0 {
                            let raw_path = String::from_utf16_lossy(&img_buf[..img_len as usize]);
                            let exe_name = raw_path.split('\\').last().unwrap_or("未知应用");
                            app_name = match exe_name.to_lowercase().as_str() {
                                "wechat.exe" | "weixin.exe" => "微信".to_string(),
                                "wxwork.exe" => "企业微信".to_string(),
                                "feishu.exe" => "飞书".to_string(),
                                "dingtalk.exe" => "钉钉".to_string(),
                                "chrome.exe" => "Chrome 浏览器".to_string(),
                                "msedge.exe" => "Edge 浏览器".to_string(),
                                "notepad.exe" => "记事本".to_string(),
                                "code.exe" => "VS Code".to_string(),
                                other => other.to_string(),
                            };
                        }
                    }
                }
            }
            (app_name, title, hwnd.0 as isize)
        };

        // 辅助：安全打开剪贴板带重试
        unsafe fn safe_open_clipboard() -> bool {
            for _ in 0..10 {
                if OpenClipboard(HWND(std::ptr::null_mut())).is_ok() {
                    return true;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            false
        }

        // 辅助：读取剪贴板纯文本
        unsafe fn read_clipboard_text() -> Option<String> {
            if !safe_open_clipboard() {
                return None;
            }
            let mut text = None;
            if IsClipboardFormatAvailable(CF_UNICODETEXT).is_ok() {
                if let Ok(handle) = GetClipboardData(CF_UNICODETEXT) {
                    let hglobal = HGLOBAL(handle.0);
                    let ptr = GlobalLock(hglobal);
                    if !ptr.is_null() {
                        let u16_slice = std::slice::from_raw_parts(ptr as *const u16, 1024 * 1024);
                        let len = u16_slice.iter().position(|&c| c == 0).unwrap_or(0);
                        text = Some(String::from_utf16_lossy(&u16_slice[..len]));
                        let _ = GlobalUnlock(hglobal);
                    }
                }
            }
            let _ = CloseClipboard();
            text
        }

        // 辅助：写回旧剪贴板文本
        unsafe fn write_clipboard_text(text: &str) {
            if !safe_open_clipboard() {
                return;
            }
            let _ = EmptyClipboard();
            let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = utf16.len() * 2;
            if let Ok(h_mem) = GlobalAlloc(GMEM_MOVEABLE, bytes) {
                let ptr = GlobalLock(h_mem);
                if !ptr.is_null() {
                    std::ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, ptr as *mut u8, bytes);
                    let _ = GlobalUnlock(h_mem);
                    let _ = SetClipboardData(CF_UNICODETEXT, HANDLE(h_mem.0));
                }
            }
            let _ = CloseClipboard();
        }

        // 辅助构造键盘输入
        fn make_key_input(vk: VIRTUAL_KEY, flags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS) -> INPUT {
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        // 2. 备份当前剪贴板纯文本
        let old_clipboard_text = unsafe { read_clipboard_text() };

        // 3. 记录当前剪贴板序列号
        let seq_before = unsafe { GetClipboardSequenceNumber() };

        // 4. 防御性释放当前物理按住的修饰键（避免 Alt+A 物理按住时将 Ctrl+C 合成为 Alt+Ctrl+C）
        unsafe {
            let mut release_inputs = Vec::new();
            if (GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0 {
                release_inputs.push(make_key_input(VK_MENU, KEYEVENTF_KEYUP));
            }
            if (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0 {
                release_inputs.push(make_key_input(VK_SHIFT, KEYEVENTF_KEYUP));
            }
            if (GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000) != 0 {
                release_inputs.push(make_key_input(VK_LWIN, KEYEVENTF_KEYUP));
            }
            if (GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000) != 0 {
                release_inputs.push(make_key_input(VK_RWIN, KEYEVENTF_KEYUP));
            }
            if !release_inputs.is_empty() {
                SendInput(&release_inputs, std::mem::size_of::<INPUT>() as i32);
                sleep(Duration::from_millis(20)).await;
            }
        }

        // 5. 模拟发送纯净的 Ctrl + C
        unsafe {
            let copy_inputs = [
                make_key_input(VK_CONTROL, windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0)),
                make_key_input(VK_C, windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0)),
                make_key_input(VK_C, KEYEVENTF_KEYUP),
                make_key_input(VK_CONTROL, KEYEVENTF_KEYUP),
            ];
            SendInput(&copy_inputs, std::mem::size_of::<INPUT>() as i32);
        }

        // 6. 轮询等待剪贴板序列号变更（最多等待 300ms，每 25ms 探测一次）
        let mut clipboard_changed = false;
        for _ in 0..12 {
            sleep(Duration::from_millis(25)).await;
            let seq_now = unsafe { GetClipboardSequenceNumber() };
            if seq_now != seq_before {
                clipboard_changed = true;
                break;
            }
        }

        // 7. 读取新选中的文本
        let captured_text = unsafe { read_clipboard_text() }.unwrap_or_default();

        // 8. 恢复用户原有剪贴板（延迟恢复，不破坏用户历史）
        if let Some(old_text) = old_clipboard_text {
            if clipboard_changed && captured_text != old_text {
                tauri::async_runtime::spawn(async move {
                    sleep(Duration::from_millis(250)).await;
                    unsafe {
                        write_clipboard_text(&old_text);
                    }
                });
            }
        }

        let clean_text = captured_text.trim().to_string();
        if clean_text.is_empty() {
            return Err("未能捕获到选中文本，请确保已划选文字".to_string());
        }

        println!("\n[划选捕获] 成功获取选中文本: {} 字符 | 前台应用: '{}' | 前台窗口: '{}'", clean_text.chars().count(), source_app, source_window);

        // 若来源应用是微信或企业微信，静默同步抓取当前会话标题栏图像，供 LLM 多模态直接统一归集
        let mut image_base64 = None;
        if source_app == "微信" || source_app == "企业微信" {
            let hwnd = windows::Win32::Foundation::HWND(hwnd_val as *mut std::ffi::c_void);
            image_base64 = crate::services::wechat_detector::WechatDetector::capture_chat_header_base64(hwnd);
            if let Some(ref b64) = image_base64 {
                println!("│ [多模态视觉感知] 已静默抓取微信当前会话标题图像 (Base64 大小: {} 字符)", b64.len());
            }
        }

        Ok(CapturedContext {
            text: clean_text,
            source_app,
            source_window,
            image_base64,
        })
    }

    #[cfg(not(windows))]
    pub async fn capture_selected_text_safe() -> Result<CapturedContext, String> {
        Ok(CapturedContext {
            text: "测试划选内容：周三上午10点前需要提交技术白皮书。".to_string(),
            source_app: "Mock 应用".to_string(),
            source_window: "测试会话".to_string(),
            image_base64: None,
        })
    }
}
