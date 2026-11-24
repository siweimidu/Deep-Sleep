//! The Rust port of `src/services/chat/history/schema.ts`.
//!
//! Validates an import archive and returns objects holding only the defined fields: containers and
//! metadata are strict, content fragments that cannot be parsed are dropped.

#![forbid(unsafe_code)]

use crate::js;
use serde_json::{Map, Value};

const EXPORT_FORMAT_VERSION: f64 = 3.0;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
const TIP_STYLES: [&str; 3] = ["INFO", "WARNING", "CAUTION"];
const SEARCH_STATUSES: [&str; 3] = ["WIP", "FINISHED", "FAILED"];
const FIND_STATUSES: [&str; 4] = ["WIP", "FINISHED", "NO_RESULT", "FAILED"];
const ROLES: [&str; 2] = ["USER", "ASSISTANT"];
const MESSAGE_STATUSES: [&str; 7] = [
    "WIP",
    "FINISHED",
    "CONTENT_FILTER",
    "FAILED",
    "INCOMPLETE",
    "CONTEXT_LENGTH_EXCEEDED",
    "TIMEOUT",
];

/// The original throws `BackupError(key)`, whose message is `translate(key)` from the live locale
/// store. The port renders the default (zh) locale, which is what behavior was recorded against;
/// the TypeScript adapter maps this back to `BackupError` so the UI stays locale-correct.
#[derive(Clone, Copy)]
enum Fail {
    Incomplete,
    NewerVersion,
    InvalidVersion,
}

impl Fail {
    fn message(self) -> &'static str {
        match self {
            Fail::Incomplete => "文件内容不完整，无法导入",
            Fail::NewerVersion => "文件版本过新，请升级后再导入",
            Fail::InvalidVersion => "文件版本无效，无法导入",
        }
    }
}

type R<T> = Result<T, Fail>;

/// Port of `checkManifest` (`src/services/chat/history/schema.ts:230`).
///
/// Returns `undefined` on success, like the source's `void` return.
pub fn check_manifest(value: Value) -> Result<Value, String> {
    check(&value)
        .map(|()| js::undefined())
        .map_err(|fail| fail.message().to_string())
}

fn check(value: &Value) -> R<()> {
    let object = record(value)?;
    let version = object.get("export_format_version");
    if version
        .and_then(Value::as_f64)
        .is_some_and(|n| n > EXPORT_FORMAT_VERSION)
    {
        return Err(Fail::NewerVersion);
    }
    if version.and_then(Value::as_f64) != Some(EXPORT_FORMAT_VERSION) {
        return Err(Fail::InvalidVersion);
    }
    Ok(())
}

/// Port of `readSessionFile` (`src/services/chat/history/schema.ts:252`).
pub fn read_session_file(value: Value) -> Result<Value, String> {
    session_file(&value).map_err(|fail| fail.message().to_string())
}

fn session_file(value: &Value) -> R<Value> {
    let item = record(value)?;
    let mut out = Map::new();
    out.insert("id".to_string(), session_id(item.get("id"))?);
    out.insert("title".to_string(), nullable_string(item.get("title"))?);
    out.insert("pinned".to_string(), Value::Bool(false));
    out.insert(
        "current_message_id".to_string(),
        count(item.get("current_message_id"))?,
    );
    out.insert("inserted_at".to_string(), time(item.get("inserted_at"))?);
    out.insert("updated_at".to_string(), time(item.get("updated_at"))?);
    let messages = list(item.get("messages"), message)?;
    out.insert(
        "messages".to_string(),
        Value::Array(messages.into_iter().flatten().collect()),
    );
    Ok(Value::Object(out))
}

// Port of `readSessionIndex` (`src/services/chat/history/schema.ts:240`) is not ported here: the
// source declares it as `export const readSessionIndex: Read<SessionIndexEntry[]>`, a form the
// export extractor skips, so it cannot be bridged and therefore cannot be diffed. See PLAN.md.

fn message(value: &Value) -> R<Option<Value>> {
    let item = record(value)?;
    let mut out = Map::new();
    out.insert("id".to_string(), count(item.get("id"))?);
    out.insert(
        "parent_id".to_string(),
        nullable_count(item.get("parent_id"))?,
    );
    out.insert("role".to_string(), one_of(item.get("role"), &ROLES)?);
    out.insert(
        "status".to_string(),
        one_of(item.get("status"), &MESSAGE_STATUSES)?,
    );
    out.insert(
        "thinking_enabled".to_string(),
        flag(item.get("thinking_enabled"))?,
    );
    out.insert(
        "search_enabled".to_string(),
        flag(item.get("search_enabled"))?,
    );
    out.insert(
        "accumulated_token_usage".to_string(),
        count(item.get("accumulated_token_usage"))?,
    );
    out.insert("inserted_at".to_string(), time(item.get("inserted_at"))?);
    let fragments = list(item.get("fragments"), fragment)?;
    out.insert(
        "fragments".to_string(),
        Value::Array(fragments.into_iter().flatten().collect()),
    );
    Ok(Some(Value::Object(out)))
}

