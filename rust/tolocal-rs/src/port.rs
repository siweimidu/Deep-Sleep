//! The Rust port of `src/services/chat/history/toLocal.ts`.
//!
//! Turns one `chat_sessions/{id}.json` archive session into the in-memory `Session` plus the
//! image entries the caller must load from the ZIP.
//!
//! Two host facilities the source leans on are not available to a wasm build:
//! - `Date.parse`: reimplemented below for the ES-spec Date Time String Format, which is what the
//!   archive format promises (`format.ts`: "时间均为 UTC RFC 3339、Z 结尾"). V8 falls back to a
//!   legacy parser for other strings, which reads the *host time zone*; a wasm build has none, so
//!   those strings give `NaN` here.
//! - `new URL(v).protocol`: only `http:`/`https:` matter, so the scheme, the C0/tab/newline
//!   clean-up and the "special scheme needs a host" rule are reimplemented below.

#![forbid(unsafe_code)]

use crate::js;
use serde_json::{Map, Value, json};
use unicode_normalization::UnicodeNormalization;

/// `fail('backupInvalidBranches')`: `BackupError` carries `translate(key)` for the app's locale.
const INVALID_BRANCHES: &str = "文件中的消息分支已损坏，无法导入";
/// `fail('backupInvalidFiles')`.
const INVALID_FILES: &str = "文件中的附件数据已损坏，无法导入";

/// Port of `toLocalSession` (`src/services/chat/history/toLocal.ts:282`).
pub fn to_local_session(file: Value) -> Result<Value, String> {
    let mut session = Map::new();
    session.insert("id".into(), or_undefined(prop(&file, "id")?));
    session.insert(
        "title".into(),
        match prop(&file, "title")? {
            // `file.title ?? ''`: a missing, null or undefined title reads as an empty one.
            None | Some(Value::Null) => Value::String(String::new()),
            Some(title) if js::is_undefined(title) => Value::String(String::new()),
            Some(title) => title.clone(),
        },
    );
    session.insert(
        "createdAt".into(),
        js::number(time(prop(&file, "inserted_at")?)),
    );
    session.insert(
        "updatedAt".into(),
        js::number(time(prop(&file, "updated_at")?)),
    );
    let (messages, root) = build_tree(&file)?;
    session.insert("messages".into(), Value::Array(messages));
    session.insert("rootMessageId".into(), root);

    let mut out = Map::new();
    out.insert("session".into(), Value::Object(session));
    // `Map<string, string>`: the port returns the wire's `$map` marker, `[[key, value], ...]`.
    out.insert("images".into(), json!({ "$map": collect_images(&file)? }));
    Ok(Value::Object(out))
}

// ---------------------------------------------------------------- JS property access

/// `v[key]`, with the `TypeError` a `null`/`undefined` receiver raises. A receiver that is neither
/// an object nor nullish reads `undefined`, as JS does for primitives.
fn prop<'a>(value: &'a Value, key: &str) -> Result<Option<&'a Value>, String> {
    if value.is_null() {
        return Err(not_readable("null", key));
    }
    if js::is_undefined(value) {
        return Err(not_readable("undefined", key));
    }
    match value {
        Value::Object(object) => Ok(object.get(key)),
        _ => Ok(None),
    }
}

fn not_readable(receiver: &str, key: &str) -> String {
    format!("Cannot read properties of {receiver} (reading '{key}')")
}

fn or_undefined(value: Option<&Value>) -> Value {
    value.cloned().unwrap_or_else(js::undefined)
}

/// `v ?? null`.
fn or_null(value: Option<&Value>) -> Value {
    match value {
        None => Value::Null,
        Some(value) if js::is_undefined(value) => Value::Null,
        Some(value) => value.clone(),
    }
}

/// JS truthiness.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None => false,
        Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Number(number)) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(value) if js::is_undefined(value) => false,
        Some(_) => true,
    }
}

/// JS `String(v)`: what a template literal or `String()` produces.
fn to_js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Bool(flag)) => flag.to_string(),
        Some(value) => match js::as_number(value) {
            Some(number) => js::number_to_string(number),
            None if js::is_undefined(value) => "undefined".into(),
            None => match value {
                Value::Array(items) => items
                    .iter()
                    .map(|item| match item {
                        Value::Null => String::new(),
                        other => to_js_string(Some(other)),
                    })
                    .collect::<Vec<_>>()
                    .join(","),
                _ => "[object Object]".into(),
            },
        },
    }
}

