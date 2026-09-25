import "server-only";
import { redirect } from "next/navigation";
import { folderOf } from "@/lib/paths";
import type { AppError, Connection, Listing, ViewData } from "@/lib/types";
import { describeError, isNotFound } from "./errors";
import { buildPreview } from "./preview";
import { getConnection } from "./session";
import { MAX_LIST_ITEMS, storageFor } from "./storage";
import { DEFAULT_LINK_SECONDS } from "./storage/types";
import { firstIssue, KeySchema, PrefixSchema } from "./validate";

// Page loaders return data or a plain-language error; none throw for AWS failures.

export async function requireConnection(): Promise<Connection> {
  const c = await getConnection();
  if (!c) redirect("/setup");
  return c;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

export async function loadListing(c: Connection, prefix: string): Promise<Result<Listing>> {
  const parsed = PrefixSchema.safeParse(prefix);
  if (!parsed.success) {
    return { ok: false, error: { title: "Invalid folder", message: firstIssue(parsed.error), status: 400 } };
  }
  try {
    return { ok: true, data: await storageFor(c).list(parsed.data, MAX_LIST_ITEMS) };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

export async function loadView(c: Connection, key: string): Promise<Result<ViewData>> {
  const parsed = KeySchema.safeParse(key);
  if (!parsed.success) {
    return { ok: false, error: { title: "No file selected", message: firstIssue(parsed.error), status: 400 } };
  }
  if (key.endsWith("/")) {
    return {
      ok: false,
      error: { title: "This is a folder", message: "Open it from the file browser to see what’s inside.", status: 400 },
    };
  }

  const storage = storageFor(c);
  const folder = folderOf(key);

  let file;
  try {
    file = await storage.head(key);
  } catch (e) {
    if (isNotFound(e)) {
      return {
        ok: false,
        error: {
          title: "File not found",
          message: `“${key.slice(folder.length)}” isn’t in this bucket anymore. It may have been moved or deleted.`,
          status: 404,
        },
      };
    }
    return { ok: false, error: describeError(e) };
  }

  // A link to share is signed when it's copied, for the lifetime chosen then.
  const linksExpireAt = new Date(Date.now() + DEFAULT_LINK_SECONDS * 1000).toISOString();

  const [preview, siblings] = await Promise.all([
    buildPreview(storage, file, c),
    storage.list(folder, MAX_LIST_ITEMS).then((l) => l.files).catch(() => []),
  ]);

  const i = siblings.findIndex((f) => f.key === key);
  const pick = (j: number) => (i >= 0 && siblings[j] ? { key: siblings[j].key, name: siblings[j].name, kind: siblings[j].kind } : null);

  return {
    ok: true,
    data: {
      file,
      preview,
      linksExpireAt,
      folder,
      prev: pick(i - 1),
      next: pick(i + 1),
      position: i >= 0 ? { index: i + 1, total: siblings.length } : null,
    },
  };
}
