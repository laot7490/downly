<h1 align="center">Downly</h1>

<p align="center">A Windows desktop downloader for YouTube, Twitch, Vimeo, TikTok, Reddit, SoundCloud, and other sites supported by <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>.</p>

Built with Tauri 2, React, TypeScript, and Rust.

> [!NOTE]
> The Windows installer is not code-signed, so SmartScreen may show a warning when you open it.

## Features

- Download videos, playlists, selected clips, and live streams
- Choose video or audio formats and quality
- Queue downloads and review completed or failed items in history
- Use browser or local cookies for content that requires a signed-in session
- Manage required third-party tools from one place
- English and Turkish interface with system, light, and dark themes

## Install

Download the latest per-user Windows installer from [GitHub Releases](https://github.com/laot7490/downly/releases). It does not require administrator access.

On first launch, Downly downloads and verifies yt-dlp, FFmpeg, ffprobe, and the Deno executable into `%LOCALAPPDATA%\Downly\bin`. The installer does not bundle these tools. Later updates are optional and can be installed from the startup prompt or Settings.

## Development

### Requirements

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/)
- [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/)

### Run locally

```powershell
pnpm install
pnpm tauri dev
```

Build the frontend or create a Windows installer with:

```powershell
pnpm build
pnpm tauri build
```

## Technology

- **Desktop:** Tauri 2 and Rust
- **Frontend:** React, TypeScript, Vite, and Tailwind CSS
- **Downloads:** yt-dlp and FFmpeg
