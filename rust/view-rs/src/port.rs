//! The Rust port of `src/services/chat/view.ts`.
//!
//! Turns a reply's content blocks into what the interface shows: the thinking and tool timeline,
//! the answer with citation markers, and the numbered source list. Pure computation — the blocks
//! themselves travel back to the server untouched.
//!
//! Two things needed care:
//!
//! * `undefined` and `null` are different on the wire, so optional inputs stay
//!   `serde_json::Value` (an omitted argument arrives as the `{"$undefined":true}` marker).
//! * `getAreaTitle` calls `translate()`, which reads the locale from the settings store. There is
//!   no store here, so the zh-CN wording is embedded; the English wording needs the i18n unit
//!   ported with an explicit locale argument.

#![forbid(unsafe_code)]

use serde_json::{Value, json};

use crate::js;

// ---------------------------------------------------------------------------------------------
// JS value helpers
// ---------------------------------------------------------------------------------------------

fn undefined() -> Value {
    js::undefined()
}

fn reading_error(base: &str, name: &str) -> String {
    format!("Cannot read properties of {base} (reading '{name}')")
}

fn is_undefined(value: &Value) -> bool {
    js::is_undefined(value)
}

/// `value === null || value === undefined`, i.e. what `??` and `?.` react to.
fn is_nullish(value: &Value) -> bool {
    value.is_null() || is_undefined(value)
}

/// `value[name]`, with V8's TypeError for a null/undefined base.
fn member(value: &Value, name: &str) -> Result<Value, String> {
    if value.is_null() {
        return Err(reading_error("null", name));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", name));
    }
    Ok(match value {
        Value::Object(map) => map.get(name).cloned().unwrap_or_else(undefined),
        Value::Array(items) => match name {
            "length" => json!(items.len()),
            _ => match name.parse::<usize>() {
                Ok(index) => items.get(index).cloned().unwrap_or_else(undefined),
                Err(_) => undefined(),
            },
        },
        Value::String(text) => match name {
            "length" => json!(crate::utf16::units(text).len()),
            _ => match name.parse::<usize>() {
                Ok(index) => crate::utf16::units(text)
                    .get(index)
                    .map(|unit| js::utf16_string(&[*unit]))
                    .unwrap_or_else(undefined),
                Err(_) => undefined(),
            },
        },
        _ => undefined(),
    })
}

/// `value?.[name]`: the short-circuit form, so a nullish base is `undefined` rather than a throw.
fn opt_member(value: &Value, name: &str) -> Result<Value, String> {
    if is_nullish(value) {
        return Ok(undefined());
    }
    member(value, name)
}

fn as_text(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) => Some(text),
        _ => None,
    }
}

/// JS `===` against a string literal.
fn is_text(value: &Value, expected: &str) -> bool {
    as_text(value) == Some(expected)
}

/// JS truthiness, including the wire markers for `undefined` and `NaN`.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) => true,
        value => match js::as_number(value) {
            Some(number) => number != 0.0 && !number.is_nan(),
            None => !is_undefined(value),
        },
    }
}

/// `String(value)`.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(flag) => flag.to_string(),
        Value::String(text) => text.clone(),
        Value::Number(number) => js::number_to_string(number.as_f64().unwrap_or(f64::NAN)),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if is_nullish(item) {
                    String::new()
                } else {
                    js_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(map) => {
            if map.contains_key("$undefined") {
                "undefined".into()
            } else if map.contains_key("$num") {
                js::number_to_string(js::as_number(value).unwrap_or(f64::NAN))
            } else if let Some(text) = map.get("$bigint").and_then(Value::as_str) {
                text.to_string()
            } else if map.contains_key("$map") {
                "[object Map]".into()
            } else if map.contains_key("$set") {
                "[object Set]".into()
            } else {
                "[object Object]".into()
            }
        }
    }
}

fn is_js_space(c: char) -> bool {
    matches!(c,
        '\u{0009}'..='\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}')
}

/// `expr.trim()`; `expression` is the source text V8 names in its TypeError.
fn trim(value: &Value, expression: &str) -> Result<String, String> {
    if value.is_null() {
        return Err(reading_error("null", "trim"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "trim"));
    }
    match as_text(value) {
        Some(text) => Ok(text.trim_matches(is_js_space).to_string()),
        None => Err(format!("{expression}.trim is not a function")),
    }
}

/// JS `+`: numeric addition for two numbers, string concatenation otherwise.
fn js_add(left: &Value, right: &Value) -> Value {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => {
            json!(a.as_f64().unwrap_or(f64::NAN) + b.as_f64().unwrap_or(f64::NAN))
        }
        _ => Value::String(format!("{}{}", js_string(left), js_string(right))),
    }
}

