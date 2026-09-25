import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logStartup } = await import("@/lib/server/startup-log");
  logStartup();
}

// Uncaught errors in pages, server actions and route handlers the request logger didn't already report.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ log }, { wasLogged }] = await Promise.all([import("@/lib/server/log"), import("@/lib/server/request-log")]);
  if (wasLogged(err)) return;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  log.error("unhandled server error", {
    scope: "next",
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    digest,
    err,
  });
};
