import { matchParts } from "./items";

export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = matchParts(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <mark className="rounded-[3px] bg-brand-mist text-brand">{parts[1]}</mark>
      {parts[2]}
    </>
  );
}
