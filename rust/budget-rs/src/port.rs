//! The Rust port of `src/services/chat/context/budget.ts`.
//!
//! `planContext` imported two helpers that live in units ported elsewhere: `getContextRounds`
//! (`reply.ts`) and `buildReplyView` (`.answer.text`, `view.ts`). Depending on `reply-rs` /
//! `view-rs` is not possible here: all three crates are `cdylib`s that export the same
//! `rustAnythingWireMemory` name, and wasm-bindgen refuses to link two of them into one build
//! ("the name `rustAnythingWireMemory` is exported by multiple crates"). So the two slices that
//! `budget.ts` actually consumes are ported below, kept next to the place that uses them.

#![forbid(unsafe_code)]

use serde_json::{Value, json};

/// Tokens held back from every window for the reply (`OUTPUT_RESERVE`).
const OUTPUT_RESERVE: f64 = 8_000.0;
/// Trim once the estimate passes this share of the usable window (`TRIGGER_RATIO`).
const TRIGGER_RATIO: f64 = 0.75;
/// Trim down to this share, so the following rounds do not trim again (`TARGET_RATIO`).
const TARGET_RATIO: f64 = 0.36;
/// Flat cost of one attachment (`FILE_TOKENS`).
const FILE_TOKENS: f64 = 900.0;

/// Port of `estimateTokens` (`src/services/chat/context/budget.ts:35`).
///
/// `for…of` walks code points, so an astral character counts once rather than as two UTF-16 units.
pub fn estimate_tokens(text: String) -> Result<f64, String> {
    if text.is_empty() {
        return Ok(0.0);
    }
    // 与 budget.ts 的分档权重逐位对应：任一侧改动都必须同步，否则 gate 的 behavior 检查会失败
    fn weight_of(code: u32) -> f64 {
        if code >= 0x1f000 {
            return 2.0;
        }
        if code >= 0x10000 {
            return 1.2;
        }
        if code >= 0x2e80 {
            return 1.0;
        }
        if code <= 0x7f {
            let alnum = (0x30..=0x39).contains(&code)
                || (0x41..=0x5a).contains(&code)
                || (0x61..=0x7a).contains(&code);
            let blank = matches!(code, 0x20 | 0x09 | 0x0a | 0x0d);
            return if alnum || blank { 0.25 } else { 0.4 };
        }
        if code <= 0x3ff {
            return 0.5;
        }
        0.34
    }
    let mut total = 0.0_f64;
    for character in text.chars() {
        total += weight_of(character as u32);
    }
    Ok(total.ceil())
}

/// `MODEL_WINDOWS` (`budget.ts:15`) with the same `?? 128_000` fallback for an unknown model.
fn model_window(model: &str) -> f64 {
    match model {
        "deepseek-flash" => 1_000_000.0,
        _ => 128_000.0,
    }
}

/// JS truthiness of a property read that may be missing.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|value| value != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `value.type` as the block discriminator. Reading it off null throws, as it does in JS.
fn kind_of(value: &Value) -> Result<Option<&str>, String> {
    match value {
        Value::Null => Err("Cannot read properties of null (reading 'type')".to_owned()),
        other => Ok(other.get("type").and_then(Value::as_str)),
    }
}

/// `value.text`, which throws when read off null.
fn text_of(value: &Value) -> Result<Option<&Value>, String> {
    match value {
        Value::Null => Err("Cannot read properties of null (reading 'text')".to_owned()),
        other => Ok(other.get("text")),
    }
}

/// `value.blocks` as the block list; `.some` / `.map` on anything else throws.
fn blocks_of(message: &Value) -> Result<&Vec<Value>, String> {
    match message.get("blocks") {
        Some(Value::Array(blocks)) => Ok(blocks),
        _ => Err("blocks.some is not a function".to_owned()),
    }
}

/// `getReplyText` (`reply.ts:163`): every text block, joined. Null blocks throw in `.map`.
fn reply_text(blocks: &[Value]) -> Result<String, String> {
    let mut text = String::new();
    for block in blocks {
        if let (Some("text"), Some(Value::String(part))) = (kind_of(block)?, text_of(block)?) {
            text.push_str(part);
        }
    }
    Ok(text)
}

