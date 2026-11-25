import { GORES, RING_COUNT, type ShapeId } from '../config';

export interface ShapeDefinition {
  id: ShapeId;
  name: string;
  english: string;
  height: number;
  rMax: number;
  mouthRadius: number;
  volume: number;
  description: string;
  controls: ReadonlyArray<readonly [number, number]>;
}

// Radius control points are normalized by rMax; t=0 is the mouth and t=1 the crown.
// The classic table is the discretized aerostatic natural contour used by the GPU seams.
export const SHAPES: ShapeDefinition[] = [
  {
    id: 'natural',
    name: '经典水滴自然球',
    english: 'Aerostatic Natural 20',
    height: 22.0,
    rMax: 7.2,
    mouthRadius: 1.35,
    volume: 2650,
    description: '上中段饱满、顶部圆滑收尖，按热空气静压梯度与经线加强带载荷标定。',
    controls: [
      [0.0, 0.188], [0.04, 0.255], [0.10, 0.43], [0.18, 0.68],
      [0.28, 0.88], [0.40, 0.985], [0.50, 1.0], [0.62, 0.94],
      [0.74, 0.79], [0.84, 0.58], [0.92, 0.34], [0.97, 0.14], [1.0, 0.0]
    ]
  },
  {
    id: 'broad',
    name: '宽体庆典球',
    english: 'Broad Festival 2400',
    height: 18.6,
    rMax: 8.35,
    mouthRadius: 1.55,
    volume: 3180,
    description: '最大截面略下移，广告面积更大，适合大幅标志和环绕文字。',
    controls: [
      [0.0, 0.185], [0.05, 0.31], [0.13, 0.58], [0.24, 0.86],
      [0.36, 0.995], [0.46, 1.0], [0.59, 0.93], [0.72, 0.76],
      [0.83, 0.54], [0.92, 0.30], [0.97, 0.12], [1.0, 0.0]
    ]
  },
  {
    id: 'teardrop',
    name: '高瘦探索球',
    english: 'Tall Teardrop Explorer',
    height: 25.4,
    rMax: 6.15,
    mouthRadius: 1.18,
    volume: 2420,
    description: '长细比更高，经线曲率变化明显，用于检查纵向图案拉伸。',
    controls: [
      [0.0, 0.192], [0.05, 0.24], [0.13, 0.39], [0.23, 0.61],
      [0.35, 0.82], [0.48, 0.97], [0.58, 1.0], [0.69, 0.91],
      [0.80, 0.72], [0.89, 0.48], [0.96, 0.22], [1.0, 0.0]
    ]
  }
];

export function getShape(id: ShapeId): ShapeDefinition {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  );
}

export function radiusNormalizedAt(shape: ShapeDefinition, t: number): number {
  const c = shape.controls;
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < c.length - 2 && x > c[i + 1][0]) i++;
  const t1 = c[i][0];
  const t2 = c[i + 1][0];
  const u = t2 === t1 ? 0 : (x - t1) / (t2 - t1);
  const r0 = c[Math.max(0, i - 1)][1];
  const r1 = c[i][1];
  const r2 = c[i + 1][1];
  const r3 = c[Math.min(c.length - 1, i + 2)][1];
  return Math.max(0, catmullRom(r0, r1, r2, r3, u));
}

export function radiusAt(shape: ShapeDefinition, t: number): number {
  return radiusNormalizedAt(shape, t) * shape.rMax;
}

// Three profiles are packed one after another for a single storage buffer.
export function buildProfileBuffer(): Float32Array {
  const data = new Float32Array(SHAPES.length * RING_COUNT * 4);
  SHAPES.forEach((shape, s) => {
    for (let j = 0; j < RING_COUNT; j++) {
      const t = j / (RING_COUNT - 1);
      const o = (s * RING_COUNT + j) * 4;
      data[o + 0] = t;
      data[o + 1] = radiusNormalizedAt(shape, t);
      data[o + 2] = radiusAt(shape, t);
      data[o + 3] = shape.mouthRadius / shape.rMax;
    }
  });
  return data;
}

export function goreChord(radius: number): number {
  return 2 * Math.max(radius, 0.05) * Math.sin(Math.PI / GORES);
}

// Parabolic panel equilibrium: p = T*8h/L^2 and T = E*epsilon,
// epsilon = 8h^2/(3L^2), giving h^3 = 3pL^4/(64E).
export function predictedBulge(pressure: number, stiffness: number, radius: number): number {
  const l = goreChord(radius);
  const p = Math.max(0, pressure);
  const e = Math.max(1000, stiffness);
  return Math.cbrt((3 * p * l ** 4) / (64 * e));
}

export function bulgeStrain(bulge: number, radius: number): number {
  const l = goreChord(radius);
  return (8 * bulge * bulge) / (3 * l * l);
}

export interface DeviationReport {
  maxPercent: number;
  rmsPercent: number;
  samples: number;
  worstT: number;
  compliant: boolean;
}

// Compare measured seam radii against the theoretical normalized contour.
// Radius is normalized by measured maximum so a uniform elastic scale is not
// misclassified as shape error; local and station-to-station error remains.
export function compareToTheory(
  measured: Array<{ t: number; radius: number }>,
  shape: ShapeDefinition
): DeviationReport {
  const valid = measured.filter((p) => Number.isFinite(p.radius) && p.radius > 0.05);
  const measuredMax = Math.max(...valid.map((p) => p.radius), 1);
  let sumSq = 0;
  let max = 0;
  let worstT = 0;
  for (const p of valid) {
    const theory = radiusNormalizedAt(shape, p.t);
    if (theory < 0.035) continue; // crown singularity is not a manufacturing station
    const measuredN = p.radius / measuredMax;
    const err = Math.abs(measuredN - theory) / theory;
    sumSq += err * err;
    if (err > max) {
      max = err;
      worstT = p.t;
    }
  }
  const denom = Math.max(1, valid.length);
  const rms = Math.sqrt(sumSq / denom);
  return {
    maxPercent: max * 100,
    rmsPercent: rms * 100,
    samples: valid.length,
    worstT,
    compliant: max <= 0.02
  };
}
