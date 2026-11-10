use crate::engine::queue::Engine;
use image::ImageEncoder;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use url::Url;

const MAX_THUMBNAIL_BYTES: u64 = 10 * 1024 * 1024;
const MAX_THUMBNAIL_PIXELS: u64 = 40_000_000;

pub fn download_thumbnail(data_dir: &Path, id: &str, url: Option<&str>) -> Option<String> {
    let url = url?;
    let bytes = fetch_thumbnail_bytes(url)?;
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

fn fetch_thumbnail_bytes(raw_url: &str) -> Option<Vec<u8>> {
    let mut url = Url::parse(raw_url).ok()?;
    if url.scheme() != "https" { return None; }
    for _ in 0..=5 {
        if url.scheme() != "https" { return None; }
        static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
        let client = CLIENT.get_or_init(|| reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build().expect("thumbnail HTTP client configuration is valid"));
        let mut response = client.get(url.clone()).send().ok()?;
        if response.status().is_redirection() {
            let location = response.headers().get(reqwest::header::LOCATION)?.to_str().ok()?;
            url = url.join(location).ok()?;
            continue;
        }
        response = response.error_for_status().ok()?;
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
        return (bytes.len() as u64 <= MAX_THUMBNAIL_BYTES).then_some(bytes);
    }
    None
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