/// A fragment that does not parse is dropped, not fatal (`schema.ts:189`).
fn fragment(value: &Value) -> R<Option<Value>> {
    match read_fragment(value) {
        Ok(fragment) => Ok(Some(fragment)),
        Err(Fail::Incomplete) => Ok(None),
        Err(other) => Err(other),
    }
}

fn read_fragment(value: &Value) -> R<Value> {
    let item = record(value)?;
    let kind = text(item.get("type"))?;
    let mut out = Map::new();
    out.insert("type".to_string(), kind.clone());
    let Some(kind) = kind.as_str() else {
        return Err(Fail::Incomplete);
    };
    match kind {
        "REQUEST" | "RESPONSE" | "TEMPLATE_RESPONSE" => {
            out.insert("content".to_string(), text(item.get("content"))?);
        }
        "THINK" => {
            out.insert("content".to_string(), text(item.get("content"))?);
            out.insert(
                "elapsed_secs".to_string(),
                nullable_number(item.get("elapsed_secs"))?,
            );
        }
        "TIP" | "CONTENT_RISK" => {
            out.insert("content".to_string(), text(item.get("content"))?);
            out.insert("style".to_string(), one_of(item.get("style"), &TIP_STYLES)?);
        }
        "PARTIAL_FILE_READ" => {
            let ratio = number(item.get("ratio"))?;
            let ok = ratio.as_f64().is_some_and(|n| (0.0..=100.0).contains(&n));
            if !ok {
                return Err(Fail::Incomplete);
            }
            out.insert("ratio".to_string(), ratio);
        }
        "TOOL_SEARCH" => {
            out.insert(
                "queries".to_string(),
                Value::Array(list(item.get("queries"), |v| text(Some(v)))?),
            );
            out.insert(
                "results".to_string(),
                Value::Array(list(item.get("results"), search_result)?),
            );
            if item.contains_key("status") {
                out.insert(
                    "status".to_string(),
                    one_of(item.get("status"), &SEARCH_STATUSES)?,
                );
            }
            tool_metadata(&mut out, item)?;
        }
        "TOOL_OPEN" => {
            out.insert(
                "status".to_string(),
                one_of(item.get("status"), &SEARCH_STATUSES)?,
            );
            out.insert("url".to_string(), nullable_string(item.get("url"))?);
            out.insert("title".to_string(), nullable_string(item.get("title"))?);
            if item.contains_key("snippet") {
                out.insert("snippet".to_string(), nullable_string(item.get("snippet"))?);
            }
            if item.contains_key("site_name") {
                out.insert(
                    "site_name".to_string(),
                    nullable_string(item.get("site_name"))?,
                );
            }
            out.insert(
                "published_at".to_string(),
                nullable_time(item.get("published_at"))?,
            );
            tool_metadata(&mut out, item)?;
        }
        "TOOL_FIND" => {
            out.insert(
                "status".to_string(),
                one_of(item.get("status"), &FIND_STATUSES)?,
            );
            if item.contains_key("pattern") {
                out.insert("pattern".to_string(), text(item.get("pattern"))?);
            }
            tool_metadata(&mut out, item)?;
        }
        "READ_LINK" => {
            out.insert(
                "results".to_string(),
                Value::Array(list(item.get("results"), |entry| {
                    let entry = record(entry)?;
                    let mut out = Map::new();
                    out.insert("signature".to_string(), text(entry.get("signature"))?);
                    if entry.contains_key("url") {
                        out.insert("url".to_string(), text(entry.get("url"))?);
                    }
                    if entry.contains_key("title") {
                        out.insert("title".to_string(), nullable_string(entry.get("title"))?);
                    }
                    Ok(Value::Object(out))
                })?),
            );
        }
        "FILE" => {
            out.insert(
                "files".to_string(),
                Value::Array(list(item.get("files"), file_entry)?),
            );
        }
        "TOOL_IMAGE_SEARCH" => {
            out.insert(
                "status".to_string(),
                one_of(item.get("status"), &SEARCH_STATUSES)?,
            );
            if item.contains_key("image_indexes") {
                out.insert(
                    "image_indexes".to_string(),
                    Value::Array(list(item.get("image_indexes"), |v| count(Some(v)))?),
                );
            }
            tool_metadata(&mut out, item)?;
            out.insert(
                "results".to_string(),
                Value::Array(list(item.get("results"), |result| {
                    let entry = record(result)?;
                    let mut out = Map::new();
                    out.insert("title".to_string(), text(entry.get("title"))?);
                    out.insert(
                        "source_page_url".to_string(),
                        text(entry.get("source_page_url"))?,
                    );
                    out.insert("snippet".to_string(), text(entry.get("snippet"))?);
                    out.insert(
                        "site_name".to_string(),
                        nullable_string(entry.get("site_name"))?,
                    );
                    out.insert(
                        "published_at".to_string(),
                        nullable_time(entry.get("published_at"))?,
                    );
                    Ok(Value::Object(out))
                })?),
            );
        }
        _ => return Err(Fail::Incomplete),
    }
    Ok(Value::Object(out))
}

