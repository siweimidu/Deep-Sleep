//! The Rust port of `src/services/chat/history/paths.ts`.
//!
//! ZIP entry names for the export archive: manifest → user → every session JSON → index → images.

#![forbid(unsafe_code)]

use unicode_normalization::UnicodeNormalization;

/// Port of `sessionPath` (`src/services/chat/history/paths.ts:7`).
pub fn session_path(session_id: String) -> Result<String, String> {
    Ok(format!("chat_sessions/{session_id}.json"))
}

/// Port of `sessionFilesDir` (`src/services/chat/history/paths.ts:10`).
pub fn session_files_dir(session_id: String) -> Result<String, String> {
    Ok(format!("chat_sessions/{session_id}_files/"))
}

/// Port of `parseSessionPath` (`src/services/chat/history/paths.ts:13`).
///
/// The source returns `string | null`, so miss returns `Value::Null`: `None` would cross the wire as
/// `undefined`, which is not what the caller checks for.
/// The regex is `^chat_sessions\/([^/]+)\.json$`, so an empty name or a further `/` is not a
/// session entry. The suffix is stripped once, so `a.json.json` still parses as `a.json`.
pub fn parse_session_path(path: String) -> Result<serde_json::Value, String> {
    let Some(rest) = path.strip_prefix("chat_sessions/") else {
        return Ok(serde_json::Value::Null);
    };
    let Some(name) = rest.strip_suffix(".json") else {
        return Ok(serde_json::Value::Null);
    };
    if name.is_empty() || name.contains('/') {
        return Ok(serde_json::Value::Null);
    }
    Ok(serde_json::Value::String(name.to_string()))
}

/// Port of `imagePath` (`src/services/chat/history/paths.ts:23`).
pub fn image_path(
    session_id: String,
    file_id: String,
    file_name: String,
) -> Result<String, String> {
    let raw = format!(
        "chat_sessions/{session_id}_files/{}_{}",
        safe_name(&file_id),
        safe_name(&file_name)
    );
    Ok(raw.nfc().collect())
}

/// `safeName`: path separators become `_`; empty, `.` and `..` become `unnamed`.
fn safe_name(name: &str) -> String {
    let result: String = name
        .chars()
        .map(|c| if c == '/' || c == '\\' { '_' } else { c })
        .collect();
    if result.is_empty() || result == "." || result == ".." {
        "unnamed".to_string()
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{image_path, parse_session_path};

    #[test]
    fn parses_only_session_entries() {
        let p = |s: &str| parse_session_path(s.to_string()).unwrap();
        assert_eq!(p("chat_sessions/a.json"), serde_json::json!("a"));
        assert_eq!(p("chat_sessions/a.json.json"), serde_json::json!("a.json"));
        assert_eq!(p("chat_sessions/.json"), serde_json::Value::Null);
        assert_eq!(p("chat_sessions/a/b.json"), serde_json::Value::Null);
        assert_eq!(p("chat_sessions/a.jsonx"), serde_json::Value::Null);
        assert_eq!(p("other/a.json"), serde_json::Value::Null);
    }

    #[test]
    fn sanitises_and_normalises_image_names() {
        let p = |a: &str, b: &str| image_path("s".into(), a.into(), b.into()).unwrap();
        assert_eq!(p("f", "n.png"), "chat_sessions/s_files/f_n.png");
        assert_eq!(p("a/b", "c\\d"), "chat_sessions/s_files/a_b_c_d");
        assert_eq!(p("..", ""), "chat_sessions/s_files/unnamed_unnamed");
        // NFC: "e" + combining acute becomes a single code point.
        assert_eq!(
            p("f", "e\u{0301}.png"),
            "chat_sessions/s_files/f_\u{e9}.png"
        );
    }
}
