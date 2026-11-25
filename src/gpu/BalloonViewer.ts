import { mat4 } from 'wgpu-matrix';
import {
  BLOCKS, COLUMN_COUNT, CROSS_PER_GORE, GORES, RING_COUNT, VERTEX_COUNT,
  type CameraPreset, type GpuStats, type SimSettings
} from '../config';
import { buildProfileBuffer, getShape, SHAPES } from '../core/profiles';
import { SHADER_SOURCE } from './shaders';

export interface InspectionData {
  positions: Float32Array;
  deform: Float32Array;
}

interface ViewerOptions {
  canvas: HTMLCanvasElement;
  pattern: HTMLCanvasElement;
  settings: SimSettings;
  followDeployment?: boolean;
  onStats?: (stats: GpuStats) => void;
}

const WORKGROUP = 64;

export class BalloonViewer {
  private canvas: HTMLCanvasElement;
  private patternCanvas: HTMLCanvasElement;
  private settings: SimSettings;
  private followDeployment: boolean;
  private onStats?: (stats: GpuStats) => void;

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;

  private paramsBuffer!: GPUBuffer;
  private cameraBuffer!: GPUBuffer;
  private profileBuffer!: GPUBuffer;
  private positionBuffer!: GPUBuffer;
  private normalBuffer!: GPUBuffer;
  private uvBuffer!: GPUBuffer;
  private deformBuffer!: GPUBuffer;
  private indexBuffer!: GPUBuffer;
  private groundVertexBuffer!: GPUBuffer;
  private groundIndexBuffer!: GPUBuffer;
  private guideIndexBuffer!: GPUBuffer;
  private lineColorABuffer!: GPUBuffer;
  private lineColorBBuffer!: GPUBuffer;
  private patternTexture!: GPUTexture;
  private sampler!: GPUSampler;

  private simPipeline!: GPUComputePipeline;
  private normalPipeline!: GPUComputePipeline;
  private simBindGroup!: GPUBindGroup;
  private normalBindGroup!: GPUBindGroup;
  private balloonPipeline!: GPURenderPipeline;
  private cameraBindGroup!: GPUBindGroup;
  private materialBindGroup!: GPUBindGroup;
  private groundPipeline!: GPURenderPipeline;
  private groundCameraBindGroup!: GPUBindGroup;
  private groundMaterialBindGroup!: GPUBindGroup;
  private linePipeline!: GPURenderPipeline;
  private lineCameraBindGroup!: GPUBindGroup;
  private lineColorABindGroup!: GPUBindGroup;
  private lineColorBBindGroup!: GPUBindGroup;

  private paramsData = new Float32Array(16);
  private cameraData = new Float32Array(20);
  private indexCount = 0;
  private guideIndexCount = CROSS_PER_GORE * 2 + 2;

  private observer: ResizeObserver | null = null;
  private raf = 0;
  private running = false;
  private ready = false;
  private disposed = false;

  private yaw = 0.72;
  private pitch = 0.24;
  private distance = 43;
  private target = new Float32Array([0, 10.2, 0]);
  private drag: { x: number; y: number; id: number } | null = null;

  private lastTime = 0;
  private fpsFrames = 0;
  private fpsElapsed = 0;
  private lastFps = 0;
  private lastGuideKey = '';
  private width = 1;
  private height = 1;

  constructor(options: ViewerOptions) {
    this.canvas = options.canvas;
    this.patternCanvas = options.pattern;
    this.settings = options.settings;
    this.followDeployment = options.followDeployment ?? false;
    this.onStats = options.onStats;
    if (this.settings.rise < 0.5) {
      this.target = new Float32Array([0, 7.2, 11.5]);
      this.yaw = Math.PI / 2;
      this.pitch = 0.20;
      this.distance = 47;
    }
  }

