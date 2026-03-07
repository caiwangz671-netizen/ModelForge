# ModelForge v1.1.0

Cross-platform desktop release focused on making `Computer Use` and desktop packaging ready for real macOS and Windows distribution.

## Highlights

- native desktop automation is now structured behind platform drivers for macOS and Windows
- screenshots, OCR, and the controlled browser are shared across both desktop platforms
- Windows desktop input support now covers click, scroll, type, keypress, app launch, and UI state inspection
- packaged desktop builds now store writable state in a per-user runtime directory instead of the application bundle
- Windows packaging now targets distributable `portable.exe` and `nsis.exe` artifacts

## Computer Use

- browser-first execution works without exposing platform-specific UI to the user
- desktop capability detection is automatic and runtime-based
- retry handling covers more unstable desktop and browser tools
- macOS and Windows both use the same screenshot/OCR/browser observation pipeline
- Windows desktop automation uses PowerShell plus Win32 APIs and reports clearer runtime limitations when unavailable

## Packaging

- macOS outputs:
  - `release/ModelForge.app`
  - `release/ModelForge-arm64.dmg`
- Windows outputs:
  - `release/win-unpacked/`
  - `release/ModelForge-1.1.0-x64-portable.exe`
  - `release/ModelForge-1.1.0-x64-nsis.exe`

## Persistence And Release Readiness

- SQLite, persisted settings, library cache, and `Computer Use` artifacts now live under the desktop app's per-user state directory
- this avoids write failures from read-only install locations such as `/Applications` and `Program Files`
- README, Chinese README, and the release checklist were updated for the cross-platform release flow
