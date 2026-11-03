$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root "src-tauri\resources"
New-Item -ItemType Directory -Force -Path $resources | Out-Null

$ytdlp = Join-Path $resources "yt-dlp.exe"
Write-Host "Downloading yt-dlp..."
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlp

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("downly-ffmpeg-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp "ffmpeg.zip"
$asset = "ffmpeg-n8.1-latest-win64-gpl-8.1.zip"
Write-Host "Downloading ffmpeg..."
Invoke-WebRequest -Uri "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/$asset" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$bin = Get-ChildItem -Path $tmp -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $bin) {
  throw "ffmpeg.exe missing from archive"
}
$dir = $bin.Directory.FullName
Copy-Item -Force (Join-Path $dir "ffmpeg.exe") (Join-Path $resources "ffmpeg.exe")
$ffprobe = Join-Path $dir "ffprobe.exe"
if (Test-Path $ffprobe) {
  Copy-Item -Force $ffprobe (Join-Path $resources "ffprobe.exe")
}
Remove-Item -Recurse -Force $tmp
Write-Host "Wrote yt-dlp and ffmpeg into $resources"
