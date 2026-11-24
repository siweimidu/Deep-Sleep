//! The Rust port of `src/services/api/parseEvent.ts`.
//!
//! `serde_json::Map` keeps insertion order, and inserting an existing key keeps its position, so
//! `insert` reproduces what `{ ...value, key: x }` does in JS. A key the source sets to
//! `undefined` is written with `js::undefined()`, which is distinct from `null` on the wire.

#![forbid(unsafe_code)]

use crate::js;
use serde_json::{Map, Value};

const SERVER_TOOL_KINDS: [&str; 5] = [
    "search",
    "deep_search",
    "read_link",
    "image_search",
    "deep_image_search",
];
const SERVER_TOOL_NAMES: [&str; 2] = ["deepseek_web_search", "deepseek_read_url"];
const TOOL_RESULT_KINDS: [&str; 4] = ["search", "deep_search", "image_search", "deep_image_search"];
const FETCH_RESULT_KINDS: [&str; 2] = ["read_link", "deep_search"];
const STOP_REASONS: [&str; 4] = ["end_turn", "max_tokens", "tool_use", "refusal"];
const USAGE_KEYS: [&str; 4] = [
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
];

/// Port of `readMessageEvent` (`src/services/api/parseEvent.ts:175`).
///
/// Validates only what the consumer needs and keeps every field the server sent. An event that is
/// not recognised, or cannot be consumed safely, is dropped (returns `None`).
pub fn read_message_event(value: Value) -> Result<Option<Value>, String> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    match object.get("type").and_then(Value::as_str) {
        Some("message_start") => message_start(object),
        Some("content_block_start") => {
            let index = object.get("index");
            if !is_index(index) {
                return Ok(None);
            }
            let Some(block) = read_block(object.get("content_block")) else {
                return Ok(None);
            };
            let mut out = Map::new();
            out.insert(
                "type".to_string(),
                Value::String("content_block_start".into()),
            );
            if let Some(index) = index {
                out.insert("index".to_string(), index.clone());
            }
            out.insert("content_block".to_string(), block);
            Ok(Some(Value::Object(out)))
        }
        Some("content_block_delta") => {
            let index = object.get("index");
            if !is_index(index) {
                return Ok(None);
            }
            let Some(delta) = read_delta(object.get("delta")) else {
                return Ok(None);
            };
            let mut out = Map::new();
            out.insert(
                "type".to_string(),
                Value::String("content_block_delta".into()),
            );
            if let Some(index) = index {
                out.insert("index".to_string(), index.clone());
            }
            out.insert("delta".to_string(), delta);
            Ok(Some(Value::Object(out)))
        }
        Some("content_block_stop") => {
            if is_index(object.get("index")) {
                Ok(Some(value))
            } else {
                Ok(None)
            }
        }
        Some("message_delta") => message_delta(object),
        Some("message_stop") => Ok(Some(value)),
        _ => Ok(None),
    }
}

fn message_start(object: &Map<String, Value>) -> Result<Option<Value>, String> {
    let Some(message) = object.get("message").and_then(Value::as_object) else {
        return Ok(None);
    };
    let mut out = object.clone();
    let mut message = message.clone();
    message.insert("usage".to_string(), usage_or_undefined(object, "message"));
    out.insert("message".to_string(), Value::Object(message));
    Ok(Some(Value::Object(out)))
}

fn message_delta(object: &Map<String, Value>) -> Result<Option<Value>, String> {
    let Some(delta) = object.get("delta").and_then(Value::as_object) else {
        return Ok(None);
    };
    if !one_of(delta.get("stop_reason"), &STOP_REASONS) {
        return Ok(None);
    }
    let mut out = object.clone();
    let mut delta = delta.clone();
    delta.insert("title".to_string(), optional_string(&delta, "title"));
    out.insert("delta".to_string(), Value::Object(delta));
    out.insert("usage".to_string(), usage_or_undefined(object, ""));
    Ok(Some(Value::Object(out)))
}

/// `isUsage` decides whether `usage` survives; otherwise the key is `undefined`.
fn usage_or_undefined(object: &Map<String, Value>, parent: &str) -> Value {
    let holder = if parent.is_empty() {
        Some(object)
    } else {
        object.get(parent).and_then(Value::as_object)
    };
    match holder.and_then(|h| h.get("usage")) {
        Some(usage) if is_usage(Some(usage)) => usage.clone(),
        _ => js::undefined(),
    }
}

