import "server-only";
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki";
import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  measureLines,
  normalizeNewlines,
  splitLines,
  type CodeData,
  type CodeStyle,
  type CodeToken,
  type CodeTokens,
} from "./code-model";
import { LENS_THEME_NAME, lensTheme } from "./shiki-theme";

const cache = globalThis as unknown as { __lensHighlighter?: { theme: object; promise: Promise<Highlighter> } };

// One highlighter per server process, rebuilt if the theme module reloads.
function highlighter(): Promise<Highlighter> {
  if (cache.__lensHighlighter?.theme !== lensTheme) {
    const promise = createHighlighter({ themes: [lensTheme], langs: [] });
    promise.catch(() => {
      if (cache.__lensHighlighter?.promise === promise) cache.__lensHighlighter = undefined;
    });
    cache.__lensHighlighter = { theme: lensTheme, promise };
  }
  return cache.__lensHighlighter.promise;
}

const LABELS: Record<string, string> = {
  "": "Plain text",
  log: "Log",
  srt: "SubRip subtitles",
  vtt: "WebVTT subtitles",
  dotenv: "Environment file",
};

function isBundled(lang: string): lang is BundledLanguage {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, lang);
}

export function langLabel(lang: string): string {
  if (lang in LABELS) return LABELS[lang];
  const info = bundledLanguagesInfo.find((l) => l.id === lang || l.aliases?.includes(lang));
  return info?.name ?? lang.toUpperCase();
}

// Returns null (unknown language, over the limits, or Shiki failed) so callers fall back to plain text.
// `text` must already be normalized (see normalizeNewlines).
export async function tokenize(text: string, lang: string, lineCount: number): Promise<CodeTokens | null> {
  if (!lang || !isBundled(lang)) return null;
  if (text.length > HIGHLIGHT_MAX_CHARS || lineCount > HIGHLIGHT_MAX_LINES) return null;
  try {
    const h = await highlighter();
    if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
    const { tokens } = h.codeToTokens(text, {
      lang,
      theme: LENS_THEME_NAME,
      // Minified one-liners: stop tokenizing past this width and show the rest plainly.
      tokenizeMaxLineLength: 2_000,
      tokenizeTimeLimit: 300,
    });

    const styles: CodeStyle[] = [];
    const index = new Map<string, number>();
    const fg = "var(--syntax-fg)";
    const styleOf = (color: string | undefined, fontStyle: number | undefined): number => {
      const italic = !!(fontStyle && fontStyle & 1);
      const bold = !!(fontStyle && fontStyle & 2);
      const c = color && color !== fg ? color : undefined;
      if (!c && !italic && !bold) return -1;
      const k = `${c ?? ""}|${italic ? 1 : 0}|${bold ? 1 : 0}`;
      let i = index.get(k);
      if (i === undefined) {
        i = styles.length;
        styles.push({ ...(c && { color: c }), ...(italic && { italic }), ...(bold && { bold }) });
        index.set(k, i);
      }
      return i;
    };

    const lines: CodeToken[][] = tokens.map((line) => {
      const out: CodeToken[] = [];
      for (const t of line) {
        const s = styleOf(t.color, t.fontStyle);
        const last = out[out.length - 1];
        // Merge neighbours with the same style to keep the payload small.
        if (last && last[1] === s) last[0] += t.content;
        else out.push([t.content, s]);
      }
      return out;
    });
    return { styles, lines };
  } catch (e) {
    console.warn(`[deccan-lens] highlighting ${lang} failed, showing plain text`, e);
    return null;
  }
}

export interface PrepareOptions {
  log?: boolean;
}

// Never throws.
export async function prepareCode(raw: string, lang: string, opts: PrepareOptions = {}): Promise<CodeData> {
  const text = normalizeNewlines(raw);
  const lines = splitLines(text);
  const lineCount = text.length ? lines.length : 0;
  const maxLineLength = measureLines(lines);
  const log = opts.log ?? lang === "log";

  const tokens = lineCount ? await tokenize(text, lang, lineCount) : null;
  let plainReason: CodeData["plainReason"] = null;
  if (!tokens && lang && lineCount) {
    if (!isBundled(lang)) plainReason = "unsupported";
    else if (text.length > HIGHLIGHT_MAX_CHARS || lineCount > HIGHLIGHT_MAX_LINES) plainReason = "large";
  }

  return {
    tokens,
    text: tokens ? null : text,
    lineCount,
    maxLineLength,
    langLabel: langLabel(lang),
    plainReason,
    log,
    wrapDefault: !lang || log || lang === "markdown" || maxLineLength > 240,
  };
}
