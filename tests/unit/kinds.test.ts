import { describe, expect, it } from "vitest";
import {
  baseName,
  extOf,
  groupOf,
  KIND_GROUPS,
  kindColor,
  kindOf,
  langOf,
  NATIVE_VIDEO_EXTS,
  TEXT_KINDS,
  typeLabel,
  VIDEO_EXTS,
} from "@/lib/kinds";
import type { FileKind } from "@/lib/types";

describe("baseName / extOf", () => {
  it("takes the last path segment", () => {
    expect(baseName("Factory/episodes/ep_a.mp4")).toBe("ep_a.mp4");
    expect(baseName("top.txt")).toBe("top.txt");
    expect(baseName("Factory/")).toBe("");
  });

  it("lower-cases the extension and uses the last dot", () => {
    expect(extOf("a/B.MP4")).toBe("mp4");
    expect(extOf("calib.tar.gz")).toBe("gz");
    expect(extOf("weird.name.JSON")).toBe("json");
  });

  it("returns the whole name for extension-less files and dotfiles", () => {
    expect(extOf("Dockerfile")).toBe("dockerfile");
    expect(extOf("x/LICENSE")).toBe("license");
    expect(extOf(".gitignore")).toBe("gitignore");
    expect(extOf("cfg/.env")).toBe("env");
  });

  it("ignores dots in folder names", () => {
    expect(extOf("v1.2/README")).toBe("readme");
  });
});

describe("kindOf", () => {
  const cases: [string, FileKind][] = [
    ["ep.mp4", "video"], ["ep.MOV", "video"], ["ep.avi", "video"], ["ep.mkv", "video"], ["ep.mxf", "video"], ["ep.ts", "video"],
    ["f.png", "image"], ["f.JPG", "image"], ["f.jpeg", "image"], ["f.svg", "image"], ["f.avif", "image"],
    ["n.mp3", "audio"], ["n.wav", "audio"], ["n.flac", "audio"],
    ["s.pdf", "pdf"], ["s.PDF", "pdf"],
    ["README.md", "markdown"], ["doc.markdown", "markdown"], ["page.mdx", "markdown"],
    ["i.json", "json"], ["m.geojson", "json"],
    ["t.csv", "table"], ["t.TSV", "table"],
    ["load.py", "code"], ["x.tsx", "code"], ["c.yaml", "code"], ["Dockerfile", "code"], ["Makefile", "code"],
    ["capture.log", "text"], ["a.txt", "text"], ["e.jsonl", "text"], ["LICENSE", "text"], [".gitignore", "text"], [".env", "text"],
    ["c.zip", "archive"], ["c.tar.gz", "archive"], ["c.7z", "archive"],
    ["sensor_dump.bin", "other"], ["noext", "other"], ["weird.xyz", "other"],
  ];
  it.each(cases)("%s → %s", (key, kind) => {
    expect(kindOf(key)).toBe(kind);
    expect(kindOf(`Factory/sub dir/${key}`)).toBe(kind);
  });
});

describe("typeLabel", () => {
  it("is the upper-case extension, or File when there is none", () => {
    expect(typeLabel("a/b.mp4")).toBe("MP4");
    expect(typeLabel("x.tar.gz")).toBe("GZ");
    expect(typeLabel("Dockerfile")).toBe("File");
    expect(typeLabel(".gitignore")).toBe("File");
  });
});

describe("langOf", () => {
  it("maps extensions to Shiki languages", () => {
    expect(langOf("load.py")).toBe("python");
    expect(langOf("a.yml")).toBe("yaml");
    expect(langOf("Dockerfile")).toBe("docker");
    expect(langOf("x.jsonl")).toBe("json");
    expect(langOf("x.bin")).toBe("");
  });
});

describe("groups and colors", () => {
  it("puts every kind in exactly one group", () => {
    const all: FileKind[] = ["video", "image", "audio", "pdf", "markdown", "json", "table", "code", "text", "archive", "other"];
    for (const k of all) {
      expect(KIND_GROUPS.filter((g) => (g.kinds as readonly FileKind[]).includes(k))).toHaveLength(1);
      expect(groupOf(k)).toBeTruthy();
      expect(kindColor(k)).toMatch(/^var\(--kind-/);
    }
    expect(groupOf("pdf")).toBe("document");
    expect(groupOf("json")).toBe("data");
    expect(groupOf("archive")).toBe("other");
    expect(kindColor("folder")).toBe("var(--kind-folder)");
  });

  it("marks text kinds and native video", () => {
    expect(TEXT_KINDS.has("table")).toBe(true);
    expect(TEXT_KINDS.has("video")).toBe(false);
    for (const ext of NATIVE_VIDEO_EXTS) expect(VIDEO_EXTS.has(ext)).toBe(true);
    expect(NATIVE_VIDEO_EXTS.has("avi")).toBe(false);
  });
});
