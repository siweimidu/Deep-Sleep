//! The Rust port of `src/services/chat/branches.ts`.
//!
//! A session keeps one flat `messages` list with `parentId` / `selectedChildId` links; the selected
//! branch is the walk from `rootMessageId`. Three JS rules drive the shapes here:
//!
//! * a missing key and a key holding `undefined` are the same thing to the source, so `field` reads
//!   both as `None` — while an object spread still keeps such a key in its original position;
//! * `Map` keeps insertion order and a repeated `set` holds the first position, which is what
//!   `serde_json::Map` does, so maps are modelled with it;
//! * `===` tells `undefined` from `null`, so a link is an `Option<Value>` where `None` is `undefined`.

#![forbid(unsafe_code)]

use serde_json::{Map, Value, json};

use crate::js;

/// The value JS reads at `key`: an absent key and an explicit `undefined` both read as `undefined`.
fn field<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|value| !js::is_undefined(value))
}

/// `message[key]`: `undefined` for a missing key, and for a leaf that is not an object at all.
fn link<'a>(message: &'a Value, key: &str) -> Option<&'a Value> {
    field(message.as_object()?, key)
}

/// JS truthiness, for the `while (id)` conditions: `Some` when the value is truthy.
fn truthy(value: &Value) -> Option<Value> {
    let live = match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(_) => js::as_number(value).is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        _ => true,
    };
    live.then(|| value.clone())
}

fn as_object(value: &Value) -> Result<&Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| "TypeError: not an object".to_string())
}

/// `{ ...value }`: an object copies its own keys, a string or an array spreads one key per element,
/// every other leaf spreads to nothing.
fn spread(value: &Value) -> Map<String, Value> {
    match value {
        Value::Object(object) => object.clone(),
        Value::String(text) => text
            .chars()
            .map(|character| Value::String(character.to_string()))
            .enumerate()
            .map(|(at, item)| (at.to_string(), item))
            .collect(),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(at, item)| (at.to_string(), item.clone()))
            .collect(),
        _ => Map::new(),
    }
}

/// `{ ...session, rootMessageId: root, messages }`.
fn rebuild(session: &Map<String, Value>, root: Value, messages: Vec<Value>) -> Value {
    let mut out = session.clone();
    out.insert("rootMessageId".into(), root);
    out.insert("messages".into(), Value::Array(messages));
    Value::Object(out)
}

/// `parentId === null ? child : session.rootMessageId` — only `null` re-roots a session.
fn root_for(session: &Map<String, Value>, parent: Option<&Value>, child: Value) -> Value {
    if parent.is_some_and(Value::is_null) {
        return child;
    }
    field(session, "rootMessageId")
        .cloned()
        .unwrap_or_else(js::undefined)
}

/// `session.messages`: the source calls `.map` on it, which throws on anything but an array.
fn messages_of(session: &Map<String, Value>) -> Result<&Vec<Value>, String> {
    session
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| "TypeError: session.messages is not an array".to_string())
}

/// `messages[i]?.id`, `None` for `undefined`; an explicit `null` stays `Some(null)`.
fn id_of(message: Option<&Value>) -> Option<Value> {
    message.and_then(|message| link(message, "id")).cloned()
}

/// `messages[i]?.id ?? fallback`: a missing message or a nullish `id` takes the fallback.
fn id_or(message: Option<&Value>, fallback: Value) -> Value {
    id_of(message)
        .filter(|id| !id.is_null())
        .unwrap_or(fallback)
}

/// A `Map` key as a comparable token: `undefined`, `null` and the string `"null"` stay apart.
fn token(value: Option<&Value>) -> String {
    value.map_or_else(|| js::undefined().to_string(), Value::to_string)
}

/// `item.id === parentId ? { ...item, selectedChildId: child } : item`, over a whole list.
fn select_at(items: &[Value], parent: Option<&Value>, child: &Value) -> Vec<Value> {
    items
        .iter()
        .map(|item| {
            if id_of(Some(item)).as_ref() != parent {
                return item.clone();
            }
            let mut picked = spread(item);
            picked.insert("selectedChildId".into(), child.clone());
            Value::Object(picked)
        })
        .collect()
}

