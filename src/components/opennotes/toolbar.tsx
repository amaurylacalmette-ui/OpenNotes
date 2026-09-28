"use client";

/**
 * GoodNotes-style floating tool rail: undo/redo, tools, ink presets,
 * page navigation. Wraps safely on narrow screens.
 */
import {
  Pen,
  Highlighter,
  Zap,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Spline,
  Lasso,
  Type,
  ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ERASER_SIZES,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_SIZES,
  INK_COLORS,
  PEN_SIZES,
  TEXT_SIZES,
  type ToolId,
} from "@/lib/opennotes/types";

export interface ToolState {
  tool: ToolId;
  penColor: string;
  penSize: number;
  highlighterColor: string;
  highlighterSize: number;
  eraserSize: number;
  textSize: number;
}

interface ToolbarProps {
  state: ToolState;
  onChange: (patch: Partial<ToolState>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  pageIndex: number;
  pageCount: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onAddPage: () => void;
  onImagePick: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { state, onChange } = props;
  const isEraser = state.tool === "eraser-precise" || state.tool === "eraser-stroke";
  const showColor =
    state.tool === "pen" ||
    state.tool === "highlighter" ||
    state.tool === "shape" ||
    state.tool === "text";
  const showSize =
    state.tool === "pen" ||
    state.tool === "highlighter" ||
    state.tool === "shape" ||
    state.tool === "text" ||
    isEraser;

  const currentColor =
    state.tool === "highlighter" ? state.highlighterColor : state.penColor;
  const currentSizes =
    state.tool === "highlighter"
      ? HIGHLIGHTER_SIZES
      : state.tool === "text"
        ? TEXT_SIZES
        : isEraser
          ? ERASER_SIZES
          : PEN_SIZES;
  const currentSize = isEraser
    ? state.eraserSize
    : state.tool === "highlighter"
      ? state.highlighterSize
      : state.tool === "text"
        ? state.textSize
        : state.penSize;

  const setSize = (s: number) => {
    if (isEraser) onChange({ eraserSize: s });
    else if (state.tool === "highlighter") onChange({ highlighterSize: s });
    else if (state.tool === "text") onChange({ textSize: s });
    else onChange({ penSize: s });
  };

  return (
    <div
      className="pointer-events-auto mx-auto flex max-w-[min(96vw,820px)] flex-wrap items-center justify-center gap-1 rounded-2xl border border-[#3f3226]/40 bg-[#33291d]/95 px-2 py-1.5 shadow-xl backdrop-blur"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom) * 0.4)" }}
      role="toolbar"
      aria-label="Drawing tools"
    >
      {/* history */}
      <TBtn label="Undo (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo}>
        <Undo2 className="size-[18px]" />
      </TBtn>
      <TBtn label="Redo (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo}>
        <Redo2 className="size-[18px]" />
      </TBtn>

      <Divider />

      {/* tools */}
      <TBtn
        label="Pen (P)"
        active={state.tool === "pen"}
        onClick={() => onChange({ tool: "pen" })}
      >
        <Pen className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Highlighter (H)"
        active={state.tool === "highlighter"}
        onClick={() => onChange({ tool: "highlighter" })}
      >
        <Highlighter className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Eraser (E / S)"
        active={isEraser}
        onClick={() => onChange({ tool: "eraser-precise" })}
      >
        <EraserPreciseIcon />
      </TBtn>
      <TBtn
        label="Shape snap (R)"
        active={state.tool === "shape"}
        onClick={() => onChange({ tool: "shape" })}
      >
        <Spline className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Text box (T)"
        active={state.tool === "text"}
        onClick={() => onChange({ tool: "text" })}
      >
        <Type className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Insert image (I)"
        active={false}
        onClick={props.onImagePick}
      >
        <ImagePlus className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Lasso / select (V)"
        active={state.tool === "lasso"}
        onClick={() => onChange({ tool: "lasso" })}
      >
        <Lasso className="size-[18px]" />
      </TBtn>
      <TBtn
        label="Laser pointer (L)"
        active={state.tool === "laser"}
        onClick={() => onChange({ tool: "laser" })}
      >
        <Zap className="size-[18px]" />
      </TBtn>