/// `Number(value)`.
fn to_number(value: &Value) -> f64 {
    match value {
        Value::Null => 0.0,
        Value::Bool(flag) => {
            if *flag {
                1.0
            } else {
                0.0
            }
        }
        Value::Number(number) => number.as_f64().unwrap_or(f64::NAN),
        Value::String(text) => parse_number(text),
        Value::Array(_) => parse_number(&js_string(value)),
        value => js::as_number(value).unwrap_or(f64::NAN),
    }
}

/// `Number(string)`: trimmed, empty is 0, hex and Infinity accepted, anything else NaN.
fn parse_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(is_js_space);
    if trimmed.is_empty() {
        return 0.0;
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    let unsigned = match trimmed.as_bytes().first() {
        Some(b'+') | Some(b'-') => &trimmed[1..],
        _ => trimmed,
    };
    let hex = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"));
    if let Some(digits) = hex {
        return match u64::from_str_radix(digits, 16) {
            Ok(number) => {
                if trimmed.starts_with('-') {
                    -(number as f64)
                } else {
                    number as f64
                }
            }
            Err(_) => f64::NAN,
        };
    }
    // Rust's parser accepts a superset (`inf`, `NaN`), so the shape is checked first.
    let shaped = !trimmed.eq_ignore_ascii_case("inf")
        && !trimmed.eq_ignore_ascii_case("nan")
        && !trimmed.eq_ignore_ascii_case("infinity")
        && !trimmed.contains('_');
    match trimmed.parse::<f64>() {
        Ok(number) if shaped => number,
        _ => f64::NAN,
    }
}

/// `for (const item of value)`.
fn iterate(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    match value {
        Value::Array(items) => Ok(items.clone()),
        Value::String(text) => Ok(text.chars().map(|c| Value::String(c.to_string())).collect()),
        Value::Object(map) if map.contains_key("$set") => Ok(map
            .get("$set")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()),
        _ => Err(format!("{expression} is not iterable")),
    }
}

/// `expr.flatMap(…)`: the receiver must be an array, otherwise V8 fails on the call itself.
fn flat_map_source(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    if value.is_null() {
        return Err(reading_error("null", "flatMap"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "flatMap"));
    }
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("{expression}.flatMap is not a function")),
    }
}

/// `expr.some(…)`: same receiver rule.
fn some_source(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    if value.is_null() {
        return Err(reading_error("null", "some"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "some"));
    }
    match value {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(format!("{expression}.some is not a function")),
    }
}

/// `expr.at(-1)`.
fn at_last(value: &Value, expression: &str) -> Result<Value, String> {
    if value.is_null() {
        return Err(reading_error("null", "at"));
    }
    if is_undefined(value) {
        return Err(reading_error("undefined", "at"));
    }
    match value {
        Value::Array(items) => Ok(items.last().cloned().unwrap_or_else(undefined)),
        Value::String(text) => Ok(crate::utf16::units(text)
            .last()
            .map(|unit| js::utf16_string(&[*unit]))
            .unwrap_or_else(undefined)),
        _ => Err(format!("{expression}.at is not a function")),
    }
}

/// `expr.some((item) => item.status === 'wip')` over an already built step list.
fn any_status_is(items: &Value, expression: &str, status: &str) -> Result<bool, String> {
    for item in some_source(items, expression)? {
        if is_text(&member(&item, "status")?, status) {
            return Ok(true);
        }
    }
    Ok(false)
}

// ---------------------------------------------------------------------------------------------
// getSiteName
// ---------------------------------------------------------------------------------------------

/// Port of `getSiteName` (`src/services/chat/view.ts:81`).
///
/// `new URL(url).hostname` minus a leading `www.`, and `''` when the input does not parse. The
/// parser covers what can reach a hostname: scheme detection, the slash tolerance of the special
/// schemes, userinfo and port stripping, lowercasing, and punycode for non-ASCII labels. It does
/// not do IPv4 shorthand (`0x7f.1`) or UTS46 normalisation.
pub fn get_site_name(url: Value) -> Result<Value, String> {
    let text = js_string(&url);
    Ok(Value::String(match hostname(&text) {
        Some(host) => host.strip_prefix("www.").unwrap_or(&host).to_string(),
        None => String::new(),
    }))
}

fn is_special_scheme(scheme: &str) -> bool {
    matches!(scheme, "http" | "https" | "ws" | "wss" | "ftp")
}