/// Port of `normalizeSession` (`src/services/chat/branches.ts:4`).
///
/// An already-normalized session comes back untouched; otherwise every message is relabelled onto a
/// single linear chain, so a parent and a selected child always name their neighbours.
pub fn normalize_session(session: Value) -> Result<Value, String> {
    let object = as_object(&session)?;
    if field(object, "rootMessageId").is_some() {
        return Ok(session);
    }
    let messages = messages_of(object)?;
    // `messages[index + 1]?.id` has no fallback, so the last message keeps an explicit `undefined`.
    let linear: Vec<Value> = messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            let mut message = spread(message);
            let previous = index.checked_sub(1).and_then(|at| messages.get(at));
            message.insert("parentId".into(), id_or(previous, Value::Null));
            message.insert(
                "selectedChildId".into(),
                id_of(messages.get(index + 1)).unwrap_or_else(js::undefined),
            );
            Value::Object(message)
        })
        .collect();
    Ok(rebuild(
        object,
        id_or(messages.first(), Value::Null),
        linear,
    ))
}

/// The walk from `rootMessageId`.
fn visible(session: &Value) -> Result<Value, String> {
    let Some(object) = session.as_object() else {
        if session.is_null() || js::is_undefined(session) {
            return Err("TypeError: cannot read a property of null or undefined".to_string());
        }
        // Every property of a primitive reads as `undefined`, `messages` among them.
        return Ok(js::undefined());
    };
    let Some(root) = field(object, "rootMessageId") else {
        // No tree yet: the linear list comes back as it is, `undefined` included.
        return Ok(object
            .get("messages")
            .cloned()
            .unwrap_or_else(js::undefined));
    };
    let messages = messages_of(object)?;
    // `new Map(messages.map(m => [m.id, m]))`: a later message with the same id replaces the value
    // but keeps the position of the first.
    let mut by_id: Vec<(Option<Value>, Value)> = Vec::new();
    for message in messages {
        let id = id_of(Some(message));
        match by_id.iter_mut().find(|(other, _)| *other == id) {
            Some((_, slot)) => *slot = message.clone(),
            None => by_id.push((id, message.clone())),
        }
    }
    // Dropping each visited id is what stops a `selectedChildId` cycle.
    let mut path = Vec::new();
    let mut current = truthy(root);
    while let Some(id) = current {
        let Some(at) = by_id
            .iter()
            .position(|(other, _)| other.as_ref() == Some(&id))
        else {
            break;
        };
        let message = by_id.remove(at).1;
        current = link(&message, "selectedChildId").and_then(truthy);
        path.push(message);
    }
    Ok(Value::Array(path))
}

/// Port of `getVisibleMessages` (`src/services/chat/branches.ts:18`).
///
/// A cyclic `selectedChildId` chain yields each message once; an id the list does not contain ends
/// the walk. Neither is an error in the source. A session without a root gets its `messages` back
/// untouched — `undefined` when that key is missing, which is why the result is not always a list.
pub fn get_visible_messages(session: Value) -> Result<Value, String> {
    visible(&session)
}

/// A `Map` received from JS as key → value, `None` when the value is not a `Map` at all.
///
/// The source only fails once it calls `.size` or `.get` on a non-map, so this is not rejected here.
fn map_entries(previous: &Value) -> Option<Map<String, Value>> {
    let pairs = previous.as_object()?.get("$map")?.as_array()?;
    let mut entries = Map::new();
    for pair in pairs {
        let [key, value] = pair.as_array()?.as_slice().first_chunk::<2>()?;
        entries.insert(token(Some(key)), value.clone());
    }
    Some(entries)
}

