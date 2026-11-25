export type Child = Node | string | number | false | null | undefined;

export type Props<K extends keyof HTMLElementTagNameMap> =
  Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
    class?: string;
    dataset?: Record<string, string>;
    style?: string | Partial<CSSStyleDeclaration>;
    [key: string]: unknown;
  };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {} as Props<K>,
  children: Child[] | Child = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'style' && typeof value === 'string') {
      node.setAttribute('style', value);
    } else if (key.startsWith('aria-') || key.includes('-')) {
      node.setAttribute(key, String(value));
    } else {
      (node as unknown as Record<string, unknown>)[key] = value;
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === false || child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export interface SliderHandle {
  root: HTMLLabelElement;
  input: HTMLInputElement;
  value: HTMLSpanElement;
}

export function slider(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}): SliderHandle {
  const value = h('span', { class: 'control-value' });
  const format = options.format ?? ((v) => `${v}${options.unit ?? ''}`);
  const input = h('input', {
    type: 'range',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    value: String(options.value)
  }) as HTMLInputElement;
  const update = () => {
    const v = Number(input.value);
    value.textContent = format(v);
    options.onInput(v);
  };
  input.addEventListener('input', update);
  value.textContent = format(options.value);
  const root = h('label', { class: 'control slider-control' }, [
    h('span', { class: 'control-label-row' }, [
      h('span', {}, options.label),
      value
    ]),
    input
  ]);
  return { root, input, value };
}

export function toggle(options: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const input = h('input', { type: 'checkbox', checked: options.checked }) as HTMLInputElement;
  input.addEventListener('change', () => options.onChange(input.checked));
  return h('label', { class: 'control toggle-control' }, [
    input,
    h('span', {}, options.label),
    options.hint ? h('small', {}, options.hint) : null
  ]);
}

export function selectControl<T extends string>(options: {
  label: string;
  value: T;
  entries: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const select = h('select', {}, options.entries.map((e) =>
    h('option', { value: e.value, selected: e.value === options.value }, e.label)
  )) as HTMLSelectElement;
  select.addEventListener('change', () => options.onChange(select.value as T));
  return h('label', { class: 'control select-control' }, [
    h('span', {}, options.label),
    select
  ]);
}

export function button(label: string, onClick: () => void, variant = '') {
  return h('button', {
    class: `btn ${variant}`,
    type: 'button',
    onClick
  }, label);
}

export function metricCard(label: string, value: string, sub = '', tone = '') {
  const valueNode = h('strong', { class: `metric-value ${tone}` }, value);
  const subNode = h('span', { class: 'metric-sub' }, sub);
  return h('div', { class: `metric-card ${tone}` }, [
    h('span', { class: 'metric-label' }, label),
    valueNode,
    subNode
  ]);
}

export function setMetric(card: HTMLElement, value: string, sub?: string) {
  const v = card.querySelector('.metric-value');
  const s = card.querySelector('.metric-sub');
  if (v) v.textContent = value;
  if (sub != null && s) s.textContent = sub;
}
