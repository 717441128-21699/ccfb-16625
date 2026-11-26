export const GORE_COUNT = 20;
export const BLOCKS_PER_GORE = 60;
export const SUB_U = 8;
export const SUB_V = 2;

export const COLUMN_COUNT = GORE_COUNT * SUB_U + 1;
export const ROW_COUNT = BLOCKS_PER_GORE * SUB_V + 1;
export const VERTEX_COUNT = COLUMN_COUNT * ROW_COUNT;
export const SEGMENT_COUNT_U = COLUMN_COUNT - 1;
export const SEGMENT_COUNT_V = ROW_COUNT - 1;
export const INDEX_COUNT = SEGMENT_COUNT_U * SEGMENT_COUNT_V * 6;
export const COMPUTE_WORKGROUP = 64;

export type ShapeId = 'classic' | 'broad' | 'slender' | 'shoulder';
export type PatternId = 'regatta' | 'checker' | 'sun' | 'flame' | 'custom';
export type ViewMode = 'pattern' | 'shape' | 'cold' | 'check';
export type StrainView = 0 | 1 | 2 | 3;

export interface ShapePreset {
  id: ShapeId;
  name: string;
  description: string;
  height: number;
  radius: number;
  a: number;
  b: number;
  m: number;
  bulgeFactor: number;
}

export interface SolverParams {
  shape: ShapePreset;
  pressure: number;
  fabricStiffness: number;
  tapeStiffness: number;
  inflation: number;
  erection: number;
  time: number;
  bulgeScale: number;
  flame: number;
  strainView: StrainView;
  showTapes: boolean;
  showWireframe: boolean;
}

export interface ProfilePoint {
  r: number;
  y: number;
  t: number;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  {
    id: 'classic',
    name: '经典水滴',
    description: '高肩、圆顶、窄吹口，接近载客热气球的自然轮廓。',
    height: 17.2,
    radius: 6.15,
    a: 0.72,
    b: 1.05,
    m: 0.06,
    bulgeFactor: 0.92,
  },
  {
    id: 'broad',
    name: '宽体灯笼',
    description: '最大半径略向下移，容积更大，适合大面积色块和标志。',
    height: 14.8,
    radius: 7.25,
    a: 0.56,
    b: 0.82,
    m: 0.04,
    bulgeFactor: 0.9,
  },
  {
    id: 'slender',
    name: '修长探险',
    description: '较高的水滴轮廓，纵向线条和文字更挺拔。',
    height: 19.6,
    radius: 5.35,
    a: 0.96,
    b: 1.36,
    m: 0.1,
    bulgeFactor: 0.95,
  },
  {
    id: 'shoulder',
    name: '庆典高肩',
    description: '肩部饱满、顶部收束明显，给徽标和吉祥物留出展示面。',
    height: 16.4,
    radius: 6.75,
    a: 0.62,
    b: 1.22,
    m: 0.075,
    bulgeFactor: 0.94,
  },
];

export function getShape(id: ShapeId): ShapePreset {
  return SHAPE_PRESETS.find((s) => s.id === id) ?? SHAPE_PRESETS[0];
}

export function profileNormalizer(shape: ShapePreset): number {
  const tStar = Math.min(
    0.98,
    Math.max(0.02, (shape.b - shape.a * shape.m) / (shape.a + shape.b)),
  );
  return (
    Math.pow(tStar + shape.m, shape.b) *
    Math.pow(1 - tStar, shape.a)
  );
}

export function profileAt(tRaw: number, shape: ShapePreset): ProfilePoint {
  const t = Math.min(1, Math.max(0, tRaw));
  const norm = profileNormalizer(shape);
  const beta =
    Math.pow(t + shape.m, shape.b) * Math.pow(Math.max(0, 1 - t), shape.a);
  const r = (shape.radius * beta) / norm;
  return { r: Number.isFinite(r) ? r : 0, y: shape.height * t, t };
}

export interface MechanicsSample {
  t: number;
  radius: number;
  goreWidth: number;
  hoopForce: number;
  meridionalForce: number;
  hoopStrain: number;
  meridionalStrain: number;
  panelSag: number;
  tapeTension: number;
  tapeStrain: number;
}