/// Port of `buildMessageVersions` (`src/services/chat/branches.ts:40`).
///
/// Sibling groups are the messages sharing a `parentId` (or, in a linear session, each message on its
/// own). When nothing changed the `previous` map is handed back as it arrived, which is what spares a
/// re-render of every history message.
///
/// `previous` arrives as JSON, so a `cached.ids === stableIds` reference test can only be answered by
/// content here; the source emits one `ids` array per group, so the two agree on any map it returned.
pub fn build_message_versions(session: Value, previous: Value) -> Result<Value, String> {
    let object = as_object(&session)?;
    // `previous.size` is read before anything else, so a nullish `previous` fails right there.
    if previous.is_null() || js::is_undefined(&previous) {
        return Err("TypeError: cannot read 'size' of null or undefined".to_string());
    }
    let messages = messages_of(object)?;
    let entries = map_entries(&previous);
    // `rootMessageId === undefined` groups by the message id, otherwise by its parent.
    let linear = field(object, "rootMessageId").is_none();
    let mut groups: Vec<(String, Vec<Value>)> = Vec::new();
    for message in messages {
        let parent = if linear {
            id_of(Some(message))
        } else {
            link(message, "parentId").cloned()
        };
        let key = token(parent.as_ref());
        let id = id_of(Some(message)).unwrap_or_else(js::undefined);
        match groups.iter_mut().find(|(other, _)| *other == key) {
            Some((_, ids)) => ids.push(id),
            None => groups.push((key, vec![id])),
        }
    }

    let mut versions: Map<String, Value> = Map::new();
    // `previous.size === messages.length`: a value that is not a `Map` has no `size`, so it can
    // never count as unchanged.
    let mut unchanged = entries
        .as_ref()
        .is_some_and(|entries| entries.len() == messages.len());
    for (_, ids) in &groups {
        // The first `.get` is what throws for a `previous` that is not a `Map`; an empty session
        // never gets here, and the source hands back an empty map instead of failing.
        let entries = entries
            .as_ref()
            .ok_or_else(|| "TypeError: previous.get is not a function".to_string())?;
        // Whichever array the source reuses, its content is this group's ids.
        let stable = Value::Array(ids.clone());
        for (index, id) in ids.iter().enumerate() {
            let cached = entries.get(&token(Some(id)));
            let reused = cached.is_some_and(|version| {
                link(version, "ids") == Some(&stable)
                    && link(version, "index")
                        .and_then(js::as_number)
                        .is_some_and(|at| at == index as f64)
            });
            let version = match cached {
                Some(cached) if reused => cached.clone(),
                _ => {
                    unchanged = false;
                    json!({ "ids": stable.clone(), "index": index })
                }
            };
            // `versions.set(id, version)`: a repeated id keeps its position and takes the new value.
            versions.insert(token(Some(id)), Value::Array(vec![id.clone(), version]));
        }
    }
    if unchanged {
        return Ok(previous);
    }
    Ok(json!({ "$map": versions.into_iter().map(|(_, pair)| pair).collect::<Vec<Value>>() }))
}

/// Port of `appendBranch` (`src/services/chat/branches.ts:77`).
///
/// The new messages hang under `parentId` and become the selected child there; nothing already in the
/// session is dropped. An empty `messages` list leaves the normalized session alone.
///
/// `parentId` is `string | null`, and only `null` re-roots the session — `undefined` still counts as
/// "some parent I do not know", so it stays a distinct value all the way into the appended messages.
///
/// `messages` is read as `messages[0]` first: anything shorter than an array means "nothing to
/// append" and returns before `.map` is reached.
pub fn append_branch(original: Value, parent_id: Value, messages: Value) -> Result<Value, String> {
    let session = normalize_session(original)?;
    let parent = (!js::is_undefined(&parent_id)).then_some(parent_id);
    let appended: &[Value] = match &messages {
        Value::Array(items) => items,
        // `messages[0]` of a non-empty string is one character: truthy, and `.map` throws next.
        Value::String(text) if !text.is_empty() => {
            return Err("TypeError: messages.map is not a function".to_string());
        }
        value if value.is_null() || js::is_undefined(value) => {
            return Err("TypeError: cannot read a property of null or undefined".to_string());
        }
        _ => &[],
    };
    let Some(first) = appended.first().filter(|first| truthy(first).is_some()) else {
        return Ok(session);
    };
    let first_id = id_of(Some(first)).unwrap_or_else(js::undefined);

    let object = as_object(&session)?;
    let root = root_for(object, parent.as_ref(), first_id.clone());
    let mut kept = select_at(messages_of(object)?, parent.as_ref(), &first_id);
    for (index, message) in appended.iter().enumerate() {
        let mut added = spread(message);
        let previous = index.checked_sub(1).and_then(|at| appended.get(at));
        added.insert(
            "parentId".into(),
            id_or(previous, parent.clone().unwrap_or_else(js::undefined)),
        );
        added.insert(
            "selectedChildId".into(),
            id_of(appended.get(index + 1)).unwrap_or_else(js::undefined),
        );
        kept.push(Value::Object(added));
    }
    Ok(rebuild(object, root, kept))
}

