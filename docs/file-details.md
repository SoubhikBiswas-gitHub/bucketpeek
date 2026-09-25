# File details

Click **ⓘ File details** in the viewer's toolbar (on phones, in the **⋯** menu). A panel opens
with everything known about the file. Each section loads on its own, so the S3 facts appear while
the video is still being read.

## Sections

**The basics** (no extra requests: they come with the page)

- Full key and S3 URI, each with a copy button.
- Kind, size (with the exact byte count), content type, last modified (local time, relative, and
  ISO 8601).
- Folder (click to go there), bucket and region.

**S3 object** (every file)

- ETag, storage class, version ID, and multipart part count when the file was uploaded in parts.
- Checksums and checksum type, when S3 stored them.
- Encryption (for example "SSE-KMS (aws:kms)"), the KMS key ID, and whether a bucket key is used.
- Content encoding, content language, Cache-Control, Content-Disposition, Expires header.
- Custom metadata (`x-amz-meta-*`), lifecycle expiry, restore state of archived objects,
  replication, Object Lock and legal hold.
- **Tags.** Reading tags needs `s3:GetObjectTagging`, which the read-only policy in the README
  doesn't include. Without it you see "Tags: not readable with these keys". Everything else still
  loads. To see tags, add the permission (see below).

**Video** (videos only)

- Container, length, overall bitrate, start time.
- For each stream: codec (with codec string), resolution, frame rate, pixel format, rotation,
  bitrate, language; for audio, sample rate and channels.
- "Video details unavailable" with a reason when ffmpeg isn't installed, the file is empty, or
  ffprobe can't read it within its time limit.

**Health** (videos only)

- This file's result from the [bucket check](bucket-health.md): **Plays fine**, one of the
  problems (for example **Repaired when played**, with the details), **Not checked yet**, or
  **Being checked now**.
- A file changed after the last check shows "Not checked yet: Changed after the last bucket
  check."
- Videos other than MP4 and MOV show **Not empty**: only MP4 and MOV files are checked in depth.

**Sidecar metadata** (only when the file has one)

- If a file named `<name without extension>_METADATA.json` sits in the same folder, its values are
  shown as rows. For `cam01.mp4` that is `cam01_METADATA.json`. Nested values read like
  "device › serial".
- **Copy JSON** copies the whole file. Click the sidecar's name to open it.
- Sidecars over 64 KB, or that aren't valid JSON, show a note instead. At most 500 values are
  shown.

## Adding tag access

To see tags, add this statement to the IAM policy in the README:

```json
{ "Sid": "ReadTags", "Effect": "Allow", "Action": "s3:GetObjectTagging", "Resource": "arn:aws:s3:::YOUR-BUCKET/*" }
```

For KMS-encrypted files, checksums also need `kms:Decrypt` on the key. Without it, Deccan Lens
asks S3 again without checksums, and the rest of the section loads.

## What it costs

Each section is loaded once per file per browser tab. Opening the panel again costs nothing.

| Section | S3 requests the first time | Notes |
| --- | --- | --- |
| S3 object | 1 HEAD + 1 GetObjectTagging | 2 HEADs if the first is refused for KMS checksums. |
| Video | 1 HEAD + ffprobe's range reads | ffprobe reads the header and index: usually a few hundred KB, the whole index for an MP4 with its index at the end. The result is cached on the server per file version, so later opens (by anyone) need only the HEAD. |
| Health | none | Read from the saved report on the server. |
| Sidecar | 1 HEAD, plus 1 GET of up to 64 KB when the sidecar exists | The HEAD is made for every file, to look for the sidecar. |

At $0.0004 per 1,000 requests, opening the panel for 1,000 videos costs about 0.2 US cents in
requests. See [docs/costs.md](costs.md#file-details).

## How it works

The panel is `src/components/viewer/file-details.tsx` and `file-details-sections.tsx`. Each
section calls `GET /api/files/details?key=…&part=s3|video|health|sidecar`
(`src/app/api/files/details/`). The browser keeps each answer for the life of the tab (up to 200).

- `s3`: `HeadObject` with `ChecksumMode: ENABLED` and `GetObjectTagging`, in parallel. A denied
  tagging call is shown as "not readable", not as an error.
- `video`: `src/lib/server/probe.ts` runs `ffprobe -show_format -show_streams` on a presigned URL,
  with the same input safety flags as conversion. Results are cached in memory for 500 files.
- `health`: a lookup in the saved bucket report. It never starts a check.
- `sidecar`: `sidecarKey` in `src/lib/file-details.ts` builds the name; the server HEADs it and
  reads it if it's at most 64 KB.
