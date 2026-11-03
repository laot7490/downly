use crate::engine::bins::deno_filename;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub const DENO_ZIP_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";

pub fn resolve_deno(data_dir: &Path) -> Option<PathBuf> {
    let path = data_dir.join("bin").join(deno_filename());
    path.is_file().then_some(path)
}

pub fn install_deno_zip(dir: &Path, zip_bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(Cursor::new(zip_bytes)).map_err(|err| err.to_string())?;
    let name = deno_filename();
    let mut found = None;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|err| err.to_string())?;
        let Some(path) = file.enclosed_name() else {
            continue;
        };
        if path.file_name().and_then(|part| part.to_str()) != Some(name) {
            continue;
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|err| err.to_string())?;
        if bytes.is_empty() {
            return Err("deno archive entry is empty".into());
        }
        found = Some(bytes);
        break;
    }
    let bytes = found.ok_or_else(|| format!("{name} missing from deno archive"))?;
    let final_path = dir.join(name);
    let staged = dir.join(format!("{name}.new"));
    fs::write(&staged, &bytes).map_err(|err| err.to_string())?;
    let backup = dir.join(format!("{name}.bak"));
    if final_path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(&final_path, &backup).map_err(|err| err.to_string())?;
    }
    if let Err(err) = fs::rename(&staged, &final_path) {
        let _ = fs::rename(&backup, &final_path);
        return Err(err.to_string());
    }
    let _ = fs::remove_file(&backup);
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::install_deno_zip;
    use crate::engine::bins::deno_filename;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-deno-{}-{}",
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
    fn installs_deno_exe_from_zip() {
        let dir = scratch();
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            zip.start_file(deno_filename(), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"deno-bin").unwrap();
            zip.finish().unwrap();
        }
        let path = install_deno_zip(&dir, cursor.get_ref()).unwrap();
        assert_eq!(path, dir.join(deno_filename()));
        assert_eq!(fs::read(path).unwrap(), b"deno-bin");
        let _ = fs::remove_dir_all(dir);
    }
}
