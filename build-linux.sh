#!/usr/bin/env bash
# Build Vision Studio for Linux (Ubuntu / Debian) – the counterpart of build-windows.bat.
#
#   ./build-linux.sh            build release/VisionStudio/ (binary + vision-studio.ini + ui_config.json)
#   ./build-linux.sh --deps     also install the Ubuntu packages Tauri needs (sudo apt)
#   ./build-linux.sh --skip-tests
#
# Run it:  ./release/VisionStudio/vision-studio            (mode from vision-studio.ini)
#          ./release/VisionStudio/vision-studio --mode web  (browser UI on http://127.0.0.1:8080/)
#
# Folders are resolved against release/VisionStudio/, so the defaults
# ../../configurations/project_configuration etc. are <repo>/configurations/… .
set -euo pipefail
cd "$(dirname "$0")"

OUT="release/VisionStudio"
DEPS=0; TESTS=1
for a in "$@"; do
  case "$a" in
    --deps) DEPS=1 ;;
    --skip-tests) TESTS=0 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n[%s] %s\n' "$1" "$2"; }
fail() { printf '\n[ERROR] %s\n' "$1" >&2; exit 1; }

APT_PKGS="build-essential curl pkg-config libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev"

step 1/5 "Checking tools"
if [ "$DEPS" = 1 ]; then
  sudo apt-get update && sudo apt-get install -y $APT_PKGS
fi
command -v npm >/dev/null   || fail "npm not found – install Node.js 18+ (https://nodejs.org/ or: sudo apt install nodejs npm)"
command -v cargo >/dev/null || fail "cargo not found – install Rust: curl https://sh.rustup.rs -sSf | sh"
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  fail "webkit2gtk-4.1 not found – run: ./build-linux.sh --deps   (or: sudo apt install $APT_PKGS)"
fi
echo "       Node.js $(node -p process.versions.node), $(cargo --version)"

step 2/5 "Installing JavaScript packages"
npm ci --no-audit --no-fund

if [ "$TESTS" = 1 ]; then
  step 3/5 "Running tests"
  npm test
else
  step 3/5 "Skipping tests"
fi

step 4/5 "Building (this takes a few minutes the first time)"
npx tauri build --no-bundle

step 5/5 "Assembling $OUT"
mkdir -p "$OUT"
install -m 755 src-tauri/target/release/vision-studio "$OUT/vision-studio"
# keep the user's settings on rebuilds
[ -f "$OUT/vision-studio.ini" ] || cp config/vision-studio.ini "$OUT/vision-studio.ini"
[ -f "$OUT/ui_config.json" ] || cp config/ui_config.json "$OUT/ui_config.json"
cp config/README-portable.txt "$OUT/README.txt"

cat <<EOF

Done.
   Program : $PWD/$OUT/vision-studio
   Settings: $PWD/$OUT/vision-studio.ini   (mode = desktop | web)
   Lists   : $PWD/$OUT/ui_config.json     (edited in File > Settings)
   Saves to: project_dir / tester_dir in vision-studio.ini (default $(cd "$OUT/../.." && pwd)/configurations/…)

Start:  ./$OUT/vision-studio            or   ./$OUT/vision-studio --mode web
EOF
