use std::time::Duration;
use std::{fs, io::Write, path::Path};

const USER_AGENT: &str = concat!(
    "Downly/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/yt-dlp/yt-dlp)"
);
const MAX_TEXT_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

pub async fn download_to_file(
    url: &str,
    path: &Path,
    max_bytes: u64,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let mut response = download_client()?
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    let total = response.content_length();
    if total.is_some_and(|length| length > max_bytes) {
        return Err("response exceeds the allowed size".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut file = fs::File::create(path).map_err(|err| err.to_string())?;
    let result = async {
        let mut received = 0_u64;
        while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
            received = received.saturating_add(chunk.len() as u64);
            if received > max_bytes {
                return Err("response exceeds the allowed size".into());
            }
            file.write_all(&chunk).map_err(|err| err.to_string())?;
            on_progress(received, total);
        }
        file.sync_all().map_err(|err| err.to_string())
    }
    .await;
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

async fn get_bytes_limited(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("response exceeds the allowed size".into());
    }
    let mut bytes = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("response exceeds the allowed size".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn get_text(url: &str) -> Result<String, String> {
    let bytes = get_bytes_limited(url, MAX_TEXT_RESPONSE_BYTES).await?;
    String::from_utf8(bytes).map_err(|err| err.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| err.to_string())
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::download_to_file;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn removes_a_partial_file_when_the_response_ends_early() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 64\r\nConnection: close\r\n\r\npartial",
                )
                .unwrap();
        });
        let path = std::env::temp_dir().join(format!(
            "downly-partial-download-{}-{}.bin",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        let result =
            download_to_file(&format!("http://{address}/asset"), &path, 128, |_, _| {}).await;
        server.join().unwrap();

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn retries_a_partial_download_without_reusing_its_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for response in [
                &b"HTTP/1.1 200 OK\r\nContent-Length: 64\r\nConnection: close\r\n\r\npartial"[..],
                &b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ncomplete"[..],
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0; 1024];
                let _ = stream.read(&mut request).unwrap();
                stream.write_all(response).unwrap();
            }
        });
        let path = std::env::temp_dir().join(format!(
            "downly-retried-download-{}-{}.bin",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let url = format!("http://{address}/asset");

        assert!(download_to_file(&url, &path, 128, |_, _| {}).await.is_err());
        assert!(!path.exists());
        download_to_file(&url, &path, 128, |_, _| {}).await.unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"complete");
        let _ = std::fs::remove_file(path);
    }
}
