"use client";

import type { ComponentProps } from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface MediaSliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  label: string;
  valueText?: string;
}

export function MediaSlider({ label, valueText, className, ...props }: MediaSliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn("group/slider relative flex h-8 touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-2">
        <SliderPrimitive.Range className="absolute h-full bg-text-2 group-hover/slider:bg-brand" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className="block size-3 rounded-full bg-text-1 shadow-[0_0_0_3px_var(--surface-1)] transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />
    </SliderPrimitive.Root>
  );
}
