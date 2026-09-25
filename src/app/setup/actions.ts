"use server";

import { redirect } from "next/navigation";
import { describeError, errorCode } from "@/lib/server/errors";
import { log } from "@/lib/server/log";
import { clearConnection, getConnection, saveConnection } from "@/lib/server/session";
import { verifyConnection } from "@/lib/server/storage";
import { connectSchema, fieldErrorsOf, type ConnectFieldName } from "./schema";

export type ConnectField = ConnectFieldName;

const alog = log.child({ scope: "session" });

export interface ConnectState {
  // What the user typed, echoed back so the form keeps it. Never includes the secret.
  values: Partial<Record<ConnectField, string>>;
  fieldErrors?: Partial<Record<ConnectField, string>>;
  error?: { title: string; message: string; field?: ConnectField };
}

const ERROR_FIELD: Record<string, ConnectField> = {
  InvalidAccessKeyId: "accessKeyId",
  SignatureDoesNotMatch: "secretAccessKey",
  NoSuchBucket: "bucket",
  InvalidBucketName: "bucket",
  PermanentRedirect: "bucket",
};

export async function connect(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const raw = {
    accessKeyId: String(form.get("accessKeyId") ?? ""),
    secretAccessKey: String(form.get("secretAccessKey") ?? ""),
    bucket: String(form.get("bucket") ?? ""),
  };
  const values = { accessKeyId: raw.accessKeyId, bucket: raw.bucket };

  const existing = await getConnection();
  const parsed = connectSchema({ secretOptional: Boolean(existing) }).safeParse(raw);
  if (!parsed.success) return { values, fieldErrors: fieldErrorsOf(parsed.error) };

  const input = parsed.data;
  if (!input.secretAccessKey) {
    // Blank secret while connected means "keep the saved one", but only for the same key.
    if (existing && existing.accessKeyId === input.accessKeyId) {
      input.secretAccessKey = existing.secretAccessKey;
    } else {
      return {
        values,
        fieldErrors: { secretAccessKey: "Enter the secret for this access key ID. The saved secret belongs to a different key." },
      };
    }
  }

  let region: string;
  const done = alog.time("connect", { bucket: input.bucket });
  try {
    region = await verifyConnection(input);
  } catch (e) {
    done({ result: "rejected", err: e }, "warn");
    const err = describeError(e);
    return { values, error: { title: err.title, message: err.message, field: ERROR_FIELD[errorCode(e)] } };
  }

  await saveConnection({ ...input, region });
  done({ result: "connected", region });
  redirect("/browse");
}

export async function disconnect(): Promise<void> {
  const bucket = (await getConnection())?.bucket;
  await clearConnection();
  alog.info("disconnected", { bucket });
  redirect("/setup");
}
