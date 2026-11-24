//! JS bindings for `src/i18n/index.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;

/// `isTranslationKey`.
fn is_translation_key_inner(key: String) -> Result<bool, String> {
    let key = crate::js::from_json(&key)?;
    let out = port::is_translation_key(key)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "isTranslationKey")]
pub fn is_translation_key(key: String) -> Result<bool, JsError> {
    is_translation_key_inner(key).map_err(|e| JsError::new(&e))
}

/// `translateFor`.
fn translate_for_inner(locale: String, key: String, params: String) -> Result<String, String> {
    let key = crate::js::from_json(&key)?;
    let params = crate::js::from_json(&params)?;
    let out = port::translate_for(locale, key, params)?;
    Ok(out)
}

#[wasm_bindgen(js_name = "translateFor")]
pub fn translate_for(locale: String, key: String, params: String) -> Result<String, JsError> {
    translate_for_inner(locale, key, params).map_err(|e| JsError::new(&e))
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

static S_IS_TRANSLATION_KEY_0: wire::Schema = wire::Schema::Dyn;

/// `isTranslationKey` over the binary wire.
#[wasm_bindgen(js_name = "isTranslationKeyWire")]
pub fn is_translation_key_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let key: serde_json::Value = wire::read_value(r, &S_IS_TRANSLATION_KEY_0)?;
        let out = &port::is_translation_key(key)?;
        wire::write_dyn(w, &serde_json::to_value(out).map_err(|e| e.to_string())?);
        Ok(())
    })
}

static S_TRANSLATE_FOR_1: wire::Schema = wire::Schema::Dyn;

/// `translateFor` over the binary wire.
#[wasm_bindgen(js_name = "translateForWire")]
pub fn translate_for_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let locale: String = r.string16()?;
        let key: serde_json::Value = wire::read_value(r, &S_TRANSLATE_FOR_1)?;
        let params: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::translate_for(locale, key, params)?;
        w.string16(out);
        Ok(())
    })
}
