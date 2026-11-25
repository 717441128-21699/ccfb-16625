import type { GpuStats, ShapeId } from '../config';
import { BalloonViewer } from '../gpu/BalloonViewer';
import { profileReportFromGpu } from '../core/inspection';
import { getShape } from '../core/profiles';
import { button, h, metricCard, selectControl, setMetric, slider, toggle } from './dom';
import type { PageDeps, PageHandle } from './types';

export function createShapePage(root: HTMLElement, deps: PageDeps): PageHandle {
  const { settings, studio } = deps;
  settings.inflation = 1;
  settings.rise = 1;

  const canvas = h('canvas', { class: 'gpu-canvas', 'aria-label': '充气形状 WebGPU 视口' }) as HTMLCanvasElement;
  const errorBox = h('div', { class: 'gpu-error' }, [
    h('h3', {}, 'WebGPU 视口未启动'),
    h('p', {}, '请使用最新版 Chrome / Edge，并确认 chrome://flags 中 WebGPU 已启用。')
  ]);
  errorBox.hidden = true;

  const fpsCard = metricCard('实时帧率', '-- FPS', '等待 WebGPU');
  const frameCard = metricCard('帧时间', '-- ms', 'GPU 计算 + 渲染');
  const resCard = metricCard('绘图缓冲', '--', '非 CSS 分辨率');
  const devCard = metricCard('理论轮廓偏差', '--', '点击校核读取 GPU 回读');

  let stats: GpuStats | null = null;
  let viewer: BalloonViewer | null = null;
  let initPromise: Promise<void> | null = null;
  let profileTimer = 0;

  const onStats = (s: GpuStats) => {
    stats = s;
    setMetric(fpsCard, `${s.fps} FPS`, `${s.computePasses} 个计算通道`);
    setMetric(frameCard, `${s.frameMs} ms`, `约 ${(1000 / Math.max(1, s.frameMs)).toFixed(0)} Hz 上限`);
    setMetric(resCard, `${s.width}×${s.height}`, `${Math.round(s.triangles).toLocaleString()} 三角面`);
  };

  async function ensureViewer() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      viewer = new BalloonViewer({ canvas, pattern: studio.atlas, settings, onStats });
      await viewer.init();
      viewer.start();
      profileTimer = window.setTimeout(() => void runProfileCheck(), 900);
    })().catch((err: unknown) => {
      console.error(err);
      errorBox.hidden = false;
      errorBox.querySelector('p')!.textContent = err instanceof Error ? err.message : String(err);
    });
    return initPromise;
  }

  async function runProfileCheck() {
    if (!viewer) return;
    try {
      const data = await viewer.readInspection();
      const report = profileReportFromGpu(data.positions, getShape(settings.shape));
      setMetric(
        devCard,
        `${report.maxPercent.toFixed(2)}%`,
        report.compliant ? `合格 ≤2% · RMS ${report.rmsPercent.toFixed(2)}%` : `超差 · RMS ${report.rmsPercent.toFixed(2)}%`
      );
      devCard.classList.toggle('pass', report.compliant);
      devCard.classList.toggle('fail', !report.compliant);
      const value = devCard.querySelector('.metric-value');
      value?.classList.toggle('good', report.compliant);
      value?.classList.toggle('bad', !report.compliant);
    } catch (err) {
      console.error(err);
      setMetric(devCard, '回读失败', '请重试');
    }
  }

  const shapeName = h('strong', {}, '');
  const shapeDescription = h('p', {}, '');
  const shapeDims = h('div', { class: 'info-grid' });
  const shapeInfo = h('div', { class: 'info-box' }, [shapeName, shapeDescription, shapeDims]);
  const updateShapeInfo = (id: ShapeId) => {
    const shape = getShape(id);
    shapeName.textContent = shape.name;
    shapeDescription.textContent = shape.description;
    shapeDims.replaceChildren(
      h('span', {}, `高度 ${shape.height} m`),
      h('span', {}, `最大半径 ${shape.rMax} m`),
      h('span', {}, `体积约 ${shape.volume} m³`)
    );
  };
  updateShapeInfo(settings.shape);

  const shapeSelect = selectControl<ShapeId>({
    label: '球形理论轮廓',
    value: settings.shape,
    entries: [
      { value: 'natural', label: '经典水滴自然球' },
      { value: 'broad', label: '宽体庆典球' },
      { value: 'teardrop', label: '高瘦探索球' }
    ],
    onChange: (v) => { settings.shape = v; updateShapeInfo(v); }
  });

  const patternSelect = selectControl({
    label: '平面图案',
    value: settings.pattern,
    entries: [
      { value: 'sky', label: '凌云竞速条纹' },
      { value: 'festival', label: '庆典红金福球' },
      { value: 'geo', label: '几何广告菱格' },
      { value: 'panda', label: '熊猫团团定制' }
    ],
    onChange: (v) => {
      settings.pattern = v as typeof settings.pattern;
      studio.paintAll(settings.pattern);
      deps.onPatternChange();
    }
  });

  const pressureSlider = slider({
    label: '内外压差 Δp', min: 80, max: 700, step: 10, value: settings.pressure, unit: ' Pa',
    onInput: (v) => { settings.pressure = v; }
  });
  const stiffnessSlider = slider({
    label: '布料拉伸刚度 E', min: 60000, max: 720000, step: 10000, value: settings.stiffness,
    format: (v) => `${(v / 1000).toFixed(0)} kN/m`,
    onInput: (v) => { settings.stiffness = v; }
  });
  const tapeSlider = slider({
    label: '加强带刚度', min: 800000, max: 10000000, step: 100000, value: settings.tapeStiffness,
    format: (v) => `${(v / 1e6).toFixed(1)} MN/m`,
    onInput: (v) => { settings.tapeStiffness = v; }
  });
  const bulgeSlider = slider({
    label: '鼓包显示倍率', min: 0.5, max: 2, step: 0.05, value: settings.bulgeExaggeration,
    format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => { settings.bulgeExaggeration = v; }
  });

  const heatToggle = toggle({ label: '应力 / 应变热力图', checked: settings.heatmap, onChange: (v) => { settings.heatmap = v; } });
  const tapeToggle = toggle({ label: '显示加强带', checked: settings.showTapes, onChange: (v) => { settings.showTapes = v; } });
  const rotateToggle = toggle({ label: '自动环绕', checked: settings.autoRotate, onChange: (v) => { settings.autoRotate = v; } });
  const fourKToggle = toggle({
    label: '强制 3840×2160 计算/渲染缓冲',
    checked: settings.resolutionScale >= 2,
    hint: '即使窗口小于 4K，也按 4K 提交 GPU 工作量。',
    onChange: (v) => {
      viewer?.setForced4k(v);
      if (!v) setMetric(fpsCard, `${stats?.fps ?? '--'} FPS`, '已退出强制4K');
    }
  });

  let benchSamples: number[] = [];
  let benchEnd = 0;
  const benchButton = button('运行 5 秒 4K 帧率压测', () => {
    if (!viewer) return;
    viewer.setForced4k(true);
    fourKToggle.querySelector('input')!.checked = true;
    benchSamples = [];
    benchEnd = performance.now() + 5200;
    benchButton.textContent = '4K 压测采样中…';
    const collect = window.setInterval(() => {
      if (performance.now() < benchEnd) {
        if (stats) benchSamples.push(stats.fps);
      } else {
        window.clearInterval(collect);
        const avg = benchSamples.length ? benchSamples.reduce((a, b) => a + b, 0) / benchSamples.length : 0;
        const min = benchSamples.length ? Math.min(...benchSamples) : 0;
        benchButton.textContent = `4K 平均 ${avg.toFixed(0)} / 最低 ${min} FPS`;
        benchButton.classList.toggle('pass', avg >= 58);
        benchButton.classList.toggle('fail', avg < 58);
      }
    }, 550);
  }, 'primary');

  const cameraRow = h('div', { class: 'button-row wrap' }, [
    button('地面视角', () => viewer?.setCameraPreset('ground')),
    button('侧面', () => viewer?.setCameraPreset('side')),
    button('正面', () => viewer?.setCameraPreset('front')),
    button('空中俯视', () => viewer?.setCameraPreset('aerial'))
  ]);

  const panel = h('aside', { class: 'panel control-panel' }, [
    h('div', { class: 'panel-head' }, [h('h2', {}, '充气形状计算'), h('p', {}, 'WebGPU 计算着色器逐顶点求解压力、膜张力和裁片间鼓包。')]),
    h('section', { class: 'panel-section' }, [shapeSelect, patternSelect, shapeInfo]),
    h('section', { class: 'panel-section' }, [pressureSlider.root, stiffnessSlider.root, tapeSlider.root, bulgeSlider.root]),
    h('section', { class: 'panel-section' }, [heatToggle, tapeToggle, rotateToggle]),
    h('section', { class: 'panel-section' }, [
      h('h3', {}, '视角'),
      cameraRow
    ]),
    h('section', { class: 'panel-section' }, [
      fourKToggle,
      benchButton,
      button('回读 GPU 并校核理论轮廓', () => void runProfileCheck(), 'secondary')
    ])
  ]);

  const hud = h('div', { class: 'hud-grid' }, [fpsCard, frameCard, resCard, devCard]);
  const viewport = h('section', { class: 'viewport-panel panel' }, [
    h('div', { class: 'viewport-topbar' }, [
      h('div', {}, [h('strong', {}, '充气平衡形态'), h('span', { class: 'hint' }, '拖拽旋转 · 滚轮缩放')]),
      h('span', { class: 'engine-pill' }, 'WebGPU Compute + Render')
    ]),
    h('div', { class: 'canvas-wrap' }, [canvas, errorBox, hud])
  ]);

  root.append(h('div', { class: 'viewer-layout' }, [viewport, panel]));

  return {
    async show() {
      settings.inflation = 1;
      settings.rise = 1;
      settings.heatmap = heatToggle.querySelector('input')?.checked ?? settings.heatmap;
      settings.autoRotate = rotateToggle.querySelector('input')?.checked ?? settings.autoRotate;
      root.classList.add('active-page');
      await ensureViewer();
      requestAnimationFrame(() => viewer?.refreshSize());
      viewer?.start();
    },
    hide() {
      viewer?.stop();
      window.clearTimeout(profileTimer);
    },
    reloadPattern() {
      viewer?.reloadPattern(studio.atlas);
    }
  };
}
