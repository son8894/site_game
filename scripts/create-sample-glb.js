#!/usr/bin/env node

/**
 * 간단한 테스트용 GLB 파일 생성
 * 정육면체(Cube) 모델 생성 및 저장
 */

const fs = require('fs');
const path = require('path');

// 최소한의 GLB 바이너리 생성 (정육면체)
// GLB 포맷: Header(12) + JSON chunk + Binary chunk

function createSimpleGLB() {
  // JSON 청크 (씬, 메시, 재질 메타데이터)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.2, 0.2, 1.0], // 빨간색
        metallicFactor: 0.0,
        roughnessFactor: 0.8,
      },
      name: 'Material',
    }],
    accessors: [
      // POSITION 데이터
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: 'VEC3',
        min: [-1, -1, -1],
        max: [1, 1, 1],
      },
      // NORMAL 데이터
      {
        bufferView: 1,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
      },
      // INDEX 데이터
      {
        bufferView: 2,
        componentType: 5125, // UNSIGNED_INT
        count: 36,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 288, byteStride: 12 }, // POSITION
      { buffer: 0, byteOffset: 288, byteLength: 288, byteStride: 12 }, // NORMAL
      { buffer: 0, byteOffset: 576, byteLength: 144 }, // INDEX
    ],
    buffers: [{ byteLength: 720 }],
  };

  const jsonStr = JSON.stringify(json);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  const jsonPadded = Buffer.alloc(((jsonBytes.length + 3) & ~3)); // 4바이트 정렬
  jsonBytes.copy(jsonPadded);

  // 이진 데이터 (정육면체 좌표)
  const vertices = new Float32Array([
    // Front
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
    // Back
    -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1,
    // Top
    -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
    // Bottom
    -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
    // Right
    1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1,
    // Left
    -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1,
  ]);

  const normals = new Float32Array([
    // Front
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,       // Front
    6, 5, 4, 7, 6, 4,       // Back
    8, 9, 10, 8, 10, 11,    // Top
    14, 13, 12, 15, 14, 12, // Bottom
    16, 17, 18, 16, 18, 19, // Right
    22, 21, 20, 23, 22, 20, // Left
  ]);

  const binaryBuffer = Buffer.alloc(720);
  Buffer.from(vertices.buffer).copy(binaryBuffer, 0);
  Buffer.from(normals.buffer).copy(binaryBuffer, 288);
  Buffer.from(indices.buffer).copy(binaryBuffer, 576);

  // GLB 헤더
  const magic = Buffer.from('glTF', 'utf8');
  const version = Buffer.alloc(4);
  version.writeUInt32LE(2);

  // 전체 파일 크기
  const totalSize = 12 + (8 + jsonPadded.length) + (8 + binaryBuffer.length);
  const fileSizeBuffer = Buffer.alloc(4);
  fileSizeBuffer.writeUInt32LE(totalSize);

  // JSON 청크 헤더
  const jsonChunkSize = Buffer.alloc(4);
  jsonChunkSize.writeUInt32LE(jsonPadded.length);
  const jsonChunkType = Buffer.from('JSON', 'utf8');

  // Binary 청크 헤더
  const binChunkSize = Buffer.alloc(4);
  binChunkSize.writeUInt32LE(binaryBuffer.length);
  const binChunkType = Buffer.from('BIN\0', 'utf8');

  // GLB 조합
  const glb = Buffer.concat([
    magic, version, fileSizeBuffer,
    jsonChunkSize, jsonChunkType, jsonPadded,
    binChunkSize, binChunkType, binaryBuffer,
  ]);

  return glb;
}

// 저장
const glb = createSimpleGLB();
const outputPath = path.join(__dirname, '../public/sample-cube.glb');

fs.writeFileSync(outputPath, glb);
console.log(`✅ GLB 파일 생성: ${outputPath} (${glb.length} bytes)`);
