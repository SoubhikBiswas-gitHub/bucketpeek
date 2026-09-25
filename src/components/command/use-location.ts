"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { folderOf, normalizePrefix } from "@/lib/paths";

export interface LensLocation {
  // The browsed prefix, or the folder of the viewed file. "" is the bucket root.
  prefix: string;
  key: string | null;
  page: "browse" | "view" | "other";
}

export function useLensLocation(): LensLocation {
  const pathname = usePathname();
  const params = useSearchParams();

  if (pathname === "/view") {
    const key = params.get("key");
    if (key) return { prefix: folderOf(key), key, page: "view" };
    return { prefix: "", key: null, page: "view" };
  }
  if (pathname === "/browse") {
    return { prefix: normalizePrefix(params.get("prefix")), key: null, page: "browse" };
  }
  return { prefix: "", key: null, page: "other" };
}

export function s3Uri(bucket: string, path: string): string {
  return `s3://${bucket}/${path}`;
}
