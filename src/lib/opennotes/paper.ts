/**
 * Paper template rendering. Each template is drawn once onto the paper
 * canvas at backing-store resolution and cached until zoom changes.
 */
import { PAGE_HEIGHT, PAGE_WIDTH, type PaperTemplate } from "./types";

export const PAPER_TEMPLATES: { id: PaperTemplate; label: string }[] = [
  { id: "blank", label: "Blank" },
  { id: "lined", label: "Lined" },
  { id: "grid", label: "Grid" },
  { id: "dotted", label: "Dotted" },
];

const PAPER_FILL = "#fdfbf5";
const PAPER_EDGE = "#f0e8d8";
const LINE_COLOR = "#d9cfc0";
const LINE_STRONG = "#c9bda9";

/**
 * Paint the paper background + template pattern.
 * `scale` is the total device scale (dpr * zoom) the canvas is rendered at.
 */
export function drawPaper(
  ctx: CanvasRenderingContext2D,
  template: PaperTemplate,
  scale: number
): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = PAPER_FILL;
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  // subtle edge vignette to sell the "sheet on a desk" feel
  const grad = ctx.createLinearGradient(0, 0, 0, PAGE_HEIGHT);
  grad.addColorStop(0, "rgba(120, 96, 60, 0.05)");
  grad.addColorStop(0.08, "rgba(120, 96, 60, 0)");
  grad.addColorStop(0.92, "rgba(120, 96, 60, 0)");
  grad.addColorStop(1, "rgba(120, 96, 60, 0.06)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  ctx.strokeStyle = LINE_COLOR;
  ctx.fillStyle = LINE_COLOR;
  ctx.lineWidth = 1;

  switch (template) {
    case "lined": {
      const gap = 48;
      // header band
      ctx.strokeStyle = LINE_STRONG;
      ctx.beginPath();
      ctx.moveTo(72, 150);
      ctx.lineTo(PAGE_WIDTH - 72, 150);
      ctx.stroke();
      ctx.strokeStyle = LINE_COLOR;
      ctx.beginPath();
      for (let y = 150 + gap; y <= PAGE_HEIGHT - 60; y += gap) {
        ctx.moveTo(72, y);
        ctx.lineTo(PAGE_WIDTH - 72, y);
      }
      ctx.stroke();
      // punch holes like a real sheet
      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (const hy of [PAGE_HEIGHT * 0.25, PAGE_HEIGHT * 0.5, PAGE_HEIGHT * 0.75]) {
        ctx.beginPath();
        ctx.arc(46, hy, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "grid": {
      const gap = 40;
      ctx.strokeStyle = LINE_COLOR;
      ctx.beginPath();
      for (let x = 40; x <= PAGE_WIDTH - 40; x += gap) {
        ctx.moveTo(x, 40);
        ctx.lineTo(x, PAGE_HEIGHT - 40);
      }
      for (let y = 40; y <= PAGE_HEIGHT - 40; y += gap) {
        ctx.moveTo(40, y);
        ctx.lineTo(PAGE_WIDTH - 40, y);
      }
      ctx.stroke();
      break;
    }
    case "dotted": {
      const gap = 40;
      ctx.fillStyle = LINE_STRONG;
      const r = Math.max(1.1, 1.4 / Math.max(1, scale / 2));
      for (let y = 60; y <= PAGE_HEIGHT - 60; y += gap) {
        for (let x = 60; x <= PAGE_WIDTH - 60; x += gap) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "blank":
    default:
      break;
  }

  // faint rounded border (PAPER_EDGE)
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, PAGE_WIDTH - 2, PAGE_HEIGHT - 2);
  ctx.restore();
}