/// The identity a JS `Map` uses: strings by value, numbers by `SameValueZero` (`NaN` equals
/// `NaN`, `-0` equals `0`), and any other object by reference.
#[derive(Clone, PartialEq)]
enum Key {
    Undefined,
    Null,
    Bool(bool),
    Number(u64),
    Text(String),
    Object(String),
}

fn key_of(value: Option<&Value>) -> Key {
    match value {
        None => Key::Undefined,
        Some(Value::Null) => Key::Null,
        Some(Value::Bool(flag)) => Key::Bool(*flag),
        Some(Value::String(text)) => Key::Text(text.clone()),
        Some(value) if js::is_undefined(value) => Key::Undefined,
        Some(value) => match js::as_number(value) {
            Some(number) => Key::Number(same_value_zero_bits(number)),
            None => Key::Object(value.to_string()),
        },
    }
}

fn same_value_zero_bits(number: f64) -> u64 {
    let number = if number == 0.0 { 0.0 } else { number };
    if number.is_nan() {
        f64::NAN.to_bits()
    } else {
        number.to_bits()
    }
}

/// JS `a === b`. Primitives compare by value (`NaN` is never equal, `-0` equals `0`); two objects
/// are the same only by reference, which a JSON value cannot carry.
fn strict_equals(left: Option<&Value>, right: Option<&Value>) -> bool {
    if absent(left) && absent(right) {
        return true;
    }
    match (left, right) {
        (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(a)), Some(Value::Bool(b))) => a == b,
        (Some(Value::String(a)), Some(Value::String(b))) => a == b,
        (Some(a), Some(b)) => match (js::as_number(a), js::as_number(b)) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        },
        _ => false,
    }
}

/// `undefined`: the key is missing or carries the marker.
fn absent(value: Option<&Value>) -> bool {
    value.is_none_or(js::is_undefined)
}

// ---------------------------------------------------------------- dates

/// `Date.parse(value)`: milliseconds since the epoch, `NaN` when the string is not a valid Date
/// Time String Format. Non-strings reach `Date.parse` through `ToString` in JS and would only be
/// accepted by V8's legacy parser, which the port does not have.
fn time(value: Option<&Value>) -> f64 {
    match value.and_then(Value::as_str) {
        Some(text) => parse_date(text),
        None => f64::NAN,
    }
}

