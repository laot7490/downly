use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

pub const YTDLP_EXE_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
pub const YTDLP_SUMS_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";

pub fn sha256_matches(sums: &str, filename: &str, bytes: &[u8]) -> bool {
    let digest = hex::encode(Sha256::digest(bytes));
    for line in sums.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else {
            continue;
        };
        let Some(name) = parts.next() else {
            continue;
        };
        let name = name.trim_start_matches('*');
        if name == filename && hash.eq_ignore_ascii_case(&digest) {
            return true;
        }
    }
    false
}

pub fn install_verified(
    dir: &Path,
    filename: &str,
    bytes: &[u8],
    sums: &str,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    if !sha256_matches(sums, filename, bytes) {
        return Err("hash mismatch".into());
    }
    let final_path = dir.join(filename);
    let staged = dir.join(format!("{filename}.new"));
    fs::write(&staged, bytes).map_err(|err| err.to_string())?;
    let staged_bytes = fs::read(&staged).map_err(|err| err.to_string())?;
    if staged_bytes != bytes || !sha256_matches(sums, filename, &staged_bytes) {
        let _ = fs::remove_file(&staged);
        return Err("hash mismatch".into());
    }
    let backup = dir.join(format!("{filename}.bak"));
    if final_path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&final_path, &backup).map_err(|err| err.to_string())?;
    }
    if let Err(err) = fs::rename(&staged, &final_path) {
        let _ = fs::rename(&backup, &final_path);
        return Err(err.to_string());
    }
    let _ = fs::remove_file(&backup);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::install_verified;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const ABC_SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-sha-{}-{}",
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
    fn installs_when_the_hash_matches() {
        let dir = scratch();
        let sums = format!("{ABC_SHA} *yt-dlp.exe\n");
        install_verified(&dir, "yt-dlp.exe", b"abc", &sums).unwrap();
        assert_eq!(fs::read(dir.join("yt-dlp.exe")).unwrap(), b"abc");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn mismatch_leaves_the_old_file() {
        let dir = scratch();
        let target = dir.join("yt-dlp.exe");
        fs::write(&target, b"old").unwrap();
        let sums = format!("{}  yt-dlp.exe\n", "0".repeat(64));
        let err = install_verified(&dir, "yt-dlp.exe", b"abc", &sums).unwrap_err();
        assert_eq!(err, "hash mismatch");
        assert_eq!(fs::read(&target).unwrap(), b"old");
        assert!(!dir.join("yt-dlp.exe.new").exists());
        let _ = fs::remove_dir_all(dir);
    }
}
