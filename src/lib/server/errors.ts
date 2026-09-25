import "server-only";
import type { AppError } from "@/lib/types";

type Known = Omit<AppError, "detail">;

const REGION: Known = {
  title: "Bucket is in another region",
  message: "AWS expected this bucket to be reached in a different region. Reconnect so Deccan Lens can detect the right one.",
  status: 400,
};

const EXPIRED: Known = {
  title: "Credentials expired",
  message: "These credentials have expired. Create a new access key in IAM and reconnect.",
  status: 401,
};

const BUSY: Known = {
  title: "AWS is busy",
  message: "S3 is limiting requests right now. Wait a moment and try again.",
  status: 503,
};

const KNOWN: Record<string, Known> = {
  InvalidAccessKeyId: {
    title: "Access key not recognized",
    message: "AWS has no record of this access key ID. Check it for typos, or create a new key in IAM.",
    status: 401,
  },
  SignatureDoesNotMatch: {
    title: "Secret key doesn’t match",
    message: "The secret access key doesn’t belong to this access key ID. Paste it again from IAM.",
    status: 401,
  },
  NoSuchBucket: {
    title: "Bucket not found",
    message: "No bucket with this name exists. Check the spelling.",
    status: 404,
  },
  AccessDenied: {
    title: "Access denied",
    message: "These keys can’t read this bucket. The IAM user needs s3:ListBucket and s3:GetObject on it.",
    status: 403,
  },
  AllAccessDisabled: {
    title: "Access denied",
    message: "All access to this bucket has been disabled.",
    status: 403,
  },
  AccountProblem: {
    title: "AWS account problem",
    message: "AWS reported a problem with this account, such as billing. Check the account in the AWS console.",
    status: 403,
  },
  NoSuchKey: {
    title: "File not found",
    message: "This file isn’t in the bucket anymore. It may have been moved or deleted.",
    status: 404,
  },
  InvalidObjectState: {
    title: "File is archived",
    message: "This file is stored in S3 Glacier or Deep Archive. Restore it in the AWS console, then try again.",
    status: 403,
  },
  InvalidRange: {
    title: "Range not available",
    message: "The requested part of the file is past its end.",
    status: 416,
  },
  ExpiredToken: EXPIRED,
  InvalidToken: EXPIRED,
  TokenRefreshRequired: EXPIRED,
  RequestTimeTooSkewed: {
    title: "Server clock is off",
    message: "The clock on the machine running Deccan Lens is more than 15 minutes off, so AWS rejects its requests. Sync the clock and try again.",
    status: 503,
  },
  InvalidCursor: {
    title: "Page link expired",
    message: "The rest of this folder can’t be loaded from where it left off. Reload the folder.",
    status: 400,
  },
  InvalidBucketName: {
    title: "Invalid bucket name",
    message: "Bucket names use lowercase letters, numbers, dots and hyphens.",
    status: 400,
  },
  PermanentRedirect: REGION,
  MovedPermanently: REGION,
  AuthorizationHeaderMalformed: REGION,
  IllegalLocationConstraintException: REGION,
  SlowDown: BUSY,
  ServiceUnavailable: BUSY,
  RequestLimitExceeded: BUSY,
  Throttling: BUSY,
  ThrottlingException: BUSY,
  TooManyRequestsException: BUSY,
  InternalError: {
    title: "AWS had a problem",
    message: "S3 reported an internal error. Try again in a moment.",
    status: 502,
  },
};

const KMS_DENIED: Known = {
  title: "Encrypted file",
  message: "This file is encrypted with a KMS key these credentials can’t use. The IAM user needs kms:Decrypt on that key.",
  status: 403,
};

const NETWORK: Known = {
  title: "Can’t reach AWS",
  message: "Check your internet connection and try again.",
  status: 503,
};

const NETWORK_CODES = new Set([
  "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH",
  "EHOSTUNREACH", "EPIPE", "TimeoutError", "RequestTimeout", "NetworkingError", "AbortError",
  "RequestAbortedError", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT",
]);

// Names that say nothing about what went wrong, so a `code` property is preferred over them.
const GENERIC_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "UnknownError"]);

interface AwsLikeError {
  name?: unknown;
  Code?: unknown;
  message?: unknown;
  code?: unknown;
  cause?: unknown;
  $metadata?: { httpStatusCode?: number };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

// The most specific code: the AWS error code (`NoSuchKey`) or a Node system code (`ENOTFOUND`), else `cause`'s.
export function errorCode(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const err = e as AwsLikeError;
  const name = str(err.name);
  const code =
    str(err.Code) ||
    (name && !GENERIC_NAMES.has(name) ? name : "") ||
    str(err.code) ||
    (err.cause && err.cause !== e ? errorCode(err.cause) : "");
  return code || (GENERIC_NAMES.has(name) ? "" : name);
}

export function httpStatus(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const status = (e as AwsLikeError).$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

export function isNotFound(e: unknown): boolean {
  const code = errorCode(e);
  if (code === "NoSuchBucket") return false;
  return ["NoSuchKey", "NotFound", "ENOENT", "ENOTDIR"].includes(code) || httpStatus(e) === 404;
}

const MAX_DETAIL = 600;

// Strips presigned-URL query strings, access key IDs and secret-looking strings from text headed to logs or the browser.
export function redact(text: string, maxLength = MAX_DETAIL): string {
  return text
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi, "$1?…")
    .replace(/(X-Amz-(?:Credential|Signature|Security-Token)=|\bsig=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/\b(?:AKIA|ASIA|AROA|AIDA)[A-Z0-9]{12,124}\b/g, "[access key]")
    .replace(/(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g, "[redacted]")
    .slice(0, maxLength);
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") return str((e as AwsLikeError).message);
  return typeof e === "string" ? e : "";
}

// Never includes credentials.
export function describeError(e: unknown): AppError {
  const code = errorCode(e);
  const status = httpStatus(e);
  const raw = messageOf(e);
  const detail = redact(code && raw ? `${code}: ${raw}` : code || raw || String(e)) || undefined;
  const make = (k: Known): AppError => (detail ? { ...k, detail } : { ...k });

  if (code === "AccessDenied" && /\bkms\b/i.test(raw)) return make(KMS_DENIED);
  if (code.startsWith("KMS.")) return make(KMS_DENIED);
  if (Object.hasOwn(KNOWN, code)) return make(KNOWN[code]);
  if (code === "NotFound" || code === "ENOENT" || code === "ENOTDIR") return make(KNOWN.NoSuchKey);
  if (code === "Forbidden" || code === "EACCES" || status === 403) return make(KNOWN.AccessDenied);
  if (NETWORK_CODES.has(code)) return make(NETWORK);
  if (status === 301 || status === 307) return make(REGION);
  if (status === 404) return make(KNOWN.NoSuchKey);
  if (status === 429) return make(BUSY);
  if (status === 503) return make(BUSY);
  if (status !== undefined && status >= 500) return make(KNOWN.InternalError);
  return make({
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again, and check the server logs if it keeps happening.",
    status: status !== undefined && status >= 400 && status < 600 ? status : 500,
  });
}
