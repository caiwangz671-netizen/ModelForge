#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
DESKTOP_DIR="$ROOT_DIR/desktop"

BACKEND_VENV_PYTHON="${BACKEND_VENV_PYTHON:-$BACKEND_DIR/venv/bin/python}"
BACKEND_VENV_PIP="${BACKEND_VENV_PIP:-$BACKEND_DIR/venv/bin/pip}"
BACKEND_PORT="${BACKEND_PORT:-18000}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
SKIP_DEP_INSTALL="${SKIP_DEP_INSTALL:-false}"
APP_NAME="ModelForge"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-io.modelforge.desktop}"
ELECTRON_VERSION="${ELECTRON_VERSION:-35.7.5}"
ELECTRON_CACHE_DIR="${ELECTRON_CACHE_DIR:-$HOME/Library/Caches/electron}"

if [ "$(uname -m)" = "arm64" ]; then
  ELECTRON_ARCH="arm64"
else
  ELECTRON_ARCH="x64"
fi

ELECTRON_ZIP="electron-v${ELECTRON_VERSION}-darwin-${ELECTRON_ARCH}.zip"
ELECTRON_ZIP_PATH="${ELECTRON_CACHE_DIR}/${ELECTRON_ZIP}"
ELECTRON_DOWNLOAD_URL="${ELECTRON_DOWNLOAD_URL:-https://cdn.npmmirror.com/binaries/electron/v${ELECTRON_VERSION}/${ELECTRON_ZIP}}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

npm_install_with_retry() {
  local dir="$1"
  local omit_optional="${2:-true}"
  local attempts=3
  local try=1
  local omit_flag=""

  if [ "$omit_optional" = "true" ]; then
    omit_flag="--omit=optional"
  fi

  while [ "$try" -le "$attempts" ]; do
    if (
      cd "$dir" &&
      npm install \
        $omit_flag \
        --no-audit \
        --progress=false \
        --registry "$NPM_REGISTRY" \
        --fetch-retries 5 \
        --fetch-retry-mintimeout 20000 \
        --fetch-retry-maxtimeout 120000 \
        --fetch-timeout 300000
    ); then
      return 0
    fi
    log "npm install failed in $dir (attempt $try/$attempts)"
    try=$((try + 1))
    sleep 2
  done

  return 1
}

cleanup_redundant_files() {
  log 'Cleaning redundant files and previous build outputs...'

  rm -rf "$ROOT_DIR/release"
  rm -rf "$FRONTEND_DIR/dist"
  rm -rf "$BACKEND_DIR/build" "$BACKEND_DIR/dist"
  rm -rf "$DESKTOP_DIR/frontend-dist" "$DESKTOP_DIR/backend-bin"
  rm -rf "$DESKTOP_DIR/node_modules/electron"

  rm -f "$ROOT_DIR/start-dev.log" "$BACKEND_DIR/backend.log"
  rm -f "$ROOT_DIR/logs/backend.log" "$ROOT_DIR/logs/frontend.log"

  find "$ROOT_DIR/backend/app" -type d -name '__pycache__' -prune -exec rm -rf {} +
  find "$ROOT_DIR/backend" -name '*.pyc' -delete
  find "$ROOT_DIR" -name '.DS_Store' -delete
}

ensure_backend_venv() {
  require_command python3

  if [ ! -x "$BACKEND_VENV_PYTHON" ] || [ ! -x "$BACKEND_VENV_PIP" ]; then
    log 'Creating backend virtual environment...'
    python3 -m venv "$BACKEND_DIR/venv"
  fi
}

build_frontend() {
  local esbuild_version

  log 'Building frontend dist...'
  pushd "$FRONTEND_DIR" >/dev/null
  if [ "$SKIP_DEP_INSTALL" != "true" ]; then
    npm_install_with_retry "$FRONTEND_DIR" false
    esbuild_version="$(node -p "require('./node_modules/esbuild/package.json').version")"
    npm install --no-save "@esbuild/darwin-arm64@${esbuild_version}" \
      --registry "$NPM_REGISTRY" \
      --fetch-retries 5 \
      --fetch-retry-mintimeout 20000 \
      --fetch-retry-maxtimeout 120000 \
      --fetch-timeout 300000
  else
    log 'Skipping frontend dependency install (SKIP_DEP_INSTALL=true)'
    if [ ! -d "$FRONTEND_DIR/node_modules/@esbuild/darwin-arm64" ] && [ -x "$FRONTEND_DIR/node_modules/esbuild/bin/esbuild" ]; then
      export ESBUILD_BINARY_PATH="$FRONTEND_DIR/node_modules/esbuild/bin/esbuild"
      log "Using ESBUILD_BINARY_PATH fallback: ${ESBUILD_BINARY_PATH}"
    fi
  fi
  VITE_API_URL="http://127.0.0.1:${BACKEND_PORT}/api" \
  VITE_DESKTOP=true \
  npm run build -- --base ./
  popd >/dev/null
}

build_backend_binary() {
  log 'Building backend with PyInstaller...'

  ensure_backend_venv

  if [ "$SKIP_DEP_INSTALL" != "true" ]; then
    "$BACKEND_VENV_PIP" install -r "$BACKEND_DIR/requirements.txt"
    "$BACKEND_VENV_PIP" install pyinstaller
  else
    log 'Skipping backend dependency install (SKIP_DEP_INSTALL=true)'
  fi

  pushd "$BACKEND_DIR" >/dev/null
  "$BACKEND_VENV_PYTHON" -m PyInstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name backend-api \
    --paths "$BACKEND_DIR" \
    --collect-submodules app \
    --collect-all uvicorn \
    --collect-all fastapi \
    --collect-all starlette \
    --collect-all pydantic \
    --collect-all pydantic_settings \
    entrypoint.py
  popd >/dev/null
}

