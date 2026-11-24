//! JS bindings for `src/services/location.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `getRegionName`.
fn get_region_name_inner(code: String, locale: String) -> Result<String, String> {
    let out = port::get_region_name(code, locale)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "getRegionName")]
pub fn get_region_name(code: String, locale: String) -> Result<String, JsError> {
    get_region_name_inner(code, locale).map_err(|e| JsError::new(&e))
}

/// `normalizeLocation`.
fn normalize_location_inner(value: String) -> Result<String, String> {
    let value = crate::js::from_json(&value)?;
    let out = port::normalize_location(value)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "normalizeLocation")]
pub fn normalize_location(value: String) -> Result<String, JsError> {
    normalize_location_inner(value).map_err(|e| JsError::new(&e))
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

static S_NORMALIZE_LOCATION_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_LOCATION_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[
    ("region", wire::Schema::Str16),
    ("province", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("city", wire::Schema::OptJs(&wire::Schema::Str16)),
]));

/// `normalizeLocation` over the binary wire.
#[wasm_bindgen(js_name = "normalizeLocationWire")]
pub fn normalize_location_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let value: serde_json::Value = wire::read_value(r, &S_NORMALIZE_LOCATION_0)?;
        let out = &port::normalize_location(value)?;
        match out {
            Some(x0) => {
                w.tag(1);
                wire::write_value(w, x0, S_NORMALIZE_LOCATION_OUT.inner())?;
            }
            None => w.tag(2),
        }
        Ok(())
    })
}
