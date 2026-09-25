import type { FileKind } from "./types";

const set = (s: string) => new Set(s.split(" "));

export const VIDEO_EXTS = set("mp4 m4v mov webm mkv ogv avi mpeg mpg ts m2ts mts wmv flv 3gp mxf");
// Containers Chrome and Safari usually decode directly. Other video is converted with ffmpeg.
export const NATIVE_VIDEO_EXTS = set("mp4 m4v mov webm mkv ogv");

const IMAGE = set("png jpg jpeg gif webp avif svg bmp ico");
const AUDIO = set("mp3 wav ogg oga m4a aac flac opus");
const MARKDOWN = set("md markdown mdx");
const JSON_EXTS = set("json geojson");
const TABLE = set("csv tsv");
const CODE = set(
  "py js mjs cjs jsx tsx rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh sql html htm css scss xml yaml yml toml ini cfg conf dockerfile makefile r lua pl proto graphql",
);
const TEXT = set("txt log jsonl ndjson srt vtt env gitignore license readme");
const ARCHIVE = set("zip tar gz tgz bz2 xz 7z rar zst");

const ORDER: [FileKind, Set<string>][] = [
  ["video", VIDEO_EXTS],
  ["image", IMAGE],
  ["audio", AUDIO],
  ["pdf", new Set(["pdf"])],
  ["markdown", MARKDOWN],
  ["json", JSON_EXTS],
  ["table", TABLE],
  ["code", CODE],
  ["text", TEXT],
  ["archive", ARCHIVE],
];

// Language ids understood by Shiki.
const LANGS: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", tsx: "tsx",
  rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql", html: "html", htm: "html", xml: "xml", css: "css", scss: "scss", yaml: "yaml",
  yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", dockerfile: "docker",
  makefile: "make", r: "r", lua: "lua", pl: "perl", proto: "proto", graphql: "graphql",
  json: "json", geojson: "json", jsonl: "json", ndjson: "json", md: "markdown", markdown: "markdown",
  mdx: "mdx", log: "log", srt: "srt", vtt: "vtt", env: "dotenv",
};

export function baseName(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

// Extension-less names (Dockerfile, LICENSE) return the whole name, and dotfiles return the name
// without the dot (.gitignore → "gitignore", .env → "env").
export function extOf(key: string): string {
  const name = baseName(key);
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(dot + 1) : name.replace(/^\.+/, "")).toLowerCase();
}

export function kindOf(key: string): FileKind {
  const ext = extOf(key);
  for (const [kind, exts] of ORDER) if (exts.has(ext)) return kind;
  return "other";
}

export function typeLabel(key: string): string {
  const name = baseName(key);
  return name.lastIndexOf(".") > 0 ? extOf(key).toUpperCase() : "File";
}

export function langOf(key: string): string {
  return LANGS[extOf(key)] ?? "";
}

export const TEXT_KINDS: ReadonlySet<FileKind> = new Set(["markdown", "json", "table", "code", "text"]);

// Filter groups shown in the browser toolbar, in display order.
export const KIND_GROUPS = [
  { id: "video", label: "Videos", kinds: ["video"] },
  { id: "image", label: "Images", kinds: ["image"] },
  { id: "audio", label: "Audio", kinds: ["audio"] },
  { id: "document", label: "Documents", kinds: ["pdf", "markdown", "text"] },
  { id: "data", label: "Data", kinds: ["json", "table", "code"] },
  { id: "other", label: "Other", kinds: ["archive", "other"] },
] as const satisfies readonly { id: string; label: string; kinds: readonly FileKind[] }[];

export type KindGroupId = (typeof KIND_GROUPS)[number]["id"];

export function groupOf(kind: FileKind): KindGroupId {
  return KIND_GROUPS.find((g) => (g.kinds as readonly FileKind[]).includes(kind))!.id;
}

export function kindColor(kind: FileKind | "folder"): string {
  switch (kind) {
    case "folder": return "var(--kind-folder)";
    case "video": return "var(--kind-video)";
    case "image": return "var(--kind-image)";
    case "audio": return "var(--kind-audio)";
    case "pdf":
    case "markdown":
    case "text": return "var(--kind-doc)";
    case "json":
    case "table":
    case "code": return "var(--kind-data)";
    default: return "var(--kind-other)";
  }
}
