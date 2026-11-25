import type { GpuStats } from '../config';
import { BalloonViewer, type InspectionData } from '../gpu/BalloonViewer';
import { analyzeBlocks, analyzeGuide, formatMm, profileReportFromGpu, type GuideAnalysis } from '../core/inspection';
import { getShape } from '../core/profiles';
import { button, h, metricCard, selectControl, setMetric, slider, toggle } from './dom';
import type { PageDeps, PageHandle } from './types';

const CHECK_BLOCKS = [6, 15, 24, 30, 38, 48, 56];

export function createCheckPage(root: HTMLElement, deps: PageDeps): PageHandle {
  const { settings, studio } = deps;
  settings.inflation = 1;
  settings.rise = 1;

  let viewer: BalloonViewer | null = null;
  let initPromise: Promise<void> | null = null;
  let lastData: InspectionData | null = null;
  let lastGuide: GuideAnalysis | null = null;
  let stats: GpuStats | null = null;

  const canvas = h('canvas', { class: 'gpu-canvas' }) as HTMLCanvasElement;
  const chart = h('canvas', { class: 'curve-chart', width: 430, height: 230 }) as HTMLCanvasElement;
  const errorBox = h('div', { class: 'gpu-error' }, [h('h3', {}, 'WebGPU 视口未启动'), h('p', {}, '')]);
  errorBox.hidden = true;

  const profileCard = metricCard('整体轮廓偏差', '--', '等待 GPU 回读');
  const sagCard = metricCard('直线弯曲吻合', '--', '实测矢高 / 膜力预测');
  const strainCard = metricCard('中点应变', '--', 'GPU deform 缓冲');
  const readCard = metricCard('回读状态', '未读取', '位置 + 应力/应变');
  const fpsCard = metricCard('帧率', '-- FPS', '检查页同步渲染');

  const tableBody = h('tbody', {});
  const table = h('table', { class: 'data-table' }, [
    h('thead', {}, h('tr', {}, [
      h('th', {}, '布块'), h('th', {}, '半径'), h('th', {}, '实测矢高'),
      h('th', {}, '预测矢高'), h('th', {}, '偏差'), h('th', {}, '应变')
    ])),
    tableBody
  ]);

  const goreSelect = selectControl({
    label: '检查裁片',
    value: String(settings.guideGore),
    entries: Array.from({ length: 20 }, (_, i) => ({ value: String(i), label: `第 ${i + 1} 条` })),
    onChange: (v) => {
      settings.guideGore = Number(v);
      viewer?.setGuide(settings.guideGore, settings.guideBlock);
      if (lastData) renderAnalysis(lastData);
    }
  }) as unknown as HTMLLabelElement & { querySelector?: never };

  const blockSlider = slider({
    label: '检测直线所在布块（从口圈数）', min: 1, max: 60, step: 1, value: settings.guideBlock, unit: ' 块',
    onInput: (v) => {
      settings.guideBlock = v;
      viewer?.setGuide(settings.guideGore, v);
      if (lastData) renderAnalysis(lastData);
    }
  });

  const heatToggle = toggle({
    label: '应力热力图', checked: true,
    onChange: (v) => { settings.heatmap = v; }
  });
  const tapeToggle = toggle({ label: '加强带与检测线', checked: settings.showTapes, onChange: (v) => { settings.showTapes = v; } });
  const rotateToggle = toggle({ label: '自动环绕', checked: false, onChange: (v) => { settings.autoRotate = v; } });

  function drawChart(a: GuideAnalysis) {
    const ctx = chart.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = chart.clientWidth || 430;
    const cssH = 230;
    if (chart.width !== Math.round(cssW * dpr)) {
      chart.width = Math.round(cssW * dpr);
      chart.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW;
    const h = cssH;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1220';
    roundRectPath(ctx, 0, 0, w, h, 14);
    ctx.fill();

    const padL = 48;
    const padR = 16;
    const padT = 18;
    const padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxS = Math.max(a.measuredSag, a.predictedSag, 0.05) * 1.25;
    const X = (x: number) => padL + (x / Math.max(a.chordLength, 0.01)) * plotW;
    const Y = (s: number) => padT + plotH - (s / maxS) * plotH;

    ctx.strokeStyle = 'rgba(148,163,184,.22)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const s = (maxS * i) / 4;
      const y = Y(s);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(`${Math.round(s * 1000)}`, padL - 7, y + 4);
    }
    ctx.textAlign = 'center';
    ctx.fillText('横向弦长位置 (m)', padL + plotW / 2, h - 9);
    ctx.save();
    ctx.translate(13, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('矢高 (mm)', 0, 0);
    ctx.restore();

    // Chord.
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(a.chordLength), Y(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Predicted membrane curve.
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const q = i / 64;
      const x = q * a.chordLength;
      const s = 4 * a.baseArcSag * q * (1 - q) + a.predictedBulge * Math.sin(Math.PI * q);
      if (i === 0) ctx.moveTo(X(x), Y(s)); else ctx.lineTo(X(x), Y(s));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Measured GPU curve.
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 3;
    ctx.beginPath();
    a.chart.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.x), Y(p.s)); else ctx.lineTo(X(p.x), Y(p.s));
    });
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    for (const p of a.chart) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.s), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#facc15'; ctx.fillText('● GPU实测直线', padL, 14);
    ctx.fillStyle = '#f472b6'; ctx.fillText('┄ 膜力预测', padL + 112, 14);
    ctx.fillStyle = '#22d3ee'; ctx.fillText('┄ 加强带弦线', padL + 205, 14);
  }

  function renderAnalysis(data: InspectionData) {
    const shape = getShape(settings.shape);
    const profile = profileReportFromGpu(data.positions, shape);
    lastGuide = analyzeGuide(data.positions, data.deform, settings.guideGore, settings.guideBlock, shape, settings.pressure, settings.stiffness);
    const all = analyzeBlocks(data.positions, data.deform, shape, settings.pressure, settings.stiffness, settings.guideGore, CHECK_BLOCKS);

    setMetric(profileCard, `${profile.maxPercent.toFixed(2)}%`, profile.compliant ? `合格 ≤2% · RMS ${profile.rmsPercent.toFixed(2)}%` : `超差 · RMS ${profile.rmsPercent.toFixed(2)}%`);
    profileCard.classList.toggle('pass', profile.compliant);
    profileCard.classList.toggle('fail', !profile.compliant);

    const goodSag = lastGuide.sagErrorPercent <= 8;
    setMetric(sagCard, `${lastGuide.sagErrorPercent.toFixed(1)}%`, `实测 ${formatMm(lastGuide.measuredSag)} / 预测 ${formatMm(lastGuide.predictedSag)}`);
    sagCard.classList.toggle('pass', goodSag);
    sagCard.classList.toggle('fail', !goodSag);
    setMetric(strainCard, `${(lastGuide.measuredStrain * 100).toFixed(2)}%`, `预测 ${(lastGuide.predictedStrain * 100).toFixed(2)}%`);
    setMetric(readCard, '已回读', `${data.positions.length / 4 | 0} 顶点 · ${new Date().toLocaleTimeString()}`);

    tableBody.innerHTML = '';
    for (const row of all) {
      const errClass = row.sagErrorPercent <= 8 ? 'good' : 'bad';
      const tr = h('tr', {}, [
        h('td', {}, `#${row.block}`),
        h('td', {}, row.radius.toFixed(2)),
        h('td', { class: 'num' }, formatMm(row.measuredSag)),
        h('td', { class: 'num' }, formatMm(row.predictedSag)),
        h('td', { class: `num ${errClass}` }, `${row.sagErrorPercent.toFixed(1)}%`),
        h('td', { class: 'num' }, `${(row.measuredStrain * 100).toFixed(2)}%`)
      ]);
      if (row.block === settings.guideBlock) tr.classList.add('selected-row');
      tr.addEventListener('click', () => {
        settings.guideBlock = row.block;
        blockSlider.input.value = String(row.block);
        viewer?.setGuide(settings.guideGore, row.block);
        if (lastData) renderAnalysis(lastData);
      });
      tableBody.append(tr);
    }
    drawChart(lastGuide);
  }

  async function runInspection() {
    if (!viewer) return;
    setMetric(readCard, '回读中…', '提交 copyBuffer → mapAsync');
    try {
      lastData = await viewer.readInspection();
      renderAnalysis(lastData);
    } catch (err) {
      console.error(err);
      setMetric(readCard, '失败', String(err));
    }
  }

  async function ensureViewer() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      viewer = new BalloonViewer({
        canvas,
        pattern: studio.atlas,
        settings,
        onStats: (s) => {
          stats = s;
          setMetric(fpsCard, `${s.fps} FPS`, `${s.width}×${s.height}`);
        }
      });
      await viewer.init();
      viewer.start();
      window.setTimeout(() => void runInspection(), 700);
    })().catch((err: unknown) => {
      console.error(err);
      errorBox.hidden = false;
      errorBox.querySelector('p')!.textContent = err instanceof Error ? err.message : String(err);
    });
    return initPromise;
  }

  const controls = h('aside', { class: 'panel control-panel check-panel' }, [
    h('div', { class: 'panel-head' }, [
      h('h2', {}, '图案变形检查'),
      h('p', {}, '黄色为图案直线在 GPU 变形后的位置，青色为加强带弦线，粉色为膜力预测。')
    ]),
    h('section', { class: 'panel-section' }, [
      goreSelect as unknown as HTMLElement,
      blockSlider.root,
      h('div', { class: 'button-row' }, [
        button('重新回读 GPU 数据', () => void runInspection(), 'primary'),
        button('4K 回读/渲染', () => viewer?.setForced4k(settings.resolutionScale < 2), 'secondary')
      ])
    ]),
    h('section', { class: 'panel-section chart-section' }, [
      h('h3', {}, '直线弯曲 vs 布片鼓高'),
      chart,
      h('p', { class: 'hint' }, '矢高单位为毫米；预测包含圆弧基础矢高和压力造成的附加鼓包。')
    ]),
    h('section', { class: 'panel-section' }, [heatToggle, tapeToggle, rotateToggle]),
    h('section', { class: 'panel-section table-section' }, [
      h('h3', {}, '分块检查表（点击行定位）'),
      table
    ])
  ]);

  const hud = h('div', { class: 'hud-grid check-hud' }, [profileCard, sagCard, strainCard, fpsCard]);
  const viewport = h('section', { class: 'viewport-panel panel' }, [
    h('div', { class: 'viewport-topbar' }, [
      h('div', {}, [h('strong', {}, '图案应变与轮廓符合性'), h('span', { class: 'hint' }, 'WebGPU storage buffer 回读，不是截图估算')]),
      h('span', { class: 'engine-pill' }, 'Readback Verify')
    ]),
    h('div', { class: 'canvas-wrap' }, [canvas, errorBox, hud])
  ]);

  root.append(h('div', { class: 'viewer-layout check-layout' }, [viewport, controls]));

  return {
    async show() {
      settings.inflation = 1;
      settings.rise = 1;
      settings.heatmap = heatToggle.querySelector('input')?.checked ?? true;
      settings.autoRotate = rotateToggle.querySelector('input')?.checked ?? false;
      await ensureViewer();
      requestAnimationFrame(() => {
        viewer?.refreshSize();
        if (lastGuide) drawChart(lastGuide);
      });
      viewer?.start();
      if (lastData) renderAnalysis(lastData);
    },
    hide() { viewer?.stop(); },
    reloadPattern() { viewer?.reloadPattern(studio.atlas); }
  };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
