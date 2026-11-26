export interface MeshData {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

export function createCubeData(): MeshData {
  // position.xyz + normal.xyz, 4 bytes per float; 6 vertices per face.
  const faces: Array<{ normal: [number, number, number]; corners: number[] }> = [
    { normal: [0, 0, 1], corners: [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5] },
    { normal: [0, 0, -1], corners: [0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5] },
    { normal: [1, 0, 0], corners: [0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5] },
    { normal: [-1, 0, 0], corners: [-0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5] },
    { normal: [0, 1, 0], corners: [-0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5] },
    { normal: [0, -1, 0], corners: [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5] },
  ];

  const vertices: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const base = vertices.length / 6;
    for (let i = 0; i < 4; i++) {
      vertices.push(
        face.corners[i * 3],
        face.corners[i * 3 + 1],
        face.corners[i * 3 + 2],
        ...face.normal,
      );
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

export function createConeData(segments = 28): MeshData {
  const vertices: number[] = [];
  const indices: number[] = [];

  // Side vertices: base ring plus one tip per segment.
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * 0.5;
    const z = Math.sin(a) * 0.5;
    vertices.push(x, -0.5, z, Math.cos(a), 0.35, Math.sin(a));
    vertices.push(0, 0.5, 0, Math.cos(a), 0.35, Math.sin(a));
  }
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  // Bottom cap.
  const centerIndex = vertices.length / 6;
  vertices.push(0, -0.5, 0, 0, -1, 0);
  const ringStart = vertices.length / 6;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5, 0, -1, 0);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(centerIndex, ringStart + i + 1, ringStart + i);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}
