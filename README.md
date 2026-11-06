# Downly

A Windows desktop downloader for YouTube, Twitch, Vimeo, TikTok, Reddit, SoundCloud, and other sites supported by [yt-dlp](https://github.com/yt-dlp/yt-dlp). Paste a link, choose a format, and add it to the queue.

Built with Tauri 2, React, TypeScript, and Rust.

> [!NOTE]
> The Windows installer is not code-signed, so SmartScreen may show a warning when you open it.

## Features

- Download single videos, playlists, or selected clips
- Choose video or audio formats and quality
- Queue downloads and review completed or failed items in history
- Record live streams from now or, on supported services, from the beginning
- Use browser or local cookies for content that requires a signed-in session
- Update yt-dlp from the app
- English and Turkish interface with system, light, and dark themes

## Install

Download the latest Windows installer from [GitHub Releases](https://github.com/laot7490/downly/releases). The per-user installer does not require administrator access.

## Development

### Requirements

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/)
- [Tauri prerequisites for Windows](https://v2.tauri.app/start/prerequisites/)

### Run locally

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File scripts/fetch-binaries.ps1
pnpm tauri dev
```

To create a Windows installer:

```powershell
pnpm tauri build
```

The binary-fetch script downloads yt-dlp and FFmpeg into `src-tauri/resources`. These binaries are fetched locally and are not committed to the repository.

## Technology

- **Desktop:** Tauri 2 and Rust
- **Frontend:** React, TypeScript, Vite, and Tailwind CSS
- **Downloads:** yt-dlp and FFmpeg
