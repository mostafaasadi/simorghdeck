#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

STATIC_DIR="static"
VENDOR_DIR="$STATIC_DIR/vendor"

CHART_URL="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.js"
LUCIDE_URL="https://cdn.jsdelivr.net/npm/lucide@latest/dist/umd/lucide.min.js"

CHART_PATH="$VENDOR_DIR/chart.umd.js"
LUCIDE_PATH="$VENDOR_DIR/lucide.min.js"

mkdir -p "$VENDOR_DIR"

download() {
  local url="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --retry-delay 1 -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$url" "$output"
  else
    echo "curl, wget, or python3 is required" >&2
    exit 1
  fi
}

echo "Downloading Chart.js"
download "$CHART_URL" "$CHART_PATH"

echo "Downloading Lucide"
download "$LUCIDE_URL" "$LUCIDE_PATH"

for file in "$CHART_PATH" "$LUCIDE_PATH"; do
  if [ ! -s "$file" ]; then
    echo "Download failed: $file" >&2
    exit 1
  fi
done

echo "All assets downloaded"

