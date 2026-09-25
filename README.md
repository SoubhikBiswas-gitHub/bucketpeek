# Deccan Lens

Browse and preview everything in an AWS S3 bucket, in the browser.

Connect a bucket with an access key, then move through folders, search, and open any file:
videos play (including formats browsers can't, converted on the fly with ffmpeg, and damaged
files Deccan Lens can repair as they play), images zoom, tables and code render properly, and
anything else can be downloaded. A one-time check of the bucket lists every video that won't play
anywhere, so the right person can fix it.

## What it previews

| Kind | Extensions | How |
| --- | --- | --- |
| Video | mp4, m4v, mov, webm, mkv, ogv | Streams directly from S3 (byte ranges; links renew while playing). Fragmented, badly laid-out and damaged MP4s stream through the server, fixed on the fly. |
| Video (converted) | avi, mpeg, mpg, ts, m2ts, mts, wmv, flv, 3gp, mxf | HLS converted by ffmpeg on demand: full timeline at once, seek anywhere |
| Image | png, jpg, gif, webp, avif, svg, bmp | Zoom and pan |
| Audio | mp3, wav, ogg, m4a, aac, flac, opus | Waveform player |
| PDF | pdf | Browser PDF viewer |
| Markdown | md, mdx | Rendered, sanitized |
| JSON | json, geojson | Collapsible tree |
| Table | csv, tsv | Sortable table |
| Code and text | py, js, ts, go, sql, yaml, log, txt and more | Syntax highlighted |
| Anything else | zip, bin, … | File details and download |

In the grid view, tiles near the screen show a preview instead of the file-type icon: images
(up to 10 MB), a video frame (ffmpeg), a PDF's first page (pdftoppm from poppler-utils, PDFs up to
50 MB) and the first lines of text, code and data files. Without ffmpeg or pdftoppm those tiles
keep their icon.

## Features

Each guide below starts with what you see and do, and ends with a "How it works" section for
developers.

### Video playback

Every video opens in the same player. Deccan Lens picks the fastest way to play each file:

- **Most MP4, MOV and WebM files** play straight from S3.
- **Camera MP4s saved in fragments** are sent to the player fragment by fragment, so they start
  at once instead of after a long wait.
- **MP4s with their index at the end, behind thousands of small boxes**, are served with the index
  moved to the front ("faststart").
- **MP4s with a damaged index** (a known fault of some de-identification tools) are repaired as
  they play.
- **AVI, TS, WMV and other formats**, and MP4s with a very large index, are converted by ffmpeg as
  you watch.

Nothing in S3 is changed. Repairs fix only where the index points; video data that is missing
from a file can't be brought back. An empty (0-byte) file says "This video is empty". A file that
can't play says why and offers Download and Copy link.
Guide: [docs/video-playback.md](docs/video-playback.md).

### Bucket health and overview

The first time a bucket is opened, the server checks every video once in the background and
saves the result. **Bucket health** (`/health`) lists files that are empty, have no index, are
damaged, can't be read, or play only because Deccan Lens repairs them, with what each means and
who should fix it. Click **Scan again** to check again. At the bucket root, **Bucket overview**
shows file counts and sizes per type, from the same check at no extra cost. The check costs only
S3 requests: about 3 US cents for 100,000 files.
Guide: [docs/bucket-health.md](docs/bucket-health.md).

### Copy link

**Copy link** asks how long the link should work: 1 hour, 6 hours, 24 hours or 7 days. It shows
the end time, for example "Works until 26 Sep 2026, 11:30 UTC · 26 Sep 2026, 5:00 PM IST". Anyone
with the link can open the file until then. The link lifetime is no longer set on the setup page.
Guide: [docs/links-and-downloads.md](docs/links-and-downloads.md).

### Downloads

- **One file**: no size limit. It downloads in your browser, which can resume a dropped download
  while the link still works (15 minutes, or 12 hours for files over 5 GB).
- **A selection**: up to 1 GB and 50 files at once (`LENS_BULK_DOWNLOAD_MAX_GB`,
  `LENS_BULK_DOWNLOAD_MAX_FILES`), because every byte downloaded is billed as S3 data transfer.
