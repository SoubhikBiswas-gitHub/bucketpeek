import { z } from "zod";

// Shared by the client (instant feedback) and the `connect` server action (authoritative): keep it importable anywhere.

export const CONNECT_FIELDS = ["accessKeyId", "secretAccessKey", "bucket"] as const;
export type ConnectFieldName = (typeof CONNECT_FIELDS)[number];

export function normalizeAccessKey(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

const S3_HOST = /^(.+?)\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$/;
const S3_PATH_HOST = /^s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$/;

// Accepts what people actually paste: `my-bucket`, `s3://my-bucket/Factory/`, `arn:aws:s3:::my-bucket/*`,
// `https://my-bucket.s3.ap-south-1.amazonaws.com/x` or `https://s3.amazonaws.com/my-bucket/x`.
export function normalizeBucket(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^arn:aws[a-z-]*:s3:::/i, "");
  v = v.replace(/^s3:\/\//i, "");
  v = v.replace(/^https?:\/\//i, "");
  const slash = v.indexOf("/");
  const host = (slash === -1 ? v : v.slice(0, slash)).toLowerCase();
  const rest = slash === -1 ? "" : v.slice(slash + 1);
  const virtual = S3_HOST.exec(host);
  if (virtual) return virtual[1];
  if (S3_PATH_HOST.test(host)) return (rest.split("/")[0] ?? "").toLowerCase();
  return host;
}

const accessKeyId = z.string().superRefine((raw, ctx) => {
  const trimmed = raw.trim();
  const v = normalizeAccessKey(raw);
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!v) return fail("Enter your access key ID.");
  if (trimmed.length === 40 && /[a-z/+]/.test(trimmed)) {
    return fail("This looks like a secret access key. The access key ID is the shorter one that starts with AKIA.");
  }
  if (v.startsWith("ASIA")) {
    return fail("Temporary keys (starting with ASIA) need a session token, which isn’t supported. Use a long-term key that starts with AKIA.");
  }
  if (!/^[A-Z0-9]+$/.test(v)) return fail("Access key IDs contain only letters and digits, like AKIAIOSFODNN7EXAMPLE.");
  if (v.length < 16 || v.length > 128) return fail("Access key IDs are 16 to 128 characters long, like AKIAIOSFODNN7EXAMPLE.");
});

const bucket = z.string().superRefine((raw, ctx) => {
  const v = normalizeBucket(raw);
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!v) return fail("Enter the bucket name.");
  if (v.length < 3) return fail("Bucket names are at least 3 characters long.");
  if (v.length > 63) return fail("Bucket names are at most 63 characters long.");
  if (!/^[a-z0-9.-]+$/.test(v)) return fail("Use only lowercase letters, numbers, dots and hyphens.");
  if (!/^[a-z0-9].*[a-z0-9]$/.test(v)) return fail("Bucket names start and end with a letter or number.");
  if (v.includes("..")) return fail("Bucket names can’t contain two dots in a row.");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return fail("Bucket names can’t be formatted like an IP address.");
});

// `secretOptional` is for an existing connection: a blank secret keeps the saved one (the server checks
// the access key didn't change).
export function connectSchema({ secretOptional = false }: { secretOptional?: boolean } = {}) {
  return z
    .object({
      accessKeyId,
      secretAccessKey: secretOptional ? z.string() : z.string().trim().min(1, "Enter your secret access key."),
      bucket,
    })
    .transform((v) => ({
      accessKeyId: normalizeAccessKey(v.accessKeyId),
      secretAccessKey: v.secretAccessKey.trim(),
      bucket: normalizeBucket(v.bucket),
    }));
}

export type ConnectInput = z.output<ReturnType<typeof connectSchema>>;
export type ConnectValues = Record<ConnectFieldName, string>;

export function fieldErrorsOf(error: z.ZodError): Partial<Record<ConnectFieldName, string>> {
  const out: Partial<Record<ConnectFieldName, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as ConnectFieldName;
    if (CONNECT_FIELDS.includes(field)) out[field] ??= issue.message;
  }
  return out;
}

export function validateField(
  field: ConnectFieldName,
  values: ConnectValues,
  opts?: { secretOptional?: boolean },
): string | undefined {
  const r = connectSchema(opts).safeParse(values);
  return r.success ? undefined : fieldErrorsOf(r.error)[field];
}
