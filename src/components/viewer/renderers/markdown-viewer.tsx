import { EmptyDocument, DocFrame } from "@/components/viewer/documents/doc-chrome";
import { prepareCode } from "@/components/viewer/documents/highlight";
import { MarkdownBody } from "@/components/viewer/documents/markdown-body";
import { MarkdownView } from "@/components/viewer/documents/markdown-view";
import "@/components/viewer/documents/syntax.css";

export interface MarkdownViewerProps {
  text: string;
  truncated: boolean;
  downloadHref: string;
}

export async function MarkdownViewer({ text, truncated, downloadHref }: MarkdownViewerProps) {
  if (!text.trim()) {
    return (
      <DocFrame>
        <EmptyDocument description={text ? "The file only holds whitespace." : undefined} />
      </DocFrame>
    );
  }
  const source = await prepareCode(text, "markdown");
  return (
    <MarkdownView rendered={<MarkdownBody text={text} />} source={source} truncated={truncated} downloadHref={downloadHref} />
  );
}