fn search_result(value: &Value) -> R<Value> {
    let item = record(value)?;
    let mut out = Map::new();
    out.insert("url".to_string(), text(item.get("url"))?);
    out.insert("title".to_string(), text(item.get("title"))?);
    out.insert("snippet".to_string(), text(item.get("snippet"))?);
    out.insert(
        "published_at".to_string(),
        nullable_time(item.get("published_at"))?,
    );
    out.insert(
        "site_name".to_string(),
        nullable_string(item.get("site_name"))?,
    );
    if item.contains_key("site_icon") {
        out.insert(
            "site_icon".to_string(),
            nullable_string(item.get("site_icon"))?,
        );
    }
    Ok(Value::Object(out))
}

fn file_entry(value: &Value) -> R<Value> {
    let item = record(value)?;
    let mut out = Map::new();
    out.insert("id".to_string(), text(item.get("id"))?);
    out.insert("file_name".to_string(), text(item.get("file_name"))?);
    out.insert("file_size".to_string(), count(item.get("file_size"))?);
    out.insert(
        "token_usage".to_string(),
        nullable_count(item.get("token_usage"))?,
    );
    out.insert("inserted_at".to_string(), time(item.get("inserted_at"))?);
    out.insert(
        "export_path".to_string(),
        nullable_string(item.get("export_path"))?,
    );
    out.insert("is_image".to_string(), flag(item.get("is_image"))?);
    out.insert("width".to_string(), nullable_count(item.get("width"))?);
    out.insert("height".to_string(), nullable_count(item.get("height"))?);
    Ok(Value::Object(out))
}

fn tool_metadata(out: &mut Map<String, Value>, item: &Map<String, Value>) -> R<()> {
    if item.contains_key("stage_id") {
        out.insert("stage_id".to_string(), count(item.get("stage_id"))?);
    }
    if item.contains_key("group_id") {
        out.insert("group_id".to_string(), count(item.get("group_id"))?);
    }
    Ok(())
}

fn record(value: &Value) -> R<&Map<String, Value>> {
    value.as_object().ok_or(Fail::Incomplete)
}

fn text(value: Option<&Value>) -> R<Value> {
    match value {
        Some(Value::String(_)) => Ok(value.cloned().unwrap_or(Value::Null)),
        _ => Err(Fail::Incomplete),
    }
}

fn flag(value: Option<&Value>) -> R<Value> {
    match value {
        Some(Value::Bool(_)) => Ok(value.cloned().unwrap_or(Value::Null)),
        _ => Err(Fail::Incomplete),
    }
}

fn number(value: Option<&Value>) -> R<Value> {
    match value {
        Some(Value::Number(n)) if n.as_f64().is_some_and(f64::is_finite) => {
            Ok(value.cloned().unwrap_or(Value::Null))
        }
        _ => Err(Fail::Incomplete),
    }
}

/// `count`: a non-negative safe integer.
fn count(value: Option<&Value>) -> R<Value> {
    match value {
        Some(Value::Number(n))
            if n.as_f64()
                .is_some_and(|v| v.fract() == 0.0 && (0.0..=MAX_SAFE_INTEGER).contains(&v)) =>
        {
            Ok(value.cloned().unwrap_or(Value::Null))
        }
        _ => Err(Fail::Incomplete),
    }
}

fn nullable_string(value: Option<&Value>) -> R<Value> {
    if matches!(value, Some(Value::Null)) {
        return Ok(Value::Null);
    }
    text(value)
}

fn nullable_count(value: Option<&Value>) -> R<Value> {
    if matches!(value, Some(Value::Null)) {
        return Ok(Value::Null);
    }
    count(value)
}

fn nullable_number(value: Option<&Value>) -> R<Value> {
    if matches!(value, Some(Value::Null)) {
        return Ok(Value::Null);
    }
    number(value)
}

