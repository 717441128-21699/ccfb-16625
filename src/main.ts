import './styles.css';
import { DEFAULT_SETTINGS, type SimSettings } from './config';
import { PatternStudio } from './core/patterns';
import { mountPatternPage } from './ui/patternPage';
import { createShapePage } from './ui/shapePage';
import { createColdPage } from './ui/coldPage';
import { createCheckPage } from './ui/checkPage';
import type { PageHandle } from './ui/types';

type PageId = 'pattern' | 'shape' | 'cold' | 'check';

const settings: SimSettings = { ...DEFAULT_SETTINGS };
const studio = new PatternStudio(settings.pattern);

const pageRoots = {
  pattern: document.querySelector<HTMLElement>('#page-pattern')!,
  shape: document.querySelector<HTMLElement>('#page-shape')!,
  cold: document.querySelector<HTMLElement>('#page-cold')!,
  check: document.querySelector<HTMLElement>('#page-check')!
};

const handles: Partial<Record<PageId, PageHandle>> = {};

function notifyPatternChanged() {
  handles.shape?.reloadPattern?.();
  handles.cold?.reloadPattern?.();
  handles.check?.reloadPattern?.();
}

mountPatternPage(pageRoots.pattern, studio, settings, {
  goShape: () => switchPage('shape'),
  patternChanged: notifyPatternChanged
});
handles.shape = createShapePage(pageRoots.shape, { studio, settings, onPatternChange: notifyPatternChanged });
handles.cold = createColdPage(pageRoots.cold, { studio, settings, onPatternChange: notifyPatternChanged });
handles.check = createCheckPage(pageRoots.check, { studio, settings, onPatternChange: notifyPatternChanged });

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));

function switchPage(id: PageId) {
  const current = tabs.find((t) => t.classList.contains('active'))?.dataset.page as PageId | undefined;
  if (current && current !== id) handles[current]?.hide();

  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.page === id));
  (Object.keys(pageRoots) as PageId[]).forEach((key) => {
    pageRoots[key].classList.toggle('active', key === id);
  });

  const handle = handles[id];
  if (handle) {
    void handle.show();
    document.querySelector('#globalStatus')!.textContent =
      id === 'pattern' ? '图案编辑：Canvas 2D，输出 WebGPU 纹理' : '计算/渲染：WebGPU compute + render';
  } else {
    document.querySelector('#globalStatus')!.textContent = '裁片图案页：20 × 60 材料坐标';
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchPage(tab.dataset.page as PageId));
});

async function detectGpu() {
  const badge = document.querySelector<HTMLElement>('#gpuBadge')!;
  if (!navigator.gpu) {
    badge.textContent = 'WebGPU 不可用';
    badge.classList.add('bad');
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no adapter');
    badge.textContent = `WebGPU 就绪 · ${adapter.info?.description || adapter.info?.vendor || 'GPU'}`;
    badge.classList.add('good');
  } catch {
    badge.textContent = 'WebGPU 适配器不可用';
    badge.classList.add('bad');
  }
}

void detectGpu();
switchPage('pattern');
