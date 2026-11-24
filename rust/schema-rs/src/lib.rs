//! JS bindings for `src/services/chat/history/schema.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `checkManifest`.
fn check_manifest_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::check_manifest(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "checkManifest")]
pub fn check_manifest(value: String) -> Result<String, JsError> {
    check_manifest_inner(value).map_err(|e| JsError::new(&e))
}

/// `readSessionFile`.
fn read_session_file_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::read_session_file(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "readSessionFile")]
pub fn read_session_file(value: String) -> Result<String, JsError> {
    read_session_file_inner(value).map_err(|e| JsError::new(&e))
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

static S_CHECK_MANIFEST_0: wire::Schema = wire::Schema::Dyn;
static S_CHECK_MANIFEST_OUT: wire::Schema = wire::Schema::Dyn;

/// `checkManifest` over the binary wire.
#[wasm_bindgen(js_name = "checkManifestWire")]
pub fn check_manifest_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_CHECK_MANIFEST_0)?;
        let out = &port::check_manifest(value)?;
        wire::write_value(w, out, &S_CHECK_MANIFEST_OUT)?;
        Ok(())
    })
}

static S_READ_SESSION_FILE_0: wire::Schema = wire::Schema::Dyn;
static S_READ_SESSION_FILE_OUT: wire::Schema = wire::Schema::Dyn;

/// `readSessionFile` over the binary wire.
#[wasm_bindgen(js_name = "readSessionFileWire")]
pub fn read_session_file_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: Value = wire::read_value(r, &S_READ_SESSION_FILE_0)?;
        let out = &port::read_session_file(value)?;
        wire::write_value(w, out, &S_READ_SESSION_FILE_OUT)?;
        Ok(())
    })
}