/// `isUsableReply` (`reply.ts:197`): a finished, non-refused reply that carries real text.
fn is_usable_reply(message: &Value) -> Result<bool, String> {
    let role = match message {
        Value::Null => return Err("Cannot read properties of null (reading 'role')".to_owned()),
        other => other.get("role").and_then(Value::as_str),
    };
    if role != Some("assistant") {
        return Ok(false);
    }
    let status = message.get("status").and_then(Value::as_str);
    if status != Some("done") && status != Some("stopped") {
        return Ok(false);
    }
    if message.get("stopReason").and_then(Value::as_str) == Some("refusal") {
        return Ok(false);
    }
    let blocks = blocks_of(message)?;
    for block in blocks {
        if kind_of(block)? == Some("text") && truthy(block.get("isTemplate")) {
            return Ok(false);
        }
    }
    Ok(!reply_text(blocks)?.is_empty())
}

/// `getContextRounds` (`reply.ts:287`): question/answer pairs, stepping over unusable replies.
///
/// `history.length` is the only thing the original reads off the argument, so anything without a
/// length (`{}`, `0`, `true`) simply yields no rounds; only null throws.
fn context_rounds(history: &Value) -> Result<Vec<(Value, Value)>, String> {
    let items = match history {
        Value::Null => return Err("Cannot read properties of null (reading 'length')".to_owned()),
        Value::Array(items) => items,
        _ => return Ok(Vec::new()),
    };
    let mut rounds: Vec<(Value, Value)> = Vec::new();
    let mut index = 0;
    while index + 1 < items.len() {
        let user = &items[index];
        let reply = &items[index + 1];
        let is_question = match user {
            Value::Null => return Err("Cannot read properties of null (reading 'role')".to_owned()),
            other => other.get("role").and_then(Value::as_str) == Some("user"),
        };
        if is_question && is_usable_reply(reply)? {
            rounds.push((user.clone(), reply.clone()));
            index += 1;
        }
        index += 1;
    }
    Ok(rounds)
}

/// `buildReplyView(reply, false).answer?.text ?? ''` (`view.ts:176`), trimmed to the text.
///
/// Only the answer tail matters here: `pendingText` collects the text blocks and is flushed by a
/// thinking step or a tool call, so the answer is whatever text came after the last of those.
/// Anything the original walk would throw on lands back at the caller's zero.
fn answer_text(blocks: &[Value]) -> Result<String, String> {
    // Tool results are addressed by the id of the call they answer, and the whole list is indexed
    // before the text walk starts.
    let mut results: Vec<(Value, Value)> = Vec::new();
    for block in blocks {
        if let Some("web_search_tool_result" | "web_fetch_tool_result") = kind_of(block)? {
            let key = block.get("tool_use_id").cloned().unwrap_or(Value::Null);
            match results.iter_mut().find(|(known, _)| *known == key) {
                Some(slot) => slot.1 = block.clone(),
                None => results.push((key, block.clone())),
            }
        }
    }

    let mut answer = String::new();
    let mut merged_thinking = false;
    for block in blocks {
        let kind = kind_of(block)?;
        let is_text = kind == Some("text");
        // A template block is described separately and never joins the text.
        if is_text && truthy(block.get("isTemplate")) {
            continue;
        }
        if kind != Some("thinking") {
            merged_thinking = false;
        }
        if is_text {
            if let Some(Value::String(text)) = block.get("text") {
                answer.push_str(text);
            }
            continue;
        }
        if kind == Some("thinking") {
            // Neighbouring thinking blocks share one step, so only the first of a run flushes.
            if !merged_thinking && truthy(block.get("thinking")) {
                answer.clear();
                merged_thinking = true;
            }
            continue;
        }
        if kind != Some("server_tool_use") {
            continue;
        }
        let input = block.get("input");
        let action = match input {
            None | Some(Value::Null) => {
                return Err("Cannot read properties of null (reading 'action')".to_owned());
            }
            Some(input) => input.get("action").and_then(Value::as_str),
        };
        if action == Some("read_link")
            && !truthy(input.and_then(|input| input.get("url")))
            && !fetched_url_present(block.get("id"), &results)?
        {
            continue;
        }
        answer.clear();
        if action == Some("search")
            && !matches!(
                input.and_then(|input| input.get("queries")),
                Some(Value::Array(_))
            )
        {
            return Err("queries is not iterable".to_owned());
        }
    }
    Ok(answer)
}

