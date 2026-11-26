import {
  COLUMN_COUNT,
  INDEX_COUNT,
  ROW_COUNT,
  profileAt,
  profileNormalizer,
  VERTEX_COUNT,
  type SolverParams,
} from '../balloon/model';
import { createConeData, createCubeData, type MeshData } from './geometry';
import { lookAt, multiply, perspective } from './mat4';
import {
  BALLOON_SHADER_SOURCE,
  GROUND_SHADER_SOURCE,
  SOLID_SHADER_SOURCE,
} from './shaders';

export type CameraPreset = 'ground' | 'air' | 'top' | 'inspect' | 'close';

interface CameraRig {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

interface SolidObject {
  name: string;
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  position: [number, number, number];
  scale: [number, number, number];
  color: [number, number, number, number];
  emissive: boolean;
  flicker: boolean;
}

export interface RendererStats {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
}

export interface GpuContourReadback {
  tapeDeviationPct: number;
  panelDeviationPct: number;
  panelSagMm: number;
  sampleCount: number;
}

const VERTEX_STRIDE = 64;

export class WebGpuBalloonRenderer {
  private readonly canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;

  private vertexBuffer!: GPUBuffer;
  private indexBuffer!: GPUBuffer;
  private simUniformBuffer!: GPUBuffer;
  private frameUniformBuffer!: GPUBuffer;
  private contourReadbackBuffer: GPUBuffer | null = null;

  private balloonPipeline!: GPURenderPipeline;
  private computePipeline!: GPUComputePipeline;
  private computeBindGroup!: GPUBindGroup;
  private balloonFrameBindGroup!: GPUBindGroup;
  private patternTexture!: GPUTexture;
  private patternSampler!: GPUSampler;
  private patternBindGroup!: GPUBindGroup;

  private groundPipeline!: GPURenderPipeline;
  private groundBuffer!: GPUBuffer;
  private groundFrameBindGroup!: GPUBindGroup;

  private solidPipeline!: GPURenderPipeline;
  private solidFrameBindGroup!: GPUBindGroup;
  private objects: SolidObject[] = [];

  private observer: ResizeObserver | null = null;
  private abort = new AbortController();

  force4K = false;
  renderScale = Math.min(2, window.devicePixelRatio || 1);
  stats: RendererStats = { fps: 0, frameMs: 0, width: 0, height: 0 };

  private current: CameraRig = {
    yaw: 0.72,
    pitch: 0.16,
    distance: 35,
    target: [0, 7.2, -4.5],
  };
  private goal: CameraRig = { ...this.current };

  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private fpsFrames = 0;
  private fpsLast = performance.now();

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  static async create(
    canvas: HTMLCanvasElement,
    pattern: HTMLCanvasElement,
  ): Promise<WebGpuBalloonRenderer> {
    if (!navigator.gpu) {
      throw new Error('当前浏览器没有暴露 navigator.gpu，请使用最新版 Chrome/Edge 并启用 WebGPU。');
    }
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!adapter) throw new Error('未找到可用的 WebGPU 适配器。');
    const device = await adapter.requestDevice();
    const renderer = new WebGpuBalloonRenderer(canvas);
    renderer.device = device;
    renderer.format = navigator.gpu.getPreferredCanvasFormat();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('无法创建 WebGPU canvas context。');
    renderer.context = context;
    context.configure({
      device,
      format: renderer.format,
      alphaMode: 'opaque',
    });

    renderer.createSimulationBuffers();
    renderer.createPipelines();
    renderer.createPatternTexture(pattern);
    renderer.createGround();
    renderer.createObjects();
    renderer.bindControls();
    renderer.observer = new ResizeObserver(() => renderer.resize());
    renderer.observer.observe(canvas);
    renderer.resize();
    return renderer;
  }

