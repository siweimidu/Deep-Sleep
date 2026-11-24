//! The Rust port of `parseArchiveBase64` (`src/services/chat/history/zipReader.ts`).
//!
//! The TypeScript reader exposes only `File`/`ByteSource`/generator/class entry points, so the
//! byte-level core it shares — `readDirectory`, `decodePath`, `checkExtra`, `readEntryOffset`,
//! `readEntryBytes` — is private. The source file gained one additive seam,
//! `parseArchiveBase64(base64: string): Promise<ParsedArchive>`, that feeds those helpers bytes and
//! returns their result as JSON; this is that seam with the same accept/reject set and the same
//! single `ArchiveError` message.
//!
//! Two things collapse because the seam's source is an in-memory buffer rather than a `Blob`:
//! `createReader`'s 1 MiB re-read batching becomes a plain slice (its only observable effect, the
//! `start + length > size` guard, is kept), and the chunked entry reads become one read.

use std::collections::HashSet;
use std::io::Read as _;

use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;

/// `ArchiveError`'s one and only message: every rejection in the source throws this.
const INVALID: &str = "Invalid or unsupported history archive";

/// Every source-level throw is `Err` with that message.
type Fail = String;

const END_OF_CENTRAL_DIRECTORY: u32 = 0x0605_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const LOCAL_HEADER: u32 = 0x0403_4b50;
const DATA_DESCRIPTOR: u32 = 0x0807_4b50;

/// `flags & ~0x80e`: only deflate options, the data descriptor and the UTF-8 flag are allowed.
const ALLOWED_FLAGS: u16 = !0x080e;

fn invalid<T>() -> Result<T, Fail> {
    Err(INVALID.to_string())
}

/// A bounds-checked view of one window, mirroring `DataView`: a short window is a rejection, never a
/// panic. Every call site reads a window it has already proven present, so this only fires on the
/// paths the source guards explicitly.
fn slice_of(bytes: &[u8], at: u64, width: u64) -> Result<&[u8], Fail> {
    let end = at.checked_add(width).ok_or_else(|| INVALID.to_string())?;
    if end > bytes.len() as u64 {
        return invalid();
    }
    Ok(&bytes[at as usize..end as usize])
}

fn array<const N: usize>(bytes: &[u8], at: u64) -> Result<[u8; N], Fail> {
    let window: [u8; N] = slice_of(bytes, at, N as u64)?
        .try_into()
        .map_err(|_| INVALID.to_string())?;
    Ok(window)
}

fn le16(bytes: &[u8], at: u64) -> Result<u16, Fail> {
    Ok(u16::from_le_bytes(array::<2>(bytes, at)?))
}

fn le32(bytes: &[u8], at: u64) -> Result<u32, Fail> {
    Ok(u32::from_le_bytes(array::<4>(bytes, at)?))
}

/// CRC-32/ISO-HDLC, the algorithm `crc32` in the source implements.
const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut index = 0;
    while index < 256 {
        let mut value = index as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 != 0 {
                0xedb8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
};

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        let slot = ((crc ^ u32::from(*byte)) & 0xff) as usize;
        crc = CRC_TABLE[slot] ^ (crc >> 8);
    }
    crc ^ 0xffff_ffff
}

/// One central-directory record, as `Entry` in the source.
struct Entry {
    path: String,
    name: Vec<u8>,
    flags: u16,
    method: u16,
    crc: u32,
    compressed_size: u32,
    size: u32,
    offset: u32,
}

/// `decodePath`: ASCII-only without the UTF-8 flag, strict UTF-8, NFC, then the path rules.
fn decode_path(name: &[u8], flags: u16) -> Result<String, Fail> {
    if flags & 0x0800 == 0 && name.iter().any(|byte| *byte > 0x7f) {
        return invalid();
    }
    let decoded = std::str::from_utf8(name).map_err(|_| INVALID.to_string())?;
    // `new TextDecoder('utf-8')` drops a leading BOM unless `ignoreBOM` is set.
    let decoded = decoded.strip_prefix('\u{feff}').unwrap_or(decoded);
    let path = decoded.nfc().collect::<String>();
    if path.is_empty() || path.contains('\\') || path.contains('\0') || has_drive_prefix(&path) {
        return invalid();
    }
    let body = path.strip_suffix('/').unwrap_or(&path);
    if body
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return invalid();
    }
    Ok(path)
}

/// `/^[A-Za-z]:/`: exactly one ASCII letter followed by a colon.
fn has_drive_prefix(path: &str) -> bool {
    let mut chars = path.chars();
    let first = chars.next();
    let second = chars.next();
    matches!(first, Some(letter) if letter.is_ascii_alphabetic()) && second == Some(':')
}

