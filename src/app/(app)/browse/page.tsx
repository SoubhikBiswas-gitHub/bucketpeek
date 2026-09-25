import type { Metadata } from "next";
import { ErrorState } from "@/components/common/error-state";
import { FileBrowser } from "@/components/browser/file-browser";
import { crumbsOf, normalizePrefix } from "@/lib/paths";
import { loadListing, requireConnection } from "@/lib/server/data";
import { bulkDownloadLimits } from "@/lib/server/download-limits";

function prefixFrom(value: string | string[] | undefined): string {
  return normalizePrefix(Array.isArray(value) ? value[0] : value);
}

export async function generateMetadata({ searchParams }: PageProps<"/browse">): Promise<Metadata> {
  const prefix = prefixFrom((await searchParams).prefix);
  const name = crumbsOf(prefix).at(-1)?.name;
  if (name) return { title: name };
  const c = await requireConnection();
  return { title: c.bucket };
}

export default async function BrowsePage({ searchParams }: PageProps<"/browse">) {
  const prefix = prefixFrom((await searchParams).prefix);
  const c = await requireConnection();
  const [r, downloadLimits] = await Promise.all([loadListing(c, prefix), bulkDownloadLimits()]);

  if (!r.ok) return <ErrorState error={r.error} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileBrowser key={prefix} listing={r.data} bucket={c.bucket} downloadLimits={downloadLimits} />
    </div>
  );
}
