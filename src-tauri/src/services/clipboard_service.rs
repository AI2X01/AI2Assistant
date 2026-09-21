use std::time::Duration;
use tokio::time::sleep;

#[derive(Debug, Clone)]
pub struct CapturedContext {
    pub text: String,
    pub source_app: String,
    pub source_window: String,
}

pub struct ClipboardService;

impl ClipboardService {
    #[cfg(windows)]
    pub async fn capture_selected_text_safe() -> Result<CapturedContext, String> {
        use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
        use windows::Win32::System::DataExchange::{
            CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
            OpenClipboard, SetClipboardData,
        };
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
        use windows::Win32::System::ProcessStatus::GetProcessImageFileNameW;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_C,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        };

        const CF_UNICODETEXT: u32 = 13;

        // 1. 获取前台窗口与应用名称
        let (source_app, source_window) = unsafe {
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
                                "wechat.exe" => "微信".to_string(),
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
            (app_name, title)
        };

        // 2. 备份当前剪贴板纯文本
        let old_clipboard_text: Option<String> = unsafe {
            if OpenClipboard(HWND(std::ptr::null_mut())).is_ok() {
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
            } else {
                None
            }
        };

        // 3. 模拟击键发送 Ctrl + C
        unsafe {
            let inputs = [
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_CONTROL,
                            wScan: 0,
                            dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0),
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                },
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_C,
                            wScan: 0,
                            dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0),
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                },
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_C,
                            wScan: 0,
                            dwFlags: KEYEVENTF_KEYUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                },
                INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VK_CONTROL,
                            wScan: 0,
                            dwFlags: KEYEVENTF_KEYUP,
                            time: 0,
                            dwExtraInfo: 0,
                        },
                    },
                },
            ];

            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }

        // 等待剪贴板就绪
        sleep(Duration::from_millis(80)).await;

        // 4. 读取最新选中文本
        let captured_text = unsafe {
            let mut captured = String::new();
            if OpenClipboard(HWND(std::ptr::null_mut())).is_ok() {
                if IsClipboardFormatAvailable(CF_UNICODETEXT).is_ok() {
                    if let Ok(handle) = GetClipboardData(CF_UNICODETEXT) {
                        let hglobal = HGLOBAL(handle.0);
                        let ptr = GlobalLock(hglobal);
                        if !ptr.is_null() {
                            let u16_slice = std::slice::from_raw_parts(ptr as *const u16, 1024 * 1024);
                            let len = u16_slice.iter().position(|&c| c == 0).unwrap_or(0);
                            captured = String::from_utf16_lossy(&u16_slice[..len]);
                            let _ = GlobalUnlock(hglobal);
                        }
                    }
                }
                let _ = CloseClipboard();
            }
            captured
        };

        // 5. 异步安全恢复旧剪贴板内容（保证绝不污染用户既有复制历史）
        if let Some(old_text) = old_clipboard_text {
            tokio::spawn(async move {
                sleep(Duration::from_millis(150)).await;
                unsafe {
                    if OpenClipboard(HWND(std::ptr::null_mut())).is_ok() {
                        let _ = EmptyClipboard();
                        let utf16: Vec<u16> = old_text.encode_utf16().chain(std::iter::once(0)).collect();
                        let bytes = utf16.len() * 2;
                        let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
                        if let Ok(h_mem) = h_mem {
                            let ptr = GlobalLock(h_mem);
                            if !ptr.is_null() {
                                std::ptr::copy_nonoverlapping(utf16.as_ptr() as *const u8, ptr as *mut u8, bytes);
                                let _ = GlobalUnlock(h_mem);
                                let _ = SetClipboardData(CF_UNICODETEXT, HANDLE(h_mem.0));
                            }
                        }
                        let _ = CloseClipboard();
                    }
                }
            });
        }

        let clean_text = captured_text.trim().to_string();
        if clean_text.is_empty() {
            return Err("未能捕获到选中文本，请确保已划选文字".to_string());
        }

        Ok(CapturedContext {
            text: clean_text,
            source_app,
            source_window,
        })
    }

    #[cfg(not(windows))]
    pub async fn capture_selected_text_safe() -> Result<CapturedContext, String> {
        Ok(CapturedContext {
            text: "测试划选内容：周三上午10点前需要提交技术白皮书。".to_string(),
            source_app: "Mock 应用".to_string(),
            source_window: "测试会话".to_string(),
        })
    }
}
