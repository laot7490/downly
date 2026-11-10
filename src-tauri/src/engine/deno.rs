use crate::engine::bins::deno_filename;
use std::path::{Path, PathBuf};

pub fn resolve_deno(data_dir: &Path) -> Option<PathBuf> {
    let path = data_dir.join("bin").join(deno_filename());
    path.is_file().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::resolve_deno;
    use crate::engine::bins::deno_filename;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn resolves_only_the_local_bin_executable() {
        let data_dir = std::env::temp_dir().join(format!(
            "downly-deno-path-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        assert!(resolve_deno(&data_dir).is_none());
        fs::create_dir_all(data_dir.join("bin")).unwrap();
        let path = data_dir.join("bin").join(deno_filename());
        fs::write(&path, b"deno").unwrap();
        assert_eq!(resolve_deno(&data_dir), Some(path));
        let _ = fs::remove_dir_all(data_dir);
    }
}
