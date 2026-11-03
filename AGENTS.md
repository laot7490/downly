# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React and TypeScript frontend: `pages/` for screens, `components/` for shared and UI components, `hooks/` for reusable stateful logic, `lib/` for helpers and API wrappers, and `i18n/locales/` for English and Turkish strings. Static frontend assets live in `src/assets/` and `public/`. `src-tauri/src/` contains the Rust application, commands, download engine, and state; Tauri configuration and permissions are in `src-tauri/`. `scripts/fetch-binaries.ps1` retrieves the external downloader and media tools. There is no dedicated test directory currently.

## Build, Test, and Development Commands

Use pnpm, Node.js, Rust, and the Windows Tauri prerequisites described in the README.

- `pnpm install` installs JavaScript dependencies.
- `powershell -ExecutionPolicy Bypass -File scripts/fetch-binaries.ps1` downloads yt-dlp and FFmpeg into `src-tauri/resources`.
- `pnpm tauri dev` runs the desktop app in development.
- `pnpm build` runs TypeScript checking and builds the frontend with Vite.
- `pnpm tauri build` creates a production desktop build.
- `pnpm preview` serves the built frontend for local inspection.

No automated test or lint command is configured; validate changes with the relevant build and manual app checks.

## Coding Style & Naming Conventions

Follow the existing TypeScript and Rust style. Use descriptive kebab-case filenames (for example, `queue-page.tsx`); use PascalCase for React components and types, and camelCase for functions and values. Keep UI changes consistent with the existing shadcn components and Tailwind utilities. Keep backend responsibilities in Rust and expose frontend operations through the established Tauri command/API layers. Update both locale JSON files when adding user-facing text.

## Testing Guidelines

There is no configured test framework or coverage threshold. For frontend changes, run `pnpm build`; for Rust changes, run `cargo check` from `src-tauri/`. For behavior changes, also exercise the affected flow in `pnpm tauri dev`, including relevant queue, history, or settings states.

## Commit & Pull Request Guidelines

This checkout has no accessible Git history to establish a commit convention. Use a short, imperative summary (for example, `Fix queue cancellation`). Pull requests should explain the user-visible change, list validation performed, link related issues when available, and include screenshots for UI changes. Call out any changes to bundled binaries or Tauri permissions.

## Security & Configuration Tips

Do not commit downloaded tool binaries, signing credentials, or local build output. The binary fetch script obtains yt-dlp and FFmpeg; review source and licensing before changing those inputs. Keep Tauri capabilities and permissions limited to the features the app needs.