/// `YYYY[-MM[-DD]][THH:mm[:ss[.sss]][Z|±HH:mm]]`, the format the ES spec defines and the one the
/// archive writes. Date-only forms are UTC; a date-time without an offset is *local* in JS, which
/// the port cannot resolve, so it is rejected rather than guessed.
fn parse_date(text: &str) -> f64 {
    let bytes = text.as_bytes();
    let mut at = 0;
    let year = match digits(bytes, &mut at, 4) {
        Some(year) => year,
        None => return f64::NAN,
    };
    let mut month = 1;
    let mut day = 1;
    if bytes.get(at) == Some(&b'-') {
        at += 1;
        month = match digits(bytes, &mut at, 2) {
            Some(month) => month,
            None => return f64::NAN,
        };
        if bytes.get(at) == Some(&b'-') {
            at += 1;
            day = match digits(bytes, &mut at, 2) {
                Some(day) => day,
                None => return f64::NAN,
            };
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return f64::NAN;
    }
    let mut hour = 0;
    let mut minute = 0;
    let mut second = 0;
    let mut milli = 0;
    let has_time = matches!(bytes.get(at), Some(b'T' | b't'));
    if has_time {
        at += 1;
        hour = match digits(bytes, &mut at, 2) {
            Some(hour) => hour,
            None => return f64::NAN,
        };
        if bytes.get(at) != Some(&b':') {
            return f64::NAN;
        }
        at += 1;
        minute = match digits(bytes, &mut at, 2) {
            Some(minute) => minute,
            None => return f64::NAN,
        };
        if bytes.get(at) == Some(&b':') {
            at += 1;
            second = match digits(bytes, &mut at, 2) {
                Some(second) => second,
                None => return f64::NAN,
            };
            if bytes.get(at) == Some(&b'.') {
                at += 1;
                let start = at;
                let mut scale = 100;
                while bytes.get(at).is_some_and(u8::is_ascii_digit) {
                    if scale > 0 {
                        milli += i64::from(bytes[at] - b'0') * scale;
                        scale /= 10;
                    }
                    at += 1;
                }
                if at == start {
                    return f64::NAN;
                }
            }
        }
        if minute > 59 || second > 59 {
            return f64::NAN;
        }
        if hour == 24 {
            if minute != 0 || second != 0 || milli != 0 {
                return f64::NAN;
            }
        } else if hour > 23 {
            return f64::NAN;
        }
    }
    let mut offset = 0;
    match bytes.get(at) {
        None => {
            // A date-time without `Z` or an offset is local time in JS, and a wasm build has no
            // time zone: refuse it rather than guess.
            if has_time {
                return f64::NAN;
            }
            return clip(day_start(year, month, day));
        }
        Some(b'Z' | b'z') => at += 1,
        Some(b'+' | b'-') => {
            let negative = bytes[at] == b'-';
            at += 1;
            let offset_hour = match digits(bytes, &mut at, 2) {
                Some(hour) => hour,
                None => return f64::NAN,
            };
            if bytes.get(at) != Some(&b':') {
                return f64::NAN;
            }
            at += 1;
            let offset_minute = match digits(bytes, &mut at, 2) {
                Some(minute) => minute,
                None => return f64::NAN,
            };
            if offset_hour > 23 || offset_minute > 59 {
                return f64::NAN;
            }
            let magnitude = offset_hour * 3_600_000 + offset_minute * 60_000;
            offset = if negative { -magnitude } else { magnitude };
        }
        Some(_) => return f64::NAN,
    }
    if at != bytes.len() {
        return f64::NAN;
    }
    clip(
        day_start(year, month, day) + hour * 3_600_000 + minute * 60_000 + second * 1_000 + milli
            - offset,
    )
}

fn digits(bytes: &[u8], at: &mut usize, count: usize) -> Option<i64> {
    let mut value = 0;
    for _ in 0..count {
        let byte = *bytes.get(*at)?;
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(byte - b'0');
        *at += 1;
    }
    Some(value)
}

/// Midnight UTC of a civil date; a day past the end of the month rolls into the next one, which is
/// what `MakeDay` does (`2026-02-30` is 2026-03-02).
fn day_start(year: i64, month: i64, day: i64) -> i64 {
    let (year, month) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    (era * 146_097 + day_of_era - 719_468) * 86_400_000
}

/// `TimeClip`: the spec's 8.64e15 ms bound.
fn clip(milliseconds: i64) -> f64 {
    let milliseconds = milliseconds as f64;
    if milliseconds.abs() > 8.64e15 {
        f64::NAN
    } else {
        milliseconds
    }
}

// ---------------------------------------------------------------- URLs

/// `['http:', 'https:'].includes(new URL(value).protocol)`: true only for a URL that parses and is
/// HTTP(S).
fn is_web_url(value: Option<&Value>) -> bool {
    let Some(text) = value.and_then(Value::as_str) else {
        // `new URL(v)` stringifies; anything but a string would only parse if that text happened
        // to be a URL, which no archive field is.
        return false;
    };
    let cleaned = strip_url_controls(text);
    let bytes = cleaned.as_bytes();
    let mut at = 0;
    if !bytes.first().is_some_and(u8::is_ascii_alphabetic) {
        return false;
    }
    at += 1;
    while bytes
        .get(at)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
    {
        at += 1;
    }
    if bytes.get(at) != Some(&b':') {
        return false;
    }
    let scheme = cleaned[..at].to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    special_url_has_host(&cleaned[at + 1..])
}

/// The URL parser's clean-up: leading/trailing C0 controls and space off, then every tab and
/// newline out.
fn strip_url_controls(text: &str) -> String {
    let bytes: Vec<u8> = text.bytes().collect();
    let is_c0 = |byte: &u8| *byte <= 0x20;
    let start = bytes
        .iter()
        .position(|byte| !is_c0(byte))
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|byte| !is_c0(byte))
        .map_or(start, |at| at + 1);
    String::from_utf8_lossy(&bytes[start..end])
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect()
}

/// Whatever follows `http:` in the special-scheme parser: any number of slashes are swallowed, the
/// authority ends at the first `/`, `\`, `?` or `#`, and a host is mandatory — an empty one is the
/// parse failure that makes `new URL` throw.
fn special_url_has_host(rest: &str) -> bool {
    let rest = rest.trim_start_matches(['/', '\\']);
    let authority = rest.split(['/', '\\', '?', '#']).next().unwrap_or("");
    let host_port = match authority.rfind('@') {
        Some(at) => &authority[at + 1..],
        None => authority,
    };
    let (host, port) = if let Some(stripped) = host_port.strip_prefix('[') {
        match stripped.split_once(']') {
            Some((inside, after)) => (inside, after.strip_prefix(':').unwrap_or("").to_string()),
            None => return false,
        }
    } else {
        match host_port.rfind(':') {
            Some(at) => (&host_port[..at], host_port[at + 1..].to_string()),
            None => (host_port, String::new()),
        }
    };
    if host.is_empty() || host.chars().any(forbidden_host_char) {
        return false;
    }
    if port.is_empty() {
        return true;
    }
    if !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    port.parse::<u32>().is_ok_and(|port| port <= 65_535)
}