/// `new URL(input).hostname`, or `None` when the parser rejects the input.
fn hostname(input: &str) -> Option<String> {
    let trimmed = input.trim_matches(|c: char| c <= ' ');
    let cleaned: String = trimmed
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let chars: Vec<char> = cleaned.chars().collect();
    if !chars.first()?.is_ascii_alphabetic() {
        return None;
    }
    let mut at = 0;
    while at < chars.len() {
        let c = chars[at];
        if c == ':' {
            break;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
            return None;
        }
        at += 1;
    }
    if at >= chars.len() {
        return None;
    }
    let scheme = chars[..at].iter().collect::<String>().to_ascii_lowercase();
    at += 1;

    let special = is_special_scheme(&scheme);
    if special {
        // The special schemes tolerate a missing or excessive slash run.
        while at < chars.len() && matches!(chars[at], '/' | '\\') {
            at += 1;
        }
    } else if at + 1 < chars.len() && chars[at] == '/' && chars[at + 1] == '/' {
        at += 2;
    } else {
        // An opaque path: no host at all.
        return Some(String::new());
    }

    let start = at;
    while at < chars.len() {
        let c = chars[at];
        if c == '/' || c == '?' || c == '#' || (special && c == '\\') {
            break;
        }
        at += 1;
    }
    let mut authority: String = chars[start..at].iter().collect();
    if let Some(position) = authority.rfind('@') {
        authority = authority[position + 1..].to_string();
    }

    let (host, port) = if authority.starts_with('[') {
        let end = authority.find(']')?;
        let literal = &authority[1..end];
        if literal.is_empty()
            || !literal
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '.')
        {
            return None;
        }
        // An IP literal is already canonical; it does not go through the domain code path.
        check_port(&authority[end + 1..])?;
        return Some(format!("[{}]", literal.to_ascii_lowercase()));
    } else {
        match authority.find(':') {
            Some(position) => (authority[..position].to_string(), &authority[position..]),
            None => (authority.clone(), ""),
        }
    };

    check_port(port)?;

    if host.is_empty() {
        return if special { None } else { Some(String::new()) };
    }
    to_ascii_host(&host)
}

/// The port is either absent or digits within range; anything else makes the URL unparseable.
fn check_port(port: &str) -> Option<()> {
    if port.is_empty() {
        return Some(());
    }
    let digits = port.strip_prefix(':')?;
    if digits.is_empty() {
        return Some(());
    }
    if !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    (digits.parse::<u32>().unwrap_or(u32::MAX) <= 65535).then_some(())
}