- **Big files and folders**: **Copy AWS CLI command(s)** gives commands like
  `aws s3 cp 's3://my-bucket/path/file.mp4' .` or
  `aws s3 cp --recursive 's3://my-bucket/folder/' './folder/'`. Run them with your own AWS
  credentials. The quoting is for POSIX shells (macOS, Linux, WSL); on Windows, use WSL or adapt it.

Guide: [docs/links-and-downloads.md](docs/links-and-downloads.md).

### File details

**ⓘ File details** in the viewer shows the full key and S3 URI, size, content type and dates;
S3 object facts (ETag, storage class, encryption, checksums, metadata, tags, Object Lock…); for
videos, codec, resolution, frame rate and bitrate from ffprobe, and the file's bucket health; and
the file's `<name>_METADATA.json` sidecar when there is one. Tags need `s3:GetObjectTagging`.
Opening it costs 3–4 S3 requests per file, plus ffprobe's reads the first time a video is opened.
Guide: [docs/file-details.md](docs/file-details.md).

## Run on your Mac

Needs Node 24 (`brew install node@24`) and, for video conversion, ffmpeg (`brew install ffmpeg`).

```bash
npm install
cp .env.example .env.local
node -e "console.log('SECRET_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env.local
npm run dev
```

Open <http://localhost:3000> and enter your access key ID, secret access key and bucket name.
You can paste the bucket as a name, an `s3://` URL, an ARN or an S3 console URL.

The dev server listens on 127.0.0.1 only. Without `SECRET_KEY` it creates a random one in
`.lens/secret` (mode 0600, not committed) and reuses it, so sessions survive restarts.

## Try it without AWS

```bash
npm run fixtures     # builds fixtures/bucket/ with a sample of every file type (needs ffmpeg)
npm run dev:mock     # http://localhost:3100
```

Mock mode serves `fixtures/bucket/` as if it were a bucket. Any credentials connect.

## Stop and restart

```bash
lsof -ti :3000 | xargs kill     # use :3100 for dev:mock
npm run dev
```

Keep it to one server process: video conversion jobs and bucket checks in progress live in memory.

## Run with Docker

The image is a Next.js standalone build on `node:24-slim` with ffmpeg included. It runs as a non-root user and has a health check.

```bash
docker build -t deccan-lens .
docker run -d --name deccan-lens -p 3000:3000 \
  -e SECRET_KEY="$(openssl rand -hex 32)" \
  --tmpfs /tmp:size=4g \
  deccan-lens
```

Add `-v deccan-lens-data:/data/hls` to keep the video cache and bucket health reports when the
container is replaced. Compose does this for you.

With Compose:

```bash
export SECRET_KEY="$(openssl rand -hex 32)"
docker compose up -d --build                           # http://localhost:3000
```

Demo profile, no AWS keys needed. It mounts `./fixtures/bucket` read-only as a mock bucket:

```bash
npm run fixtures
docker compose --profile demo up -d --build demo       # http://localhost:3001
docker compose --profile demo down
```

Compose requires `SECRET_KEY` for every service, the demo included. Run a single replica.
The session cookie is `Secure`, so the app must be reached over HTTPS or on `localhost`. To serve
plain http on another address, set `COOKIE_SECURE=false`.

## AWS permissions

