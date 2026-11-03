use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlKind {
    Video,
    Mix,
    Playlist,
    Channel,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    AddPlaylistsOnTheirOwn,
    Channel,
    Home,
    Feed,
    Unsupported,
    Live,
}

impl RejectReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AddPlaylistsOnTheirOwn => "add playlists on their own",
            Self::Channel => "channel urls are not supported",
            Self::Home => "home urls are not supported",
            Self::Feed => "feed urls are not supported",
            Self::Unsupported => "unsupported url",
            Self::Live => "live streams are not supported",
        }
    }
}

pub fn classify_url(input: &str) -> UrlKind {
    let Some(url) = parse_loose(input) else {
        return UrlKind::Other;
    };
    if url.scheme() != "http" && url.scheme() != "https" {
        return UrlKind::Other;
    }
    let Some(host) = url.host_str() else {
        return UrlKind::Other;
    };
    if !is_youtube_host(host) {
        return UrlKind::Video;
    }
    let path = url.path();
    if is_channel_path(path) {
        return UrlKind::Channel;
    }
    if let Some(list) = query(&url, "list") {
        if list.starts_with("RD") {
            return UrlKind::Mix;
        }
        return UrlKind::Playlist;
    }
    if is_playlist_path(path) {
        return UrlKind::Playlist;
    }
    if is_video_path(host, path, query(&url, "v").is_some()) {
        return UrlKind::Video;
    }
    UrlKind::Other
}

pub fn screen_url(input: &str) -> Result<UrlKind, RejectReason> {
    screen_kind(input, classify_url(input))
}

pub fn screen_batch(input: &str) -> Result<UrlKind, RejectReason> {
    match classify_url(input) {
        UrlKind::Playlist => Err(RejectReason::AddPlaylistsOnTheirOwn),
        kind => screen_kind(input, kind),
    }
}

pub fn extract_video_id(input: &str) -> Option<String> {
    let url = parse_loose(input)?;
    if let Some(id) = query(&url, "v")
        && !id.is_empty()
    {
        return Some(id);
    }
    let host = url.host_str()?.to_ascii_lowercase();
    if youtube_bare_host(&host) == "youtu.be" {
        let id = url.path().trim_matches('/');
        if !id.is_empty() && !id.contains('/') {
            return Some(id.to_string());
        }
    }
    for prefix in ["/shorts/", "/embed/", "/live/", "/v/"] {
        if let Some(id) = path_id(url.path(), prefix) {
            return Some(id);
        }
    }
    None
}

pub fn is_youtube_url(input: &str) -> bool {
    parse_loose(input)
        .and_then(|url| url.host_str().map(is_youtube_host))
        .unwrap_or(false)
}

fn screen_kind(input: &str, kind: UrlKind) -> Result<UrlKind, RejectReason> {
    match kind {
        UrlKind::Channel => {
            if is_feed_url(input) {
                Err(RejectReason::Feed)
            } else {
                Err(RejectReason::Channel)
            }
        }
        UrlKind::Other => {
            if is_home_url(input) {
                Err(RejectReason::Home)
            } else {
                Err(RejectReason::Unsupported)
            }
        }
        kind => Ok(kind),
    }
}

pub(crate) fn parse_loose(input: &str) -> Option<Url> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }
    if let Ok(url) = Url::parse(input)
        && url.has_host()
    {
        return Some(url);
    }
    Url::parse(&format!("https://{input}"))
        .ok()
        .filter(|url| url.has_host())
}

fn query(url: &Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
}

fn is_youtube_host(host: &str) -> bool {
    let host = youtube_bare_host(host);
    host == "youtube.com"
        || host == "m.youtube.com"
        || host == "music.youtube.com"
        || host == "youtube-nocookie.com"
        || host == "youtu.be"
        || host.ends_with(".youtube.com")
}

fn youtube_bare_host(host: &str) -> String {
    host.trim_start_matches("www.").to_ascii_lowercase()
}

fn is_channel_path(path: &str) -> bool {
    let path = normalize_path(path);
    path.starts_with("/@")
        || path.starts_with("/channel/")
        || path == "/channel"
        || path.starts_with("/c/")
        || path == "/c"
        || path.starts_with("/feed/")
        || path == "/feed"
}

fn is_playlist_path(path: &str) -> bool {
    normalize_path(path).starts_with("/playlist")
}

fn is_video_path(host: &str, path: &str, has_v: bool) -> bool {
    let host = youtube_bare_host(host);
    if host == "youtu.be" {
        let id = path.trim_matches('/');
        return !id.is_empty() && !id.contains('/');
    }
    let path = normalize_path(path);
    if path.starts_with("/watch") {
        return has_v;
    }
    path_id(&path, "/shorts/").is_some()
        || path_id(&path, "/embed/").is_some()
        || path_id(&path, "/live/").is_some()
        || path_id(&path, "/v/").is_some()
}