/// Port of `selectVersion` (`src/services/chat/branches.ts:104`).
///
/// Only a node that already has a visible sibling can be switched; anything else returns the caller's
/// own object, unnormalized.
pub fn select_version(original: Value, message_id: String) -> Result<Value, String> {
    let session = normalize_session(original.clone())?;
    let object = as_object(&session)?;
    let all = messages_of(object)?;
    let wanted = Some(Value::String(message_id));
    let Some(message) = all.iter().find(|message| id_of(Some(message)) == wanted) else {
        return Ok(original);
    };
    let parent = link(message, "parentId").cloned();
    // A sibling is any visible message with the same `parentId`; for the root that is `undefined`.
    // A normalized session always has a root, so the walk is always a list here.
    let siblings = visible(&session)?.as_array().cloned().unwrap_or_default();
    if !siblings
        .iter()
        .any(|item| link(item, "parentId") == parent.as_ref())
    {
        return Ok(original);
    }
    let child = id_of(Some(message)).unwrap_or_else(js::undefined);
    let root = root_for(object, parent.as_ref(), child.clone());
    Ok(rebuild(
        object,
        root,
        select_at(all, parent.as_ref(), &child),
    ))
}

#[cfg(test)]
mod tests {
    use super::{append_branch, get_visible_messages};
    use serde_json::{Value, json};

    fn session(messages: Value, root: Value) -> Value {
        json!({ "id": "s", "rootMessageId": root, "messages": messages })
    }

    fn path(messages: Value) -> Vec<Value> {
        let walked = get_visible_messages(session(messages, json!("a"))).unwrap();
        let items = walked.as_array().cloned().unwrap_or_default();
        items.iter().map(|m| m["id"].clone()).collect()
    }

    #[test]
    fn the_walk_drops_each_visited_id() {
        let cycle = json!([
            {"id": "a", "selectedChildId": "b"},
            {"id": "b", "selectedChildId": "a"},
        ]);
        assert_eq!(path(cycle), vec![json!("a"), json!("b")]);
        // The last message with an id wins, so the second `a` sends the walk to `d`.
        let duplicate = json!([
            {"id": "a", "selectedChildId": "b"},
            {"id": "a", "selectedChildId": "d"},
            {"id": "b"}, {"id": "d"},
        ]);
        assert_eq!(path(duplicate), vec![json!("a"), json!("d")]);
    }

    #[test]
    fn only_a_null_parent_reroots_the_session() {
        let original = session(json!([{"id": "a"}]), json!("keep"));
        let appended = json!([{"id": "z"}]);
        let rooted = append_branch(original.clone(), Value::Null, appended.clone()).unwrap();
        assert_eq!(rooted["rootMessageId"], json!("z"));
        // `undefined` is not `null`: the root stays, and the new message records an undefined parent.
        let loose = append_branch(original, json!({"$undefined": true}), appended).unwrap();
        assert_eq!(loose["rootMessageId"], json!("keep"));
        assert_eq!(
            loose["messages"][1]["parentId"],
            json!({"$undefined": true})
        );
    }
}