fn forbidden_host_char(c: char) -> bool {
    c <= '\u{20}'
        || c == '\u{7f}'
        || matches!(
            c,
            '"' | '#' | '/' | ':' | '<' | '>' | '?' | '@' | '\\' | '^' | '`' | '{' | '|' | '}'
        )
}

// ---------------------------------------------------------------- the message tree

/// Port of `buildTree` (`toLocal.ts:246`): sort by id, then thread `parent_id` through, refusing a
/// tree that breaks the "parent has the smaller id, roles alternate, the root is a question"
/// contract.
fn build_tree(file: &Value) -> Result<(Vec<Value>, Value), String> {
    let raw = match prop(file, "messages")? {
        None => return Err(not_readable("undefined", "toSorted")),
        Some(Value::Null) => return Err(not_readable("null", "toSorted")),
        Some(Value::Array(items)) => items.clone(),
        Some(_) => return Err("file.messages.toSorted is not a function".into()),
    };
    let mut sorted = raw;
    if sorted.len() > 1 {
        // `a.id - b.id` reads `.id`, so a nullish element throws before any ordering happens.
        for item in &sorted {
            if item.is_null() {
                return Err(not_readable("null", "id"));
            }
            if js::is_undefined(item) {
                return Err(not_readable("undefined", "id"));
            }
        }
        js::sort(&mut sorted, |a, b| id_of(a) - id_of(b));
    }

    let mut messages: Vec<Value> = Vec::new();
    let mut by_id: Vec<(Key, usize)> = Vec::new();
    // `parentId` as written on each built message, for the walk down to the root.
    let mut parents: Vec<Option<Key>> = Vec::new();
    for message in &sorted {
        if message.is_null() || js::is_undefined(message) {
            let receiver = if message.is_null() {
                "null"
            } else {
                "undefined"
            };
            return Err(format!(
                "Cannot destructure property 'id' of 'message' as it is {receiver}."
            ));
        }
        let id = prop(message, "id")?;
        let parent_id = prop(message, "parent_id")?;
        let role = prop(message, "role")?;
        let is_user = role.and_then(Value::as_str) == Some("USER");
        let parent = match parent_id {
            Some(Value::Null) => None,
            _ => lookup(&by_id, &key_of(parent_id)),
        };
        let parent_mismatch = match (parent_id, parent) {
            (Some(Value::Null), _) => !is_user,
            (_, None) => true,
            (_, Some(index)) => {
                messages[index].get("role").and_then(Value::as_str)
                    == Some(if is_user { "user" } else { "assistant" })
            }
        };
        if lookup(&by_id, &key_of(id)).is_some() || parent_mismatch {
            return Err(INVALID_BRANCHES.into());
        }
        let mut local = if is_user {
            to_user(message)?
        } else {
            to_assistant(message)?
        };
        let local_id = local.get("id").cloned().unwrap_or_else(js::undefined);
        if let Some(local) = local.as_object_mut() {
            local.insert(
                "parentId".into(),
                parent.map_or(Value::Null, |index| {
                    messages[index].get("id").cloned().unwrap_or(Value::Null)
                }),
            );
        }
        if let Some(index) = parent {
            select_child(&mut messages[index], &local_id);
        }
        by_id.push((key_of(id), messages.len()));
        parents.push(match parent_id {
            Some(Value::Null) => None,
            _ => Some(key_of(parent_id)),
        });
        messages.push(local);
    }

    if messages.is_empty() {
        return Ok((messages, Value::Null));
    }
    let current = match lookup(&by_id, &key_of(prop(file, "current_message_id")?)) {
        Some(index) => index,
        None => return Err(INVALID_BRANCHES.into()),
    };
    select_child(&mut messages[current], &js::undefined());
    let mut current = current;
    while let Some(parent_key) = parents[current].clone() {
        let parent = match lookup(&by_id, &parent_key) {
            Some(index) => index,
            None => return Err(INVALID_BRANCHES.into()),
        };
        let id = messages[current].get("id").cloned().unwrap_or(Value::Null);
        select_child(&mut messages[parent], &id);
        current = parent;
    }
    let root = messages[current].get("id").cloned().unwrap_or(Value::Null);
    Ok((messages, root))
}

