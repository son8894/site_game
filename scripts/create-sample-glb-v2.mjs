#!/usr/bin/env node

/**
 * 더 안전한 테스트용 GLB 생성
 * BufferGeometry → GLB 바이너리 인코딩
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 최소한의 정육면체 GLB 생성
function createMinimalGLB() {
  // JSON 메타데이터
  const json = {
    asset: { version: '2.0', generator: 'Custom' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: 'Cube',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: 'Material',
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.2, 0.2, 1.0],
          roughnessFactor: 0.8,
          metallicFactor: 0.0,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
        min: [-1, -1, -1],
        max: [1, 1, 1],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        componentType: 5125,
        count: 36,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 288, byteStride: 12 },
      { buffer: 0, byteOffset: 288, byteLength: 288, byteStride: 12 },
      { buffer: 0, byteOffset: 576, byteLength: 144 },
    ],
    buffers: [{ byteLength: 720 }],
  };

  const jsonStr = JSON.stringify(json);
  const jsonBuffer = Buffer.from(jsonStr);
  // JSON은 4바이트 경계로 패딩
  const jsonPadded = Math.ceil(jsonBuffer.length / 4) * 4;
  const jsonChunkSize = jsonBuffer.length;

  // Binary 데이터 생성
  const binary = Buffer.alloc(720);

  // Position vertices (24개)
  const positionData = [
    -1, -1, 1,  1, -1, 1,  1, 1, 1,  -1, 1, 1, // Front
    -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, // Back
    -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1, // Top
    -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1, // Bottom
    1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, // Right
    -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, // Left
  ];

  // Normal data (24개)
  const normalData = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, // Front
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, // Back
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, // Top
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, // Bottom
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, // Right
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, // Left
  ];

  // Index data (36개)
  const indexData = [
    0, 1, 2, 0, 2, 3, // Front
    6, 5, 4, 7, 6, 4, // Back
    8, 9, 10, 8, 10, 11, // Top
    14, 13, 12, 15, 14, 12, // Bottom
    16, 17, 18, 16, 18, 19, // Right
    22, 21, 20, 23, 22, 20, // Left
  ];

  // Float32 포지션/노멀 쓰기
  let offset = 0;
  for (let v of positionData) {
    binary.writeFloatLE(v, offset);
    offset += 4;
  }
  for (let v of normalData) {
    binary.writeFloatLE(v, offset);
    offset += 4;
  }
  // Uint32 인덱스 쓰기
  for (let i of indexData) {
    binary.writeUInt32LE(i, offset);
    offset += 4;
  }

  // GLB 헤더 구성
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 4, 'utf8'); // magic
  header.writeUInt32LE(2, 4); // version
  const totalSize = 12 + 8 + jsonPadded + 8 + 720;
  header.writeUInt32LE(totalSize, 8); // file size

  // JSON 청크 헤더
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded, 0); // chunk size
  jsonChunkHeader.write('JSON', 4, 4, 'utf8'); // chunk type

  // Binary 청크 헤더
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(720, 0); // chunk size
  binChunkHeader.write('BIN\0', 4, 4, 'utf8'); // chunk type

  // JSON 패딩 적용
  const jsonPaddedBuffer = Buffer.alloc(jsonPadded);
  jsonBuffer.copy(jsonPaddedBuffer);

  // 최종 GLB 조합
  const glb = Buffer.concat([
    header,
    jsonChunkHeader,
    jsonPaddedBuffer,
    binChunkHeader,
    binary,
  ]);

  return glb;
}

const glb = createMinimalGLB();
const outputPath = path.join(__dirname, '../public/sample-cube.glb');

fs.writeFileSync(outputPath, glb);
console.log(`✅ GLB 파일 생성 완료: ${outputPath}`);
console.log(`   파일 크기: ${glb.length} bytes`);
console.log(`   매직: ${glb.toString('utf8', 0, 4)}`);
console.log(`   버전: ${glb.readUInt32LE(4)}`);
console.log(`   파일크기: ${glb.readUInt32LE(8)}`);
