use ai2assistant_lib::services::wechat_detector::{is_system_keyword, WechatDetector};
use windows::Win32::Foundation::RECT;
use windows::Win32::UI::Accessibility::UIA_TextControlTypeId;

#[test]
fn test_system_keywords() {
    assert!(is_system_keyword("微信"));
    assert!(is_system_keyword("ChatWnd"));
    assert!(is_system_keyword("按住鼠标 语音输入文字"));
    assert!(is_system_keyword("16:52"));
    assert!(!is_system_keyword("【标贝-曦瀚】潮汕话标注对接 (7)"));
    assert!(!is_system_keyword("华东交付协同群"));
    assert!(!is_system_keyword("陈浩、兰斌、陈祺"));
}

#[test]
fn test_sender_extraction() {
    let t1 = "王经理@远大智造\n2026年09月23日 15:15\n下午接口联调完成提交测试";
    assert_eq!(
        WechatDetector::detect_sender_from_text(t1),
        Some("王经理@远大智造".to_string())
    );

    let t2 = "张三: 下午我会重点检查进度";
    assert_eq!(
        WechatDetector::detect_sender_from_text(t2),
        Some("张三".to_string())
    );
}
