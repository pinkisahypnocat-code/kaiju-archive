#!/usr/bin/env bash
# Local preview: builds data/index.json + data/mail.json from content/ first,
# then serves the site so opening it in a browser always shows the freshly
# generated output — same idea as the GitHub Action, just for your machine.
set -e
cd "$(dirname "$0")/.."

echo "Building site data..."
python3 scripts/build_index.py

PORT="${PORT:-8000}"
URL="http://localhost:$PORT/"
echo "Serving at $URL (Ctrl+C to stop)"

# Best-effort: open the browser automatically once the server is likely up.
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) &

python3 -m http.server "$PORT"