/// Port of `readBlock` (`src/services/api/parseEvent.ts:23`).
fn read_block(value: Option<&Value>) -> Option<Value> {
    let object = value?.as_object()?;
    match object.get("type").and_then(Value::as_str) {
        Some("text") => {
            if !object.get("text").is_some_and(Value::is_string) {
                return None;
            }
            let mut out = object.clone();
            out.insert("type".to_string(), Value::String("text".into()));
            if let Some(text) = object.get("text") {
                out.insert("text".to_string(), text.clone());
            }
            if is_present(object.get("citations")) {
                let citations = match object.get("citations") {
                    Some(Value::Array(items)) => items
                        .iter()
                        .filter(|item| is_citation(item))
                        .cloned()
                        .collect(),
                    _ => Vec::new(),
                };
                out.insert("citations".to_string(), Value::Array(citations));
            }
            Some(Value::Object(out))
        }
        Some("thinking") => {
            if !object.get("thinking").is_some_and(Value::is_string) {
                return None;
            }
            let mut out = object.clone();
            out.insert(
                "signature".to_string(),
                optional_string(object, "signature"),
            );
            Some(Value::Object(out))
        }
        Some("server_tool_use") => {
            if !object.get("id").is_some_and(Value::is_string)
                || !one_of(object.get("kind"), &SERVER_TOOL_KINDS)
                || !one_of(object.get("name"), &SERVER_TOOL_NAMES)
            {
                return None;
            }
            let input = object.get("input").and_then(Value::as_object)?;
            match input.get("action").and_then(Value::as_str) {
                Some("search") => {
                    if !matches!(input.get("queries"), Some(Value::Array(items)) if items.iter().all(Value::is_string))
                    {
                        return None;
                    }
                }
                Some("open_page") | Some("read_link") => {
                    if !input.get("url").is_some_and(Value::is_string) {
                        return None;
                    }
                }
                Some("find_in_page") => {
                    if !input.get("url").is_some_and(Value::is_string)
                        || !input.get("pattern").is_some_and(Value::is_string)
                    {
                        return None;
                    }
                }
                _ => return None,
            }
            Some(Value::Object(object.clone()))
        }
        Some("web_search_tool_result") => {
            if !object.get("tool_use_id").is_some_and(Value::is_string)
                || !one_of(object.get("kind"), &TOOL_RESULT_KINDS)
            {
                return None;
            }
            let Some(Value::Array(content)) = object.get("content") else {
                return None;
            };
            let mut out = object.clone();
            out.insert(
                "content".to_string(),
                Value::Array(
                    content
                        .iter()
                        .filter(|item| is_search_result(item))
                        .cloned()
                        .collect(),
                ),
            );
            Some(Value::Object(out))
        }
        Some("web_fetch_tool_result") => {
            if !object.get("tool_use_id").is_some_and(Value::is_string)
                || !one_of(object.get("kind"), &FETCH_RESULT_KINDS)
            {
                return None;
            }
            let content = object.get("content").and_then(Value::as_object)?;
            if content.get("type").and_then(Value::as_str) == Some("web_fetch_tool_result_error") {
                if !content.get("error_code").is_some_and(Value::is_string) {
                    return None;
                }
            } else {
                if content.get("type").and_then(Value::as_str) != Some("web_fetch_result")
                    || !content.get("url").is_some_and(Value::is_string)
                {
                    return None;
                }
                let inner = content.get("content").and_then(Value::as_object)?;
                if !field_nullable_string(inner, "title")
                    || !field_nullable_string(inner, "published_at")
                {
                    return None;
                }
            }
            let mut out = object.clone();
            out.insert(
                "signature".to_string(),
                optional_string(object, "signature"),
            );
            Some(Value::Object(out))
        }
        // Recognised but not consumed here: handed back unchanged for the reply layer.
        Some("tool_use") => Some(Value::Object(object.clone())),
        _ => None,
    }
}

/// Port of `readDelta` (`src/services/api/parseEvent.ts:150`).
fn read_delta(value: Option<&Value>) -> Option<Value> {
    let object = value?.as_object()?;
    let ok = match object.get("type").and_then(Value::as_str) {
        Some("text_delta") => object.get("text").is_some_and(Value::is_string),
        Some("thinking_delta") => object.get("thinking").is_some_and(Value::is_string),
        Some("signature_delta") => object.get("signature").is_some_and(Value::is_string),
        Some("citations_delta") => object.get("citation").is_some_and(is_citation),
        _ => false,
    };
    ok.then(|| Value::Object(object.clone()))
}

fn is_citation(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("type").and_then(Value::as_str) == Some("web_search_result_location")
        && object.get("url").is_some_and(Value::is_string)
        && field_nullable_string(object, "title")
}

