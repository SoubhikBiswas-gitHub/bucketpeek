import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Check, ImageOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CopyContentsButton } from "./copy-contents-button";
import { normalizeNewlines, splitLines, type CodeToken } from "./code-model";
import { langLabel, tokenize } from "./highlight";

// Server component: fenced code blocks are highlighted on the server with the code view's Shiki theme.
export function MarkdownBody({ text }: { text: string }) {
  const { frontMatter, body } = splitFrontMatter(text);
  return (
    // break-words wraps long words, URLs and headings inside the column; unlike "anywhere" it doesn't
    // shrink table cells, so wide tables still scroll sideways.
    <article className="mx-auto w-full max-w-[72ch] px-5 py-8 text-[15px] leading-7 break-words text-text-2 sm:px-8 sm:py-10">
      {frontMatter && <FrontMatter yaml={frontMatter} />}
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {body}
      </Markdown>
    </article>
  );
}

// YAML front matter would otherwise render as a stray rule and paragraph.
function splitFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontMatter: null, body: text };
  return { frontMatter: m[1], body: text.slice(m[0].length) };
}

async function FrontMatter({ yaml }: { yaml: string }) {
  return (
    <details className="group mb-8 rounded-lg border border-line-1 bg-surface-2/60 text-sm">
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3.5 font-medium text-text-2 select-none hover:text-text-1 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-text-3 transition-transform duration-150 group-open:rotate-90">
          ›
        </span>
        Front matter
      </summary>
      <div className="border-t border-line-1">
        <HighlightedPre code={yaml} lang="yaml" />
      </div>
    </details>
  );
}

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function languageOf(node: HastNode | undefined): string {
  const cls = node?.properties?.className;
  const list = Array.isArray(cls) ? cls : typeof cls === "string" ? cls.split(" ") : [];
  const lang = list.map(String).find((c) => c.startsWith("language-"));
  return lang ? lang.slice("language-".length).toLowerCase() : "";
}

const LANG_ALIASES: Record<string, string> = { py: "python", sh: "bash", shell: "bash", js: "javascript", ts: "typescript", yml: "yaml", text: "", txt: "", plaintext: "" };

async function HighlightedPre({ code, lang }: { code: string; lang: string }) {
  const text = normalizeNewlines(code);
  const lineCount = text ? splitLines(text).length : 0;
  const tokens = await tokenize(text, lang, lineCount);
  return (
    <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 text-(--syntax-fg) [font-variant-ligatures:none] [tab-size:4]">
      <code>
        {tokens
          ? tokens.lines.map((line, i) => (
              <span key={i} className="block min-h-6">
                {renderTokens(line, tokens.styles)}
              </span>
            ))
          : text}
      </code>
    </pre>
  );
}

function renderTokens(line: CodeToken[], styles: { color?: string; italic?: boolean; bold?: boolean }[]) {
  return line.map(([t, s], i) => {
    if (s < 0) return t;
    const st = styles[s];
    return (
      <span key={i} style={{ color: st.color, fontStyle: st.italic ? "italic" : undefined, fontWeight: st.bold ? 600 : undefined }}>
        {t}
      </span>
    );
  });
}

async function CodeBlock({ node }: { node?: HastNode }) {
  const code = node?.children?.find((c) => c.tagName === "code");
  const raw = textOf(code ?? node);
  const given = languageOf(code);
  const lang = LANG_ALIASES[given] ?? given;
  const label = lang ? langLabel(lang) : "Text";
  return (
    <figure className="group/code my-6 overflow-hidden rounded-lg border border-line-1 bg-surface-0/60">
      <figcaption className="flex h-9 items-center justify-between gap-2 border-b border-line-1 bg-surface-2/50 pr-1.5 pl-3.5 text-xs text-text-3">
        <span className="truncate">{label}</span>
        <CopyContentsButton text={normalizeNewlines(raw)} label="Copy code" size="icon-xs" />
      </figcaption>
      <HighlightedPre code={raw} lang={lang} />
    </figure>
  );
}

const EXTERNAL = /^(https?:|mailto:)/i;

// GitHub-style heading slug, so in-page links like [Setup](#setup) work.
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

