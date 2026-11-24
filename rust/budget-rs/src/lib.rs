//! JS bindings for `src/services/chat/context/budget.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `estimateTokens`.
fn estimate_tokens_inner(text: String) -> Result<f64, String> {
    let out = port::estimate_tokens(text)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "estimateTokens")]
pub fn estimate_tokens(text: String) -> Result<f64, JsError> {
    estimate_tokens_inner(text).map_err(|e| JsError::new(&e))
}

/// `planContext`.
fn plan_context_inner(
    history: String,
    model: String,
    last_input_tokens: Option<f64>,
) -> Result<String, String> {
    let history = crate::js::from_json(&history)?;
    let out = port::plan_context(history, model, last_input_tokens)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "planContext")]
pub fn plan_context(
    history: String,
    model: String,
    last_input_tokens: Option<f64>,
) -> Result<String, JsError> {
    plan_context_inner(history, model, last_input_tokens).map_err(|e| JsError::new(&e))
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

static S_PLAN_CONTEXT_0: wire::Schema = wire::Schema::Dyn;
static S_PLAN_CONTEXT_OUT: wire::Schema = wire::Schema::Obj(&[
    ("history", wire::Schema::List(&wire::Schema::Dyn)),
    ("estimate", wire::Schema::Num),
    ("compacted", wire::Schema::Bool),
    ("droppedRounds", wire::Schema::Num),
    ("trigger", wire::Schema::Num),
    ("target", wire::Schema::Num),
]);

/// `planContext` over the binary wire.
#[wasm_bindgen(js_name = "planContextWire")]
pub fn plan_context_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let history: Value = wire::read_value(r, &S_PLAN_CONTEXT_0)?;
        let model: String = r.string16()?;
        let last_input_tokens: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::plan_context(history, model, last_input_tokens)?;
        wire::write_value(w, out, &S_PLAN_CONTEXT_OUT)?;
        Ok(())
    })
}
