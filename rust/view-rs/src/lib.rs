//! JS bindings for `src/services/chat/view.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `getSiteName`.
fn get_site_name_inner(url: String) -> Result<String, String> {
    let url = crate::js::from_json(&url)?;
    let out = port::get_site_name(url)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getSiteName")]
pub fn get_site_name(url: String) -> Result<String, JsError> {
    get_site_name_inner(url).map_err(|e| JsError::new(&e))
}

/// `isDeepSearchKind`.
fn is_deep_search_kind_inner(kind: String) -> Result<String, String> {
    let kind = crate::js::from_json(&kind)?;
    let out = port::is_deep_search_kind(kind)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isDeepSearchKind")]
pub fn is_deep_search_kind(kind: String) -> Result<String, JsError> {
    is_deep_search_kind_inner(kind).map_err(|e| JsError::new(&e))
}

/// `isImageSearchKind`.
fn is_image_search_kind_inner(kind: String) -> Result<String, String> {
    let kind = crate::js::from_json(&kind)?;
    let out = port::is_image_search_kind(kind)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isImageSearchKind")]
pub fn is_image_search_kind(kind: String) -> Result<String, JsError> {
    is_image_search_kind_inner(kind).map_err(|e| JsError::new(&e))
}

/// `buildReplyView`.
fn build_reply_view_inner(reply: String, streaming: bool) -> Result<String, String> {
    let reply = crate::js::from_json(&reply)?;
    let out = port::build_reply_view(reply, streaming)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "buildReplyView")]
pub fn build_reply_view(reply: String, streaming: bool) -> Result<String, JsError> {
    build_reply_view_inner(reply, streaming).map_err(|e| JsError::new(&e))
}

/// `getTotalThinkingSeconds`.
fn get_total_thinking_seconds_inner(steps: String, now: f64) -> Result<String, String> {
    let steps = crate::js::from_json(&steps)?;
    let out = port::get_total_thinking_seconds(steps, now)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getTotalThinkingSeconds")]
pub fn get_total_thinking_seconds(steps: String, now: f64) -> Result<String, JsError> {
    get_total_thinking_seconds_inner(steps, now).map_err(|e| JsError::new(&e))
}

/// `getAreaTitle`.
fn get_area_title_inner(
    view: String,
    streaming: bool,
    now: f64,
    has_response: String,
) -> Result<String, String> {
    let view = crate::js::from_json(&view)?;
    let has_response = crate::js::from_json(&has_response)?;
    let out = port::get_area_title(view, streaming, now, has_response)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getAreaTitle")]
pub fn get_area_title(
    view: String,
    streaming: bool,
    now: f64,
    has_response: String,
) -> Result<String, JsError> {
    get_area_title_inner(view, streaming, now, has_response).map_err(|e| JsError::new(&e))
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

static S_GET_SITE_NAME_0: wire::Schema = wire::Schema::Dyn;
static S_GET_SITE_NAME_OUT: wire::Schema = wire::Schema::Dyn;

/// `getSiteName` over the binary wire.
#[wasm_bindgen(js_name = "getSiteNameWire")]
pub fn get_site_name_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let url: Value = wire::read_value(r, &S_GET_SITE_NAME_0)?;
        let out = &port::get_site_name(url)?;
        wire::write_value(w, out, &S_GET_SITE_NAME_OUT)?;
        Ok(())
    })
}

static S_IS_DEEP_SEARCH_KIND_0: wire::Schema = wire::Schema::Dyn;
static S_IS_DEEP_SEARCH_KIND_OUT: wire::Schema = wire::Schema::Dyn;

/// `isDeepSearchKind` over the binary wire.
#[wasm_bindgen(js_name = "isDeepSearchKindWire")]
pub fn is_deep_search_kind_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let kind: Value = wire::read_value(r, &S_IS_DEEP_SEARCH_KIND_0)?;
        let out = &port::is_deep_search_kind(kind)?;
        wire::write_value(w, out, &S_IS_DEEP_SEARCH_KIND_OUT)?;
        Ok(())
    })
}

