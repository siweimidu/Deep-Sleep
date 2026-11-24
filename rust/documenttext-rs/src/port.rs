//! The Rust port of `src/services/documentText.ts`.
//!
//! `extractDocumentText` stays in TypeScript: it takes a browser `File` and needs `fflate`'s
//! `unzipSync`/`decompressSync` plus `TextDecoder`, and a `File`'s bytes never cross the JSON
//! wire, so nothing about its body could be machine-verified.

#![forbid(unsafe_code)]

/// The text after the last `.`, or the whole string when there is none.
///
/// `name.split('.').pop() ?? ''` always yields the last segment: `'a.b.c'` → `'c'`, `'a.'` → `''`,
/// `''` → `''`.
fn last_segment(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((_, tail)) => tail,
        None => name,
    }
}

/// `String.prototype.toLowerCase`.
fn js_to_lower(text: &str) -> String {
    text.to_lowercase()
}

/// Port of `extensionOf` (`src/services/documentText.ts:12`).
pub fn extension_of(name: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::Value::String(js_to_lower(last_segment(&name))))
}

/// Port of `canExtractText` (`src/services/documentText.ts:14`).
pub fn can_extract_text(name: String) -> Result<serde_json::Value, String> {
    let ext = js_to_lower(last_segment(&name));
    Ok(serde_json::Value::Bool(matches!(
        ext.as_str(),
        "docx" | "xlsx" | "pptx" | "pdf"
    )))
}
