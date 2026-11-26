import { BLOCKS_PER_GORE, GORE_COUNT, type PatternId } from '../balloon/model';

export const GORE_PIXEL_WIDTH = 100;
export const BLOCK_PIXEL_HEIGHT = 26;
export const PATTERN_WIDTH = GORE_COUNT * GORE_PIXEL_WIDTH;
export const PATTERN_HEIGHT = BLOCKS_PER_GORE * BLOCK_PIXEL_HEIGHT;

export type DrawTool = 'brush' | 'line' | 'eraser' | 'text';

export interface PatternEditorOptions {
  canvas: HTMLCanvasElement;
  onChange?: () => void;
}

export class PatternEditor {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly sourceCanvas: HTMLCanvasElement;
  private readonly art: CanvasRenderingContext2D;
  onChange?: () => void;

  tool: DrawTool = 'brush';
  color = '#e53935';
  brushSize = 8;
  symmetry = true;
  showGrid = true;
  text = '云帆 AERO';
  selectedGore = 0;

  private drawing = false;
  private last = { x: 0, y: 0 };
  private lineStart = { x: 0, y: 0 };
  private snapshot: ImageData | null = null;

  constructor(options: PatternEditorOptions) {
    this.canvas = options.canvas;
    this.onChange = options.onChange;
    this.canvas.width = PATTERN_WIDTH;
    this.canvas.height = PATTERN_HEIGHT;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = PATTERN_WIDTH;
    this.sourceCanvas.height = PATTERN_HEIGHT;
    const art = this.sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!art) throw new Error('Offscreen pattern context unavailable');
    this.art = art;
    this.art.lineCap = 'round';
    this.art.lineJoin = 'round';

