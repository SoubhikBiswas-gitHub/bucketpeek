import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Shared with e2e tests; other suites may add files to it.
export const FIXTURES = path.resolve(__dirname, "../../../fixtures/bucket");

export interface TempBucket {
  root: string;
  outside: string;
  cleanup(): void;
}

// Exactly known contents, including the awkward cases: unicode and spaces in names, dotfiles,
// empty files, symlinks pointing outside.
export function makeBucket(files: Record<string, string | Buffer> = {}): TempBucket {
  const base = mkdtempSync(path.join(os.tmpdir(), "lens-unit-"));
  const root = path.join(base, "bucket");
  const outside = path.join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "top secret");

  const all: Record<string, string | Buffer> = {
    "B.txt": "upper",
    "a.txt": "lower",
    "a-b/inner.txt": "dash folder",
    "empty.txt": "",
    "space name.txt": "spaces",
    "sub/inner.json": '{"a":1}',
    "sub/deeper/x.csv": "h\n1\n",
    "ünï.txt": "unicode",
    ".hidden": "dotfile",
    "empty_dir/.keep": "",
    ...files,
  };
  for (const [key, body] of Object.entries(all)) {
    const p = path.join(root, key);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
  symlinkSync(outside, path.join(root, "linkdir"));
  return { root, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
