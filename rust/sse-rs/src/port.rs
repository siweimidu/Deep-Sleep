//! The Rust port of `src/services/api/sse.ts`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

use serde_json::{Map, Value};

/// Port of class `ServerSentEventDecoder` (`src/services/api/sse.ts:20`): holds the instance state.
///
/// WHATWG event-stream interpretation: bytes are decoded outside, this holds the text buffer and
/// the in-flight event fields. Line breaks are scanned as ASCII bytes, which are always char
/// boundaries in UTF-8, so the slices stay valid without UTF-16 bookkeeping.
pub struct ServerSentEventDecoder {
    buffer: String,
    data: String,
    has_data: bool,
    event_type: String,
    last_event_id: String,
}

impl ServerSentEventDecoder {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            buffer: String::new(),
            data: String::new(),
            has_data: false,
            event_type: String::new(),
            last_event_id: String::new(),
        })
    }

    /// Port of `ServerSentEventDecoder.push` (`src/services/api/sse.ts:28`).
    pub fn push(&mut self, text: String) -> Result<Vec<Value>, String> {
        self.buffer.push_str(&text);

        // Collect the complete lines first: `process_line` needs `&mut self`, so the immutable
        // borrow of `buffer` has to end before any line is dispatched.
        let mut lines: Vec<String> = Vec::new();
        let mut line_start = 0usize;
        {
            let bytes = self.buffer.as_bytes();
            let len = bytes.len();
            let mut i = 0usize;
            while i < len {
                match bytes[i] {
                    // A trailing CR may be the first half of a CRLF still in flight.
                    b'\r' if i + 1 == len => break,
                    b'\r' if bytes[i + 1] == b'\n' => {
                        lines.push(self.buffer[line_start..i].to_string());
                        i += 2;
                        line_start = i;
                    }
                    b'\r' | b'\n' => {
                        lines.push(self.buffer[line_start..i].to_string());
                        i += 1;
                        line_start = i;
                    }
                    _ => i += 1,
                }
            }
        }
        let tail = self.buffer[line_start..].to_string();
        self.buffer = tail;

        let mut events = Vec::new();
        for line in lines {
            if let Some(event) = self.process_line(&line) {
                events.push(event);
            }
        }
        Ok(events)
    }

    /// Port of `ServerSentEventDecoder.end` (`src/services/api/sse.ts:49`).
    pub fn end(&mut self) -> Result<Vec<Value>, String> {
        let event = if self.buffer.ends_with('\r') {
            let line = self.buffer[..self.buffer.len() - 1].to_string();
            self.process_line(&line)
        } else {
            None
        };
        self.buffer.clear();
        self.data.clear();
        self.has_data = false;
        self.event_type.clear();
        Ok(event.into_iter().collect())
    }

    /// One line: dispatch on a blank line, otherwise accumulate the field.
    fn process_line(&mut self, line: &str) -> Option<Value> {
        if line.is_empty() {
            return self.dispatch();
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.find(':') {
            Some(colon) => (&line[..colon], &line[colon + 1..]),
            None => (line, ""),
        };
        // Exactly one leading space is part of the field syntax.
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => {
                if self.has_data {
                    self.data.push('\n');
                }
                self.data.push_str(value);
                self.has_data = true;
            }
            "event" => self.event_type = value.to_string(),
            // A NUL in the id is ignored, per the spec.
            "id" if !value.contains('\0') => self.last_event_id = value.to_string(),
            _ => {}
        }
        None
    }

    /// Emits the accumulated event on a blank line and resets the per-event fields.
    fn dispatch(&mut self) -> Option<Value> {
        let event = self.has_data.then(|| {
            let mut map = Map::new();
            map.insert(
                "event".to_string(),
                Value::String(if self.event_type.is_empty() {
                    "message".to_string()
                } else {
                    self.event_type.clone()
                }),
            );
            map.insert(
                "data".to_string(),
                Value::String(std::mem::take(&mut self.data)),
            );
            map.insert(
                "lastEventId".to_string(),
                Value::String(self.last_event_id.clone()),
            );
            Value::Object(map)
        });
        self.data.clear();
        self.has_data = false;
        self.event_type.clear();
        event
    }
}

#[cfg(test)]
mod tests {
    use super::ServerSentEventDecoder;

    fn push(decoder: &mut ServerSentEventDecoder, text: &str) -> String {
        serde_json::to_string(&decoder.push(text.to_string()).unwrap()).unwrap()
    }

    #[test]
    fn dispatches_on_blank_line() {
        let mut d = ServerSentEventDecoder::new().unwrap();
        assert_eq!(
            push(&mut d, "data: hello\n\n"),
            r#"[{"event":"message","data":"hello","lastEventId":""}]"#
        );
    }

    #[test]
    fn holds_a_crlf_split_across_pushes() {
        let mut d = ServerSentEventDecoder::new().unwrap();
        assert_eq!(push(&mut d, "data: x\r"), "[]");
        assert_eq!(
            push(&mut d, "\n\r\n"),
            r#"[{"event":"message","data":"x","lastEventId":""}]"#
        );
    }

    #[test]
    fn joins_multiline_data() {
        let mut d = ServerSentEventDecoder::new().unwrap();
        assert_eq!(
            push(&mut d, "data: a\ndata: b\n\n"),
            r#"[{"event":"message","data":"a\nb","lastEventId":""}]"#
        );
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let mut d = ServerSentEventDecoder::new().unwrap();
        assert_eq!(push(&mut d, ": keep-alive\nfoo: bar\n\n"), "[]");
    }

    #[test]
    fn end_flushes_a_trailing_cr_line() {
        let mut d = ServerSentEventDecoder::new().unwrap();
        assert_eq!(push(&mut d, "data: x\r"), "[]");
        assert_eq!(
            serde_json::to_string(&d.end().unwrap()).unwrap(),
            // `data: x` is a field line, so `end` leaves the event undelivered.
            "[]"
        );
    }
}
