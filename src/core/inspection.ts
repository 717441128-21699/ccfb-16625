import {
  BLOCKS, CROSS_PER_GORE, GORES, RING_COUNT
} from '../config';
import {
  bulgeStrain, compareToTheory, goreChord, predictedBulge, type ShapeDefinition
} from './profiles';

export type Vec3 = [number, number, number];

export function ringForBlock(block: number): number {
  const b = Math.max(1, Math.min(BLOCKS, block));
  const t = (b - 0.5) / BLOCKS;
  return Math.max(0, Math.min(RING_COUNT - 1, Math.round(t * (RING_COUNT - 1))));
}

function vertexId(col: number, j: number): number {
  return col * RING_COUNT + j;
}

export function readVec3(positions: Float32Array, id: number): Vec3 {
  const o = id * 4;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

export interface SeamProfilePoint { t: number; radius: number; y: number }

export function extractSeamProfile(positions: Float32Array): SeamProfilePoint[] {
  const result: SeamProfilePoint[] = [];
  const du = CROSS_PER_GORE + 1;
  for (let j = 2; j < RING_COUNT - 2; j += 2) {
    let r = 0;
    let y = 0;
    for (let g = 0; g < GORES; g++) {
      const p = readVec3(positions, vertexId(g * du, j));
      r += Math.hypot(p[0], p[2]);
      y += p[1];
    }
    r /= GORES;
    y /= GORES;
    result.push({ t: j / (RING_COUNT - 1), radius: r, y });
  }
  return result;
}

export function profileReportFromGpu(positions: Float32Array, shape: ShapeDefinition) {
  return compareToTheory(extractSeamProfile(positions), shape);
}

export interface GuideAnalysis {
  gore: number;
  block: number;
  ring: number;
  points: Vec3[];
  chordA: Vec3;
  chordB: Vec3;
  chordLength: number;
  measuredSag: number;
  predictedBulge: number;
  baseArcSag: number;
  predictedSag: number;
  sagErrorPercent: number;
  measuredStrain: number;
  predictedStrain: number;
  radius: number;
  chart: Array<{ x: number; s: number }>;
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s]; }

export function analyzeGuide(
  positions: Float32Array,
  deform: Float32Array,
  gore: number,
  block: number,
  shape: ShapeDefinition,
  pressure: number,
  stiffness: number
): GuideAnalysis {
  const j = ringForBlock(block);
  const du = CROSS_PER_GORE + 1;
  const g = Math.max(0, Math.min(GORES - 1, gore));
  const points: Vec3[] = [];
  for (let k = 0; k <= CROSS_PER_GORE; k++) {
    points.push(readVec3(positions, vertexId((g * du + k), j)));
  }
  const a = points[0];
  const b = points[points.length - 1];
  const ab = sub(b, a);
  const chordLength = norm(ab);
  const e = scale(ab, 1 / Math.max(chordLength, 1e-6));
  const mid = points[Math.floor(points.length / 2)];
  const am = sub(mid, a);
  let normal = sub(am, scale(e, dot(am, e)));
  const normalLength = norm(normal);
  normal = normalLength > 1e-6 ? scale(normal, 1 / normalLength) : [0, 1, 0];

  let measuredSag = 0;
  const chart: Array<{ x: number; s: number }> = [];
  for (const p of points) {
    const ap = sub(p, a);
    const x = dot(ap, e);
    const s = dot(ap, normal);
    chart.push({ x, s });
    measuredSag = Math.max(measuredSag, Math.abs(s));
  }

  // Radius at this station from the axis; use the two seam points.
  const radius = (Math.hypot(a[0], a[2]) + Math.hypot(b[0], b[2])) * 0.5;
  const theoryRadius = shape.rMax * Math.max(0.05, radius / Math.max(1, shape.rMax));
  const effectiveRadius = Number.isFinite(radius) && radius > 0.2 ? radius : theoryRadius;
  const predictedBulgeValue = predictedBulge(pressure, stiffness, effectiveRadius);
  const halfAngle = Math.PI / GORES;
  const baseArcSag = effectiveRadius * (1 - Math.cos(halfAngle));
  const predictedSag = baseArcSag + predictedBulgeValue;
  const sagErrorPercent = (Math.abs(measuredSag - predictedSag) / Math.max(predictedSag, 1e-6)) * 100;

  const midId = vertexId(g * du + CROSS_PER_GORE / 2, j);
  const measuredStrain = deform[midId * 4 + 1];
  const predictedStrain = bulgeStrain(predictedBulgeValue, effectiveRadius);

  return {
    gore: g, block, ring: j, points, chordA: a, chordB: b, chordLength,
    measuredSag, predictedBulge: predictedBulgeValue, baseArcSag, predictedSag,
    sagErrorPercent, measuredStrain, predictedStrain, radius: effectiveRadius, chart
  };
}

export function analyzeBlocks(
  positions: Float32Array,
  deform: Float32Array,
  shape: ShapeDefinition,
  pressure: number,
  stiffness: number,
  gore: number,
  blocks: number[]
): GuideAnalysis[] {
  return blocks.map((b) => analyzeGuide(positions, deform, gore, b, shape, pressure, stiffness));
}

export function formatMm(v: number): string {
  return `${Math.round(v * 1000)} mm`;
}

export function chordSpan(radius: number): number {
  return goreChord(radius);
}
