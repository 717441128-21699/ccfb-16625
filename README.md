# 云帆 · WebGPU 热气球定制充形工作台

面向定制造型热气球的实时设计与充形预览系统。设计师在平面裁片母版上绘制图案，系统按 **20 条纵向裁片、每条 60 块布** 生成囊体，并在 WebGPU compute shader 中根据内外压差、布料拉伸刚度和加强带跨距计算充气轮廓、布片鼓包与图案变形。

> 技术栈：TypeScript + Vite + 原生 WebGPU/WGSL，无 Three.js / React 运行时依赖。UI 为 TypeScript DOM，几何解算和渲染均在 WebGPU 中完成。

## 运行

```bash
npm install
npm run dev
```

打开终端输出的地址，建议使用最新版 Chrome / Edge。WebGPU 不可用时，页面会显示原因；理论轮廓、材料方程和验收面板仍可用于复核。

生产构建：

```bash
npm run build
npm run preview
```

## 四个工作页

1. **裁片图案页**
   - 20 × 60 的平面裁片/布块母版，共 1,200 块布。
   - 画笔、直线、文字、橡皮、颜色、笔宽。
   - 可将每一笔同步到全部 20 条裁片。
   - 内置赛舟色带、校准棋盘、云帆旭日、烈焰裁片四套自编图案。
   - 图案 Canvas 直接作为 `rgba8unorm` 纹理上传 WebGPU。

2. **充气形状页**
   - 四种自编球形：经典水滴、宽体灯笼、修长探险、庆典高肩。
   - 压差、布料 EA 拉伸刚度、加强带刚度、鼓包幅度可调。
   - 图案、环向应变、加强带张力、UV 拉伸四种诊断着色。
   - 实时显示轮廓偏差、应变、鼓包高度和加强带张力。

3. **冷充立起页**
   - 0–42%：地面冷充，平铺囊体横向展开并逐渐鼓起。
   - 42–72%：冷充饱满、横卧待命。
   - 72–100%：点火、热充、火焰增强并绕吹口旋转立起。
   - 可播放/暂停/拖动时间轴/调速/重播。
   - 草地、接触阴影、吊篮、燃烧器和闪烁火焰均为 WebGPU 绘制。
   - 支持地面、空中、俯视、吹口近景和自由轨道视角。

4. **图案变形检查页**
   - 选择高度和裁片，绘制平面直线与充气后曲线的剖面对照。
   - 曲线矢高直接使用 GPU shader 中同一组压力—跨宽—膜力方程。
   - “运行 2% 轮廓验收”会从 WebGPU 顶点缓冲回读实际位置并统计偏差。
   - 可开启 3840×2160 后端缓冲进行 4K 性能压测。

## 几何与解算规模

- 裁片数：`20`
- 每裁片布块：`60`
- 每裁片横向细分：`8`
- 每布块纵向细分：`2`
- 顶点：`(20×8+1) × (60×2+1) = 19,481`
- 三角形：`38,400`
- Compute dispatch：每帧一次，`ceil(19,481 / 64)` 个 workgroup。

顶点缓冲同时带有 `STORAGE | VERTEX | COPY_SRC` 用途：compute shader 写入位置/法线/UV/应变/张力，渲染通道直接绑定为顶点缓冲，验收时可复制回读。

## 力学模型

理论自然轮廓用可调制的 Beta 型母线：

```text
r(t) = R · (t + m)^b · (1-t)^a / N
y(t) = H · t
```

其中 `N` 在最大半径处归一化，四种球形分别给出不同的 `R/H/a/b/m`。

GPU 中每个顶点继续计算：

```text
N_hoop      = Δp · r
ε_hoop      = N_hoop / EA_fabric
N_merid     = 0.5 · Δp · r + 囊体自重项
w_gore      = 2πr / 20
h_panel     = Δp · w_gore² / (8 · N_hoop)
arch        = sin(π · localGoreCoord)^0.82
bulge       = h_panel · arch · verticalPillow
T_tape      = Δp · πr² / 20 + 恒定载荷 + 纵向自重项
```

低压时截面在草地方向压扁、横向展宽；立起参数把囊体纵轴从 `-Z` 横卧状态旋转到 `+Y`，并按椭圆截面半径抬升，使最低点保持在草地附近。

这是面向实时预览的压力膜/悬链等效解算，不是离线非线性 FEM；它的优势是稳定、可复现、零加载等待，并且轮廓公差和鼓包量可直接解析复核。

## 已验证结果

在 Windows + Chrome 158 + NVIDIA RTX 4060 的自动化 WebGPU 测试中，默认经典水滴参数：

```text
GPU 回读样本           2280 个跨片剖面
加强带主轮廓最大偏差    0.568%
含布片鼓包最大偏差      1.702%   (< 2%)
最大鼓包矢高            69.795 mm
CPU 同方程预测矢高      69.802 mm
```

直线弯曲剖面使用相同的 `sin(πq)^0.82` 拱线和 `h_panel`，因此图表矢高、GPU 顶点回读和 3D 鼓包一致。

4K 压测将 drawing buffer 锁定为 `3840×2160`，冷充、横卧、点火和立起各阶段测得：

```text
分辨率       3840 × 2160
页面 FPS     144 FPS（测试机显示/合成节奏上限）
CPU 提交     约 0.4–0.6 ms
```

实际帧率随显卡、浏览器和屏幕刷新率变化；场景只有约 3.84 万三角形，主要 4K 成本是片元着色和图案采样。

## 检查脚本

```bash
# WGSL 语法解析
npm run check:wgsl

# 浏览器加载、切页、WebGPU 管线、验收回读和截图
# PowerShell: $env:URL="http://127.0.0.1:5173/"; npm run check:browser
URL=http://127.0.0.1:5173/ npm run check:browser

# 4K 冷充过程性能采样
npm run check:4k
```

浏览器自动化使用 `puppeteer-core`，不会额外下载 Chromium；它调用系统安装的 Chrome/Edge。某些远程/虚拟显示环境需要：

```text
--disable-gpu-sandbox --disable-gpu-blocklist
--enable-unsafe-webgpu --use-angle=d3d11
```

## 目录

```text
src/
  balloon/model.ts       常量、球形、理论轮廓、材料方程、冷充时间轴
  editor/patternEditor.ts Canvas 平面裁片图案编辑器
  gpu/mat4.ts            透视/观察矩阵
  gpu/geometry.ts        吊篮、燃烧器、火焰简易网格
  gpu/shaders.ts         compute + balloon/ground/solid WGSL
  gpu/renderer.ts        WebGPU 设备、管线、相机、循环、回读
  ui/app.ts              四个页面的控件和状态编排
  style.css              工作台布局与响应式
scripts/                 WGSL/Puppeteer/4K 验证脚本
```
