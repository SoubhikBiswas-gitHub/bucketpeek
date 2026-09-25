# Links and downloads

## Copy link

**Copy link** gives you a presigned S3 link: an HTTPS address that opens the file straight from
the bucket, with no sign-in. Find it in the viewer's toolbar, in each row's menu (**Copy S3
link**), and in the selection bar (**Copy S3 links**, one link per line).

When you click it, a dialog asks how long the link should work:

- **1 hour**, **6 hours**, **24 hours** or **7 days**.
- Below the choice it says exactly when: for example "Works until 26 Sep 2026, 11:30 UTC · 26 Sep
  2026, 5:00 PM IST".
- **Anyone with the link can open the file until then.** Treat it like the file itself. There's
  no way to cancel a link early, short of disabling the access key.
- Your last choice is remembered in this browser. The first time, it's 1 hour.

After you copy, the viewer shows "Works until …" next to **Copy link**. Click it to see the time in
UTC and IST again. To get a different lifetime, copy the link again.

Folders don't have links. In a selection, folders are skipped and the confirmation says how many.
Use **Copy S3 paths** for folders instead.

> **Changed:** the setup page no longer has a link-expiry field. You choose the lifetime each time
> you copy a link.

### Other links the app makes

You don't choose these. They're short on purpose and renew by themselves.

| Link | Works for | Notes |
| --- | --- | --- |
| Previews (video, image, audio, PDF) | 1 hour | The viewer re-signs about a minute before expiry. A playing video continues from the same spot. |
| Open original in a new tab | 1 hour | |
| Download, file up to 5 GB | 15 minutes | Enough to start. A download that has started keeps going after that. |
| Download, file over 5 GB | 12 hours | Long enough for the browser to resume a dropped download of a big file. |
| The server's own reads (conversion, bucket check, file details) | 1 hour | Never shown to you. |

## Download

### One file

**Download** in the viewer or a row's menu downloads one file in your browser. **There is no size
limit.** If the download drops, your browser can resume it while its link still works: 15 minutes
for files up to 5 GB, 12 hours above that. After that, click **Download** again.

For very big files, the AWS CLI is faster and more reliable (see below).

### Several files

Select files, then click **Download** in the selection bar. It starts one browser download per
file, straight from S3. It works only while the selection fits both limits:

- **1 GB in total** (`LENS_BULK_DOWNLOAD_MAX_GB`)
- **50 files** (`LENS_BULK_DOWNLOAD_MAX_FILES`)

The bar shows how much of the limit the selection uses. Past either limit, **Download** is greyed
out, and its tooltip says why: "Selection is 4.2 GB. Bulk download is limited to 1 GB —
deselect files, download them one at a time, or copy AWS CLI commands." Folders are skipped.

**Why there's a limit.** Every byte downloaded is billed by AWS as data transfer out, about $0.11
per GB from Mumbai. Selections are often tens of GB, and one click would bill all of it. Streaming a
video costs only what you watch. See [docs/costs.md](costs.md#streaming-compared-with-downloading).
Selecting, copying S3 paths and copying links have no limit.

An admin can change the limits with the two environment variables (see the README). The app
reads them on each request, so a restart applies them without a rebuild.

### AWS CLI commands

For big files and whole folders, copy an AWS CLI command and run it in a terminal:

- **Copy AWS CLI command** in the viewer toolbar, or in any row's menu (files and folders).
- **Copy AWS CLI commands** in the selection bar: one command per selected item, one per line.

The commands look like this:

```bash
# A file: downloads into the current folder
aws s3 cp 's3://my-bucket/Factory/2026-09-25/cam01.mp4' .

# A folder: downloads everything under it into a new local folder of the same name
aws s3 cp --recursive 's3://my-bucket/Factory/2026-09-25/' './2026-09-25/'
```

You need the [AWS CLI](https://aws.amazon.com/cli/) and your own AWS credentials that can read the
bucket (`aws configure`). The command doesn't contain any credentials. The CLI downloads big files
in parallel parts and retries parts that fail, which a browser can't do. The bulk download limit
doesn't apply, but the bytes are billed the same way.

**Quoting.** Paths are wrapped in single quotes for POSIX shells (bash, zsh): macOS, Linux, and
WSL on Windows. Spaces, `$`, `*` and other special characters in names are safe. A single quote in
a name is written as `'\''`. In Windows PowerShell or Command Prompt, use WSL, or change the quoting
by hand.

## How it works

- **Copy link** calls `POST /api/links` with the keys and one of the offered lifetimes (3600,
  21600, 86400 or 604800 seconds; anything else is refused). It signs up to 1,000 keys per request
  and returns the expiry time. Signing is done by the server without calling AWS, so it's free.
  The dialog is `src/components/common/copy-link-dialog.tsx`; the "Works until" text is from
  `src/lib/link-expiry.ts`. The chosen lifetime is saved in `localStorage`.
- Seven days is the longest a presigned S3 link can work. It needs a long-term access key
  (`AKIA…`), which is the only kind Deccan Lens accepts.
- Download and Open go through `/api/files/download` and `/api/files/open`. The server checks
  that the file exists (one HEAD request), then redirects to a presigned URL with the lifetime
  above (`src/app/api/files/redirect.ts`).
- The bulk limits are read by `src/lib/server/download-limits.ts` and checked in the browser by
  `src/components/browser/download-budget.ts`. Sizes are decimal (1 GB = 10^9 bytes), as shown.
- The CLI commands come from `src/lib/aws-cli.ts`.
