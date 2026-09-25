"use client";

import { usePathname } from "next/navigation";

export function RequestedPath({ className }: { className?: string }) {
  const pathname = usePathname();
  if (!pathname) return null;
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: show the raw path.
  }
  return (
    <code className={className} title={path}>
      {path}
    </code>
  );
}
