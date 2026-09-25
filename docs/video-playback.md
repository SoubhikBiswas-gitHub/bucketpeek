# Video playback

Open a video and it plays. You don't choose how. Deccan Lens looks at each file and picks the
fastest way to play it. Nothing in the bucket is ever changed: every fix below happens while the
video is being sent to your browser.

## What you see

| The file is… | What happens | What you see |
| --- | --- | --- |
| A normal MP4, MOV, M4V, WebM, MKV or OGV | Your browser plays it straight from S3. | The video starts in a second or two. |
| A camera or recorder MP4 saved in fragments | Deccan Lens sends the fragments to the player in playing order, without converting them. | "Preparing the stream" for a moment, then the video. |
| An MP4 with its index at the end, behind thousands of small boxes | Deccan Lens serves the file with its index moved to the front ("faststart"). | The video starts like a normal MP4. |
| An MP4 whose index points at the wrong bytes (a known fault of some de-identification tools) | Deccan Lens corrects the index as it plays. | If the browser can't show the picture at first, a short "Converting" screen, then the video. |
| An MP4 with a very large index (over 16 MB, common for recordings many hours long) | Converted by ffmpeg as it plays, so you don't wait for the whole index to download. | "Preparing the stream", then the video, with the full timeline. |
| AVI, MPEG, TS, M2TS, MTS, WMV, FLV, 3GP, MXF, or a codec your browser can't decode | Converted by ffmpeg on the server as it plays. | "Converting AVI for playback" (or "Preparing the stream" with the reason), then the video. You can seek anywhere. |
| 0 bytes | Nothing to play. | **This video is empty.** "The file is 0 bytes, so there is nothing to play." |
| An MP4 with video data but no index (a recording that stopped before it finished) | No player can open it. | **This video has no index**, with the reason, at once instead of a spinning player. |

If direct playback is slow to start (still loading after 6 seconds) or stalls for more than 15
seconds while the tab is visible, Deccan Lens switches to a server stream and continues from the same spot. You see
"Switching to a faster stream". If that stream fails, the original file plays again.

If only the sound plays, a note says "Only audio is playing. This browser can't decode the video
in this file." Click **Convert for playback** to have the server convert it.

## When a video can't play

The player shows a panel that says why, with **Download** and **Copy link**, and **Try again** when
trying again could help:

- **This video can't play in the browser**: the format or codec needs converting, but ffmpeg isn't
  installed on the server. The panel shows how to install it.
- **This video couldn't be converted**: ffmpeg couldn't decode the file. Deccan Lens tries once more
  with ffmpeg's error-tolerant settings before it gives up.
- **This video can't be played**: even with its index fixed, the browser couldn't play the file.
- **This playback link has expired**: links kept failing to renew. Click **Reload**.
- **The video stopped loading**: the network dropped. Click **Try again**.

Download the file and try a desktop player such as VLC, or send it to whoever produced it. The
[bucket health report](bucket-health.md) lists these files for the whole bucket.

## Limits

- Repairs change only offsets inside the index. They can't bring back video data that is missing
  from the file. A file whose damage doesn't match the known pattern is reported as **Damaged**
  and left alone.
- Other video players still see the original, unfixed file. Downloads and copied links get the
  original too. To fix a file for everyone, re-export it from the source.
- The server stream, faststart and repair need ffmpeg on the server (it's in the Docker image).
  Without ffmpeg, only faststart still works; everything else is tried directly in the browser.

## How it works

**Choosing a path.** When a video page opens, the server reads the top-level box headers of an
MP4, MOV or M4V, and its index too when that is at most 1 MB (3 seconds at most, or it plays
directly), and `planFor` in `src/lib/server/mp4.ts` picks
one of four plans: `direct`, `faststart`, `fragments` or `transcode`. The plan is cached per
object version (size and modified time). Other formats go straight to conversion. A 0-byte file
gets the "empty" message before any read.

**Direct.** The browser gets a presigned S3 URL and fetches byte ranges itself. The page re-signs
it about a minute before it expires, and the player continues from the same position. Video bytes
don't pass through Deccan Lens.

**Fragments.** A fragmented MP4 (`moof` boxes after the `moov`) makes browsers read every fragment
header before playing; one test file took 17 seconds to start. Instead, `src/lib/server/fmp4.ts`
builds an HLS playlist from the file's own fragments: from the `mfra` index when the file has one,
otherwise by walking the fragments (one 4 KB read each, in parallel regions, once per file version).
Each HLS segment is a byte range of the original. Some recorders write fragment offsets that are
absolute in the file; browsers need them relative to the fragment, so `mseSegment` rewrites the
`moof` data offsets before sending each segment. If the first fragment can't be rewritten safely,
the file is converted by ffmpeg instead.

**Faststart.** Some recorders reserve space as they go, leaving thousands of top-level boxes before
an index at the end. A browser reads those boxes one by one. `buildPlayable` in
`src/lib/server/playable.ts` makes a virtual file with three boxes, `ftyp`, the index, and one
`mdat` around everything else, and rewrites the chunk offsets (`stco`/`co64`) to match. It is served
from `/api/files/playable` with byte-range support. Only the index (up to 32 MB) is held in memory;
the media bytes are read from S3 as the browser asks for them.

**Repair.** A de-identification tool inserted bytes before the media without moving the chunk
offsets. So the first chunks point a fixed distance before their real data, and later chunks are
right. `findIndexShift` checks whether whole chunks read as H.264/HEVC samples (length-prefixed NAL
units that end exactly at the chunk's end). If the first chunks fail and the last passes, it finds
where the good part starts, measures the shift at a chunk in the middle of the bad part, and
confirms it at five other chunks (one miss is allowed). Only then does it add the shift to those
chunk offsets. When the browser fails to play such a file, the player asks `/api/convert`, which
returns the repaired `/api/files/playable` URL instead of starting ffmpeg (ffmpeg would fail on the
same damage). The rewritten indexes are cached in memory, up to 256 MB.

**Conversion.** See [How on-demand conversion works](costs.md#how-on-demand-conversion-works).
The playlist covers the whole video at once, in 4-second segments, and ffmpeg converts only what
is watched. If ffmpeg writes nothing because the file won't decode, it runs once more with
`-err_detect ignore_err -fflags +discardcorrupt` before the video is reported as failed.
