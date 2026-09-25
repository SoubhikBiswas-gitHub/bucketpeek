import "server-only";

export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

// `max` is read on every acquire, so an env override applies without a restart in tests.
export function semaphore(max: () => number): Semaphore {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    active--;
    while (queue.length && active < max()) {
      active++;
      queue.shift()!();
    }
  };
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active < max()) active++;
      else await new Promise<void>((resolve) => queue.push(resolve));
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}

export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === "" ? NaN : Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

type Limits = { inspections: Semaphore; healthScans: Semaphore };
// Shared across dev hot reloads, so a reload can't double the limits.
const g = globalThis as unknown as { __lensLimits?: Limits };
const limits: Limits = (g.__lensLimits ??= {
  inspections: semaphore(() => envLimit("LENS_MAX_INSPECTIONS", 4)),
  healthScans: semaphore(() => envLimit("LENS_MAX_HEALTH_SCANS", 2)),
});

// ffprobe runs, MP4 index reads and fragment walks: each can read tens of MB or hold many connections.
export const inspections = limits.inspections;
export const healthScans = limits.healthScans;
