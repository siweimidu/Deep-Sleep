//! JS bindings for `src/services/chat/reply.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `applyEvent`.
fn apply_event_inner(
    reply: String,
    event: String,
    now: f64,
    block_indexes: String,
) -> Result<String, String> {
    let reply = crate::js::from_json(&reply)?;
    let event = crate::js::from_json(&event)?;
    let block_indexes = crate::js::from_json(&block_indexes)?;
    let out = port::apply_event(reply, event, now, block_indexes)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "applyEvent")]
pub fn apply_event(
    reply: String,
    event: String,
    now: f64,
    block_indexes: String,
) -> Result<String, JsError> {
    apply_event_inner(reply, event, now, block_indexes).map_err(|e| JsError::new(&e))
}

/// `settleReply`.
fn settle_reply_inner(
    reply: String,
    status: String,
    now: f64,
    error: String,
) -> Result<String, String> {
    let reply = crate::js::from_json(&reply)?;
    let status = crate::js::from_json(&status)?;
    let error = crate::js::from_json(&error)?;
    let out = port::settle_reply(reply, status, now, error)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "settleReply")]
pub fn settle_reply(
    reply: String,
    status: String,
    now: f64,
    error: String,
) -> Result<String, JsError> {
    settle_reply_inner(reply, status, now, error).map_err(|e| JsError::new(&e))
}

/// `getReplyText`.
fn get_reply_text_inner(reply: String) -> Result<String, String> {
    let reply = crate::js::from_json(&reply)?;
    let out = port::get_reply_text(reply)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getReplyText")]
pub fn get_reply_text(reply: String) -> Result<String, JsError> {
    get_reply_text_inner(reply).map_err(|e| JsError::new(&e))
}

/// `canContinueReply`.
fn can_continue_reply_inner(reply: String) -> Result<String, String> {
    let reply = crate::js::from_json(&reply)?;
    let out = port::can_continue_reply(reply)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "canContinueReply")]
pub fn can_continue_reply(reply: String) -> Result<String, JsError> {
    can_continue_reply_inner(reply).map_err(|e| JsError::new(&e))
}

/// `getContextRounds`.
fn get_context_rounds_inner(history: String) -> Result<String, String> {
    let history = crate::js::from_json(&history)?;
    let out = port::get_context_rounds(history)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getContextRounds")]
pub fn get_context_rounds(history: String) -> Result<String, JsError> {
    get_context_rounds_inner(history).map_err(|e| JsError::new(&e))
}

/// `toRequestMessages`.
fn to_request_messages_inner(
    history: String,
    question: String,
    prefix: String,
    thinking: String,
    latest_reminder: String,
) -> Result<String, String> {
    let history = crate::js::from_json(&history)?;
    let question = crate::js::from_json(&question)?;
    let prefix = crate::js::from_json(&prefix)?;
    let thinking = crate::js::from_json(&thinking)?;
    let latest_reminder = crate::js::from_json(&latest_reminder)?;
    let out = port::to_request_messages(history, question, prefix, thinking, latest_reminder)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "toRequestMessages")]
pub fn to_request_messages(
    history: String,
    question: String,
    prefix: String,
    thinking: String,
    latest_reminder: String,
) -> Result<String, JsError> {
    to_request_messages_inner(history, question, prefix, thinking, latest_reminder)
        .map_err(|e| JsError::new(&e))
}

