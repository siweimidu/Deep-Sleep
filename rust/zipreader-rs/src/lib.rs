//! JS bindings for `src/services/chat/history/zipReader.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod utf16;

/// `parseArchiveBase64`.
async fn parse_archive_base64_inner(base64: String) -> Result<String, String> {
    let out = port::parse_archive_base64(base64).await?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "parseArchiveBase64")]
pub async fn parse_archive_base64(base64: String) -> Result<String, JsError> {
    parse_archive_base64_inner(base64)
        .await
        .map_err(|e| JsError::new(&e))
}
