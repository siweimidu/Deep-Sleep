//! The Rust port of `src/services/chat/history/zipWriter.ts`.
//!
//! `writeArchive` serialises the export archive as a single-volume ZIP32 STORE stream and returns it
//! as a `Blob`. Both edges are Blobs, so the recording wire carries neither the entry payloads nor
//! the produced bytes. What is portable — and what this port is — is the conformance layer the
//! writer enforces before it writes anything: the entry-name rules the reader shares, uniqueness of
//! names, and the ZIP32 count/size sentinels that would require ZIP64. The empty archive is the one
//! call whose result the wire can observe (a `Blob` encodes as the opaque object `{}`).
//!
//! Stays in TypeScript/JavaScript: the STORE stream itself (`fflate`'s `Zip` / `ZipPassThrough`,
//! the chunks, the fixed 1980-01-01 mtime). `writeArchive` needs `blob.stream()`, which a `Blob`
//! cannot deliver over the wire: every non-empty archive fails there with the message below, and
//! the port fails at the same point.

#![forbid(unsafe_code)]

use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;

use crate::js;

/// `ZIP64_SIZE`: the ZIP32 size field value that means "read a ZIP64 field".
const ZIP64_SIZE: f64 = 4_294_967_295.0;

/// `ZIP64_COUNT`: the ZIP32 entry-count value that means "read a ZIP64 field".
const ZIP64_COUNT: f64 = 65_535.0;

/// `invalid()` and `ArchiveLimitError`, which the source throws as errors with these messages.
const INVALID_ENTRY: &str = "Invalid history archive entry";
const NEEDS_ZIP64: &str = "History archive requires unsupported ZIP64 fields";

/// `blob.stream` over a `Blob` that never crossed the wire: the source fails identically on any
/// value that is not a `Blob`.
const NO_BLOB_STREAM: &str = "blob.stream is not a function";

/// Port of `writeArchive` (`src/services/chat/history/zipWriter.ts:42`).
pub async fn write_archive(entries: Value) -> Result<Value, String> {
    prepare(entries)
}

/// A validated entry name: NFC, with the length its UTF-8 encoding takes in the ZIP headers.
struct EntryName {
    name: String,
    byte_length: usize,
}

/// The validation half of `writeArchive`, before any Blob is opened.
fn prepare(entries: Value) -> Result<Value, String> {
    // `if (entries.length >= ZIP64_COUNT) throw new ArchiveLimitError()`.
    if length_of(&entries)? >= ZIP64_COUNT {
        return Err(NEEDS_ZIP64.into());
    }
    // `entries.map(...)`: only an array has a `map`.
    let Some(items) = entries.as_array() else {
        return Err("entries.map is not a function".into());
    };
    let mut names: Vec<String> = Vec::with_capacity(items.len());
    let mut data_size = 0.0_f64;
    let mut directory_size = 0.0_f64;
    for item in items {
        let (name, blob) = split_entry(item)?;
        let entry = entry_name(&name)?;
        if names.contains(&entry.name) {
            return Err(INVALID_ENTRY.into());
        }
        let size = blob_size(&blob)?;
        if size >= ZIP64_SIZE {
            return Err(NEEDS_ZIP64.into());
        }
        // f64 mirrors a JS number, `NaN` included: a size that is not a number makes both totals
        // unordered, so every `>=` below is false, exactly as in the source. The one divergence is
        // JS `+` concatenating when `blob.size` is a string or an object — `typeof Blob.size` is
        // always a number, so only a forged entry can reach it, and then only the thrown message
        // differs (both sides throw).
        let record = 46.0 + entry.byte_length as f64;
        data_size += size + record;
        directory_size += record;
        if data_size >= ZIP64_SIZE || directory_size >= ZIP64_SIZE {
            return Err(NEEDS_ZIP64.into());
        }
        names.push(entry.name);
    }
    if !items.is_empty() {
        return Err(NO_BLOB_STREAM.into());
    }
    Ok(json!({}))
}

/// `entries.length`: a string counts UTF-16 code units, an object reads its own `length` property,
/// and a number or a boolean has none.
fn length_of(value: &Value) -> Result<f64, String> {
    if js::is_undefined(value) {
        return Err("Cannot read properties of undefined (reading 'length')".into());
    }
    if value.is_null() {
        return Err("Cannot read properties of null (reading 'length')".into());
    }
    if let Some(units) = js::string_units(value) {
        return Ok(units.len() as f64);
    }
    if let Some(items) = value.as_array() {
        return Ok(items.len() as f64);
    }
    match value.as_object() {
        Some(fields) => Ok(fields.get("length").map_or(f64::NAN, number_of)),
        None => Ok(f64::NAN),
    }
}

