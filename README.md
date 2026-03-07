# ModelForge

[中文文档](./README.zh-CN.md) | [Release Checklist](./docs/RELEASE_CHECKLIST.md)

ModelForge is a local AI workstation built around Ollama. It combines model management, chat, download management, memory, and desktop automation in a single project. The repository includes a React frontend, a FastAPI backend, and an Electron desktop wrapper for macOS and Windows.

## Overview

ModelForge is designed for a practical local workflow:

- browse local and official Ollama models
- download and manage model tags with persistent progress
- chat with multiple conversations and streaming responses
- store and search memory entries
- run desktop tasks with `Computer Use`
- package everything into a desktop app for macOS and Windows

This repository is the standalone `ModelForge` source tree.

## Key Features

### Model Management

- list local models and their runtime status
- browse the official Ollama library
- inspect model tags before download
- load and unload models
- configure model residency behavior

### Download Management

- deduplicate repeated download requests
- persist progress across app restarts
- show progress, speed, ETA, and status text
- retry network-sensitive steps
- cancel active tasks

### Chat

- create and switch between conversations
- stream model output
- auto-generate conversation titles
- change models per conversation
- support web search assisted answers
- write selected content into memory

### Memory

- create memory entries manually
- import content from files
- search and edit stored memory
- inspect embedding setup and status

### Computer Use

- control the desktop through a unified task loop
- maintain task history and parent-session context
- support approval, rejection, pause, resume, and user takeover
- use a controlled browser instead of relying only on screenshot clicks
- fall back to desktop-level actions when needed

### Desktop Packaging

- build `ModelForge.app`
- generate a macOS DMG
- generate a Windows desktop bundle
- bundle the frontend, backend binary, and Electron shell together

## Architecture

ModelForge is split into three layers:

1. `frontend/`
   React 19, TypeScript, Vite, Tailwind CSS, Zustand, and i18next.
2. `backend/`
   FastAPI, SQLite, httpx, and local services for chat, downloads, memory, and computer use orchestration.
3. `desktop/`
   Electron main process, preload bridge, computer helper, controlled browser, and status HUD.

At runtime:

- the frontend talks to the backend through `/api/*`
- the Electron wrapper embeds the frontend and starts the backend binary
- `Computer Use` can call desktop tools and the controlled browser through the desktop bridge

## Repository Layout

```text
project-root/
├── backend/                # FastAPI app, services, database access
├── desktop/                # Electron wrapper and desktop bridge
├── frontend/               # React app
├── scripts/                # Packaging scripts
├── docs/                   # Project documents and release notes
├── data/                   # Local runtime data
├── logs/                   # Local development logs
├── docker-compose.yml
├── start-dev.sh
├── .env.example
└── README.md
```

## Requirements

- macOS or Windows for the desktop application
- Node.js 18+
- Python 3.11+
- Ollama installed and reachable, usually at `http://localhost:11434`

## Quick Start

### 1. Configure Environment

Copy the example file and adjust values if needed:

```bash
cp .env.example .env
```

Common options:

```env
OLLAMA_HOST=http://localhost:11434
DATABASE_URL=sqlite+aiosqlite:///./ollama_studio.db
DEBUG=true
MEMORY_ENABLED=true
MAX_OUTPUT_TOKENS=8192
MAX_CONTEXT_TOKENS=8192
MODELFORGE_COMPUTER_USE_MAX_TOOL_ROUNDS=48
```

Frontend-only environment variables:

```env
VITE_API_URL=http://localhost:8000/api
VITE_DESKTOP=false
```

### 2. Start Everything

Use the convenience script:

```bash
cd /path/to/project-root
chmod +x start-dev.sh
./start-dev.sh
```

Default endpoints:

- frontend: `http://localhost:5173`
- backend: `http://localhost:8000`
- health: `http://localhost:8000/api/health`
- docs: `http://localhost:8000/docs`

Useful script flags:

```bash
./start-dev.sh --no-install
./start-dev.sh --backend-only
./start-dev.sh --frontend-only
./start-dev.sh --skip-ollama
```

## Manual Development

### Backend

