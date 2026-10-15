#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export DISPLAY=:97
export TMPDIR="$root/tmp"
export SDL_VIDEODRIVER=x11
mkdir -p "$TMPDIR"
children=()
cleanup() { for child in "${children[@]}"; do kill "$child" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
Xvfb :97 -screen 0 432x960x24 -nolisten tcp -noreset -ac > "$root/xvfb.log" 2>&1 &
children+=("$!")
for attempt in {1..30}; do [ -S /tmp/.X11-unix/X97 ] && break; sleep .2; done
x11vnc -display :97 -localhost -rfbport 5907 -nopw -forever -shared -quiet > "$root/x11vnc.log" 2>&1 &
children+=("$!")
/usr/bin/python3 "$root/viewer.py" > "$root/websockify.log" 2>&1 &
children+=("$!")
printf 'Android viewer: http://127.0.0.1:6087/android.html\n'
wait -n "${children[@]}"