/// `a.id` as a number, `NaN` for anything else.
fn id_of(message: &Value) -> f64 {
    message
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(js::as_number)
        .unwrap_or(f64::NAN)
}

fn lookup(by_id: &[(Key, usize)], key: &Key) -> Option<usize> {
    by_id
        .iter()
        .find(|(known, _)| known == key)
        .map(|(_, index)| *index)
}

fn select_child(message: &mut Value, id: &Value) {
    if let Some(object) = message.as_object_mut() {
        object.insert("selectedChildId".into(), id.clone());
    }
}

// ---------------------------------------------------------------- messages

/// `toUser`: the question text, plus the metadata of any file the user attached.
fn to_user(message: &Value) -> Result<Value, String> {
    let fragments = fragments_of(message)?;
    let content = fragments
        .iter()
        .map(request_content)
        .collect::<Result<Vec<_>, String>>()?
        .concat();
    let mut files = Vec::new();
    for fragment in &fragments {
        if fragment_type(fragment)? == Some("FILE") {
            files.extend(to_files(fragment)?);
        }
    }
    let mut user = Map::new();
    user.insert("id".into(), Value::String(message_id_text(message)?));
    user.insert("role".into(), Value::String("user".into()));
    user.insert(
        "createdAt".into(),
        js::number(time(prop(message, "inserted_at")?)),
    );
    user.insert("content".into(), Value::String(content));
    user.insert("files".into(), Value::Array(files));
    Ok(Value::Object(user))
}

/// One `REQUEST` fragment's text; `join('')` renders the other types as nothing.
fn request_content(fragment: &Value) -> Result<String, String> {
    if fragment_type(fragment)? == Some("REQUEST") {
        Ok(join_text(prop(fragment, "content")?))
    } else {
        Ok(String::new())
    }
}

/// JS `Array.prototype.join('')` renders a nullish element as nothing.
fn join_text(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(value) if js::is_undefined(value) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(value) => to_js_string(Some(value)),
    }
}

/// `toAssistant`: status, flags and the content blocks the UI renders.
fn to_assistant(message: &Value) -> Result<Value, String> {
    let id = message_id_text(message)?;
    let blocks = to_blocks(&fragments_of(message)?, &id)?;
    // `replyStatus[message.status]`: a status outside the table reads `undefined`.
    let status = match prop(message, "status")?.and_then(Value::as_str) {
        Some("FINISHED" | "CONTENT_FILTER") => Value::String("done".into()),
        Some("FAILED" | "CONTEXT_LENGTH_EXCEEDED" | "TIMEOUT") => Value::String("error".into()),
        Some("INCOMPLETE" | "WIP") => Value::String("stopped".into()),
        _ => js::undefined(),
    };
    let refused = prop(message, "status")?.and_then(Value::as_str) == Some("CONTENT_FILTER");
    let mut assistant = Map::new();
    assistant.insert("id".into(), Value::String(id));
    assistant.insert("role".into(), Value::String("assistant".into()));
    assistant.insert(
        "createdAt".into(),
        js::number(time(prop(message, "inserted_at")?)),
    );
    assistant.insert("model".into(), Value::Null);
    assistant.insert(
        "thinking".into(),
        or_undefined(prop(message, "thinking_enabled")?),
    );
    assistant.insert(
        "search".into(),
        or_undefined(prop(message, "search_enabled")?),
    );
    assistant.insert("prefix".into(), Value::Bool(false));
    assistant.insert("status".into(), status);
    if refused {
        assistant.insert("stopReason".into(), Value::String("refusal".into()));
    }
    // A refusal drops the model text and its thinking, keeps the template and tool steps.
    let kept = if refused {
        blocks
            .into_iter()
            .filter(|block| {
                let kind = block.get("type").and_then(Value::as_str);
                kind != Some("thinking")
                    && (kind != Some("text") || truthy(block.get("isTemplate")))
            })
            .collect()
    } else {
        blocks
    };
    assistant.insert("blocks".into(), Value::Array(kept));
    Ok(Value::Object(assistant))
}

fn message_id_text(message: &Value) -> Result<String, String> {
    Ok(to_js_string(prop(message, "id")?))
}

fn fragments_of(message: &Value) -> Result<Vec<Value>, String> {
    match prop(message, "fragments")? {
        None => Err(not_readable("undefined", "map")),
        Some(Value::Null) => Err(not_readable("null", "map")),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(_) => Err("message.fragments.map is not a function".into()),
    }
}

