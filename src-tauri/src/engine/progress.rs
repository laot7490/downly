pub struct ParsedProgress {
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

pub fn parse_progress(line: &str) -> Option<ParsedProgress> {
    let line = strip_ansi(line);
    let (_, after) = line.split_once("[download]")?;
    let after = after.trim();
    let (percent_raw, rest) = after.split_once('%')?;
    let percent_raw = percent_raw.trim();
    if percent_raw.is_empty()
        || percent_raw.matches('.').count() > 1
        || !percent_raw.chars().all(|c| c.is_ascii_digit() || c == '.')
    {
        return None;
    }
    let percent = percent_raw.parse::<f64>().ok()?;
    if !percent.is_finite() {
        return None;
    }
    Some(ParsedProgress {
        percent,
        speed: field_after(rest, " at "),
        eta: field_after(rest, " ETA "),
    })
}

pub fn destination_path(line: &str) -> Option<String> {
    if line
        .to_ascii_lowercase()
        .contains("has already been downloaded")
    {
        return None;
    }
    for marker in ["Destination:", "Merging formats into"] {
        if let Some(index) = line.find(marker) {
            let rest = line[index + marker.len()..].trim();
            let rest = rest.trim_matches(['"', '\'']).trim();
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
}

pub fn printed_path(line: &str) -> Option<String> {
    let line = line.trim().trim_matches(['"', '\'']).trim();
    if line.is_empty() || line.starts_with('[') {
        return None;
    }
    if std::path::Path::new(line).is_absolute() {
        Some(line.to_string())
    } else {
        None
    }
}

fn field_after(rest: &str, marker: &str) -> Option<String> {
    let part = rest.split(marker).nth(1)?;
    let token = part.split_whitespace().next()?;
    if token.eq_ignore_ascii_case("unknown") || token.eq_ignore_ascii_case("na") {
        None
    } else {
        Some(token.to_string())
    }
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{destination_path, parse_progress, printed_path};

    #[test]
    fn parses_download_progress_line() {
        let parsed = parse_progress("[download]  12.3% of 10.00MiB at 1.20MiB/s ETA 00:03")
            .expect("progress");
        assert!((parsed.percent - 12.3).abs() < 0.001);
        assert_eq!(parsed.speed.as_deref(), Some("1.20MiB/s"));
        assert_eq!(parsed.eta.as_deref(), Some("00:03"));
    }

    #[test]
    fn parses_partial_and_unknown_progress() {
        let done = parse_progress("[download] 100% of 10.00MiB in 00:05").expect("done");
        assert!((done.percent - 100.0).abs() < 0.001);
        assert!(done.speed.is_none());
        assert!(done.eta.is_none());
        let unknown =
            parse_progress("[download]  1.0% of ~  10.00MiB at  Unknown speed ETA Unknown")
                .expect("unknown");
        assert!(unknown.speed.is_none());
        assert!(unknown.eta.is_none());
        assert!(parse_progress("[download] Destination: C:\\file.mp4").is_none());
    }

    #[test]
    fn reads_destination_and_printed_paths() {
        assert_eq!(
            destination_path("[download] Destination: C:\\Downly\\Title [id].f137.mp4").as_deref(),
            Some("C:\\Downly\\Title [id].f137.mp4")
        );
        assert_eq!(
            destination_path("[Merger] Merging formats into \"C:\\Downly\\Title [id].mp4\"")
                .as_deref(),
            Some("C:\\Downly\\Title [id].mp4")
        );
        assert!(
            destination_path("[download] C:\\Downly\\Title [id].mp4 has already been downloaded")
                .is_none()
        );
        assert_eq!(
            printed_path("C:\\Downly\\Title [id].mp4").as_deref(),
            Some("C:\\Downly\\Title [id].mp4")
        );
        assert!(printed_path("[download]  12.3% of 10.00MiB at 1.20MiB/s ETA 00:03").is_none());
        assert!(printed_path("ERROR: unsupported url").is_none());
    }
}
