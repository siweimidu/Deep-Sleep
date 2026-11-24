//! The Rust port of `src/services/chat/reply.ts`.
//!
//! Streaming merge (`applyEvent`), reply settling, continue-ability, and the history → request
//! `messages` conversion used by the context budget. `reply.ts` imports types only, so this crate
//! stands alone; nothing here reaches into `view.ts`.
//!
//! Structured values stay `serde_json::Value` because the JS side distinguishes `undefined` from
//! `null`: an absent field is the `{"$undefined":true}` marker, `null` is `null`, and both are
//! observable in the returned objects.

#![forbid(unsafe_code)]

use serde_json::{Map, Value, json};

use crate::js;

// ---------------------------------------------------------------------------------------------
// JS value helpers
// ---------------------------------------------------------------------------------------------

fn undefined() -> Value {
    js::undefined()
}

fn reading_error(base: &str, name: &str) -> String {
    format!("Cannot read properties of {base} (reading '{name}')")
}

fn destructure_error(field: &str, base: &str) -> String {
    format!("Cannot destructure property '{field}' of '{base}' as it is {base}.")
}

fn is_undefined(value: &Value) -> bool {
    js::is_undefined(value)
}

/// `value === null || value === undefined`, i.e. what `??` reacts to.
fn is_nullish(value: &Value) -> bool {
    value.is_null() || is_undefined(value)
}

/// The marker objects that stand for JS values JSON cannot express.
fn is_marker(value: &Value) -> bool {
    let Value::Object(map) = value else {
        return false;
    };
    map.len() == 1
        && map.keys().any(|key| {
            matches!(
                key.as_str(),
                "$undefined" | "$map" | "$set" | "$num" | "$utf16" | "$bigint" | "$date"
            )
        })
}

/// `value[name]`, with V8's TypeError for a null/undefined base.
fn member(value: &Value, name: &str) -> Result<Value, String> {
    if value.is_null() {
        return Err(reading_error("null", name));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", name));
    }
    Ok(match value {
        Value::Object(map) => map.get(name).cloned().unwrap_or_else(undefined),
        Value::Array(items) => match name {
            "length" => json!(items.len()),
            _ => match name.parse::<usize>() {
                Ok(index) => items.get(index).cloned().unwrap_or_else(undefined),
                Err(_) => undefined(),
            },
        },
        Value::String(text) => match name {
            "length" => json!(crate::utf16::units(text).len()),
            _ => match name.parse::<usize>() {
                Ok(index) => crate::utf16::units(text)
                    .get(index)
                    .map(|unit| js::utf16_string(&[*unit]))
                    .unwrap_or_else(undefined),
                Err(_) => undefined(),
            },
        },
        _ => undefined(),
    })
}

/// `{ field } = value` on a function parameter: destructuring throws for null/undefined.
fn destructure(value: &Value, field: &str) -> Result<Value, String> {
    if value.is_null() {
        return Err(destructure_error(field, "null"));
    }
    if is_undefined(value) {
        return Err(destructure_error(field, "undefined"));
    }
    member(value, field)
}

/// `value[key]` where `key` is a runtime value (array index or object key).
fn index_get(value: &Value, key: &Value) -> Result<Value, String> {
    match key {
        Value::String(text) => member(value, text),
        _ => {
            let name = js_string(key);
            member(value, &name)
        }
    }
}

fn as_text(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) => Some(text),
        _ => None,
    }
}

/// JS `===` against a string literal.
fn is_text(value: &Value, expected: &str) -> bool {
    as_text(value) == Some(expected)
}

/// JS truthiness, including the wire markers for `undefined` and `NaN`.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) => true,
        value => match js::as_number(value) {
            Some(number) => number != 0.0 && !number.is_nan(),
            None => !is_undefined(value),
        },
    }
}

/// `String(value)`.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(flag) => flag.to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => js::number_to_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if is_nullish(item) {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(map) => {
            if map.contains_key("$undefined") {
                "undefined".into()
            } else if map.contains_key("$num") {
                js::number_to_string(js::as_number(value).unwrap_or(f64::NAN))
            } else if let Some(text) = map.get("$bigint").and_then(Value::as_str) {
                text.to_string()
            } else if map.contains_key("$map") {
                "[object Map]".into()
            } else if map.contains_key("$set") {
                "[object Set]".into()
            } else {
                "[object Object]".into()
            }
        }
    }
}

