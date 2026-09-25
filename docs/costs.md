# What Deccan Lens costs to run

Deccan Lens adds no licence, per-stream or per-minute fee. It uses no paid AWS media service
(no MediaConvert, IVS or Elemental). Everything it costs is ordinary AWS usage:

1. **Data transfer out of AWS** for the video people actually watch. This is the main cost.
2. **Somewhere to run Deccan Lens itself**: from about $8 a month on a small EC2 instance, or
   nothing extra on a machine you already have.
3. **More CPU for ffmpeg**, only if you view formats that browsers can't play (AVI, TS, WMV, ...).
4. **Small items** (requests, a cache disk, the one-time bucket check) that round to cents.

Browsing folders, searching, copying S3 paths and copying presigned links are effectively free.
So are the bucket overview and the saved bucket health report once the one-time check has run.

All prices below are **on-demand list prices for ap-south-1 (Mumbai)**, where our bucket lives, with
us-east-1 for comparison. They were fetched on **2026-09-24** from the AWS Price List API (see
[Sources](#sources)). Taxes are not included (AWS invoices in India add 18% GST), and neither are
Savings Plans or private pricing.

> **Units.** AWS bills data in GB of 2^30 bytes (GiB). Deccan Lens shows file sizes in decimal
> units (1 GB = 10^9 bytes), the way Finder and the S3 console do. Every figure here converts the
> shown size to billed GiB, so it is about 7% lower than multiplying the shown size by the price.

## Unit prices

| Item | ap-south-1 (Mumbai) | us-east-1 (N. Virginia) |
| --- | --- | --- |
| Data transfer out to the internet, first 10 TB/month | $0.1093 per GB | $0.09 per GB |
| Next 40 TB/month | $0.085 per GB | $0.085 per GB |
| Free data transfer out (whole account, all services) | first 100 GB/month | same allowance |
| S3 to EC2 in the **same** region | free | free |
| S3 out to another AWS region | $0.086 per GB | $0.02 per GB |
| S3 GET requests | $0.0004 per 1,000 | $0.0004 per 1,000 |
| S3 LIST requests (one per 1,000 keys listed) | $0.005 per 1,000 | $0.005 per 1,000 |
| EC2 t4g.small (2 vCPU Graviton2, 2 GiB) | $0.0112 per hour | not fetched |
| EC2 t4g.medium (2 vCPU Graviton2, 4 GiB) | $0.0224 per hour | not fetched |
| EC2 c7g.xlarge (4 vCPU Graviton3, 8 GiB) | $0.0982 per hour | not fetched |
| EC2 c7g.2xlarge (8 vCPU Graviton3, 16 GiB) | $0.1963 per hour | $0.29 per hour |
| EC2 c7i.2xlarge (8 vCPU Intel, 16 GiB) | $0.357 per hour | $0.357 per hour |
| EBS gp3 storage | $0.0912 per GB-month | $0.08 per GB-month |
| CloudFront out, India edge, first 10 TB (1 TB/month free) | $0.109 per GB | n/a |
| CloudFront out, US edge, first 10 TB (1 TB/month free) | n/a | $0.085 per GB |

## Where each byte goes

```text
Direct playback (most MP4, MOV, WebM, MKV):
  S3 ──────────────────────────────────────────────▶ viewer's browser
       billed: S3 data transfer out, bytes watched

Server stream, not converted (fragmented MP4s, faststart, repaired indexes):
  S3 ─────────────▶ Deccan Lens server (no ffmpeg) ─▶ viewer's browser
       free if the server           billed: EC2 data transfer out,
       is EC2 in ap-south-1         bytes watched (the file's own bitrate)

Converted playback (AVI, TS, WMV, FLV, MXF, big-index MP4s, ...):
  S3 ─────────────▶ Deccan Lens server (ffmpeg) ───▶ viewer's browser
       free if the server           billed: EC2 data transfer out,
       is EC2 in ap-south-1         converted bytes (≤ ~8.5 Mbit/s)
```

The browser fetches only the byte ranges it plays. Deccan Lens never downloads a whole video,
either to the viewer or to itself. [Video playback](video-playback.md) explains which files take
which path.

## 1. Running Deccan Lens itself

Deccan Lens is one Node.js process (the Docker image in this repo). Its own work is light: it
lists folders, signs links and renders pages. Video bytes for files played directly go straight
from S3 to the viewer and never pass through it. Only the server stream (section 2) and
conversion (section 3) pass video through the server.

| Where it runs | Monthly cost |
| --- | --- |
| A laptop, office machine or existing server | Nothing extra. But reads it makes from S3 (text and table previews, the bucket check, video it streams or converts) count as internet data transfer, $0.1093 per GB. |
| EC2 t4g.small in ap-south-1, browser-playable video only | $8.18 for the instance (730 h) plus its disk, about $0.73 for an 8 GB gp3 root volume. S3 reads are free in the same region. |
| EC2 t4g.medium, if the small one runs short of memory | $16.35 |
| EC2 c7g.xlarge / c7g.2xlarge, also converting video | $71.69 / $143.30 (see [section 3](#3-watching-a-video-the-browser-cant-play-converted-on-demand)) |

The t4g sizes are expected to be enough for the app alone but have not been load-tested.

AWS requests the app itself makes (each is billed per 1,000, so they add up to cents):

| When | Request | Price |
| --- | --- | --- |
| Connecting a bucket | HeadBucket + one ListObjectsV2 | $0.0004 + $0.005 per 1,000 |
| First visit to a bucket | The one-time bucket check | See [Bucket health check](#bucket-health-check) |
| Opening a folder | One ListObjectsV2 per 1,000 entries | $0.005 per 1,000 |
| Opening a file | One HeadObject, plus one ListObjectsV2 per 1,000 entries of its folder (for previous/next) | $0.0004 + $0.005 per 1,000 |
| Opening an MP4, MOV or M4V | About 3 extra ranged GETs of 16 bytes (the box headers; also the index when it is at most 1 MB). Remembered per file version until the server restarts. | $0.0004 per 1,000 |
| Text, JSON, CSV or code preview | One ranged GET of up to 512 KB | $0.0004 per 1,000, plus the bytes |
| File details panel | 3–4 requests the first time per file and tab, plus ffprobe's reads for a video | See [File details](#file-details) |
| Opening a converted video | HeadObject, then ffprobe and ffmpeg reads | See section 3 |

Pages, scripts and styles sent from the app to browsers are a few MB per session, billed as EC2
data transfer out when the app runs on EC2.

### Bucket health check

The first time a bucket is opened, Deccan Lens checks every video once and counts every file for
the bucket overview (see [Bucket health](bucket-health.md)). It runs again only when someone
clicks **Scan again**. What it reads:

| Step | Requests | Bytes read |
| --- | --- | --- |
| List every folder | One ListObjectsV2 per 1,000 entries, and at least one per folder | None beyond the listing |
| Each video | Nothing more for the 0-byte check; other containers (AVI, MKV…) stop here | None |
| Each MP4, M4V or MOV | About 4 ranged GETs: 3 box headers and the first 16 bytes of the media | Under 100 bytes |
| An MP4 whose index sits behind thousands of boxes | About 10 GETs, including a read of the file's tail | 1–21 MB |
| A file that looks wrong at a glance (or starts with audio) | The index, the first video chunk and, when that isn't video, a few dozen chunk reads to measure the damage | Tens of MB (the index alone can be up to 32 MB) |

**Example:** 100,000 files in 2,000 folders, 10,000 of them MP4:

- about 2,100 LIST requests × $0.005 per 1,000 = $0.011
- about 40,000 GET requests × $0.0004 per 1,000 = $0.016
- **about $0.03 per check**, in Mumbai or us-east-1

The bytes read are free when Deccan Lens runs on EC2 in the bucket's region. Elsewhere they are
billed at the data transfer rate, which matters only if many files need the bigger reads.

The bucket overview comes from the same listing and costs nothing extra.

### File details

The **ⓘ File details** panel loads each section once per file per browser tab (see
[File details](file-details.md)):

| Section | Requests the first time | Price |
| --- | --- | --- |
| S3 object | HeadObject + GetObjectTagging (a second HeadObject for some KMS-encrypted files) | $0.0008 per 1,000 files |
| Video (videos only) | HeadObject + ffprobe's ranged GETs of the header and index; later opens by anyone need only the HeadObject | $0.0004 per 1,000, plus the index bytes on a first open |
| Health (videos only) | None: read from the saved report | Free |
| Sidecar (`<name>_METADATA.json`) | HeadObject, plus one GET of up to 64 KB when it exists | $0.0004–$0.0008 per 1,000 |

## 2. Watching a video the browser can play (most of our bucket)

This covers MP4 (H.264, HEVC on supported browsers, AV1), MOV, WebM and MKV. Most of these play
directly: the browser streams from a presigned S3 URL. No server CPU is used, and you pay only for
the bytes watched:

```text
cost per hour watched = bitrate (Mbit/s) × 0.419 GiB × price per GiB
```

| Video bitrate | Data per hour | Mumbai, per hour watched | us-east-1, per hour watched |
| --- | --- | --- | --- |
| 4 Mbit/s | 1.68 GiB | $0.18 | $0.15 |
| 8 Mbit/s (typical 1080p) | 3.35 GiB | $0.37 | $0.30 |
| 20 Mbit/s | 8.38 GiB | $0.92 | $0.75 |
| 50 Mbit/s (4K or camera masters) | 20.95 GiB | $2.29 | $1.89 |

A file's bitrate is its size divided by its duration. Pausing costs nothing extra: the browser
buffers a little ahead, then stops fetching.

Opening and seeking add small one-off reads. The browser loads the file's whole index (its frame
table) before the first frame. The index grows with duration, not file size: a one-hour
recording has an index of a few MB. These were measured on a 40-hour, 15 GB MP4 whose index is
stored at the end of the file (the worst case), played directly:

| Action | Read from S3 | Mumbai cost |
| --- | --- | --- |
| Open to first frame (loads the whole frame index; 157 MB for 40 hours) | 175 MB | $0.018 |
| Seek anywhere (tested at 20:00:00 and 39:50:00) | 8–11 MB | ≈ $0.001 |

Since then, an MP4 with an index over 16 MB is no longer played directly when ffmpeg is installed:
waiting for that download delays the first frame. It is converted instead (section 3). Without
ffmpeg it still plays directly, at the cost above.

### Played through the server without converting

Some browser-playable files are sent through the Deccan Lens server, byte for byte, because
browsers are slow or fail on them directly (see [Video playback](video-playback.md)):

- **Fragmented MP4s** (camera and recorder files): each segment of 2 seconds or more is one ranged
  GET. Before the first play, the fragments are indexed once per file version: one read of the
  file's `mfra` index when it has one, otherwise one 4 KB GET per fragment (for example, about
  3,600 GETs, $0.0014, for an hour recorded in 1-second fragments).
- **Faststart** (index at the end behind thousands of boxes) and **repaired** files: one GET per
  byte range the browser asks for, as in direct playback. Once per file version, the server reads
  the index (up to 32 MB; it's read twice) and a few chunks to look for index damage. The fixed
  index is held in memory, never written back.

No ffmpeg CPU is used, and the bytes watched are the file's own, so the cost per hour watched is
the table above. What changes is who bills them: S3 to the server is free when it runs on EC2 in
ap-south-1, and the server to the viewer is EC2 data transfer out at the same $0.1093 per GB. With
the server outside AWS, S3 bills $0.1093 per GB to the server instead.

### Streaming compared with downloading

Streaming costs only what is watched. Downloading costs the whole file every time:

| Downloaded | Billed | Mumbai | us-east-1 |
| --- | --- | --- | --- |
| One 14.8 GB recording | 13.8 GiB | $1.51 | $1.24 |
| Five files, 41.5 GB | 38.6 GiB | $4.22 | $3.48 |
| One folder, 135.5 GB | 126.2 GiB | $13.79 | $11.36 |
| One 900 GB recording | 838.2 GiB | $91.61 | $75.44 |

That is why bulk download has a budget. Selections are often tens of GB, and one click would
bill all of it, so the selection bar's Download works only while the selected files total at most
1 GB (about $0.10 in Mumbai) and 50 files. Past either limit the button is disabled and the bar
says why. Selecting, and copying S3 paths or links, stay unlimited. Folders are skipped, since
downloading one would mean listing and fetching everything under it. Set `LENS_BULK_DOWNLOAD_MAX_GB`
and `LENS_BULK_DOWNLOAD_MAX_FILES` to change the limits. Single-file download remains in each
file's menu, whatever the size. **Copy AWS CLI commands** is not limited either; the CLI's
downloads are billed at the same rate. See [Links and downloads](links-and-downloads.md).

## 3. Watching a video the browser can't play (converted on demand)

AVI, TS, M2TS, MTS, WMV, FLV, 3GP, MXF and MPEG are converted to HLS by ffmpeg on the Deccan Lens
server. So is any MP4 whose codec the browser can't decode, and any MP4 whose index is over 16 MB.
Only the parts being watched are converted; see [How on-demand conversion works](#how-on-demand-conversion-works).

### Data transfer

| Leg | Cost |
| --- | --- |
| Server to viewer (EC2 data transfer out) | Converted stream capped at 8 Mbit/s video; measured 6.1–8.4 Mbit/s total, so **at most about $0.39 per hour watched** in Mumbai |
| S3 to server, server on EC2 in ap-south-1 | **Free** |
| S3 to server, server elsewhere (laptop, office, another cloud) | $0.1093 per GB of source read (see below) |
| S3 to server, server on EC2 in another region | $0.086 per GB of source read |

Source bytes read, measured on a 40-hour, 11 GB AVI and a 5-minute 1080p 45 Mbit/s TS. They matter
only when the server is outside ap-south-1:

| Action | 40-hour AVI | 1080p 45 Mbit/s TS |
| --- | --- | --- |
| Open (ffprobe reads the length, first conversion starts) | 307 MB | 117 MB |
| Seek anywhere | ~160 MB (ffmpeg re-reads the AVI index on every start) | 108 MB |
| 6 min 40 s of continuous playback | 65 MB | not measured |

### Server

A converter needs CPU in proportion to how many people watch converted video **at the same
time**. It's measured below. MP4-only use needs no converter.

| Instance (Mumbai) | Per hour | Per month (730 h, always on) |
| --- | --- | --- |
| c7g.2xlarge, 8 vCPU Graviton3 | $0.1963 | $143.30 |
| c7i.2xlarge, 8 vCPU Intel | $0.357 | $260.61 |
| 20 GB gp3 disk for the segment cache | | $1.82 |

The capacity tests below ran the Docker image on arm64, the architecture of Graviton (c7g, t4g).
Build the image on an arm64 machine or with `docker buildx --platform linux/arm64` for these
instances.

**Measured capacity.** This is the Deccan Lens Docker image (arm64 Linux, libx264 `veryfast`,
CRF 22, capped at 8 Mbit/s), limited to 4 CPU cores of an Apple M4 Pro, converting 60 s of 1080p
per stream:

| Streams at once | Easy content (test pattern) | Hard content (full-frame noise, 45 Mbit/s source) |
| --- | --- | --- |
| 1 | 8.4× real time | 3.9× real time |
| 2 | 3.9× | 1.8× |
| 3 | 2.5× | 1.0× (limit) |
| 4 | 1.6× | 0.7× (too slow) |

A stream keeps up while it stays at 1.0× or above. On 4 M4 Pro cores that is 3 hard or at least
4 easy 1080p streams at once. Graviton3 cores are slower than M4 Pro cores, so **an 8-vCPU
c7g.2xlarge should handle roughly 3–6 simultaneous converted 1080p streams**. This is an
estimate. Confirm it on the instance before sizing: run the same benchmark (15 minutes) and set
`LENS_MAX_CONVERSIONS` to the result.

## 4. Everything else

| Item | Cost |
| --- | --- |
| Range requests while playing (a handful per open or seek) | $0.0004 per 1,000: a fraction of a cent per session |
| Listing a folder (one LIST per 1,000 keys) | $0.005 per 1,000: negligible |
| Copy S3 paths | Free (text only) |
| Copy S3 links / share links | Free: presigning is computed locally, with no AWS call, whatever lifetime you choose (1 hour to 7 days). Opening a link is billed like any download, to the bucket owner. |
| Copy AWS CLI commands | Free (text only). Running them bills the bytes downloaded. |
| Bucket overview | Free: counted during the bucket check |
| Bucket health report, after the check | Free: saved on the server as one JSON file per bucket (`LENS_HEALTH_DIR`) |
| Segment cache for converted video | Server disk, capped at `LENS_HLS_MAX_GB` (default 20 GB, $1.82/month on gp3) |
| Thumbnails and previews of images, PDFs, text | Data transfer for the bytes shown, same rate as video |
| Grid view tiles | Only tiles on or near the screen load. An image tile reads the image (at most 10 MB). A text tile reads its first 2 KB. A video tile has ffmpeg read the index and one keyframe (usually a few hundred KB; for an MP4 with its index at the end, the whole index, about 4 MB per hour of video). A PDF tile reads the whole PDF (at most 50 MB). Video and PDF thumbnails are made once per file version and cached on the server (`LENS_THUMBS_MAX_MB`, default 256 MB). |

Deccan Lens stores nothing in S3, so it adds no S3 storage cost.

## Estimating a month

```text
monthly ≈ (hours watched × GiB per hour − 100 GiB free) × price per GiB
        + the machine Deccan Lens runs on (bigger if it converts video)
```

**Worked example** (replace the inputs with your own): 10 people each watching 2 hours a day,
22 working days, 1080p at 8 Mbit/s, all MP4, Deccan Lens on a t4g.small in Mumbai:

- 440 hours × 3.35 GiB = 1,475 GiB
- (1,475 − 100 free) × $0.1093 = $150.31 data transfer ($123.77 in us-east-1)
- t4g.small and its 8 GB disk: $8.18 + $0.73 = $8.91
- **Total: about $159 per month**, before GST

The same team viewing AVI or TS files would run Deccan Lens on a c7g.2xlarge ($143.30 per month)
instead of the t4g.small. Each hour of converted video costs at most $0.39 in data transfer,
whatever the source's bitrate.

## What changes the bill

| Lever | Effect |
| --- | --- |
| Keep recordings as browser-playable MP4 (H.264 or AV1) | No converter server at all |
| Run the Deccan Lens server on EC2 in ap-south-1 | Source reads for conversion become free |
| Avoid downloads; stream or share presigned links instead | Only watched bytes are billed |
| Lower-bitrate proxy copies for review (e.g. 4 Mbit/s next to the 50 Mbit/s master) | Cuts viewing cost by the bitrate ratio |
| CloudFront in front of S3 | India edge price is about the same as S3 ($0.109 vs $0.1093), but the first 1 TB/month is free: up to about $112/month saved. Needs signed CloudFront URLs; not implemented. |
| Savings Plans or reserved instances for the converter | Lower hourly rate for an always-on server |

## How on-demand conversion works

The design choices below are what keep conversion costs tied to what is watched.

- **Full timeline up front.** The HLS playlist lists the whole video in 4-second segments before
  anything is converted, so the player can seek anywhere.
- **Converts from where you are.** When a segment is requested, one ffmpeg process per video
  starts at that segment and works forward. A seek elsewhere restarts it there.
- **Pauses when far enough ahead.** ffmpeg is paused with SIGSTOP once it is 2 minutes ahead of
  the player (`RUNAHEAD_SECONDS`), and continues as the player catches up. Pausing rather than
  restarting avoids re-reading large container indexes: in the AVI test above, continuous playback
  needed 0 restarts and read 65 MB instead of 160 MB per restart.
- **Stops when nobody watches.** ffmpeg is stopped after 60 seconds without requests.
- **Fails fast on files it can't decode,** in about 8 seconds instead of converting nothing for
  minutes.

The code is `src/lib/server/convert.ts`; its limits are configurable (see the README).

## Measured performance

These were measured on 2026-09-24 in Google Chrome against the production Docker image. The test
bucket was served from the same machine, so real S3 adds network time. Loading the 157 MB index
below over a 100 Mbit/s connection, for example, takes about 13 seconds.

| Test | Result |
| --- | --- |
| MP4, 40 h, 15 GB: open to first frame | 1.5–1.9 s (4.3 s on the first open after the server started) |
| MP4, 40 h, 15 GB: seek to any point | 0.37–0.45 s |
| MP4: links renewed while playing | Playing again in 1.1 s at the same position |
| MP4: link expired, then a seek | Recovered without clicks in 16 of 16 runs, about 1 s (about 4 s in one edge case) |
| AVI, 40 h, 11 GB, converted: open | 2.2 s |
| AVI, 40 h, 11 GB, converted: seek to any point | 1.2–1.3 s |
| AVI: 6 min 40 s of playback at 4× speed | 0 stalls, 0 ffmpeg restarts |
| TS, 1080p 45 Mbit/s, converted: open / seek / 40 s of playback | 2.3 s / 1.7 s / 0 stalls |
| Segment cache on disk after all AVI tests | 45 MB |

The 40-hour MP4 rows were measured with direct playback. With ffmpeg installed, that file (its
index is 157 MB) is now converted instead; see section 2.

## Sources

Fetched 2026-09-24 (13:16 UTC). Price List API base URL: `https://pricing.us-east-1.amazonaws.com`.

- S3 requests and storage: `/offers/v1.0/aws/AmazonS3/20260918174747/{region}/index.json`
- Data transfer out (S3 and EC2), inter-region, free allowance: `/offers/v1.0/aws/AWSDataTransfer/20260916132208/{region}/index.json`
- EC2 instances and EBS: `/offers/v1.0/aws/AmazonEC2/20260921194712/{region}/index.json`. Instance
  prices were cross-checked against the data file the EC2 pricing page loads,
  `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/Asia%20Pacific%20(Mumbai)/Linux/index.json`,
  which is also the source of the t4g and c7g.xlarge prices.
- CloudFront: `/offers/v1.0/aws/AmazonCloudFront/current/index.json`
- Free transfer within a region and to CloudFront, as stated on <https://aws.amazon.com/s3/pricing/>,
  <https://aws.amazon.com/ec2/pricing/on-demand/> and <https://aws.amazon.com/cloudfront/pricing/>

**Not verified:**

- The HeadBucket, HeadObject and GetObjectTagging prices: taken to be billed as GET-class requests ($0.0004 per 1,000), which is how S3 lists HEAD and GET requests.
- The request counts for the bucket check, the server stream and File details: counted from the code, not measured against a real bucket.
- CloudFront's flat-rate monthly plans, and whether their terms allow video delivery at this scale.
- The baseline IOPS and throughput included with gp3 volumes.

Prices change; re-check the sources above before budgeting.
