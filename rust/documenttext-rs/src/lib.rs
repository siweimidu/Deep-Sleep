//! JS bindings for `src/services/documentText.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `extensionOf`.
fn extension_of_inner(name: String) -> Result<String, String> {
    let out = port::extension_of(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "extensionOf")]
pub fn extension_of(name: String) -> Result<String, JsError> {
    extension_of_inner(name).map_err(|e| JsError::new(&e))
}

/// `canExtractText`.
fn can_extract_text_inner(name: String) -> Result<String, String> {
    let out = port::can_extract_text(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "canExtractText")]
pub fn can_extract_text(name: String) -> Result<String, JsError> {
    can_extract_text_inner(name).map_err(|e| JsError::new(&e))
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

static S_EXTENSION_OF_OUT: wire::Schema = wire::Schema::Dyn;

/// `extensionOf` over the binary wire.
#[wasm_bindgen(js_name = "extensionOfWire")]
pub fn extension_of_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let out = &port::extension_of(name)?;
        wire::write_value(w, out, &S_EXTENSION_OF_OUT)?;
        Ok(())
    })
}

static S_CAN_EXTRACT_TEXT_OUT: wire::Schema = wire::Schema::Dyn;

/// `canExtractText` over the binary wire.
#[wasm_bindgen(js_name = "canExtractTextWire")]
pub fn can_extract_text_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let out = &port::can_extract_text(name)?;
        wire::write_value(w, out, &S_CAN_EXTRACT_TEXT_OUT)?;
        Ok(())
    })
}