/// `entries.map(({ name, blob }) => ...)`: the two properties of one entry, `undefined` when the
/// entry does not carry them.
fn split_entry(item: &Value) -> Result<(Value, Value), String> {
    if item.is_null() {
        return Err("Cannot destructure property 'name' of 'object null' as it is null.".into());
    }
    if js::is_undefined(item) {
        return Err("Cannot destructure property 'name' of 'undefined' as it is undefined.".into());
    }
    let field = |key: &str| {
        item.as_object()
            .and_then(|fields| fields.get(key))
            .cloned()
            .unwrap_or_else(js::undefined)
    };
    Ok((field("name"), field("blob")))
}

/// `entryName`: the path rules the reader shares, so an exported archive can be imported again.
fn entry_name(name: &Value) -> Result<EntryName, String> {
    let Some(units) = js::string_units(name) else {
        if js::is_undefined(name) {
            return Err("Cannot read properties of undefined (reading 'normalize')".into());
        }
        if name.is_null() {
            return Err("Cannot read properties of null (reading 'normalize')".into());
        }
        return Err("name.normalize is not a function".into());
    };
    // `String.prototype.normalize` keeps an unpaired surrogate; `TextEncoder` then replaces it with
    // U+FFFD, which the round-trip check below rejects. Decoding lossily is that same substitution,
    // and U+FFFD has combining class 0, so it blocks composition exactly as the surrogate would.
    let decoded = String::from_utf16_lossy(&units);
    let unpaired = !decoded.encode_utf16().eq(units.iter().copied());
    let normalized: String = decoded.nfc().collect();
    if normalized.is_empty()
        || normalized.contains('\\')
        || normalized.contains('\0')
        || is_drive_letter(&normalized)
        || normalized
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(INVALID_ENTRY.into());
    }
    let byte_length = normalized.len();
    if byte_length > u16::MAX as usize {
        return Err(NEEDS_ZIP64.into());
    }
    // `new TextDecoder().decode(bytes) !== normalized`: the decoder drops one leading BOM, and an
    // unpaired surrogate comes back as U+FFFD.
    if unpaired || normalized.starts_with('\u{feff}') {
        return Err(INVALID_ENTRY.into());
    }
    Ok(EntryName {
        name: normalized,
        byte_length,
    })
}

/// `/^[A-Za-z]:/`: a leading drive letter would make the entry an absolute path.
fn is_drive_letter(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic()) && chars.next() == Some(':')
}

/// `blob.size`: a primitive has no `size`, and an object without one reads `undefined`.
fn blob_size(blob: &Value) -> Result<f64, String> {
    if js::is_undefined(blob) {
        return Err("Cannot read properties of undefined (reading 'size')".into());
    }
    if blob.is_null() {
        return Err("Cannot read properties of null (reading 'size')".into());
    }
    match blob.as_object() {
        Some(fields) => Ok(fields.get("size").map_or(f64::NAN, number_of)),
        None => Ok(f64::NAN),
    }
}