fn is_js_space(c: char) -> bool {
    matches!(c,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}')
}

/// `value.trim()`.
fn trim(value: &Value) -> Result<String, String> {
    if value.is_null() {
        return Err(reading_error("null", "trim"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "trim"));
    }
    Ok(match as_text(value) {
        Some(text) => text.trim_matches(is_js_space).to_string(),
        None => js_string(value),
    })
}

/// JS `+`: numeric addition for two numbers, string concatenation otherwise.
fn js_add(left: &Value, right: &Value) -> Value {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => {
            json!(a.as_f64().unwrap_or(f64::NAN) + b.as_f64().unwrap_or(f64::NAN))
        }
        _ => Value::String(format!("{}{}", js_string(left), js_string(right))),
    }
}

/// Own enumerable properties, in insertion order: what `{...value}` copies.
fn spread(value: &Value) -> Map<String, Value> {
    match value {
        Value::Object(map) if !is_marker(value) => map.clone(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| (index.to_string(), item.clone()))
            .collect(),
        Value::String(text) => crate::utf16::units(text)
            .into_iter()
            .enumerate()
            .map(|(index, unit)| (index.to_string(), js::utf16_string(&[unit])))
            .collect(),
        _ => Map::new(),
    }
}

/// `{...base, name: value, …}`: spread first, then the listed fields (an existing key keeps its
/// position, a new one is appended — the order the JS object literal produces).
fn with_fields(base: &Value, fields: Vec<(&str, Value)>) -> Value {
    let mut map = spread(base);
    for (name, value) in fields {
        map.insert(name.to_string(), value);
    }
    Value::Object(map)
}

/// `for (const item of value)`, or `[...value]`.
fn iterate(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    match value {
        Value::Array(items) => Ok(items.clone()),
        Value::String(text) => Ok(text.chars().map(|c| Value::String(c.to_string())).collect()),
        Value::Object(map) if map.contains_key("$set") => Ok(map
            .get("$set")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()),
        _ => Err(format!("{expression} is not iterable")),
    }
}

/// `value.flatMap(…)`: the receiver must be an array, otherwise V8 fails on the call itself.
fn flat_map_source(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    if value.is_null() {
        return Err(reading_error("null", "flatMap"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "flatMap"));
    }
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("{expression}.flatMap is not a function")),
    }
}

/// `value.map(…)`: same receiver rule as `flatMap`.
fn map_source(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    if value.is_null() {
        return Err(reading_error("null", "map"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "map"));
    }
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("{expression}.map is not a function")),
    }
}

/// `value.some(…)`: same receiver rule as `map`.
fn some_source(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    if value.is_null() {
        return Err(reading_error("null", "some"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "some"));
    }
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("{expression}.some is not a function")),
    }
}

/// The `blockIndexes` map argument: a real JS `Map`, which crosses as `{"$map":[[k,v],…]}`.
struct BlockIndexes {
    entries: Vec<(Value, Value)>,
}

fn same_key(left: &Value, right: &Value) -> bool {
    match (js::as_number(left), js::as_number(right)) {
        (Some(a), Some(b)) => a == b || (a.is_nan() && b.is_nan()),
        _ => left == right,
    }
}

impl BlockIndexes {
    fn open(value: &Value, method: &str) -> Result<Self, String> {
        if value.is_null() {
            return Err(reading_error("null", method));
        }
        if is_undefined(value) {
            return Err(reading_error("undefined", method));
        }
        let Value::Object(map) = value else {
            return Err(format!("blockIndexes.{method} is not a function"));
        };
        let Some(Value::Array(entries)) = map.get("$map") else {
            return Err(format!("blockIndexes.{method} is not a function"));
        };
        let mut out = Vec::with_capacity(entries.len());
        for entry in entries {
            let Value::Array(pair) = entry else { continue };
            if pair.len() < 2 {
                continue;
            }
            out.push((pair[0].clone(), pair[1].clone()));
        }
        Ok(Self { entries: out })
    }

