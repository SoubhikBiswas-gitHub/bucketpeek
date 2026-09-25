import "server-only";
import type { AppError } from "@/lib/types";

export function errorJson(error: Pick<AppError, "title" | "message" | "detail">, status: number): Response {
  return Response.json(
    { error: { title: error.title, message: error.message, ...(error.detail ? { detail: error.detail } : {}) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export const NOT_CONNECTED = {
  title: "Not connected",
  message: "Your session ended. Connect to the bucket again to keep watching.",
} as const;