fn fragment_type(fragment: &Value) -> Result<Option<&str>, String> {
    Ok(prop(fragment, "type")?.and_then(Value::as_str))
}

fn to_files(fragment: &Value) -> Result<Vec<Value>, String> {
    match prop(fragment, "files")? {
        Some(Value::Array(entries)) => entries.iter().map(to_file).collect(),
        Some(Value::Null) => Err(not_readable("null", "map")),
        Some(_) => Err("item.files.map is not a function".into()),
        None => Err(not_readable("undefined", "map")),
    }
}

/// `toFile`: the attachment metadata; the MIME type arrives later, with the bytes.
fn to_file(entry: &Value) -> Result<Value, String> {
    let mut file = Map::new();
    file.insert("id".into(), or_undefined(prop(entry, "id")?));
    file.insert("serverId".into(), Value::Null);
    file.insert("name".into(), or_undefined(prop(entry, "file_name")?));
    file.insert("size".into(), or_undefined(prop(entry, "file_size")?));
    file.insert("isImage".into(), or_undefined(prop(entry, "is_image")?));
    file.insert("mimeType".into(), Value::String(String::new()));
    Ok(Value::Object(file))
}

// ---------------------------------------------------------------- content blocks

/// `toBlocks`: fragments become content blocks once; the ones with nothing to show are dropped.
fn to_blocks(fragments: &[Value], message_id: &str) -> Result<Vec<Value>, String> {
    // `fragments.some(...)`: one open or find step makes the whole answer a deep search.
    let mut search_kind = "search";
    for fragment in fragments {
        if let Some("TOOL_OPEN" | "TOOL_FIND") = fragment_type(fragment)? {
            search_kind = "deep_search";
            break;
        }
    }
    let mut blocks = Vec::new();
    for (index, fragment) in fragments.iter().enumerate() {
        let id = format!("history-{message_id}-{index}");
        blocks.extend(one_block(fragment, &id, search_kind)?);
    }
    Ok(blocks)
}

fn one_block(fragment: &Value, id: &str, search_kind: &str) -> Result<Vec<Value>, String> {
    // `switch (item.type)` reads `.type` first, so that is the property a bad fragment trips on.
    let kind = fragment_type(fragment)?;
    let status = prop(fragment, "status")?.and_then(Value::as_str);
    match kind {
        Some("RESPONSE") => Ok(vec![text_block(fragment, false)?]),
        Some("TEMPLATE_RESPONSE") => Ok(vec![text_block(fragment, true)?]),
        Some("THINK") => Ok(vec![thinking_block(fragment)?]),
        Some("TOOL_SEARCH") => {
            let queries = match prop(fragment, "queries")? {
                None => return Err(not_readable("undefined", "0")),
                Some(Value::Null) => return Err(not_readable("null", "0")),
                Some(value) => value.clone(),
            };
            let first = match &queries {
                Value::Array(items) => items.first().cloned(),
                _ => None,
            };
            let input = json!({
                "action": "search",
                "query": match first {
                    Some(value) if !value.is_null() && !js::is_undefined(&value) => value,
                    _ => Value::String(String::new()),
                },
                "queries": queries,
            });
            let result = if status == Some("WIP") {
                None
            } else if status == Some("FAILED") {
                Some(web_search_result(
                    id,
                    search_kind,
                    vec![json!({
                        "type": "web_search_tool_result_error",
                        "error_code": "unavailable",
                    })],
                ))
            } else {
                Some(web_search_result(
                    id,
                    search_kind,
                    search_results(fragment)?,
                ))
            };
            Ok(tool_blocks(id, input, search_kind, result))
        }
        Some("TOOL_OPEN") => {
            let url = prop(fragment, "url")?;
            if !truthy(url) || !is_web_url(url) {
                return Ok(Vec::new());
            }
            let result = if status == Some("WIP") {
                None
            } else {
                Some(fetch_result(
                    id,
                    "deep_search",
                    if status == Some("FINISHED") {
                        fetched(
                            url,
                            prop(fragment, "title")?,
                            prop(fragment, "published_at")?,
                        )
                    } else {
                        unavailable()
                    },
                ))
            };
            let input =
                json!({ "action": "open_page", "url": url.cloned().unwrap_or(Value::Null) });
            Ok(tool_blocks(id, input, "deep_search", result))
        }
        Some("TOOL_FIND") => {
            // `item.pattern ?? ''`, and a page that was searched rather than read: `fetched('')`.
            let pattern = match prop(fragment, "pattern")? {
                None | Some(Value::Null) => Value::String(String::new()),
                Some(value) => value.clone(),
            };
            let empty = Value::String(String::new());
            let content = if status == Some("FINISHED") {
                fetched(Some(&empty), Some(&Value::Null), Some(&Value::Null))
            } else {
                unavailable()
            };
            let result = if status == Some("WIP") {
                None
            } else {
                Some(fetch_result(id, "deep_search", content))
            };
            let input = json!({ "action": "find_in_page", "url": "", "pattern": pattern });
            Ok(tool_blocks(id, input, "deep_search", result))
        }
        Some("READ_LINK") => read_link_blocks(fragment, id),
        _ => Ok(Vec::new()),
    }
}

