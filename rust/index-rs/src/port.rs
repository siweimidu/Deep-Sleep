//! The Rust port of `src/i18n/index.ts`.
//!
//! Only the two pure exports are ported. `translate` and `useTranslate` stay in TypeScript because
//! they read the settings store (kept via `bridge --keep`), so their locale is runtime state.
//!
//! The message table in `src/data.rs` is generated from `src/i18n/{zh,en}.ts` by `gen-data.mjs`.

#![forbid(unsafe_code)]

mod data;

use data::MESSAGES;
use serde_json::Value;

/// What the original throws, verbatim: `messages[key]` is undefined for an unknown key.
const UNKNOWN_KEY: &str = "Cannot read properties of undefined (reading 'replace')";
/// What the original throws, verbatim: `translators[locale]` is undefined for an unknown locale.
const UNKNOWN_LOCALE: &str = "translators[locale] is not a function";

/// Port of `isTranslationKey` (`src/i18n/index.ts:14`): own keys only, so `toString` is not a key.
pub fn is_translation_key(key: Value) -> Result<bool, String> {
    Ok(key.as_str().is_some_and(|name| message(name).is_some()))
}

/// Port of `translateFor` (`src/i18n/index.ts:34`).
///
/// `translators[locale]` is read before the call, so an unknown locale wins over an unknown key.
pub fn translate_for(locale: String, key: Value, params: Option<Value>) -> Result<String, String> {
    let column = match locale.as_str() {
        "zh-CN" => 0,
        "en-US" => 1,
        _ => return Err(UNKNOWN_LOCALE.to_string()),
    };
    let Some((zh, en)) = key.as_str().and_then(message) else {
        return Err(UNKNOWN_KEY.to_string());
    };
    Ok(substitute(
        if column == 0 { zh } else { en },
        params.as_ref(),
    ))
}

fn message(key: &str) -> Option<(&'static str, &'static str)> {
    MESSAGES
        .iter()
        .find(|(name, _, _)| *name == key)
        .map(|(_, zh, en)| (*zh, *en))
}

/// `template.replace(/\{(\w+)\}/g, ...)`: `\w` is ASCII-only in JS without the `u` flag, and a
/// placeholder whose name is not a string or number in `params` is left as written.
fn substitute(template: &str, params: Option<&Value>) -> String {
    let bytes = template.as_bytes();
    let mut out = String::with_capacity(template.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'{' {
            let mut end = index + 1;
            while end < bytes.len() && is_word(bytes[end]) {
                end += 1;
            }
            if end > index + 1 && end < bytes.len() && bytes[end] == b'}' {
                let name = &template[index + 1..end];
                match params.and_then(|value| param_text(value, name)) {
                    Some(text) => out.push_str(&text),
                    None => out.push_str(&template[index..=end]),
                }
                index = end + 1;
                continue;
            }
        }
        let width = utf8_width(bytes[index]);
        out.push_str(&template[index..index + width]);
        index += width;
    }
    out
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn utf8_width(byte: u8) -> usize {
    match byte {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

fn param_text(params: &Value, name: &str) -> Option<String> {
    let object = params.as_object()?;
    match object.get(name) {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => Some(js_number(number)),
        _ => None,
    }
}

/// `String(value)` for a JS number: integers print plainly, and an integral float prints as one.
fn js_number(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    let value = number.as_f64().unwrap_or(f64::NAN);
    if value.fract() == 0.0 && value.abs() < 1e21 {
        return format!("{value:.0}");
    }
    format!("{value}")
}

#[cfg(test)]
mod tests {
    use super::{is_translation_key, translate_for};
    use serde_json::json;

    fn at(locale: &str, key: &str, params: serde_json::Value) -> String {
        translate_for(locale.to_string(), json!(key), Some(params)).unwrap()
    }

    #[test]
    fn translates_both_locales() {
        assert_eq!(
            at("zh-CN", "welcomeMessageChat250808", json!({})),
            "今天有什么可以帮到你？"
        );
        assert_eq!(
            at("en-US", "welcomeMessageChat250808", json!({})),
            "How can I help you?"
        );
    }

    #[test]
    fn substitutes_a_number_and_a_string() {
        assert_eq!(
            at("zh-CN", "androidSelectedChats", json!({ "count": 3 })),
            "已选择 3 个对话"
        );
        assert_eq!(
            at("en-US", "androidSelectedChats", json!({ "count": "7" })),
            "Selected conversations (7)"
        );
    }

    #[test]
    fn leaves_unknown_placeholders_alone() {
        assert_eq!(
            at("zh-CN", "androidSelectedChats", json!({ "other": 1 })),
            "已选择 {count} 个对话",
        );
    }

    #[test]
    fn own_keys_only() {
        assert!(is_translation_key(json!("androidWelcome")).unwrap());
        assert!(!is_translation_key(json!("toString")).unwrap());
        assert!(!is_translation_key(json!(5)).unwrap());
    }

    #[test]
    fn reports_the_same_errors_as_the_original() {
        assert_eq!(
            translate_for("zh-CN".into(), json!("nope"), None).unwrap_err(),
            "Cannot read properties of undefined (reading 'replace')",
        );
        assert_eq!(
            translate_for("xx-YY".into(), json!("androidWelcome"), None).unwrap_err(),
            "translators[locale] is not a function",
        );
    }
}