fn path_id(path: &str, prefix: &str) -> Option<String> {
    let lower = path.to_ascii_lowercase();
    let rest = lower.strip_prefix(prefix)?;
    let segment = rest.split('/').next().unwrap_or("");
    if segment.is_empty() {
        return None;
    }
    let start = prefix.len();
    path.get(start..start + segment.len())
        .map(|value| value.to_string())
}

fn normalize_path(path: &str) -> String {
    let path = path.trim_end_matches('/');
    if path.is_empty() {
        "/".to_string()
    } else {
        path.to_ascii_lowercase()
    }
}

fn is_feed_url(input: &str) -> bool {
    parse_loose(input)
        .map(|url| {
            let path = normalize_path(url.path());
            path == "/feed" || path.starts_with("/feed/")
        })
        .unwrap_or(false)
}

fn is_home_url(input: &str) -> bool {
    let Some(url) = parse_loose(input) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if !is_youtube_host(host) {
        return false;
    }
    let path = normalize_path(url.path());
    path == "/" || path == "/results" || path.starts_with("/results/")
}

#[cfg(test)]
mod tests {
    use super::{RejectReason, UrlKind, classify_url, extract_video_id, screen_batch, screen_url};

    #[test]
    fn classifies_youtube_urls() {
        assert_eq!(
            classify_url("youtube.com/watch?v=abc&list=RDxxxx"),
            UrlKind::Mix
        );
        assert_eq!(
            classify_url("https://www.youtube.com/watch?v=abc&list=RDxxxx"),
            UrlKind::Mix
        );
        assert_eq!(
            classify_url("https://www.youtube.com/watch?list=RDxxxx&v=abc"),
            UrlKind::Mix
        );
        assert_eq!(
            classify_url("youtube.com/watch?v=abc&list=PLxxxx"),
            UrlKind::Playlist
        );
        assert_eq!(
            classify_url("https://www.youtube.com/playlist?list=PLxxxx"),
            UrlKind::Playlist
        );
        assert_eq!(
            classify_url("https://www.youtube.com/@name"),
            UrlKind::Channel
        );
        assert_eq!(
            classify_url("https://www.youtube.com/channel/UCxxxx"),
            UrlKind::Channel
        );
        assert_eq!(
            classify_url("https://www.youtube.com/feed/subscriptions"),
            UrlKind::Channel
        );
        assert_eq!(
            classify_url("https://www.youtube.com/c/Name"),
            UrlKind::Channel
        );
        assert_eq!(
            classify_url("https://www.youtube.com/watch?v=abc"),
            UrlKind::Video
        );
        assert_eq!(classify_url("https://youtu.be/abc"), UrlKind::Video);
        assert_eq!(
            classify_url("https://www.youtube.com/shorts/abc"),
            UrlKind::Video
        );
        assert_eq!(classify_url("https://www.youtube.com/"), UrlKind::Other);
        assert_eq!(
            classify_url("https://www.youtube.com/results?search_query=cat"),
            UrlKind::Other
        );
        assert_eq!(
            classify_url("https://www.twitch.tv/videos/123"),
            UrlKind::Video
        );
        assert_eq!(classify_url("not a url"), UrlKind::Other);
    }

    #[test]
    fn screens_rejections_and_batch_playlists() {
        assert_eq!(
            screen_url("https://www.youtube.com/feed/subscriptions"),
            Err(RejectReason::Feed)
        );
        assert_eq!(
            screen_url("https://www.youtube.com/@name"),
            Err(RejectReason::Channel)
        );
        assert_eq!(
            screen_url("https://www.youtube.com/"),
            Err(RejectReason::Home)
        );
        assert_eq!(screen_url("not a url"), Err(RejectReason::Unsupported));
        assert_eq!(
            screen_url("https://www.youtube.com/playlist?list=PLxxxx"),
            Ok(UrlKind::Playlist)
        );
        assert_eq!(
            screen_batch("https://www.youtube.com/playlist?list=PLxxxx"),
            Err(RejectReason::AddPlaylistsOnTheirOwn)
        );
        assert_eq!(
            screen_batch("https://www.youtube.com/watch?v=abc&list=PLxxxx"),
            Err(RejectReason::AddPlaylistsOnTheirOwn)
        );
        assert_eq!(
            screen_batch("https://www.youtube.com/watch?v=abc&list=RDxxxx"),
            Ok(UrlKind::Mix)
        );
        assert_eq!(
            screen_batch("https://www.youtube.com/watch?v=abc"),
            Ok(UrlKind::Video)
        );
    }

    #[test]
    fn extracts_video_ids() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=abc&list=RDxxxx").as_deref(),
            Some("abc")
        );
        assert_eq!(
            extract_video_id("https://youtu.be/abc").as_deref(),
            Some("abc")
        );
        assert_eq!(
            extract_video_id("https://www.youtube.com/shorts/abc").as_deref(),
            Some("abc")
        );
        assert_eq!(
            extract_video_id("https://www.youtube.com/playlist?list=PL"),
            None
        );
    }
}
