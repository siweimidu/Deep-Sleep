//! JS bindings for `src/services/attachments.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

/// `getFileExt`.
fn get_file_ext_inner(name: String) -> Result<String, String> {
    let out = port::get_file_ext(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getFileExt")]
pub fn get_file_ext(name: String) -> Result<String, JsError> {
    get_file_ext_inner(name).map_err(|e| JsError::new(&e))
}

/// `isAcceptedExt`.
fn is_accepted_ext_inner(name: String) -> Result<String, String> {
    let out = port::is_accepted_ext(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isAcceptedExt")]
pub fn is_accepted_ext(name: String) -> Result<String, JsError> {
    is_accepted_ext_inner(name).map_err(|e| JsError::new(&e))
}

/// `getUploadPurpose`.
fn get_upload_purpose_inner(name: String, is_image: bool) -> Result<String, String> {
    let out = port::get_upload_purpose(name, is_image)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getUploadPurpose")]
pub fn get_upload_purpose(name: String, is_image: bool) -> Result<String, JsError> {
    get_upload_purpose_inner(name, is_image).map_err(|e| JsError::new(&e))
}

/// `validateFiles`.
fn validate_files_inner(files: String, current_count: f64) -> Result<String, String> {
    let files = crate::js::from_json(&files)?;
    let out = port::validate_files(files, current_count)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "validateFiles")]
pub fn validate_files(files: String, current_count: f64) -> Result<String, JsError> {
    validate_files_inner(files, current_count).map_err(|e| JsError::new(&e))
}

/// `resolveMimeType`.
fn resolve_mime_type_inner(file: String) -> Result<String, String> {
    let file = crate::js::from_json(&file)?;
    let out = port::resolve_mime_type(file)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "resolveMimeType")]
pub fn resolve_mime_type(file: String) -> Result<String, JsError> {
    resolve_mime_type_inner(file).map_err(|e| JsError::new(&e))
}

/// `isImage`.
fn is_image_inner(mime_type: String) -> Result<String, String> {
    let out = port::is_image(mime_type)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isImage")]
pub fn is_image(mime_type: String) -> Result<String, JsError> {
    is_image_inner(mime_type).map_err(|e| JsError::new(&e))
}

/// `getExtension`.
fn get_extension_inner(name: String) -> Result<String, String> {
    let out = port::get_extension(name)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "getExtension")]
pub fn get_extension(name: String) -> Result<String, JsError> {
    get_extension_inner(name).map_err(|e| JsError::new(&e))
}

/// `formatSize`.
fn format_size_inner(bytes: f64) -> Result<String, String> {
    let out = port::format_size(bytes)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "formatSize")]
pub fn format_size(bytes: f64) -> Result<String, JsError> {
    format_size_inner(bytes).map_err(|e| JsError::new(&e))
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

static S_GET_FILE_EXT_OUT: wire::Schema = wire::Schema::Dyn;

/// `getFileExt` over the binary wire.
#[wasm_bindgen(js_name = "getFileExtWire")]
pub fn get_file_ext_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let out = &port::get_file_ext(name)?;
        wire::write_value(w, out, &S_GET_FILE_EXT_OUT)?;
        Ok(())
    })
}

static S_IS_ACCEPTED_EXT_OUT: wire::Schema = wire::Schema::Dyn;

/// `isAcceptedExt` over the binary wire.
#[wasm_bindgen(js_name = "isAcceptedExtWire")]
pub fn is_accepted_ext_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let out = &port::is_accepted_ext(name)?;
        wire::write_value(w, out, &S_IS_ACCEPTED_EXT_OUT)?;
        Ok(())
    })
}

static S_GET_UPLOAD_PURPOSE_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Str16);

/// `getUploadPurpose` over the binary wire.
#[wasm_bindgen(js_name = "getUploadPurposeWire")]
pub fn get_upload_purpose_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let is_image: bool = r.bool()?;
        let out = &port::get_upload_purpose(name, is_image)?;
        wire::write_value(w, out, &S_GET_UPLOAD_PURPOSE_OUT)?;
        Ok(())
    })
}

static S_VALIDATE_FILES_0: wire::Schema = wire::Schema::Dyn;
static S_VALIDATE_FILES_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[
    ("key", wire::Schema::Dyn),
    (
        "params",
        wire::Schema::OptJs(&wire::Schema::Map16(&wire::Schema::Dyn)),
    ),
]));

/// `validateFiles` over the binary wire.
#[wasm_bindgen(js_name = "validateFilesWire")]
pub fn validate_files_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let files: Value = wire::read_value(r, &S_VALIDATE_FILES_0)?;
        let current_count: f64 = r.f64()?;
        let out = &port::validate_files(files, current_count)?;
        wire::write_value(w, out, &S_VALIDATE_FILES_OUT)?;
        Ok(())
    })
}

static S_RESOLVE_MIME_TYPE_0: wire::Schema = wire::Schema::Dyn;
static S_RESOLVE_MIME_TYPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `resolveMimeType` over the binary wire.
#[wasm_bindgen(js_name = "resolveMimeTypeWire")]
pub fn resolve_mime_type_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let file: Value = wire::read_value(r, &S_RESOLVE_MIME_TYPE_0)?;
        let out = &port::resolve_mime_type(file)?;
        wire::write_value(w, out, &S_RESOLVE_MIME_TYPE_OUT)?;
        Ok(())
    })
}

static S_IS_IMAGE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isImage` over the binary wire.
#[wasm_bindgen(js_name = "isImageWire")]
pub fn is_image_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let mime_type: String = r.string16()?;
        let out = &port::is_image(mime_type)?;
        wire::write_value(w, out, &S_IS_IMAGE_OUT)?;
        Ok(())
    })
}

static S_GET_EXTENSION_OUT: wire::Schema = wire::Schema::Dyn;

/// `getExtension` over the binary wire.
#[wasm_bindgen(js_name = "getExtensionWire")]
pub fn get_extension_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let name: String = r.string16()?;
        let out = &port::get_extension(name)?;
        wire::write_value(w, out, &S_GET_EXTENSION_OUT)?;
        Ok(())
    })
}

static S_FORMAT_SIZE_OUT: wire::Schema = wire::Schema::Dyn;

/// `formatSize` over the binary wire.
#[wasm_bindgen(js_name = "formatSizeWire")]
pub fn format_size_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let bytes: f64 = r.f64()?;
        let out = &port::format_size(bytes)?;
        wire::write_value(w, out, &S_FORMAT_SIZE_OUT)?;
        Ok(())
    })
}