/// `checkExtra`: every field must be well formed, and zip64 (id 1) is refused.
fn check_extra(bytes: &[u8]) -> Result<(), Fail> {
    let length = bytes.len() as u64;
    let mut offset = 0;
    while offset < length {
        if offset + 4 > length || le16(bytes, offset)? == 1 {
            return invalid();
        }
        offset += 4 + u64::from(le16(bytes, offset + 2)?);
        if offset > length {
            return invalid();
        }
    }
    Ok(())
}

/// `readDirectory`: find the end-of-central-directory record, then read every entry.
fn read_directory(data: &[u8]) -> Result<(u64, Vec<Entry>), Fail> {
    let file_size = data.len() as u64;
    if file_size < 22 {
        return invalid();
    }
    let tail_start = file_size.saturating_sub(22 + 0xffff);
    let tail = slice_of(data, tail_start, file_size - tail_start)?;
    let tail_length = tail.len() as u64;
    let mut end = tail_length as i64 - 22;
    while end >= 0 {
        let at = end as u64;
        if le32(tail, at)? == END_OF_CENTRAL_DIRECTORY
            && at + 22 + u64::from(le16(tail, at + 20)?) == tail_length
        {
            break;
        }
        end -= 1;
    }
    if end < 0 {
        return invalid();
    }
    let at = end as u64;
    let count = le16(tail, at + 10)?;
    let size = u64::from(le32(tail, at + 12)?);
    let offset = u64::from(le32(tail, at + 16)?);
    if le16(tail, at + 4)? != 0
        || le16(tail, at + 6)? != 0
        || le16(tail, at + 8)? != count
        || count == 0xffff
        || size == 0xffff_ffff
        || offset == 0xffff_ffff
        || offset + size != tail_start + at
    {
        return invalid();
    }

    let mut entries: Vec<Entry> = Vec::new();
    let mut identities: HashSet<String> = HashSet::new();
    let mut cursor: u64 = 0;
    for _ in 0..count {
        if cursor + 46 > size {
            return invalid();
        }
        let head = slice_of(data, offset + cursor, 46)?;
        if le32(head, 0)? != CENTRAL_HEADER {
            return invalid();
        }
        let flags = le16(head, 8)?;
        let method = le16(head, 10)?;
        let compressed_size = le32(head, 20)?;
        let entry_size = le32(head, 24)?;
        let name_length = u64::from(le16(head, 28)?);
        let extra_length = u64::from(le16(head, 30)?);
        let next = cursor + 46 + name_length + extra_length + u64::from(le16(head, 32)?);
        let entry_offset = le32(head, 42)?;
        if flags & ALLOWED_FLAGS != 0
            || (method != 0 && method != 8)
            || compressed_size == 0xffff_ffff
            || entry_size == 0xffff_ffff
            || (method == 0 && compressed_size != entry_size)
            || u64::from(entry_offset) >= offset
            || le16(head, 34)? != 0
            || (le32(head, 38)? >> 16) & 0xf000 == 0xa000
            || next > size
        {
            return invalid();
        }
        let name = slice_of(data, offset + cursor + 46, name_length)?.to_vec();
        let path = decode_path(&name, flags)?;
        // A directory record names the same identity as the file it shadows.
        let identity = path.strip_suffix('/').unwrap_or(&path).to_string();
        let duplicate = !identities.insert(identity);
        let directory_with_payload = path.ends_with('/') && entry_size != 0;
        if duplicate || directory_with_payload {
            return invalid();
        }
        check_extra(slice_of(
            data,
            offset + cursor + 46 + name_length,
            extra_length,
        )?)?;
        entries.push(Entry {
            path,
            name,
            flags,
            method,
            crc: le32(head, 16)?,
            compressed_size,
            size: entry_size,
            offset: entry_offset,
        });
        cursor = next;
    }
    if cursor != size {
        return invalid();
    }
    entries.sort_by_key(|entry| entry.offset);
    Ok((offset, entries))
}

