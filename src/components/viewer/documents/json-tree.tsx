"use client";

import { memo } from "react";
import JsonView from "@uiw/react-json-view";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface JsonTreeProps {
  value: object;
  // Depth that starts collapsed (1 = only the root open); false expands everything.
  collapsed: number | false;
}

// The library's toggles are plain spans, so the arrow is re-rendered as a focusable button.
export const JsonTree = memo(function JsonTree({ value, collapsed }: JsonTreeProps) {
  return (
    <JsonView
      value={value}
      collapsed={collapsed}
      displayDataTypes={false}
      displayObjectSize
      enableClipboard
      highlightUpdates={false}
      shortenTextAfterLength={160}
      indentWidth={20}
      className="lens-json-tree"
      style={{ backgroundColor: "transparent", lineHeight: "22px", fontSize: 13 }}
    >
      <JsonView.Arrow
        render={({ style }) => {
          const isCollapsed = String(style?.transform ?? "").includes("-90");
          return (
            <span
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "Expand" : "Collapse"}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  // The library listens for clicks on the row; forward the key press to it.
                  e.currentTarget.click();
                }
              }}
              className="mr-1 inline-grid size-5 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand"
            >
              <ChevronDown
                aria-hidden
                className={cn("size-3.5 transition-transform duration-150", isCollapsed && "-rotate-90")}
              />
            </span>
          );
        }}
      />
    </JsonView>
  );
});
