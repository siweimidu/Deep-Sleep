//! JS bindings for `src/services/api/sse.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod utf16;

fn server_sent_event_decoder_new_inner() -> Result<port::ServerSentEventDecoder, String> {
    let out = port::ServerSentEventDecoder::new()?;
    Ok(out)
}

fn server_sent_event_decoder_push_inner(
    inner: &mut port::ServerSentEventDecoder,
    text: String,
) -> Result<String, String> {
    let out = inner.push(text)?;
    crate::js::to_json(&out)
}

fn server_sent_event_decoder_end_inner(
    inner: &mut port::ServerSentEventDecoder,
) -> Result<String, String> {
    let out = inner.end()?;
    crate::js::to_json(&out)
}

/// Class `ServerSentEventDecoder`.
#[wasm_bindgen(js_name = "ServerSentEventDecoder")]
pub struct ServerSentEventDecoder {
    inner: port::ServerSentEventDecoder,
}

#[wasm_bindgen(js_class = "ServerSentEventDecoder")]
impl ServerSentEventDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<ServerSentEventDecoder, JsError> {
        let inner = server_sent_event_decoder_new_inner().map_err(|e| JsError::new(&e))?;
        Ok(Self { inner })
    }

    #[wasm_bindgen(js_name = "push")]
    pub fn push(&mut self, text: String) -> Result<String, JsError> {
        server_sent_event_decoder_push_inner(&mut self.inner, text).map_err(|e| JsError::new(&e))
    }

    #[wasm_bindgen(js_name = "end")]
    pub fn end(&mut self) -> Result<String, JsError> {
        server_sent_event_decoder_end_inner(&mut self.inner).map_err(|e| JsError::new(&e))
    }
}
