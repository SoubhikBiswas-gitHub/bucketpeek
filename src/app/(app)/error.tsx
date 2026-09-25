"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/error-state";

interface AppErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}

// Sits under the top bar, so the header stays usable when a page fails.
export default function AppError({ error, retry }: AppErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server errors reach the client as a generic message plus a digest; show the digest as a reference.
  const detail = [error.digest && `Reference: ${error.digest}`, process.env.NODE_ENV !== "production" && error.message]
    .filter(Boolean)
    .join("\n");

  return (
    <ErrorState
      error={{
        title: "This page didn’t load",
        message: "Something went wrong while showing this page. Try again, or check your connection settings if it keeps happening.",
        detail,
      }}
      onRetry={retry}
    />
  );
}
