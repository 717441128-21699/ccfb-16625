import { ATLAS_CELL_H, ATLAS_CELL_W, ATLAS_H, ATLAS_W, BLOCKS, GORES, type PatternId } from '../config';

export type DrawTool = 'free' | 'line' | 'rect' | 'text' | 'stamp' | 'eraser';

export interface PatternChangeDetail {
  gore?: number;
  all?: boolean;
}

const W = ATLAS_CELL_W;
const H = ATLAS_CELL_H;
const BH = H / BLOCKS;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function verticalText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, stroke = '#172033') {
  ctx.save();
  ctx.font = `900 ${size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(5, size * 0.08);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = color;
  Array.from(text).forEach((ch, i) => {
    const yy = y + i * size * 1.08;
    ctx.strokeText(ch, x, yy);
    ctx.fillText(ch, x, yy);
  });
  ctx.restore();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number) {
  let rot = -Math.PI / 2;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
  for (let i = 0; i < spikes; i++) {
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
  }
  ctx.closePath();
}

export function paintGore(ctx: CanvasRenderingContext2D, gore: number, id: PatternId) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (id === 'sky') {
    const alt = gore % 2 === 0;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, alt ? '#bfeaff' : '#8ed8ff');
    grad.addColorStop(0.55, alt ? '#2f9fe8' : '#1677c8');
    grad.addColorStop(1, '#0b4f91');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Diagonal racing bands, repeated on every gore.
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.22);
    const bands = ['#ff6b4a', '#ffd166', '#ffffff'];
    bands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = i === 2 ? 0.92 : 0.96;
      ctx.fillRect(-W * 2, -520 + i * 150, W * 4, i === 2 ? 46 : 82);
    });
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(W * 0.5, 610, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(W * 0.5, 610, 76, 0, Math.PI * 2);
    ctx.stroke();

    // Clouds.
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (const y of [360, 980, 1810]) {
      ctx.beginPath();
      ctx.arc(54, y, 28, 0, Math.PI * 2);
      ctx.arc(92, y - 14, 38, 0, Math.PI * 2);
      ctx.arc(136, y, 30, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, 42, y, 112, 34, 17);
      ctx.fill();
    }
    verticalText(ctx, '凌云', W / 2, 1210, 132, '#ffffff', '#083b70');
    ctx.font = '900 42px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe08a';
    ctx.strokeStyle = '#083b70';
    ctx.lineWidth = 7;
    ctx.strokeText('SKY-20', W / 2, 1660);
    ctx.fillText('SKY-20', W / 2, 1660);
  } else if (id === 'festival') {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#8f1020');
    grad.addColorStop(0.5, '#d9273e');
    grad.addColorStop(1, '#7a0c1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#f6c453';
    ctx.fillRect(0, 120, W, 22);
    ctx.fillRect(0, H - 180, W, 22);
    ctx.fillStyle = '#ffe7a3';
    ctx.fillRect(0, 154, W, 8);
    ctx.fillRect(0, H - 146, W, 8);

    for (let y = 260; y < H - 260; y += 210) {
      ctx.strokeStyle = 'rgba(246,196,83,.45)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(W / 2, y, 54, Math.PI * 0.1, Math.PI * 1.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W / 2, y + 34, 34, Math.PI * 1.1, Math.PI * 2.4);
      ctx.stroke();
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffd86b';
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.48, 82, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    verticalText(ctx, '福', W / 2, H * 0.48 - 72, 154, '#b5162b', '#7a0c1a');
    verticalText(ctx, '庆典', W / 2, H * 0.67, 76, '#ffe7a3', '#7a0c1a');
  } else if (id === 'geo') {
    ctx.fillStyle = '#0f3d4a';
    ctx.fillRect(0, 0, W, H);
    const palette = gore % 2 ? ['#ff8a3d', '#ffd166', '#2ec4b6'] : ['#2ec4b6', '#ffd166', '#ff6b6b'];
    for (let y = -80; y < H + 160; y += 180) {
      ctx.fillStyle = palette[Math.abs(Math.floor(y / 180) + gore) % palette.length];
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.lineTo(W - 14, y + 90);
      ctx.lineTo(W / 2, y + 180);
      ctx.lineTo(14, y + 90);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.82)';
      ctx.lineWidth = 7;
      ctx.stroke();

      ctx.fillStyle = '#172033';
      ctx.beginPath();
      ctx.moveTo(W / 2, y + 42);
      ctx.lineTo(W - 52, y + 90);
      ctx.lineTo(W / 2, y + 138);
      ctx.lineTo(52, y + 90);
      ctx.closePath();
      ctx.fill();
    }
    verticalText(ctx, 'GEOM', W / 2, 1080, 68, '#ffffff', '#0b2b35');
  } else {
    // Panda custom print: white cloth, bamboo edges, one friendly face per gore.
    ctx.fillStyle = '#f7faf7';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#58a55c';
    ctx.fillRect(0, 0, 18, H);
    ctx.fillRect(W - 18, 0, 18, H);
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 5;
    for (let y = 80; y < H; y += 180) {
      ctx.beginPath();
      ctx.moveTo(9, y);
      ctx.quadraticCurveTo(34, y - 28, 42, y - 58);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(42, y - 58, 12, 26, 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#66bb6a';
      ctx.fill();
    }

    const cy = H * 0.47;
    ctx.fillStyle = '#17191d';
    ctx.beginPath(); ctx.arc(52, cy - 118, 42, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 52, cy - 118, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(W / 2, cy, 84, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17191d';
    ctx.beginPath(); ctx.ellipse(66, cy - 18, 28, 38, -0.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(W - 66, cy - 18, 28, 38, 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(74, cy - 26, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 74, cy - 26, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17191d';
    ctx.beginPath(); ctx.ellipse(W / 2, cy + 28, 18, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#17191d';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(W / 2, cy + 38);
    ctx.quadraticCurveTo(W / 2 - 20, cy + 62, W / 2 - 38, cy + 48);
    ctx.moveTo(W / 2, cy + 38);
    ctx.quadraticCurveTo(W / 2 + 20, cy + 62, W / 2 + 38, cy + 48);
    ctx.stroke();
    verticalText(ctx, '团团', W / 2, cy + 250, 82, '#2e7d32', '#ffffff');
  }

  // Manufacturing block seams and station ticks.
  ctx.save();
  for (let b = 0; b <= BLOCKS; b++) {
    const y = b * BH;
    ctx.strokeStyle = b % 5 === 0 ? 'rgba(15,23,42,.58)' : 'rgba(15,23,42,.28)';
    ctx.lineWidth = b % 5 === 0 ? 2.2 : 1.1;
    ctx.setLineDash(b % 5 === 0 ? [] : [7, 5]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(15,23,42,.72)';
  ctx.font = '700 18px ui-monospace, monospace';
  ctx.textAlign = 'left';
  for (let b = 0; b <= BLOCKS; b += 5) {
    const y = Math.min(H - 8, b * BH + 20);
    ctx.fillText(`${60 - b}`, 6, y);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, 0); ctx.lineTo(8, H);
  ctx.moveTo(W - 8, 0); ctx.lineTo(W - 8, H);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

export class PatternStudio {
  readonly atlas: HTMLCanvasElement;
  readonly editor: HTMLCanvasElement;
  private actx: CanvasRenderingContext2D;
  private ectx: CanvasRenderingContext2D;
  selectedGore = 0;
  tool: DrawTool = 'free';
  color = '#ff3b6b';
  brushWidth = 8;
  text = '云';
  verticalText = true;
  grid = true;
  onChange: ((change: PatternChangeDetail) => void) | null = null;

  private drawing = false;
  private last = { x: 0, y: 0 };
  private start = { x: 0, y: 0 };
  private snapshot: ImageData | null = null;
  private boundMove: (e: PointerEvent) => void;
  private boundUp: (e: PointerEvent) => void;

  constructor(initial: PatternId = 'sky') {
    this.atlas = document.createElement('canvas');
    this.atlas.width = ATLAS_W;
    this.atlas.height = ATLAS_H;
    const a = this.atlas.getContext('2d', { willReadFrequently: true });
    if (!a) throw new Error('无法创建图案 Atlas 2D 上下文');
    this.actx = a;

    this.editor = document.createElement('canvas');
    this.editor.width = W;
    this.editor.height = H;
    const e = this.editor.getContext('2d', { willReadFrequently: true });
    if (!e) throw new Error('无法创建裁片编辑器上下文');
    this.ectx = e;

    this.paintAll(initial);
    this.loadGore(0, false);

    this.boundMove = (ev) => this.handleMove(ev);
    this.boundUp = () => this.handleUp();
  }

  paintAll(id: PatternId) {
    for (let g = 0; g < GORES; g++) {
      this.actx.save();
      this.actx.translate(g * W, 0);
      paintGore(this.actx, g, id);
      this.actx.restore();
    }
    this.loadGore(this.selectedGore, false);
    this.onChange?.({ all: true });
  }

  loadGore(g: number, commitCurrent = true) {
    if (commitCurrent) this.commitEditor(false);
    this.selectedGore = Math.max(0, Math.min(GORES - 1, g));
    this.ectx.clearRect(0, 0, W, H);
    this.ectx.drawImage(this.atlas, this.selectedGore * W, 0, W, H, 0, 0, W, H);
  }

  commitEditor(emit = true) {
    this.actx.clearRect(this.selectedGore * W, 0, W, H);
    this.actx.drawImage(this.editor, 0, 0);
    if (emit) this.onChange?.({ gore: this.selectedGore });
  }

  applyEditorToAll() {
    this.commitEditor(false);
    for (let g = 0; g < GORES; g++) {
      if (g === this.selectedGore) continue;
      this.actx.clearRect(g * W, 0, W, H);
      this.actx.drawImage(this.editor, g * W, 0, W, H);
    }
    this.onChange?.({ all: true });
  }

  clearCurrentMarks(pattern: PatternId) {
    this.actx.save();
    this.actx.translate(this.selectedGore * W, 0);
    paintGore(this.actx, this.selectedGore, pattern);
    this.actx.restore();
    this.loadGore(this.selectedGore, false);
    this.onChange?.({ gore: this.selectedGore });
  }

  attachPointer() {
    this.editor.addEventListener('pointerdown', (e) => this.handleDown(e));
    this.editor.addEventListener('pointermove', this.boundMove);
    window.addEventListener('pointerup', this.boundUp);
  }

  destroy() {
    window.removeEventListener('pointerup', this.boundUp);
    this.editor.onpointerdown = null;
  }

  private point(e: PointerEvent) {
    const r = this.editor.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H
    };
  }

  private handleDown(e: PointerEvent) {
    e.preventDefault();
    this.editor.setPointerCapture?.(e.pointerId);
    const p = this.point(e);
    this.start = p;
    this.last = p;
    this.drawing = true;
    this.snapshot = this.ectx.getImageData(0, 0, W, H);

    if (this.tool === 'text') {
      this.drawTextAt(p.x, p.y);
      this.drawing = false;
      this.commitEditor();
    } else if (this.tool === 'stamp') {
      this.drawStamp(p.x, p.y);
      this.drawing = false;
      this.commitEditor();
    } else if (this.tool === 'free' || this.tool === 'eraser') {
      this.strokeTo(p, p);
    }
  }

  private handleMove(e: PointerEvent) {
    if (!this.drawing) return;
    const p = this.point(e);
    if (this.tool === 'free' || this.tool === 'eraser') {
      this.strokeTo(this.last, p);
      this.last = p;
    } else if ((this.tool === 'line' || this.tool === 'rect') && this.snapshot) {
      this.ectx.putImageData(this.snapshot, 0, 0);
      this.ectx.save();
      this.ectx.strokeStyle = this.color;
      this.ectx.lineWidth = this.brushWidth;
      this.ectx.lineCap = 'round';
      if (this.tool === 'line') {
        this.ectx.beginPath();
        this.ectx.moveTo(this.start.x, this.start.y);
        this.ectx.lineTo(p.x, p.y);
        this.ectx.stroke();
      } else {
        this.ectx.strokeRect(this.start.x, this.start.y, p.x - this.start.x, p.y - this.start.y);
      }
      this.ectx.restore();
    }
  }

  private handleUp() {
    if (!this.drawing) return;
    this.drawing = false;
    this.snapshot = null;
    this.commitEditor();
  }

  private strokeTo(a: { x: number; y: number }, b: { x: number; y: number }) {
    const ctx = this.ectx;
    ctx.save();
    ctx.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.brushWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawTextAt(x: number, y: number) {
    const ctx = this.ectx;
    const size = Math.max(28, this.brushWidth * 7);
    ctx.save();
    ctx.font = `900 ${size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = size * 0.08;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = this.color;
    if (this.verticalText && Array.from(this.text).length <= 4) {
      Array.from(this.text).forEach((ch, i, arr) => {
        const yy = y + (i - (arr.length - 1) / 2) * size * 1.05;
        ctx.strokeText(ch, x, yy);
        ctx.fillText(ch, x, yy);
      });
    } else {
      ctx.strokeText(this.text.slice(0, 12), x, y);
      ctx.fillText(this.text.slice(0, 12), x, y);
    }
    ctx.restore();
  }

  private drawStamp(x: number, y: number) {
    const ctx = this.ectx;
    const r = this.brushWidth * 4 + 24;
    ctx.save();
    drawStar(ctx, x, y, 5, r, r * 0.45);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = this.color;
    ctx.stroke();
    ctx.restore();
  }
}
