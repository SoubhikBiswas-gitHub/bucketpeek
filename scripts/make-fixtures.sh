#!/usr/bin/env bash
# Builds the fake bucket used by `npm run dev:mock`, the Docker demo profile and
# the Playwright suite. Safe to re-run: it builds into a staging folder and then
# syncs it over the target, so stale files disappear and the result is always
# the same set of keys.
#
#   bash scripts/make-fixtures.sh            # writes fixtures/bucket/
#   bash scripts/make-fixtures.sh /some/dir  # writes somewhere else
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-$ROOT/fixtures/bucket}"
FFMPEG="${FFMPEG_PATH:-ffmpeg}"

say() { printf '  %s\n' "$*"; }
die() { printf 'make-fixtures: %s\n' "$*" >&2; exit 1; }

if ! command -v "$FFMPEG" >/dev/null 2>&1; then
  die "ffmpeg not found. Install it with 'brew install ffmpeg' (or set FFMPEG_PATH) and run again."
fi

ENCODERS="$("$FFMPEG" -hide_banner -encoders 2>/dev/null)"
has_encoder() { grep -qE "^ [A-Z.]{6} $1 " <<<"$ENCODERS"; }

# H.264: libx264 gives identical output everywhere; VideoToolbox is the macOS fallback.
if has_encoder libx264; then H264=(-c:v libx264 -preset veryfast -pix_fmt yuv420p -profile:v high)
elif has_encoder h264_videotoolbox; then H264=(-c:v h264_videotoolbox -b:v 2M -pix_fmt yuv420p)
else die "this ffmpeg has no H.264 encoder (libx264 or h264_videotoolbox)."; fi
has_encoder libvpx-vp9 || die "this ffmpeg has no VP9 encoder (libvpx-vp9). 'brew install ffmpeg' includes it."
has_encoder libmp3lame || die "this ffmpeg has no MP3 encoder (libmp3lame). 'brew install ffmpeg' includes it."

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/deccan-lens-fixtures.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
B="$STAGE/bucket"
mkdir -p "$B/Construction" "$B/Factory/annotated" "$B/Factory/episodes" "$B/empty_folder"

ff() { "$FFMPEG" -hide_banner -loglevel error -nostdin -y "$@"; }

echo "Building fixture bucket in $TARGET"

# ---------------------------------------------------------------- video
say "videos"
ff -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=8" \
   -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=8" \
   "${H264[@]}" -c:a aac -b:a 128k -movflags +faststart -shortest \
   "$B/Factory/episode_0001_pick_and_place.mp4"
# Browsers can't play MPEG-4 Part 2 in AVI: this one exercises ffmpeg -> HLS conversion.
ff -f lavfi -i "testsrc=size=640x360:rate=25:duration=8" \
   -f lavfi -i "sine=frequency=660:sample_rate=44100:duration=8" \
   -c:v mpeg4 -q:v 5 -c:a libmp3lame -b:a 96k -ac 1 -shortest \
   "$B/Factory/episode_0002_conveyor_sort.avi"
ff -f lavfi -i "testsrc2=size=960x540:rate=24:duration=6" \
   -c:v libvpx-vp9 -b:v 0 -crf 45 -deadline realtime -cpu-used 8 -an \
   "$B/Factory/episode_0003_forklift_route_b.webm"
ff -f lavfi -i "smptebars=size=1280x720:rate=30:duration=8" \
   -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=8" \
   "${H264[@]}" -c:a aac -b:a 128k -movflags +faststart -shortest \
   "$B/Factory/episodes/ep_a.mp4"

# ---------------------------------------------------------------- images
say "images"
ff -f lavfi -i "testsrc2=size=1920x1080" -frames:v 1 "$B/Factory/frame_0001.png"
ff -f lavfi -i "testsrc2=size=1920x1080" -frames:v 1 \
   -vf "drawbox=x=620:y=300:w=520:h=380:color=red@0.9:t=8,drawbox=x=160:y=620:w=300:h=260:color=yellow@0.9:t=8" \
   "$B/Factory/annotated/frame_0001_labeled.png"
ff -f lavfi -i "mandelbrot=size=1200x800" -frames:v 1 -q:v 3 "$B/Factory/site_overview.jpg"
ff -f lavfi -i "gradients=size=1200x800:seed=7" -frames:v 1 -q:v 3 "$B/Construction/crane_view.jpg"

# ---------------------------------------------------------------- audio
say "audio"
ff -f lavfi -i "sine=frequency=220:sample_rate=44100:duration=5" \
   -af "volume=0.6,tremolo=f=3:d=0.5" -c:a libmp3lame -b:a 56k -ac 1 \
   "$B/Factory/operator_notes.mp3"

