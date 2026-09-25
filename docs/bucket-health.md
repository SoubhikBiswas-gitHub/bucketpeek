# Bucket health and overview

The first time anyone opens a bucket, Deccan Lens checks every video in it once, in the
background, and counts every file by type. The results are saved on the server, so later visits
show them at once.

## Bucket health

Open it from **Bucket health** at the bucket root, or from the bucket name in the top bar (**View
report**). The page is `/health`.

While the check runs you see how many folders and videos it has found, then "Checking videos…",
with a progress bar and a time estimate. You can keep browsing: the check runs on the server and
is saved when it finishes.

When it's done you see:

- **Videos checked**: how many, their total size, and how many folders.
- **Play fine**: videos with no problem found.
- **Need attention**: everything in the groups below, and when the check ran.

Each group lists its files, 10 at first and up to 500 with **Show all**. Click a file to open it.
**Copy all S3 paths** copies every file in the group, one `s3://` path per line, ready to send to
whoever fixes them.

### What each problem means

| Problem | What it means | What to do | Who fixes it |
| --- | --- | --- | --- |
| **Damaged** | The file's index doesn't point at its video, in a way Deccan Lens can't correct. No player can show it. | Re-export it from the original recording. | Whoever produced or processed the file |
| **Empty** | The file is 0 bytes: the upload stored nothing. | Upload it again from the source. | Whoever uploaded it |
| **No index** | The file has video data but no index (`moov`), usually a recording that stopped before it finished. | Re-export it, or recover it from the recorder. | Whoever owns the recording |
| **Couldn't be read** | Reading the file failed, or it isn't a valid MP4/MOV. | Open the file to see the error, then check the file. | A bucket admin first (it can be a permissions problem), then the uploader |
| **Repaired when played** | The index points a fixed distance off for part of the file. Deccan Lens corrects it as it plays, but other players show black or fail. | Re-export it so it plays everywhere. | Whoever ran the tool that changed the file (often a de-identification step) |

"Repaired when played" counts as needing attention even though it plays in Deccan Lens, because
it won't play anywhere else. See [Video playback](video-playback.md) for how the repair works and
its limits.

### What is checked

- **Every video** is checked for being 0 bytes. This uses the listing only, so it costs nothing extra.
- **MP4, M4V and MOV files** are also checked for their structure: an index, and video data
  where the index says it is.
- Fragmented MP4s pass if their structure reads correctly.
- Other containers (AVI, MKV, TS…) are checked for size only. They play through conversion.

The **Health** section of [File details](file-details.md) shows one file's result.

### When it runs

- **Once per bucket**, the first time any page of that bucket is opened after connecting. Opening
  the bucket again shows the saved report.
- **Scan again** on the health page starts a new check. At the bucket root, **Scan again** appears
  only when the last check stopped, or the report was saved before the overview existed.
- It doesn't run by itself after that. Files uploaded or changed since the last check aren't in
  the report; their File details say "Not checked yet: Changed after the last bucket check."
- The report belongs to the bucket, not to the person. Everyone who opens that bucket on this
  server sees the same report.
- If the server restarts during a check, nothing is saved, and the next visit starts a new one.

### What it costs

Almost only S3 requests. There's no extra AWS service. Roughly: one LIST request per 1,000 files
(and at least one per folder), and about four tiny reads per MP4/MOV. A bucket with 100,000 files
in 2,000 folders, 10,000 of them MP4, costs about 3 US cents per check. See
[docs/costs.md](costs.md#bucket-health-check) for the details, including the few files that need
bigger reads.

## Bucket overview

At the bucket root, above the listing, **Bucket overview** shows how many files the bucket has
and their total size, then one card per file type (videos, images, audio, PDFs, markdown, JSON,
tables, code, text, archives, other) with its count and size. The bar under each card shows that
type's share of the bucket's bytes.

The overview comes from the same check as bucket health, so it costs nothing extra. It fills in
while the check lists the bucket. It is as current as the last check: "counted 3 days ago" means
files added since aren't in it. Use **Scan again** on the health page to refresh both.

You can collapse the overview. Your choice is remembered in this browser. On phones it starts
collapsed.

## How it works

The code is `src/lib/server/health.ts`, served by `GET /api/health` (returns the saved report, or
starts a check when there is none) and `POST /api/health` (**Scan again**).

1. **List.** Every folder is listed with `ListObjectsV2` (1,000 keys per request, 16 folders at a
   time). Each page of files is added to the overview's counts as it arrives, so the overview
   needs no requests of its own. Videos are collected for the next step.
2. **Check.** Up to 32 videos at a time. A 0-byte file is **Empty**. For MP4, M4V and MOV, the
   server reads byte ranges through a presigned URL: the top-level box headers, and the first 16
   bytes of the media data. If those look like the start of a video sample, the file passes.
3. **Deep check**, only for files that look wrong (or start with audio): the server reads the
   index (up to 32 MB) and the first video chunk (up to 4 MB). If that chunk holds real samples,
   the file passes. Otherwise `findIndexShift` from `src/lib/server/playable.ts` looks for the
   fixed shift: found means **Repaired when played**, not found means **Damaged**. A file with media
   data but no index is **No index**; any other read or parse error is **Couldn't be read**.
4. **Save.** The report is written as JSON to `LENS_HEALTH_DIR` (default: a `health` folder inside
   `LENS_HLS_DIR`, so `/data/hls/health` in the Docker image, on the cache volume). The file is
   named by a hash of the bucket and region. It holds file keys and sizes, never credentials.
   Converted-video cache cleanup never deletes it.

A check in progress lives in the server's memory. The browser polls `/api/health` every 2 seconds
while it runs. Run a single server process: a second process wouldn't see the first one's check.