/// JS `Number(value)`, for the comparisons the source makes against a ZIP32 sentinel.
fn number_of(value: &Value) -> f64 {
    if js::is_undefined(value) {
        return f64::NAN;
    }
    if let Some(number) = js::as_number(value) {
        return number;
    }
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        Value::String(text) => number_from_str(text),
        // `Number(String(array))`: empty joiner is "0", one element reads as itself, more is "a,1".
        Value::Array(items) => match items.as_slice() {
            [] => 0.0,
            [item] => number_of(item),
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

/// JS `Number(string)`: trimmed, empty is zero, and anything unparseable is `NaN`.
fn number_from_str(text: &str) -> f64 {
    let trimmed = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        _ => trimmed.parse::<f64>().unwrap_or(f64::NAN),
    }
}

#[cfg(test)]
mod tests {
    use super::{INVALID_ENTRY, NEEDS_ZIP64, NO_BLOB_STREAM, entry_name, number_from_str, prepare};
    use crate::js;
    use serde_json::{Value, json};

    fn err(entries: Value) -> Option<String> {
        prepare(entries).err()
    }

    fn name_of(name: Value) -> Result<(String, usize), String> {
        entry_name(&name).map(|entry| (entry.name, entry.byte_length))
    }

    #[test]
    fn applies_the_reader_path_rules() {
        let rejected = [
            "",
            "a\\b",
            "\\a",
            "a\u{0}b",
            "C:/a",
            "c:x",
            "a:b",
            "/a",
            "a//b",
            "a/",
            "./a",
            "a/./b",
            "a/../b",
            "..",
            ".", // a leading BOM does not survive the decode round trip
            "\u{feff}bom",
            "\u{feff}\u{feff}x",
        ];
        for name in rejected {
            assert_eq!(
                name_of(json!(name)).err(),
                Some(INVALID_ENTRY.to_string()),
                "{name:?}"
            );
        }
        // "AB:/x" is not a drive letter to the regex, and "a..b" is not a dot segment.
        let accepted = [
            "manifest.json",
            "chat_sessions/x_files/f_n.png",
            "a..b",
            "AB:/x",
            "_a:/x",
            "a b\tc",
            "a\u{feff}b",
        ];
        for name in accepted {
            assert!(name_of(json!(name)).is_ok(), "{name:?}");
        }
    }

    #[test]
    fn normalises_to_nfc() {
        assert_eq!(name_of(json!("e\u{301}")), Ok(("\u{e9}".to_string(), 2)));
        // "A" + combining ring above composes to one code point, two bytes.
        assert_eq!(name_of(json!("A\u{30a}")), Ok(("\u{c5}".to_string(), 2)));
    }

    #[test]
    fn rejects_unpaired_surrogates() {
        for units in [vec![0xd800_u16], vec![0x61, 0xdc00, 0x62]] {
            assert_eq!(
                entry_name(&js::utf16_string(&units)).err(),
                Some(INVALID_ENTRY.to_string())
            );
        }
    }

    #[test]
    fn measures_names_in_utf8_bytes() {
        assert_eq!(
            name_of(json!("a".repeat(65_535))).map(|(_, n)| n),
            Ok(65_535)
        );
        assert_eq!(
            name_of(json!("a".repeat(65_536))).err(),
            Some(NEEDS_ZIP64.to_string())
        );
        assert_eq!(
            name_of(json!("\u{e9}".repeat(32_767))).map(|(_, n)| n),
            Ok(65_534)
        );
        assert_eq!(
            name_of(json!("\u{e9}".repeat(32_768))).err(),
            Some(NEEDS_ZIP64.to_string())
        );
    }

    #[test]
    fn only_the_empty_archive_gets_through() {
        assert_eq!(prepare(json!([])), Ok(json!({})));
        assert_eq!(
            err(json!([{ "name": "a.json", "blob": { "size": 0 } }])),
            Some(NO_BLOB_STREAM.to_string())
        );
    }

    #[test]
    fn validates_every_entry_before_the_first_blob() {
        let duplicate = json!([
            { "name": "a", "blob": { "size": 0 } },
            { "name": "a", "blob": { "size": 0 } },
        ]);
        assert_eq!(err(duplicate), Some(INVALID_ENTRY.to_string()));
        // NFC makes these one name.
        let decomposed = json!([
            { "name": "\u{e9}", "blob": {} },
            { "name": "e\u{301}", "blob": {} },
        ]);
        assert_eq!(err(decomposed), Some(INVALID_ENTRY.to_string()));
        assert_eq!(
            err(json!([{ "name": "a", "blob": null }])),
            Some("Cannot read properties of null (reading 'size')".to_string())
        );
    }

    #[test]
    fn enforces_the_zip32_sentinels() {
        assert_eq!(
            err(json!({ "length": 70_000 })),
            Some(NEEDS_ZIP64.to_string())
        );
        assert_eq!(err(json!(vec![0; 65_535])), Some(NEEDS_ZIP64.to_string()));
        // A size at or above 0xffffffff needs a ZIP64 field, and so does a total that reaches it.
        for size in [4_294_967_295_u64, 4_294_967_248] {
            assert_eq!(
                err(json!([{ "name": "a", "blob": { "size": size } }])),
                Some(NEEDS_ZIP64.to_string()),
                "{size}"
            );
        }
        assert_eq!(
            err(json!([{ "name": "a", "blob": { "size": 4_294_967_200_u64 } }])),
            Some(NO_BLOB_STREAM.to_string())
        );
        let overflow = json!([
            { "name": "a", "blob": { "size": 3_000_000_000_u64 } },
            { "name": "b", "blob": { "size": 3_000_000_000_u64 } },
        ]);
        assert_eq!(err(overflow), Some(NEEDS_ZIP64.to_string()));
    }

    #[test]
    fn reads_non_array_arguments_like_the_source() {
        assert_eq!(
            err(json!(null)),
            Some("Cannot read properties of null (reading 'length')".to_string())
        );
        assert_eq!(
            err(js::undefined()),
            Some("Cannot read properties of undefined (reading 'length')".to_string())
        );
        for argument in [json!("abc"), json!(42), json!(true), json!({})] {
            assert_eq!(
                err(argument),
                Some("entries.map is not a function".to_string())
            );
        }
        assert_eq!(
            err(json!([null])),
            Some("Cannot destructure property 'name' of 'object null' as it is null.".to_string())
        );
        assert_eq!(
            err(json!([1])),
            Some("Cannot read properties of undefined (reading 'normalize')".to_string())
        );
    }

    #[test]
    fn converts_numbers_like_javascript() {
        assert_eq!(number_from_str("5"), 5.0);
        assert_eq!(number_from_str(" 7 "), 7.0);
        assert_eq!(number_from_str(""), 0.0);
        assert_eq!(number_from_str("-2.5"), -2.5);
        assert!(number_from_str("abc").is_nan());
        assert_eq!(super::number_of(&json!([5])), 5.0);
        assert_eq!(super::number_of(&json!([])), 0.0);
        assert!(super::number_of(&json!([1, 2])).is_nan());
    }
}
