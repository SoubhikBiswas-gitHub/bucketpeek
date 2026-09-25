import { CopyLinkDialogHost } from "@/components/common/copy-link-dialog";
import { TopBar } from "@/components/shell/top-bar";
import { requireConnection } from "@/lib/server/data";
import { publicInfo } from "@/lib/server/session";
import { isMockMode } from "@/lib/server/storage";

// The page never scrolls: each page's root is `flex min-h-0 flex-1 flex-col` with exactly one
// `min-h-0 flex-1 overflow-auto` region.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const connection = await requireConnection();
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <TopBar connection={publicInfo(connection)} demo={isMockMode()} />
      <main
        id="main"
        // Lets the skip link move focus here; no outline because it is never a click target.
        tabIndex={-1}
        className="mx-auto flex min-h-0 w-full max-w-(--page-width) min-w-0 flex-1 flex-col pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] outline-none sm:pt-6 sm:pr-[max(1.5rem,env(safe-area-inset-right))] sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pl-[max(1.5rem,env(safe-area-inset-left))]"
      >
        {children}
      </main>
      <CopyLinkDialogHost />
    </div>
  );
}