/// `getThinkingSeconds`.
fn get_thinking_seconds_inner(started_at: f64, ended_at: f64) -> Result<String, String> {
    let out = port::get_thinking_seconds(started_at, ended_at)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getThinkingSeconds")]
pub fn get_thinking_seconds(started_at: f64, ended_at: f64) -> Result<String, JsError> {
    get_thinking_seconds_inner(started_at, ended_at).map_err(|e| JsError::new(&e))
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE_IN: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static WIRE_OUT: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// This module's memory, where `index.cjs` reads and writes the wire buffers.
#[wasm_bindgen(js_name = "rustAnythingWireMemory")]
pub fn rust_anything_wire_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// The address of an argument buffer of `len` bytes.
#[wasm_bindgen(js_name = "rustAnythingWireIn")]
pub fn rust_anything_wire_in(len: u32) -> u32 {
    WIRE_IN.with(|b| {
        let mut b = b.borrow_mut();
        b.resize(len as usize, 0);
        b.as_mut_ptr() as usize as u32
    })
}

/// The address of the last result.
#[wasm_bindgen(js_name = "rustAnythingWireOut")]
pub fn rust_anything_wire_out() -> u32 {
    WIRE_OUT.with(|b| b.borrow().as_ptr() as usize as u32)
}

/// Reads `len` argument bytes, runs `f`, and keeps its result for `rustAnythingWireOut`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> Result<u32, JsError> {
    let input = WIRE_IN.with(|b| std::mem::take(&mut *b.borrow_mut()));
    let mut w = wire::Writer::default();
    let result = f(
        &mut wire::Reader::new(&input[..(len as usize).min(input.len())]),
        &mut w,
    );
    WIRE_IN.with(|b| *b.borrow_mut() = input);
    match result {
        // A result of another shape than the TS type: JS runs the call through JSON.
        Err(e) if e.starts_with(wire::MISMATCH) => return Ok(u32::MAX),
        other => other.map_err(|e| JsError::new(&e))?,
    }
    let n = w.0.len();
    WIRE_OUT.with(|b| *b.borrow_mut() = w.0);
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

static S_APPLY_EVENT_0: wire::Schema = wire::Schema::Dyn;
static S_APPLY_EVENT_1: wire::Schema = wire::Schema::Dyn;
static S_APPLY_EVENT_3: wire::Schema = wire::Schema::Dyn;
static S_APPLY_EVENT_OUT: wire::Schema = wire::Schema::Obj(&[
    ("parentId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("selectedChildId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("id", wire::Schema::Str16),
    ("role", wire::Schema::Str16),
    ("createdAt", wire::Schema::Num),
    ("model", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("thinking", wire::Schema::OptJs(&wire::Schema::Bool)),
    ("search", wire::Schema::OptJs(&wire::Schema::Bool)),
    ("latestReminder", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("prefix", wire::Schema::Bool),
    ("status", wire::Schema::Str16),
    ("blocks", wire::Schema::List(&wire::Schema::Dyn)),
    ("stopReason", wire::Schema::OptJs(&wire::Schema::Str16)),
    (
        "stopDetails",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("type", wire::Schema::Str16),
            ("category", wire::Schema::Dyn),
            ("explanation", wire::Schema::Dyn),
        ])),
    ),
    (
        "usage",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("input_tokens", wire::Schema::Num),
            ("cache_creation_input_tokens", wire::Schema::Num),
            ("cache_read_input_tokens", wire::Schema::Num),
            ("output_tokens", wire::Schema::Num),
            (
                "server_tool_use",
                wire::Schema::OptJs(&wire::Schema::Obj(&[
                    ("web_search_requests", wire::Schema::Num),
                    ("tool_search", wire::Schema::Num),
                ])),
            ),
        ])),
    ),
    (
        "error",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("kind", wire::Schema::Dyn),
            ("message", wire::Schema::Str16),
            ("status", wire::Schema::OptJs(&wire::Schema::Num)),
            (
                "localMessage",
                wire::Schema::OptJs(&wire::Schema::Obj(&[
                    ("key", wire::Schema::Dyn),
                    (
                        "params",
                        wire::Schema::OptJs(&wire::Schema::Map16(&wire::Schema::Dyn)),
                    ),
                ])),
            ),
            ("retryable", wire::Schema::OptJs(&wire::Schema::Bool)),
        ])),
    ),
]);

/// `applyEvent` over the binary wire.
#[wasm_bindgen(js_name = "applyEventWire")]
pub fn apply_event_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let reply: Value = wire::read_value(r, &S_APPLY_EVENT_0)?;
        let event: Value = wire::read_value(r, &S_APPLY_EVENT_1)?;
        let now: f64 = r.f64()?;
        let block_indexes: Value = wire::read_value(r, &S_APPLY_EVENT_3)?;
        let out = &port::apply_event(reply, event, now, block_indexes)?;
        wire::write_value(w, out, &S_APPLY_EVENT_OUT)?;
        Ok(())
    })
}

static S_SETTLE_REPLY_0: wire::Schema = wire::Schema::Dyn;
static S_SETTLE_REPLY_1: wire::Schema = wire::Schema::Dyn;
static S_SETTLE_REPLY_3: wire::Schema = wire::Schema::Dyn;
static S_SETTLE_REPLY_OUT: wire::Schema = wire::Schema::Obj(&[
    ("parentId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("selectedChildId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("id", wire::Schema::Str16),
    ("role", wire::Schema::Str16),
    ("createdAt", wire::Schema::Num),
    ("model", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("thinking", wire::Schema::OptJs(&wire::Schema::Bool)),
    ("search", wire::Schema::OptJs(&wire::Schema::Bool)),
    ("latestReminder", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("prefix", wire::Schema::Bool),
    ("status", wire::Schema::Str16),
    ("blocks", wire::Schema::List(&wire::Schema::Dyn)),
    ("stopReason", wire::Schema::OptJs(&wire::Schema::Str16)),
    (
        "stopDetails",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("type", wire::Schema::Str16),
            ("category", wire::Schema::Dyn),
            ("explanation", wire::Schema::Dyn),
        ])),
    ),
    (
        "usage",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("input_tokens", wire::Schema::Num),
            ("cache_creation_input_tokens", wire::Schema::Num),
            ("cache_read_input_tokens", wire::Schema::Num),
            ("output_tokens", wire::Schema::Num),
            (
                "server_tool_use",
                wire::Schema::OptJs(&wire::Schema::Obj(&[
                    ("web_search_requests", wire::Schema::Num),
                    ("tool_search", wire::Schema::Num),
                ])),
            ),
        ])),
    ),
    (
        "error",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("kind", wire::Schema::Dyn),
            ("message", wire::Schema::Str16),
            ("status", wire::Schema::OptJs(&wire::Schema::Num)),
            (
                "localMessage",
                wire::Schema::OptJs(&wire::Schema::Obj(&[
                    ("key", wire::Schema::Dyn),
                    (
                        "params",
                        wire::Schema::OptJs(&wire::Schema::Map16(&wire::Schema::Dyn)),
                    ),
                ])),
            ),
            ("retryable", wire::Schema::OptJs(&wire::Schema::Bool)),
        ])),
    ),
]);

