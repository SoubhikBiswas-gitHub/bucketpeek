// The AWS CLI fetches big files in parallel parts and retries failed ones, unlike a browser.

// POSIX shells (bash, zsh): inside single quotes nothing is special, so `"`, `$`, backticks, spaces and
// globs stay literal; a single quote itself is closed, escaped and reopened.
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

function folderName(prefix: string): string {
  const name = prefix.replace(/\/+$/, "").split("/").pop() ?? "";
  // "." and ".." would copy into the current or parent directory rather than a new folder.
  return name === "" || name === "." || name === ".." ? "download" : name;
}

export function awsCliCommand(bucket: string, keyOrPrefix: string): string {
  const uri = shellQuote(`s3://${bucket}/${keyOrPrefix}`);
  if (!keyOrPrefix.endsWith("/")) return `aws s3 cp ${uri} .`;
  return `aws s3 cp --recursive ${uri} ${shellQuote(`./${folderName(keyOrPrefix)}/`)}`;
}

export function awsCliCommands(bucket: string, keysOrPrefixes: readonly string[]): string {
  return keysOrPrefixes.map((k) => awsCliCommand(bucket, k)).join("\n");
}
