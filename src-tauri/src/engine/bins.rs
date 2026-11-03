use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolPaths {
    pub ytdlp: PathBuf,
    pub ffmpeg_dir: PathBuf,
}

pub fn resolve_ytdlp(data_dir: &Path, bundled: &[PathBuf]) -> Result<PathBuf, String> {
    let updated = data_dir.join("bin").join(ytdlp_filename());
    if updated.is_file() {
        return Ok(updated);
    }
    first_file(bundled).ok_or_else(|| "yt-dlp not found".to_string())
}

pub fn resolve_ffmpeg(bundled: &[PathBuf]) -> Result<PathBuf, String> {
    first_file(bundled).ok_or_else(|| "ffmpeg not found".to_string())
}

pub fn resolve_tools(
    data_dir: &Path,
    ytdlp_bundled: &[PathBuf],
    ffmpeg_bundled: &[PathBuf],
) -> Result<ToolPaths, String> {
    let ytdlp = resolve_ytdlp(data_dir, ytdlp_bundled)?;
    let ffmpeg = resolve_ffmpeg(ffmpeg_bundled)?;
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

fn first_file(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.is_file()).cloned()
}

#[cfg(test)]
mod tests {
    use super::{resolve_ffmpeg, resolve_ytdlp};
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
    fn updated_ytdlp_wins_over_bundled() {
        let data = scratch("data");
        let bundled_dir = scratch("bundle");
        let bundled = bundled_dir.join(super::ytdlp_filename());
        fs::write(&bundled, b"old").unwrap();
        fs::create_dir_all(data.join("bin")).unwrap();
        let updated = data.join("bin").join(super::ytdlp_filename());
        fs::write(&updated, b"new").unwrap();
        let resolved = resolve_ytdlp(&data, &[bundled]).unwrap();
        assert_eq!(fs::read(resolved).unwrap(), b"new");
        let _ = fs::remove_dir_all(data);
        let _ = fs::remove_dir_all(bundled_dir);
    }

    #[test]
    fn missing_binaries_are_plain_errors() {
        let data = scratch("empty");
        let missing = data.join("nope").join(super::ytdlp_filename());
        assert_eq!(
            resolve_ytdlp(&data, std::slice::from_ref(&missing)).unwrap_err(),
            "yt-dlp not found"
        );
        assert_eq!(resolve_ffmpeg(&[missing]).unwrap_err(), "ffmpeg not found");
        let ffmpeg = data.join(super::ffmpeg_filename());
        fs::write(&ffmpeg, b"ff").unwrap();
        assert_eq!(
            resolve_ffmpeg(std::slice::from_ref(&ffmpeg)).unwrap(),
            ffmpeg
        );
        let _ = fs::remove_dir_all(data);
    }
}
