#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

bind_host="${APP_HOST:-127.0.0.1}"
if [[ "$bind_host" != "127.0.0.1" && "$bind_host" != "localhost" && "$bind_host" != "::1" && -z "${OLLAMA_WEB_TOKEN:-}" ]]; then
  echo "Refusing to bind to $bind_host without OLLAMA_WEB_TOKEN." >&2
  echo "Set a strong token in .env, or use APP_HOST=127.0.0.1 with SSH port forwarding." >&2
  exit 1
fi

uvicorn_command="uvicorn"
if [[ -x ".venv/bin/uvicorn" ]]; then
  uvicorn_command=".venv/bin/uvicorn"
fi

exec "$uvicorn_command" app:app \
  --host "$bind_host" \
  --port "${APP_PORT:-9955}" \
  --proxy-headers
