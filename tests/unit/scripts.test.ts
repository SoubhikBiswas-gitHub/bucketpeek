import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("dev servers", () => {
  // Development may run on a generated secret and mock mode accepts any keys: keep them off the network.
  it.each(["dev", "dev:mock"])("%s listens on 127.0.0.1 only", (name) => {
    expect(pkg.scripts[name]).toMatch(/\bnext dev\b.*(?:-H|--hostname) 127\.0\.0\.1\b/);
  });

  it("the generated development secret is never committed or copied into an image", () => {
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toMatch(/^\/?\.lens\/?$/m);
    expect(readFileSync(path.join(root, ".dockerignore"), "utf8")).toMatch(/^\/?\.lens\/?$/m);
  });
});
