#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

INSTALL_DEPS=1
START_BACKEND=1
START_FRONTEND=1
CHECK_OLLAMA=1

BACKEND_PID=""
FRONTEND_PID=""
EXITING=0

usage() {
  cat <<'EOF'
Usage: ./start-dev.sh [options]

Options:
  --no-install       Skip dependency installation (pip/npm)
  --backend-only     Start backend only
  --frontend-only    Start frontend only
  --skip-ollama      Skip Ollama connectivity check
  -h, --help         Show this help message

Environment overrides:
  BACKEND_PORT=8000
  FRONTEND_PORT=5173
  OLLAMA_HOST=http://localhost:11434
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

wait_http_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi

    if [ "$(($(date +%s) - start_ts))" -ge "$timeout_seconds" ]; then
      return 1
    fi
    sleep 1
  done
}

cleanup() {
  if [ "$EXITING" -eq 1 ]; then
    return
  fi
  EXITING=1

  log "Shutting down services..."
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
}

on_signal() {
  cleanup
  exit 0
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-install)
        INSTALL_DEPS=0
        ;;
      --backend-only)
        START_BACKEND=1
        START_FRONTEND=0
        ;;
      --frontend-only)
        START_BACKEND=0
        START_FRONTEND=1
        ;;
      --skip-ollama)
        CHECK_OLLAMA=0
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

prepare_backend() {
  command_exists python3 || die "python3 not found"

  mkdir -p "$BACKEND_DIR"
  if [ ! -d "$BACKEND_DIR/venv" ]; then
    log "Creating backend virtual environment..."
    python3 -m venv "$BACKEND_DIR/venv"
  fi

  if [ "$INSTALL_DEPS" -eq 1 ]; then
    log "Installing backend dependencies..."
    "$BACKEND_DIR/venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt" >/dev/null
  fi
}

prepare_frontend() {
  command_exists npm || die "npm not found"
  mkdir -p "$FRONTEND_DIR"

  if [ "$INSTALL_DEPS" -eq 1 ]; then
    log "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install --silent)
  fi
}

start_backend() {
  port_in_use "$BACKEND_PORT" && die "Backend port $BACKEND_PORT is already in use"
  log "Starting backend on http://localhost:$BACKEND_PORT"

  (
    cd "$BACKEND_DIR"
    "$BACKEND_DIR/venv/bin/python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT"
  ) >"$LOG_DIR/backend.log" 2>&1 &
  BACKEND_PID="$!"

  if ! wait_http_ready "http://127.0.0.1:${BACKEND_PORT}/api/health" 45; then
    log "Backend failed to become ready. Last logs:"
    tail -n 80 "$LOG_DIR/backend.log" || true
    die "Backend startup failed"
  fi
}

start_frontend() {
  port_in_use "$FRONTEND_PORT" && die "Frontend port $FRONTEND_PORT is already in use"
  log "Starting frontend on http://localhost:$FRONTEND_PORT"

  (
    cd "$FRONTEND_DIR"
    npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
  ) >"$LOG_DIR/frontend.log" 2>&1 &
  FRONTEND_PID="$!"

  if ! wait_http_ready "http://127.0.0.1:${FRONTEND_PORT}" 60; then
    log "Frontend failed to become ready. Last logs:"
    tail -n 80 "$LOG_DIR/frontend.log" || true
    die "Frontend startup failed"
  fi
}

monitor_processes() {
  while true; do
    if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      log "Backend process exited unexpectedly."
      tail -n 80 "$LOG_DIR/backend.log" || true
      return 1
    fi
    if [ -n "$FRONTEND_PID" ] && ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
      log "Frontend process exited unexpectedly."
      tail -n 80 "$LOG_DIR/frontend.log" || true
      return 1
    fi
    sleep 1
  done
}

main() {
  parse_args "$@"
  trap on_signal INT TERM
  trap cleanup EXIT

  mkdir -p "$LOG_DIR"

  if [ "$START_BACKEND" -eq 0 ] && [ "$START_FRONTEND" -eq 0 ]; then
    die "Nothing to start. Use --backend-only or --frontend-only correctly."
  fi

  log "Starting ModelForge development environment..."

  if [ "$CHECK_OLLAMA" -eq 1 ] && [ "$START_BACKEND" -eq 1 ]; then
    if ! curl -fsS --max-time 2 "${OLLAMA_HOST}/api/version" >/dev/null 2>&1; then
      log "WARNING: Ollama is unreachable at ${OLLAMA_HOST}"
      log "         Start Ollama first if you need model inference."
    else
      log "Ollama is reachable at ${OLLAMA_HOST}"
    fi
  fi

  if [ "$START_BACKEND" -eq 1 ]; then
    prepare_backend
    start_backend
  fi

  if [ "$START_FRONTEND" -eq 1 ]; then
    prepare_frontend
    start_frontend
  fi

  echo
  echo "========================================"
  [ "$START_FRONTEND" -eq 1 ] && echo "Frontend: http://localhost:${FRONTEND_PORT}"
  [ "$START_BACKEND" -eq 1 ] && echo "Backend:  http://localhost:${BACKEND_PORT}"
  [ "$START_BACKEND" -eq 1 ] && echo "API Docs: http://localhost:${BACKEND_PORT}/docs"
  echo "Logs:     $LOG_DIR/backend.log | $LOG_DIR/frontend.log"
  echo "Press Ctrl+C to stop"
  echo "========================================"
  echo

  monitor_processes
}

main "$@"
