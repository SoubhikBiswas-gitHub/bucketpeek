import { describe, expect, it } from "vitest";
import { describeError, errorCode, httpStatus, isNotFound, redact } from "@/lib/server/errors";

// Shaped like an AWS SDK v3 ServiceException.
function aws(name: string, status?: number, message = `${name} happened`) {
  return Object.assign(new Error(message), { name, ...(status ? { $metadata: { httpStatusCode: status } } : {}) });
}

function sys(code: string) {
  return Object.assign(new Error(`getaddrinfo ${code} s3.amazonaws.com`), { code });
}

describe("errorCode", () => {
  it("prefers AWS codes, then specific names, then Node codes", () => {
    expect(errorCode(aws("NoSuchKey", 404))).toBe("NoSuchKey");
    expect(errorCode({ Code: "AccessDenied", name: "Error" })).toBe("AccessDenied");
    expect(errorCode(sys("ENOTFOUND"))).toBe("ENOTFOUND");
    expect(errorCode(Object.assign(new TypeError("fetch failed"), { cause: sys("ECONNREFUSED") }))).toBe("ECONNREFUSED");
  });

  it("returns empty for generic or non-errors", () => {
    expect(errorCode(new Error("x"))).toBe("");
    expect(errorCode(null)).toBe("");
    expect(errorCode("boom")).toBe("");
    expect(errorCode(42)).toBe("");
  });

  it("survives self-referencing causes", () => {
    const e = new Error("loop") as Error & { cause?: unknown };
    e.cause = e;
    expect(errorCode(e)).toBe("");
  });
});

describe("httpStatus / isNotFound", () => {
  it("reads the SDK status", () => {
    expect(httpStatus(aws("X", 418))).toBe(418);
    expect(httpStatus(new Error("x"))).toBeUndefined();
    expect(httpStatus(null)).toBeUndefined();
  });

  it("treats missing objects, not missing buckets, as not found", () => {
    expect(isNotFound(aws("NoSuchKey", 404))).toBe(true);
    expect(isNotFound(aws("NotFound", 404))).toBe(true);
    expect(isNotFound(sys("ENOENT"))).toBe(true);
    expect(isNotFound(aws("Unknown", 404))).toBe(true);
    expect(isNotFound(aws("NoSuchBucket", 404))).toBe(false);
    expect(isNotFound(aws("AccessDenied", 403))).toBe(false);
  });
});

describe("describeError", () => {
  it.each([
    ["InvalidAccessKeyId", 403, "Access key not recognized", 401],
    ["SignatureDoesNotMatch", 403, "Secret key doesn’t match", 401],
    ["NoSuchBucket", 404, "Bucket not found", 404],
    ["AccessDenied", 403, "Access denied", 403],
    ["AllAccessDisabled", 403, "Access denied", 403],
    ["AccountProblem", 403, "AWS account problem", 403],
    ["NoSuchKey", 404, "File not found", 404],
    ["NotFound", 404, "File not found", 404],
    ["Forbidden", 403, "Access denied", 403],
    ["InvalidObjectState", 403, "File is archived", 403],
    ["InvalidRange", 416, "Range not available", 416],
    ["ExpiredToken", 400, "Credentials expired", 401],
    ["InvalidToken", 400, "Credentials expired", 401],
    ["RequestTimeTooSkewed", 403, "Server clock is off", 503],
    ["InvalidBucketName", 400, "Invalid bucket name", 400],
    ["PermanentRedirect", 301, "Bucket is in another region", 400],
    ["AuthorizationHeaderMalformed", 400, "Bucket is in another region", 400],
    ["SlowDown", 503, "AWS is busy", 503],
    ["InternalError", 500, "AWS had a problem", 502],
  ])("%s → %s", (code, status, title, outStatus) => {
    const err = describeError(aws(code, status));
    expect(err.title).toBe(title);
    expect(err.status).toBe(outStatus);
    expect(err.message.length).toBeGreaterThan(10);
    expect(err.detail).toContain(code);
  });

  it.each(["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"])("%s → Can’t reach AWS", (code) => {
    const err = describeError(sys(code));
    expect(err).toMatchObject({ title: "Can’t reach AWS", status: 503 });
  });

  it("maps SDK timeouts and wrapped network failures", () => {
    expect(describeError(aws("TimeoutError")).title).toBe("Can’t reach AWS");
    expect(describeError(Object.assign(new TypeError("fetch failed"), { cause: sys("ENOTFOUND") })).title).toBe("Can’t reach AWS");
  });

  it("explains KMS denials", () => {
    const err = describeError(aws("AccessDenied", 403, "User is not authorized to perform: kms:Decrypt"));
    expect(err.title).toBe("Encrypted file");
    expect(describeError(aws("KMS.DisabledException", 400)).title).toBe("Encrypted file");
  });

  it("falls back on the HTTP status for unknown codes", () => {
    expect(describeError(aws("Weird", 403)).title).toBe("Access denied");
    expect(describeError(aws("Weird", 404)).title).toBe("File not found");
    expect(describeError(aws("Weird", 301)).title).toBe("Bucket is in another region");
    expect(describeError(aws("Weird", 429)).title).toBe("AWS is busy");
    expect(describeError(aws("Weird", 503)).title).toBe("AWS is busy");
    expect(describeError(aws("Weird", 502))).toMatchObject({ title: "AWS had a problem", status: 502 });
  });

  it("gives unknown errors a generic message and keeps the cause in detail", () => {
    const err = describeError(new Error("Cannot read properties of undefined"));
    expect(err.title).toBe("Something went wrong");
    expect(err.status).toBe(500);
    expect(err.message).not.toContain("undefined");
    expect(err.detail).toBe("Cannot read properties of undefined");
    expect(describeError(aws("Weird", 400)).status).toBe(400);
  });

  it("handles non-Error values", () => {
    expect(describeError("boom")).toMatchObject({ title: "Something went wrong", detail: "boom" });
    expect(describeError(undefined)).toMatchObject({ title: "Something went wrong", status: 500 });
    expect(describeError({ message: "plain object" }).detail).toBe("plain object");
  });

  it("does not use inherited properties as codes", () => {
    expect(describeError(aws("constructor")).title).toBe("Something went wrong");
    expect(describeError(aws("toString")).title).toBe("Something went wrong");
  });

  it("never leaks credentials in detail", () => {
    const e = aws(
      "AccessDenied",
      403,
      "Failed https://b.s3.amazonaws.com/k.mp4?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260101&X-Amz-Signature=abc123 with wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    const { detail } = describeError(e);
    expect(detail).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(detail).not.toContain("abc123");
    expect(detail).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    expect(detail).toContain("https://b.s3.amazonaws.com/k.mp4?…");
  });
});

describe("redact", () => {
  it("strips signatures, key ids and secrets", () => {
    expect(redact("X-Amz-Signature=deadbeef&x=1")).toBe("X-Amz-Signature=[redacted]&x=1");
    expect(redact("/api/mock?key=a&sig=zzz")).toBe("/api/mock?key=a&sig=[redacted]");
    expect(redact("key AKIAIOSFODNN7EXAMPLE used")).toBe("key [access key] used");
    expect(redact("s=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.")).toBe("s=[redacted].");
    expect(redact("nothing secret")).toBe("nothing secret");
    expect(redact("x".repeat(2000))).toHaveLength(600);
  });
});