fn is_search_result(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("web_search_tool_result_error") {
        return object.get("error_code").is_some_and(Value::is_string);
    }
    object.get("type").and_then(Value::as_str) == Some("web_search_result")
        && object.get("url").is_some_and(Value::is_string)
        && object.get("title").is_some_and(Value::is_string)
        && field_nullable_string(object, "snippet")
        && field_nullable_string(object, "site_name")
        && field_nullable_string(object, "site_icon")
        && field_nullable_string(object, "page_age")
}

fn is_usage(value: Option<&Value>) -> bool {
    let Some(object) = value.and_then(Value::as_object) else {
        return false;
    };
    USAGE_KEYS.iter().all(|key| match object.get(*key) {
        Some(Value::Number(number)) => number.as_f64().is_some_and(f64::is_finite),
        _ => false,
    })
}

/// `Number.isSafeInteger(value) && value >= 0`.
fn is_index(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|n| n.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(&n))
}

fn one_of(value: Option<&Value>, allowed: &[&str]) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|s| allowed.contains(&s))
}

/// `value === undefined` is false for a key that is present and not the undefined sentinel.
fn is_present(value: Option<&Value>) -> bool {
    match value {
        None => false,
        Some(v) => !js::is_undefined(v),
    }
}

/// `isOptionalString`: `undefined` or a string, never `null`.
fn field_optional_string(object: &Map<String, Value>, key: &str) -> bool {
    object
        .get(key)
        .is_none_or(|v| js::is_undefined(v) || v.is_string())
}

/// `isNullableString`: `null`, `undefined` or a string.
fn field_nullable_string(object: &Map<String, Value>, key: &str) -> bool {
    object
        .get(key)
        .is_none_or(|v| v.is_null() || js::is_undefined(v) || v.is_string())
}

/// `key: isOptionalString(object[key]) ? object[key] : undefined`.
fn optional_string(object: &Map<String, Value>, key: &str) -> Value {
    match object.get(key) {
        Some(v) if field_optional_string(object, key) => v.clone(),
        _ => js::undefined(),
    }
}

#[cfg(test)]
mod tests {
    use super::read_message_event;
    use serde_json::json;

    fn read(value: serde_json::Value) -> serde_json::Value {
        serde_json::to_value(read_message_event(value).unwrap()).unwrap()
    }

    #[test]
    fn drops_unknown_and_non_object_events() {
        assert_eq!(read(json!({ "type": "ping" })), json!(null));
        assert_eq!(read(json!([1, 2])), json!(null));
        assert_eq!(read(json!("text")), json!(null));
    }

    #[test]
    fn keeps_unrecognised_fields_on_message_start() {
        let out = read(json!({
            "type": "message_start",
            "extra": 7,
            "message": { "id": "m1", "model": "x", "usage": {
                "input_tokens": 1, "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0, "output_tokens": 0
            }}
        }));
        assert_eq!(out["extra"], json!(7));
        assert_eq!(out["message"]["usage"]["input_tokens"], json!(1));
    }

    #[test]
    fn marks_a_missing_usage_as_undefined_not_null() {
        let out = read(json!({ "type": "message_start", "message": { "id": "m1" } }));
        assert_eq!(out["message"]["usage"], json!({ "$undefined": true }));
    }

    #[test]
    fn rejects_a_bad_delta_and_keeps_a_good_one() {
        assert_eq!(
            read(json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "nope" } })),
            json!(null)
        );
        assert_eq!(
            read(
                json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "text_delta", "text": "hi" } })
            ),
            json!({ "type": "content_block_delta", "index": 2, "delta": { "type": "text_delta", "text": "hi" } })
        );
    }

    #[test]
    fn filters_invalid_citations_but_keeps_the_key() {
        let out = read(json!({
            "type": "content_block_start", "index": 0,
            "content_block": { "type": "text", "text": "hi", "citations": [
                { "type": "web_search_result_location", "url": "u", "title": null },
                { "type": "web_search_result_location", "url": 5, "title": "t" }
            ]}
        }));
        assert_eq!(
            out["content_block"]["citations"].as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn rejects_a_negative_or_fractional_index() {
        assert_eq!(
            read(json!({ "type": "content_block_stop", "index": -1 })),
            json!(null)
        );
        assert_eq!(
            read(json!({ "type": "content_block_stop", "index": 1.5 })),
            json!(null)
        );
        assert_eq!(
            read(json!({ "type": "content_block_stop", "index": 3 })),
            json!({ "type": "content_block_stop", "index": 3 })
        );
    }
}
