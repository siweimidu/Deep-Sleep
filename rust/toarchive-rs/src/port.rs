//! The Rust port of `src/services/chat/history/toArchive.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `toIndexEntry` (`src/services/chat/history/toArchive.ts:271`).
pub fn to_index_entry(file: serde_json::Value) -> Result<serde_json::Value, String> {
    let _ = &file;
    unimplemented!("port `toIndexEntry` from src/services/chat/history/toArchive.ts")
}