    this.loadPreset('regatta');
    this.bindEvents();
  }

  get textureSource(): HTMLCanvasElement {
    return this.sourceCanvas;
  }

  private emitChange() {
    this.render();
    this.onChange?.();
  }

  loadPreset(id: PatternId) {
    const ctx = this.art;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f7f3e8';
    ctx.fillRect(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);

    if (id === 'regatta') this.drawRegatta();
    if (id === 'checker') this.drawChecker();
    if (id === 'sun') this.drawSun();
    if (id === 'flame') this.drawFlame();
    if (id === 'custom') this.drawChecker();

    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#172033';
    ctx.lineWidth = 1;
    for (let y = 0; y < PATTERN_HEIGHT; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PATTERN_WIDTH, y + 0.5);
      ctx.stroke();
    }
    for (let x = 0; x < PATTERN_WIDTH; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, PATTERN_HEIGHT);
      ctx.stroke();
    }
    ctx.restore();
    this.emitChange();
  }

  private drawRegatta() {
    const colors = ['#0f4c81', '#f97316', '#f7f3e8', '#0e7490'];
    for (let g = 0; g < GORE_COUNT; g++) {
      this.art.fillStyle = colors[g % colors.length];
      this.art.fillRect(g * GORE_PIXEL_WIDTH, 0, GORE_PIXEL_WIDTH, PATTERN_HEIGHT);
    }
    this.art.fillStyle = '#fbbf24';
    for (let b = 5; b < BLOCKS_PER_GORE; b += 10) {
      this.art.fillRect(0, b * BLOCK_PIXEL_HEIGHT, PATTERN_WIDTH, BLOCK_PIXEL_HEIGHT * 2);
    }
    this.art.fillStyle = 'rgba(255,255,255,.92)';
    for (let g = 1; g < GORE_COUNT; g += 4) {
      const x = (g + 0.5) * GORE_PIXEL_WIDTH;
      const y = PATTERN_HEIGHT * 0.38;
      this.art.beginPath();
      this.art.arc(x, y, 34, 0, Math.PI * 2);
      this.art.fill();
      this.art.fillStyle = '#0f4c81';
      this.art.font = 'bold 28px system-ui, sans-serif';
      this.art.textAlign = 'center';
      this.art.textBaseline = 'middle';
      this.art.fillText('A', x, y + 2);
      this.art.fillStyle = 'rgba(255,255,255,.92)';
    }
  }

  private drawChecker() {
    for (let g = 0; g < GORE_COUNT; g++) {
      for (let b = 0; b < BLOCKS_PER_GORE; b++) {
        const odd = (g + Math.floor(b / 2)) % 2;
        this.art.fillStyle = odd ? '#f97316' : '#0f3d63';
        this.art.fillRect(
          g * GORE_PIXEL_WIDTH,
          b * BLOCK_PIXEL_HEIGHT,
          GORE_PIXEL_WIDTH,
          BLOCK_PIXEL_HEIGHT,
        );
      }
    }
    this.art.fillStyle = '#f8fafc';
    this.art.fillRect(0, PATTERN_HEIGHT * 0.43, PATTERN_WIDTH, 72);
    this.art.fillStyle = '#be123c';
    this.art.font = '900 46px system-ui, sans-serif';
    this.art.textAlign = 'center';
    this.art.textBaseline = 'middle';
    this.art.fillText('直线校准  STRAIGHT LINE', PATTERN_WIDTH / 2, PATTERN_HEIGHT * 0.43 + 38);

    // Deliberate crisp straight test lines used by the inspection page.
    this.art.strokeStyle = '#fde047';
    this.art.lineWidth = 7;
    for (const fraction of [0.22, 0.58, 0.82]) {
      const y = fraction * PATTERN_HEIGHT;
      this.art.beginPath();
      this.art.moveTo(0, y);
      this.art.lineTo(PATTERN_WIDTH, y);
      this.art.stroke();
    }
    this.art.strokeStyle = '#ffffff';
    this.art.lineWidth = 4;
    for (let g = 0; g < GORE_COUNT; g += 2) {
      const x = (g + 0.5) * GORE_PIXEL_WIDTH;
      this.art.beginPath();
      this.art.moveTo(x, 0);
      this.art.lineTo(x, PATTERN_HEIGHT);
      this.art.stroke();
    }
  }

  private drawSun() {
    const grad = this.art.createLinearGradient(0, 0, 0, PATTERN_HEIGHT);
    grad.addColorStop(0, '#1e3a8a');
    grad.addColorStop(0.55, '#0284c7');
    grad.addColorStop(1, '#f97316');
    this.art.fillStyle = grad;
    this.art.fillRect(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);

    const cx = PATTERN_WIDTH / 2;
    const cy = PATTERN_HEIGHT * 0.39;
    this.art.save();
    this.art.translate(cx, cy);
    for (let i = 0; i < 24; i++) {
      this.art.rotate(Math.PI / 12);
      this.art.fillStyle = i % 2 ? '#fbbf24' : '#fb923c';
      this.art.beginPath();
      this.art.moveTo(0, -58);
      this.art.lineTo(22, -210);
      this.art.lineTo(-22, -210);
      this.art.closePath();
      this.art.fill();
    }
    this.art.fillStyle = '#fde047';
    this.art.beginPath();
    this.art.arc(0, 0, 118, 0, Math.PI * 2);
    this.art.fill();
    this.art.fillStyle = '#b45309';
    this.art.font = '900 118px system-ui, sans-serif';
    this.art.textAlign = 'center';
    this.art.textBaseline = 'middle';
    this.art.fillText('云帆', 0, 8);
    this.art.restore();

    this.art.fillStyle = '#ffffff';
    this.art.font = '900 82px system-ui, sans-serif';
    this.art.textAlign = 'center';
    this.art.fillText('YUNFAN AIR', cx, PATTERN_HEIGHT * 0.62);
    this.art.font = '700 34px system-ui, sans-serif';
    this.art.fillText('CUSTOM SHAPE STUDIO · 20 GORES · 1200 CLOTH PANELS', cx, PATTERN_HEIGHT * 0.67);
  }

  private drawFlame() {
    this.art.fillStyle = '#111827';
    this.art.fillRect(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);
    for (let g = 0; g < GORE_COUNT; g++) {
      const x0 = g * GORE_PIXEL_WIDTH;
      this.art.fillStyle = g % 2 ? '#dc2626' : '#f97316';
      this.art.beginPath();
      this.art.moveTo(x0, PATTERN_HEIGHT);
      for (let y = PATTERN_HEIGHT; y > PATTERN_HEIGHT * 0.15; y -= 70) {
        this.art.lineTo(x0 + GORE_PIXEL_WIDTH * 0.5, y - 42);
        this.art.lineTo(x0 + GORE_PIXEL_WIDTH, y - 84);
      }
      this.art.lineTo(x0 + GORE_PIXEL_WIDTH, PATTERN_HEIGHT);
      this.art.closePath();
      this.art.fill();

      this.art.strokeStyle = '#fde047';
      this.art.lineWidth = 8;
      this.art.beginPath();
      for (let b = 0; b <= BLOCKS_PER_GORE; b += 2) {
        const y = b * BLOCK_PIXEL_HEIGHT;
        const x = x0 + GORE_PIXEL_WIDTH * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(b * 0.55)));
        if (b === 0) this.art.moveTo(x, y);
        else this.art.lineTo(x, y);
      }
      this.art.stroke();
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);
    ctx.drawImage(this.sourceCanvas, 0, 0);
    if (!this.showGrid) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(15,23,42,.30)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= GORE_COUNT; g++) {
      const x = g * GORE_PIXEL_WIDTH + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PATTERN_HEIGHT);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(15,23,42,.17)';
    for (let b = 0; b <= BLOCKS_PER_GORE; b++) {
      const y = b * BLOCK_PIXEL_HEIGHT + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PATTERN_WIDTH, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(220,38,38,.95)';
    ctx.lineWidth = 4;
    const sx = this.selectedGore * GORE_PIXEL_WIDTH;
    ctx.strokeRect(sx + 2, 2, GORE_PIXEL_WIDTH - 4, PATTERN_HEIGHT - 4);
    ctx.restore();
  }

  clear() {
    this.art.save();
    this.art.globalCompositeOperation = 'source-over';
    this.art.fillStyle = '#f8fafc';
    this.art.fillRect(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);
    this.art.restore();
    this.emitChange();
  }

  private eventToPattern(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PATTERN_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * PATTERN_HEIGHT;
    return {
      x: Math.max(0, Math.min(PATTERN_WIDTH, x)),
      y: Math.max(0, Math.min(PATTERN_HEIGHT, y)),
    };
  }

  private bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = this.eventToPattern(e);
      this.drawing = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.last = p;
      this.lineStart = p;
      this.snapshot = this.art.getImageData(0, 0, PATTERN_WIDTH, PATTERN_HEIGHT);

      if (this.tool === 'brush' || this.tool === 'eraser') {
        this.strokeSegment(p, p);
      } else if (this.tool === 'text') {
        this.putText(p.x, p.y);
        this.drawing = false;
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      const p = this.eventToPattern(e);
      if (this.tool === 'brush' || this.tool === 'eraser') {
        this.strokeSegment(this.last, p);
        this.last = p;
      } else if (this.tool === 'line' && this.snapshot) {
        this.art.putImageData(this.snapshot, 0, 0);
        this.drawLine(this.lineStart, p, false);
        this.render();
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.drawing) return;
      const p = this.eventToPattern(e);
      if (this.tool === 'line') this.drawLine(this.lineStart, p, true);
      this.drawing = false;
      this.snapshot = null;
      this.emitChange();
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  private configureStroke() {
    this.art.lineCap = 'round';
    this.art.lineJoin = 'round';
    this.art.lineWidth = this.brushSize;
    this.art.strokeStyle = this.tool === 'eraser' ? '#f8fafc' : this.color;
    this.art.fillStyle = this.tool === 'eraser' ? '#f8fafc' : this.color;
    this.art.globalCompositeOperation = 'source-over';
  }

  private goreOffset(x: number, g: number) {
    const sourceGore = Math.floor(x / GORE_PIXEL_WIDTH);
    return (g - sourceGore) * GORE_PIXEL_WIDTH;
  }

  private strokeSegment(a: { x: number; y: number }, b: { x: number; y: number }) {
    this.configureStroke();
    if (this.symmetry) {
      for (let g = 0; g < GORE_COUNT; g++) {
        const dx = this.goreOffset(a.x, g);
        this.art.beginPath();
        this.art.moveTo(a.x + dx, a.y);
        this.art.lineTo(b.x + dx, b.y);
        this.art.stroke();
      }
    } else {
      this.art.beginPath();
      this.art.moveTo(a.x, a.y);
      this.art.lineTo(b.x, b.y);
      this.art.stroke();
    }
    this.emitChange();
  }

  private drawLine(a: { x: number; y: number }, b: { x: number; y: number }, commit: boolean) {
    this.configureStroke();
    if (this.symmetry) {
      for (let g = 0; g < GORE_COUNT; g++) {
        const dx = this.goreOffset(a.x, g);
        this.art.beginPath();
        this.art.moveTo(a.x + dx, a.y);
        this.art.lineTo(b.x + dx, b.y);
        this.art.stroke();
      }
    } else {
      this.art.beginPath();
      this.art.moveTo(a.x, a.y);
      this.art.lineTo(b.x, b.y);
      this.art.stroke();
    }
    if (commit) this.emitChange();
  }

  putText(x: number, y: number) {
    this.configureStroke();
    this.art.font = `900 ${Math.max(28, this.brushSize * 5)}px system-ui, sans-serif`;
    this.art.textAlign = 'center';
    this.art.textBaseline = 'middle';
    if (this.symmetry) {
      for (let g = 0; g < GORE_COUNT; g++) {
        const dx = this.goreOffset(x, g);
        this.art.fillText(this.text, x + dx, y);
      }
    } else {
      this.art.fillText(this.text, x, y);
    }
    this.emitChange();
  }

  exportPng(): string {
    return this.sourceCanvas.toDataURL('image/png');
  }
}
