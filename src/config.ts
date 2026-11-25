// Global mesh and manufacturing constants.
// The envelope has GORES longitudinal pieces, each split into BLOCKS cloth rows.
export const GORES = 20;
export const BLOCKS = 60;
export const CROSS_PER_GORE = 12;
export const VERT_PER_BLOCK = 4;

export const RING_COUNT = BLOCKS * VERT_PER_BLOCK + 1; // 241
export const COLUMN_COUNT = GORES * (CROSS_PER_GORE + 1); // duplicated gore edges: 260
export const VERTEX_COUNT = RING_COUNT * COLUMN_COUNT; // 62,660

export const ATLAS_CELL_W = 192;
export const ATLAS_CELL_H = BLOCKS * 36; // 2160
export const ATLAS_W = ATLAS_CELL_W * GORES; // 3840
export const ATLAS_H = ATLAS_CELL_H;

export type ShapeId = 'natural' | 'broad' | 'teardrop';
export type PatternId = 'sky' | 'festival' | 'geo' | 'panda';
export type CameraPreset = 'ground' | 'side' | 'aerial' | 'front';

export interface SimSettings {
  shape: ShapeId;
  pattern: PatternId;
  pressure: number; // Pa across envelope
  stiffness: number; // N/m tensile stiffness of cloth
  tapeStiffness: number; // N/m longitudinal reinforcement
  inflation: number; // 0 flat, 1 design cold pressure
  rise: number; // 0 lying, 1 upright
  heatmap: boolean;
  showTapes: boolean;
  autoRotate: boolean;
  bulgeExaggeration: number;
  guideBlock: number;
  guideGore: number;
  resolutionScale: number; // 1 = CSS/DPR, 2 = forced 4K benchmark buffer
}

export const DEFAULT_SETTINGS: SimSettings = {
  shape: 'natural',
  pattern: 'sky',
  pressure: 300,
  stiffness: 240000,
  tapeStiffness: 4_800_000,
  inflation: 1,
  rise: 1,
  heatmap: false,
  showTapes: true,
  autoRotate: true,
  bulgeExaggeration: 1,
  guideBlock: 30,
  guideGore: 0,
  resolutionScale: 1
};

export interface GpuStats {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  vertices: number;
  triangles: number;
  computePasses: number;
}
