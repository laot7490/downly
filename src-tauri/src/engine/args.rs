use std::path::Path;

use crate::engine::filename::OUTPUT_TEMPLATE;
use crate::engine::format::{LiveMode, Selection, clip_args, format_args, valid_format_id};

pub fn probe_video_args(
    url: &str,
    js_runtime: Option<&Path>,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Vec<String> {
    with_options(
        vec![
            "-J".into(),
            "--skip-download".into(),
            "--no-playlist".into(),
            "--".into(),
            url.into(),
        ],
        js_runtime,
        cookies_browser,
        cookies_file,
    )
}
pub fn probe_playlist_args(
    url: &str,
    js_runtime: Option<&Path>,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Vec<String> {
    with_options(
        vec![
            "-J".into(),
            "--skip-download".into(),
            "--flat-playlist".into(),
            "--".into(),
            url.into(),
        ],
        js_runtime,
        cookies_browser,
        cookies_file,
    )
}

pub fn download_args(
    selection: &Selection,
    output_dir: &Path,
    ffmpeg_dir: &Path,
    url: &str,
    js_runtime: Option<&Path>,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
    duplicate_suffix: Option<&str>,
    live_mode: Option<LiveMode>,
    speed_limit_bytes_per_second: Option<u64>,
) -> Result<Vec<String>, String> {
    if let Some(format_id) = selection.format_id()
        && !valid_format_id(format_id)
    {
        return Err("invalid format".into());
    }
    let is_clip = match selection {
        Selection::Format { clip, .. } | Selection::Preset { clip, .. } => clip.is_some(),
    };
    let speed_limit_bytes_per_second = if live_mode.is_none() && !is_clip {
        speed_limit_bytes_per_second
    } else {
        None
    };
    let output_template = duplicate_suffix
        .map(|suffix| format!("%(title).200B (copy {suffix}) [%(id)s].%(ext)s"))
        .unwrap_or_else(|| OUTPUT_TEMPLATE.to_string());
    let mut args = vec![
        "--newline".into(),
        "--progress".into(),
        "--concurrent-fragments".into(),
        if speed_limit_bytes_per_second.is_some() { "1" } else { "4" }.into(),
        "--windows-filenames".into(),
        "--no-mtime".into(),
        "--no-playlist".into(),
        "--ffmpeg-location".into(),
        path_string(ffmpeg_dir),
        "-P".into(),
        path_string(output_dir),
        "-o".into(),
        output_template,
        "--print".into(),
        "after_move:%(filepath)s".into(),
    ];
    if let Some(limit) = speed_limit_bytes_per_second {
        args.extend(["--limit-rate".into(), limit.to_string()]);
    }
    args.extend(format_args(selection));
    if live_mode.is_some() {
        args.push("--no-part".into());
    }
    if live_mode == Some(LiveMode::FromStart) {
        args.push("--live-from-start".into());
    }
    if live_mode.is_none() {
        args.extend(clip_args(selection)?);
    }
    args.push("--".into());
    args.push(url.into());
    Ok(with_options(
        args,
        js_runtime,
        cookies_browser,
        cookies_file,
    ))
}

fn with_options(
    mut args: Vec<String>,
    js_runtime: Option<&Path>,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(path) = js_runtime {
        out.push("--js-runtimes".into());
        out.push(format!("deno:{}", path_string(path)));
        // yt-dlp/ejs challenge solvers when not already bundled with the binary
        out.push("--remote-components".into());
        out.push("ejs:github".into());
    }
    if let Some(browser) = cookies_browser {
        out.push("--cookies-from-browser".into());
        out.push(browser.into());
    }
    if let Some(path) = cookies_file {
        out.push("--cookies".into());
        out.push(path_string(path));
    }
    out.append(&mut args);
    out
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::download_args;
    use crate::engine::format::{LiveMode, Preset, Selection};
    use std::path::Path;

    #[test]
    fn download_args_include_template_and_format() {
        let selection = Selection::Preset {
            preset: Preset::Video1080,
            save_thumbnail: true,
            label: String::new(),
            clip: None,
        };
        let args = download_args(
            &selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/Downly/bin"),
            "https://www.youtube.com/watch?v=abc",
            Some(Path::new("D:/bin/deno.exe")),
            Some("firefox"),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(
            args.windows(2)
                .any(|pair| { pair[0] == "-o" && pair[1] == "%(title).200B [%(id)s].%(ext)s" })
        );
        assert!(!args.iter().any(|arg| arg == "--recode-video"));
        assert!(args.iter().any(|arg| arg == "--newline"));
        assert!(args.iter().any(|arg| arg == "--windows-filenames"));
        assert!(args.iter().any(|arg| arg == "--no-mtime"));
        assert!(args.iter().any(|arg| arg == "--no-playlist"));
        assert!(args.windows(2).any(|pair| pair == ["--concurrent-fragments", "4"]));
        assert!(!args.iter().any(|arg| arg == "--limit-rate"));
        assert!(args.iter().any(|arg| arg == "--write-thumbnail"));
        assert!(args.windows(2).any(|pair| {
            pair[0] == "-f" && pair[1] == "bv*[height<=?1080]+ba/b[height<=?1080]"
        }));
        assert!(
            args.windows(2)
                .any(|pair| { pair[0] == "--js-runtimes" && pair[1] == "deno:D:/bin/deno.exe" })
        );

        let duplicate_args = download_args(
            &selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/Downly/bin"),
            "https://www.youtube.com/watch?v=abc",
            None,
            None,
            None,
            Some("copy-id"),
            None,
            None,
        )
        .unwrap();
        assert!(duplicate_args.windows(2).any(|pair| {
            pair[0] == "-o" && pair[1] == "%(title).200B (copy copy-id) [%(id)s].%(ext)s"
        }));
        assert!(
            args.windows(2)
                .any(|pair| { pair[0] == "--remote-components" && pair[1] == "ejs:github" })
        );
        assert!(args.windows(2).any(|pair| pair == ["--cookies-from-browser", "firefox"]));
        assert_eq!(
            args.last().map(String::as_str),
            Some("https://www.youtube.com/watch?v=abc")
        );
        let joined = args.join(" ").to_ascii_lowercase();
        assert!(!joined.contains("libx264"));
        assert!(!joined.contains("-c:v"));
        assert!(!joined.contains("--convert-thumbnails"));

        let live_args = download_args(
            &selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/Downly/bin"),
            "https://www.youtube.com/watch?v=live",
            None,
            None,
            None,
            None,
            Some(LiveMode::FromStart),
            Some(1_250_000),
        )
        .unwrap();
        assert!(live_args.iter().any(|arg| arg == "--no-part"));
        assert!(live_args.iter().any(|arg| arg == "--live-from-start"));
        assert!(!live_args.iter().any(|arg| arg == "--limit-rate"));
        assert!(
            live_args
                .windows(2)
                .any(|pair| pair == ["--concurrent-fragments", "4"])
        );

        let limited_args = download_args(
            &selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/Downly/bin"),
            "https://www.youtube.com/watch?v=abc",
            None,
            None,
            None,
            None,
            None,
            Some(1_250_000),
        )
        .unwrap();
        assert!(limited_args.windows(2).any(|pair| pair == ["--limit-rate", "1250000"]));
        assert!(limited_args.windows(2).any(|pair| pair == ["--concurrent-fragments", "1"]));

        let clip_selection = Selection::Preset {
            preset: Preset::Video1080,
            save_thumbnail: false,
            label: String::new(),
            clip: Some(crate::engine::format::ClipRange {
                start_seconds: 10,
                end_seconds: 20,
            }),
        };
        let clip_args = download_args(
            &clip_selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/Downly/bin"),
            "https://www.youtube.com/watch?v=abc",
            None,
            None,
            None,
            None,
            None,
            Some(1_250_000),
        )
        .unwrap();
        assert!(!clip_args.iter().any(|arg| arg == "--limit-rate"));
        assert!(
            clip_args
                .windows(2)
                .any(|pair| pair == ["--concurrent-fragments", "4"])
        );
    }

    #[test]
    fn probe_args_match_the_lookup_kind() {
        let video = super::probe_video_args("https://youtu.be/abc", None, None, None);
        assert!(video.windows(3).any(|args| args == ["-J", "--skip-download", "--no-playlist"]));
        assert!(!video.iter().any(|arg| arg == "--flat-playlist"));
        assert!(!video.iter().any(|arg| arg == "--js-runtimes"));
        assert!(!video.iter().any(|arg| arg == "--remote-components"));
        let playlist = super::probe_playlist_args(
            "https://www.youtube.com/playlist?list=PLx",
            Some(Path::new("C:/deno.exe")),
            Some("firefox"),
            None,
        );
        assert!(playlist.iter().any(|arg| arg == "--flat-playlist"));
        assert!(!playlist.iter().any(|arg| arg == "--no-playlist"));
        assert!(
            playlist
                .windows(2)
                .any(|pair| { pair[0] == "--js-runtimes" && pair[1] == "deno:C:/deno.exe" })
        );
        assert!(
            playlist
                .windows(2)
                .any(|pair| { pair[0] == "--remote-components" && pair[1] == "ejs:github" })
        );
        assert!(playlist.windows(2).any(|pair| pair == ["--cookies-from-browser", "firefox"]));
    }
}
