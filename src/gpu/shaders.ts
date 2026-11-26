import {
  BLOCKS_PER_GORE,
  COLUMN_COUNT,
  GORE_COUNT,
  ROW_COUNT,
} from '../balloon/model';

export const BALLOON_SHADER_SOURCE = /* wgsl */ `
const PI: f32 = 3.141592653589793;
const GORES: f32 = ${GORE_COUNT.toFixed(1)};
const BLOCKS: f32 = ${BLOCKS_PER_GORE.toFixed(1)};
const COLS: u32 = ${COLUMN_COUNT}u;
const ROWS: u32 = ${ROW_COUNT}u;
const VERTEX_COUNT: u32 = COLS * ROWS;

struct Vertex {
  pos: vec3f,
  pad0: f32,
  normal: vec3f,
  pad1: f32,
  uv: vec2f,
  strain: f32,
  stress: f32,
  data: vec4f,
};

struct SimUniforms {
  shape: vec4f,     // H, R, a, b
  shapeExtra: vec4f,// m, normalizer, bulgeFactor, unused
  mechanics: vec4f, // basePressure, fabricEA, tapeEA, bulgeScale
  anim: vec4f,      // inflation, erection, time, pressureScale
  options: vec4f,   // strainView, showTapes, showWireframe, unused
};

@group(0) @binding(0) var<uniform> sim: SimUniforms;
@group(0) @binding(1) var<storage, read_write> vertices: array<Vertex>;

fn profile_r(tRaw: f32) -> f32 {
  let t: f32 = clamp(tRaw, 0.0, 1.0);
  let rMax: f32 = sim.shape.y;
  let aa: f32 = sim.shape.z;
  let bb: f32 = sim.shape.w;
  let mm: f32 = sim.shapeExtra.x;
  let norm: f32 = sim.shapeExtra.y;
  let beta: f32 = pow(t + mm, bb) * pow(max(1.0 - t, 0.0), aa);
  return rMax * beta / norm;
}

fn surface_position(theta: f32, tRaw: f32) -> vec3f {
  let t: f32 = clamp(tRaw, 0.0, 1.0);
  let baseR: f32 = profile_r(t);
  let rUse: f32 = max(baseR, 0.08);

  let pressure: f32 = max(0.0, sim.mechanics.x * sim.anim.w * (0.12 + 0.88 * sim.anim.x));
  let fabricEA: f32 = max(1.0, sim.mechanics.y);

  // Pressure-membrane resultants. The axial term is retained for the report
  // and meridional strain; hoop force is the dominant panel load.
  let nHoop: f32 = pressure * rUse;
  let nMerid: f32 = 0.5 * pressure * rUse + 58.0 + 95.0 * t;
  let epsHoop: f32 = clamp(nHoop / fabricEA, -0.02, 0.075);
  let epsMerid: f32 = clamp(nMerid / fabricEA, -0.02, 0.06);

  let strainedR: f32 = baseR * (1.0 + epsHoop);
  let mouthY: f32 = 1.55;
  let strainedY: f32 = mouthY + sim.shape.x * t * (1.0 + 0.35 * epsMerid);

  // Panel span and catenary/sinusoidal sag between adjacent load tapes.
  let goreWidth: f32 = 2.0 * PI * rUse / GORES;
  let sagFormula: f32 = pressure * goreWidth * goreWidth / (8.0 * max(80.0, nHoop));
  let sag: f32 = clamp(
    sagFormula * sim.shapeExtra.z * sim.mechanics.w * sim.anim.x,
    0.0,
    0.34
  );

  let goreCoord: f32 = fract(theta / (2.0 * PI / GORES));
  let arch: f32 = pow(max(0.0, sin(PI * goreCoord)), 0.82);
  let blockCoord: f32 = fract(t * BLOCKS);
  let verticalPillow: f32 = 0.84 + 0.16 * pow(max(0.0, sin(PI * blockCoord)), 1.35);
  let bulge: f32 = sag * arch * verticalPillow;

  // Low-pressure cross-sections become wide and flat on the grass.
  let fillEase: f32 = smoothstep(0.02, 1.0, sim.anim.x);
  let flatScale: f32 = mix(0.07, 1.0, fillEase);
  let spreadScale: f32 = mix(1.32, 1.0, fillEase);
  let wrinkle: f32 = pow(1.0 - sim.anim.x, 2.0) *
    0.11 * sin(theta * 17.0 + t * 53.0 + sim.anim.z * 1.7);

  let radialCoeffX: f32 = strainedR * spreadScale + bulge + wrinkle;
  let radialCoeffZ: f32 = strainedR * flatScale + bulge * flatScale + wrinkle * flatScale;
  let localX: f32 = radialCoeffX * cos(theta);
  let localZ: f32 = radialCoeffZ * sin(theta);
  let localY: f32 = strainedY;

  // Rotate the longitudinal axis from horizontal (-Z when lying) to vertical.
  let lie: f32 = 1.0 - clamp(sim.anim.y, 0.0, 1.0);
  let rot: f32 = PI * 0.5 * lie;
  let c: f32 = cos(rot);
  let s: f32 = sin(rot);

  // Lift every elliptical cross-section so its lowest point touches y=0.
  let groundLift: f32 = radialCoeffZ * s;
  let worldY: f32 = localY * c + localZ * s + groundLift;
  let worldZ: f32 = -localY * s + localZ * c;
  return vec3f(localX, worldY, worldZ);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let index: u32 = gid.x;
  if (index >= VERTEX_COUNT) {
    return;
  }

  let col: u32 = index % COLS;
  let row: u32 = index / COLS;
  let u: f32 = f32(col) / f32(COLS - 1u);
  let t: f32 = f32(row) / f32(ROWS - 1u);
  let theta: f32 = u * 2.0 * PI;

  let p: vec3f = surface_position(theta, t);
  let epsA: f32 = 0.0018;
  let epsT: f32 = 0.0009;
  let pThetaPlus: vec3f = surface_position(theta + epsA, t);
  let pThetaMinus: vec3f = surface_position(theta - epsA, t);
  let pTPlus: vec3f = surface_position(theta, clamp(t + epsT, 0.0, 1.0));
  let pTMinus: vec3f = surface_position(theta, clamp(t - epsT, 0.0, 1.0));
  let tangentTheta: vec3f = pThetaPlus - pThetaMinus;
  let tangentT: vec3f = pTPlus - pTMinus;
  let cr: vec3f = cross(tangentTheta, tangentT);
  var normal: vec3f = vec3f(0.0, 1.0, 0.0);
  let normalLength: f32 = length(cr);
  if (normalLength > 0.000001) {
    normal = cr / normalLength;
  }

  let rUse: f32 = max(profile_r(t), 0.08);
  let pressure: f32 = max(0.0, sim.mechanics.x * sim.anim.w * (0.12 + 0.88 * sim.anim.x));
  let nHoop: f32 = pressure * rUse;
  let nMerid: f32 = 0.5 * pressure * rUse + 58.0 + 95.0 * t;
  let epsHoop: f32 = clamp(nHoop / max(1.0, sim.mechanics.y), -0.02, 0.075);
  let goreWidth: f32 = 2.0 * PI * rUse / GORES;
  let sag: f32 = clamp(
    pressure * goreWidth * goreWidth / (8.0 * max(80.0, nHoop)) *
      sim.shapeExtra.z * sim.mechanics.w * sim.anim.x,
    0.0,
    0.34
  );
  let tapeTension: f32 = pressure * PI * rUse * rUse / GORES + 430.0 + 520.0 * t;

  let gore: f32 = fract(u * GORES);
  let edge: f32 = min(gore, 1.0 - gore);
  let tapeMask: f32 = 1.0 - smoothstep(0.018, 0.06, edge);

  vertices[index].pos = p;
  vertices[index].pad0 = 1.0;
  vertices[index].normal = normal;
  vertices[index].pad1 = 0.0;
  vertices[index].uv = vec2f(u, 1.0 - t);
  vertices[index].strain = epsHoop;
  vertices[index].stress = nMerid;
  vertices[index].data = vec4f(tapeMask, sag, clamp(tapeTension / 3200.0, 0.0, 1.0), tapeTension);
}

struct FrameUniforms {
  viewProj: mat4x4f,
  cameraPos: vec4f,
  light: vec4f,
  options: vec4f,
};

@group(1) @binding(0) var<uniform> frame: FrameUniforms;
@group(2) @binding(0) var patternTexture: texture_2d<f32>;
@group(2) @binding(1) var patternSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) worldPos: vec3f,
  @location(3) strain: f32,
  @location(4) stress: f32,
  @location(5) data: vec4f,
};

@vertex
fn vs_main(
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) strain: f32,
  @location(4) stress: f32,
  @location(5) data: vec4f,
) -> VertexOutput {
  var out: VertexOutput;
  out.position = frame.viewProj * vec4f(pos, 1.0);
  out.uv = uv;
  out.normal = normal;
  out.worldPos = pos;
  out.strain = strain;
  out.stress = stress;
  out.data = data;
  return out;
}

fn heat_color(xIn: f32) -> vec3f {
  let x: f32 = clamp(xIn, 0.0, 1.0);
  let blue: vec3f = vec3f(0.05, 0.22, 0.82);
  let teal: vec3f = vec3f(0.05, 0.78, 0.62);
  let yellow: vec3f = vec3f(0.98, 0.82, 0.12);
  let red: vec3f = vec3f(0.88, 0.12, 0.08);
  if (x < 0.38) {
    return mix(blue, teal, x / 0.38);
  } else if (x < 0.72) {
    return mix(teal, yellow, (x - 0.38) / 0.34);
  }
  return mix(yellow, red, (x - 0.72) / 0.28);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  var base: vec3f = textureSample(patternTexture, patternSampler, in.uv).rgb;
  let viewMode: i32 = i32(frame.options.x + 0.5);

  if (viewMode == 1) {
    let strainPct: f32 = clamp(abs(in.strain) * 100.0 / 3.0, 0.0, 1.0);
    base = mix(base * 0.28, heat_color(strainPct), 0.88);
  } else if (viewMode == 2) {
    base = mix(vec3f(0.08, 0.12, 0.2), heat_color(in.data.z), 0.9);
  } else if (viewMode == 3) {
    let checker: f32 = f32((u32(in.uv.x * 40.0) + u32(in.uv.y * 120.0)) % 2u);
    base = mix(vec3f(0.88), vec3f(0.12, 0.45, 0.8), checker);
  }

  let t: f32 = 1.0 - in.uv.y;
  let goreCoord: f32 = in.uv.x * GORES;
  let goreFrac: f32 = fract(goreCoord);
  let goreEdge: f32 = min(goreFrac, 1.0 - goreFrac);
  let goreAA: f32 = fwidth(goreEdge);
  let tapeLine: f32 = 1.0 - smoothstep(0.026 - goreAA, 0.026 + goreAA, goreEdge);

  let blockFrac: f32 = fract(t * BLOCKS);
  let blockEdge: f32 = min(blockFrac, 1.0 - blockFrac);
  let blockAA: f32 = fwidth(blockEdge);
  let blockLine: f32 = 1.0 - smoothstep(0.018 - blockAA, 0.026 + blockAA, blockEdge);

  if (frame.options.z > 0.5) {
    let mu: f32 = min(fract(in.uv.x * 160.0), 1.0 - fract(in.uv.x * 160.0));
    let mv: f32 = min(fract(in.uv.y * 120.0), 1.0 - fract(in.uv.y * 120.0));
    let meshLine: f32 = max(
      1.0 - smoothstep(0.018, 0.04, mu),
      1.0 - smoothstep(0.018, 0.04, mv)
    );
    base = mix(base, vec3f(0.05, 0.08, 0.12), meshLine * 0.55);
  }

  base = mix(base, vec3f(0.08, 0.1, 0.13), blockLine * 0.28);
  if (frame.options.y > 0.5) {
    let tapeColor: vec3f = mix(vec3f(0.98, 0.76, 0.22), vec3f(1.0, 0.95, 0.62), in.data.z);
    base = mix(base, tapeColor, tapeLine * 0.92);
  } else {
    base = mix(base, vec3f(0.15, 0.18, 0.22), tapeLine * 0.35);
  }

  var normal: vec3f = normalize(in.normal);
  let viewDir: vec3f = normalize(frame.cameraPos.xyz - in.worldPos);
  if (dot(normal, viewDir) < 0.0) {
    normal = -normal;
  }
  let lightDir: vec3f = normalize(frame.light.xyz);
  let diffuse: f32 = max(dot(normal, lightDir), 0.0) * 0.72 +
    max(dot(-normal, lightDir), 0.0) * 0.16;
  let hemisphere: f32 = 0.46 + 0.18 * max(normal.y, 0.0);
  let specular: f32 = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 38.0) * 0.18;
  var color: vec3f = base * (hemisphere + diffuse) + vec3f(specular);

  // Distance fog blends the far grass and balloon into a soft sky horizon.
  let distanceToCamera: f32 = length(frame.cameraPos.xyz - in.worldPos);
  let fog: f32 = smoothstep(70.0, 150.0, distanceToCamera);
  color = mix(color, vec3f(0.72, 0.84, 0.94), fog * 0.65);
  color = pow(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
  return vec4f(color, 1.0);
}
`;

