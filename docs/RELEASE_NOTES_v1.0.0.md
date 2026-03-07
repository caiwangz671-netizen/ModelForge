# ModelForge v1.0.0

Initial public release of ModelForge.

## Highlights

- unified local AI workstation built around Ollama
- local model management, library browsing, and download workflows
- multi-conversation chat with streaming responses
- memory creation, import, editing, and search
- `Computer Use` with task history, approval flow, user takeover, and context inheritance
- controlled browser support for more reliable web automation
- macOS desktop packaging with `ModelForge.app` and DMG output

## Notable Product Improvements

- folder picker support for `Computer Use` instead of manual path typing
- hidden main window strategy during desktop actions to reduce self-occlusion
- recovery-oriented approval handling instead of hard failing on every rejection
- stronger tool-round budget and retry behavior for long-running tasks
- persisted download state to avoid broken progress text after restart
- collapsible history and bulk-delete actions for chat and `Computer Use`
- refined UI motion and cleaner page transitions

## Packaging

- desktop bundle name: `ModelForge`
- macOS app bundle output: `release/ModelForge.app`
- macOS disk image output: `release/ModelForge-arm64.dmg`

## Repository Notes

- primary documentation: `README.md`
- detailed Chinese documentation: `README.zh-CN.md`
- release checklist: `docs/RELEASE_CHECKLIST.md`