      <Divider />

      {/* color */}
      {showColor && (
        <Popover>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-xl"
                  aria-label="Ink color"
                >
                  <span
                    className="size-[18px] rounded-full border border-white/40 shadow-inner"
                    style={{ background: currentColor }}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Ink color</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-auto p-3 bg-[#fffdf7] rounded-xl" side="top" align="center">
            <ColorGrid
              colors={state.tool === "highlighter" ? HIGHLIGHTER_COLORS : INK_COLORS}
              value={currentColor}
              onPick={(c) =>
                onChange(state.tool === "highlighter" ? { highlighterColor: c } : { penColor: c })
              }
            />
          </PopoverContent>
        </Popover>
      )}

      {/* size */}
      {showSize && (
        <Popover>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-xl"
                  aria-label="Stroke width"
                >
                  <SizeDot size={currentSize} max={Math.max(...currentSizes)} />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Stroke width</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-auto p-3 bg-[#fffdf7] rounded-xl" side="top" align="center">
            <div className="flex items-end gap-2">
              {currentSizes.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  aria-label={`Width ${s}`}
                  aria-pressed={currentSize === s}
                  className={`flex h-12 w-10 items-center justify-center rounded-lg transition-colors ${
                    currentSize === s ? "bg-[#efe3cd] ring-1 ring-[#b09468]" : "hover:bg-[#f5efe2]"
                  }`}
                >
                  <span
                    className="rounded-full bg-[#33291d]"
                    style={{
                      width: Math.min(26, Math.max(4, s)),
                      height: Math.min(26, Math.max(4, s)),
                    }}
                  />
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      <Divider />

      {/* pages */}
      <TBtn label="Previous page" disabled={props.pageIndex <= 0} onClick={props.onPrevPage}>
        <ChevronLeft className="size-[18px]" />
      </TBtn>
      <span
        className="min-w-[3.2rem] text-center text-xs font-semibold text-[#e8d9c2] tabular-nums select-none"
        aria-label={`Page ${props.pageIndex + 1} of ${props.pageCount}`}
      >
        {props.pageIndex + 1}/{props.pageCount}
      </span>
      <TBtn
        label="Next page"
        disabled={props.pageIndex >= props.pageCount - 1}
        onClick={props.onNextPage}
      >
        <ChevronRight className="size-[18px]" />
      </TBtn>
      <TBtn label="Add page" onClick={props.onAddPage}>
        <FilePlus2 className="size-[18px]" />
      </TBtn>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" aria-hidden="true" />;
}

function TBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={`size-9 rounded-xl text-[#e8d9c2] hover:bg-white/10 hover:text-white disabled:opacity-30 ${
            active ? "bg-[#c9973b] text-[#33291d] hover:bg-[#d8a54b] hover:text-[#33291d]" : ""
          }`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ColorGrid({
  colors,
  value,
  onPick,
}: {
  colors: readonly string[];
  value: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Ink colors">
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          onClick={() => onPick(c)}
          className={`size-8 rounded-full border transition-transform ${
            value === c ? "ring-2 ring-[#8a5a32] ring-offset-2 ring-offset-[#fffdf7] scale-105" : "hover:scale-105"
          }`}
          style={{ background: c, borderColor: "rgba(0,0,0,0.15)" }}
        />
      ))}
    </div>
  );
}

function SizeDot({ size, max }: { size: number; max: number }) {
  const d = 5 + (size / max) * 13;
  return (
    <span className="flex size-[18px] items-center justify-center">
      <span className="rounded-full bg-current" style={{ width: d, height: d }} />
    </span>
  );
}

/* custom icon for the eraser mode */

function EraserPreciseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <circle cx="11" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