/// `readEntryOffset`: check the local header against the central record and return the payload
/// offset.
fn read_entry_offset(data: &[u8], entry: &Entry, boundary: u64) -> Result<u64, Fail> {
    let entry_offset = u64::from(entry.offset);
    if entry_offset + 30 > boundary {
        return invalid();
    }
    let head = slice_of(data, entry_offset, 30)?;
    let name_length = u64::from(le16(head, 26)?);
    let extra_length = u64::from(le16(head, 28)?);
    let start = entry_offset + 30 + name_length + extra_length;
    let end = start + u64::from(entry.compressed_size);
    if le32(head, 0)? != LOCAL_HEADER
        || le16(head, 6)? != entry.flags
        || le16(head, 8)? != entry.method
        || name_length != entry.name.len() as u64
        || end > boundary
    {
        return invalid();
    }
    // The data descriptor (flag 8) is allowed to zero these in the local header.
    for (at, expected) in [
        (14, entry.crc),
        (18, entry.compressed_size),
        (22, entry.size),
    ] {
        let actual = le32(head, at)?;
        if actual != expected && (entry.flags & 8 == 0 || actual != 0) {
            return invalid();
        }
    }
    let metadata = slice_of(data, entry_offset + 30, name_length + extra_length)?;
    if entry
        .name
        .iter()
        .zip(metadata.iter())
        .any(|(actual, expected)| actual != expected)
    {
        return invalid();
    }
    check_extra(slice_of(metadata, name_length, extra_length)?)?;
    if entry.flags & 8 != 0 {
        if end + 12 > boundary {
            return invalid();
        }
        let descriptor = slice_of(data, end, (boundary - end).min(16))?;
        let shift = if le32(descriptor, 0)? == DATA_DESCRIPTOR {
            4
        } else {
            0
        };
        if shift + 12 > descriptor.len() as u64
            || le32(descriptor, shift)? != entry.crc
            || le32(descriptor, shift + 4)? != entry.compressed_size
            || le32(descriptor, shift + 8)? != entry.size
        {
            return invalid();
        }
    }
    Ok(start)
}

fn append(output: &mut [u8], written: &mut usize, chunk: &[u8]) -> Result<(), Fail> {
    let end = written
        .checked_add(chunk.len())
        .ok_or_else(|| INVALID.to_string())?;
    if end > output.len() {
        return invalid();
    }
    output[*written..end].copy_from_slice(chunk);
    *written = end;
    Ok(())
}

/// `readEntryBytes`: store is a copy, deflate is inflated, and both end with a size and CRC check.
///
/// The one place this cannot match the source: fflate reports a *corrupt* deflate stream with its
/// own message (`unexpected EOF`, `invalid deflate data`, ...), which has no portable equivalent, so
/// a bad stream is reported as `ArchiveError` here. Valid streams decode identically.
fn read_entry_bytes(data: &[u8], entry: &Entry, start: u64) -> Result<Vec<u8>, Fail> {
    let mut output = vec![0u8; entry.size as usize];
    let mut written = 0;
    if entry.method == 0 {
        // A stored entry has `compressed_size == size`, which the directory already enforced, so the
        // source's 1 MiB chunking cannot overflow here.
        append(
            &mut output,
            &mut written,
            slice_of(data, start, u64::from(entry.compressed_size))?,
        )?;
    } else {
        let compressed = slice_of(data, start, u64::from(entry.compressed_size))?;
        // fflate treats an empty input as a finished stream (`inflateSync(new Uint8Array())` is
        // `[]`), where a zlib-style decoder reports a truncated stream instead.
        let mut inflated = Vec::new();
        if !compressed.is_empty() {
            flate2::read::DeflateDecoder::new(compressed)
                .read_to_end(&mut inflated)
                .map_err(|_| INVALID.to_string())?;
        }
        if !inflated.is_empty() {
            append(&mut output, &mut written, &inflated)?;
        }
    }
    if written != entry.size as usize || crc32(&output) != entry.crc {
        return invalid();
    }
    Ok(output)
}

fn alphabet_value(byte: u8) -> u32 {
    match byte {
        b'A'..=b'Z' => u32::from(byte - b'A'),
        b'a'..=b'z' => u32::from(byte - b'a') + 26,
        b'0'..=b'9' => u32::from(byte - b'0') + 52,
        b'+' => 62,
        _ => 63,
    }
}

/// The seam takes base64 because the recording wire has no bytes type. It accepts canonical base64
/// only — the TypeScript side rejects anything else before `atob` sees it — so this is the same gate.
fn decode_base64(text: &str) -> Result<Vec<u8>, Fail> {
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return invalid();
    }
    let padding = if bytes.ends_with(b"==") {
        2
    } else if bytes.ends_with(b"=") {
        1
    } else {
        0
    };
    let body = &bytes[..bytes.len() - padding];
    if body
        .iter()
        .any(|byte| !matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/'))
    {
        return invalid();
    }
    let mut output = Vec::with_capacity(body.len() / 4 * 3 + 2);
    let mut accumulator: u32 = 0;
    let mut pending: u32 = 0;
    for byte in body {
        accumulator = (accumulator << 6) | alphabet_value(*byte);
        pending += 6;
        if pending >= 8 {
            pending -= 8;
            output.push((accumulator >> pending) as u8);
            accumulator &= (1u32 << pending) - 1;
        }
    }
    Ok(output)
}

