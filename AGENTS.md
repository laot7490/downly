# Repository Guidelines

## Project Structure & Module Organization

Downly is a Tauri 2 Windows downloader. The desktop React/TypeScript frontend lives in `src/`; Rust commands and backend logic are in `src-tauri/src/`. Tauri permissions, capabilities, and icons are under `src-tauri/`. The separate product website is in `web/`, with its React pages and components under `web/src/`. There is no dedicated test directory today.

## Build, Test, and Development Commands

Run commands from the repository root unless noted.

- `pnpm install` installs desktop dependencies.
- `pnpm dev` starts the Vite frontend; `pnpm tauri dev` runs the full desktop app.
- `pnpm build` type-checks and builds the frontend.
- `pnpm tauri build` packages the desktop application.
- `cargo check` from `src-tauri/` checks the Rust backend.
- For the website, use `pnpm install` and `pnpm build` in `web/`; `pnpm lint` runs its ESLint checks.

The root package does not define automated tests or a lint script. No coverage requirement is configured; run the relevant build or check after changing code.

## Coding Style & Naming Conventions

Use TypeScript/TSX for frontend code and Rust for Tauri backend code. Follow the surrounding file’s formatting and component conventions; use descriptive, lowercase kebab-case filenames for UI modules (for example, `queue-page.tsx`). Keep Tauri commands, frontend invoke calls, and capability permissions aligned when adding backend features. Do not commit generated build output or downloaded binaries.

## Testing Guidelines

There is no configured test framework at the root. For frontend changes, run `pnpm build`; for Rust changes, run `cargo check` in `src-tauri/`. For changes that affect desktop behavior, launch with `pnpm tauri dev` and verify the affected flow manually when practical. Website changes should also pass `pnpm lint` from `web/`.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, sometimes with a version bump (for example, “Improve download queue controls and bump to 0.5.1”). Keep subjects concise and describe the user-visible change. A pull request should explain its impact, list relevant validation performed, and include screenshots for visible UI changes. Link related issues when applicable.

## Security & Configuration

Keep updater signing secrets and local credentials out of commits. Downloaded tools are installed at runtime under `%LOCALAPPDATA%\Downly\bin` and are not bundled with the installer. Review Tauri capability changes carefully because they grant frontend access to native APIs.
