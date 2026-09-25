import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { awsCliCommand, awsCliCommands, shellQuote } from "@/lib/aws-cli";

// What a POSIX shell makes of the quoted words: one argument per line.
const shellWords = (words: string) => execFileSync("sh", ["-c", `printf '%s\\n' ${words}`], { encoding: "utf8" }).split("\n").slice(0, -1);

describe("shellQuote", () => {
  it.each([
    "plain",
    "with space",
    'double "quote"',
    "it's",
    "'''",
    "$HOME and $(whoami) and `id`",
    "glob * ? [a]",
    "back\\slash; semi & amp | pipe > redirect",
    "файл 1+1#.txt",
    "",
  ])("round-trips %j through sh unchanged", (word) => {
    expect(shellWords(shellQuote(word))).toEqual([word]);
  });

  it("escapes a single quote as '\\''", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("awsCliCommand", () => {
  it("copies a file into the current directory", () => {
    expect(awsCliCommand("deccan-demo", "Factory/README.md")).toBe(`aws s3 cp 's3://deccan-demo/Factory/README.md' .`);
  });

  it("copies a folder recursively into a folder of the same name", () => {
    expect(awsCliCommand("deccan-demo", "Factory/episodes/")).toBe(
      `aws s3 cp --recursive 's3://deccan-demo/Factory/episodes/' './episodes/'`,
    );
  });

  it("keeps keys with quotes, dollars and spaces literal", () => {
    const key = `Site A/"take 2" $5 it's.mp4`;
    const command = awsCliCommand("b", key);
    expect(command).toBe(`aws s3 cp 's3://b/Site A/"take 2" $5 it'\\''s.mp4' .`);
    expect(shellWords(command.slice("aws s3 cp ".length))).toEqual([`s3://b/${key}`, "."]);
  });

  it("quotes the local folder name too", () => {
    const command = awsCliCommand("b", `raw/it's $here/`);
    expect(shellWords(command.slice("aws s3 cp --recursive ".length))).toEqual([`s3://b/raw/it's $here/`, `./it's $here/`]);
  });

  it("never copies a folder named . or .. into the current or parent directory", () => {
    expect(awsCliCommand("b", "a/../")).toBe(`aws s3 cp --recursive 's3://b/a/../' './download/'`);
    expect(awsCliCommand("b", "./")).toBe(`aws s3 cp --recursive 's3://b/./' './download/'`);
  });
});

describe("awsCliCommands", () => {
  it("writes one line per item in order", () => {
    expect(awsCliCommands("b", ["x/a.mp4", "x/y/"]).split("\n")).toEqual([
      `aws s3 cp 's3://b/x/a.mp4' .`,
      `aws s3 cp --recursive 's3://b/x/y/' './y/'`,
    ]);
  });
});
