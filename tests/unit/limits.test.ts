import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { envLimit, healthScans, inspections, semaphore } from "@/lib/server/limits";
import { playableView } from "@/lib/server/playable-cache";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("semaphore", () => {
  it("runs at most `max` tasks at once and runs every task", async () => {
    const s = semaphore(() => 2);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        s.run(async () => {
          peak = Math.max(peak, ++running);
          await tick(5);
          running--;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.active).toBe(0);
  });

  it("frees the slot of a task that fails", async () => {
    const s = semaphore(() => 1);
    await expect(s.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await s.run(async () => "next")).toBe("next");
  });

  it("queues in order", async () => {
    const s = semaphore(() => 1);
    const g = gate();
    const order: string[] = [];
    const first = s.run(() => g.opened.then(() => void order.push("first")));
    const second = s.run(async () => void order.push("second"));
    const third = s.run(async () => void order.push("third"));
    await tick();
    expect(s.waiting).toBe(2);
    g.open();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["first", "second", "third"]);
  });
});

describe("shared limits", () => {
  it("default to 4 inspections and 2 health scans, overridable from the environment", () => {
    expect(envLimit("LENS_MAX_INSPECTIONS", 4)).toBe(4);
    vi.stubEnv("LENS_MAX_INSPECTIONS", "9");
    expect(envLimit("LENS_MAX_INSPECTIONS", 4)).toBe(9);
    for (const bad of ["0", "-1", "lots", ""]) {
      vi.stubEnv("LENS_MAX_INSPECTIONS", bad);
      expect(envLimit("LENS_MAX_INSPECTIONS", 4)).toBe(4);
    }
    expect(envLimit("LENS_MAX_HEALTH_SCANS", 2)).toBe(2);
    expect(healthScans.active).toBe(0);
  });

  describe("index reads for playable MP4s", () => {
    let server: Server;
    let origin: string;
    let requests = 0;
    beforeAll(async () => {
      server = createServer((_req, res) => {
        requests++;
        res.writeHead(403).end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    it("wait for a free slot before touching the bucket", async () => {
      vi.stubEnv("LENS_MAX_INSPECTIONS", "1");
      const g = gate();
      const busy = inspections.run(() => g.opened);
      const view = playableView("b", "limits/clip.mp4", "1:x", `${origin}/clip.mp4`, 10_000);
      await tick(100);
      expect(requests).toBe(0);
      g.open();
      await busy;
      expect(await view).toBeNull();
      expect(requests).toBeGreaterThan(0);
    });
  });
});