# ---------------------------------------------------------------- text
say "text, data and code"
cat >"$B/Factory/README.md" <<'EOF'
# Factory episodes

Recorded on the **Pune** line, August 2026.

- 3 cameras per station
- 30 fps, 1080p

| Station | Episodes |
|---|---|
| Packing | 124 |
| Welding | 87 |

```python
print("hello")
```
EOF

{
  printf '{"episodes": ['
  for i in $(seq 0 39); do
    [ "$i" -gt 0 ] && printf ', '
    printf '{"id": %d, "station": "packing", "duration_s": %d, "labels": ["pick", "place"]}' "$i" $((30 + i))
  done
  printf ']}\n'
} >"$B/Factory/episodes_index.json"

# 120 data rows, deterministic (fixed awk seed).
awk 'BEGIN {
  srand(42)
  split("packing welding sorting", st, " ")
  print "episode_id,station,duration_s,operator,quality"
  for (i = 0; i < 120; i++)
    printf "%04d,%s,%d,op_%d,%.3f\n", i, st[int(i / 40) + 1], 20 + int(rand() * 70), 1 + int(rand() * 8), rand()
}' >"$B/Factory/raw_episodes_index.csv"

cat >"$B/Factory/load_index.py" <<'EOF'
import json


def load(path):
    """Load an index file."""
    with open(path) as f:
        return json.load(f)


if __name__ == "__main__":
    print(len(load("episodes_index.json")["episodes"]))
EOF

cat >"$B/Factory/capture.log" <<'EOF'
2026-08-14T09:00:01Z INFO  capture started station=packing cameras=3
2026-08-14T09:00:02Z INFO  camera 1 online 1920x1080@30
2026-08-14T09:00:02Z INFO  camera 2 online 1920x1080@30
2026-08-14T09:00:03Z INFO  camera 3 online 1920x1080@30
2026-08-14T09:04:17Z WARN  camera 2 dropped 3 frames (buffer full)
2026-08-14T09:09:40Z ERROR camera 3 lost sync, re-arming trigger
2026-08-14T09:09:41Z INFO  camera 3 resynced after 812 ms
2026-08-14T09:30:00Z WARN  disk usage at 81%
2026-08-14T09:30:05Z INFO  episode 0001 closed duration=30s frames=2700
2026-08-14T09:30:06Z INFO  upload complete
EOF

# ---------------------------------------------------------------- pdf
say "pdf"
PDF="$B/Factory/summary.pdf"
PDF_SRC="$STAGE/summary.txt"
cat >"$PDF_SRC" <<'EOF'
Deccan Lens fixture: Factory summary

Station    Episodes   Avg duration
Packing    124        31 s
Welding    87         48 s
Sorting    40         55 s

Recorded on the Pune line, August 2026.
EOF
if command -v cupsfilter >/dev/null 2>&1 && cupsfilter -m application/pdf "$PDF_SRC" >"$PDF" 2>/dev/null && [ -s "$PDF" ]; then
  :
else
  # No cupsfilter (Linux, CI): write a minimal valid one-page PDF with correct xref offsets.
  command -v node >/dev/null 2>&1 || die "need cupsfilter (macOS) or node to write summary.pdf."
  node - "$PDF" <<'EOF'
const fs = require("fs");
const lines = ["Deccan Lens fixture: Factory summary", "Packing 124 episodes", "Welding 87 episodes", "Sorting 40 episodes"];
const text = lines.map((l, i) => `BT /F1 ${i ? 14 : 20} Tf 72 ${720 - i * 32} Td (${l}) Tj ET`).join("\n");
const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let out = "%PDF-1.4\n";
const offsets = objs.map((o, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(process.argv[2], out);
EOF
fi

# ---------------------------------------------------------------- archives and binary
say "zip and binary"
if command -v zip >/dev/null 2>&1; then
  (cd "$B/Factory" && zip -q -X calibration.zip load_index.py capture.log)
elif command -v python3 >/dev/null 2>&1; then
  (cd "$B/Factory" && python3 -m zipfile -c calibration.zip load_index.py capture.log)
else
  die "need zip or python3 to write calibration.zip."
fi
head -c 20000 /dev/urandom >"$B/Factory/sensor_dump.bin"

# S3 has no empty folders; locally the mock storage skips dotfiles, so this keeps
# the folder on disk while it still lists as empty.
: >"$B/empty_folder/.keep"

# ---------------------------------------------------------------- publish
mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$B/" "$TARGET/"
else
  find "$TARGET" -mindepth 1 -delete
  cp -R "$B/." "$TARGET/"
fi

count="$(find "$TARGET" -type f ! -name '.*' | wc -l | tr -d ' ')"
echo "Done: $count files in $TARGET"
