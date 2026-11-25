import {
  BLOCKS, CROSS_PER_GORE, GORES, RING_COUNT, VERT_PER_BLOCK
} from '../config';

// The constants are injected once so TypeScript geometry and WGSL never drift.
export const SHADER_SOURCE = /* wgsl */ `
const GORES: u32 = ${GORES}u;
const BLOCKS: u32 = ${BLOCKS}u;
const SU: u32 = ${CROSS_PER_GORE}u;
const DU: u32 = ${CROSS_PER_GORE + 1}u;
const VPB: u32 = ${VERT_PER_BLOCK}u;
const RINGS: u32 = ${RING_COUNT}u;
const COLS: u32 = ${GORES}u * DU;
const VERTS: u32 = COLS * RINGS;
const PI: f32 = 3.141592653589793;

struct SimParams {
  a: vec4<f32>, // pressure, cloth stiffness, tape stiffness, inflation
  b: vec4<f32>, // rise, time, mouth height, ground Y
  c: vec4<f32>, // height, max radius, Z shift, bulge exaggeration
  d: vec4<f32>  // shape index, heatmap, tapes, guide ring
};

@group(0) @binding(0) var<uniform> sp: SimParams;
@group(0) @binding(1) var<storage, read> profileTable: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> deform: array<vec4<f32>>;

fn smooth01(x: f32) -> f32 {
  let t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Pressure / tensile-stiffness membrane solution plus flat-to-round deployment.
@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= VERTS) { return; }

  let j = id % RINGS;
  let col = id / RINGS;
  let g = col / DU;
  let k = col % DU;

  let t = f32(j) / f32(RINGS - 1u);
  let q = f32(k) / f32(SU);

  let pressure = sp.a.x;
  let fabricE = max(1000.0, sp.a.y);
  let tapeE = max(10000.0, sp.a.z);
  let inflation = clamp(sp.a.w, 0.0, 1.0);

  let rise = clamp(sp.b.x, 0.0, 1.0);
  let mouthH = sp.b.z;
  let groundY = sp.b.w;

  let height = sp.c.x;
  let rMax = sp.c.y;
  let zShift = sp.c.z;
  let bulgeGain = sp.c.w;

  let shapeOffset = u32(sp.d.x + 0.5) * RINGS;
  let prof = profileTable[shapeOffset + j];
  let axialN = prof.x;
  let rBase = max(0.05, prof.y * rMax);

  let pEff = pressure * inflation;
  let tapeStrain = clamp(0.5 * pEff * rBase / tapeE, -0.005, 0.012);
  let axial = mouthH + axialN * height * (1.0 + tapeStrain);

  // Chord between neighbouring reinforcement tapes at this station.
  let chord = 2.0 * rBase * sin(PI / f32(GORES));
  let bulgeRaw = pow(3.0 * pEff * pow(chord, 4.0) / (64.0 * fabricE), 1.0 / 3.0);
  let form = smooth01((inflation - 0.015) / 0.985);
  let bulgeMax = bulgeRaw * bulgeGain * form;
  let panel = pow(max(0.0, sin(PI * q)), 0.9);
  let bulge = bulgeMax * panel;
  let radius = rBase * (1.0 + tapeStrain) + bulge;
  let theta = 2.0 * PI * (f32(g) + q) / f32(GORES);

  // Upright aerostatic shape.
  let upright = vec3<f32>(cos(theta) * radius, axial, sin(theta) * radius);

  // Deflated tube folded to the grass. Opposite semicircles become two layers.
  var fold = theta - PI / 2.0;
  if (theta > PI) { fold = 3.0 * PI / 2.0 - theta; }
  let layerShift = 0.035 * select(0.0, 1.0, theta > PI);
  let flat = vec3<f32>(
    rBase * fold,
    groundY + 0.055 + layerShift + 0.012 * sin(t * PI),
    zShift + axialN * height
  );

  // Horizontal inflated envelope rests on its own lower cloth.
  let restRadius = rBase + bulgeMax;
  let lying = vec3<f32>(
    cos(theta) * radius,
    groundY + restRadius + sin(theta) * radius,
    zShift + axialN * height
  );
  let horizontal = mix(flat, lying, form);
  var world = mix(horizontal, upright, smooth01(rise));

  // Gentle ground contact safety.
  world.y = max(world.y, groundY + 0.025);

  positions[id] = vec4<f32>(world, 1.0);

  let strainU = 8.0 * bulgeMax * bulgeMax / (3.0 * max(chord * chord, 0.0025));
  let tensionHoop = pEff * rBase;
  let tapeMask = pow(1.0 - panel, 5.0);
  let stress01 = clamp(0.16 + tensionHoop / 2800.0 + tapeMask * 0.78 + abs(tapeStrain) * 12.0, 0.0, 1.0);
  deform[id] = vec4<f32>(bulge, strainU, tapeStrain, stress01);
}

@group(0) @binding(0) var<storage, read> normalPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> normals: array<vec4<f32>>;

fn wrappedColumn(g: u32, k: u32) -> u32 {
  return (g % GORES) * DU + clamp(k, 0u, SU);
}

@compute @workgroup_size(64)
fn computeNormals(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id >= VERTS) { return; }
  let j = id % RINGS;
  let col = id / RINGS;
  let g = col / DU;
  let k = col % DU;

  var cm: u32;
  var cp: u32;
  if (k == 0u) {
    cm = wrappedColumn(g + GORES - 1u, SU - 1u);
  } else {
    cm = col - 1u;
  }
  if (k == SU) {
    cp = wrappedColumn(g + 1u, 1u);
  } else {
    cp = col + 1u;
  }
  var jm = 0u;
  if (j > 0u) { jm = j - 1u; }
  let jp = min(j + 1u, RINGS - 1u);

  let pL = normalPositions[cm * RINGS + j].xyz;
  let pR = normalPositions[cp * RINGS + j].xyz;
  let pD = normalPositions[col * RINGS + jm].xyz;
  let pU = normalPositions[col * RINGS + jp].xyz;
  let tu = pR - pL;
  let tv = pU - pD;
  var n = cross(tu, tv);
  if (length(n) < 1e-6) { n = vec3<f32>(0.0, 1.0, 0.0); }
  normals[id] = vec4<f32>(normalize(n), 0.0);
}

struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>
};
@group(0) @binding(0) var<uniform> camera: Camera;

struct BalloonVSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) deform: vec4<f32>
};

@vertex
fn balloonVS(
  @location(0) pos: vec4<f32>,
  @location(1) nrm: vec4<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) deform: vec4<f32>
) -> BalloonVSOut {
  var out: BalloonVSOut;
  out.world = pos.xyz;
  out.normal = nrm.xyz;
  out.uv = uv;
  out.deform = deform;
  out.clip = camera.viewProj * vec4<f32>(pos.xyz, 1.0);
  return out;
}

@group(1) @binding(0) var<uniform> material: SimParams;
@group(1) @binding(1) var patternTexture: texture_2d<f32>;
@group(1) @binding(2) var patternSampler: sampler;

fn heatColor(x: f32) -> vec3<f32> {
  let c0 = vec3<f32>(0.08, 0.30, 0.95);
  let c1 = vec3<f32>(0.05, 0.85, 0.42);
  let c2 = vec3<f32>(1.0, 0.78, 0.12);
  let c3 = vec3<f32>(0.92, 0.08, 0.05);
  if (x < 0.42) { return mix(c0, c1, smoothstep(0.05, 0.42, x)); }
  if (x < 0.70) { return mix(c1, c2, smoothstep(0.42, 0.70, x)); }
  return mix(c2, c3, smoothstep(0.70, 1.0, x));
}

@fragment
fn balloonFS(
  in: BalloonVSOut,
  @builtin(front_facing) frontFacing: bool
) -> @location(0) vec4<f32> {
  var n = normalize(in.normal);
  if (!frontFacing) { n = -n; }

  var base = textureSample(patternTexture, patternSampler, in.uv).rgb;
  let heatOn = material.d.y > 0.5;
  if (heatOn) {
    let heat = heatColor(in.deform.w);
    let strainTint = clamp(in.deform.y * 18.0, 0.0, 1.0);
    base = mix(base, heat, 0.72);
    base = mix(base, vec3<f32>(1.0, 0.15, 0.85), strainTint * 0.28);
  }

  // Reinforcement webbing centered on gore boundaries.
  let goreQ = fract(in.uv.x * f32(GORES));
  let edgeDistance = min(goreQ, 1.0 - goreQ);
  let tape = 1.0 - smoothstep(0.014, 0.040, edgeDistance);
  if (material.d.z > 0.5) {
    let tapeColor = mix(vec3<f32>(0.10, 0.12, 0.16), vec3<f32>(0.95, 0.72, 0.20), 0.18 + 0.35 * in.deform.w);
    base = mix(base, tapeColor, tape * 0.92);
  }

  let lightDir = normalize(vec3<f32>(-0.45, 0.82, 0.36));
  let diffuse = max(dot(n, lightDir), 0.0);
  let hemi = 0.42 + 0.22 * (n.y * 0.5 + 0.5);
  let viewDir = normalize(camera.eye.xyz - in.world);
  let rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.2);
  let spec = pow(max(dot(reflect(-lightDir, n), viewDir), 0.0), 28.0) * 0.18;

  var color = base * (hemi + diffuse * 0.62);
  color += vec3<f32>(0.55, 0.72, 1.0) * rim * 0.22;
  color += vec3<f32>(1.0, 0.92, 0.72) * spec;
  return vec4<f32>(color, 1.0);
}

struct GroundVOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) uv: vec2<f32>
};

@vertex
fn groundVS(
  @location(0) pos: vec3<f32>,
  @location(1) uv: vec2<f32>
) -> GroundVOut {
  var out: GroundVOut;
  out.world = pos;
  out.uv = uv;
  out.clip = camera.viewProj * vec4<f32>(pos, 1.0);
  return out;
}

@group(1) @binding(0) var<uniform> groundParams: SimParams;

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn groundFS(in: GroundVOut) -> @location(0) vec4<f32> {
  let p = in.world.xz;
  let cell = floor(p * 0.42);
  let noise = hash2(cell);
  let fine = hash2(floor(p * 2.3));
  let mow = 0.88 + 0.12 * sin(in.world.z * 0.55 + sin(in.world.x * 0.08));
  var grass = mix(vec3<f32>(0.105, 0.285, 0.095), vec3<f32>(0.31, 0.52, 0.18), noise * 0.72 + fine * 0.16);
  grass *= mow;

  let rMax = groundParams.c.y;
  let height = groundParams.c.x;
  let zShift = groundParams.c.z;
  let rise = groundParams.b.x;
  let uprightShadow = exp(-(in.world.x * in.world.x + in.world.z * in.world.z) / (rMax * rMax * 1.55));
  let lieZ = zShift + height * 0.52;
  let dz = (in.world.z - lieZ) / (height * 0.58);
  let lieShadow = exp(-(in.world.x * in.world.x / (rMax * rMax * 1.8) + dz * dz));
  let shadow = mix(lieShadow, uprightShadow, rise) * 0.34;
  grass = mix(grass, vec3<f32>(0.045, 0.075, 0.035), shadow);

  let distanceFog = smoothstep(70.0, 150.0, length(camera.eye.xz - in.world.xz));
  grass = mix(grass, vec3<f32>(0.58, 0.75, 0.88), distanceFog * 0.55);
  return vec4<f32>(grass, 1.0);
}

struct LineColor { color: vec4<f32> };
@group(1) @binding(3) var<uniform> lineColor: LineColor;

@vertex
fn lineVS(@location(0) pos: vec4<f32>) -> @builtin(position) vec4<f32> {
  return camera.viewProj * vec4<f32>(pos.xyz, 1.0);
}

@fragment
fn lineFS() -> @location(0) vec4<f32> {
  return lineColor.color;
}
`;