Read-only access to one bucket is enough. The bucket's region is detected automatically.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ListBucket", "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::YOUR-BUCKET" },
    { "Sid": "ReadFiles", "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::YOUR-BUCKET/*" }
  ]
}
```

Use a long-term key that starts with `AKIA`. Temporary `ASIA` keys need a session token, which isn't supported.

Optional: to see object tags in File details, also allow `s3:GetObjectTagging` on
`arn:aws:s3:::YOUR-BUCKET/*`. Without it, everything works and File details says "Tags: not
readable with these keys".

## Costs

Deccan Lens charges no licence or per-stream fee. What it costs is AWS data transfer for the
video actually watched, the machine it runs on, and more CPU only when videos need converting.
S3 requests (listing, the one-time bucket check, File details) add cents.
See [docs/costs.md](docs/costs.md) for prices, measured numbers and a monthly estimate.

## Configuration

Set these in `.env.local` for local runs, or as container environment variables. Every variable
is optional except `SECRET_KEY` in production. An invalid number (empty, negative, not a number)
falls back to the default.

**Security and server**

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | none | Seals the session cookie and signs file links. 32+ characters. Required in production; without it everyone is signed out on restart. |
| `COOKIE_SECURE` | unset | Unset: the session cookie is `Secure` in production and on HTTPS requests (`x-forwarded-proto: https`). `false`: never Secure, for plain http in production (not recommended). `true`: always Secure. |
| `LENS_SECRET_FILE` | `.lens/secret` | Development only: where the generated secret is kept when `SECRET_KEY` is unset. |
| `LENS_MAX_INSPECTIONS` | `4` | Video index reads, ffprobe runs and fragment walks at once, across all users. More wait their turn. |
| `LENS_MAX_HEALTH_SCANS` | `2` | Bucket health checks running at once. |
| `LENS_MOCK_DIR` | unset | Serve a local folder as a fake bucket; any credentials connect. Development and demos only. |
| `FFMPEG_PATH` | `ffmpeg` on `PATH` | Path to ffmpeg if it isn't on `PATH`. Without ffmpeg, formats that need conversion offer a download instead. |
| `FFPROBE_PATH` | next to ffmpeg | Path to ffprobe, used to read a video's length. |
| `LENS_HLS_DIR` | system temp folder (`/data/hls` in the image) | Where converted segments are cached. |
| `LENS_HLS_MAX_GB`, `LENS_HLS_MAX_AGE_HOURS`, `LENS_HLS_KEEP_JOBS` | `20`, `24`, `24` | Caps on the segment cache: total size, age, and number of videos. |
| `LENS_MAX_CONVERSIONS` | half the CPU cores | ffmpeg processes running at once (one per video being played). |
| `LENS_BULK_DOWNLOAD_MAX_GB` | `1` | Largest total size (decimal GB, fractions allowed) that Download in the selection bar will fetch at once. Every downloaded byte is billed as S3 egress; see [docs/costs.md](docs/costs.md). |
| `LENS_BULK_DOWNLOAD_MAX_FILES` | `50` | Most files that Download in the selection bar starts at once. Browsers throttle, or ask about, many simultaneous downloads. |
| `PDFTOPPM_PATH` | `pdftoppm` on `PATH` | Path to pdftoppm (poppler-utils), used for PDF thumbnails in the grid. |
| `LENS_THUMBS_DIR` | `thumbs` in `LENS_HLS_DIR`, else a system temp folder | Where grid thumbnails (video frames, PDF pages) are cached. |
| `LENS_THUMBS_MAX_MB` | `256` | Cap on the thumbnail cache; the least recently shown are deleted first. |
| `PORT`, `HOSTNAME` | `3000`, `0.0.0.0` | Listen address for `npm start` and the container. |
| `NODE_ENV` | set by Next.js (`production` for `npm start` and the image) | Production mode requires `SECRET_KEY` for stable sessions and hides error details on error pages. |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Server log detail: `debug`, `info`, `warn`, `error` or `silent`. Production writes one JSON object per line (`time`, `level`, `msg`, `scope`, fields); development writes readable lines. Logs carry bucket names and object keys, never credentials, cookies or presigned URL query strings. API responses carry an `x-request-id` that matches their log lines. |
| `APP_COMMIT`, `APP_VERSION` | `unknown` | Build labels shown at `/api/version`. Set as Docker build arguments (`--build-arg APP_COMMIT=…`). |

**Video**

| Variable | Default | Purpose |
| --- | --- | --- |
| `FFMPEG_PATH` | `ffmpeg` on `PATH` (`/usr/bin/ffmpeg` in the image) | Path to ffmpeg. Without ffmpeg, formats that need conversion offer a download, and fragmented, damaged and big-index MP4s are tried directly in the browser. |
| `FFPROBE_PATH` | next to ffmpeg | Path to ffprobe, used to read a video's length and for the Video section of File details. |
| `LENS_MAX_CONVERSIONS` | half the CPU cores (at least 1) | ffmpeg conversions running at once (one per video being played). A new video takes the slot of one nobody is loading, or waits. |
| `LENS_HLS_DIR` | `deccan-lens-hls` in the system temp folder (`/data/hls` in the image) | Where converted segments and fragment indexes are cached. Also the parent of the default `LENS_HEALTH_DIR` and `LENS_THUMBS_DIR`. |
| `LENS_HLS_MAX_GB` | `20` | Largest size of the converted-segment cache, in GB of 2^30 bytes. |
| `LENS_HLS_MAX_AGE_HOURS` | `24` | Cached conversions older than this are deleted. |
| `LENS_HLS_KEEP_JOBS` | `24` | Most converted videos kept in the cache. |

**Bucket health, thumbnails and downloads**

| Variable | Default | Purpose |
| --- | --- | --- |
| `LENS_HEALTH_DIR` | `health` in `LENS_HLS_DIR` (`/data/hls/health` in the image) | Where bucket health reports are saved, one JSON file per bucket. Keep it on a volume so the check doesn't run again after a restart. |
| `PDFTOPPM_PATH` | `pdftoppm` on `PATH` | Path to pdftoppm (poppler-utils), used for PDF thumbnails in the grid. |
| `LENS_THUMBS_DIR` | `thumbs` in `LENS_HLS_DIR`, else `deccan-lens-thumbs` in the system temp folder | Where grid thumbnails (video frames, PDF pages) are cached. |
| `LENS_THUMBS_MAX_MB` | `256` | Cap on the thumbnail cache, in MB of 2^20 bytes; the least recently shown are deleted first. |
| `LENS_BULK_DOWNLOAD_MAX_GB` | `1` | Largest total size (decimal GB, fractions allowed) that Download in the selection bar will fetch at once. Every downloaded byte is billed as S3 egress; see [docs/costs.md](docs/costs.md). Read on each request, so a restart applies a change. |
| `LENS_BULK_DOWNLOAD_MAX_FILES` | `50` | Most files that Download in the selection bar starts at once. Browsers throttle, or ask about, many simultaneous downloads. |

**Mock mode (development and demos only)**

| Variable | Default | Purpose |
| --- | --- | --- |
| `LENS_MOCK_DIR` | unset | Serve a local folder as a fake bucket; any credentials connect. `npm run dev:mock` and the Compose demo set it. |
| `LENS_MOCK_LATENCY_MS` | `0` | Delay added to each mock file request from the browser, to imitate S3 round trips. At most 5000. |
| `LENS_MOCK_SERVER_LATENCY_MS` | `0` | The same, for the server's own reads of mock files. At most 5000. |

The Playwright tests also read `E2E_PORT` (default `3100`), `E2E_BASE_URL` and `CI`, and give each
run its own `LENS_HEALTH_DIR`.

## Project structure

```text
src/
  app/                    Routes (App Router)
    setup/                Connect form, validation schema, connect/disconnect server actions
    (app)/browse/         Folder listing (bucket overview at the root)
    (app)/view/           File viewer
    (app)/health/         Bucket health report
    api/
      files/              Open/download redirects, text reads, file details, fixed MP4s (playable)
      convert/, hls/      Server video streams: conversion, fragments, HLS playlists and segments
      health/             Bucket check: saved report, start and "Scan again"
      links/              Presigned links for Copy link, with the chosen lifetime
      list/, thumb/       Listing pages and grid thumbnails
      mock/, version/     Mock file server; build version
  components/
    browser/              Listing, grid, search and sort, row actions, selection bar
    viewer/               Preview stage, prev/next navigation, file details, one renderer per file kind
    health/               Bucket health report and bucket overview
    shell/                Top bar and page chrome
    setup/                Connection form, permissions helper, disconnect
    command/              Command palette and keyboard shortcuts
    common/               Shared pieces: breadcrumbs, kind icons, copy-link dialog, error and empty states
    ui/                   shadcn/ui primitives
  lib/                    Shared types, file kinds, paths, formatting, link lifetimes, AWS CLI commands
    server/               Server-only code
      storage/            Storage interface with S3 and local (mock) backends
      session.ts          Encrypted cookie session holding the connection
      mp4.ts              Reads an MP4's box layout and index; picks how it plays
      fmp4.ts             Fragmented MP4s: fragment index and moof rewriting for the player
      playable.ts         Faststart and index repair, as a virtual file served from S3
      convert.ts          On-demand HLS: playlist for the whole video, segments converted as requested
      health.ts           One-time bucket check of every video, saved on disk
      probe.ts            ffprobe facts for File details
      thumbs.ts           Grid thumbnails: video frames and PDF pages, queued and cached on disk
      preview.ts          Decides how each file is previewed
      data.ts             Page loaders
      errors.ts           AWS errors translated into plain messages
scripts/make-fixtures.sh  Builds the sample bucket
e2e/                      Playwright tests (run against dev:mock)
docs/                     Guides: video playback, bucket health, links and downloads, file details, costs
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on <http://localhost:3000> (127.0.0.1 only) |
| `npm run dev:mock` | Dev server on port 3100 (127.0.0.1 only) serving `fixtures/bucket/` |
| `npm run build` | Production build (standalone output) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests against `dev:mock`, reusing a running server. First run: `npx playwright install chromium` |
| `npm run test:e2e -- --project=webkit --project=firefox --project=mobile-safari` | The same tests in Safari (WebKit), Firefox and an iPhone 15; `E2E_ALL_BROWSERS=1` runs all four. First run: `npx playwright install webkit firefox` |
| `npm run fixtures` | Rebuild `fixtures/bucket/` (idempotent) |

## Troubleshooting

**A video is black, or slow to start.** Deccan Lens already tries to fix this. If direct playback
is still loading after 6 seconds or stalls for 15 seconds, it switches to a server stream at the same
spot. If only the sound plays, click **Convert for playback**. If it still fails:

- Check that ffmpeg is installed on the server (`ffmpeg -version`; the Docker image has it). Without
  it, fragmented, damaged and big-index MP4s can only be tried directly.
- Open **ⓘ File details** and look at **Health**. "Damaged" or "No index" means no player can show
  it; send the S3 path to whoever made the file.
- Many people converting at once share `LENS_MAX_CONVERSIONS` slots; a new video waits for one.
- Download the file and try VLC. If VLC shows the same problem, the file itself is at fault.

**"This video is empty".** The object in S3 is 0 bytes: the upload stored nothing. Upload it again
from the source. Bucket health lists all such files under **Empty**.

**Bucket health says "Repaired when played".** The file plays in Deccan Lens because the server
corrects its index as it plays. The file in S3 isn't changed, so other players, downloads and
copied links still get the broken file, which shows black or fails. Re-export it from the source
to fix it everywhere.

**Download is greyed out in the selection bar.** The selection is over the bulk limit (1 GB or 50
files by default); hover over the button to see which. Deselect files, download them one at a time
(no size limit), or use **Copy AWS CLI commands**. An admin can raise
`LENS_BULK_DOWNLOAD_MAX_GB` and `LENS_BULK_DOWNLOAD_MAX_FILES`, remembering that every byte
downloaded is billed.

**File details says "Tags: not readable with these keys".** The access key lacks
`s3:GetObjectTagging`. Add it to the IAM policy (see [AWS permissions](#aws-permissions)), or
ignore it: nothing else depends on tags.

**The bucket overview or health report is out of date.** Both come from the one-time check. Open
**Bucket health** and click **Scan again**.

## Security notes

- AWS keys are stored only in an encrypted, httpOnly, SameSite=Lax session cookie sealed with `SECRET_KEY`. They are never written to disk or a database, and the secret is never sent back to the browser.
- The server writes bucket health reports to `LENS_HEALTH_DIR`: file keys, sizes and problems, never credentials. Each access key gets its own report.
- Files are fetched straight from S3 through presigned URLs. Previews and Open last 1 hour and renew while you view; downloads last 15 minutes (12 hours over 5 GB). A link you copy lasts as long as you choose, up to 7 days, and anyone with it can open the file until then.
- In production, set a strong `SECRET_KEY` and serve over HTTPS. The session cookie is `Secure` there unless `COOKIE_SECURE=false`.
- Converted video segments are cached on the server, but served only to credentials that can read the video in S3 at that moment (checked with a HEAD request, remembered for a minute).
- Use a dedicated IAM user limited to the read-only policy above.
- Mock mode (`LENS_MOCK_DIR`) accepts any credentials. Never enable it on a server holding real data.