export const GROUND_SHADER_SOURCE = /* wgsl */ `
struct FrameUniforms {
  viewProj: mat4x4f,
  cameraPos: vec4f,
  light: vec4f,
  options: vec4f,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct GroundOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) uv: vec2f,
};

@vertex
fn vs_main(@location(0) pos: vec3f, @location(1) uv: vec2f) -> GroundOutput {
  var out: GroundOutput;
  out.position = frame.viewProj * vec4f(pos, 1.0);
  out.worldPos = pos;
  out.uv = uv;
  return out;
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn fs_main(in: GroundOutput) -> @location(0) vec4f {
  let p: vec2f = in.worldPos.xz;
  let stripe: f32 = 0.5 + 0.5 * sin(p.x * 0.55 + sin(p.y * 0.13) * 1.7);
  let noise: f32 = hash2(floor(p * 1.7)) * 0.16 + hash2(floor(p * 7.0)) * 0.06;
  var grass: vec3f = mix(vec3f(0.16, 0.36, 0.13), vec3f(0.34, 0.58, 0.22), stripe * 0.45 + noise);

  // Fine blade-like strokes.
  let blade: f32 = smoothstep(0.965, 1.0, sin(p.x * 11.0 + hash2(floor(p * 2.0)) * 6.283) * 0.5 + 0.5);
  grass += blade * vec3f(0.08, 0.12, 0.03);

  // Soft contact shadow around the mouth and the lying envelope region.
  let uprightShadow: f32 = exp(-dot(p * vec2f(0.16, 0.16), p * vec2f(0.16, 0.16)));
  let lyingShadow: f32 = exp(-((p.x * p.x) / 42.0 + ((p.y + 8.0) * (p.y + 8.0)) / 190.0));
  let shadow: f32 = max(uprightShadow * 0.32, lyingShadow * 0.22 * (1.0 - frame.cameraPos.w));
  grass *= 1.0 - shadow;

  let dist: f32 = length(frame.cameraPos.xz - p);
  let fog: f32 = smoothstep(55.0, 145.0, dist);
  grass = mix(grass, vec3f(0.72, 0.84, 0.94), fog * 0.85);
  grass = pow(clamp(grass, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
  return vec4f(grass, 1.0);
}
`;

export const SOLID_SHADER_SOURCE = /* wgsl */ `
struct FrameUniforms {
  viewProj: mat4x4f,
  cameraPos: vec4f,
  light: vec4f,
  options: vec4f,
};
struct ObjectUniforms {
  model: mat4x4f,
  color: vec4f,
  extra: vec4f,
};
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> obj: ObjectUniforms;

@vertex
fn vs_main(@location(0) pos: vec3f) -> @builtin(position) vec4f {
  let world: vec4f = obj.model * vec4f(pos, 1.0);
  return frame.viewProj * world;
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  var c: vec3f = obj.color.rgb;
  if (obj.extra.x > 0.5) {
    let flicker: f32 = 0.82 + 0.18 * sin(fragCoord.y * 0.09 + frame.options.w * 9.0);
    c *= flicker;
  }
  c = pow(c, vec3f(0.4545));
  return vec4f(c, obj.color.a);
}
`;
