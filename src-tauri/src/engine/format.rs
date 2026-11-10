#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    VideoBest,
    Video8k,
    Video4k,
    Video2k,
    Video1080,
    Video720,
    Video480,
    Video360,
    Video240,
    Video144,
    AudioBest,
    Audio320,
    Audio256,
    Audio192,
    Audio128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatKind {
    Video,
    Audio,
    Image,
    Storyboard,
    #[default]
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveMode {
    FromNow,
    FromStart,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Selection {
    Format {
        format_id: String,
        #[serde(default)]
        pair_best_audio: bool,
        #[serde(default)]
        mp3_bitrate: Option<u32>,
        #[serde(default)]
        save_thumbnail: bool,
        #[serde(default)]
        kind: FormatKind,
        #[serde(default)]
        vcodec: String,
        #[serde(default)]
        acodec: String,
        #[serde(default)]
        label: String,
        #[serde(default)]
        output_format: String,
        #[serde(default)]
        clip: Option<ClipRange>,
    },
    Preset {
        preset: Preset,
        #[serde(default)]
        save_thumbnail: bool,
        #[serde(default)]
        label: String,
        #[serde(default)]
        clip: Option<ClipRange>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipRange {
    pub start_seconds: u64,
    pub end_seconds: u64,
}

impl Selection {
    pub fn format_id(&self) -> Option<&str> {
        match self {
            Self::Format { format_id, .. } => Some(format_id),
            Self::Preset { .. } => None,
        }
    }
}

pub fn format_args(selection: &Selection) -> Vec<String> {
    match selection {
        Selection::Preset {
            preset,
            save_thumbnail,
            ..
        } => preset_args(*preset, *save_thumbnail),
        Selection::Format {
            kind: FormatKind::Storyboard,
            format_id,
            ..
        } => vec!["-f".into(), format_id.clone()],
        Selection::Format {
            kind: FormatKind::Audio,
            format_id,
            output_format,
            mp3_bitrate,
            save_thumbnail,
            ..
        } => audio_args(
            format_id,
            output_format.eq_ignore_ascii_case("mp3") || mp3_bitrate.is_some(),
            *mp3_bitrate,
            *save_thumbnail,
        ),
        Selection::Format {
            format_id,
            mp3_bitrate: Some(bitrate),
            save_thumbnail,
            ..
        } => audio_args(format_id, true, Some(*bitrate), *save_thumbnail),
        Selection::Format {
            pair_best_audio: true,
            format_id,
            vcodec,
            acodec,
            output_format,
            save_thumbnail,
            ..
        } => pair_args(format_id, vcodec, acodec, output_format, *save_thumbnail),
        Selection::Format {
            format_id,
            kind,
            output_format,
            save_thumbnail,
            ..
        } => {
            let mut args = vec!["-f".into(), format_id.clone()];
            if matches!(kind, FormatKind::Video | FormatKind::Mixed)
                && !output_format.is_empty()
            {
                args.push("--remux-video".into());
                args.push(output_format.clone());
            }
            push_thumbnail(&mut args, *save_thumbnail);
            args
        }
    }
}

pub fn clip_args(selection: &Selection) -> Result<Vec<String>, String> {
    let clip = match selection {
        Selection::Preset { clip, .. } | Selection::Format { clip, .. } => clip,
    };
    let Some(clip) = clip else {
        return Ok(Vec::new());
    };
    if clip.end_seconds <= clip.start_seconds {
        return Err("invalid clip range".into());
    }
    if matches!(selection, Selection::Format { kind: FormatKind::Storyboard, .. }) {
        return Err("clipping is not supported for storyboard formats".into());
    }
    Ok(vec![
        "--download-sections".into(),
        format!("*{}-{}", clip.start_seconds, clip.end_seconds),
    ])
}

pub fn valid_format_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
}

fn preset_args(preset: Preset, save_thumbnail: bool) -> Vec<String> {
    let mut args = Vec::new();
    match preset {
        Preset::VideoBest => push_video(&mut args, "bv*+ba/b"),
        Preset::Video8k => push_video(&mut args, "bv*[height<=?4320]+ba/b[height<=?4320]"),
        Preset::Video4k => push_video(&mut args, "bv*[height<=?2160]+ba/b[height<=?2160]"),
        Preset::Video2k => push_video(&mut args, "bv*[height<=?1440]+ba/b[height<=?1440]"),
        Preset::Video1080 => push_video(&mut args, "bv*[height<=?1080]+ba/b[height<=?1080]"),
        Preset::Video720 => push_video(&mut args, "bv*[height<=?720]+ba/b[height<=?720]"),
        Preset::Video480 => push_video(&mut args, "bv*[height<=?480]+ba/b[height<=?480]"),
        Preset::Video360 => push_video(&mut args, "bv*[height<=?360]+ba/b[height<=?360]"),
        Preset::Video240 => push_video(&mut args, "bv*[height<=?240]+ba/b[height<=?240]"),
        Preset::Video144 => push_video(&mut args, "bv*[height<=?144]+ba/b[height<=?144]"),
        Preset::AudioBest => push_mp3(&mut args, "ba/b", "0"),
        Preset::Audio320 => push_mp3(&mut args, "ba/b", "320K"),
        Preset::Audio256 => push_mp3(&mut args, "ba/b", "256K"),
        Preset::Audio192 => push_mp3(&mut args, "ba/b", "192K"),
        Preset::Audio128 => push_mp3(&mut args, "ba/b", "128K"),
    }
    push_thumbnail(&mut args, save_thumbnail);
    args
}

fn audio_args(format_id: &str, convert_to_mp3: bool, mp3_bitrate: Option<u32>, save_thumbnail: bool) -> Vec<String> {
    let mut args = vec!["-f".into(), format_id.into()];
    if convert_to_mp3 {
        args.push("-x".into());
        args.push("--audio-format".into());
        args.push("mp3".into());
        if let Some(bitrate) = mp3_bitrate {
            args.push("--audio-quality".into());
            args.push(format!("{bitrate}K"));
        }
    }
    push_thumbnail(&mut args, save_thumbnail);
    args
}

fn pair_args(format_id: &str, vcodec: &str, acodec: &str, output_format: &str, save_thumbnail: bool) -> Vec<String> {
    let mut args = vec!["-f".into(), format!("{format_id}+bestaudio")];
    args.push("--merge-output-format".into());
    args.push(match output_format.to_ascii_lowercase().as_str() {
        "mp4" => "mp4",
        "webm" => "webm",
        "mkv" => "mkv",
        _ => merge_container(vcodec, acodec),
    }.into());
    push_thumbnail(&mut args, save_thumbnail);
    args
}

fn push_video(args: &mut Vec<String>, filter: &str) {
    args.push("-f".into());
    args.push(filter.into());
}

fn push_mp3(args: &mut Vec<String>, filter: &str, quality: &str) {
    args.push("-f".into());
    args.push(filter.into());
    args.push("-x".into());
    args.push("--audio-format".into());
    args.push("mp3".into());
    args.push("--audio-quality".into());
    args.push(quality.into());
}

fn push_thumbnail(args: &mut Vec<String>, save_thumbnail: bool) {
    if save_thumbnail {
        args.push("--write-thumbnail".into());
    }
}

fn merge_container(vcodec: &str, acodec: &str) -> &'static str {
    let video = vcodec.to_ascii_lowercase();
    let audio = acodec.to_ascii_lowercase();
    let video_mp4 = video.starts_with("avc") || video.starts_with("h264");
    let audio_mp4 = audio.starts_with("mp4a") || audio.starts_with("aac");
    if video_mp4 && audio_mp4 { "mp4" } else { "mkv" }
}

#[cfg(test)]
mod tests {
    use super::{FormatKind, Preset, Selection, format_args};

    fn format_selection(
        format_id: &str,
        pair_best_audio: bool,
        mp3_bitrate: Option<u32>,
        kind: FormatKind,
        vcodec: &str,
        acodec: &str,
    ) -> Selection {
        Selection::Format {
            format_id: format_id.into(),
            pair_best_audio,
            mp3_bitrate,
            save_thumbnail: false,
            kind,
            vcodec: vcodec.into(),
            acodec: acodec.into(),
            label: String::new(),
            output_format: if mp3_bitrate.is_some() {
                "mp3"
            } else { match kind {
                FormatKind::Video => "mp4",
                FormatKind::Audio => "m4a",
                _ => "",
            }}.into(),
            clip: None,
        }
    }

    fn assert_no_video_encode(args: &[String]) {
        let joined = args.join(" ").to_ascii_lowercase();
        assert!(!joined.contains("libx264"), "{joined}");
        assert!(!joined.contains("libx265"), "{joined}");
        assert!(!joined.contains("-c:v"), "{joined}");
        assert!(!joined.contains("-b:v"), "{joined}");
        assert!(!joined.contains("--convert-thumbnails"), "{joined}");
        assert!(!joined.contains("bitrate"), "{joined}");
    }

    fn has_pair(args: &[String], left: &str, right: &str) -> bool {
        args.windows(2)
            .any(|pair| pair[0] == left && pair[1] == right)
    }

    #[test]
    fn video_only_avc_and_mp4a_merges_to_mp4() {
        let args = format_args(&format_selection(
            "137",
            true,
            None,
            FormatKind::Video,
            "avc1.640028",
            "mp4a.40.2",
        ));
        assert!(has_pair(&args, "-f", "137+bestaudio"));
        assert!(has_pair(&args, "--merge-output-format", "mp4"));
        assert_no_video_encode(&args);
    }

    #[test]
    fn video_only_vp9_and_opus_respects_mp4_output_choice() {
        let args = format_args(&format_selection(
            "248",
            true,
            None,
            FormatKind::Video,
            "vp9",
            "opus",
        ));
        assert!(has_pair(&args, "-f", "248+bestaudio"));
        assert!(has_pair(&args, "--merge-output-format", "mp4"));
        assert_no_video_encode(&args);
    }

    #[test]
    fn audio_only_without_mp3_does_not_extract() {
        let args = format_args(&format_selection(
            "140",
            false,
            None,
            FormatKind::Audio,
            "none",
            "mp4a.40.2",
        ));
        assert!(has_pair(&args, "-f", "140"));
        assert!(!args.iter().any(|arg| arg == "-x"));
        assert!(!args.iter().any(|arg| arg == "--audio-format"));
        assert_no_video_encode(&args);
    }

    #[test]
    fn audio_only_mp3_320_extracts() {
        let args = format_args(&format_selection(
            "140",
            false,
            Some(320),
            FormatKind::Audio,
            "none",
            "mp4a.40.2",
        ));
        assert!(has_pair(&args, "-f", "140"));
        assert!(args.iter().any(|arg| arg == "-x"));
        assert!(has_pair(&args, "--audio-format", "mp3"));
        assert!(has_pair(&args, "--audio-quality", "320K"));
        assert!(!args.iter().any(|arg| arg.contains("+bestaudio")));
        assert_no_video_encode(&args);
    }

    #[test]
    fn storyboard_uses_only_that_format() {
        let args = format_args(&format_selection(
            "sb0",
            true,
            Some(320),
            FormatKind::Storyboard,
            "none",
            "none",
        ));
        assert_eq!(args, vec!["-f".to_string(), "sb0".to_string()]);
        assert_no_video_encode(&args);
    }

    #[test]
    fn presets_cover_video_heights_and_mp3_audio() {
        let cases = [
            (Preset::VideoBest, "bv*+ba/b"),
            (Preset::Video8k, "bv*[height<=?4320]+ba/b[height<=?4320]"),
            (Preset::Video4k, "bv*[height<=?2160]+ba/b[height<=?2160]"),
            (Preset::Video2k, "bv*[height<=?1440]+ba/b[height<=?1440]"),
            (Preset::Video1080, "bv*[height<=?1080]+ba/b[height<=?1080]"),
            (Preset::Video720, "bv*[height<=?720]+ba/b[height<=?720]"),
            (Preset::Video480, "bv*[height<=?480]+ba/b[height<=?480]"),
            (Preset::Video360, "bv*[height<=?360]+ba/b[height<=?360]"),
            (Preset::Video240, "bv*[height<=?240]+ba/b[height<=?240]"),
            (Preset::Video144, "bv*[height<=?144]+ba/b[height<=?144]"),
        ];
        for (preset, filter) in cases {
            let args = format_args(&Selection::Preset {
                preset,
                save_thumbnail: false,
                label: String::new(),
                clip: None,
            });
            assert!(has_pair(&args, "-f", filter), "{args:?}");
            assert!(!args.iter().any(|arg| arg == "-x"));
            assert_no_video_encode(&args);
        }
        let audio = [
            (Preset::AudioBest, "0"),
            (Preset::Audio320, "320K"),
            (Preset::Audio256, "256K"),
            (Preset::Audio192, "192K"),
            (Preset::Audio128, "128K"),
        ];
        for (preset, quality) in audio {
            let args = format_args(&Selection::Preset {
                preset,
                save_thumbnail: true,
                label: String::new(),
                clip: None,
            });
            assert!(has_pair(&args, "-f", "ba/b"));
            assert!(args.iter().any(|arg| arg == "-x"));
            assert!(has_pair(&args, "--audio-format", "mp3"));
            assert!(has_pair(&args, "--audio-quality", quality), "{args:?}");
            assert!(args.iter().any(|arg| arg == "--write-thumbnail"));
            assert!(!args.iter().any(|arg| arg.contains("convert-thumb")));
            assert_no_video_encode(&args);
        }
    }
}
