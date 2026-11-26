import { PatternEditor } from '../editor/patternEditor';
import {
  BLOCKS_PER_GORE,
  GORE_COUNT,
  SHAPE_PRESETS,
  coldTimeline,
  evaluateContour,
  getShape,
  mechanicsAt,
  type ShapeId,
  type SolverParams,
  type StrainView,
  type ViewMode,
} from '../balloon/model';
import { WebGpuBalloonRenderer, type CameraPreset } from '../gpu/renderer';

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing UI element: ${selector}`);
  return el;
};

const fmt = (v: number, digits = 2) => v.toFixed(digits);

export class BalloonApp {
  private editor!: PatternEditor;
  private renderer: WebGpuBalloonRenderer | null = null;
  private gpuCanvas: HTMLCanvasElement;
  private gpuReady = false;
  private gpuError: string | null = null;

  private view: ViewMode = 'pattern';
  private basePressure = 240;
  private coldProgress = 0;
  private coldPlaying = true;
  private coldSpeed = 1;
  private lastTime = performance.now();
  private metricsAccumulator = 0;

  private checkT = 0.55;
  private checkGore = 9;

  private params: SolverParams = {
    shape: getShape('classic'),
    pressure: 240,
    fabricStiffness: 260_000,
    tapeStiffness: 2_500_000,
    inflation: 1,
    erection: 1,
    time: 0,
    bulgeScale: 1,
    flame: 0,
    strainView: 0,
    showTapes: true,
    showWireframe: false,
  };

  constructor() {
    this.gpuCanvas = document.createElement('canvas');
    this.gpuCanvas.setAttribute('aria-label', 'WebGPU 热气球视图');
    this.initPatternEditor();
    this.renderShapeCards();
    this.bindTabs();
    this.bindPatternControls();
    this.bindShapeControls();
    this.bindColdControls();
    this.bindCheckControls();
    this.bindCameraButtons();
    this.updateAllReadouts();
    this.initGpu();
    requestAnimationFrame(this.loop);
  }

  private initPatternEditor() {
    const canvas = $<HTMLCanvasElement>('#pattern-canvas');
    this.editor = new PatternEditor({
      canvas,
      onChange: () => this.renderer?.updatePattern(this.editor.textureSource),
    });
  }

  private async initGpu() {
    const badge = $('#gpu-badge');
    const initialMount = document.querySelector('[data-mount="shape"]');
    initialMount?.appendChild(this.gpuCanvas);

    try {
      this.renderer = await WebGpuBalloonRenderer.create(
        this.gpuCanvas,
        this.editor.textureSource,
      );
      this.gpuReady = true;
      badge.textContent = 'WebGPU Compute + Render · 在线';
      badge.classList.remove('error');
      this.moveCanvasToMount(this.view);
    } catch (error) {
      this.gpuError = error instanceof Error ? error.message : String(error);
      badge.textContent = 'WebGPU 不可用';
      badge.classList.add('error');
      this.showGpuError();
    }
  }

  private showGpuError() {
    const message =
      this.gpuError ?? 'WebGPU 初始化失败。请使用最新版 Chrome/Edge，并确认硬件加速已开启。';
    document.querySelectorAll<HTMLElement>('.gpu-mount').forEach((mount) => {
      if (mount.querySelector('.webgpu-error')) return;
      const div = document.createElement('div');
      div.className = 'webgpu-error';
      div.innerHTML = `<div><h3>无法启动 WebGPU</h3><p>${message}</p><p class="tiny">界面参数、理论轮廓和变形复核仍可使用；几何与渲染 compute 路径需要 WebGPU。</p></div>`;
      mount.appendChild(div);
    });
  }

  private moveCanvasToMount(view: ViewMode) {
    if (!this.gpuReady || !this.renderer) return;
    if (view === 'pattern') return;
    const mount = document.querySelector(`[data-mount="${view}"]`);
    if (mount && this.gpuCanvas.parentElement !== mount) {
      mount.appendChild(this.gpuCanvas);
      this.renderer.resize();
    }
  }

  private bindTabs() {
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.view as ViewMode;
        this.setView(view);
      });
    });
  }

  private setView(view: ViewMode) {
    this.view = view;
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.view === view);
    });
    document.querySelectorAll('.page').forEach((p) => {
      p.classList.toggle('active', (p as HTMLElement).dataset.page === view);
    });
    this.moveCanvasToMount(view);

    if (view === 'shape') {
      this.params.inflation = 1;
      this.params.erection = 1;
      this.params.flame = 0;
      this.params.pressure = this.basePressure;
      this.renderer?.setCameraPreset('ground');
    } else if (view === 'cold') {
      this.coldPlaying = true;
      $('#cold-play').textContent = '暂停';
      this.renderer?.setCameraPreset('ground');
    } else if (view === 'check') {
      this.params.inflation = 1;
      this.params.erection = 1;
      this.params.flame = 0;
      this.params.pressure = this.basePressure;
      this.renderer?.setCameraPreset('inspect');
      this.drawSagChart();
    }
  }

  private renderShapeCards() {
    const root = $('#shape-cards');
    root.innerHTML = SHAPE_PRESETS.map(
      (s) => `
      <button class="shape-card ${s.id === this.params.shape.id ? 'active' : ''}" data-shape="${s.id}">
        <b>${s.name}</b>
        <span>${s.description}</span>
      </button>`,
    ).join('');
    root.querySelectorAll<HTMLButtonElement>('[data-shape]').forEach((button) => {
      button.addEventListener('click', () => this.selectShape(button.dataset.shape as ShapeId));
    });

    document.querySelectorAll<HTMLButtonElement>('[data-shape-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectShape(button.dataset.shapeJump as ShapeId);
        this.setView('shape');
      });
    });
  }

  private selectShape(id: ShapeId) {
    this.params.shape = getShape(id);
    document.querySelectorAll('[data-shape]').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.shape === id);
    });
    document.querySelectorAll('[data-shape-jump]').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.shapeJump === id);
    });
    this.updateAllReadouts();
  }

  private bindPatternControls() {
    document.querySelectorAll<HTMLButtonElement>('[data-pattern]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.pattern as Parameters<PatternEditor['loadPreset']>[0];
        document.querySelectorAll('[data-pattern]').forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
        this.editor.loadPreset(id);
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.editor.tool = button.dataset.tool as typeof this.editor.tool;
        document.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
      });
    });

    const color = $<HTMLInputElement>('#brush-color');
    color.addEventListener('input', () => {
      this.editor.color = color.value;
      $('#color-value').textContent = color.value;
    });

    const size = $<HTMLInputElement>('#brush-size');
    size.addEventListener('input', () => {
      this.editor.brushSize = Number(size.value);
      $('#brush-size-value').textContent = `${size.value} px`;
    });

    const text = $<HTMLInputElement>('#text-input');
    text.addEventListener('input', () => {
      this.editor.text = text.value;
    });

    const symmetry = $<HTMLInputElement>('#symmetry');
    symmetry.addEventListener('change', () => {
      this.editor.symmetry = symmetry.checked;
    });

    const grid = $<HTMLInputElement>('#pattern-grid');
    grid.addEventListener('change', () => {
      this.editor.showGrid = grid.checked;
      this.editor.render();
    });

    const gore = $<HTMLInputElement>('#selected-gore');
    gore.addEventListener('input', () => {
      this.editor.selectedGore = Number(gore.value);
      $('#gore-value').textContent = `第 ${Number(gore.value) + 1} 条`;
      this.editor.render();
    });

    $('#clear-pattern').addEventListener('click', () => this.editor.clear());
    $('#send-to-check').addEventListener('click', () => this.setView('check'));
  }

  private bindShapeControls() {
    const pressure = $<HTMLInputElement>('#pressure');
    pressure.addEventListener('input', () => {
      this.basePressure = Number(pressure.value);
      if (this.view !== 'cold') this.params.pressure = this.basePressure;
      $('#pressure-value').textContent = `${pressure.value} Pa`;
    });

    const fabric = $<HTMLInputElement>('#fabric');
    fabric.addEventListener('input', () => {
      this.params.fabricStiffness = Number(fabric.value) * 1000;
      $('#fabric-value').textContent = `${fabric.value} kN/m`;
    });

    const tape = $<HTMLInputElement>('#tape');
    tape.addEventListener('input', () => {
      this.params.tapeStiffness = Number(tape.value) * 1000;
      $('#tape-value').textContent = `${(Number(tape.value) / 1000).toFixed(1)} MN`;
    });

    const bulge = $<HTMLInputElement>('#bulge');
    bulge.addEventListener('input', () => {
      this.params.bulgeScale = Number(bulge.value);
      $('#bulge-value').textContent = `${Number(bulge.value).toFixed(2)}×`;
    });

    const tapes = $<HTMLInputElement>('#show-tapes-shape');
    tapes.addEventListener('change', () => {
      this.params.showTapes = tapes.checked;
      $<HTMLInputElement>('#show-tapes-check').checked = tapes.checked;
    });

    const wire = $<HTMLInputElement>('#wireframe-shape');
    wire.addEventListener('change', () => {
      this.params.showWireframe = wire.checked;
      $<HTMLInputElement>('#wireframe-check').checked = wire.checked;
    });

    const mode = $<HTMLSelectElement>('#view-mode-shape');
    mode.addEventListener('change', () => {
      this.params.strainView = Number(mode.value) as StrainView;
      $<HTMLSelectElement>('#view-mode-check').value = mode.value;
    });

    $('#goto-cold').addEventListener('click', () => this.setView('cold'));
  }

  private bindColdControls() {
    $('#cold-play').addEventListener('click', () => {
      if (this.coldProgress >= 1) this.coldProgress = 0;
      this.coldPlaying = !this.coldPlaying;
      $('#cold-play').textContent = this.coldPlaying ? '暂停' : '播放';
    });

    $('#cold-replay').addEventListener('click', () => {
      this.coldProgress = 0;
      this.coldPlaying = true;
      $('#cold-play').textContent = '暂停';
    });

    const progress = $<HTMLInputElement>('#cold-progress');
    progress.addEventListener('input', () => {
      this.coldProgress = Number(progress.value) / 1000;
      this.coldPlaying = false;
      $('#cold-play').textContent = '播放';
    });

    const speed = $<HTMLInputElement>('#cold-speed');
    speed.addEventListener('input', () => {
      this.coldSpeed = Number(speed.value);
      $('#cold-speed-value').textContent = `${this.coldSpeed.toFixed(2)}×`;
    });

    const fourK = $<HTMLInputElement>('#four-k');
    fourK.addEventListener('change', () => {
      if (this.renderer) this.renderer.force4K = fourK.checked;
      const scale = $<HTMLInputElement>('#resolution-scale');
      if (fourK.checked) {
        scale.value = '1';
        $('#resolution-value').textContent = '4K';
      } else if (this.renderer) {
        this.renderer.renderScale = Number(scale.value);
        $('#resolution-value').textContent = `${Math.round(Number(scale.value) * 100)}%`;
      }
    });

    const resolution = $<HTMLInputElement>('#resolution-scale');
    resolution.addEventListener('input', () => {
      const value = Number(resolution.value);
      if (this.renderer) {
        this.renderer.force4K = false;
        this.renderer.renderScale = value;
      }
      $<HTMLInputElement>('#four-k').checked = false;
      $('#resolution-value').textContent = `${Math.round(value * 100)}%`;
    });
  }

  private bindCheckControls() {
    const tSlider = $<HTMLInputElement>('#check-t');
    tSlider.addEventListener('input', () => {
      this.checkT = Number(tSlider.value) / 100;
      $('#check-t-value').textContent = this.checkT.toFixed(2);
      this.drawSagChart();
    });

    const gore = $<HTMLInputElement>('#check-gore');
    gore.addEventListener('input', () => {
      this.checkGore = Number(gore.value);
      $('#check-gore-value').textContent = `第 ${this.checkGore + 1} 条`;
      this.drawSagChart();
    });

    const mode = $<HTMLSelectElement>('#view-mode-check');
    mode.addEventListener('change', () => {
      this.params.strainView = Number(mode.value) as StrainView;
      $<HTMLSelectElement>('#view-mode-shape').value = mode.value;
    });

    const tapes = $<HTMLInputElement>('#show-tapes-check');
    tapes.addEventListener('change', () => {
      this.params.showTapes = tapes.checked;
      $<HTMLInputElement>('#show-tapes-shape').checked = tapes.checked;
    });

    const wire = $<HTMLInputElement>('#wireframe-check');
    wire.addEventListener('change', () => {
      this.params.showWireframe = wire.checked;
      $<HTMLInputElement>('#wireframe-shape').checked = wire.checked;
    });

    $('#run-acceptance').addEventListener('click', () => {
      void this.runAcceptance(true);
    });

    $('#load-calibration').addEventListener('click', () => {
      this.editor.loadPreset('checker');
      document.querySelectorAll('[data-pattern]').forEach((button) => {
        button.classList.toggle(
          'active',
          (button as HTMLElement).dataset.pattern === 'checker',
        );
      });
      this.params.strainView = 0;
      $<HTMLSelectElement>('#view-mode-check').value = '0';
      $<HTMLSelectElement>('#view-mode-shape').value = '0';
    });
  }

  private bindCameraButtons() {
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach((button) => {
      button.addEventListener('click', () => {
        this.renderer?.setCameraPreset(button.dataset.camera as CameraPreset);
      });
    });
  }

  private updateAllReadouts() {
    const s = this.params.shape;
    $('#shape-formula').innerHTML =
      `r(t)=R·(t+m)<sup>${s.b}</sup>(1-t)<sup>${s.a}</sup>/N，` +
      `R=${s.radius} m，H=${s.height} m。最大半径位置由指数比自动确定。`;
    this.updateMetricReadouts();
    this.drawSagChart();
  }

  private updateColdState(dt: number) {
    if (this.view === 'cold') {
      if (this.coldPlaying) {
        this.coldProgress = Math.min(1, this.coldProgress + (dt * this.coldSpeed) / 30);
        if (this.coldProgress >= 1) {
          this.coldPlaying = false;
          $('#cold-play').textContent = '播放';
        }
      }
      const tl = coldTimeline(this.coldProgress);
      this.params.inflation = tl.inflation;
      this.params.erection = tl.erection;
      this.params.pressure = this.basePressure * tl.pressureScale;
      const ignition = Math.max(0, Math.min(1, (this.coldProgress - 0.67) / 0.08));
      this.params.flame = ignition * Math.max(0.35, 1 - tl.erection * 0.55);

      const slider = $<HTMLInputElement>('#cold-progress');
      if (document.activeElement !== slider) slider.value = String(Math.round(this.coldProgress * 1000));
      $('#cold-time-value').textContent = `${Math.round(this.coldProgress * 100)}%`;
      $('#cold-phase').textContent = tl.phase;
      $('#cold-track-fill').style.width = `${this.coldProgress * 100}%`;
      $('#cold-inflation').textContent = `${Math.round(tl.inflation * 100)}%`;
      $('#cold-erection').textContent = `${Math.round(tl.erection * 100)}%`;
      $('#cold-pressure').textContent = `${Math.round(this.params.pressure)} Pa`;
      $('#cold-flame').textContent = `${Math.round(this.params.flame * 100)}%`;
    }
  }

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.params.time += dt;

    this.updateColdState(dt);
    if (this.gpuReady && this.renderer) {
      this.renderer.render(this.params);
    }

    this.metricsAccumulator += dt;
    if (this.metricsAccumulator > 0.22) {
      this.metricsAccumulator = 0;
      this.updateMetricReadouts();
      this.updateFpsReadouts();
    }
    requestAnimationFrame(this.loop);
  };

  private updateFpsReadouts() {
    if (!this.renderer) return;
    const { fps, frameMs, width, height } = this.renderer.stats;
    const text = this.gpuReady ? `${fps || '--'} FPS` : 'WebGPU 未运行';
    ['#fps-shape', '#fps-cold', '#fps-cold-hud', '#fps-check'].forEach((id) => {
      const el = document.querySelector(id);
      if (el) {
        el.textContent = text;
        el.classList.toggle('slow', fps > 0 && fps < 50);
      }
    });
    const coldMs = $('#cold-frame-ms');
    if (coldMs) coldMs.textContent = `${frameMs.toFixed(2)} ms（CPU 提交）`;
    const res = $('#cold-resolution');
    if (res && width) res.textContent = `${width}×${height}`;
    const checkFps = $('#check-fps');
    if (checkFps) checkFps.textContent = fps ? `${fps} FPS / ${width}×${height}` : '--';
  }

  private updateMetricReadouts() {
    const report = evaluateContour(this.params);
    const setText = (id: string, text: string) => {
      const el = document.querySelector(id);
      if (el) el.textContent = text;
    };

    setText('#metric-tape-dev', `${fmt(report.tapeDeviationPct, 2)}%`);
    setText('#metric-panel-dev', `${fmt(report.panelDeviationPct, 2)}%`);
    setText('#metric-sag', `${fmt(report.maxSagMm, 1)} mm`);
    setText('#metric-hoop', `${fmt(report.maxHoopStrainPct, 2)}%`);
    setText('#metric-merid', `${fmt(report.maxMeridionalStrainPct, 2)}%`);
    setText('#metric-tape-force', `${fmt(report.maxTapeTensionKn, 2)} kN`);

    const verdict = $('#shape-verdict');
    const geometryPass = report.tapeDeviationPct <= 2 && report.panelDeviationPct <= 2;
    verdict.className = `verdict ${geometryPass ? 'good' : 'bad'}`;
    verdict.textContent = geometryPass
      ? `通过：主轮廓偏差 ${fmt(report.tapeDeviationPct, 2)}%，含鼓包 ${fmt(report.panelDeviationPct, 2)}%，均 ≤ 2%。`
      : `超差：含鼓包偏差 ${fmt(report.panelDeviationPct, 2)}% > 2%，请提高布料刚度或降低压差。`;

    const sample = mechanicsAt(this.checkT, this.params);
    setText('#check-width', `${fmt(sample.goreWidth, 3)} m`);
    setText('#check-sag', `${fmt(sample.panelSag * 1000, 1)} mm`);
    setText('#check-line-bend', `${fmt(sample.panelSag * 1000, 1)} mm`);
    setText('#check-ratio', `${fmt((sample.panelSag / Math.max(sample.goreWidth, 0.001)) * 100, 2)}%`);
    setText(
      '#check-contour',
      report.tapeDeviationPct <= 2 ? `通过 · ${fmt(report.tapeDeviationPct, 2)}%` : `超差 · ${fmt(report.tapeDeviationPct, 2)}%`,
    );
    this.drawSagChart();
  }

  private drawSagChart() {
    const canvas = document.querySelector<HTMLCanvasElement>('#sag-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const m = mechanicsAt(this.checkT, this.params);
    const left = 42;
    const right = w - 28;
    const baseY = 132;
    const plotW = right - left;
    const verticalExaggeration = 9;
    const sagPx = Math.max(2, (m.panelSag / Math.max(m.goreWidth, 0.01)) * plotW * verticalExaggeration);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    for (let y = 24; y < h - 20; y += 24) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    // Load tapes.
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(left - 5, baseY - sagPx - 18, 10, sagPx + 36);
    ctx.fillRect(right - 5, baseY - sagPx - 18, 10, sagPx + 36);
    ctx.fillStyle = '#92400e';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('加强带', left, baseY + 34);
    ctx.fillText('加强带', right, baseY + 34);

    // Flat straight line/chord.
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(left, baseY);
    ctx.lineTo(right, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Deformed line: same sinusoidal arch as WGSL surface_position.
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const q = i / 80;
      const x = left + q * plotW;
      const arch = Math.pow(Math.max(0, Math.sin(Math.PI * q)), 0.82);
      const y = baseY - sagPx * arch;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(249,115,22,.16)';
    ctx.beginPath();
    ctx.moveTo(left, baseY);
    for (let i = 0; i <= 80; i++) {
      const q = i / 80;
      ctx.lineTo(left + q * plotW, baseY - sagPx * Math.pow(Math.sin(Math.PI * q), 0.82));
    }
    ctx.lineTo(right, baseY);
    ctx.closePath();
    ctx.fill();

    // Sag dimension.
    const midX = left + plotW / 2;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX, baseY);
    ctx.lineTo(midX, baseY - sagPx);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`h=${(m.panelSag * 1000).toFixed(1)} mm`, midX + 8, baseY - sagPx / 2);
    ctx.fillStyle = '#334155';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`跨宽 w=${m.goreWidth.toFixed(2)} m · 纵向放大 ${verticalExaggeration}×`, w / 2, 20);
    ctx.fillStyle = '#2563eb';
    ctx.fillText('蓝虚线：平面直线', left + 70, 52);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('红曲线：GPU 充形后', left + 76, 72);
  }

  private async runAcceptance(interactive: boolean) {
    const report = evaluateContour(this.params);
    let gpuReadback: Awaited<ReturnType<WebGpuBalloonRenderer['readContour']>> = null;
    try {
      gpuReadback = this.renderer ? await this.renderer.readContour(this.params) : null;
    } catch (error) {
      console.warn('GPU contour readback failed', error);
    }

    const tapeDeviation = gpuReadback?.tapeDeviationPct ?? report.tapeDeviationPct;
    const panelDeviation = gpuReadback?.panelDeviationPct ?? report.panelDeviationPct;
    const geometryPass = tapeDeviation <= 2 && panelDeviation <= 2;
    const fps = this.renderer?.stats.fps ?? 0;
    const fourK = $<HTMLInputElement>('#four-k').checked;
    const performancePass = !fourK || fps >= 55;
    const verdict = $('#acceptance-verdict');

    verdict.className = `verdict ${geometryPass && performancePass ? 'good' : 'bad'}`;
    const source = gpuReadback
      ? `GPU 回读 ${gpuReadback.sampleCount} 个跨片样本：主轮廓 ${tapeDeviation.toFixed(2)}% / 含鼓包 ${panelDeviation.toFixed(2)}%，实测矢高 ${gpuReadback.panelSagMm.toFixed(1)} mm`
      : `CPU 同方程复核：主轮廓 ${tapeDeviation.toFixed(2)}% / 含鼓包 ${panelDeviation.toFixed(2)}%`;
    if (geometryPass && performancePass) {
      verdict.textContent = interactive
        ? `验收通过：${source}，直线矢高与鼓包一致${fourK ? `，${fps} FPS` : '。勾选 4K 压测可验证帧率。'}`
        : '验收通过';
    } else {
      verdict.textContent = !geometryPass
        ? `几何超差：${panelDeviation.toFixed(2)}% > 2%。请提高布料刚度或降低压差/鼓包幅度。`
        : `性能未达稳定 60 FPS：当前 ${fps} FPS。可降低渲染缩放。`;
    }

    (window as unknown as { __AEROSTAT_REPORT__?: unknown }).__AEROSTAT_REPORT__ = {
      gores: GORE_COUNT,
      blocksPerGore: BLOCKS_PER_GORE,
      totalClothPanels: GORE_COUNT * BLOCKS_PER_GORE,
      ...report,
      gpuReadback,
      fps,
      fourK,
      geometryPass,
      performancePass,
    };
  }
}
