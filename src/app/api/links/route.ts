import type { NextRequest } from "next/server";
import { z } from "zod";
import { DEFAULT_LINK_LIFETIME, isLinkLifetime, LINK_LIFETIME_MESSAGE } from "@/lib/link-expiry";
import { describeError } from "@/lib/server/errors";
import { getConnection } from "@/lib/server/session";
import { storageFor } from "@/lib/server/storage";
import { KeySchema } from "@/lib/server/validate";
import { MAX_LINK_KEYS, type SignedLinks } from "@/lib/types";
import { noteRequest, withRequestLog } from "@/lib/server/request-log";

const Body = z.object({
  keys: z
    .array(KeySchema.refine((k) => !k.endsWith("/"), "Folders don’t have links; choose files."))
    .min(1, "Choose at least one file.")
    .max(MAX_LINK_KEYS, `At most ${MAX_LINK_KEYS} files at a time.`),
  expiresIn: z.number({ error: LINK_LIFETIME_MESSAGE }).refine(isLinkLifetime, LINK_LIFETIME_MESSAGE).optional(),
});

const error = (message: string, status: number) =>
  Response.json({ error: { message } }, { status, headers: { "Cache-Control": "no-store" } });

// POST /api/links { keys, expiresIn? } presigns files for copying; expiresIn is an offered lifetime.
// Keys aren't HEAD-checked (a request each); a link to a key deleted since the listing answers 404.
export const POST = withRequestLog(async (request: NextRequest) => {
  const connection = await getConnection();
  if (!connection) return error("Your session ended. Connect to the bucket again.", 401);

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid request.", 400);

  const storage = storageFor(connection);
  const expiresIn = parsed.data.expiresIn ?? DEFAULT_LINK_LIFETIME;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  try {
    const links = await Promise.all(
      // Local (mock) storage returns a path on this app; the browser resolves it against the address
      // it used (behind a proxy or in Docker, the server's own origin isn't that address).
      [...new Set(parsed.data.keys)].map(async (key) => ({ key, url: await storage.signedUrl(key, { expiresIn }) })),
    );
    noteRequest({ links: links.length, expiresIn });
    const body: SignedLinks = { links, expiresAt };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    noteRequest({ keys: parsed.data.keys.length, err: e });
    const err = describeError(e);
    return error(err.message, err.status);
  }
});
