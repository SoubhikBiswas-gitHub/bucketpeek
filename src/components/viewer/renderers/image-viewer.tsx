"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { ExternalLink, ImageOff, Maximize2, Minimize2, RotateCw, Scan, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isInteractiveTarget, useFullscreen, useReducedMotion } from "../media/hooks";
import { ToolButton, ToolDivider } from "../media/tool-button";

export interface ImageViewerProps {
  url: string;
  name: string;
}

// The current fit level is added to these stops at runtime.
const ZOOM_STOPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MAX_SCALE = 16;
const PAD = 24;
const PAN_STEP = 80;
// Past this zoom pixels draw as crisp squares, which is what you want when inspecting frames.
const PIXELATED_FROM = 3;
const SLOW_AFTER_MS = 8000;

type Status = "loading" | "ready" | "error";
type Backdrop = "checker" | "dark" | "light";

const BACKDROPS: Record<Backdrop, { label: string; style: CSSProperties; swatch: CSSProperties }> = {
  checker: {
    label: "Checkerboard",
    style: {
      backgroundColor: "#151515",
      backgroundImage: "repeating-conic-gradient(#202020 0 25%, transparent 0 50%)",
      backgroundSize: "20px 20px",
    },
    swatch: {
      backgroundColor: "#6b6b6b",
      backgroundImage: "repeating-conic-gradient(#b4b4b4 0 25%, transparent 0 50%)",
      backgroundSize: "8px 8px",
    },
  },
  dark: { label: "Dark", style: { backgroundColor: "#0b0b0b" }, swatch: { backgroundColor: "#0b0b0b" } },
  light: { label: "Light", style: { backgroundColor: "#f2f2f2" }, swatch: { backgroundColor: "#f2f2f2" } },
};

// SVGs are shown through <img> only, so scripts inside them never run.
export function ImageViewer({ url, name }: ImageViewerProps) {
  const [attempt, setAttempt] = useState(0);
  return <ImageStage key={`${url}#${attempt}`} url={url} name={name} onRetry={() => setAttempt((a) => a + 1)} />;
}

interface Size {
  w: number;
  h: number;
  // False for images without intrinsic dimensions (some SVGs).
  known: boolean;
}