/// Percent escapes are decoded before the host is validated, so `%65xample.com` is
/// `example.com` and an escape that does not decode rejects the URL.
fn percent_decode(host: &str) -> Option<String> {
    let bytes = host.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            if at + 2 >= bytes.len() {
                return None;
            }
            let high = (bytes[at + 1] as char).to_digit(16)?;
            let low = (bytes[at + 2] as char).to_digit(16)?;
            out.push((high * 16 + low) as u8);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Full stops the identifier normalisation folds into a label separator.
fn is_label_dot(c: char) -> bool {
    matches!(c, '.' | '\u{3002}' | '\u{ff0e}' | '\u{ff61}')
}

/// Forbidden host code points plus IDNA → ASCII, matching `new URL` closely enough for citations.
fn to_ascii_host(raw: &str) -> Option<String> {
    let decoded = percent_decode(raw)?;
    if decoded.chars().any(|c| {
        matches!(
            c,
            '\0' | '\t'
                | '\n'
                | '\r'
                | ' '
                | '#'
                | '/'
                | ':'
                | '<'
                | '>'
                | '?'
                | '@'
                | '['
                | '\\'
                | ']'
                | '^'
                | '|'
                | '%'
        )
    }) {
        return None;
    }
    let mut labels: Vec<String> = Vec::new();
    for label in decoded.split(is_label_dot) {
        if label.is_ascii() {
            labels.push(label.to_ascii_lowercase());
            continue;
        }
        labels.push(format!("xn--{}", punycode(&label.to_lowercase())?));
    }
    Some(labels.join("."))
}

/// RFC 3492 punycode encoding of one label (the `xn--` prefix is added by the caller).
fn punycode(label: &str) -> Option<String> {
    const BASE: u32 = 36;
    const TMIN: u32 = 1;
    const TMAX: u32 = 26;
    const INITIAL_BIAS: u32 = 72;
    const INITIAL_N: u32 = 128;

    let input: Vec<u32> = label.chars().map(|c| c as u32).collect();
    let mut output = String::new();
    let basic: Vec<u32> = input.iter().copied().filter(|c| *c < INITIAL_N).collect();
    for code in &basic {
        output.push(char::from_u32(*code)?);
    }
    let basic_len = basic.len() as u32;
    if basic_len > 0 && basic.len() < input.len() {
        output.push('-');
    }
    let mut handled: u32 = basic_len;
    let mut code_point = INITIAL_N;
    let mut delta: u32 = 0;
    let mut bias = INITIAL_BIAS;
    while (handled as usize) < input.len() {
        let next = input.iter().copied().filter(|c| *c >= code_point).min()?;
        delta = delta.checked_add((next - code_point).checked_mul(handled + 1)?)?;
        code_point = next;
        for current in &input {
            if *current < code_point {
                delta = delta.checked_add(1)?;
            }
            if *current == code_point {
                let mut q = delta;
                let mut k = BASE;
                loop {
                    let threshold = if k <= bias {
                        TMIN
                    } else if k >= bias + TMAX {
                        TMAX
                    } else {
                        k - bias
                    };
                    if q < threshold {
                        break;
                    }
                    output.push(punycode_digit(
                        threshold + (q - threshold) % (BASE - threshold),
                    ));
                    q = (q - threshold) / (BASE - threshold);
                    k += BASE;
                }
                output.push(punycode_digit(q));
                bias = punycode_adapt(delta, handled + 1, handled == basic_len);
                delta = 0;
                handled += 1;
            }
        }
        delta = delta.checked_add(1)?;
        code_point += 1;
    }
    Some(output)
}

fn punycode_digit(value: u32) -> char {
    if value < 26 {
        char::from(b'a' + value as u8)
    } else {
        char::from(b'0' + (value - 26) as u8)
    }
}

/// `adapt` from RFC 3492 §6.1 — spelled out with the algorithm's own constants.
fn punycode_adapt(delta: u32, points: u32, first: bool) -> u32 {
    const BASE: u32 = 36;
    const TMIN: u32 = 1;
    const TMAX: u32 = 26;
    const SKEW: u32 = 38;
    const DAMP: u32 = 700;
    let mut delta = if first { delta / DAMP } else { delta / 2 };
    delta += delta / points;
    let mut k = 0;
    while delta > ((BASE - TMIN) * TMAX) / 2 {
        delta /= BASE - TMIN;
        k += BASE;
    }
    k + ((BASE - TMIN + 1) * delta) / (delta + SKEW)
}

/// Port of `isDeepSearchKind` (`src/services/chat/view.ts:32`).
pub fn is_deep_search_kind(kind: Value) -> Result<Value, String> {
    Ok(json!(
        is_text(&kind, "deep_search") || is_text(&kind, "deep_image_search")
    ))
}

/// Port of `isImageSearchKind` (`src/services/chat/view.ts:35`).
pub fn is_image_search_kind(kind: Value) -> Result<Value, String> {
    Ok(json!(
        is_text(&kind, "image_search") || is_text(&kind, "deep_image_search")
    ))
}

// ---------------------------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------------------------

/// Numbering of sources: one number per URL, in the order the reply first mentions it.
struct SourceRegistry {
    list: Vec<Value>,
}

/// A source URL is the identity of its entry, so a repeated URL keeps its number.
fn same_url(left: &Value, right: &Value) -> bool {
    left == right
}

impl SourceRegistry {
    fn find(&self, url: &Value) -> Option<usize> {
        self.list.iter().position(|source| {
            source
                .get("url")
                .is_some_and(|existing| same_url(existing, url))
        })
    }

    /// `SourceRegistry.add`: refreshes the metadata of a known URL, otherwise numbers it next.
    fn add(
        &mut self,
        url: &Value,
        title: &Value,
        published_at: &Value,
        metadata: &Value,
    ) -> Result<usize, String> {
        let domain = get_site_name(url.clone())?;
        let site_name = match self.metadata_text(metadata, "site_name")? {
            Some(text) => Value::String(text),
            None => domain.clone(),
        };
        let snippet = match self.metadata_text(metadata, "snippet")? {
            Some(text) => Value::String(text),
            None => Value::Null,
        };
        let site_icon = match self.metadata_text(metadata, "site_icon")? {
            Some(text) => Value::String(text),
            None => Value::Null,
        };

        if let Some(index) = self.find(url) {
            let existing = &mut self.list[index];
            let existing_title = member(existing, "title")?;
            if existing_title == *url && truthy(title) {
                set_field(existing, "title", title.clone());
            }
            if member(existing, "siteName")? == domain {
                set_field(existing, "siteName", site_name);
            }
            for (name, value) in [
                ("publishedAt", published_at.clone()),
                ("snippet", snippet),
                ("siteIcon", site_icon),
            ] {
                if !truthy(&member(existing, name)?) {
                    set_field(existing, name, value);
                }
            }
            return Ok(index);
        }

        let index = self.list.len();
        let title = if truthy(title) {
            title.clone()
        } else {
            url.clone()
        };
        self.list.push(json!({
            "url": url,
            "title": title,
            "siteName": site_name,
            "publishedAt": published_at,
            "snippet": snippet,
            "siteIcon": site_icon,
            "index": index + 1,
        }));
        Ok(index)
    }

    /// `metadata?.name?.trim()`, with `None` for "absent or blank".
    fn metadata_text(&self, metadata: &Value, field: &str) -> Result<Option<String>, String> {
        let raw = opt_member(metadata, field)?;
        if is_nullish(&raw) {
            return Ok(None);
        }
        let text = trim(&raw, &format!("metadata?.{field}"))?;
        Ok(if text.is_empty() { None } else { Some(text) })
    }

    fn source(&self, index: usize) -> Value {
        self.list[index].clone()
    }

    fn all(&self) -> Value {
        Value::Array(self.list.clone())
    }
}

fn set_field(target: &mut Value, name: &str, value: Value) {
    if let Value::Object(map) = target {
        map.insert(name.to_string(), value);
    }
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/// `getStatus`: a result that never arrived reads as a failure once the stream has stopped.
fn get_status(result: &Value, streaming: bool) -> Result<Value, String> {
    if !truthy(result) {
        return Ok(json!(if streaming { "wip" } else { "failed" }));
    }
    let kind = member(result, "type")?;
    if is_text(&kind, "web_search_tool_result") {
        let content = member(result, "content")?;
        let mut failed = false;
        for item in some_source(&content, "result.content")? {
            if is_text(&member(&item, "type")?, "web_search_tool_result_error") {
                failed = true;
                break;
            }
        }
        return Ok(json!(if failed { "failed" } else { "done" }));
    }
    let content = member(result, "content")?;
    Ok(json!(
        if is_text(&member(&content, "type")?, "web_fetch_result") {
            "done"
        } else {
            "failed"
        }
    ))
}

/// `mergeStatus`: a running step wins, then an all-failed list.
fn merge_status(statuses: &[Value]) -> Value {
    if statuses.iter().any(|status| is_text(status, "wip")) {
        return json!("wip");
    }
    if statuses.iter().all(|status| is_text(status, "failed")) {
        return json!("failed");
    }
    json!("done")
}

// ---------------------------------------------------------------------------------------------
// buildReplyView
// ---------------------------------------------------------------------------------------------

/// One text block waiting to be turned into the answer or a preamble step.
struct PendingText {
    index: usize,
    text: Value,
    citations: Value,
}

/// `joinTextBlocks`: citation markers go after the padded body, the padding stays at the tail.
fn join_text_blocks(
    blocks: &[PendingText],
    registry: &mut SourceRegistry,
) -> Result<(String, String), String> {
    let mut markdown = String::new();
    let mut text = Value::String(String::new());
    for block in blocks {
        text = js_add(&text, &block.text);
        let mut indexes: Vec<usize> = Vec::new();
        if !is_nullish(&block.citations) {
            for citation in iterate(&block.citations, "block.citations")? {
                let url = member(&citation, "url")?;
                let title = member(&citation, "title")?;
                let index = registry.add(&url, &title, &Value::Null, &undefined())?;
                if !indexes.contains(&index) {
                    indexes.push(index);
                }
            }
        }
        if indexes.is_empty() {
            // `markdown += block.text` then `block.text.slice(body.length)`, where `body` is the
            // whole text: the slice is empty but the call still fails for a non-string.
            if is_nullish(&block.text) {
                let base = if block.text.is_null() {
                    "null"
                } else {
                    "undefined"
                };
                return Err(reading_error(base, "slice"));
            }
            if as_text(&block.text).is_none() {
                return Err("block.text.slice is not a function".into());
            }
            markdown.push_str(&js_string(&block.text));
            continue;
        }
        // `body = block.text.trimEnd()`, then the trimmed padding is appended after the markers.
        if is_nullish(&block.text) {
            let base = if block.text.is_null() {
                "null"
            } else {
                "undefined"
            };
            return Err(reading_error(base, "trimEnd"));
        }
        let Some(text_value) = as_text(&block.text) else {
            return Err("block.text.trimEnd is not a function".into());
        };
        let body = text_value.trim_end_matches(is_js_space);
        markdown.push_str(body);
        for index in indexes {
            markdown.push_str(&format!("[citation:{}]", index + 1));
        }
        let units = crate::utf16::units(text_value);
        markdown.push_str(&crate::utf16::slice(
            &units,
            crate::utf16::units(body).len(),
            units.len(),
        ));
    }
    Ok((markdown, js_string(&text)))
}

/// Port of `buildReplyView` (`src/services/chat/view.ts:176`).
pub fn build_reply_view(reply: Value, streaming: bool) -> Result<Value, String> {
    let blocks = iterate(&member(&reply, "blocks")?, "reply.blocks")?;

    // Tool results are addressed by the id of the tool call they belong to.
    let mut results: Vec<(Value, Value)> = Vec::new();
    for block in &blocks {
        let kind = member(block, "type")?;
        if is_text(&kind, "web_search_tool_result") || is_text(&kind, "web_fetch_tool_result") {
            let key = member(block, "tool_use_id")?;
            match results.iter_mut().find(|(existing, _)| *existing == key) {
                Some((_, slot)) => *slot = block.clone(),
                None => results.push((key, block.clone())),
            }
        }
    }

    let mut registry = SourceRegistry { list: Vec::new() };
    let mut search_results: Vec<Value> = Vec::new();
    let mut steps: Vec<Value> = Vec::new();
    let mut merged_search: Vec<(Value, usize)> = Vec::new();
    let mut merged_thinking: Option<usize> = None;
    let mut pending_text: Vec<PendingText> = Vec::new();

    // Sources are numbered in the order the reply introduces them, independent of the citations.
    for block in &blocks {
        if !is_text(&member(block, "type")?, "server_tool_use") {
            continue;
        }
        let result = lookup(&results, &member(block, "id")?);
        let Some(result) = result else { continue };
        let result_kind = member(&result, "type")?;
        if is_text(&result_kind, "web_search_tool_result") {
            for item in iterate(&member(&result, "content")?, "result.content")? {
                if !is_text(&member(&item, "type")?, "web_search_result") {
                    continue;
                }
                let index = registry.add(
                    &member(&item, "url")?,
                    &member(&item, "title")?,
                    &member(&item, "page_age")?,
                    &item,
                )?;
                let source = registry.source(index);
                if !search_results.contains(&source) {
                    search_results.push(source);
                }
            }
        } else if is_text(&result_kind, "web_fetch_tool_result") {
            let content = member(&result, "content")?;
            if is_text(&member(&content, "type")?, "web_fetch_result")
                && is_text(&member(block, "kind")?, "deep_search")
            {
                registry.add(
                    &member(&content, "url")?,
                    &member(&member(&content, "content")?, "title")?,
                    &member(&content, "published_at")?,
                    &undefined(),
                )?;
            }
        }
    }

    // `reply.blocks.forEach(…)` needs a real array: a string iterates in the loop above but has
    // no `forEach`.
    let blocks = match member(&reply, "blocks")? {
        Value::Array(items) => items,
        _ => return Err("reply.blocks.forEach is not a function".into()),
    };

    for (position, block) in blocks.iter().enumerate() {
        let kind = member(block, "type")?;
        // Templates are rendered by `describeReply`; they never join the answer or a preamble.
        if is_text(&kind, "text") && truthy(&member(block, "isTemplate")?) {
            continue;
        }
        if !is_text(&kind, "thinking") {
            merged_thinking = None;
        }
        if is_text(&kind, "text") {
            pending_text.push(PendingText {
                index: position,
                text: member(block, "text")?,
                citations: member(block, "citations")?,
            });
            continue;
        }
        if is_text(&kind, "thinking") {
            // Adjacent thinking blocks share one dot and one Markdown blob; the raw blocks stay.
            if let Some(step) = merged_thinking {
                if let Some(Value::Array(items)) =
                    steps.get_mut(step).and_then(|step| step.get_mut("blocks"))
                {
                    items.push(block.clone());
                }
                continue;
            }
            if truthy(&member(block, "thinking")?) {
                flush_preamble(&mut pending_text, &mut steps, &mut registry)?;
                steps.push(json!({
                    "type": "thinking",
                    "key": format!("thinking-{position}"),
                    "blocks": [block],
                }));
                merged_thinking = Some(steps.len() - 1);
            }
            continue;
        }
        if !is_text(&kind, "server_tool_use") {
            continue;
        }
        let result = lookup(&results, &member(block, "id")?);
        let input = member(block, "input")?;
        // A page known only by its signature still travels with the request, but has no link.
        if is_text(&member(&input, "action")?, "read_link") && !truthy(&member(&input, "url")?) {
            let mut shown = false;
            if let Some(result) = &result
                && is_text(&member(result, "type")?, "web_fetch_tool_result")
            {
                let content = member(result, "content")?;
                if is_text(&member(&content, "type")?, "web_fetch_result") {
                    shown = truthy(&member(&content, "url")?);
                }
            }
            if !shown {
                continue;
            }
        }
        flush_preamble(&mut pending_text, &mut steps, &mut registry)?;
        let tool_kind = member(block, "kind")?;
        let status = match &result {
            Some(result) => get_status(result, streaming)?,
            None => get_status(&undefined(), streaming)?,
        };

        if is_text(&member(&input, "action")?, "search") {
            let queries = member(&input, "queries")?;
            let mut found: Vec<Value> = Vec::new();
            if let Some(result) = &result
                && is_text(&member(result, "type")?, "web_search_tool_result")
            {
                for item in flat_map_source(&member(result, "content")?, "result.content")? {
                    if !is_text(&member(&item, "type")?, "web_search_result") {
                        continue;
                    }
                    let index = registry.add(
                        &member(&item, "url")?,
                        &member(&item, "title")?,
                        &member(&item, "page_age")?,
                        &item,
                    )?;
                    found.push(registry.source(index));
                }
            }
            // A plain search merges into its first step; a thinking-time search only merges into
            // the directly preceding step of the same kind.
            let deep = truthy(&is_deep_search_kind(tool_kind.clone())?);
            let target = if deep {
                let last = steps.last();
                if let Some(last) = last {
                    if is_text(&opt_member(last, "type")?, "search")
                        && member(last, "kind").is_ok_and(|kind| kind == tool_kind)
                    {
                        Some(steps.len() - 1)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                merged_search
                    .iter()
                    .find(|(kind, _)| *kind == tool_kind)
                    .map(|(_, index)| *index)
            };
            if let Some(index) = target {
                if let Some(Value::Object(step)) = steps.get_mut(index) {
                    let added = iterate(&queries, "queries")?;
                    if let Some(Value::Array(items)) = step.get_mut("queries") {
                        items.extend(added);
                    }
                    let mut results_list = step
                        .get("results")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    for source in found {
                        if !results_list.contains(&source) {
                            results_list.push(source);
                        }
                    }
                    step.insert("results".into(), Value::Array(results_list));
                    let previous = step.get("status").cloned().unwrap_or_else(undefined);
                    step.insert("status".into(), merge_status(&[previous, status.clone()]));
                }
            } else {
                steps.push(json!({
                    "type": "search",
                    "key": member(block, "id")?,
                    "kind": tool_kind,
                    "queries": iterate(&queries, "queries")?,
                    "results": found,
                    "status": status,
                }));
                if !deep {
                    merged_search.push((tool_kind, steps.len() - 1));
                }
            }
            continue;
        }

        let fetched = match &result {
            Some(result) if is_text(&member(result, "type")?, "web_fetch_tool_result") => {
                member(result, "content")?
            }
            _ => Value::Null,
        };
        let is_fetched_page = is_text(&opt_member(&fetched, "type")?, "web_fetch_result");
        let fetched_url = if is_fetched_page {
            member(&fetched, "url")?
        } else {
            json!("")
        };
        let fetched_title = if is_fetched_page {
            member(&member(&fetched, "content")?, "title")?
        } else {
            Value::Null
        };
        let input_url = member(&input, "url")?;
        let url = if truthy(&input_url) {
            input_url.clone()
        } else {
            fetched_url
        };
        let title = if truthy(&fetched_title) {
            fetched_title
        } else {
            input_url
        };
        let page = json!({
            "id": member(block, "id")?,
            "url": url,
            "title": title,
            "status": status,
        });

        let action = member(&input, "action")?;
        if is_text(&action, "read_link") {
            // A read link only shows while it runs; the raw result stays for later requests.
            if !is_text(&status, "wip") {
                continue;
            }
            if push_into_last(&mut steps, "read_link", "links", page.clone())? {
                continue;
            }
            steps.push(json!({ "type": "read_link", "links": [page] }));
        } else if is_text(&action, "open_page") {
            if push_into_last(&mut steps, "open", "pages", page.clone())? {
                continue;
            }
            steps.push(json!({ "type": "open", "pages": [page] }));
        } else {
            let item = json!({
                "id": member(block, "id")?,
                "pattern": member(&input, "pattern")?,
                "status": status,
            });
            if push_into_last(&mut steps, "find", "patterns", item.clone())? {
                continue;
            }
            steps.push(json!({ "type": "find", "patterns": [item] }));
        }
    }

    let answer = if pending_text.is_empty() {
        Value::Null
    } else {
        let (markdown, text) = join_text_blocks(&pending_text, &mut registry)?;
        let joined = json!({ "markdown": markdown, "text": text });
        if truthy(&member(&joined, "text")?) {
            joined
        } else {
            Value::Null
        }
    };

    Ok(json!({
        "steps": steps,
        "answer": answer,
        "sources": registry.all(),
        "searchResults": search_results,
    }))
}

/// The tool result for a tool call id, if the reply carries one.
fn lookup(results: &[(Value, Value)], id: &Value) -> Option<Value> {
    results
        .iter()
        .find(|(key, _)| key == id)
        .map(|(_, block)| block.clone())
}

/// Appends to the last step of `step_type`, or reports that a new step is needed.
fn push_into_last(
    steps: &mut [Value],
    step_type: &str,
    field: &str,
    item: Value,
) -> Result<bool, String> {
    let Some(last) = steps.last_mut() else {
        return Ok(false);
    };
    if !is_text(&member(last, "type")?, step_type) {
        return Ok(false);
    }
    match last.get_mut(field) {
        Some(Value::Array(items)) => {
            items.push(item);
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// `flushPreamble`: text between tools becomes a step only when it is not blank.
fn flush_preamble(
    pending: &mut Vec<PendingText>,
    steps: &mut Vec<Value>,
    registry: &mut SourceRegistry,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }
    let (markdown, _) = join_text_blocks(pending, registry)?;
    if !trim(&Value::String(markdown.clone()), "markdown")?.is_empty() {
        let key = match pending.first() {
            Some(first) => format!("text-{}", first.index),
            None => "text-0".to_string(),
        };
        steps.push(json!({ "type": "text", "key": key, "markdown": markdown }));
    }
    pending.clear();
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Thinking totals and the collapse title
// ---------------------------------------------------------------------------------------------

/// Port of `getTotalThinkingSeconds` (`src/services/chat/view.ts:350`).
pub fn get_total_thinking_seconds(steps: Value, now: f64) -> Result<Value, String> {
    let mut total = 0.0_f64;
    for step in iterate(&steps, "steps")? {
        if !is_text(&member(&step, "type")?, "thinking") {
            continue;
        }
        for block in iterate(&member(&step, "blocks")?, "step.blocks")? {
            let elapsed = member(&block, "elapsedSeconds")?;
            if !is_undefined(&elapsed) {
                total += to_number(&elapsed) * 1000.0;
                continue;
            }
            let started = member(&block, "startedAt")?;
            if is_undefined(&started) {
                return Ok(Value::Null);
            }
            let ended = member(&block, "endedAt")?;
            let end = if is_nullish(&ended) {
                now
            } else {
                to_number(&ended)
            };
            total += end - to_number(&started);
        }
    }
    let seconds = js::math_round(total / 1000.0);
    // `Math.max` propagates NaN, which Rust's `f64::max` would swallow.
    Ok(js::number(if seconds.is_nan() {
        f64::NAN
    } else {
        seconds.max(1.0)
    }))
}

/// `translate('messageThinkDuration', { count })` — zh-CN wording; see the module note.
fn think_duration(count: f64) -> String {
    format!("已思考（用时 {} 秒）", js::number_to_string(count))
}

/// Port of `getAreaTitle` (`src/services/chat/view.ts:370`).
///
/// `hasResponse` defaults to `view.answer !== null`; an omitted argument arrives as the
/// `undefined` marker, so the signature takes the raw value instead of `Option`.
pub fn get_area_title(
    view: Value,
    streaming: bool,
    now: f64,
    has_response: Value,
) -> Result<Value, String> {
    let has_response = if is_undefined(&has_response) {
        !member(&view, "answer")?.is_null()
    } else {
        truthy(&has_response)
    };
    if has_response {
        let count = get_total_thinking_seconds(member(&view, "steps")?, now)?;
        if count.is_null() {
            return Ok(json!("深度思考"));
        }
        return Ok(Value::String(think_duration(to_number(&count))));
    }
    if !streaming {
        return Ok(json!("已停止"));
    }
    let steps = member(&view, "steps")?;
    let last = at_last(&steps, "view.steps")?;
    let last_kind = opt_member(&last, "type")?;
    if is_text(&last_kind, "search") && is_text(&opt_member(&last, "status")?, "wip") {
        let kind = opt_member(&last, "kind")?;
        return Ok(json!(if truthy(&is_image_search_kind(kind)?) {
            "图像搜索中..."
        } else {
            "正在搜索"
        }));
    }
    if is_text(&last_kind, "open") && any_status_is(&member(&last, "pages")?, "last.pages", "wip")?
    {
        return Ok(json!("正在浏览网页"));
    }
    if is_text(&last_kind, "find")
        && any_status_is(&member(&last, "patterns")?, "last.patterns", "wip")?
    {
        return Ok(json!("正在浏览网页"));
    }
    if is_text(&last_kind, "read_link")
        && any_status_is(&member(&last, "links")?, "last.links", "wip")?
    {
        return Ok(json!("正在阅读"));
    }
    Ok(json!("正在思考"))
}
