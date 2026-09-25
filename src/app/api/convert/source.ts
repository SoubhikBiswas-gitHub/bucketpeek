import "server-only";
import { storageFor } from "@/lib/server/storage";
import type { Connection } from "@/lib/types";

// Each ffmpeg run needs the source only until the player stops needing it (minutes at most), and
// every run gets a freshly signed link, so this never has to cover a whole video.
const SOURCE_LINK_SECONDS = 3600;

// Local (mock) storage signs a path on this app, hence the origin.
export async function sourceUrl(connection: Connection, key: string, origin: string): Promise<string> {
  const signed = await storageFor(connection).signedUrl(key, { expiresIn: SOURCE_LINK_SECONDS });
  return new URL(signed, origin).toString();
}
