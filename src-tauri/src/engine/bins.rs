use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolPaths {
    pub ytdlp: PathBuf,
    pub ffmpeg_dir: PathBuf,
}

pub fn resolve_ytdlp(data_dir: &Path) -> Result<PathBuf, String> {
    let updated = data_dir.join("bin").join(ytdlp_filename());
    if updated.is_file() {
        return Ok(updated);
    }
    Err("yt-dlp not found".into())
}

pub fn resolve_ffmpeg(data_dir: &Path) -> Result<PathBuf, String> {
    let path = data_dir.join("bin").join(ffmpeg_filename());
    path.is_file().then_some(path).ok_or_else(|| "ffmpeg not found".into())
}

pub fn resolve_tools(data_dir: &Path) -> Result<ToolPaths, String> {
    let ytdlp = resolve_ytdlp(data_dir)?;
    let ffmpeg = resolve_ffmpeg(data_dir)?;
    let ffmpeg_dir = ffmpeg
        .parent()
        .ok_or_else(|| "ffmpeg not found".to_string())?
        .to_path_buf();
    Ok(ToolPaths { ytdlp, ffmpeg_dir })
}

pub fn ytdlp_filename() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

pub fn deno_filename() -> &'static str {
    if cfg!(windows) { "deno.exe" } else { "deno" }
}

pub fn ffmpeg_filename() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_ffmpeg, resolve_tools, resolve_ytdlp};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ytdlp_resolves_from_the_local_bin() {
        let data = scratch("data");
        fs::create_dir_all(data.join("bin")).unwrap();
        let updated = data.join("bin").join(super::ytdlp_filename());
        fs::write(&updated, b"new").unwrap();
        let resolved = resolve_ytdlp(&data).unwrap();
        assert_eq!(fs::read(resolved).unwrap(), b"new");
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn missing_binaries_are_plain_errors() {
        let data = scratch("empty");
        assert_eq!(
            resolve_ytdlp(&data).unwrap_err(),
            "yt-dlp not found"
        );
        assert_eq!(
            resolve_tools(&data).unwrap_err(),
            "yt-dlp not found"
        );
        assert_eq!(resolve_ffmpeg(&data).unwrap_err(), "ffmpeg not found");
        fs::create_dir_all(data.join("bin")).unwrap();
        let ffmpeg = data.join("bin").join(super::ffmpeg_filename());
        fs::write(&ffmpeg, b"ff").unwrap();
        assert_eq!(
            resolve_ffmpeg(&data).unwrap(),
            ffmpeg
        );
        let _ = fs::remove_dir_all(data);
    }
}
