//! The Rust port of `src/services/location.ts`.
//!
//! A user's location: a region code, plus the Chinese province and city under it.

#![forbid(unsafe_code)]

mod data;

use serde_json::{Value, json};

use crate::js;

/// Port of `getRegionName` (`src/services/location.ts:25`).
///
/// A code outside `regionCodes` is `''`, whatever the locale. Inside it, `regionNameOverrides`
/// comes first, then the name `Intl.DisplayNames` gave for that code — the source asks the engine at
/// run time, so `data::REGIONS` carries the answers. `of()` names all 249 codes, so the source's
/// final `?? code` cannot fire and is left out.
/// The source declares two locales; any other one is a runtime `TypeError` there
/// (`regionNameOverrides[locale]` is `undefined`), and an `Err` here.
pub fn get_region_name(code: String, locale: String) -> Result<String, String> {
    let Some((_, zh_cn, en_us)) = data::REGIONS.iter().find(|(region, _, _)| *region == code)
    else {
        return Ok(String::new());
    };
    let name = match locale.as_str() {
        "zh-CN" => override_name(&locale, &code).unwrap_or(zh_cn),
        "en-US" => override_name(&locale, &code).unwrap_or(en_us),
        _ => {
            return Err(format!(
                "Cannot read properties of undefined (reading '{code}')"
            ));
        }
    };
    Ok(name.to_string())
}

/// `regionNameOverrides[locale][code]`.
fn override_name(locale: &str, code: &str) -> Option<&'static str> {
    data::OVERRIDES
        .iter()
        .find(|(l, c, _)| *l == locale && *c == code)
        .map(|(_, _, name)| *name)
}

/// Port of `normalizeLocation` (`src/services/location.ts:30`).
///
/// The value comes from storage, so anything unexpected is `null` rather than a guess: a
/// `region` that is not exactly a `regionCodes` entry rejects the whole value, and under `CN` the
/// province and city must each be exactly a code of `provinces` and of that province's cities.
/// Codes are compared with `===`: no trimming, no case folding, no prefix match.
pub fn normalize_location(value: Value) -> Result<Option<Value>, String> {
    if js::is_undefined(&value) {
        return Ok(None);
    }
    let Some(location) = value.as_object() else {
        return Ok(None);
    };
    let Some(Value::String(region)) = location.get("region") else {
        return Ok(None);
    };
    if !is_region(region) {
        return Ok(None);
    }
    if region != "CN" {
        return Ok(Some(json!({ "region": region })));
    }
    // `province === undefined` in the source: absent, or `undefined` over the wire.
    let Some(province) = field(location, "province") else {
        return Ok(if field(location, "city").is_none() {
            Some(json!({ "region": region }))
        } else {
            None
        });
    };
    let Some(province) = province.as_str().and_then(province_code) else {
        return Ok(None);
    };
    let Some(city) = field(location, "city") else {
        return Ok(Some(json!({ "region": region, "province": province })));
    };
    let Some(city) = city.as_str().filter(|city| is_city_of(province, city)) else {
        return Ok(None);
    };
    Ok(Some(
        json!({ "region": region, "province": province, "city": city }),
    ))
}

/// A property the source reads as possibly `undefined`.
fn field<'v>(location: &'v serde_json::Map<String, Value>, key: &str) -> Option<&'v Value> {
    location.get(key).filter(|v| !js::is_undefined(v))
}

/// `regions.has(code)`.
fn is_region(code: &str) -> bool {
    data::REGIONS.iter().any(|(region, _, _)| *region == code)
}

/// The code `provinces` holds for this entry, i.e. the one whose cities it lists.
fn province_code(code: &str) -> Option<&'static str> {
    data::PROVINCES
        .iter()
        .find(|(province, _)| *province == code)
        .map(|(province, _)| *province)
}

/// Membership of `province.cities`: `city.startsWith(province.code.slice(0, 2))`.
fn is_city_of(province: &str, city: &str) -> bool {
    data::CITIES
        .iter()
        .any(|(code, _)| *code == city && code.starts_with(province.get(..2).unwrap_or(province)))
}

#[cfg(test)]
mod tests {
    use super::{get_region_name, normalize_location};
    use serde_json::{Value, json};

    fn name(code: &str, locale: &str) -> String {
        get_region_name(code.to_string(), locale.to_string()).unwrap()
    }

    fn normalize(value: Value) -> Value {
        normalize_location(value).unwrap().unwrap_or(Value::Null)
    }

    #[test]
    fn names_a_region_only_for_a_known_code() {
        assert_eq!(name("CN", "zh-CN"), "中国");
        assert_eq!(name("CN", "en-US"), "China");
        assert_eq!(name("TW", "zh-CN"), "中国台湾");
        assert_eq!(name("TW", "en-US"), "Taiwan, China");
        assert_eq!(name("cn", "zh-CN"), "");
        assert_eq!(name("CN ", "zh-CN"), "");
        assert_eq!(name("110000", "zh-CN"), "");
    }

    #[test]
    fn refuses_an_undeclared_locale() {
        assert!(get_region_name("CN".to_string(), "fr-FR".to_string()).is_err());
        // An unknown code short-circuits before the locale is used, as in the source.
        assert_eq!(name("ZZ", "fr-FR"), "");
    }

    #[test]
    fn keeps_only_a_region_the_tables_know() {
        assert_eq!(normalize(json!({})), Value::Null);
        assert_eq!(normalize(json!(0)), Value::Null);
        assert_eq!(normalize(json!([])), Value::Null);
        assert_eq!(
            normalize(json!({ "region": "US" })),
            json!({ "region": "US" })
        );
        assert_eq!(normalize(json!({ "region": "us" })), Value::Null);
        assert_eq!(normalize(json!({ "region": "cn" })), Value::Null);
        assert_eq!(normalize(json!({ "region": 110 })), Value::Null);
        assert_eq!(
            normalize(json!({ "region": "CN" })),
            json!({ "region": "CN" })
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110000" })),
            json!({ "region": "CN", "province": "110000" })
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110000", "city": "110100" })),
            json!({ "region": "CN", "province": "110000", "city": "110100" })
        );
    }

    #[test]
    fn rejects_a_province_or_city_that_is_not_under_regions_own_list() {
        // A city without its province is not a location.
        assert_eq!(
            normalize(json!({ "region": "CN", "city": "110100" })),
            Value::Null
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110", "city": "110100" })),
            Value::Null
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110000", "city": "310000" })),
            Value::Null
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110000", "city": "1101" })),
            Value::Null
        );
        assert_eq!(
            normalize(json!({ "region": "CN", "province": "110000", "city": null })),
            Value::Null
        );
    }
}
