const KEY_ID = /^AKIA[A-Z0-9]{12,124}$/;
const SECRET = /^[A-Za-z0-9/+]{40}$/;

// Recognises a pasted credential pair: an IAM "Download .csv file" row (`AKIA…,wJalr…`) or an
// `~/.aws/credentials` block (`aws_access_key_id = AKIA…`). Returns null for a single value.
export function parseCredentialPaste(text: string): { accessKeyId: string; secretAccessKey: string } | null {
  if (text.length > 4000) return null;
  const tokens = text.split(/[\s,;:="']+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const accessKeyId = tokens.find((t) => KEY_ID.test(t));
  const secretAccessKey = tokens.find((t) => SECRET.test(t) && t !== accessKeyId);
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}
