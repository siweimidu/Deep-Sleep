//! JS bindings for `src/services/chat/history/paths.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `sessionPath`.
fn session_path_inner(session_id: String) -> Result<String, String> {
    let out = port::session_path(session_id)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "sessionPath")]
pub fn session_path(session_id: String) -> Result<String, JsError> {
    session_path_inner(session_id).map_err(|e| JsError::new(&e))
}

/// `sessionFilesDir`.
fn session_files_dir_inner(session_id: String) -> Result<String, String> {
    let out = port::session_files_dir(session_id)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "sessionFilesDir")]
pub fn session_files_dir(session_id: String) -> Result<String, JsError> {
    session_files_dir_inner(session_id).map_err(|e| JsError::new(&e))
}

/// `parseSessionPath`.
fn parse_session_path_inner(path: String) -> Result<String, String> {
    let out = port::parse_session_path(path)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "parseSessionPath")]
pub fn parse_session_path(path: String) -> Result<String, JsError> {
    parse_session_path_inner(path).map_err(|e| JsError::new(&e))
}

/// `imagePath`.
fn image_path_inner(
    session_id: String,
    file_id: String,
    file_name: String,
) -> Result<String, String> {
    let out = port::image_path(session_id, file_id, file_name)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "imagePath")]
pub fn image_path(
    session_id: String,
    file_id: String,
    file_name: String,
) -> Result<String, JsError> {
    image_path_inner(session_id, file_id, file_name).map_err(|e| JsError::new(&e))
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

static S_PARSE_SESSION_PATH_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `parseSessionPath` over the binary wire.
#[wasm_bindgen(js_name = "parseSessionPathWire")]
pub fn parse_session_path_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let path: String = r.string16()?;
        let out = &port::parse_session_path(path)?;
        wire::write_value(w, out, &S_PARSE_SESSION_PATH_OUT)?;
        Ok(())
    })
}
