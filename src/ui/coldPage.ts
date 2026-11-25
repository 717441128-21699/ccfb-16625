import type { GpuStats } from '../config';
import { BalloonViewer } from '../gpu/BalloonViewer';
import { button, h, metricCard, setMetric, toggle } from './dom';
import type { PageDeps, PageHandle } from './types';

function ease(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function stageFor(p: number): { title: string; detail: string } {
  if (p < 0.15) return { title: '① 平铺定位', detail: '囊体按裁片展开在草地上，口圈连接风机；GPU 中折叠为上下两层。' };
  if (p < 0.55) return { title: '② 风机冷充', detail: '常温空气建立内压，压差和布料刚度共同决定每条裁片间的鼓包高度。' };
  if (p < 0.68) return { title: '③ 卧式饱满', detail: '二十条纵向加强带承担主要经向力，带间布片向外鼓出。' };
  if (p < 0.86) return { title: '④ 点火热充', detail: '燃烧器加热囊内空气，密度降低、静压梯度增大，冠部开始抬起。' };
  return { title: '⑤ 直立待飞', detail: '囊体绕口圈方向立起，图案随膜面拉伸进入最终检查状态。' };
}

export function createColdPage(root: HTMLElement, deps: PageDeps): PageHandle {
  const { settings, studio } = deps;
  let progress = 0;
  let playing = false;
  let speed = 2;
  let hasAutoStarted = false;
  let raf = 0;
  let last = 0;
  let viewer: BalloonViewer | null = null;
  let initPromise: Promise<void> | null = null;
  let stats: GpuStats | null = null;

  const fpsCard = metricCard('实时帧率', '-- FPS', '冷充 → 立起连续过程');
  const resCard = metricCard('绘图缓冲', '--', '目标 4K ≥ 60 FPS');
  const stageCard = metricCard('当前阶段', '平铺', '0%');

  const canvas = h('canvas', { class: 'gpu-canvas' }) as HTMLCanvasElement;
  const errorBox = h('div', { class: 'gpu-error' }, [h('h3', {}, 'WebGPU 视口未启动'), h('p', {}, '')]);
  errorBox.hidden = true;

  const timeline = h('input', {
    class: 'timeline-range', type: 'range', min: '0', max: '100', step: '0.1', value: '0'
  }) as HTMLInputElement;
  const timeLabel = h('strong', { class: 'time-label' }, '0%');
  const stageTitle = h('h3', {}, '');
  const stageDetail = h('p', {}, '');
  const flame = h('div', { class: 'burner-flame idle', 'aria-hidden': 'true' }, '🔥');

  function applyTimeline(p: number) {
    progress = Math.max(0, Math.min(1, p));
    timeline.value = String(progress * 100);
    timeLabel.textContent = `${Math.round(progress * 100)}%`;

    if (progress < 0.15) {
      settings.inflation = 0.025 + ease(progress / 0.15) * 0.10;
    } else if (progress < 0.55) {
      settings.inflation = 0.125 + ease((progress - 0.15) / 0.40) * 0.875;
    } else {
      settings.inflation = 1;
    }
    settings.rise = progress < 0.62 ? 0 : ease((progress - 0.62) / 0.38);

    const st = stageFor(progress);
    stageTitle.textContent = st.title;
    stageDetail.textContent = st.detail;
    setMetric(stageCard, st.title.replace(/^[①②③④⑤]\s*/, ''), `${Math.round(progress * 100)}% · rise ${settings.rise.toFixed(2)}`);
    flame.classList.toggle('active', progress >= 0.62 && progress < 0.98);
    flame.classList.toggle('idle', !(progress >= 0.62 && progress < 0.98));
  }

  const playButton = button('▶ 播放冷充流程', () => {
    if (progress >= 1) applyTimeline(0);
    playing = !playing;
    playButton.textContent = playing ? '⏸ 暂停' : '▶ 播放冷充流程';
    if (playing) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    } else cancelAnimationFrame(raf);
  }, 'primary');

  function tick(now: number) {
    if (!playing) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 24 seconds at 1x, about 6 seconds in 4x.
    applyTimeline(progress + (dt * speed) / 24);
    if (progress >= 1) {
      playing = false;
      playButton.textContent = '↺ 再播放一次';
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  timeline.addEventListener('input', () => {
    playing = false;
    cancelAnimationFrame(raf);
    playButton.textContent = '▶ 播放冷充流程';
    applyTimeline(Number(timeline.value) / 100);
  });

  const speedRow = h('div', { class: 'segmented' }, [1, 2, 4].map((s) => button(`${s}×`, () => {
    speed = s;
    speedRow.querySelectorAll('.btn').forEach((b, i) => b.classList.toggle('active', [1, 2, 4][i] === s));
  }, s === 2 ? 'active' : '')));

  const cameraRow = h('div', { class: 'button-row wrap' }, [
    button('贴地机位', () => viewer?.setCameraPreset('ground')),
    button('侧面全景', () => viewer?.setCameraPreset('side')),
    button('空中俯视', () => viewer?.setCameraPreset('aerial'))
  ]);

  const fourk = toggle({
    label: '强制 4K 缓冲并监测帧率', checked: false,
    onChange: (v) => viewer?.setForced4k(v)
  });
  const bench = button('5 秒 4K 压测', () => {
    if (!viewer) return;
    viewer.setForced4k(true);
    fourk.querySelector('input')!.checked = true;
    const samples: number[] = [];
    const end = performance.now() + 5200;
    bench.textContent = '采样中…';
    const id = window.setInterval(() => {
      if (performance.now() < end) {
        if (stats) samples.push(stats.fps);
      } else {
        clearInterval(id);
        const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
        const min = samples.length ? Math.min(...samples) : 0;
        bench.textContent = `平均 ${avg.toFixed(0)} / 最低 ${min} FPS`;
        bench.classList.toggle('pass', avg >= 58);
        bench.classList.toggle('fail', avg < 58);
      }
    }, 550);
  }, 'primary');

  async function ensureViewer() {
    if (initPromise) return initPromise;
    applyTimeline(progress);
    initPromise = (async () => {
      viewer = new BalloonViewer({
        canvas,
        pattern: studio.atlas,
        settings,
        followDeployment: true,
        onStats: (s) => {
          stats = s;
          setMetric(fpsCard, `${s.fps} FPS`, `${s.frameMs} ms/帧`);
          setMetric(resCard, `${s.width}×${s.height}`, `${Math.round(s.triangles / 1000)}k 三角面`);
        }
      });
      await viewer.init();
      viewer.start();
    })().catch((err: unknown) => {
      console.error(err);
      errorBox.hidden = false;
      errorBox.querySelector('p')!.textContent = err instanceof Error ? err.message : String(err);
    });
    return initPromise;
  }

  const dock = h('div', { class: 'timeline-dock' }, [
    h('div', { class: 'timeline-row' }, [playButton, timeLabel, timeline, speedRow, flame]),
    h('div', { class: 'stage-labels' }, [
      h('span', {}, '平铺'), h('span', {}, '冷充'), h('span', {}, '卧式饱满'), h('span', {}, '点火热充'), h('span', {}, '立起')
    ])
  ]);

  const viewport = h('section', { class: 'viewport-panel panel cold-viewport' }, [
    h('div', { class: 'viewport-topbar' }, [
      h('div', {}, [h('strong', {}, '草地冷充与热充立起'), h('span', { class: 'hint' }, '20 裁片 × 60 布块 · 折叠、充气、站立连续变形')]),
      h('span', { class: 'engine-pill' }, '62,660 GPU 顶点')
    ]),
    h('div', { class: 'canvas-wrap cold-canvas-wrap' }, [canvas, errorBox, h('div', { class: 'hud-grid cold-hud' }, [fpsCard, resCard, stageCard])]),
    dock
  ]);

  const panel = h('aside', { class: 'panel control-panel' }, [
    h('div', { class: 'panel-head' }, [h('h2', {}, '充气工序')]),
    h('section', { class: 'panel-section stage-detail' }, [stageTitle, stageDetail]),
    h('section', { class: 'panel-section' }, [h('h3', {}, '机位'), cameraRow]),
    h('section', { class: 'panel-section' }, [
      h('h3', {}, '性能验收'),
      fourk,
      bench,
      h('p', { class: 'hint' }, '压测会按 3840×2160 提交；场景仅约 11.5 万三角面，主力 GPU 可保持 60fps。')
    ]),
    h('section', { class: 'panel-section info-box' }, [
      h('h3', {}, '物理量'),
      h('p', {}, `压差 ${settings.pressure} Pa · 布刚度 ${(settings.stiffness / 10000).toFixed(0)}0 kN/m`),
      h('p', {}, '加强带刚度最高，因此色带位置应力最大但应变最小。')
    ])
  ]);

  root.append(h('div', { class: 'viewer-layout cold-layout' }, [viewport, panel]));
  applyTimeline(0);

  return {
    async show() {
      root.classList.add('active-page');
      settings.autoRotate = false;
      applyTimeline(progress);
      await ensureViewer();
      requestAnimationFrame(() => viewer?.refreshSize());
      viewer?.start();
      if (!hasAutoStarted) {
        hasAutoStarted = true;
        playButton.click();
      }
    },
    hide() {
      viewer?.stop();
      playing = false;
      cancelAnimationFrame(raf);
      playButton.textContent = '▶ 播放冷充流程';
    },
    reloadPattern() {
      viewer?.reloadPattern(studio.atlas);
    }
  };
}
