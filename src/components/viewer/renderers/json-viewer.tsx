import { DocFrame, EmptyDocument } from "@/components/viewer/documents/doc-chrome";
import { prepareCode } from "@/components/viewer/documents/highlight";
import { jsonShape } from "@/components/viewer/documents/json-model";
import { JsonView, type RawOnlyReason } from "@/components/viewer/documents/json-view";
import "@/components/viewer/documents/syntax.css";

export interface JsonViewerProps {
  // Pretty-printed when the file parsed.
  text: string;
  truncated: boolean;
  downloadHref: string;
}

// The tree needs the whole document, so a truncated or invalid file falls back to Raw.
export async function JsonViewer({ text, truncated, downloadHref }: JsonViewerProps) {
  if (!text.trim()) {
    return (
      <DocFrame>
        <EmptyDocument description={text ? "The file only holds whitespace." : undefined} />
      </DocFrame>
    );
  }

  let value: object | null = null;
  let rawOnly: RawOnlyReason | null = null;
  let parseError: string | null = null;

  if (truncated) {
    rawOnly = "truncated";
  } else {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") value = parsed;
      else rawOnly = "primitive";
    } catch (e) {
      rawOnly = "invalid";
      parseError = e instanceof Error ? e.message : null;
    }
  }

  const raw = await prepareCode(text, "json");
  return (
    <JsonView
      value={value}
      shape={value ? jsonShape(value) : null}
      raw={raw}
      rawOnly={rawOnly}
      parseError={parseError}
      truncated={truncated}
      downloadHref={downloadHref}
    />
  );
}