function heading(Tag: HeadingTag, base: string) {
  function Heading({ node, className, id, ...rest }: React.ComponentProps<HeadingTag> & { node?: unknown }) {
    // Sanitized ids carry the "user-content-" prefix; links are rewritten to match (see `a`).
    const s = slug(textOf(node as HastNode | undefined));
    return (
      <Tag
        id={id ?? (s ? `user-content-${s}` : undefined)}
        className={cn(base, "scroll-mt-4 first:mt-0", className)}
        {...rest}
      />
    );
  }
  return Heading;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- react-markdown passes the hast `node` to every
   component; it is destructured out so it never lands on a DOM element as an attribute. */
const components: Components = {
  h1: heading("h1", "mt-10 mb-5 border-b border-line-1 pb-3 text-[28px] leading-tight font-semibold tracking-tight text-balance text-text-1"),
  h2: heading("h2", "mt-10 mb-4 border-b border-line-1 pb-2 text-[21px] leading-snug font-semibold tracking-tight text-balance text-text-1"),
  h3: heading("h3", "mt-8 mb-3 text-[17px] leading-snug font-semibold text-text-1"),
  h4: heading("h4", "mt-6 mb-2 text-[15px] font-semibold text-text-1"),
  h5: heading("h5", "mt-6 mb-2 text-sm font-semibold text-text-1"),
  h6: heading("h6", "mt-6 mb-2 text-sm font-semibold text-text-2"),
  p: ({ node, className, ...p }) => <p className={cn("my-4 text-pretty first:mt-0 last:mb-0", className)} {...p} />,
  strong: ({ node, className, ...p }) => <strong className={cn("font-semibold text-text-1", className)} {...p} />,
  em: ({ node, className, ...p }) => <em className={cn("italic", className)} {...p} />,
  del: ({ node, className, ...p }) => <del className={cn("text-text-3", className)} {...p} />,
  hr: () => <hr className="my-10 border-line-1" />,
  blockquote: ({ node, className, ...p }) => (
    <blockquote className={cn("my-6 border-l-2 border-brand-line pl-4 text-text-2 [&>p]:my-2", className)} {...p} />
  ),
  ul: ({ node, className, ...p }) => (
    <ul
      className={cn(
        "my-4 list-disc pl-6 marker:text-text-3 [&_ol]:my-1.5 [&_ul]:my-1.5",
        className?.includes("contains-task-list") && "list-none pl-1",
        className,
      )}
      {...p}
    />
  ),
  ol: ({ node, className, ...p }) => (
    <ol className={cn("my-4 list-decimal pl-6 marker:text-text-3 [&_ol]:my-1.5 [&_ul]:my-1.5", className)} {...p} />
  ),
  li: ({ node, className, ...p }) => (
    <li className={cn("my-1.5 pl-1 [&>p]:my-1", className?.includes("task-list-item") && "flex items-start gap-2.5 pl-0", className)} {...p} />
  ),
  input: ({ type, checked }) =>
    type === "checkbox" ? (
      <span className="relative mt-[5px] inline-flex shrink-0">
        <input type="checkbox" checked={!!checked} disabled readOnly className="peer sr-only" aria-label={checked ? "Done" : "Not done"} />
        <span
          aria-hidden
          className={cn(
            "grid size-4 place-items-center rounded-[4px] border",
            checked ? "border-brand bg-brand text-on-brand" : "border-line-3 bg-surface-2",
          )}
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      </span>
    ) : null,
  a: ({ node, href = "", className, children, ...p }) => {
    const cls = cn(
      "font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-[text-decoration-color] duration-150 hover:decoration-brand",
      className,
    );
    if (href.startsWith("#")) {
      // rehype-sanitize prefixes ids with "user-content-"; point in-page links at the prefixed id.
      const id = href.slice(1);
      return (
        <a href={`#${id.startsWith("user-content-user-content-") ? id : `user-content-${id}`}`} className={cls} {...p}>
          {children}
        </a>
      );
    }
    if (EXTERNAL.test(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cls} {...p}>
          {children}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }
    // Relative links point at other objects in the bucket; the preview can't resolve them.
    return (
      <span
        title={href ? `Relative link to ${href}. Open it from the file browser.` : undefined}
        className="font-medium text-text-1 underline decoration-line-3 decoration-dotted underline-offset-4"
      >
        {children}
      </span>
    );
  },
  img: ({ node, src, alt, title }) => {
    const url = typeof src === "string" ? src : "";
    if (/^https?:\/\//i.test(url)) {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts; next/image would need an allowlist.
        <img
          src={url}
          alt={alt ?? ""}
          title={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="my-2 inline-block h-auto max-w-full rounded-md border border-line-1 bg-surface-2 align-middle"
        />
      );
    }
    return (
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-dashed border-line-2 bg-surface-2 px-2 py-0.5 align-middle text-[13px] text-text-3"
        title={url ? `Image at ${url} isn't shown. Only images from http(s) links load in the preview.` : undefined}
      >
        <ImageOff aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{alt || url || "Image"}</span>
      </span>
    );
  },
  code: ({ node, className, ...p }) => (
    <code
      className={cn(
        "rounded-[5px] border border-line-1 bg-surface-2 px-[0.35em] py-[0.1em] font-mono text-[0.86em] text-text-1 [overflow-wrap:anywhere] [font-variant-ligatures:none]",
        className,
      )}
      {...p}
    />
  ),
  pre: ({ node }) => <CodeBlock node={node as unknown as HastNode} />,
  // Table's own wrapper scrolls sideways; this outer box draws the border and clips its corners.
  // The even:hover rule outranks TableRow's hover background, so zebra stripes survive a hover.
  table: ({ node, className, ...p }) => (
    <div className="my-6 overflow-hidden rounded-lg border border-line-1">
      <Table className={cn("border-collapse text-left", className)} {...p} />
    </div>
  ),
  thead: ({ node, className, ...p }) => <TableHeader className={cn("bg-surface-2 [&_tr]:border-b-0", className)} {...p} />,
  tbody: ({ node, className, ...p }) => <TableBody className={className} {...p} />,
  th: ({ node, className, style, ...p }) => (
    <TableHead
      className={cn("h-auto border-b border-line-2 px-3.5 py-2.5 font-semibold text-text-1", className)}
      style={style}
      {...p}
    />
  ),
  td: ({ node, className, style, ...p }) => (
    <TableCell
      className={cn("border-t border-line-1 px-3.5 py-2.5 align-top whitespace-normal tabular-nums", className)}
      style={style}
      {...p}
    />
  ),
  tr: ({ node, className, ...p }) => (
    <TableRow
      className={cn("border-b-0 transition-none even:bg-surface-2/40 hover:bg-transparent even:hover:bg-surface-2/40", className)}
      {...p}
    />
  ),
  sup: ({ node, className, ...p }) => <sup className={cn("text-[0.75em]", className)} {...p} />,
  section: ({ node, className, ...p }) => (
    <section className={cn(className?.includes("footnotes") && "mt-10 border-t border-line-1 pt-4 text-sm", className)} {...p} />
  ),
};
/* eslint-enable @typescript-eslint/no-unused-vars */