/// Reads the archive the way `readArchive` does, plus each entry's bytes, and reports the fields the
/// recording wire can carry.
fn parse(data: &[u8]) -> Result<Value, Fail> {
    let (offset, entries) = read_directory(data)?;
    let mut parsed: Vec<Value> = Vec::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        if entry.path.ends_with('/') {
            continue;
        }
        let boundary = entries
            .get(index + 1)
            .map_or(offset, |next| u64::from(next.offset));
        let start = read_entry_offset(data, entry, boundary)?;
        read_entry_bytes(data, entry, start)?;
        parsed.push(json!({
            "path": entry.path,
            "size": entry.size,
            "flags": entry.flags,
            "method": entry.method,
            "crc": entry.crc,
            "compressedSize": entry.compressed_size,
            "offset": entry.offset,
            "start": start,
        }));
    }
    Ok(json!({ "offset": offset, "entries": parsed }))
}

/// Port of `parseArchiveBase64` (`src/services/chat/history/zipReader.ts`).
pub async fn parse_archive_base64(base64: String) -> Result<Value, Fail> {
    parse(&decode_base64(&base64)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_gate_matches_the_typescript_regex() {
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_base64("YQ==").unwrap(), b"a");
        assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
        assert_eq!(decode_base64("ab==").unwrap(), b"i");
        for rejected in ["a", "YQ", "YW Jj", "YQ===", "hello!", "YQ==\n", "YQ--"] {
            assert_eq!(
                decode_base64(rejected),
                Err(INVALID.to_string()),
                "accepted {rejected}"
            );
        }
    }

    #[test]
    fn crc32_matches_the_reference_vectors() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(crc32(b"a"), 0xe8b7_be43);
    }

    #[test]
    fn drive_prefix_is_one_letter_then_colon() {
        assert!(has_drive_prefix("C:/a.json"));
        assert!(has_drive_prefix("a:b"));
        assert!(!has_drive_prefix("AB:/x"));
        assert!(!has_drive_prefix(""));
        assert!(!has_drive_prefix("C"));
    }

    #[test]
    fn short_windows_are_rejections_not_panics() {
        assert_eq!(le32(b"abc", 0), Err(INVALID.to_string()));
        assert_eq!(le16(b"", 0), Err(INVALID.to_string()));
        assert_eq!(slice_of(b"abc", u64::MAX, 2), Err(INVALID.to_string()));
    }

    /// `ok store: single entry` from the recorded corpus: one stored `manifest.json`.
    const ONE_ENTRY: &str = "UEsDBBQAAAAAAAAAIQAfyGIjGwAAABsAAAANAAAAbWFuaWZlc3QuanNvbnsiZXhwb3J0X2Zvcm1hdF92ZXJzaW9uIjozfVBLAQIUABQAAAAAAAAAIQAfyGIjGwAAABsAAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsFBgAAAAABAAEAOwAAAEYAAAAAAA==";

    #[test]
    fn a_stored_entry_round_trips() {
        let value = parse(&decode_base64(ONE_ENTRY).unwrap()).unwrap();
        assert_eq!(value["offset"], 70);
        assert_eq!(value["entries"][0]["path"], "manifest.json");
        assert_eq!(value["entries"][0]["start"], 43);
    }

    #[test]
    fn a_stored_entry_with_a_corrupt_payload_is_rejected() {
        let mut data = decode_base64(ONE_ENTRY).unwrap();
        data[36] ^= 0xff; // the first payload byte, right after the 30-byte header and the 6-byte name
        assert_eq!(parse(&data), Err(INVALID.to_string()));
    }

    #[test]
    fn an_empty_archive_is_a_directory_of_no_entries() {
        let value = parse(&decode_base64("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==").unwrap()).unwrap();
        assert_eq!(value["offset"], 0);
        assert_eq!(value["entries"], json!([]));
    }

    #[test]
    fn a_deflate_entry_with_no_compressed_bytes_is_empty_not_truncated() {
        // `ok deflate: zero compressed size`: method 8 with `compressed_size == size == 0`.
        let value = parse(
            &decode_base64("UEsDBBQAAAAIAAAAIQAAAAAAAAAAAAAAAAAGAAAAYS5qc29uUEsBAhQAFAAAAAgAAAAhAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAGEuanNvblBLBQYAAAAAAQABADQAAAAkAAAAAAA=").unwrap(),
        )
        .unwrap();
        assert_eq!(value["entries"][0]["method"], 8);
        assert_eq!(value["entries"][0]["start"], 36);
    }

    #[test]
    fn a_truncated_archive_is_rejected() {
        let data = decode_base64(ONE_ENTRY).unwrap();
        assert_eq!(parse(&data[..data.len() - 1]), Err(INVALID.to_string()));
        assert_eq!(parse(&[]), Err(INVALID.to_string()));
    }
}