download_electron_runtime() {
  require_command curl
  require_command unzip

  mkdir -p "$ELECTRON_CACHE_DIR"

  if [ -f "$ELECTRON_ZIP_PATH" ] && (set +o pipefail; unzip -l "$ELECTRON_ZIP_PATH" | grep -q "Electron.app/"); then
    log "Reusing cached Electron runtime: ${ELECTRON_ZIP_PATH}"
    return 0
  fi

  log "Preparing Electron runtime: ${ELECTRON_ZIP}"
  curl -fL -C - \
    --retry 10 \
    --retry-delay 3 \
    --retry-all-errors \
    --connect-timeout 20 \
    -o "$ELECTRON_ZIP_PATH" \
    "$ELECTRON_DOWNLOAD_URL"
}

build_dmg() {
  local app_bundle_path="$ROOT_DIR/release/${APP_NAME}.app"
  local electron_unpack_dir="$ROOT_DIR/release/.electron_runtime"
  local app_payload_dir="$ROOT_DIR/release/.app_payload"
  local dmg_payload_dir="$ROOT_DIR/release/.dmg_payload"
  local dmg_path="$ROOT_DIR/release/${APP_NAME}-${ELECTRON_ARCH}.dmg"
  local plist_path="$app_bundle_path/Contents/Info.plist"

  download_electron_runtime

  if ! (set +o pipefail; unzip -l "$ELECTRON_ZIP_PATH" | grep -q "Electron.app/"); then
    printf 'Invalid electron runtime zip: %s\n' "$ELECTRON_ZIP_PATH" >&2
    exit 1
  fi

  log "Assembling app from Electron runtime: ${ELECTRON_ZIP_PATH}"
  mkdir -p "$ROOT_DIR/release"
  rm -rf "$app_bundle_path" "$app_payload_dir" "$electron_unpack_dir"

  unzip -q "$ELECTRON_ZIP_PATH" -d "$electron_unpack_dir"
  cp -R "$electron_unpack_dir/Electron.app" "$app_bundle_path"

  mkdir -p "$app_payload_dir"
  cp "$DESKTOP_DIR/main.js" "$app_payload_dir/main.js"
  cp "$DESKTOP_DIR/preload.js" "$app_payload_dir/preload.js"
  cp "$DESKTOP_DIR/computer-helper.js" "$app_payload_dir/computer-helper.js"
  cp "$DESKTOP_DIR/controlled-browser.js" "$app_payload_dir/controlled-browser.js"
  cp "$DESKTOP_DIR/status-hud.js" "$app_payload_dir/status-hud.js"
  cp "$DESKTOP_DIR/package.json" "$app_payload_dir/package.json"
  cp -R "$FRONTEND_DIR/dist" "$app_payload_dir/frontend-dist"
  cp -R "$BACKEND_DIR/dist/backend-api" "$app_payload_dir/backend-bin"

  rm -rf "$app_bundle_path/Contents/Resources/app" "$app_bundle_path/Contents/Resources/app.asar"
  rm -f "$app_bundle_path/Contents/Resources/default_app.asar"
  cp -R "$app_payload_dir" "$app_bundle_path/Contents/Resources/app"

  # Compatibility shim for legacy path layout used by older app builds.
  mkdir -p "$app_bundle_path/Contents/Resources/backend/dist"
  mkdir -p "$app_bundle_path/Contents/Resources/frontend"
  ln -sfn ../../app/backend-bin "$app_bundle_path/Contents/Resources/backend/dist/backend-api"
  ln -sfn ../app/frontend-dist "$app_bundle_path/Contents/Resources/frontend/dist"

  if [ -f "$plist_path" ]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$plist_path" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$plist_path" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_BUNDLE_ID" "$plist_path" 2>/dev/null || true
  fi

  if [ ! -d "$app_bundle_path" ]; then
    printf 'Packaged app not found: %s\n' "$app_bundle_path" >&2
    exit 1
  fi

  log 'Re-signing assembled app (ad-hoc) to avoid invalid signature issues...'
  codesign --force --deep --sign - "$app_bundle_path"
  xattr -dr com.apple.quarantine "$app_bundle_path" 2>/dev/null || true
  codesign --verify --deep --strict --verbose=2 "$app_bundle_path"

  log 'Preparing DMG payload (app + Applications symlink)...'
  rm -rf "$dmg_payload_dir"
  mkdir -p "$dmg_payload_dir"
  cp -R "$app_bundle_path" "$dmg_payload_dir/${APP_NAME}.app"
  ln -s /Applications "$dmg_payload_dir/Applications"

  log 'Creating DMG with hdiutil...'
  hdiutil create -volname "$APP_NAME" -srcfolder "$dmg_payload_dir" -ov -format UDZO "$dmg_path" >/dev/null
  rm -rf "$electron_unpack_dir"
  rm -rf "$app_payload_dir"
  rm -rf "$dmg_payload_dir"
}

main() {
  require_command npm
  require_command hdiutil
  require_command codesign

  cleanup_redundant_files
  build_frontend
  build_backend_binary
  build_dmg

  log 'Build finished.'
  log "DMG output directory: $ROOT_DIR/release"
}

main "$@"