  async init(): Promise<void> {
    if (!navigator.gpu) throw new Error('当前浏览器没有暴露 navigator.gpu，请使用最新版 Chrome/Edge 并启用 WebGPU。');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('未找到可用的 WebGPU 适配器。');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (!this.disposed) console.error('WebGPU device lost:', info.message, info.reason);
    });

    const context = this.canvas.getContext('webgpu');
    if (!context) throw new Error('无法取得 WebGPU canvas context。');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });

    this.createBuffersAndGeometry();
    this.createPatternTexture();
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      maxAnisotropy: 1
    });
    await this.createPipelines();
    this.createBindGroups();
    this.bindPointer();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvas);
    this.resize();
    this.updateGuideIndex(true);
    this.ready = true;
  }

  start() {
    if (!this.ready || this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.running || this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.frame(dt, now / 1000);
      this.trackFps(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.observer?.disconnect();
    this.unbindPointer();
    this.depthTexture?.destroy();
    this.patternTexture?.destroy();
    this.device?.destroy?.();
  }

  reloadPattern(source?: HTMLCanvasElement) {
    if (source) this.patternCanvas = source;
    if (!this.device || !this.patternTexture) return;
    this.device.queue.copyExternalImageToTexture(
      { source: this.patternCanvas, flipY: true },
      { texture: this.patternTexture },
      { width: this.patternCanvas.width, height: this.patternCanvas.height }
    );
  }

  setCameraPreset(preset: CameraPreset) {
    const cold = this.settings.rise < 0.55;
    if (preset === 'ground') {
      this.target = cold ? new Float32Array([0, 4.2, 12.5]) : new Float32Array([0, 8.2, 0]);
      this.yaw = cold ? 1.18 : 0.62;
      this.pitch = 0.07;
      this.distance = cold ? 46 : 35;
    } else if (preset === 'side') {
      this.target = cold ? new Float32Array([0, 7.0, 11.5]) : new Float32Array([0, 10.5, 0]);
      this.yaw = Math.PI / 2;
      this.pitch = 0.18;
      this.distance = 42;
    } else if (preset === 'front') {
      this.target = cold ? new Float32Array([0, 6.5, 10]) : new Float32Array([0, 10.2, 0]);
      this.yaw = 0;
      this.pitch = 0.16;
      this.distance = 40;
    } else {
      this.target = cold ? new Float32Array([0, 6.0, 11.5]) : new Float32Array([0, 9.0, 0]);
      this.yaw = 0.85;
      this.pitch = 0.92;
      this.distance = 55;
    }
  }

  setGuide(gore: number, block: number) {
    this.settings.guideGore = gore;
    this.settings.guideBlock = block;
    this.updateGuideIndex(true);
  }

  setForced4k(enabled: boolean) {
    this.settings.resolutionScale = enabled ? 2 : 1;
    this.resize();
  }

  refreshSize() {
    this.resize();
  }

  async readInspection(): Promise<InspectionData> {
    if (!this.device) throw new Error('WebGPU 尚未初始化');
    await this.device.queue.onSubmittedWorkDone();
    const posStaging = this.device.createBuffer({
      size: this.positionBuffer.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    const defStaging = this.device.createBuffer({
      size: this.deformBuffer.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.positionBuffer, 0, posStaging, 0, this.positionBuffer.size);
    encoder.copyBufferToBuffer(this.deformBuffer, 0, defStaging, 0, this.deformBuffer.size);
    this.device.queue.submit([encoder.finish()]);
    await Promise.all([posStaging.mapAsync(GPUMapMode.READ), defStaging.mapAsync(GPUMapMode.READ)]);
    const positions = new Float32Array(posStaging.getMappedRange()).slice();
    const deform = new Float32Array(defStaging.getMappedRange()).slice();
    posStaging.unmap();
    defStaging.unmap();
    posStaging.destroy();
    defStaging.destroy();
    return { positions, deform };
  }

  // ---------------------------------------------------------------- buffers

  private createBuffersAndGeometry() {
    const vertexFloats = VERTEX_COUNT * 4;
    this.paramsBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.cameraBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.profileBuffer = this.makeBuffer(buildProfileBuffer(), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.positionBuffer = this.device.createBuffer({
      size: vertexFloats * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC
    });
    this.normalBuffer = this.device.createBuffer({
      size: vertexFloats * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
    });
    this.deformBuffer = this.device.createBuffer({
      size: vertexFloats * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC
    });

    const uv = new Float32Array(VERTEX_COUNT * 2);
    for (let col = 0; col < COLUMN_COUNT; col++) {
      const g = Math.floor(col / (CROSS_PER_GORE + 1));
      const k = col % (CROSS_PER_GORE + 1);
      for (let j = 0; j < RING_COUNT; j++) {
        const id = col * RING_COUNT + j;
        uv[id * 2 + 0] = (g + k / CROSS_PER_GORE) / GORES;
        uv[id * 2 + 1] = j / (RING_COUNT - 1);
      }
    }
    this.uvBuffer = this.makeBuffer(uv, GPUBufferUsage.VERTEX);

    const indices: number[] = [];
    const du = CROSS_PER_GORE + 1;
    for (let g = 0; g < GORES; g++) {
      for (let k = 0; k < CROSS_PER_GORE; k++) {
        for (let j = 0; j < RING_COUNT - 1; j++) {
          const a = (g * du + k) * RING_COUNT + j;
          const b = (g * du + k + 1) * RING_COUNT + j;
          const c = a + 1;
          const d = b + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
    }
    this.indexCount = indices.length;
    this.indexBuffer = this.makeBuffer(new Uint32Array(indices), GPUBufferUsage.INDEX);

    // Large grass plane, z range leaves room for the horizontal envelope.
    const gv = new Float32Array([
      -130, 0, -45, 0, 0,
       130, 0, -45, 1, 0,
      -130, 0, 145, 0, 1,
       130, 0, 145, 1, 1
    ]);
    this.groundVertexBuffer = this.makeBuffer(gv, GPUBufferUsage.VERTEX);
    this.groundIndexBuffer = this.makeBuffer(new Uint32Array([0, 1, 2, 1, 3, 2]), GPUBufferUsage.INDEX);

    this.guideIndexBuffer = this.device.createBuffer({
      size: this.guideIndexCount * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    this.lineColorABuffer = this.makeBuffer(new Float32Array([1.0, 0.86, 0.16, 1]), GPUBufferUsage.UNIFORM);
    this.lineColorBBuffer = this.makeBuffer(new Float32Array([0.1, 0.95, 1.0, 1]), GPUBufferUsage.UNIFORM);
  }

  private makeBuffer(data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true
    });
    new (data.constructor as Float32ArrayConstructor | Uint32ArrayConstructor)(buffer.getMappedRange()).set(data as never);
    buffer.unmap();
    return buffer;
  }

  private createPatternTexture() {
    this.patternTexture = this.device.createTexture({
      size: { width: this.patternCanvas.width, height: this.patternCanvas.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.reloadPattern();
  }

  // --------------------------------------------------------------- pipelines

  private async createPipelines() {
    const module = this.device.createShaderModule({ code: SHADER_SOURCE });
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      const text = `WGSL ${message.type} line ${message.lineNum}:${message.linePos} ${message.message}`;
      if (message.type === 'error') {
        console.error(text);
        throw new Error(text);
      }
      console.warn(text);
    }

    this.simPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'simulate' }
    });
    this.normalPipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'computeNormals' }
    });

    this.balloonPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'balloonVS',
        buffers: [
          { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }] }
        ]
      },
      fragment: {
        module,
        entryPoint: 'balloonFS',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    });

    this.groundPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'groundVS',
        buffers: [{
          arrayStride: 20,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' }
          ]
        }]
      },
      fragment: {
        module,
        entryPoint: 'groundFS',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    });

    this.linePipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'lineVS',
        buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }]
      },
      fragment: {
        module,
        entryPoint: 'lineFS',
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' }
    });
  }

  private createBindGroups() {
    this.simBindGroup = this.device.createBindGroup({
      layout: this.simPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.profileBuffer } },
        { binding: 2, resource: { buffer: this.positionBuffer } },
        { binding: 3, resource: { buffer: this.deformBuffer } }
      ]
    });
    this.normalBindGroup = this.device.createBindGroup({
      layout: this.normalPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.positionBuffer } },
        { binding: 1, resource: { buffer: this.normalBuffer } }
      ]
    });
    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.balloonPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
    });
    this.materialBindGroup = this.device.createBindGroup({
      layout: this.balloonPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: this.patternTexture.createView() },
        { binding: 2, resource: this.sampler }
      ]
    });
    this.groundCameraBindGroup = this.device.createBindGroup({
      layout: this.groundPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
    });
    this.groundMaterialBindGroup = this.device.createBindGroup({
      layout: this.groundPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: this.paramsBuffer } }]
    });
    this.lineCameraBindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }]
    });
    this.lineColorABindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(1),
      entries: [{ binding: 3, resource: { buffer: this.lineColorABuffer } }]
    });
    this.lineColorBBindGroup = this.device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(1),
      entries: [{ binding: 3, resource: { buffer: this.lineColorBBuffer } }]
    });
  }

  // ------------------------------------------------------------------ frame

  private resize() {
    if (!this.device || !this.canvas.isConnected) return;
    const force4k = this.settings.resolutionScale >= 2;
    const rect = this.canvas.getBoundingClientRect();
    let w: number;
    let h: number;
    if (force4k) {
      w = 3840;
      h = 2160;
      this.canvas.style.objectFit = 'contain';
    } else {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(rect.width * dpr));
      h = Math.max(1, Math.floor(rect.height * dpr));
      this.canvas.style.objectFit = 'fill';
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.width = w;
      this.height = h;
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: { width: w, height: h },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.depthView = this.depthTexture.createView();
    }
  }

  private updateUniforms(time: number) {
    const s = this.settings;
    const shape = getShape(s.shape);
    const shapeIndex = Math.max(0, SHAPES.findIndex((x) => x.id === s.shape));
    this.paramsData.set([
      s.pressure, s.stiffness, s.tapeStiffness, s.inflation,
      s.rise, time, 2.35, 0,
      shape.height, shape.rMax, 0, s.bulgeExaggeration,
      shapeIndex, s.heatmap ? 1 : 0, s.showTapes ? 1 : 0, s.guideBlock
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);

    if (s.autoRotate && !this.drag) this.yaw += 0.0016 * 60 * 0.016;
    if (this.followDeployment) {
      const r = s.rise;
      this.target[0] = 0;
      this.target[1] = 6.6 + r * 3.8;
      this.target[2] = 11.6 * (1 - r);
    }
    const cp = Math.cos(this.pitch);
    const eye: [number, number, number] = [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw)
    ];
    const proj = mat4.perspective((48 * Math.PI) / 180, this.width / Math.max(1, this.height), 0.1, 280);
    const view = mat4.lookAt(eye, [this.target[0], this.target[1], this.target[2]], [0, 1, 0]);
    const vp = mat4.multiply(proj, view) as Float32Array;
    this.cameraData.set(vp, 0);
    this.cameraData[16] = eye[0];
    this.cameraData[17] = eye[1];
    this.cameraData[18] = eye[2];
    this.cameraData[19] = 1;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, this.cameraData);
  }

  private updateGuideIndex(force = false) {
    if (!this.device) return;
    const s = this.settings;
    const key = `${s.guideGore}:${s.guideBlock}`;
    if (!force && key === this.lastGuideKey) return;
    this.lastGuideKey = key;
    const block = Math.max(1, Math.min(BLOCKS, s.guideBlock));
    const t = (block - 0.5) / BLOCKS;
    const j = Math.max(0, Math.min(RING_COUNT - 1, Math.round(t * (RING_COUNT - 1))));
    const g = Math.max(0, Math.min(GORES - 1, s.guideGore));
    const du = CROSS_PER_GORE + 1;
    const data = new Uint32Array(this.guideIndexCount);
    let p = 0;
    for (let k = 0; k < CROSS_PER_GORE; k++) {
      data[p++] = (g * du + k) * RING_COUNT + j;
      data[p++] = (g * du + k + 1) * RING_COUNT + j;
    }
    // Chord between the two tapes.
    data[p++] = (g * du) * RING_COUNT + j;
    data[p++] = (g * du + CROSS_PER_GORE) * RING_COUNT + j;
    this.device.queue.writeBuffer(this.guideIndexBuffer, 0, data);
  }

  private frame(dt: number, time: number) {
    if (this.canvas.width === 0) this.resize();
    this.updateGuideIndex();
    this.updateUniforms(time);

    const encoder = this.device.createCommandEncoder();
    const dispatchCount = Math.ceil(VERTEX_COUNT / WORKGROUP);

    const simPass = encoder.beginComputePass();
    simPass.setPipeline(this.simPipeline);
    simPass.setBindGroup(0, this.simBindGroup);
    simPass.dispatchWorkgroups(dispatchCount);
    simPass.end();

    const normalPass = encoder.beginComputePass();
    normalPass.setPipeline(this.normalPipeline);
    normalPass.setBindGroup(0, this.normalBindGroup);
    normalPass.dispatchWorkgroups(dispatchCount);
    normalPass.end();

    const view = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.62, g: 0.78, b: 0.92, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });

    renderPass.setPipeline(this.groundPipeline);
    renderPass.setBindGroup(0, this.groundCameraBindGroup);
    renderPass.setBindGroup(1, this.groundMaterialBindGroup);
    renderPass.setVertexBuffer(0, this.groundVertexBuffer);
    renderPass.setIndexBuffer(this.groundIndexBuffer, 'uint32');
    renderPass.drawIndexed(6);

    renderPass.setPipeline(this.balloonPipeline);
    renderPass.setBindGroup(0, this.cameraBindGroup);
    renderPass.setBindGroup(1, this.materialBindGroup);
    renderPass.setVertexBuffer(0, this.positionBuffer);
    renderPass.setVertexBuffer(1, this.normalBuffer);
    renderPass.setVertexBuffer(2, this.uvBuffer);
    renderPass.setVertexBuffer(3, this.deformBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(this.indexCount);

    // Inspected cloth curve (yellow) and its tape-to-tape chord (cyan).
    renderPass.setPipeline(this.linePipeline);
    renderPass.setBindGroup(0, this.lineCameraBindGroup);
    renderPass.setVertexBuffer(0, this.positionBuffer);
    renderPass.setIndexBuffer(this.guideIndexBuffer, 'uint32');
    renderPass.setBindGroup(1, this.lineColorABindGroup);
    renderPass.drawIndexed(CROSS_PER_GORE * 2);
    renderPass.setBindGroup(1, this.lineColorBBindGroup);
    renderPass.drawIndexed(2, 1, CROSS_PER_GORE * 2);

    renderPass.end();
    this.device.queue.submit([encoder.finish()]);
    void dt;
  }

  private trackFps(dt: number) {
    this.fpsFrames++;
    this.fpsElapsed += dt;
    if (this.fpsElapsed >= 0.5) {
      this.lastFps = this.fpsFrames / this.fpsElapsed;
      this.onStats?.({
        fps: Math.round(this.lastFps),
        frameMs: Math.round((this.fpsElapsed / this.fpsFrames) * 10000) / 10,
        width: this.canvas.width,
        height: this.canvas.height,
        vertices: VERTEX_COUNT,
        triangles: this.indexCount / 3,
        computePasses: 2
      });
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
    }
  }

  // --------------------------------------------------------------- controls

  private onPointerDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-0.08, Math.min(1.35, this.pitch + dy * 0.005));
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = Math.max(16, Math.min(125, this.distance * Math.exp(e.deltaY * 0.001)));
  };

  private bindPointer() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private unbindPointer() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
