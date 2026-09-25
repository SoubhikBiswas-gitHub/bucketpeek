import { CodeView } from "@/components/viewer/documents/code-view";
import { prepareCode } from "@/components/viewer/documents/highlight";
import "@/components/viewer/documents/syntax.css";

export interface CodeViewerProps {
  text: string;
  // Shiki language id, or "" for plain text.
  lang: string;
  truncated: boolean;
  name: string;
  downloadHref: string;
}

export async function CodeViewer({ text, lang, truncated, name, downloadHref }: CodeViewerProps) {
  const isLog = lang === "log" || /\.log(\.\d+)?$/i.test(name);
  const data = await prepareCode(text, lang, { log: isLog });
  return <CodeView data={data} name={name} truncated={truncated} downloadHref={downloadHref} />;
}