function ImageStage({ url, name, onRetry }: ImageViewerProps & { onRetry: () => void }) {
  const router = useRouter();
  const hintId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const apiRef = useRef<ReactZoomPanPinchContentRef>(null);
  const fitRef = useRef(1);
  const fittedRef = useRef(true);

  const reduced = useReducedMotion();
  const fullscreen = useFullscreen(frameRef);
  const anim = reduced ? 0 : 200;

  const [status, setStatus] = useState<Status>("loading");
  const [slow, setSlow] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const [rotation, setRotation] = useState(0);
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [fit, setFit] = useState(1);
  const [scale, setScale] = useState(1);

  const quarterTurn = rotation % 180 !== 0;
  const boxW = size ? (quarterTurn ? size.h : size.w) : 0;
  const boxH = size ? (quarterTurn ? size.w : size.h) : 0;
  // Lets any image shrink to roughly thumbnail size, never further.
  const minScale = size ? Math.min(1, 160 / Math.max(boxW, boxH)) : 0.01;
  const clamp = useCallback((s: number) => Math.min(MAX_SCALE, Math.max(minScale, s)), [minScale]);

  const markLoaded = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const known = img.naturalWidth > 0 && img.naturalHeight > 0;
    setSize({ w: known ? img.naturalWidth : 800, h: known ? img.naturalHeight : 600, known });
  }, []);

  const handleLoad = useCallback(() => {
    // decode() finishes the (possibly huge) decode off the main thread before the image is revealed.
    imgRef.current
      ?.decode()
      .catch(() => undefined)
      .finally(markLoaded);
  }, [markLoaded]);

  useEffect(() => {
    // The image can finish before hydration, in which case onLoad/onError never reach React.
    const img = imgRef.current;
    if (img?.complete) img.decode().then(markLoaded, () => setStatus("error"));
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [markLoaded]);

  const applyFit = useCallback(
    (time: number) => {
      const api = apiRef.current;
      const el = stageRef.current;
      if (!api || !el || !boxW || !boxH) return;
      const availW = el.clientWidth - PAD * 2;
      const availH = el.clientHeight - PAD * 2;
      const s = availW > 0 && availH > 0 ? Math.min(availW / boxW, availH / boxH, 1) : 1;
      fitRef.current = s;
      fittedRef.current = true;
      setFit(s);
      void api.setTransform((el.clientWidth - boxW * s) / 2, (el.clientHeight - boxH * s) / 2, s, time);
    },
    [boxW, boxH],
  );

  // First fit happens without animation, then the image is revealed. Rotating refits with animation.
  const firstFit = useRef(true);
  useEffect(() => {
    if (!size) return;
    if (firstFit.current) {
      firstFit.current = false;
      applyFit(0);
      setStatus("ready");
      return;
    }
    // A new box size makes the zoom library re-align (and cancel running animations) once its own
    // ResizeObserver fires, so refit on the frame after that.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => applyFit(anim));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the box changes
  }, [size, boxW, boxH]);

  // Keep the image fitted while the stage resizes (window resize, fullscreen), unless the user zoomed.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || status !== "ready") return;
    const ro = new ResizeObserver(() => {
      if (fittedRef.current) applyFit(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyFit, status]);

  const zoomTo = useCallback(
    (target: number, point?: { x: number; y: number }) => {
      const api = apiRef.current;
      const el = stageRef.current;
      if (!api || !el) return;
      const r = el.getBoundingClientRect();
      void api.zoomToPoint(clamp(target), point?.x ?? r.left + r.width / 2, point?.y ?? r.top + r.height / 2, anim);
    },
    [anim, clamp],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const current = apiRef.current?.instance.state.scale ?? scale;
      const stops = [...new Set([...ZOOM_STOPS, fitRef.current])].sort((a, b) => a - b);
      const next =
        dir > 0
          ? (stops.find((z) => z > current * 1.01) ?? MAX_SCALE)
          : (stops.findLast((z) => z < current * 0.99) ?? minScale);
      zoomTo(next);
    },
    [minScale, scale, zoomTo],
  );

  const rotate = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (status !== "ready" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isInteractiveTarget(e.target, e.currentTarget)) return;
    const api = apiRef.current;
    // Arrows only pan when there is somewhere to pan to; otherwise they stay free for file navigation.
    const canPan = (api?.instance.state.scale ?? 0) > fitRef.current + 0.002;
    if (e.key.startsWith("Arrow") && !canPan) return;
    let handled = true;
    switch (e.key) {
      case "+":
      case "=":
        step(1);
        break;
      case "-":
      case "_":
        step(-1);
        break;
      case "0":
        applyFit(anim);
        break;
      case "1":
        zoomTo(1);
        break;
      case "r":
      case "R":
        rotate();
        break;
      case "ArrowLeft":
        void api?.panBy(PAN_STEP, 0, reduced ? 0 : 120);
        break;
      case "ArrowRight":
        void api?.panBy(-PAN_STEP, 0, reduced ? 0 : 120);
        break;
      case "ArrowUp":
        void api?.panBy(0, PAN_STEP, reduced ? 0 : 120);
        break;
      case "ArrowDown":
        void api?.panBy(0, -PAN_STEP, reduced ? 0 : 120);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (status !== "ready") return;
    if (fittedRef.current) zoomTo(fitRef.current < 1 ? 1 : 2, { x: e.clientX, y: e.clientY });
    else applyFit(anim);
  };

  const retry = () => {
    router.refresh();
    onRetry();
  };

  const pct = Math.round(scale * 100);
  const isFitted = status === "ready" && Math.abs(scale - fit) < 0.002;
  const isActual = status === "ready" && Math.abs(scale - 1) < 0.002;
  const zoomedIn = status === "ready" && scale > fit + 0.002;
  const ready = status === "ready";

  return (
    <div ref={frameRef} className={cn("flex h-full min-h-0 flex-col overflow-hidden bg-surface-1")}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-1 px-1.5 sm:px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-1.5 text-[13px] text-text-2">
          {status === "loading" && <Skeleton className="h-4 w-28" />}
          {ready && size?.known && (
            <>
              <span className="truncate font-mono text-xs tabular-nums text-text-1 sm:hidden">
                {size.w}×{size.h}
              </span>
              <span className="hidden truncate sm:inline">
                <span className="font-mono tabular-nums text-text-1">
                  {size.w.toLocaleString("en-US")} × {size.h.toLocaleString("en-US")}
                </span>
                <span className="ml-1 text-text-3">px</span>
              </span>
            </>
          )}
          {ready && !size?.known && <span className="truncate text-text-3">Scalable image</span>}
          {status === "error" && <span className="text-text-3">Image unavailable</span>}
        </div>

        <div
          className={cn("flex shrink-0 items-center", status === "error" && "hidden")}
          role="group"
          aria-label="Image controls"
        >
          <ToggleGroup
            type="single"
            size="sm"
            spacing={0}
            value={backdrop}
            onValueChange={(v) => v && setBackdrop(v as Backdrop)}
            aria-label="Background"
            className="mr-1 hidden md:flex"
            disabled={!ready}
          >
            {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => (
              <Tooltip key={b}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={b} aria-label={`${BACKDROPS[b].label} background`} className="w-8 px-0">
                    <span
                      aria-hidden
                      className="size-3.5 rounded-[3px] ring-1 ring-line-3 group-data-[state=on]/toggle:ring-2 group-data-[state=on]/toggle:ring-brand"
                      style={BACKDROPS[b].swatch}
                    />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {BACKDROPS[b].label} background
                </TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
          <ToolDivider className="hidden md:block" />

          <ToolButton
            label="Zoom out"
            shortcut="−"
            onClick={() => step(-1)}
            disabled={!ready || scale <= minScale + 0.001}
          >
            <ZoomOut />
          </ToolButton>
          <output aria-label="Zoom level" className="w-12 text-center font-mono text-[13px] tabular-nums text-text-1">
            {ready ? `${pct}%` : "–"}
          </output>
          <ToolButton
            label="Zoom in"
            shortcut="+"
            onClick={() => step(1)}
            disabled={!ready || scale >= MAX_SCALE - 0.001}
          >
            <ZoomIn />
          </ToolButton>
          <ToolDivider />
          <ToolButton
            label="Fit to screen"
            shortcut="0"
            aria-pressed={isFitted}
            onClick={() => applyFit(anim)}
            disabled={!ready}
          >
            <Shrink />
          </ToolButton>
          <ToolButton
            label="Actual size (100%)"
            shortcut="1"
            aria-pressed={isActual}
            onClick={() => zoomTo(1)}
            disabled={!ready}
          >
            <Scan />
          </ToolButton>
          <ToolDivider className="hidden sm:block" />
          <ToolButton
            label="Rotate 90°"
            shortcut="R"
            onClick={rotate}
            disabled={!ready}
            className="hidden sm:inline-flex"
          >
            <RotateCw />
          </ToolButton>
          {fullscreen.supported && (
            <ToolButton
              label={fullscreen.active ? "Exit full screen" : "Full screen"}
              onClick={() => void fullscreen.toggle()}
              disabled={status === "error"}
            >
              {fullscreen.active ? <Minimize2 /> : <Maximize2 />}
            </ToolButton>
          )}
          {fullscreen.active && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="text-text-2">
                  <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open original in a new tab">
                    <ExternalLink />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Open original
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div
        ref={stageRef}
        tabIndex={status === "error" ? undefined : 0}
        role="group"
        aria-roledescription="zoomable image"
        aria-label={name}
        aria-describedby={hintId}
        aria-busy={status === "loading"}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        // The pan handler cancels mousedown, which would otherwise keep focus off the stage.
        onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })}
        style={BACKDROPS[backdrop].style}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden outline-hidden select-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
          zoomedIn && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span id={hintId} className="sr-only">
          Plus and minus zoom, 0 fits the image, 1 shows actual size, arrow keys pan when zoomed in, R rotates.
        </span>

        {status !== "error" && (
          <TransformWrapper
            ref={apiRef}
            minScale={minScale}
            maxScale={MAX_SCALE}
            limitToBounds
            centerZoomedOut
            disablePadding
            wheel={{ step: 0.12 }}
            doubleClick={{ disabled: true }}
            zoomAnimation={{ disabled: reduced }}
            velocityAnimation={{ disabled: reduced }}
            onTransform={(_, state) => {
              fittedRef.current = Math.abs(state.scale - fitRef.current) < 0.002;
              setScale((prev) => (Math.round(prev * 1000) === Math.round(state.scale * 1000) ? prev : state.scale));
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%" }}
              contentStyle={size ? { width: boxW, height: boxH } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- presigned URLs are not optimizable */}
              <img
                ref={imgRef}
                src={url}
                alt={name}
                draggable={false}
                decoding="async"
                fetchPriority="high"
                onLoad={handleLoad}
                onError={() => setStatus("error")}
                className={cn(
                  "block max-w-none transition-opacity duration-200",
                  ready ? "opacity-100" : "opacity-0",
                  size && "absolute",
                  !size?.known && size && "object-contain",
                )}
                style={
                  size
                    ? {
                        width: size.w,
                        height: size.h,
                        left: (boxW - size.w) / 2,
                        top: (boxH - size.h) / 2,
                        transform: rotation ? `rotate(${rotation}deg)` : undefined,
                        imageRendering: scale >= PIXELATED_FROM ? "pixelated" : undefined,
                      }
                    : undefined
                }
              />
            </TransformComponent>
          </TransformWrapper>
        )}

        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <Skeleton className="absolute inset-6 rounded-md bg-surface-2/70" />
            <div className="relative flex flex-col items-center gap-2 text-center text-[13px] text-text-2">
              <Spinner className="size-5 text-text-3" />
              <span>{slow ? "Still loading. Large images can take a while." : "Loading image"}</span>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center bg-surface-1 p-6">
            <div className="flex max-w-sm flex-col items-center text-center">
              <div className="mb-4 grid size-11 place-items-center rounded-lg border border-danger-line bg-danger-mist text-danger">
                <ImageOff aria-hidden size={20} />
              </div>
              <h2 className="text-[15px] font-medium text-text-1">This image couldn’t be loaded</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">
                The link may have expired, the file may not be a valid image, or this browser doesn’t support the
                format.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button onClick={retry}>
                  <RotateCw data-icon="inline-start" />
                  Try again
                </Button>
                <Button asChild variant="outline">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink data-icon="inline-start" />
                    Open original
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
