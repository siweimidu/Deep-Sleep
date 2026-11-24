//! The Rust port of `src/services/chat/history/toArchive.ts`.
//!
//! `toIndexEntry` is the `chat_session_index.json` line of one session file: the id and the two
//! timestamps are copied as they stand in the session file, `current_message_id` and the message
//! tree are dropped, `pinned` is forced to false and `message_count` counts the tree.

#![forbid(unsafe_code)]

use serde_json::{Map, Value, json};

/// Port of `toIndexEntry` (`src/services/chat/history/toArchive.ts:271`).
///
/// The timestamps are not built here: only `toSessionFile` (js-only in this crate) turns epoch
/// milliseconds into ISO 8601, so this projection carries the strings a session file already holds
/// and never re-reads them as dates.
pub fn to_index_entry(file: serde_json::Value) -> Result<serde_json::Value, String> {
    let object: Option<&Map<String, Value>> = match &file {
        value if crate::js::is_undefined(value) => return Err(read_error("undefined", "id")),
        Value::Null => return Err(read_error("null", "id")),
        // Every other non-object reads each property as undefined.
        value => value.as_object(),
    };
    let field = |key: &str| match object.and_then(|fields| fields.get(key)) {
        Some(value) => value.clone(),
        None => crate::js::undefined(),
    };
    let count = message_count(&field("messages"))?;
    Ok(json!({
        "id": field("id"),
        "title": field("title"),
        "pinned": false,
        "message_count": count,
        "inserted_at": field("inserted_at"),
        "updated_at": field("updated_at"),
    }))
}

/// `file.messages.length`: a JS length, so UTF-16 code units for a string, whatever a plain object
/// carries under `length`, and a TypeError where the source reads a property of null or undefined.
fn message_count(messages: &Value) -> Result<Value, String> {
    match messages {
        Value::Array(items) => Ok(Value::from(items.len())),
        Value::String(text) => Ok(Value::from(text.encode_utf16().count())),
        Value::Null => Err(read_error("null", "length")),
        value if crate::js::is_undefined(value) => Err(read_error("undefined", "length")),
        Value::Object(fields) => Ok(match fields.get("length") {
            Some(length) => length.clone(),
            None => crate::js::undefined(),
        }),
        _ => Ok(crate::js::undefined()),
    }
}

/// The TypeError V8 raises on a property read of null or undefined.
fn read_error(receiver: &str, key: &str) -> String {
    format!("TypeError: Cannot read properties of {receiver} (reading '{key}')")
}

#[cfg(test)]
mod tests {
    use super::to_index_entry;
    use serde_json::{Value, json};

    fn files(messages: Value) -> Value {
        json!({
            "id": "s",
            "title": null,
            "pinned": true,
            "current_message_id": 0,
            "inserted_at": "2024-01-02T03:04:05.678Z",
            "updated_at": "2024-01-02T03:04:06.000Z",
            "messages": messages,
        })
    }

    fn count_of(messages: Value) -> Value {
        match to_index_entry(files(messages)) {
            Ok(entry) => entry.get("message_count").cloned().unwrap_or(Value::Null),
            Err(error) => Value::String(error),
        }
    }

    #[test]
    fn projects_the_index_entry() {
        let entry = to_index_entry(files(json!([{ "id": 1 }]))).ok();
        assert_eq!(
            entry,
            Some(json!({
                "id": "s",
                "title": null,
                "pinned": false,
                "message_count": 1,
                "inserted_at": "2024-01-02T03:04:05.678Z",
                "updated_at": "2024-01-02T03:04:06.000Z",
            }))
        );
    }

    #[test]
    fn counts_messages_as_a_js_length() {
        assert_eq!(count_of(json!([])), json!(0));
        assert_eq!(count_of(json!(["a", "b", "c"])), json!(3));
        // UTF-16 code units, not bytes and not chars.
        assert_eq!(count_of(json!("用户😀")), json!(4));
        assert_eq!(count_of(json!({ "length": 7 })), json!(7));
        assert_eq!(
            count_of(Value::Null),
            json!("TypeError: Cannot read properties of null (reading 'length')")
        );
        assert_eq!(
            count_of(crate::js::undefined()),
            json!("TypeError: Cannot read properties of undefined (reading 'length')")
        );
    }

    #[test]
    fn keeps_missing_fields_undefined() {
        let entry = to_index_entry(json!({ "messages": [] })).ok();
        assert_eq!(
            entry,
            Some(json!({
                "id": crate::js::undefined(),
                "title": crate::js::undefined(),
                "pinned": false,
                "message_count": 0,
                "inserted_at": crate::js::undefined(),
                "updated_at": crate::js::undefined(),
            }))
        );
    }

    #[test]
    fn rejects_a_missing_file() {
        assert_eq!(
            to_index_entry(Value::Null).err(),
            Some("TypeError: Cannot read properties of null (reading 'id')".to_string())
        );
        assert_eq!(
            to_index_entry(crate::js::undefined()).err(),
            Some("TypeError: Cannot read properties of undefined (reading 'id')".to_string())
        );
    }
}
