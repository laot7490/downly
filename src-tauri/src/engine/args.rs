use std::path::Path;

use crate::engine::filename::OUTPUT_TEMPLATE;
use crate::engine::format::{Selection, format_args, valid_format_id};

pub fn probe_video_args(url: &str, js_runtime: Option<&Path>) -> Vec<String> {
    with_options(
        vec!["-J".into(), "--no-playlist".into(), "--".into(), url.into()],
        js_runtime,
    )
}

pub fn probe_playlist_args(url: &str, js_runtime: Option<&Path>) -> Vec<String> {
    with_options(
        vec![
            "-J".into(),
            "--flat-playlist".into(),
            "--".into(),
            url.into(),
        ],
        js_runtime,
    )
}

pub fn download_args(
    selection: &Selection,
    output_dir: &Path,
    ffmpeg_dir: &Path,
    url: &str,
    js_runtime: Option<&Path>,
    duplicate_suffix: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(format_id) = selection.format_id()
        && !valid_format_id(format_id)
    {
        return Err("invalid format".into());
    }
    let output_template = duplicate_suffix
        .map(|suffix| format!("%(title).200B (copy {suffix}) [%(id)s].%(ext)s"))
        .unwrap_or_else(|| OUTPUT_TEMPLATE.to_string());
    let mut args = vec![
        "--newline".into(),
        "--progress".into(),
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
    args.extend(format_args(selection));
    args.push("--".into());
    args.push(url.into());
    Ok(with_options(args, js_runtime))
}

fn with_options(mut args: Vec<String>, js_runtime: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(path) = js_runtime {
        out.push("--js-runtimes".into());
        out.push(format!("deno:{}", path_string(path)));
        // yt-dlp/ejs challenge solvers when not already bundled with the binary
        out.push("--remote-components".into());
        out.push("ejs:github".into());
    }
    out.append(&mut args);
    out
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn version_args() -> Vec<String> {
    vec!["--version".into()]
}

#[cfg(test)]
mod tests {
    use super::download_args;
    use crate::engine::format::{Preset, Selection};
    use std::path::Path;

    #[test]
    fn download_args_include_template_and_format() {
        let selection = Selection::Preset {
            preset: Preset::Video1080,
            save_thumbnail: true,
            label: String::new(),
        };
        let args = download_args(
            &selection,
            Path::new("D:/Downloads/Downly"),
            Path::new("D:/resources"),
            "https://www.youtube.com/watch?v=abc",
            Some(Path::new("D:/bin/deno.exe")),
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
            Path::new("D:/resources"),
            "https://www.youtube.com/watch?v=abc",
            None,
            Some("copy-id"),
        )
        .unwrap();
        assert!(duplicate_args.windows(2).any(|pair| {
            pair[0] == "-o" && pair[1] == "%(title).200B (copy copy-id) [%(id)s].%(ext)s"
        }));
        assert!(
            args.windows(2)
                .any(|pair| { pair[0] == "--remote-components" && pair[1] == "ejs:github" })
        );
        assert!(!args.iter().any(|arg| arg == "--cookies-from-browser"));
        assert_eq!(
            args.last().map(String::as_str),
            Some("https://www.youtube.com/watch?v=abc")
        );
        let joined = args.join(" ").to_ascii_lowercase();
        assert!(!joined.contains("libx264"));
        assert!(!joined.contains("-c:v"));
        assert!(!joined.contains("--convert-thumbnails"));
    }

    #[test]
    fn probe_args_match_the_lookup_kind() {
        let video = super::probe_video_args("https://youtu.be/abc", None);
        assert!(video.windows(2).any(|pair| pair == ["-J", "--no-playlist"]));
        assert!(!video.iter().any(|arg| arg == "--flat-playlist"));
        assert!(!video.iter().any(|arg| arg == "--js-runtimes"));
        assert!(!video.iter().any(|arg| arg == "--remote-components"));
        let playlist = super::probe_playlist_args(
            "https://www.youtube.com/playlist?list=PLx",
            Some(Path::new("C:/deno.exe")),
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
        assert!(!playlist.iter().any(|arg| arg == "--cookies-from-browser"));
    }
}
