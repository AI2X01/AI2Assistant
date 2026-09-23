fn clean_ocr_title(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 1. 先按行拆分，过滤纯无用行（如 "搜索"、"微信"）
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

#[test]
fn test_clean_ocr_scenarios() {
    assert_eq!(clean_ocr_title("O 邹 宗 笑"), Some("邹宗笑".to_string()));
    assert_eq!(clean_ocr_title("0 搜索\n邹 宗 笑"), Some("邹宗笑".to_string()));
    assert_eq!(
        clean_ocr_title("潮 汕 话 标 注 群 - 信 实 翻 译 公 司 ( 5 0 )"),
        Some("潮汕话标注群-信实翻译公司 (50)".to_string())
    );
    assert_eq!(
        clean_ocr_title("0 搜索\n潮 汕 话 标 注 群 - 信 实 翻 译 公 司 { 50 }"),
        Some("潮汕话标注群-信实翻译公司 (50)".to_string())
    );
    assert_eq!(clean_ocr_title("搜索"), None);
    assert_eq!(clean_ocr_title("0 搜索"), None);
}