export function mechanicsAt(
  t: number,
  params: Pick<
    SolverParams,
    'shape' | 'pressure' | 'fabricStiffness' | 'tapeStiffness' | 'inflation' | 'bulgeScale'
  >,
): MechanicsSample {
  const p = Math.max(0, params.pressure) * (0.12 + 0.88 * params.inflation);
  const profile = profileAt(t, params.shape);
  const r = Math.max(profile.r, 0.08);
  const goreWidth = (2 * Math.PI * r) / GORE_COUNT;

  // Thin pressure-membrane approximation. Hoop force follows p*r; meridional
  // force includes the axial pressure resultant and envelope self-weight.
  const hoopForce = p * r;
  const weightForce = 58 + 95 * t;
  const meridionalForce = 0.5 * p * r + weightForce;

  const hoopStrain = hoopForce / Math.max(1, params.fabricStiffness);
  const meridionalStrain =
    meridionalForce / Math.max(1, params.fabricStiffness);

  // Sinusoidal/catenary panel span between two longitudinal load tapes.
  const panelSag =
    ((p * goreWidth * goreWidth) / (8 * Math.max(80, hoopForce))) *
    params.shape.bulgeFactor *
    params.bulgeScale *
    params.inflation;

  const pressureResultant = (p * Math.PI * r * r) / GORE_COUNT;
  const tapeTension = pressureResultant + 430 + 520 * t;
  const tapeStrain = tapeTension / Math.max(1, params.tapeStiffness);

  return {
    t,
    radius: profile.r,
    goreWidth,
    hoopForce,
    meridionalForce,
    hoopStrain,
    meridionalStrain,
    panelSag,
    tapeTension,
    tapeStrain,
  };
}

export interface ContourReport {
  tapeDeviationPct: number;
  panelDeviationPct: number;
  maxSagMm: number;
  maxHoopStrainPct: number;
  maxMeridionalStrainPct: number;
  maxTapeTensionKn: number;
  theoreticalRadiusAtMax: number;
}

export function evaluateContour(params: SolverParams): ContourReport {
  let tapeDev = 0;
  let panelDev = 0;
  let sag = 0;
  let hoop = 0;
  let merid = 0;
  let tape = 0;
  let rMax = 1;

  for (let i = 2; i < 118; i++) {
    const t = i / 120;
    const m = mechanicsAt(t, params);
    const theoretical = profileAt(t, params.shape);
    rMax = Math.max(rMax, theoretical.r);

    const tapeRadius =
      theoretical.r * (1 + Math.min(0.04, m.hoopStrain)) +
      theoretical.y * m.meridionalStrain * 0; // vertical strain changes y, not tape r directly
    const tapeDelta = Math.abs(tapeRadius - theoretical.r);
    tapeDev = Math.max(tapeDev, (100 * tapeDelta) / params.shape.radius);

    const panelRadius = tapeRadius + m.panelSag;
    panelDev = Math.max(
      panelDev,
      (100 * Math.abs(panelRadius - theoretical.r)) / params.shape.radius,
    );
    sag = Math.max(sag, m.panelSag);
    hoop = Math.max(hoop, Math.abs(m.hoopStrain));
    merid = Math.max(merid, Math.abs(m.meridionalStrain));
    tape = Math.max(tape, m.tapeTension);
  }

  return {
    tapeDeviationPct: tapeDev,
    panelDeviationPct: panelDev,
    maxSagMm: sag * 1000,
    maxHoopStrainPct: hoop * 100,
    maxMeridionalStrainPct: merid * 100,
    maxTapeTensionKn: tape / 1000,
    theoreticalRadiusAtMax: rMax,
  };
}

export function coldTimeline(progress: number): {
  inflation: number;
  erection: number;
  phase: string;
  pressureScale: number;
} {
  const x = Math.min(1, Math.max(0, progress));
  const smooth = (a: number, b: number, v: number) => {
    const q = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return q * q * (3 - 2 * q);
  };

  if (x < 0.42) {
    return {
      inflation: smooth(0, 0.42, x) * 0.72,
      erection: 0,
      pressureScale: 0.55,
      phase: '地面冷充：风机送入冷空气，囊体在草地展开、布片逐渐绷紧',
    };
  }
  if (x < 0.62) {
    return {
      inflation: 0.72 + smooth(0.42, 0.62, x) * 0.28,
      erection: 0,
      pressureScale: 0.72,
      phase: '冷充饱满：二十条加强带开始清晰受力，囊体仍横卧在草地上',
    };
  }
  if (x < 0.72) {
    return {
      inflation: 1,
      erection: 0,
      pressureScale: 0.82,
      phase: '待命：冷空气使囊体保持轮廓，燃烧器准备点火',
    };
  }
  const q = smooth(0.72, 1, x);
  return {
    inflation: 1,
    erection: q,
    pressureScale: 0.82 + 0.18 * q,
    phase:
      q < 0.25
        ? '点火热充：热空气提高内外压差，加强带拉直'
        : q < 0.8
          ? '热充立起：球冠离开草地，吹口和吊篮保持在地面'
          : '完全立起：囊体达到理论自然轮廓，可转入空中视角',
  };
}
