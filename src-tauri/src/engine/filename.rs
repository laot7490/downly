pub const OUTPUT_TEMPLATE: &str = "%(title).200B [%(id)s].%(ext)s";

pub fn sanitize_filename(title: &str, id: &str, ext: &str) -> String {
    let title = sanitize_title(title);
    let title = if title.is_empty() {
        "video".to_string()
    } else {
        title
    };
    let id = sanitize_piece(id);
    let id = if id.is_empty() {
        "item".to_string()
    } else {
        id
    };
    let ext = sanitize_ext(ext);
    if ext.is_empty() {
        format!("{title} [{id}]")
    } else {
        format!("{title} [{id}].{ext}")
    }
}

pub fn id_marker(id: &str) -> String {
    format!(" [{id}].")
}

pub fn file_contains_id(dir: &std::path::Path, id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    let needle = id_marker(id);
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy().contains(&needle) {
            return true;
        }
    }
    false
}

fn sanitize_title(title: &str) -> String {
    let cleaned: String = title.chars().filter(|c| !is_forbidden(*c)).collect();
    let trimmed: String = cleaned.chars().take(200).collect();
    trimmed
        .trim()
        .trim_end_matches(['.', ' '])
        .trim()
        .to_string()
}

fn sanitize_piece(value: &str) -> String {
    value
        .chars()
        .filter(|c| !is_forbidden(*c))
        .collect::<String>()
        .trim()
        .to_string()
}

fn sanitize_ext(ext: &str) -> String {
    sanitize_piece(ext.trim().trim_start_matches('.'))
        .chars()
        .filter(|c| *c != ' ')
        .collect()
}

fn is_forbidden(c: char) -> bool {
    matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control()
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn builds_title_id_ext() {
        assert_eq!(
            sanitize_filename("Hello", "dQw4w9WgXcQ", "mp4"),
            "Hello [dQw4w9WgXcQ].mp4"
        );
        assert_eq!(
            sanitize_filename("Hello", "dQw4w9WgXcQ", ".mp4"),
            "Hello [dQw4w9WgXcQ].mp4"
        );
    }

    #[test]
    fn strips_windows_forbidden_characters() {
        assert_eq!(
            sanitize_filename("a<b>c:d\"e/f\\g|h?i*j", "id", "mp4"),
            "abcdefghij [id].mp4"
        );
        assert_eq!(
            sanitize_filename("Hello\nWorld\t!", "id", "mkv"),
            "HelloWorld! [id].mkv"
        );
        assert!(!sanitize_filename("a<b>", "id", "mp4").contains('<'));
    }

    #[test]
    fn limits_title_to_200_chars() {
        let title = "あ".repeat(250);
        let out = sanitize_filename(&title, "id", "mkv");
        assert!(out.ends_with(" [id].mkv"));
        let head = out.trim_end_matches(" [id].mkv");
        assert_eq!(head.chars().count(), 200);
    }

    #[test]
    fn empty_title_falls_back() {
        assert_eq!(sanitize_filename("   ", "abc", "mp4"), "video [abc].mp4");
        assert_eq!(sanitize_filename("...", "abc", "mp4"), "video [abc].mp4");
    }

    #[test]
    fn file_scan_matches_id_marker() {
        let dir = std::env::temp_dir().join(format!(
            "downly-name-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Song [abc].mp3"), b"x").unwrap();
        fs::write(dir.join("Other [zzz].mp4"), b"x").unwrap();
        assert!(super::file_contains_id(&dir, "abc"));
        assert!(!super::file_contains_id(&dir, "ab"));
        assert!(!super::file_contains_id(&dir, "missing"));
        let _ = fs::remove_dir_all(&dir);
    }
}
