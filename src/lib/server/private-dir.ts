import "server-only";
import { promises as fs } from "node:fs";

// Work folders must be real directories owned by us: /tmp is shared with other users.
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
    throw new Error(`The work folder ${dir} isn't a directory owned by this user.`);
  }
}