fn nullable_time(value: Option<&Value>) -> R<Value> {
    if matches!(value, Some(Value::Null)) {
        return Ok(Value::Null);
    }
    time(value)
}

fn one_of(value: Option<&Value>, allowed: &[&str]) -> R<Value> {
    match value.and_then(Value::as_str) {
        Some(s) if allowed.contains(&s) => Ok(Value::String(s.to_string())),
        _ => Err(Fail::Incomplete),
    }
}

fn session_id(value: Option<&Value>) -> R<Value> {
    let Some(id) = value.and_then(Value::as_str) else {
        return Err(Fail::Incomplete);
    };
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == "." || id == ".." {
        return Err(Fail::Incomplete);
    }
    Ok(Value::String(id.to_string()))
}

fn list<T>(value: Option<&Value>, read: impl Fn(&Value) -> R<T>) -> R<Vec<T>> {
    let Some(Value::Array(items)) = value else {
        return Err(Fail::Incomplete);
    };
    items.iter().map(read).collect()
}

/// `time`: `YYYY-MM-DDTHH:MM:SS[.fff]Z`, and only if the instant survives a millisecond round trip.
fn time(value: Option<&Value>) -> R<Value> {
    let Some(text) = value.and_then(Value::as_str) else {
        return Err(Fail::Incomplete);
    };
    if is_iso_utc(text) {
        Ok(Value::String(text.to_string()))
    } else {
        Err(Fail::Incomplete)
    }
}

fn is_iso_utc(text: &str) -> bool {
    let b = text.as_bytes();
    if b.len() < 20 {
        return false;
    }
    let digit = |i: usize| b[i].is_ascii_digit();
    let shaped = digit(0)
        && digit(1)
        && digit(2)
        && digit(3)
        && b[4] == b'-'
        && digit(5)
        && digit(6)
        && b[7] == b'-'
        && digit(8)
        && digit(9)
        && b[10] == b'T'
        && digit(11)
        && digit(12)
        && b[13] == b':'
        && digit(14)
        && digit(15)
        && b[16] == b':'
        && digit(17)
        && digit(18);
    if !shaped {
        return false;
    }
    let mut i = 19;
    if b[i] == b'.' {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    if i + 1 != b.len() || b[i] != b'Z' {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> i64 {
        range.fold(0i64, |acc, k| acc * 10 + i64::from(b[k] - b'0'))
    };
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));
    let (hour, minute, second) = (number(11..13), number(14..16), number(17..19));
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return false;
    }
    hour <= 23 && minute <= 59 && second <= 59
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        _ => 28,
    }
}

#[cfg(test)]
mod tests {
    use super::{check_manifest, read_session_file};
    use serde_json::json;

    #[test]
    fn accepts_only_the_supported_version() {
        assert!(check_manifest(json!({ "export_format_version": 3 })).is_ok());
        assert!(check_manifest(json!({ "export_format_version": 4 })).is_err());
        assert!(check_manifest(json!({ "export_format_version": "3" })).is_err());
        assert!(check_manifest(json!([])).is_err());
    }

    #[test]
    fn drops_unparsable_fragments_but_keeps_the_message() {
        let out = read_session_file(json!({
            "id": "s1", "title": null, "current_message_id": 0,
            "inserted_at": "2026-11-11T02:33:23Z", "updated_at": "2026-11-11T02:33:23Z",
            "messages": [{
                "id": 0, "parent_id": null, "role": "USER", "status": "FINISHED",
                "thinking_enabled": false, "search_enabled": false,
                "accumulated_token_usage": 0, "inserted_at": "2026-11-11T02:33:23Z",
                "fragments": [{ "type": "BOGUS" }, { "type": "REQUEST", "content": "kept" }]
            }]
        }))
        .unwrap();
        assert_eq!(
            out["messages"][0]["fragments"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(out["messages"][0]["fragments"][0]["content"], json!("kept"));
    }

    #[test]
    fn rejects_a_calendar_impossible_timestamp() {
        let base = |inserted: &str| {
            json!({
                "id": "s1", "title": null, "current_message_id": 0,
                "inserted_at": inserted, "updated_at": "2026-11-11T02:33:23Z",
                "messages": []
            })
        };
        assert!(read_session_file(base("2024-02-29T00:00:00Z")).is_ok());
        assert!(read_session_file(base("2023-02-29T00:00:00Z")).is_err());
        assert!(read_session_file(base("2026-11-11T02:33:23.123456Z")).is_ok());
        assert!(read_session_file(base("2026-11-11T02:33:23.Z")).is_err());
    }
}