```bash
cd /path/to/project-root/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd /path/to/project-root/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

### Useful Checks

```bash
cd /path/to/project-root/frontend
npm run build
```

```bash
cd /path/to/project-root
python3 -m py_compile backend/app/api/*.py backend/app/services/*.py
```

## Computer Use

`Computer Use` is the desktop execution layer. It is no longer limited to raw screenshot clicks.

Current capabilities include:

- desktop screenshot and observation
- task sessions with history and context inheritance
- continuous execution mode and approval-driven mode
- controlled browser tools for navigation, element-level interaction, typing, scrolling, and back navigation
- fallback desktop actions for system-level interaction
- user takeover for login, CAPTCHA, payment, or other sensitive flows
- pause, resume, reject, retry, and cancel flows

Platform notes:

- macOS uses Screen Recording and Accessibility permissions for native desktop automation.
- Windows uses PowerShell plus Win32 APIs for native desktop input and does not require a separate permission grant flow.
- Both platforms share the same screenshot, OCR, and controlled-browser task loop.

The app only surfaces permission shortcuts when the current runtime actually needs them.

## API Surface

Main API groups:

- `/api/models`
- `/api/downloads`
- `/api/chat`
- `/api/computer-use`
- `/api/memory`
- `/api/system`

Notable endpoints:

- `GET /api/models/library`
- `POST /api/downloads/`
- `POST /api/chat/completions`
- `POST /api/computer-use/sessions`
- `POST /api/computer-use/sessions/{session_id}/run`
- `POST /api/computer-use/sessions/{session_id}/approve`
- `POST /api/computer-use/sessions/{session_id}/resume`
- `GET /api/memory/status`
- `GET /api/system/health`

Use the OpenAPI page at `http://localhost:8000/docs` for the complete schema.

## Data and Generated Files

Default local data:

- SQLite database: `backend/ollama_studio.db`
- frontend build output: `frontend/dist/`
- backend packaged output: `backend/dist/`
- desktop release output: `release/`
- local development logs: `logs/`

Useful cleanup commands:

```bash
rm -rf release frontend/dist backend/build backend/dist
find backend -type d -name "__pycache__" -prune -exec rm -rf {} +
```

To reset local state completely:

```bash
rm -f backend/ollama_studio.db
```

This removes local chat history, downloads, memory entries, and `Computer Use` session state.

Packaged desktop builds keep writable state outside the app bundle:

- the desktop app passes a per-user state directory to the backend
- SQLite data, persisted settings, `Computer Use` artifacts, and library cache are stored there
- this avoids write failures when the app is installed under `/Applications` on macOS or `Program Files` on Windows

## Desktop Packaging

The project ships with separate desktop packaging scripts for macOS and Windows.

### macOS

```bash
cd /path/to/project-root
chmod +x scripts/build-desktop-mac.sh
./scripts/build-desktop-mac.sh
```

The script performs the following steps:

1. clean previous outputs
2. build `frontend/dist`
3. package the backend with PyInstaller
4. assemble the Electron application
5. produce `release/ModelForge.app`
6. produce a DMG in `release/`

### Windows

Run the PowerShell build script on a Windows machine:

```powershell
cd C:\path\to\project-root
powershell -ExecutionPolicy Bypass -File .\scripts\build-desktop-win.ps1
```

The Windows script:

1. cleans previous outputs
2. builds `frontend/dist`
3. packages the backend with PyInstaller into `backend-api.exe`
4. stages the desktop payload inside `desktop/`
5. builds the unpacked Windows desktop app
6. produces distributable EXE artifacts in `release/`

Expected Windows release outputs:

- `release/win-unpacked/`
- `release/ModelForge-<version>-x64-portable.exe`
- `release/ModelForge-<version>-x64-nsis.exe`

For local Windows development, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev-win.ps1
```

Useful packaging environment variables:

```bash
SKIP_DEP_INSTALL=true
BACKEND_PORT=18000
APP_BUNDLE_ID=io.modelforge.desktop
ELECTRON_DOWNLOAD_URL=https://cdn.npmmirror.com/binaries/electron/...
```

Windows script parameters:

```powershell
.\scripts\build-desktop-win.ps1 -ElectronArch x64
.\scripts\build-desktop-win.ps1 -SkipDepInstall
.\scripts\build-desktop-win.ps1 -BackendPort 18000
```

If your shell exports `ELECTRON_RUN_AS_NODE=1`, launch the app without that variable:

```bash
env -u ELECTRON_RUN_AS_NODE open /absolute/path/to/ModelForge.app
```

## Release Preparation

Before a release:

1. run the build checks
2. package the desktop app on each target OS
3. verify macOS permissions or Windows PowerShell availability for `Computer Use`
4. smoke-test chat, downloads, controlled browser, and desktop automation
5. review staged files and ignore rules

See [Release Checklist](./docs/RELEASE_CHECKLIST.md) for the concrete steps used in this repository.

## License

MIT
