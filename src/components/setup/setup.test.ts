import { describe, expect, it } from "vitest";
import { connectSchema, fieldErrorsOf, normalizeAccessKey, normalizeBucket } from "@/app/setup/schema";
import { parseCredentialPaste } from "./paste";

const valid = { accessKeyId: "AKIAFAKEFAKEFAKE12", secretAccessKey: "x", bucket: "deccan-physical-ai-corpus" };

function errorsFor(values: Partial<typeof valid>, secretOptional = false) {
  const r = connectSchema({ secretOptional }).safeParse({ ...valid, ...values });
  return r.success ? {} : fieldErrorsOf(r.error);
}

describe("normalizeBucket", () => {
  it.each([
    ["deccan-physical-ai-corpus", "deccan-physical-ai-corpus"],
    ["  Deccan-Physical-AI-Corpus ", "deccan-physical-ai-corpus"],
    ["s3://deccan-physical-ai-corpus/Factory/", "deccan-physical-ai-corpus"],
    ["arn:aws:s3:::deccan-physical-ai-corpus/*", "deccan-physical-ai-corpus"],
    ["https://deccan-physical-ai-corpus.s3.ap-south-1.amazonaws.com/Factory/a.mp4", "deccan-physical-ai-corpus"],
    ["https://my.dotted.bucket.s3.amazonaws.com", "my.dotted.bucket"],
    ["https://s3.us-west-2.amazonaws.com/path-style-bucket/key", "path-style-bucket"],
    ["deccan-physical-ai-corpus/Factory", "deccan-physical-ai-corpus"],
  ])("%s", (input, out) => expect(normalizeBucket(input)).toBe(out));
});

describe("connectSchema", () => {
  it("accepts and normalizes valid input", () => {
    const r = connectSchema().parse({ ...valid, accessKeyId: " akia fakefakefake12 ", bucket: "S3://Deccan-Physical-AI-Corpus/" });
    expect(r).toEqual({ ...valid, bucket: "deccan-physical-ai-corpus" });
  });

  it("reports every empty field", () => {
    expect(Object.keys(errorsFor({ accessKeyId: "", secretAccessKey: "", bucket: "" }))).toEqual([
      "accessKeyId",
      "secretAccessKey",
      "bucket",
    ]);
  });

  it("allows a blank secret when a connection exists", () => {
    expect(errorsFor({ secretAccessKey: "" }, true)).toEqual({});
  });

  it("explains common access key mistakes", () => {
    expect(errorsFor({ accessKeyId: "AKIA1234" }).accessKeyId).toMatch(/16 to 128/);
    expect(errorsFor({ accessKeyId: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }).accessKeyId).toMatch(/secret access key/);
    expect(errorsFor({ accessKeyId: "ASIAFAKEFAKEFAKE12" }).accessKeyId).toMatch(/session token/);
    expect(errorsFor({ accessKeyId: "AKIA-FAKE-FAKE-FAKE" }).accessKeyId).toMatch(/letters and digits/);
  });

  it("explains bucket name rules", () => {
    expect(errorsFor({ bucket: "ab" }).bucket).toMatch(/at least 3/);
    expect(errorsFor({ bucket: "a".repeat(64) }).bucket).toMatch(/at most 63/);
    expect(errorsFor({ bucket: "my_bucket" }).bucket).toMatch(/lowercase letters/);
    expect(errorsFor({ bucket: "-bucket" }).bucket).toMatch(/start and end/);
    expect(errorsFor({ bucket: "my..bucket" }).bucket).toMatch(/two dots/);
    expect(errorsFor({ bucket: "192.168.1.1" }).bucket).toMatch(/IP address/);
    expect(errorsFor({ bucket: "UPPER-Case" })).toEqual({});
  });

  it("no longer asks for a link expiry: one posted by an old form is ignored", () => {
    const r = connectSchema().parse({ ...valid, linkExpiry: "5" });
    expect(r).toEqual(valid);
  });
});

describe("normalizeAccessKey", () => {
  it("strips whitespace and uppercases", () => expect(normalizeAccessKey(" akia\tfake\n")).toBe("AKIAFAKE"));
});

describe("parseCredentialPaste", () => {
  const id = "AKIAIOSFODNN7EXAMPLE";
  const secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

  it("reads an IAM CSV export", () => {
    expect(parseCredentialPaste(`Access key ID,Secret access key\n${id},${secret}\n`)).toEqual({
      accessKeyId: id,
      secretAccessKey: secret,
    });
  });

  it("reads an ~/.aws/credentials block", () => {
    const text = `[default]\naws_access_key_id = ${id}\naws_secret_access_key = ${secret}`;
    expect(parseCredentialPaste(text)).toEqual({ accessKeyId: id, secretAccessKey: secret });
  });

  it("ignores a single value", () => {
    expect(parseCredentialPaste(id)).toBeNull();
    expect(parseCredentialPaste(secret)).toBeNull();
  });
});