    fn get(&self, key: &Value) -> Option<Value> {
        self.entries
            .iter()
            .find(|(existing, _)| same_key(existing, key))
            .map(|(_, value)| value.clone())
    }

    fn set(&mut self, key: &Value, value: Value) {
        match self
            .entries
            .iter_mut()
            .find(|(existing, _)| same_key(existing, key))
        {
            Some((_, slot)) => *slot = value,
            None => self.entries.push((key.clone(), value)),
        }
    }

    fn delete(&mut self, key: &Value) {
        self.entries
            .retain(|(existing, _)| !same_key(existing, key));
    }
}

// ---------------------------------------------------------------------------------------------
// applyEvent
// ---------------------------------------------------------------------------------------------

/// `toReplyBlock`: only the block kinds the reply model keeps.
fn to_reply_block(block: &Value, now: f64) -> Result<Option<Value>, String> {
    let kind = member(block, "type")?;
    if is_text(&kind, "text") {
        let citations = member(block, "citations")?;
        let citations = if is_nullish(&citations) {
            json!([])
        } else {
            citations
        };
        return Ok(Some(json!({
            "type": "text",
            "text": member(block, "text")?,
            "citations": citations,
        })));
    }
    if is_text(&kind, "thinking") {
        return Ok(Some(json!({
            "type": "thinking",
            "thinking": member(block, "thinking")?,
            "signature": member(block, "signature")?,
            "startedAt": js::number(now),
        })));
    }
    if is_text(&kind, "server_tool_use")
        || is_text(&kind, "web_search_tool_result")
        || is_text(&kind, "web_fetch_tool_result")
    {
        // Passed through by reference in the source; a copy is indistinguishable after JSON.
        return Ok(Some(block.clone()));
    }
    Ok(None)
}

