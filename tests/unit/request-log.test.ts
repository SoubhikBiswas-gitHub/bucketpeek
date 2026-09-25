import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureLog, log } from "@/lib/server/log";
import { noteRequest, requestId, wasLogged, withRequestLog } from "@/lib/server/request-log";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = [];
  configureLog({ level: "debug", format: "json", sink: (text) => lines.push(JSON.parse(text)) });
});
afterEach(() => configureLog({}));

const req = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:3213${path}`, init);

describe("withRequestLog", () => {
  it("logs method, path without the query, status and duration, and returns the request id", async () => {
    const GET = withRequestLog(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return Response.json({ ok: true });
    });
    const res = await GET(req("/api/list?prefix=a%2F&cursor=secret-cursor&sig=abc"));
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", scope: "http", msg: "GET /api/list 200", method: "GET", path: "/api/list", status: 200, req: id });
    expect(lines[0].ms).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(lines[0])).not.toContain("secret-cursor");
  });

  it("logs 4xx as warn and 5xx as error; quiet routes log success at debug", async () => {
    const status = (s: number) => withRequestLog(() => new Response(null, { status: s }), { quiet: true });
    await status(206)(req("/api/mock"));
    await status(404)(req("/api/mock"));
    await status(502)(req("/api/mock"));
    expect(lines.map((l) => [l.status, l.level])).toEqual([
      [206, "debug"],
      [404, "warn"],
      [502, "error"],
    ]);
  });

  it("gives lines logged inside the handler the same request id, and adds noted fields", async () => {
    const POST = withRequestLog(async () => {
      log.child({ scope: "s3" }).warn("HeadObject failed");
      noteRequest({ key: "site-a/take.mp4" });
      return new Response("ok");
    });
    const res = await POST(req("/api/links", { method: "POST" }));
    const id = res.headers.get("x-request-id");
    expect(lines).toMatchObject([
      { scope: "s3", req: id },
      { scope: "http", req: id, key: "site-a/take.mp4", msg: "POST /api/links 200" },
    ]);
  });

  it("keeps a proxy's request id when it is safe, and replaces one that isn't", async () => {
    const GET = withRequestLog(() => new Response("ok"));
    const kept = await GET(req("/api/version", { headers: { "x-request-id": "edge-42.a_b" } }));
    expect(kept.headers.get("x-request-id")).toBe("edge-42.a_b");
    expect(requestId(req("/", { headers: { "x-request-id": "bad id\" level=error" } }))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("adds the header to a response with immutable headers", async () => {
    const GET = withRequestLog(() => Response.redirect("https://example.com/x", 302));
    const res = await GET(req("/api/files/open?key=a"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/x");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("logs a thrown error as a 500, rethrows it, and marks it logged", async () => {
    const boom = new Error("boom");
    const GET = withRequestLog(() => {
      throw boom;
    });
    await expect(GET(req("/api/list"))).rejects.toBe(boom);
    expect(lines[0]).toMatchObject({ level: "error", status: 500, msg: "GET /api/list threw", err: { name: "Error", message: "boom" } });
    expect(wasLogged(boom)).toBe(true);
    expect(wasLogged(new Error("other"))).toBe(false);
  });

  it("passes route context through", async () => {
    const GET = withRequestLog(async (_r: Request, ctx: { params: Promise<{ id: string }> }) => new Response((await ctx.params).id));
    const res = await GET(req("/api/hls/x/y"), { params: Promise.resolve({ id: "abc" }) });
    expect(await res.text()).toBe("abc");
  });
});