fn text_block(fragment: &Value, is_template: bool) -> Result<Value, String> {
    let mut block = Map::new();
    block.insert("type".into(), Value::String("text".into()));
    block.insert("text".into(), or_undefined(prop(fragment, "content")?));
    if is_template {
        block.insert("isTemplate".into(), Value::Bool(true));
    }
    Ok(Value::Object(block))
}

fn thinking_block(fragment: &Value) -> Result<Value, String> {
    let mut block = Map::new();
    block.insert("type".into(), Value::String("thinking".into()));
    block.insert("thinking".into(), or_undefined(prop(fragment, "content")?));
    // `elapsed_secs === null` drops the key; an absent value is `undefined` and stays.
    match prop(fragment, "elapsed_secs")? {
        Some(Value::Null) => {}
        Some(seconds) => {
            block.insert("elapsedSeconds".into(), seconds.clone());
        }
        None => {
            block.insert("elapsedSeconds".into(), js::undefined());
        }
    }
    Ok(Value::Object(block))
}

/// `toolBlocks`: the call, and its result when there is one.
fn tool_blocks(id: &str, input: Value, kind: &str, result: Option<Value>) -> Vec<Value> {
    let name = if kind == "read_link" {
        "deepseek_read_url"
    } else {
        "deepseek_web_search"
    };
    let mut call = Map::new();
    call.insert("type".into(), Value::String("server_tool_use".into()));
    call.insert("id".into(), Value::String(id.to_string()));
    call.insert("name".into(), Value::String(name.into()));
    call.insert("input".into(), input);
    call.insert("kind".into(), Value::String(kind.to_string()));
    call.insert("caller".into(), json!({ "type": "direct" }));
    let mut blocks = vec![Value::Object(call)];
    blocks.extend(result);
    blocks
}

fn web_search_result(id: &str, kind: &str, content: Vec<Value>) -> Value {
    json!({
        "type": "web_search_tool_result",
        "tool_use_id": id,
        "kind": kind,
        "content": content,
    })
}

fn fetch_result(tool_use_id: &str, kind: &str, content: Value) -> Value {
    json!({
        "type": "web_fetch_tool_result",
        "tool_use_id": tool_use_id,
        "kind": kind,
        "content": content,
    })
}

/// `fetched`: a page that was read, with an empty body until the bytes are fetched.
fn fetched(url: Option<&Value>, title: Option<&Value>, published_at: Option<&Value>) -> Value {
    json!({
        "type": "web_fetch_result",
        "url": or_undefined(url),
        "content": {
            "type": "document",
            "source": { "type": "text", "media_type": "text/plain", "data": "" },
            "title": or_undefined(title),
        },
        "published_at": or_undefined(published_at),
    })
}

/// `unavailable`: a fixed error result.
fn unavailable() -> Value {
    json!({ "type": "web_fetch_tool_result_error", "error_code": "unavailable" })
}

/// The search hits that render: a non-HTTP(S) URL is dropped, as is a non-HTTP(S) site icon.
fn search_results(fragment: &Value) -> Result<Vec<Value>, String> {
    let results = match prop(fragment, "results")? {
        Some(Value::Array(results)) => results.clone(),
        Some(Value::Null) => return Err(not_readable("null", "filter")),
        Some(_) => return Err("item.results.filter is not a function".into()),
        None => return Err(not_readable("undefined", "filter")),
    };
    let mut kept = Vec::new();
    for result in &results {
        let url = prop(result, "url")?;
        if !is_web_url(url) {
            continue;
        }
        let site_icon = prop(result, "site_icon")?;
        kept.push(json!({
            "type": "web_search_result",
            "url": url.cloned().unwrap_or(Value::Null),
            "title": or_undefined(prop(result, "title")?),
            "snippet": or_undefined(prop(result, "snippet")?),
            "site_icon": if truthy(site_icon) && is_web_url(site_icon) {
                site_icon.cloned().unwrap_or(Value::Null)
            } else {
                Value::Null
            },
            "site_name": or_undefined(prop(result, "site_name")?),
            "page_age": or_undefined(prop(result, "published_at")?),
            "encrypted_content": "",
        }));
    }
    Ok(kept)
}

