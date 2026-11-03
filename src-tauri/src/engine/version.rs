use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppUpdate {
    pub version: String,
    pub current: String,
    pub newer: bool,
    pub url: Option<String>,
}

pub fn version_is_newer(latest: &str, current: &str) -> bool {
    cmp_versions(latest, current) == Ordering::Greater
}

pub fn parse_release(body: &str, current: &str) -> Option<AppUpdate> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let version = value.get("tag_name")?.as_str()?.trim().to_string();
    if version.is_empty() {
        return None;
    }
    let url = value
        .get("html_url")
        .and_then(|url| url.as_str())
        .map(str::to_string);
    Some(AppUpdate {
        newer: version_is_newer(&version, current),
        version,
        current: current.to_string(),
        url,
    })
}

fn cmp_versions(left: &str, right: &str) -> Ordering {
    let left = parts(left);
    let right = parts(right);
    let len = left.len().max(right.len());
    for index in 0..len {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        match a.cmp(&b) {
            Ordering::Equal => {}
            order => return order,
        }
    }
    Ordering::Equal
}

fn parts(value: &str) -> Vec<u64> {
    let normalized = normalize_version(value);
    normalized
        .split(['.', '-', '+'])
        .map_while(|part| {
            if part.is_empty() || !part.chars().all(|ch| ch.is_ascii_digit()) {
                None
            } else {
                part.parse::<u64>().ok()
            }
        })
        .collect()
}

fn normalize_version(value: &str) -> String {
    let trimmed = value.trim().trim_start_matches(['v', 'V']);
    if let Some(start) = trimmed.find(|ch: char| ch.is_ascii_digit()) {
        let slice = &trimmed[start..];
        let end = slice
            .find(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
            .unwrap_or(slice.len());
        return slice[..end].trim_matches('.').to_string();
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_release, version_is_newer};

    #[test]
    fn compares_dotted_versions() {
        assert!(version_is_newer("0.2.0", "0.1.0"));
        assert!(version_is_newer("v1.0.0", "0.9.9"));
        assert!(version_is_newer("1.0.10", "1.0.9"));
        assert!(version_is_newer("2026.10.26", "2026.08.19"));
        assert!(!version_is_newer("v0.1.0", "0.1.0"));
        assert!(!version_is_newer("1.2", "1.2.0"));
        assert!(!version_is_newer("0.1.0", "0.2.0"));
        assert!(!version_is_newer("2026.10.26", "2026.10.26"));
    }

    #[test]
    fn parses_github_release_without_downloading() {
        let body = r#"{"tag_name":"v0.2.0","html_url":"https://example.com/rel"}"#;
        let update = parse_release(body, "0.1.0").unwrap();
        assert!(update.newer);
        assert_eq!(update.version, "v0.2.0");
        assert_eq!(update.current, "0.1.0");
        assert_eq!(update.url.as_deref(), Some("https://example.com/rel"));
        let same = parse_release(r#"{"tag_name":"v0.1.0"}"#, "0.1.0").unwrap();
        assert!(!same.newer);
        assert!(parse_release("not-json", "0.1.0").is_none());
    }
}