/// `updateBlock`: replace one block through `update`, keeping everything else in place.
fn update_block(
    reply: &Value,
    index: &Value,
    update: impl Fn(&Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let blocks = member(reply, "blocks")?;
    let block = index_get(&blocks, index)?;
    if !truthy(&block) {
        return Ok(reply.clone());
    }
    let mut list = iterate(&blocks, "reply.blocks")?;
    let updated = update(&block)?;
    let position = match index {
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    if position.is_nan() || position < 0.0 || position.fract() != 0.0 {
        // A non-index key never reads back a block, so this branch is unreachable in practice.
        return Ok(with_fields(reply, vec![("blocks", Value::Array(list))]));
    }
    let position = position as usize;
    while list.len() <= position {
        list.push(Value::Null);
    }
    list[position] = updated;
    Ok(with_fields(reply, vec![("blocks", Value::Array(list))]))
}

/// Port of `applyEvent` (`src/services/chat/reply.ts:72`).
pub fn apply_event(
    reply: Value,
    event: Value,
    now: f64,
    block_indexes: Value,
) -> Result<Value, String> {
    let status = member(&reply, "status")?;
    let next = if is_text(&status, "streaming") {
        reply
    } else {
        with_fields(&reply, vec![("status", json!("streaming"))])
    };

    let kind = member(&event, "type")?;

    if is_text(&kind, "message_start") {
        let message = member(&event, "message")?;
        let usage = member(&message, "usage")?;
        let usage = if is_nullish(&usage) {
            member(&next, "usage")?
        } else {
            usage
        };
        return Ok(with_fields(&next, vec![("usage", usage)]));
    }

    if is_text(&kind, "content_block_start") {
        let mut indexes = BlockIndexes::open(&block_indexes, "delete")?;
        let index = member(&event, "index")?;
        indexes.delete(&index);
        let content_block = member(&event, "content_block")?;
        let Some(block) = to_reply_block(&content_block, now)? else {
            // Client-side tool content is not stored, and an unfinished tool round cannot serve
            // as a continuation prefix.
            return Ok(if is_text(&member(&content_block, "type")?, "tool_use") {
                with_fields(&next, vec![("prefix", json!(false))])
            } else {
                next
            });
        };
        let existing = member(&next, "blocks")?;
        let length = member(&existing, "length")?;
        indexes.set(&index, length);
        let mut list = iterate(&existing, "next.blocks")?;
        list.push(block);
        return Ok(with_fields(&next, vec![("blocks", Value::Array(list))]));
    }

    if is_text(&kind, "content_block_delta") {
        let indexes = BlockIndexes::open(&block_indexes, "get")?;
        let index = member(&event, "index")?;
        let Some(position) = indexes.get(&index) else {
            return Ok(next);
        };
        let delta = member(&event, "delta")?;
        let delta_type = member(&delta, "type")?;
        return update_block(&next, &position, |block| {
            let block_type = member(block, "type")?;
            if is_text(&block_type, "text") && is_text(&delta_type, "text_delta") {
                let text = js_add(&member(block, "text")?, &member(&delta, "text")?);
                return Ok(with_fields(block, vec![("text", text)]));
            }
            if is_text(&block_type, "thinking") && is_text(&delta_type, "thinking_delta") {
                let thinking = js_add(&member(block, "thinking")?, &member(&delta, "thinking")?);
                return Ok(with_fields(block, vec![("thinking", thinking)]));
            }
            if is_text(&block_type, "thinking") && is_text(&delta_type, "signature_delta") {
                let signature = member(block, "signature")?;
                let signature = if is_nullish(&signature) {
                    Value::String(String::new())
                } else {
                    signature
                };
                let signature = js_add(&signature, &member(&delta, "signature")?);
                return Ok(with_fields(block, vec![("signature", signature)]));
            }
            if is_text(&block_type, "text") && is_text(&delta_type, "citations_delta") {
                let citations = member(block, "citations")?;
                let mut list = if is_nullish(&citations) {
                    Vec::new()
                } else {
                    iterate(&citations, "block.citations")?
                };
                list.push(member(&delta, "citation")?);
                return Ok(with_fields(block, vec![("citations", Value::Array(list))]));
            }
            Ok(block.clone())
        });
    }

    if is_text(&kind, "content_block_stop") {
        let mut indexes = BlockIndexes::open(&block_indexes, "get")?;
        let index = member(&event, "index")?;
        let Some(position) = indexes.get(&index) else {
            return Ok(next);
        };
        indexes.delete(&index);
        return update_block(&next, &position, |block| {
            let block_type = member(block, "type")?;
            let started = member(block, "startedAt")?;
            let ended = member(block, "endedAt")?;
            if is_text(&block_type, "thinking") && !is_undefined(&started) && is_undefined(&ended) {
                return Ok(with_fields(block, vec![("endedAt", js::number(now))]));
            }
            Ok(block.clone())
        });
    }

    if is_text(&kind, "message_delta") {
        let delta = member(&event, "delta")?;
        let stop_reason = member(&delta, "stop_reason")?;
        let stop_details = member(&delta, "stop_details")?;
        let usage = member(&event, "usage")?;
        let usage = if is_nullish(&usage) {
            member(&next, "usage")?
        } else {
            usage
        };
        return Ok(with_fields(
            &next,
            vec![
                ("stopReason", stop_reason),
                ("stopDetails", stop_details),
                ("usage", usage),
            ],
        ));
    }

    Ok(next)
}

// ---------------------------------------------------------------------------------------------
// settleReply / getReplyText / canContinueReply
// ---------------------------------------------------------------------------------------------

/// Port of `settleReply` (`src/services/chat/reply.ts:143`).
///
/// On a safety refusal (`stop_reason: refusal`) the thinking and text blocks already sent cannot
/// be withdrawn, so the client drops them and keeps the tool blocks.
pub fn settle_reply(reply: Value, status: Value, now: f64, error: Value) -> Result<Value, String> {
    let blocks = member(&reply, "blocks")?;
    let blocks = flat_map_source(&blocks, "reply.blocks")?;
    let refusal = is_text(&member(&reply, "stopReason")?, "refusal");
    let mut out = Vec::with_capacity(blocks.len());
    for block in &blocks {
        let block_type = member(block, "type")?;
        if refusal && (is_text(&block_type, "thinking") || is_text(&block_type, "text")) {
            continue;
        }
        let started = member(block, "startedAt")?;
        let ended = member(block, "endedAt")?;
        if is_text(&block_type, "thinking") && !is_undefined(&started) && is_undefined(&ended) {
            out.push(with_fields(block, vec![("endedAt", js::number(now))]));
        } else {
            out.push(block.clone());
        }
    }
    Ok(with_fields(
        &reply,
        vec![
            ("status", status),
            ("error", error),
            ("blocks", Value::Array(out)),
        ],
    ))
}

/// Port of `getReplyText` (`src/services/chat/reply.ts:163`).
pub fn get_reply_text(reply: Value) -> Result<Value, String> {
    let blocks = member(&reply, "blocks")?;
    let blocks = map_source(&blocks, "reply.blocks")?;
    let mut text = String::new();
    for block in &blocks {
        if !is_text(&member(block, "type")?, "text") {
            continue;
        }
        let piece = member(block, "text")?;
        // `[…].join('')` renders a null/undefined element as nothing.
        if !is_nullish(&piece) {
            text.push_str(&js_string(&piece));
        }
    }
    Ok(Value::String(text))
}

fn blocks_some(
    blocks: &Value,
    test: impl Fn(&Value) -> Result<bool, String>,
) -> Result<bool, String> {
    for block in some_source(blocks, "reply.blocks")? {
        if test(&block)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Port of `canContinueReply` (`src/services/chat/reply.ts:172`).
pub fn can_continue_reply(reply: Value) -> Result<Value, String> {
    if !truthy(&member(&reply, "prefix")?) {
        return Ok(json!(false));
    }
    let stop_reason = member(&reply, "stopReason")?;
    if is_text(&stop_reason, "refusal") || is_text(&stop_reason, "tool_use") {
        return Ok(json!(false));
    }
    let blocks = member(&reply, "blocks")?;
    let blocked = blocks_some(&blocks, |block| {
        let kind = member(block, "type")?;
        Ok(is_text(&kind, "server_tool_use")
            || is_text(&kind, "web_search_tool_result")
            || is_text(&kind, "web_fetch_tool_result")
            || (is_text(&kind, "text") && truthy(&member(block, "isTemplate")?)))
    })?;
    if blocked {
        return Ok(json!(false));
    }
    let status = member(&reply, "status")?;
    Ok(json!(
        is_text(&status, "stopped")
            || (is_text(&status, "done") && is_text(&stop_reason, "max_tokens"))
    ))
}

// ---------------------------------------------------------------------------------------------
// history → request messages
// ---------------------------------------------------------------------------------------------

fn is_usable_reply(message: &Value) -> Result<bool, String> {
    if !is_text(&member(message, "role")?, "assistant") {
        return Ok(false);
    }
    let status = member(message, "status")?;
    if !is_text(&status, "done") && !is_text(&status, "stopped") {
        return Ok(false);
    }
    if is_text(&member(message, "stopReason")?, "refusal") {
        return Ok(false);
    }
    let blocks = member(message, "blocks")?;
    let template = blocks_some(&blocks, |block| {
        let kind = member(block, "type")?;
        Ok(is_text(&kind, "text") && truthy(&member(block, "isTemplate")?))
    })?;
    if template {
        return Ok(false);
    }
    Ok(!js_string(&get_reply_text(message.clone())?).is_empty())
}

/// `toFileBlocks`: files are referenced by their Files API `file_id`, and attachments without a
/// server id never reach the request.
fn to_file_blocks(files: &Value) -> Result<Vec<Value>, String> {
    let files = flat_map_source(files, "files")?;
    let mut out = Vec::new();
    for file in &files {
        let server_id = destructure(file, "serverId")?;
        if !truthy(&server_id) {
            continue;
        }
        let is_image = destructure(file, "isImage")?;
        out.push(json!({
            "type": if truthy(&is_image) { "image" } else { "document" },
            "source": { "type": "file", "file_id": server_id },
        }));
    }
    Ok(out)
}

/// `toUserParam`: with attachments the content becomes a block list, files first.
fn to_user_param(user: &Value) -> Result<Value, String> {
    let content = destructure(user, "content")?;
    let files = destructure(user, "files")?;
    let blocks = to_file_blocks(&files)?;
    if blocks.is_empty() {
        return Ok(json!({ "role": "user", "content": content }));
    }
    let mut list = blocks;
    if truthy(&content) {
        list.push(json!({ "type": "text", "text": content }));
    }
    Ok(json!({ "role": "user", "content": list }))
}

/// `toAssistantParam`: thinking and tool blocks survive only where the protocol allows them.
fn to_assistant_param(blocks: &Value, prefix: bool, thinking: &Value) -> Result<Value, String> {
    let list = iterate(blocks, "blocks")?;

    // A fetched page is restored from its signature, so without a usable signature neither the
    // call nor its result goes back.
    let mut unsigned: Vec<Value> = Vec::new();
    for block in &list {
        if !is_text(&member(block, "type")?, "web_fetch_tool_result") {
            continue;
        }
        if !is_text(&member(block, "kind")?, "read_link") {
            continue;
        }
        let content = member(block, "content")?;
        if !is_text(&member(&content, "type")?, "web_fetch_result") {
            continue;
        }
        let signature = member(block, "signature")?;
        let signed = !is_nullish(&signature) && !trim(&signature)?.is_empty();
        if !signed {
            unsigned.push(member(block, "tool_use_id")?);
        }
    }

    let mut content: Vec<Value> = Vec::new();
    // Text of the block currently being extended; any non-text block ends it.
    let mut open_text: Option<String> = None;
    for block in &list {
        let kind = member(block, "type")?;
        // A blank thinking block neither moves the continuation point nor separates two texts.
        if prefix && is_text(&kind, "thinking") && trim(&member(block, "thinking")?)?.is_empty() {
            continue;
        }
        if is_text(&kind, "text") {
            let piece = js_string(&member(block, "text")?);
            match &mut open_text {
                Some(text) => text.push_str(&piece),
                None => {
                    // A run that starts right after a text block is separated by a blank line;
                    // the blocks in between were left out of the request entirely.
                    let previous_is_text = content.last().is_some_and(|block| {
                        member(block, "type").is_ok_and(|kind| is_text(&kind, "text"))
                    });
                    open_text = Some(if previous_is_text {
                        format!("\n\n{piece}")
                    } else {
                        piece
                    });
                }
            }
            continue;
        }
        if let Some(text) = open_text.take() {
            content.push(json!({ "type": "text", "text": text }));
        }
        if prefix && truthy(thinking) && is_text(&kind, "thinking") {
            let signature = member(block, "signature")?;
            let signature = if is_nullish(&signature) {
                Value::String(String::new())
            } else {
                signature
            };
            content.push(json!({
                "type": kind,
                "thinking": member(block, "thinking")?,
                "signature": signature,
            }));
        } else if is_text(&kind, "server_tool_use")
            && is_text(&member(block, "kind")?, "read_link")
            && !unsigned.contains(&member(block, "id")?)
        {
            content.push(json!({
                "type": kind,
                "id": member(block, "id")?,
                "name": member(block, "name")?,
                "input": member(block, "input")?,
                "kind": member(block, "kind")?,
            }));
        } else if is_text(&kind, "web_fetch_tool_result")
            && is_text(&member(block, "kind")?, "read_link")
            && !unsigned.contains(&member(block, "tool_use_id")?)
        {
            content.push(block.clone());
        }
    }
    if let Some(text) = open_text {
        content.push(json!({ "type": "text", "text": text }));
    }

    let mut kept = Vec::with_capacity(content.len());
    for block in content {
        let kind = member(&block, "type")?;
        if is_text(&kind, "text") && is_text(&member(&block, "text")?, "") {
            continue;
        }
        kept.push(block);
    }
    Ok(json!({ "role": "assistant", "content": kept }))
}

/// Port of `getContextRounds` (`src/services/chat/reply.ts:287`).
pub fn get_context_rounds(history: Value) -> Result<Value, String> {
    let length = member(&history, "length")?;
    let length = js::as_number(&length).unwrap_or(0.0);
    let mut rounds: Vec<Value> = Vec::new();
    let mut index = 0.0_f64;
    while index + 1.0 < length {
        let user = index_get(&history, &js::number(index))?;
        let reply = index_get(&history, &js::number(index + 1.0))?;
        if is_text(&member(&user, "role")?, "user") && is_usable_reply(&reply)? {
            rounds.push(json!([user, reply]));
            index += 1.0;
        }
        index += 1.0;
    }
    Ok(Value::Array(rounds))
}

/// A reminder snapshot is inserted only when none was sent yet or the content changed.
fn append_reminder(
    messages: &mut Vec<Value>,
    reminder: &Value,
    previous: &mut Option<String>,
) -> Result<(), String> {
    if !truthy(reminder) {
        return Ok(());
    }
    let text = js_string(reminder);
    if previous.as_deref() != Some(text.as_str()) {
        messages.push(json!({ "role": "latest_reminder", "content": text }));
        *previous = Some(text);
    }
    Ok(())
}

/// Port of `toRequestMessages` (`src/services/chat/reply.ts:303`).
///
/// Only rounds where a question is followed by a usable answer enter the request; a continuation
/// round is appended when there is a prefix to continue.
pub fn to_request_messages(
    history: Value,
    question: Value,
    prefix: Option<Value>,
    thinking: Value,
    latest_reminder: Value,
) -> Result<Value, String> {
    let prefix = match prefix {
        Some(value) if !is_nullish(&value) => Some(value),
        _ => None,
    };
    // `thinking = prefix?.thinking ?? false`
    let thinking = if is_undefined(&thinking) {
        match &prefix {
            Some(value) => {
                let given = member(value, "thinking")?;
                if is_nullish(&given) {
                    json!(false)
                } else {
                    given
                }
            }
            None => json!(false),
        }
    } else {
        thinking
    };

    let rounds = get_context_rounds(history)?;
    let mut messages: Vec<Value> = Vec::new();
    let mut previous_reminder: Option<String> = None;
    for round in iterate(&rounds, "rounds")? {
        let Value::Array(pair) = round else { continue };
        if pair.len() < 2 {
            continue;
        }
        let (user, reply) = (pair[0].clone(), pair[1].clone());
        // A round with no question text and no attachment server id is dropped entirely.
        if !truthy(&member(&user, "content")?)
            && to_file_blocks(&member(&user, "files")?)?.is_empty()
        {
            continue;
        }
        append_reminder(
            &mut messages,
            &member(&reply, "latestReminder")?,
            &mut previous_reminder,
        )?;
        messages.push(to_user_param(&user)?);
        messages.push(to_assistant_param(
            &member(&reply, "blocks")?,
            false,
            &json!(false),
        )?);
    }
    append_reminder(&mut messages, &latest_reminder, &mut previous_reminder)?;
    messages.push(to_user_param(&question)?);
    if let Some(prefix) = &prefix
        && truthy(&member(prefix, "prefix")?)
    {
        let assistant = to_assistant_param(&member(prefix, "blocks")?, true, &thinking)?;
        // With no non-blank text and no usable thinking the plain question is resent, because the
        // server rejects an empty prefill.
        let mut usable = false;
        for block in iterate(&member(&assistant, "content")?, "assistant.content")? {
            let kind = member(&block, "type")?;
            if is_text(&kind, "text") && !trim(&member(&block, "text")?)?.is_empty() {
                usable = true;
                break;
            }
            if is_text(&kind, "thinking") && !trim(&member(&block, "thinking")?)?.is_empty() {
                usable = true;
                break;
            }
        }
        if usable {
            messages.push(assistant);
        }
    }
    Ok(Value::Array(messages))
}

/// Port of `getThinkingSeconds` (`src/services/chat/reply.ts:346`).
pub fn get_thinking_seconds(started_at: f64, ended_at: f64) -> Result<Value, String> {
    let elapsed = js::math_round((ended_at - started_at) / 1000.0);
    // `Math.max` propagates NaN, which Rust's `f64::max` would swallow.
    Ok(js::number(if elapsed.is_nan() {
        f64::NAN
    } else {
        elapsed.max(1.0)
    }))
}