/// `READ_LINK`: one call/result pair per readable link; a result with neither a URL nor a signature
/// has nothing to show.
fn read_link_blocks(fragment: &Value, id: &str) -> Result<Vec<Value>, String> {
    let results = match prop(fragment, "results")? {
        Some(Value::Array(results)) => results.clone(),
        Some(Value::Null) => return Err(not_readable("null", "flatMap")),
        Some(_) => return Err("item.results.flatMap is not a function".into()),
        None => return Err(not_readable("undefined", "flatMap")),
    };
    let mut blocks = Vec::new();
    for (index, result) in results.iter().enumerate() {
        let raw_url = prop(result, "url")?;
        let url = if truthy(raw_url) && is_web_url(raw_url) {
            raw_url.cloned().unwrap_or(Value::Null)
        } else {
            Value::String(String::new())
        };
        let signature = prop(result, "signature")?;
        if !truthy(Some(&url)) && !truthy_signature(signature)? {
            continue;
        }
        let tool_id = format!("{id}-{index}");
        let mut block = Map::new();
        block.insert("type".into(), Value::String("web_fetch_tool_result".into()));
        block.insert("tool_use_id".into(), Value::String(tool_id.clone()));
        block.insert("kind".into(), Value::String("read_link".into()));
        block.insert(
            "content".into(),
            fetched(
                Some(&url),
                Some(&or_null(prop(result, "title")?)),
                Some(&Value::Null),
            ),
        );
        block.insert("signature".into(), or_undefined(signature));
        blocks.extend(tool_blocks(
            &tool_id,
            json!({ "action": "read_link", "url": url }),
            "read_link",
            Some(Value::Object(block)),
        ));
    }
    Ok(blocks)
}

/// `result.signature.trim()` is truthy: `.trim()` needs a string, exactly as in JS.
fn truthy_signature(signature: Option<&Value>) -> Result<bool, String> {
    match signature {
        None => Err(not_readable("undefined", "trim")),
        Some(Value::Null) => Err(not_readable("null", "trim")),
        Some(Value::String(text)) => Ok(!trim_js(text).is_empty()),
        Some(_) => Err("result.signature.trim is not a function".into()),
    }
}

/// JS `String.prototype.trim`: the whitespace and line-terminator set, `U+FEFF` included.
fn trim_js(text: &str) -> String {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .to_string()
}

// ---------------------------------------------------------------- images

/// The `FILE` fragments whose picture the caller must load, keyed by archive entry name. A picture
/// outside the session's own folder, or one entry claimed by two files, is a broken archive.
fn collect_images(file: &Value) -> Result<Vec<Value>, String> {
    let messages = match prop(file, "messages")? {
        Some(Value::Array(messages)) => messages.clone(),
        _ => return Ok(Vec::new()),
    };
    let folder = format!("chat_sessions/{}_files/", to_js_string(prop(file, "id")?));
    let mut images: Vec<(String, Value)> = Vec::new();
    for message in &messages {
        let fragments = match prop(message, "fragments")? {
            Some(Value::Array(fragments)) => fragments.clone(),
            _ => continue,
        };
        for fragment in &fragments {
            if fragment_type(fragment)? != Some("FILE") {
                continue;
            }
            let entries = match prop(fragment, "files")? {
                Some(Value::Array(entries)) => entries.clone(),
                _ => continue,
            };
            for entry in &entries {
                if !truthy(prop(entry, "is_image")?) {
                    continue;
                }
                let path = match prop(entry, "export_path")? {
                    None | Some(Value::Null) => continue,
                    Some(Value::String(path)) => path.nfc().collect::<String>(),
                    Some(_) => return Err("entry.export_path.normalize is not a function".into()),
                };
                let id = prop(entry, "id")?;
                // `(images.get(path) ?? entry.id) !== entry.id`: a repeated entry must name the
                // same file.
                let known = images
                    .iter()
                    .find(|(entry, _)| *entry == path)
                    .map(|(_, id)| id);
                if !path.starts_with(&folder) || !strict_equals(known.or(id), id) {
                    return Err(INVALID_FILES.into());
                }
                if known.is_none() {
                    images.push((path, or_undefined(id)));
                }
            }
        }
    }
    Ok(images
        .into_iter()
        .map(|(path, id)| json!([path, id]))
        .collect())
}