/// `settleReply` over the binary wire.
#[wasm_bindgen(js_name = "settleReplyWire")]
pub fn settle_reply_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let reply: Value = wire::read_value(r, &S_SETTLE_REPLY_0)?;
        let status: Value = wire::read_value(r, &S_SETTLE_REPLY_1)?;
        let now: f64 = r.f64()?;
        let error: Value = wire::read_value(r, &S_SETTLE_REPLY_3)?;
        let out = &port::settle_reply(reply, status, now, error)?;
        wire::write_value(w, out, &S_SETTLE_REPLY_OUT)?;
        Ok(())
    })
}

static S_GET_REPLY_TEXT_0: wire::Schema = wire::Schema::Dyn;
static S_GET_REPLY_TEXT_OUT: wire::Schema = wire::Schema::Dyn;

/// `getReplyText` over the binary wire.
#[wasm_bindgen(js_name = "getReplyTextWire")]
pub fn get_reply_text_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let reply: Value = wire::read_value(r, &S_GET_REPLY_TEXT_0)?;
        let out = &port::get_reply_text(reply)?;
        wire::write_value(w, out, &S_GET_REPLY_TEXT_OUT)?;
        Ok(())
    })
}

static S_CAN_CONTINUE_REPLY_0: wire::Schema = wire::Schema::Dyn;
static S_CAN_CONTINUE_REPLY_OUT: wire::Schema = wire::Schema::Bool;

/// `canContinueReply` over the binary wire.
#[wasm_bindgen(js_name = "canContinueReplyWire")]
pub fn can_continue_reply_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let reply: Value = wire::read_value(r, &S_CAN_CONTINUE_REPLY_0)?;
        let out = &port::can_continue_reply(reply)?;
        wire::write_value(w, out, &S_CAN_CONTINUE_REPLY_OUT)?;
        Ok(())
    })
}

static S_GET_CONTEXT_ROUNDS_0: wire::Schema = wire::Schema::Dyn;
static S_GET_CONTEXT_ROUNDS_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `getContextRounds` over the binary wire.
#[wasm_bindgen(js_name = "getContextRoundsWire")]
pub fn get_context_rounds_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let history: Value = wire::read_value(r, &S_GET_CONTEXT_ROUNDS_0)?;
        let out = &port::get_context_rounds(history)?;
        wire::write_value(w, out, &S_GET_CONTEXT_ROUNDS_OUT)?;
        Ok(())
    })
}

static S_TO_REQUEST_MESSAGES_0: wire::Schema = wire::Schema::Dyn;
static S_TO_REQUEST_MESSAGES_1: wire::Schema = wire::Schema::Dyn;
static S_TO_REQUEST_MESSAGES_3: wire::Schema = wire::Schema::Dyn;
static S_TO_REQUEST_MESSAGES_4: wire::Schema = wire::Schema::Dyn;
static S_TO_REQUEST_MESSAGES_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `toRequestMessages` over the binary wire.
#[wasm_bindgen(js_name = "toRequestMessagesWire")]
pub fn to_request_messages_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let history: Value = wire::read_value(r, &S_TO_REQUEST_MESSAGES_0)?;
        let question: Value = wire::read_value(r, &S_TO_REQUEST_MESSAGES_1)?;
        let prefix: Option<Value> = wire::read_dyn_opt(r)?;
        let thinking: Value = wire::read_value(r, &S_TO_REQUEST_MESSAGES_3)?;
        let latest_reminder: Value = wire::read_value(r, &S_TO_REQUEST_MESSAGES_4)?;
        let out = &port::to_request_messages(history, question, prefix, thinking, latest_reminder)?;
        wire::write_value(w, out, &S_TO_REQUEST_MESSAGES_OUT)?;
        Ok(())
    })
}

static S_GET_THINKING_SECONDS_OUT: wire::Schema = wire::Schema::Dyn;

/// `getThinkingSeconds` over the binary wire.
#[wasm_bindgen(js_name = "getThinkingSecondsWire")]
pub fn get_thinking_seconds_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let started_at: f64 = r.f64()?;
        let ended_at: f64 = r.f64()?;
        let out = &port::get_thinking_seconds(started_at, ended_at)?;
        wire::write_value(w, out, &S_GET_THINKING_SECONDS_OUT)?;
        Ok(())
    })
}
