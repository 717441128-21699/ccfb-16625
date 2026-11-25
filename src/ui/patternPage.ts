import { BLOCKS, GORES, type PatternId, type SimSettings } from '../config';
import type { DrawTool, PatternStudio } from '../core/patterns';
import { button, h, selectControl, slider, toggle } from './dom';

const TOOLS: Array<{ id: DrawTool; label: string; icon: string }> = [
  { id: 'free', label: '画笔', icon: '✏️' },
  { id: 'line', label: '直线', icon: '📏' },
  { id: 'rect', label: '矩形', icon: '▭' },
  { id: 'text', label: '文字', icon: 'T' },
  { id: 'stamp', label: '标志', icon: '★' },
  { id: 'eraser', label: '橡皮', icon: '⌫' }
];

const PATTERNS: Array<{ id: PatternId; name: string; desc: string; swatch: string }> = [
  { id: 'sky', name: '凌云竞速条纹', desc: '蓝白斜带、太阳与“凌云”竖排字', swatch: 'linear-gradient(135deg,#1677c8 0 42%,#ffd166 42% 55%,#ff6b4a 55% 70%,#eaf6ff 70%)' },
  { id: 'festival', name: '庆典红金福球', desc: '红金织带、福字与庆典云纹', swatch: 'linear-gradient(135deg,#8f1020,#d9273e 55%,#f6c453)' },
  { id: 'geo', name: '几何广告菱格', desc: '青橙菱形，适合标志和检测直线', swatch: 'linear-gradient(135deg,#0f3d4a 0 35%,#2ec4b6 35% 65%,#ff8a3d 65%)' },
  { id: 'panda', name: '熊猫团团定制', desc: '白底熊猫脸与竹绿裁片边', swatch: 'linear-gradient(135deg,#f7faf7 0 55%,#17191d 55% 70%,#58a55c 70%)' }
];

