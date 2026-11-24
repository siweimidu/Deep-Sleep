//! JS bindings for `src/services/chat/history/zipWriter.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod utf16;

/// `writeArchive`.
async fn write_archive_inner(entries: String) -> Result<String, String> {
    let entries = crate::js::from_json(&entries)?;
    let out = port::write_archive(entries).await?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "writeArchive")]
pub async fn write_archive(entries: String) -> Result<String, JsError> {
    write_archive_inner(entries)
        .await
        .map_err(|e| JsError::new(&e))
}
