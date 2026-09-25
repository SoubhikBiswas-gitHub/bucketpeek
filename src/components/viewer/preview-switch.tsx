import { downloadHref } from "@/lib/paths";
import type { ViewData } from "@/lib/types";
import { PreviewStage } from "./preview-stage";
import { AudioPlayer } from "./renderers/audio-player";
import { CodeViewer } from "./renderers/code-viewer";
import { ImageViewer } from "./renderers/image-viewer";
import { JsonViewer } from "./renderers/json-viewer";
import { MarkdownViewer } from "./renderers/markdown-viewer";
import { NoPreview } from "./renderers/no-preview";
import { PdfViewer } from "./renderers/pdf-viewer";
import { PreviewError } from "./renderers/preview-error";
import { TableViewer } from "./renderers/table-viewer";
import { VideoPlayer } from "./renderers/video-player";

export function PreviewSwitch({ data }: { data: ViewData }) {
  const { file, preview } = data;
  return (
    <PreviewStage kind={preview.type} label={`Preview of ${file.name}`}>
      <Renderer data={data} />
    </PreviewStage>
  );
}

function Renderer({ data }: { data: ViewData }) {
  const { file, preview } = data;
  const dl = downloadHref(file.key);

  switch (preview.type) {
    case "video":
      return (
        <VideoPlayer
          fileKey={file.key}
          name={file.name}
          type={file.type}
          url={preview.url}
          mode={preview.mode}
          canConvert={preview.canConvert}
          streamReason={preview.streamReason}
          why={preview.why}
          downloadHref={dl}
        />
      );
    case "image":
      return <ImageViewer url={preview.url} name={file.name} />;
    case "audio":
      return <AudioPlayer url={preview.url} name={file.name} size={file.size} />;
    case "pdf":
      return <PdfViewer url={preview.url} name={file.name} />;
    case "markdown":
      return <MarkdownViewer text={preview.text} truncated={preview.truncated} downloadHref={dl} />;
    case "json":
      return <JsonViewer text={preview.text} truncated={preview.truncated} downloadHref={dl} />;
    case "code":
    case "text":
      return (
        <CodeViewer text={preview.text} lang={preview.lang} truncated={preview.truncated} name={file.name} downloadHref={dl} />
      );
    case "table":
      return (
        <TableViewer
          header={preview.header}
          rows={preview.rows}
          truncated={preview.truncated}
          rowsTruncated={preview.rowsTruncated}
          downloadHref={dl}
        />
      );
    case "error":
      return <PreviewError title={preview.title} message={preview.message} downloadHref={dl} />;
    case "none":
      return <NoPreview file={file} downloadHref={dl} />;
  }
}
