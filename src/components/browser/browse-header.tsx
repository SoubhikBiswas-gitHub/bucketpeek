"use client";

import { CircleAlert, File, Folder, HardDrive } from "lucide-react";
import { CopyButton } from "@/components/common/copy-button";
import { Pill } from "@/components/common/pill";
import { PathBreadcrumbs } from "@/components/common/path-breadcrumbs";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes, plural } from "@/lib/format";
import type { AppError, Listing } from "@/lib/types";
import { totalBytes } from "./items";
import { RefreshButton } from "./refresh-button";

export interface BrowseHeaderProps {
  bucket: string;
  // Everything loaded so far, not just the first page.
  listing: Listing;
  loadingMore: boolean;
  error: AppError | null;
}

// Hidden on phones, just the file count from sm, everything from md.
function Summary({ listing, loadingMore, error }: Omit<BrowseHeaderProps, "bucket">) {
  const { folders, files } = listing;
  const count = folders.length + files.length;
  if (!count && !loadingMore) return null;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {loadingMore ? (
        // Status, not decoration: stays visible on phones while the rest of the folder streams in.
        <Pill icon={<Spinner aria-hidden className="motion-reduce:animate-none" />} role="status" aria-live="polite">
          Loading more… {plural(count, "item")}
        </Pill>
      ) : (
        <>
          {folders.length > 0 && (
            <Pill icon={<Folder />} className="hidden md:inline-flex">
              {plural(folders.length, "folder")}
            </Pill>
          )}
          {files.length > 0 && (
            <>
              <Pill icon={<File />} className="hidden sm:inline-flex">
                {plural(files.length, "file")}
              </Pill>
              <Pill icon={<HardDrive />} className="hidden md:inline-flex">
                {formatBytes(totalBytes(files))}
              </Pill>
            </>
          )}
        </>
      )}
      {error && (
        <Pill icon={<CircleAlert />} tone="danger" title={`${error.title}. ${error.message}`} role="status">
          Some items didn’t load
        </Pill>
      )}
    </span>
  );
}

export function BrowseHeader({ bucket, listing, loadingMore, error }: BrowseHeaderProps) {
  const { prefix } = listing;
  const uri = `s3://${bucket}/${prefix}`;

  return (
    <header className="flex min-h-11 shrink-0 items-center gap-3 pb-3">
      <PathBreadcrumbs
        bucket={bucket}
        prefix={prefix}
        asHeading
        trailing={<Summary listing={listing} loadingMore={loadingMore} error={error} />}
        className="min-w-0 flex-1"
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <CopyButton
          value={uri}
          label="Copy S3 path"
          toastMessage={`Copied ${uri}`}
          variant="ghost"
          className="size-9 text-text-2 hover:text-text-1 max-sm:size-11"
        />
        <RefreshButton />
      </div>
    </header>
  );
}
