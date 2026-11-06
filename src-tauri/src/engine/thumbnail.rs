use crate::engine::queue::Engine;
use image::ImageEncoder;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_THUMBNAIL_BYTES: u64 = 10 * 1024 * 1024;
const MAX_THUMBNAIL_PIXELS: u64 = 40_000_000;

pub fn download_thumbnail(data_dir: &Path, id: &str, url: Option<&str>) -> Option<String> {
    let url = url?;
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return None;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let mut response = client.get(url).send().ok()?.error_for_status().ok()?;
    if response
        .content_length()
        .is_some_and(|len| len > MAX_THUMBNAIL_BYTES)
    {
        return None;
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_THUMBNAIL_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_THUMBNAIL_BYTES {
        return None;
    }
    let dimensions = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    if u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_THUMBNAIL_PIXELS {
        return None;
    }
    let image = image::load_from_memory(&bytes).ok()?.thumbnail(480, 480);
    let rgba = image.to_rgba8();
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .write_image(
            rgba.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    let dir = data_dir.join("thumbnails");
    fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{id}.webp"));
    fs::write(&path, webp).ok()?;
    Some(path.to_string_lossy().into_owned())
}

pub fn remove_orphans(data_dir: &Path, engine: &Engine) {
    let dir = data_dir.join("thumbnails");
    let referenced = engine
        .pending
        .iter()
        .filter_map(|item| item.thumbnail.as_deref())
        .chain(
            engine
                .active
                .iter()
                .filter_map(|item| item.thumbnail.as_deref()),
        )
        .chain(
            engine
                .session
                .iter()
                .filter_map(|item| item.thumbnail.as_deref()),
        )
        .chain(
            engine
                .history
                .iter()
                .filter_map(|item| item.thumbnail.as_deref()),
        )
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .collect::<std::collections::HashSet<_>>();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "webp")
            && path
                .canonicalize()
                .is_ok_and(|path| !referenced.contains(&path))
        {
            let _ = fs::remove_file(path);
        }
    }
}
