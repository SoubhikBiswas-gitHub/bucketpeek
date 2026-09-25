"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openHref, thumbHref } from "@/lib/paths";
import { previewVersion, TEXT_PREVIEW_BYTES, textSnippet, tilePreviewOf, type TextSnippet, type TilePreviewKind } from "@/lib/previews";
import type { FileEntry, FileKind, TextChunk } from "@/lib/types";
import { cn } from "@/lib/utils";
import { frameSlots, textSlots } from "./preview-slots";
import { useNearViewport } from "./use-near-viewport";

// Loads only while the tile is near the viewport and fades in over the kind icon once loaded, so the
// icon shows while loading and after any failure. Decorative: the tile's aria-label names the file.

// Previews that failed this session (key + version), so scrolling back doesn't ask again.
const failed = new Set<string>();
// null: not text after all. Most recent last.
const snippets = new Map<string, TextSnippet | null>();
const SNIPPET_CACHE = 400;

function remember(id: string, snippet: TextSnippet | null) {
  snippets.delete(id);
  snippets.set(id, snippet);
  if (snippets.size > SNIPPET_CACHE) snippets.delete(snippets.keys().next().value!);
}

export function TilePreview({ file }: { file: FileEntry }) {
  const kind = tilePreviewOf(file);
  const id = `${file.key}\u0000${previewVersion(file)}`;
  // A new version of the file starts over.
  return kind ? <PreviewArea key={id} id={id} file={file} kind={kind} /> : null;
}

function PreviewArea({ id, file, kind }: { id: string; file: FileEntry; kind: TilePreviewKind }) {
  const ref = useRef<HTMLDivElement>(null);
  // A snippet fetched earlier shows right away, like an image the browser has cached.
  const [loaded, setLoaded] = useState(() => kind === "text" && Boolean(snippets.get(id)));
  const [error, setError] = useState(() => failed.has(id));
  const near = useNearViewport(ref, !error && !loaded);

  const onLoad = useCallback(() => setLoaded(true), []);
  const onError = useCallback(() => {
    failed.add(id);
    setError(true);
  }, [id]);

  // Once loaded it stays; while loading, leaving the viewport unmounts the layer, which cancels it.
  const show = !error && (loaded || near);
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none",
        loaded ? "opacity-100" : "opacity-0",
      )}
    >
      {show &&
        (kind === "text" ? (
          <TextLayer id={id} fileKey={file.key} version={previewVersion(file)} onLoad={onLoad} onError={onError} />
        ) : (
          <ImageLayer
            src={kind === "image" ? openHref(file.key) : thumbHref(file.key, previewVersion(file))}
            kind={kind}
            fileKind={file.kind}
            onLoad={onLoad}
            onError={onError}
          />
        ))}
    </div>
  );
}

interface LayerProps {
  onLoad: () => void;
  onError: () => void;
}

function ImageLayer({ src, kind, fileKind, onLoad, onError }: LayerProps & { src: string; kind: TilePreviewKind; fileKind: FileKind }) {
  const pdf = fileKind === "pdf";
  // Originals come straight from the bucket and need no slot; frames may start ffmpeg on the server.
  const [granted, setGranted] = useState(kind === "image");
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (kind === "image") return;
    const ctrl = new AbortController();
    void frameSlots.acquire(ctrl.signal).then((free) => {
      if (!free) return;
      // Granted just before cleanup ran (StrictMode's second effect pass does this): give it back.
      if (ctrl.signal.aborted) return free();
      release.current = free;
      setGranted(true);
    });
    return () => {
      ctrl.abort();
      release.current?.();
    };
  }, [kind]);

  const done = (ok: boolean) => {
    release.current?.();
    if (ok) onLoad();
    else onError();
  };

  if (!granted) return null;
  return (
    <div
      className="absolute inset-0"
      style={
        fileKind === "image"
          ? {
              // Behind transparent images.
              backgroundColor: "var(--surface-3)",
              backgroundImage:
                "conic-gradient(var(--surface-2) 25%, transparent 0 50%, var(--surface-2) 0 75%, transparent 0)",
              backgroundSize: "16px 16px",
            }
          : { backgroundColor: pdf ? "#fff" : "var(--surface-3)" }
      }
    >
      {/* A presigned redirect or a generated thumbnail; neither goes through next/image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        decoding="async"
        draggable={false}
        // 204 (no preview) and broken files both land here; the icon underneath stays.
        onLoad={(e) => done(e.currentTarget.naturalWidth > 0)}
        onError={() => done(false)}
        className={cn("size-full object-cover", pdf && "object-top")}
      />
    </div>
  );
}

function TextLayer({ id, fileKey, version, onLoad, onError }: LayerProps & { id: string; fileKey: string; version: string }) {
  const cached = snippets.get(id) ?? null;
  const [fetched, setFetched] = useState<TextSnippet | null>(null);
  const snippet = cached ?? fetched;

  useEffect(() => {
    if (cached) return;
    const ctrl = new AbortController();
    let free: (() => void) | null = null;
    const load = async (release: () => void) => {
      try {
        // Only the first few KB: one small ranged read, whatever the file's size. `v` lets the browser keep it.
        const url = `/api/files/text?key=${encodeURIComponent(fileKey)}&length=${TEXT_PREVIEW_BYTES}&v=${encodeURIComponent(version)}`;
        const res = await fetch(url, {
          signal: ctrl.signal,
        });
        const s = res.ok ? textSnippet(((await res.json()) as TextChunk).text) : null;
        remember(id, s);
        if (s) {
          setFetched(s);
          onLoad();
        } else onError();
      } catch {
        if (!ctrl.signal.aborted) onError();
      } finally {
        release();
      }
    };
    void textSlots.acquire(ctrl.signal).then((release) => {
      if (!release) return;
      free = release;
      void load(release);
    });
    return () => {
      ctrl.abort();
      free?.();
    };
  }, [cached, id, fileKey, version, onLoad, onError]);

  if (!snippet) return null;
  return (
    // Opaque, so the icon underneath never shows through; only the text fades out above the type label.
    <div className="absolute inset-0 overflow-hidden bg-surface-1">
      <pre
        className={cn(
          "h-full px-3 pt-2.5 font-mono text-[10px] leading-[14px] text-text-2",
          "[mask-image:linear-gradient(to_bottom,#000_45%,transparent_88%)]",
          snippet.wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
        )}
      >
        {snippet.text}
      </pre>
    </div>
  );
}
