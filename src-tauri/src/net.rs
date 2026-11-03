use std::time::Duration;

const USER_AGENT: &str = concat!(
    "Downly/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/yt-dlp/yt-dlp)"
);

pub async fn get_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: {}", response.status()));
    }
    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|err| err.to_string())
}

pub async fn get_text(url: &str) -> Result<String, String> {
    let bytes = get_bytes(url).await?;
    String::from_utf8(bytes).map_err(|err| err.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| err.to_string())
}
