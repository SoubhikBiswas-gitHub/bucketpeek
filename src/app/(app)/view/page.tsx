import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { PathBreadcrumbs } from "@/components/common/path-breadcrumbs";
import { FileActions } from "@/components/viewer/file-actions";
import { FileMetaBar } from "@/components/viewer/file-meta-bar";
import { NeighborNav } from "@/components/viewer/neighbor-nav";
import { PreviewSwitch } from "@/components/viewer/preview-switch";
import { baseName } from "@/lib/kinds";
import { browseHref, folderOf, normalizePrefix } from "@/lib/paths";
import { loadView, requireConnection } from "@/lib/server/data";

// Repeated params use the first value; keys are never trimmed.
async function keyFrom(searchParams: PageProps<"/view">["searchParams"]): Promise<string> {
  const raw = (await searchParams).key;
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export async function generateMetadata({ searchParams }: PageProps<"/view">): Promise<Metadata> {
  const key = await keyFrom(searchParams);
  return { title: baseName(key) || "File" };
}

export default async function ViewPage({ searchParams }: PageProps<"/view">) {
  const key = await keyFrom(searchParams);

  // Nothing to show, or a folder key: send people to the listing instead of a dead end.
  if (!key) redirect(browseHref());
  if (key.endsWith("/")) redirect(browseHref(normalizePrefix(key)));

  const c = await requireConnection();
  const r = await loadView(c, key);
  const folder = folderOf(key);

  if (!r.ok) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <PathBreadcrumbs bucket={c.bucket} prefix={folder} current={baseName(key)} className="shrink-0" />
        <ErrorState error={r.error} action={{ label: "Back to folder", href: browseHref(folder) }} />
      </div>
    );
  }

  const { file, linksExpireAt, position, prev, next } = r.data;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-1">
        {/* Neighbours sit beside the path, not in its trailing slot, so they never yield space to a long name. */}
        <div className="flex min-w-0 items-center gap-2">
          <PathBreadcrumbs
            bucket={c.bucket}
            prefix={r.data.folder}
            current={file.name}
            currentKind={file.kind}
            asHeading
            className="min-w-0 flex-1 overflow-hidden"
          />
          <NeighborNav folder={r.data.folder} prev={prev} next={next} position={position} />
        </div>
        <FileMetaBar
          file={file}
          position={position}
          actions={
            <FileActions
              file={file}
              linksExpireAt={linksExpireAt}
              bucket={c.bucket}
              region={c.region}
              folder={r.data.folder}
            />
          }
        />
      </div>

      {/* Keyed by object so stateful renderers (players, zoom, scroll) start fresh on every file. */}
      <PreviewSwitch key={file.key} data={r.data} />
    </div>
  );
}