static S_IS_IMAGE_SEARCH_KIND_0: wire::Schema = wire::Schema::Dyn;
static S_IS_IMAGE_SEARCH_KIND_OUT: wire::Schema = wire::Schema::Dyn;

/// `isImageSearchKind` over the binary wire.
#[wasm_bindgen(js_name = "isImageSearchKindWire")]
pub fn is_image_search_kind_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let kind: Value = wire::read_value(r, &S_IS_IMAGE_SEARCH_KIND_0)?;
        let out = &port::is_image_search_kind(kind)?;
        wire::write_value(w, out, &S_IS_IMAGE_SEARCH_KIND_OUT)?;
        Ok(())
    })
}

static S_BUILD_REPLY_VIEW_0: wire::Schema = wire::Schema::Dyn;
static S_BUILD_REPLY_VIEW_OUT: wire::Schema = wire::Schema::Obj(&[
    ("steps", wire::Schema::List(&wire::Schema::Dyn)),
    (
        "answer",
        wire::Schema::OptJs(&wire::Schema::Obj(&[
            ("markdown", wire::Schema::Str16),
            ("text", wire::Schema::Str16),
        ])),
    ),
    (
        "sources",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("url", wire::Schema::Str16),
            ("title", wire::Schema::Str16),
            ("siteName", wire::Schema::Str16),
            ("publishedAt", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("snippet", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("siteIcon", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("index", wire::Schema::Num),
        ])),
    ),
    (
        "searchResults",
        wire::Schema::List(&wire::Schema::Obj(&[
            ("url", wire::Schema::Str16),
            ("title", wire::Schema::Str16),
            ("siteName", wire::Schema::Str16),
            ("publishedAt", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("snippet", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("siteIcon", wire::Schema::OptJs(&wire::Schema::Str16)),
            ("index", wire::Schema::Num),
        ])),
    ),
]);

/// `buildReplyView` over the binary wire.
#[wasm_bindgen(js_name = "buildReplyViewWire")]
pub fn build_reply_view_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let reply: Value = wire::read_value(r, &S_BUILD_REPLY_VIEW_0)?;
        let streaming: bool = r.bool()?;
        let out = &port::build_reply_view(reply, streaming)?;
        wire::write_value(w, out, &S_BUILD_REPLY_VIEW_OUT)?;
        Ok(())
    })
}

static S_GET_TOTAL_THINKING_SECONDS_0: wire::Schema = wire::Schema::Dyn;
static S_GET_TOTAL_THINKING_SECONDS_OUT: wire::Schema = wire::Schema::Dyn;

/// `getTotalThinkingSeconds` over the binary wire.
#[wasm_bindgen(js_name = "getTotalThinkingSecondsWire")]
pub fn get_total_thinking_seconds_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let steps: Value = wire::read_value(r, &S_GET_TOTAL_THINKING_SECONDS_0)?;
        let now: f64 = r.f64()?;
        let out = &port::get_total_thinking_seconds(steps, now)?;
        wire::write_value(w, out, &S_GET_TOTAL_THINKING_SECONDS_OUT)?;
        Ok(())
    })
}

static S_GET_AREA_TITLE_0: wire::Schema = wire::Schema::Dyn;
static S_GET_AREA_TITLE_3: wire::Schema = wire::Schema::Dyn;
static S_GET_AREA_TITLE_OUT: wire::Schema = wire::Schema::Dyn;

/// `getAreaTitle` over the binary wire.
#[wasm_bindgen(js_name = "getAreaTitleWire")]
pub fn get_area_title_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let view: Value = wire::read_value(r, &S_GET_AREA_TITLE_0)?;
        let streaming: bool = r.bool()?;
        let now: f64 = r.f64()?;
        let has_response: Value = wire::read_value(r, &S_GET_AREA_TITLE_3)?;
        let out = &port::get_area_title(view, streaming, now, has_response)?;
        wire::write_value(w, out, &S_GET_AREA_TITLE_OUT)?;
        Ok(())
    })
}
