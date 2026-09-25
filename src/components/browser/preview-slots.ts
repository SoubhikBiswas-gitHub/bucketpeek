// FIFO limiter for tile previews, so a screen of video tiles asks for a few frames at a time and never
// takes every connection the browser allows to this origin (six over HTTP/1.1).
export interface Limiter {
  // Resolves with a function that frees the slot (safe to call more than once), or null when
  // `signal` aborts first (the tile scrolled away). Aborting after the grant frees the slot too.
  acquire(signal: AbortSignal): Promise<(() => void) | null>;
  readonly active: number;
  readonly waiting: number;
}

export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: { signal: AbortSignal; grant: () => void }[] = [];

  const next = () => {
    while (active < max && queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.signal.aborted) continue;
      active++;
      entry.grant();
    }
  };

  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    acquire(signal) {
      if (signal.aborted) return Promise.resolve(null);
      return new Promise((resolve) => {
        let granted = false;
        let freed = false;
        const release = () => {
          if (freed) return;
          freed = true;
          signal.removeEventListener("abort", onAbort);
          active--;
          next();
        };
        const entry = {
          signal,
          grant: () => {
            granted = true;
            resolve(release);
          },
        };
        // The grant reaches the caller a microtask later; a tile unmounted in between (React's
        // double-mounted effects in dev) could never free it, and the grid stalled after a few tiles.
        const onAbort = () => {
          if (granted) return release();
          const i = queue.indexOf(entry);
          if (i >= 0) queue.splice(i, 1);
          resolve(null);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        queue.push(entry);
        next();
      });
    },
  };
}

// Each may run ffmpeg or pdftoppm on the server. Measured on a 30-tile grid: 3 → 2.4 s, 4 → 2.1 s, 6 → 1.8 s;
// 6 would take every HTTP/1.1 connection from the listing and the text tiles.
export const frameSlots = createLimiter(4);
// One small ranged read each.
export const textSlots = createLimiter(4);