  private createSimulationBuffers() {
    this.vertexBuffer = this.device.createBuffer({
      label: 'balloon-vertices-compute-storage',
      size: VERTEX_COUNT * VERTEX_STRIDE,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });

    const indices = new Uint32Array(INDEX_COUNT);
    const cols = 20 * 8 + 1;
    const rows = 60 * 2 + 1;
    let k = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = e;
      }
    }
    this.indexBuffer = this.device.createBuffer({
      label: 'balloon-indices',
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

    this.simUniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.frameUniformBuffer = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.contourReadbackBuffer = this.device.createBuffer({
      size: VERTEX_COUNT * VERTEX_STRIDE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private createPipelines() {
    const balloonModule = this.device.createShaderModule({
      label: 'balloon-wgsl',
      code: BALLOON_SHADER_SOURCE,
    });

    this.computePipeline = this.device.createComputePipeline({
      label: 'balloon-compute',
      layout: 'auto',
      compute: { module: balloonModule, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 1, resource: { buffer: this.vertexBuffer } },
      ],
    });

    this.balloonPipeline = this.device.createRenderPipeline({
      label: 'balloon-render',
      layout: 'auto',
      vertex: {
        module: balloonModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: VERTEX_STRIDE,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 16, format: 'float32x3' },
              { shaderLocation: 2, offset: 32, format: 'float32x2' },
              { shaderLocation: 3, offset: 40, format: 'float32' },
              { shaderLocation: 4, offset: 44, format: 'float32' },
              { shaderLocation: 5, offset: 48, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: balloonModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.balloonFrameBindGroup = this.device.createBindGroup({
      layout: this.balloonPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: this.frameUniformBuffer } }],
    });

    this.patternSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    });

    const groundModule = this.device.createShaderModule({ code: GROUND_SHADER_SOURCE });
    this.groundPipeline = this.device.createRenderPipeline({
      label: 'grass-ground',
      layout: 'auto',
      vertex: {
        module: groundModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: groundModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    this.groundFrameBindGroup = this.device.createBindGroup({
      layout: this.groundPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameUniformBuffer } }],
    });

    const solidModule = this.device.createShaderModule({ code: SOLID_SHADER_SOURCE });
    this.solidPipeline = this.device.createRenderPipeline({
      label: 'basket-burner-solid',
      layout: 'auto',
      vertex: {
        module: solidModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 24,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: solidModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
    this.solidFrameBindGroup = this.device.createBindGroup({
      layout: this.solidPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameUniformBuffer } }],
    });
  }

  private createPatternTexture(source: HTMLCanvasElement) {
    this.patternTexture?.destroy();
    this.patternTexture = this.device.createTexture({
      label: 'gore-pattern-atlas',
      size: [source.width, source.height, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.patternTexture },
      [source.width, source.height],
    );
    this.patternBindGroup = this.device.createBindGroup({
      layout: this.balloonPipeline.getBindGroupLayout(2),
      entries: [
        { binding: 0, resource: this.patternTexture.createView() },
        { binding: 1, resource: this.patternSampler },
      ],
    });
  }

  updatePattern(source: HTMLCanvasElement) {
    if (!this.device) return;
    if (
      !this.patternTexture ||
      this.patternTexture.width !== source.width ||
      this.patternTexture.height !== source.height
    ) {
      this.createPatternTexture(source);
      return;
    }
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.patternTexture },
      [source.width, source.height],
    );
  }

  private createGround() {
    const x0 = -110;
    const x1 = 110;
    const z0 = -125;
    const z1 = 85;
    const y = 0;
    const data = new Float32Array([
      x0, y, z0, 0, 0,
      x1, y, z0, 1, 0,
      x1, y, z1, 1, 1,
      x0, y, z0, 0, 0,
      x1, y, z1, 1, 1,
      x0, y, z1, 0, 1,
    ]);
    this.groundBuffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.groundBuffer, 0, data);
  }

  private uploadMesh(mesh: MeshData): { vertexBuffer: GPUBuffer; indexBuffer: GPUBuffer } {
    const vertexBuffer = this.device.createBuffer({
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    const indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    return { vertexBuffer, indexBuffer };
  }

  private addObject(
    name: string,
    mesh: MeshData,
    position: [number, number, number],
    scale: [number, number, number],
    color: [number, number, number, number],
    options: { emissive?: boolean; flicker?: boolean } = {},
  ) {
    const buffers = this.uploadMesh(mesh);
    const uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = this.device.createBindGroup({
      layout: this.solidPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    this.objects.push({
      name,
      ...buffers,
      indexCount: mesh.indices.length,
      uniformBuffer,
      bindGroup,
      position,
      scale,
      color,
      emissive: options.emissive ?? false,
      flicker: options.flicker ?? false,
    });
  }

  private createObjects() {
    const cube = createCubeData();
    const cone = createConeData();
    this.addObject('basket', cube, [0, 0.72, 0], [2.35, 1.28, 1.75], [0.55, 0.29, 0.1, 1]);
    this.addObject('rim', cube, [0, 1.43, 0], [2.58, 0.2, 1.95], [0.34, 0.16, 0.055, 1]);
    this.addObject('burner', cube, [0, 1.86, 0], [0.82, 0.46, 0.82], [0.22, 0.25, 0.28, 1]);
    this.addObject('tank-l', cube, [-0.62, 0.72, 0], [0.42, 0.9, 0.42], [0.72, 0.76, 0.78, 1]);
    this.addObject('tank-r', cube, [0.62, 0.72, 0], [0.42, 0.9, 0.42], [0.72, 0.76, 0.78, 1]);
    this.addObject('flame-outer', cone, [0, 2.55, 0], [1.15, 1.5, 1.15], [1, 0.28, 0.03, 0.92], {
      emissive: true,
      flicker: true,
    });
    this.addObject('flame-inner', cone, [0, 2.42, 0], [0.58, 1.05, 0.58], [1, 0.86, 0.12, 1], {
      emissive: true,
      flicker: true,
    });
  }

  setCameraPreset(preset: CameraPreset) {
    if (preset === 'ground') {
      this.goal = { yaw: 0.62, pitch: 0.1, distance: 34, target: [0, 6.2, -5.5] };
    } else if (preset === 'air') {
      this.goal = { yaw: 0.95, pitch: 0.66, distance: 41, target: [0, 8.5, -3.5] };
    } else if (preset === 'top') {
      this.goal = { yaw: 0.15, pitch: 1.42, distance: 45, target: [0, 7.5, -5] };
    } else if (preset === 'close') {
      this.goal = { yaw: 0.18, pitch: 0.12, distance: 13.2, target: [0, 10.6, 0] };
    } else {
      this.goal = { yaw: 0.18, pitch: 0.16, distance: 22, target: [0, 9.4, 0] };
    }
  }

  private bindControls() {
    const opts = { signal: this.abort.signal };
    this.canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
      },
      opts,
    );
    this.canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.goal.yaw -= dx * 0.0052;
        this.goal.pitch = Math.max(-0.08, Math.min(1.45, this.goal.pitch + dy * 0.0042));
      },
      opts,
    );
    const end = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerup', end, opts);
    this.canvas.addEventListener('pointercancel', end, opts);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.goal.distance = Math.max(9, Math.min(95, this.goal.distance * Math.exp(e.deltaY * 0.001)));
      },
      { passive: false, signal: this.abort.signal },
    );
  }

  resize() {
    if (!this.device) return;
    const rect = this.canvas.getBoundingClientRect();
    let width = Math.max(1, Math.floor(rect.width * this.renderScale));
    let height = Math.max(1, Math.floor(rect.height * this.renderScale));
    if (this.force4K) {
      width = 3840;
      height = 2160;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.depthTexture?.destroy();
      this.depthTexture = this.device.createTexture({
        size: [width, height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthView = this.depthTexture.createView();
    }
  }

  private writeSimUniforms(params: SolverParams) {
    const data = new ArrayBuffer(256);
    const f = new Float32Array(data);
    const norm = profileNormalizer(params.shape);
    f.set([params.shape.height, params.shape.radius, params.shape.a, params.shape.b], 0);
    f.set([params.shape.m, norm, params.shape.bulgeFactor, 0], 4);
    f.set(
      [params.pressure, params.fabricStiffness, params.tapeStiffness, params.bulgeScale],
      8,
    );
    f.set([params.inflation, params.erection, params.time, 1], 12);
    f.set(
      [params.strainView, params.showTapes ? 1 : 0, params.showWireframe ? 1 : 0, 0],
      16,
    );
    this.device.queue.writeBuffer(this.simUniformBuffer, 0, data);
  }

  private cameraVectors() {
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const k = this.dragging ? 0.28 : 0.085;
    this.current.yaw = lerp(this.current.yaw, this.goal.yaw, k);
    this.current.pitch = lerp(this.current.pitch, this.goal.pitch, k);
    this.current.distance = lerp(this.current.distance, this.goal.distance, k);
    for (let i = 0; i < 3; i++) {
      this.current.target[i] = lerp(this.current.target[i], this.goal.target[i], k);
    }

    const cp = Math.cos(this.current.pitch);
    const eye: [number, number, number] = [
      this.current.target[0] + this.current.distance * cp * Math.sin(this.current.yaw),
      this.current.target[1] + this.current.distance * Math.sin(this.current.pitch),
      this.current.target[2] + this.current.distance * cp * Math.cos(this.current.yaw),
    ];
    return eye;
  }

  private writeFrameUniforms(params: SolverParams, eye: [number, number, number]) {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = perspective((48 * Math.PI) / 180, aspect, 0.1, 240);
    const view = lookAt(eye, this.current.target, [0, 1, 0]);
    const vp = multiply(proj, view);

    const data = new ArrayBuffer(128);
    const f = new Float32Array(data);
    new Float32Array(data, 0, 16).set(vp);
    f.set([eye[0], eye[1], eye[2], params.erection], 16);
    f.set([0.42, 0.86, 0.34, 0], 20);
    f.set(
      [params.strainView, params.showTapes ? 1 : 0, params.showWireframe ? 1 : 0, params.time],
      24,
    );
    this.device.queue.writeBuffer(this.frameUniformBuffer, 0, data);
  }

  private modelMatrix(
    position: [number, number, number],
    scale: [number, number, number],
  ): Float32Array {
    const m = new Float32Array(16);
    m[0] = scale[0];
    m[5] = scale[1];
    m[10] = scale[2];
    m[12] = position[0];
    m[13] = position[1];
    m[14] = position[2];
    m[15] = 1;
    return m;
  }

  private updateObjectUniforms(params: SolverParams) {
    for (const obj of this.objects) {
      let scale = obj.scale;
      const lyingShiftZ = -1.55 * (1 - params.erection);
      let position: [number, number, number] = [
        obj.position[0],
        obj.position[1],
        obj.position[2] + lyingShiftZ,
      ];
      if (obj.name.startsWith('flame')) {
        const intensity = Math.max(0, params.flame);
        const flicker = obj.flicker
          ? 0.86 + 0.14 * Math.sin(params.time * 17 + (obj.name === 'flame-inner' ? 2 : 0))
          : 1;
        const height = scale[1] * intensity * flicker;
        scale = [scale[0] * (0.85 + 0.15 * intensity), Math.max(0.001, height), scale[2]];
        position = [position[0], 2.05 + height * 0.5, position[2]];
      }

      const data = new ArrayBuffer(256);
      const f = new Float32Array(data);
      new Float32Array(data, 0, 16).set(this.modelMatrix(position, scale));
      f.set(obj.color, 16);
      f.set([obj.emissive ? 1 : 0, 0, 0, 0], 20);
      this.device.queue.writeBuffer(obj.uniformBuffer, 0, data);
    }
  }

  render(params: SolverParams) {
    if (!this.device || !this.depthView) return;
    const start = performance.now();
    this.resize();
    if (this.canvas.width < 2 || this.canvas.height < 2) return;

    this.writeSimUniforms(params);
    const eye = this.cameraVectors();
    this.writeFrameUniforms(params, eye);
    this.updateObjectUniforms(params);

    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(VERTEX_COUNT / 64));
    computePass.end();

    const textureView = this.context.getCurrentTexture().createView();
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.58, g: 0.75, b: 0.91, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    renderPass.setPipeline(this.groundPipeline);
    renderPass.setBindGroup(0, this.groundFrameBindGroup);
    renderPass.setVertexBuffer(0, this.groundBuffer);
    renderPass.draw(6);

    renderPass.setPipeline(this.balloonPipeline);
    renderPass.setBindGroup(1, this.balloonFrameBindGroup);
    renderPass.setBindGroup(2, this.patternBindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.drawIndexed(INDEX_COUNT);

    renderPass.setPipeline(this.solidPipeline);
    renderPass.setBindGroup(0, this.solidFrameBindGroup);
    for (const obj of this.objects) {
      renderPass.setBindGroup(1, obj.bindGroup);
      renderPass.setVertexBuffer(0, obj.vertexBuffer);
      renderPass.setIndexBuffer(obj.indexBuffer, 'uint32');
      renderPass.drawIndexed(obj.indexCount);
    }

    renderPass.end();
    this.device.queue.submit([encoder.finish()]);

    this.stats.frameMs = performance.now() - start;
    this.stats.width = this.canvas.width;
    this.stats.height = this.canvas.height;
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsLast > 500) {
      this.stats.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLast));
      this.fpsFrames = 0;
      this.fpsLast = now;
    }
  }

  async readContour(params: SolverParams): Promise<GpuContourReadback | null> {
    if (!this.device || !this.contourReadbackBuffer) return null;
    const byteLength = VERTEX_COUNT * VERTEX_STRIDE;
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.vertexBuffer,
      0,
      this.contourReadbackBuffer,
      0,
      byteLength,
    );
    this.device.queue.submit([encoder.finish()]);

    await this.contourReadbackBuffer.mapAsync(GPUMapMode.READ);
    try {
      const values = new Float32Array(this.contourReadbackBuffer.getMappedRange());
      let tapeDeviationPct = 0;
      let panelDeviationPct = 0;
      let panelSagM = 0;
      let sampleCount = 0;
      const radius = (row: number, col: number) => {
        const offset = (row * COLUMN_COUNT + col) * 16;
        return Math.hypot(values[offset], values[offset + 2]);
      };

      for (let row = 3; row < ROW_COUNT - 4; row++) {
        const t = row / (ROW_COUNT - 1);
        const theoretical = profileAt(t, params.shape).r;
        for (let gore = 0; gore < 20; gore++) {
          const leftCol = gore * 8;
          const rightCol = leftCol + 8;
          const leftR = radius(row, leftCol);
          const rightR = radius(row, rightCol);
          tapeDeviationPct = Math.max(
            tapeDeviationPct,
            (Math.max(Math.abs(leftR - theoretical), Math.abs(rightR - theoretical)) /
              params.shape.radius) *
              100,
          );

          let maxR = 0;
          for (let k = 0; k <= 8; k++) maxR = Math.max(maxR, radius(row, leftCol + k));
          panelDeviationPct = Math.max(
            panelDeviationPct,
            (Math.abs(maxR - theoretical) / params.shape.radius) * 100,
          );
          const boundary = (leftR + rightR) * 0.5;
          panelSagM = Math.max(panelSagM, maxR - boundary);
          sampleCount++;
        }
      }

      return {
        tapeDeviationPct,
        panelDeviationPct,
        panelSagMm: panelSagM * 1000,
        sampleCount,
      };
    } finally {
      this.contourReadbackBuffer.unmap();
    }
  }

  dispose() {
    this.abort.abort();
    this.observer?.disconnect();
    this.depthTexture?.destroy();
    this.patternTexture?.destroy();
    this.contourReadbackBuffer?.destroy();
    this.device?.destroy();
  }
}
