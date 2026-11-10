use std::cmp::Ordering;

pub fn version_is_newer(latest: &str, current: &str) -> bool {
    cmp_versions(latest, current) == Ordering::Greater
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
    use super::version_is_newer;

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
}
