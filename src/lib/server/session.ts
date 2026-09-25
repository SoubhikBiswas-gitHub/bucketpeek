import "server-only";
import { cookies, headers } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { z } from "zod";
import type { Connection, ConnectionInfo } from "@/lib/types";
import { appSecret } from "./secret";

interface SessionData {
  connection?: Connection;
}

// A sealed cookie can outlive a deploy, so it's re-validated on every read. Unknown fields are
// dropped, so older cookies that still hold a `linkExpiry` (from the setup form) keep working.
const ConnectionSchema = z.object({
  accessKeyId: z.string().min(16).max(128),
  secretAccessKey: z.string().min(1).max(256),
  bucket: z.string().min(3).max(63),
  region: z.string().max(32),
});

// Secure by default in production; COOKIE_SECURE=false opts out for plain-http deployments.
export function secureCookie(forwardedProto: string | null | undefined): boolean {
  const setting = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (setting === "true") return true;
  if (forwardedProto?.split(",")[0].trim().toLowerCase() === "https") return true;
  return setting !== "false" && process.env.NODE_ENV === "production";
}

function options(forwardedProto: string | null): SessionOptions {
  return {
    password: appSecret(),
    cookieName: "deccan_lens",
    ttl: 60 * 60 * 24 * 7,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie(forwardedProto),
      path: "/",
    },
  };
}

async function session() {
  const proto = (await headers()).get("x-forwarded-proto");
  return getIronSession<SessionData>(await cookies(), options(proto));
}

/** The saved connection, or null. Readable from server components, actions and route handlers. */
export async function getConnection(): Promise<Connection | null> {
  const parsed = ConnectionSchema.safeParse((await session()).connection);
  return parsed.success ? parsed.data : null;
}

/** Only callable from a server action or route handler. */
export async function saveConnection(connection: Connection): Promise<void> {
  const s = await session();
  s.connection = ConnectionSchema.parse(connection);
  await s.save();
}

/** Only callable from a server action or route handler. */
export async function clearConnection(): Promise<void> {
  (await session()).destroy();
}

export function publicInfo(c: Connection): ConnectionInfo {
  return { bucket: c.bucket, region: c.region };
}