/// `result?.type === 'web_fetch_tool_result' && result.content.type === 'web_fetch_result' &&
/// result.content.url`, the third clause of the `read_link` guard.
fn fetched_url_present(
    call_id: Option<&Value>,
    results: &[(Value, Value)],
) -> Result<bool, String> {
    let Some(call_id) = call_id else {
        return Ok(false);
    };
    let Some((_, result)) = results.iter().find(|(known, _)| known == call_id) else {
        return Ok(false);
    };
    if kind_of(result)? != Some("web_fetch_tool_result") {
        return Ok(false);
    }
    match result.get("content") {
        None | Some(Value::Null) => {
            Err("Cannot read properties of null (reading 'type')".to_owned())
        }
        Some(content) => {
            if kind_of(content)? != Some("web_fetch_result") {
                return Ok(false);
            }
            Ok(truthy(content.get("url")))
        }
    }
}

/// `userTokens`: the question plus a flat charge per attachment.
fn user_tokens(message: &Value) -> Result<f64, String> {
    let content = match message.get("content") {
        Some(Value::String(text)) => estimate_tokens(text.clone())?,
        _ => 0.0,
    };
    let files = match message.get("files") {
        Some(Value::Array(items)) => items.len() as f64,
        _ => 0.0,
    };
    Ok(content + files * FILE_TOKENS)
}

/// `replyTokens`: the answer text of the reply, or 0 where the original throws.
fn reply_tokens(message: &Value) -> Result<f64, String> {
    let text = match blocks_of(message).and_then(|blocks| answer_text(blocks)) {
        Ok(text) => text,
        Err(_) => return Ok(0.0),
    };
    estimate_tokens(text)
}

/// Cost of one `[user, reply]` round.
fn round_tokens(round: &(Value, Value)) -> Result<f64, String> {
    Ok(user_tokens(&round.0)? + reply_tokens(&round.1)?)
}

/// A number as the wire carries it: NaN and the infinities travel as `{"$num": …}` markers.
fn number(value: f64) -> Value {
    if value.is_nan() {
        json!({ "$num": "NaN" })
    } else if value.is_infinite() {
        json!({ "$num": if value > 0.0 { "Infinity" } else { "-Infinity" } })
    } else if value == 0.0 && value.is_sign_negative() {
        json!({ "$num": "-0" })
    } else {
        json!(value)
    }
}

/// Port of `planContext` (`src/services/chat/context/budget.ts:78`).
pub fn plan_context(
    history: Value,
    model: String,
    last_input_tokens: Option<f64>,
) -> Result<Value, String> {
    let usable = model_window(&model) - OUTPUT_RESERVE;
    let trigger = (usable * TRIGGER_RATIO).floor();
    let target = (usable * TARGET_RATIO).floor();

    let rounds = context_rounds(&history)?;

    // A measured count already covers everything but the round being written.
    let measured = last_input_tokens.unwrap_or(0.0);
    let estimate = if measured > 0.0 {
        match rounds.last() {
            Some(round) => measured + round_tokens(round)?,
            None => measured,
        }
    } else {
        let mut total = 0.0;
        for round in &rounds {
            total += round_tokens(round)?;
        }
        total
    };

    // Below the trigger line, or too short to be worth a cut, the history goes back untouched so
    // consecutive rounds keep an identical prefix.
    if estimate <= trigger || rounds.len() <= 2 {
        return Ok(json!({
            "history": history,
            "estimate": number(estimate),
            "compacted": false,
            "droppedRounds": number(0.0),
            "trigger": number(trigger),
            "target": number(target),
        }));
    }

    // Keep the anchor round, then the longest tail that still lands under the target line.
    let mut keep: Vec<Value> = Vec::new();
    let mut total = 0.0;
    if let Some(first) = rounds.first() {
        total = round_tokens(first)?;
        keep.push(first.0.clone());
        keep.push(first.1.clone());
    }
    for round in rounds.iter().skip(1).rev() {
        let cost = round_tokens(round)?;
        if total + cost > target {
            break;
        }
        keep.splice(2..2, [round.0.clone(), round.1.clone()]);
        total += cost;
    }

    Ok(json!({
        "history": keep,
        "estimate": number(total),
        "compacted": true,
        "droppedRounds": number(rounds.len() as f64 - keep.len() as f64 / 2.0),
        "trigger": number(trigger),
        "target": number(target),
    }))
}
