//! JS bindings for `src/services/chat/branches.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `normalizeSession`.
fn normalize_session_inner(session: String) -> Result<String, String> {
    let session = crate::js::from_json(&session)?;
    let out = port::normalize_session(session)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeSession")]
pub fn normalize_session(session: String) -> Result<String, JsError> {
    normalize_session_inner(session).map_err(|e| JsError::new(&e))
}

/// `getVisibleMessages`.
fn get_visible_messages_inner(session: String) -> Result<String, String> {
    let session = crate::js::from_json(&session)?;
    let out = port::get_visible_messages(session)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getVisibleMessages")]
pub fn get_visible_messages(session: String) -> Result<String, JsError> {
    get_visible_messages_inner(session).map_err(|e| JsError::new(&e))
}

/// `buildMessageVersions`.
fn build_message_versions_inner(session: String, previous: String) -> Result<String, String> {
    let session = crate::js::from_json(&session)?;
    let previous = crate::js::from_json(&previous)?;
    let out = port::build_message_versions(session, previous)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "buildMessageVersions")]
pub fn build_message_versions(session: String, previous: String) -> Result<String, JsError> {
    build_message_versions_inner(session, previous).map_err(|e| JsError::new(&e))
}

/// `appendBranch`.
fn append_branch_inner(
    original: String,
    parent_id: String,
    messages: String,
) -> Result<String, String> {
    let original = crate::js::from_json(&original)?;
    let parent_id = crate::js::from_json(&parent_id)?;
    let messages = crate::js::from_json(&messages)?;
    let out = port::append_branch(original, parent_id, messages)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "appendBranch")]
pub fn append_branch(
    original: String,
    parent_id: String,
    messages: String,
) -> Result<String, JsError> {
    append_branch_inner(original, parent_id, messages).map_err(|e| JsError::new(&e))
}

/// `selectVersion`.
fn select_version_inner(original: String, message_id: String) -> Result<String, String> {
    let original = crate::js::from_json(&original)?;
    let out = port::select_version(original, message_id)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "selectVersion")]
pub fn select_version(original: String, message_id: String) -> Result<String, JsError> {
    select_version_inner(original, message_id).map_err(|e| JsError::new(&e))
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

static S_NORMALIZE_SESSION_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_SESSION_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Str16),
    ("title", wire::Schema::Str16),
    ("createdAt", wire::Schema::Num),
    ("updatedAt", wire::Schema::Num),
    ("messages", wire::Schema::List(&wire::Schema::Dyn)),
    ("rootMessageId", wire::Schema::OptJs(&wire::Schema::Str16)),
    (
        "contextUsage",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("inputTokens", wire::Schema::Num),
            ("outputTokens", wire::Schema::Num),
            ("cacheReadTokens", wire::Schema::Num),
            ("cacheWriteTokens", wire::Schema::Num),
            ("updatedAt", wire::Schema::Num),
        ])),
    ),
    (
        "anchor",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("text", wire::Schema::Str16),
            ("upTo", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ])),
    ),
    (
        "memory",
        wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
            ("index", wire::Schema::Num),
            ("fromRound", wire::Schema::Num),
            ("toRound", wire::Schema::Num),
            ("text", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ]))),
    ),
]);

/// `normalizeSession` over the binary wire.
#[wasm_bindgen(js_name = "normalizeSessionWire")]
pub fn normalize_session_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let session: Value = wire::read_value(r, &S_NORMALIZE_SESSION_0)?;
        let out = &port::normalize_session(session)?;
        wire::write_value(w, out, &S_NORMALIZE_SESSION_OUT)?;
        Ok(())
    })
}

static S_GET_VISIBLE_MESSAGES_0: wire::Schema = wire::Schema::Dyn;
static S_GET_VISIBLE_MESSAGES_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Dyn);

/// `getVisibleMessages` over the binary wire.
#[wasm_bindgen(js_name = "getVisibleMessagesWire")]
pub fn get_visible_messages_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let session: Value = wire::read_value(r, &S_GET_VISIBLE_MESSAGES_0)?;
        let out = &port::get_visible_messages(session)?;
        wire::write_value(w, out, &S_GET_VISIBLE_MESSAGES_OUT)?;
        Ok(())
    })
}