export function mountPatternPage(
  root: HTMLElement,
  studio: PatternStudio,
  settings: SimSettings,
  callbacks: { goShape: () => void; patternChanged: () => void }
) {
  root.innerHTML = '';
  studio.attachPointer();
  studio.editor.classList.add('pattern-editor-canvas');

  const goreLabel = h('strong', { class: 'gore-label' }, `第 ${studio.selectedGore + 1} / ${GORES} 条`);
  const goreRange = h('input', {
    type: 'range', min: '0', max: String(GORES - 1), value: String(studio.selectedGore),
    'aria-label': '选择裁片'
  }) as HTMLInputElement;

  const toolButtons = new Map<DrawTool, HTMLButtonElement>();
  const toolGrid = h('div', { class: 'tool-grid' }, TOOLS.map((tool) => {
    const btn = h('button', {
      class: `tool-btn ${tool.id === studio.tool ? 'active' : ''}`,
      type: 'button',
      onClick: () => {
        studio.tool = tool.id;
        toolButtons.forEach((b, id) => b.classList.toggle('active', id === tool.id));
      }
    }, [h('span', { class: 'tool-icon' }, tool.icon), h('span', {}, tool.label)]);
    toolButtons.set(tool.id, btn);
    return btn;
  }));

  const colorInput = h('input', {
    type: 'color', value: studio.color,
    onInput: ((e: Event) => { studio.color = (e.target as HTMLInputElement).value; }) as EventListener
  }) as HTMLInputElement;

  const brush = slider({
    label: '笔宽 / 字号基准', min: 2, max: 24, step: 1, value: studio.brushWidth, unit: 'px',
    onInput: (v) => { studio.brushWidth = v; }
  });

  const textInput = h('input', {
    class: 'text-input', type: 'text', value: studio.text, maxlength: '12',
    placeholder: '输入文字，点裁片放置',
    onInput: ((e: Event) => { studio.text = (e.target as HTMLInputElement).value; }) as EventListener
  }) as HTMLInputElement;

  const vertical = toggle({
    label: '竖排中文（≤4字）', checked: studio.verticalText,
    onChange: (v) => { studio.verticalText = v; }
  });

  const zoomValue = h('span', { class: 'control-value' }, '300 px');
  let zoom = 300;
  const setZoom = (z: number) => {
    zoom = Math.max(180, Math.min(560, z));
    studio.editor.style.width = `${zoom}px`;
    zoomValue.textContent = `${zoom} px`;
  };
  setZoom(zoom);

  goreRange.addEventListener('input', () => {
    studio.loadGore(Number(goreRange.value));
    goreLabel.textContent = `第 ${studio.selectedGore + 1} / ${GORES} 条`;
  });

  const atlasPreview = h('canvas', { width: 320, height: 180, class: 'atlas-preview' }) as HTMLCanvasElement;
  const redrawPreview = () => {
    const ctx = atlasPreview.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, atlasPreview.width, atlasPreview.height);
    ctx.drawImage(studio.atlas, 0, 0, atlasPreview.width, atlasPreview.height);
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= GORES; g++) {
      const x = (g / GORES) * atlasPreview.width;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, atlasPreview.height); ctx.stroke();
    }
  };
  studio.onChange = () => {
    redrawPreview();
    callbacks.patternChanged();
  };
  redrawPreview();

  const presetCards = PATTERNS.map((p) => h('button', {
    class: `pattern-card ${settings.pattern === p.id ? 'active' : ''}`,
    type: 'button',
    onClick: () => {
      settings.pattern = p.id;
      studio.paintAll(p.id);
      presetCards.forEach((card) => card.classList.toggle('active', card === document.activeElement || false));
      // Explicitly sync active classes without relying on focus.
      presetCards.forEach((card, i) => card.classList.toggle('active', PATTERNS[i].id === p.id));
      callbacks.patternChanged();
    }
  }, [
    h('span', { class: 'pattern-swatch', style: `background:${p.swatch}` }),
    h('strong', {}, p.name),
    h('small', {}, p.desc)
  ]));

  const left = h('aside', { class: 'panel pattern-tools' }, [
    h('div', { class: 'panel-head' }, [h('h2', {}, '平面裁片绘制'), h('p', {}, '坐标按材料经/纬向保存，充气后随膜单元一起拉伸。')]),
    h('section', { class: 'panel-section' }, [
      h('h3', {}, '工具'),
      toolGrid,
      h('div', { class: 'color-row' }, [h('label', {}, '颜色'), colorInput]),
      brush.root,
      textInput,
      vertical
    ]),
    h('section', { class: 'panel-section' }, [
      h('h3', {}, '裁片选择'),
      h('div', { class: 'gore-row' }, [
        button('◀', () => { goreRange.value = String((studio.selectedGore + GORES - 1) % GORES); goreRange.dispatchEvent(new Event('input')); }, 'icon-btn'),
        goreLabel,
        button('▶', () => { goreRange.value = String((studio.selectedGore + 1) % GORES); goreRange.dispatchEvent(new Event('input')); }, 'icon-btn')
      ]),
      goreRange,
      h('div', { class: 'button-row' }, [
        button('本裁片铺满全部20条', () => studio.applyEditorToAll(), 'secondary'),
        button('恢复此图案预设', () => studio.clearCurrentMarks(settings.pattern), 'ghost')
      ])
    ]),
    h('section', { class: 'panel-section spec-note' }, [
      h('h3', {}, '制造数据'),
      h('p', {}, `共 ${GORES} 条纵向裁片，每条 ${BLOCKS} 块布；编辑器中的横线对应布块缝合边，左右白边为加强带位置。`),
      h('p', {}, '直线工具可绘制检测线，到“图案变形检查”页读取 GPU 回读的实际弯曲。')
    ])
  ]);

  const stage = h('section', { class: 'pattern-stage panel' }, [
    h('div', { class: 'stage-toolbar' }, [
      h('div', {}, [h('strong', {}, '裁片 1:1 材料坐标'), h('span', { class: 'hint' }, '顶部为冠部，底部为口圈')]),
      h('div', { class: 'zoom-row' }, [
        button('－', () => setZoom(zoom - 60), 'icon-btn'),
        zoomValue,
        button('＋', () => setZoom(zoom + 60), 'icon-btn')
      ])
    ]),
    h('div', { class: 'editor-scroll' }, [studio.editor])
  ]);

  const right = h('aside', { class: 'panel pattern-library' }, [
    h('div', { class: 'panel-head' }, [h('h2', {}, '自编球形图案库'), h('p', {}, '四套图案均可继续手绘改字、加标志。')]),
    h('div', { class: 'pattern-card-grid' }, presetCards),
    h('section', { class: 'panel-section' }, [
      h('h3', {}, '20 条裁片 Atlas'),
      atlasPreview,
      h('p', { class: 'hint' }, 'Atlas 为 3840×2160，每条裁片 192×2160，直接作为 WebGPU 纹理输入。')
    ]),
    h('div', { class: 'panel-section cta' }, [
      button('保存并查看充气形状 →', callbacks.goShape, 'primary large')
    ])
  ]);

  root.append(h('div', { class: 'pattern-layout' }, [left, stage, right]));
}
