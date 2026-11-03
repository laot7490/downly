use crate::engine::classify::{RejectReason, is_youtube_url};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MediaFormat {
    pub format_id: String,
    pub ext: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub protocol: Option<String>,
    pub note: Option<String>,
    pub video_only: bool,
    pub audio_only: bool,
    pub storyboard: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlaylistEntry {
    pub url: String,
    pub title: Option<String>,
    pub id: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlaylistSummary {
    pub title: Option<String>,
    pub count: usize,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProbeOutcome {
    Video {
        id: String,
        title: String,
        duration: Option<f64>,
        channel: Option<String>,
        thumbnail: Option<String>,
        view_count: Option<u64>,
        formats: Vec<MediaFormat>,
    },
    Playlist {
        title: Option<String>,
        count: usize,
        entries: Vec<PlaylistEntry>,
    },
    Rejected {
        reason: RejectReason,
    },
}

pub fn parse_probe(stdout: &str, page_url: &str) -> Result<ProbeOutcome, String> {
    let value: Value = serde_json::from_str(json_slice(stdout)).map_err(|err| err.to_string())?;
    if !value.is_object() {
        return Err("unexpected json".into());
    }
    if is_live(&value) {
        return Ok(ProbeOutcome::Rejected {
            reason: RejectReason::Live,
        });
    }
    if is_playlist_json(&value) {
        let summary = playlist_from(&value, page_url);
        return Ok(ProbeOutcome::Playlist {
            title: summary.title,
            count: summary.count,
            entries: summary.entries,
        });
    }
    video_from(&value)
}

pub fn summary_from_outcome(outcome: ProbeOutcome) -> Result<PlaylistSummary, String> {
    match outcome {
        ProbeOutcome::Playlist {
            title,
            count,
            entries,
        } => Ok(PlaylistSummary {
            title,
            count,
            entries,
        }),
        ProbeOutcome::Rejected { reason } => Err(reason.as_str().into()),
        ProbeOutcome::Video { .. } => Err("not a playlist".into()),
    }
}

fn video_from(value: &Value) -> Result<ProbeOutcome, String> {
    let id = opt_string(value, "id").ok_or_else(|| "missing id".to_string())?;
    let title = opt_string(value, "title").unwrap_or_else(|| id.clone());
    let formats = value
        .get("formats")
        .and_then(|formats| formats.as_array())
        .map(|formats| formats.iter().filter_map(format_from).collect())
        .unwrap_or_default();
    Ok(ProbeOutcome::Video {
        id,
        title,
        duration: opt_f64(value, "duration"),
        channel: opt_string(value, "channel")
            .or_else(|| opt_string(value, "uploader"))
            .or_else(|| opt_string(value, "channel_name")),
        thumbnail: thumbnail_of(value),
        view_count: opt_u64(value, "view_count"),
        formats,
    })
}

fn playlist_from(value: &Value, page_url: &str) -> PlaylistSummary {
    let entries = value
        .get("entries")
        .and_then(|entries| entries.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry_from(entry, page_url))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    PlaylistSummary {
        title: opt_string(value, "title"),
        count: entries.len(),
        entries,
    }
}

fn entry_from(entry: &Value, page_url: &str) -> Option<PlaylistEntry> {
    if !entry.is_object() {
        return None;
    }
    let id = opt_string(entry, "id");
    let url = entry_url(entry, page_url, id.as_deref())?;
    Some(PlaylistEntry {
        url,
        title: opt_string(entry, "title"),
        id,
        thumbnail: thumbnail_of(entry),
    })
}

fn entry_url(entry: &Value, page_url: &str, id: Option<&str>) -> Option<String> {
    if let Some(page) = opt_string(entry, "webpage_url") {
        return Some(page);
    }
    if let Some(url) = opt_string(entry, "url") {
        if url.starts_with("http://") || url.starts_with("https://") {
            return Some(url);
        }
        if is_youtube_url(page_url) || ie_is_youtube(entry) {
            let id = id.unwrap_or(url.as_str());
            if !id.is_empty() {
                return Some(format!("https://www.youtube.com/watch?v={id}"));
            }
        }
        if !url.is_empty() {
            return Some(url);
        }
    }
    id.filter(|id| !id.is_empty())
        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
}

fn ie_is_youtube(entry: &Value) -> bool {
    opt_string(entry, "ie_key")
        .map(|key| key.eq_ignore_ascii_case("youtube"))
        .unwrap_or(false)
}

fn format_from(value: &Value) -> Option<MediaFormat> {
    let format_id = opt_string(value, "format_id")?;
    let ext = opt_string(value, "ext");
    let vcodec = opt_string(value, "vcodec");
    let acodec = opt_string(value, "acodec");
    let protocol = opt_string(value, "protocol");
    let note = opt_string(value, "format_note");
    let storyboard = is_storyboard(
        &format_id,
        protocol.as_deref().unwrap_or(""),
        note.as_deref().unwrap_or(""),
        ext.as_deref().unwrap_or(""),
    );
    let video = has_codec(vcodec.as_deref().unwrap_or(""));
    let audio = has_codec(acodec.as_deref().unwrap_or(""));
    Some(MediaFormat {
        format_id,
        ext,
        resolution: opt_string(value, "resolution"),
        fps: opt_f64(value, "fps"),
        vcodec,
        acodec,
        filesize: opt_u64(value, "filesize"),
        filesize_approx: opt_u64(value, "filesize_approx"),
        protocol,
        note,
        video_only: !storyboard && video && !audio,
        audio_only: !storyboard && audio && !video,
        storyboard,
    })
}

fn is_storyboard(format_id: &str, protocol: &str, note: &str, ext: &str) -> bool {
    let format_id = format_id.to_ascii_lowercase();
    note.to_ascii_lowercase().contains("storyboard")
        || protocol.eq_ignore_ascii_case("mhtml")
        || ext.eq_ignore_ascii_case("mhtml")
        || format_id.starts_with("sb")
}

fn has_codec(codec: &str) -> bool {
    let codec = codec.trim();
    !codec.is_empty() && !codec.eq_ignore_ascii_case("none")
}

fn is_live(value: &Value) -> bool {
    value
        .get("is_live")
        .and_then(|flag| flag.as_bool())
        .unwrap_or(false)
}

fn is_playlist_json(value: &Value) -> bool {
    opt_string(value, "_type").as_deref() == Some("playlist")
        || (value
            .get("entries")
            .and_then(|entries| entries.as_array())
            .is_some()
            && value.get("formats").is_none())
}

fn thumbnail_of(value: &Value) -> Option<String> {
    if let Some(url) = opt_string(value, "thumbnail") {
        return Some(url);
    }
    let thumbs = value.get("thumbnails")?.as_array()?;
    for thumb in thumbs.iter().rev() {
        if let Some(url) = thumb.as_str() {
            return Some(url.to_string());
        }
        if let Some(url) = thumb.get("url").and_then(|url| url.as_str())
            && !url.is_empty()
        {
            return Some(url.to_string());
        }
    }
    None
}

fn opt_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn opt_f64(value: &Value, key: &str) -> Option<f64> {
    let item = value.get(key)?;
    item.as_f64()
        .or_else(|| item.as_i64().map(|number| number as f64))
        .or_else(|| item.as_u64().map(|number| number as f64))
        .filter(|number| number.is_finite())
}

fn opt_u64(value: &Value, key: &str) -> Option<u64> {
    let item = value.get(key)?;
    if let Some(number) = item.as_u64() {
        return Some(number);
    }
    if let Some(number) = item.as_i64() {
        return u64::try_from(number).ok();
    }
    if let Some(number) = item.as_f64()
        && number >= 0.0
        && number.is_finite()
    {
        return Some(number as u64);
    }
    None
}

fn json_slice(stdout: &str) -> &str {
    let stdout = stdout.trim().trim_start_matches('\u{feff}');
    let Some(start) = stdout.find(['{', '[']) else {
        return stdout;
    };
    let Some(end) = stdout.rfind(['}', ']']) else {
        return stdout;
    };
    if start < end {
        &stdout[start..end + 1]
    } else {
        stdout
    }
}

#[cfg(test)]
mod tests {
    use super::{ProbeOutcome, parse_probe};
    use crate::engine::classify::RejectReason;

    #[test]
    fn parses_video_formats_and_keeps_storyboard() {
        let json = r#"
        {
          "id": "abc",
          "title": "Hello",
          "duration": 12,
          "channel": "Chan",
          "view_count": 1200,
          "thumbnail": "https://img/thumb.jpg",
          "is_live": false,
          "formats": [
            {
              "format_id": "137",
              "ext": "mp4",
              "resolution": "1920x1080",
              "fps": 30,
              "vcodec": "avc1.640028",
              "acodec": "none",
              "filesize": 100,
              "protocol": "https",
              "format_note": "1080p"
            },
            {
              "format_id": "140",
              "ext": "m4a",
              "resolution": "audio only",
              "vcodec": "none",
              "acodec": "mp4a.40.2",
              "filesize_approx": 20,
              "protocol": "https",
              "format_note": "medium"
            },
            {
              "format_id": "sb0",
              "ext": "mhtml",
              "resolution": "48x27",
              "vcodec": "none",
              "acodec": "none",
              "protocol": "mhtml",
              "format_note": "storyboard"
            }
          ]
        }
        "#;
        let ProbeOutcome::Video {
            id,
            title,
            duration,
            channel,
            thumbnail,
            view_count,
            formats,
        } = parse_probe(json, "https://www.youtube.com/watch?v=abc").unwrap()
        else {
            panic!("video");
        };
        assert_eq!(id, "abc");
        assert_eq!(title, "Hello");
        assert_eq!(duration, Some(12.0));
        assert_eq!(channel.as_deref(), Some("Chan"));
        assert_eq!(view_count, Some(1200));
        assert_eq!(thumbnail.as_deref(), Some("https://img/thumb.jpg"));
        assert_eq!(formats.len(), 3);
        assert!(formats[0].video_only);
        assert!(!formats[0].audio_only);
        assert!(!formats[0].storyboard);
        assert_eq!(formats[0].filesize, Some(100));
        assert!(formats[1].audio_only);
        assert_eq!(formats[1].filesize_approx, Some(20));
        assert!(formats[2].storyboard);
        assert!(!formats[2].video_only);
        assert!(!formats[2].audio_only);
    }

    #[test]
    fn rejects_live_and_parses_playlist_entries() {
        let live = r#"{"id":"live1","title":"Now","is_live":true,"formats":[]}"#;
        match parse_probe(live, "https://www.twitch.tv/someone").unwrap() {
            ProbeOutcome::Rejected { reason } => assert_eq!(reason, RejectReason::Live),
            other => panic!("{other:?}"),
        }
        let vod = r#"{"id":"vod","title":"Vod","is_live":false,"was_live":true,"formats":[]}"#;
        assert!(matches!(
            parse_probe(vod, "https://www.twitch.tv/videos/1").unwrap(),
            ProbeOutcome::Video { .. }
        ));
        let playlist = r#"
        {
          "_type": "playlist",
          "title": "Mix list",
          "entries": [
            {"id": "aaa", "title": "One", "url": "aaa", "ie_key": "Youtube"},
            null,
            {"id": "bbb", "title": "Two", "webpage_url": "https://www.youtube.com/watch?v=bbb", "thumbnail": "https://img/b.jpg"}
          ]
        }
        "#;
        match parse_probe(playlist, "https://www.youtube.com/playlist?list=PLxxxx").unwrap() {
            ProbeOutcome::Playlist {
                title,
                count,
                entries,
            } => {
                assert_eq!(title.as_deref(), Some("Mix list"));
                assert_eq!(count, 2);
                assert_eq!(entries[0].url, "https://www.youtube.com/watch?v=aaa");
                assert_eq!(entries[0].id.as_deref(), Some("aaa"));
                assert_eq!(entries[1].url, "https://www.youtube.com/watch?v=bbb");
                assert_eq!(entries[1].thumbnail.as_deref(), Some("https://img/b.jpg"));
            }
            other => panic!("{other:?}"),
        }
    }
}