static S_BUILD_MESSAGE_VERSIONS_0: wire::Schema = wire::Schema::Dyn;
static S_BUILD_MESSAGE_VERSIONS_1: wire::Schema = wire::Schema::Dyn;
static S_BUILD_MESSAGE_VERSIONS_OUT: wire::Schema = wire::Schema::Dyn;

/// `buildMessageVersions` over the binary wire.
#[wasm_bindgen(js_name = "buildMessageVersionsWire")]
pub fn build_message_versions_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let session: Value = wire::read_value(r, &S_BUILD_MESSAGE_VERSIONS_0)?;
        let previous: Value = wire::read_value(r, &S_BUILD_MESSAGE_VERSIONS_1)?;
        let out = &port::build_message_versions(session, previous)?;
        wire::write_value(w, out, &S_BUILD_MESSAGE_VERSIONS_OUT)?;
        Ok(())
    })
}

static S_APPEND_BRANCH_0: wire::Schema = wire::Schema::Dyn;
static S_APPEND_BRANCH_1: wire::Schema = wire::Schema::Dyn;
static S_APPEND_BRANCH_2: wire::Schema = wire::Schema::Dyn;
static S_APPEND_BRANCH_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Str16),
    ("title", wire::Schema::Str16),
    ("createdAt", wire::Schema::Num),
    ("updatedAt", wire::Schema::Num),
    ("messages", wire::Schema::List(&wire::Schema::Dyn)),
    ("rootMessageId", wire::Schema::OptJs(&wire::Schema::Str16)),
    (
        "contextUsage",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("inputTokens", wire::Schema::Num),
            ("outputTokens", wire::Schema::Num),
            ("cacheReadTokens", wire::Schema::Num),
            ("cacheWriteTokens", wire::Schema::Num),
            ("updatedAt", wire::Schema::Num),
        ])),
    ),
    (
        "anchor",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("text", wire::Schema::Str16),
            ("upTo", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ])),
    ),
    (
        "memory",
        wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
            ("index", wire::Schema::Num),
            ("fromRound", wire::Schema::Num),
            ("toRound", wire::Schema::Num),
            ("text", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ]))),
    ),
]);

/// `appendBranch` over the binary wire.
#[wasm_bindgen(js_name = "appendBranchWire")]
pub fn append_branch_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let original: Value = wire::read_value(r, &S_APPEND_BRANCH_0)?;
        let parent_id: Value = wire::read_value(r, &S_APPEND_BRANCH_1)?;
        let messages: Value = wire::read_value(r, &S_APPEND_BRANCH_2)?;
        let out = &port::append_branch(original, parent_id, messages)?;
        wire::write_value(w, out, &S_APPEND_BRANCH_OUT)?;
        Ok(())
    })
}

static S_SELECT_VERSION_0: wire::Schema = wire::Schema::Dyn;
static S_SELECT_VERSION_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Str16),
    ("title", wire::Schema::Str16),
    ("createdAt", wire::Schema::Num),
    ("updatedAt", wire::Schema::Num),
    ("messages", wire::Schema::List(&wire::Schema::Dyn)),
    ("rootMessageId", wire::Schema::OptJs(&wire::Schema::Str16)),
    (
        "contextUsage",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("inputTokens", wire::Schema::Num),
            ("outputTokens", wire::Schema::Num),
            ("cacheReadTokens", wire::Schema::Num),
            ("cacheWriteTokens", wire::Schema::Num),
            ("updatedAt", wire::Schema::Num),
        ])),
    ),
    (
        "anchor",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("text", wire::Schema::Str16),
            ("upTo", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ])),
    ),
    (
        "memory",
        wire::Schema::OptJs(&wire::Schema::List(&wire::Schema::Obj(&[
            ("index", wire::Schema::Num),
            ("fromRound", wire::Schema::Num),
            ("toRound", wire::Schema::Num),
            ("text", wire::Schema::Str16),
            ("createdAt", wire::Schema::Num),
        ]))),
    ),
]);

/// `selectVersion` over the binary wire.
#[wasm_bindgen(js_name = "selectVersionWire")]
pub fn select_version_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let original: Value = wire::read_value(r, &S_SELECT_VERSION_0)?;
        let message_id: String = r.string16()?;
        let out = &port::select_version(original, message_id)?;
        wire::write_value(w, out, &S_SELECT_VERSION_OUT)?;
        Ok(())
    })
}
