// 외부 JSON 파일을 이 프로젝트의 재질/씬 형식으로 파싱·검증한다.
// 신뢰할 수 없는 입력이므로 필드 단위로 타입을 확인하고, 알아볼 수 없는 형태면 한국어 에러 메시지로 throw한다.
import type { AssetRefSchema, MaterialAsset, MaterialOverride, ObjectNodeSchema } from '@/types/scene';

const MATERIAL_KEYS = new Set([
  'color', 'roughness', 'metalness', 'emissive', 'textureUrl', 'textureRepeat',
  'textureMapping', 'triplanarScale', 'clearcoat', 'sheen', 'transmission', 'ior',
]);

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function looksLikeMaterial(v: Record<string, unknown>): boolean {
  return Object.keys(v).some((k) => MATERIAL_KEYS.has(k));
}

function sanitizeMaterial(raw: Record<string, unknown>): MaterialOverride {
  const out: MaterialOverride = {};
  if (typeof raw.color === 'string') out.color = raw.color;
  if (typeof raw.roughness === 'number') out.roughness = clamp01(raw.roughness);
  if (typeof raw.metalness === 'number') out.metalness = clamp01(raw.metalness);
  if (typeof raw.emissive === 'string') out.emissive = raw.emissive;
  if (typeof raw.textureUrl === 'string') out.textureUrl = raw.textureUrl;
  if (raw.textureRepeat && typeof raw.textureRepeat === 'object') {
    const tr = raw.textureRepeat as Record<string, unknown>;
    if (typeof tr.x === 'number' && typeof tr.y === 'number') out.textureRepeat = { x: tr.x, y: tr.y };
  }
  if (raw.textureMapping === 'face' || raw.textureMapping === 'wrap' || raw.textureMapping === 'pattern') {
    out.textureMapping = raw.textureMapping;
  }
  if (typeof raw.triplanarScale === 'number') out.triplanarScale = raw.triplanarScale;
  if (typeof raw.clearcoat === 'number') out.clearcoat = clamp01(raw.clearcoat);
  if (typeof raw.sheen === 'number') out.sheen = clamp01(raw.sheen);
  if (typeof raw.transmission === 'number') out.transmission = clamp01(raw.transmission);
  if (typeof raw.ior === 'number') out.ior = raw.ior;
  return out;
}

export interface ParsedMaterialItem {
  name: string;
  material: MaterialOverride;
}

// 지원 형태:
//   1) { "name": "금속", "material": { "color": "#d4af37", "roughness": 0.3, ... } }
//   2) { "color": "#d4af37", "roughness": 0.3, ... }  (재질 필드가 최상위)
//   3) 위 두 형태의 배열, 또는 { "materials": [ ... ] }
export function parseMaterialJson(raw: unknown): ParsedMaterialItem[] {
  const items: ParsedMaterialItem[] = [];

  const pushItem = (entry: unknown, fallbackName: string) => {
    if (!entry || typeof entry !== 'object') return;
    const obj = entry as Record<string, unknown>;
    if (obj.material && typeof obj.material === 'object') {
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fallbackName;
      items.push({ name, material: sanitizeMaterial(obj.material as Record<string, unknown>) });
      return;
    }
    if (looksLikeMaterial(obj)) {
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fallbackName;
      items.push({ name, material: sanitizeMaterial(obj) });
    }
  };

  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => pushItem(entry, `가져온 재질 ${i + 1}`));
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.materials)) {
      obj.materials.forEach((entry, i) => pushItem(entry, `가져온 재질 ${i + 1}`));
    } else {
      pushItem(raw, '가져온 재질');
    }
  }

  if (items.length === 0) {
    throw new Error('재질 JSON 형식을 알아볼 수 없습니다. { "name": "...", "material": { "color": "#rrggbb", "roughness": 0.5, ... } } 형태를 확인해주세요.');
  }
  return items;
}

export interface ParsedSceneImport {
  objects: Partial<ObjectNodeSchema>[];
  assets: AssetRefSchema[];
  materialAssets: MaterialAsset[];
}

// 이 프로젝트의 씬 데이터(ProjectSceneSchema)와 같은 모양의 JSON을 기대한다.
// 최소 요건: 최상위에 objects 배열이 있고, 각 항목이 문자열 id를 가질 것.
// assets/materialAssets는 있으면 함께 가져오고, 없으면 빈 배열로 처리(오브젝트가 assetId/materialId를
// 참조해도 매칭되는 항목이 없으면 가져오기 단계에서 그 참조는 끊는다 — sceneStore.importSceneJson 담당).
export function parseSceneJson(raw: unknown): ParsedSceneImport {
  if (!raw || typeof raw !== 'object') {
    throw new Error('씬 JSON 파일을 읽을 수 없습니다.');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.objects)) {
    throw new Error('씬 JSON에 "objects" 배열이 없습니다. 이 프로젝트의 씬 데이터 형식을 확인해주세요.');
  }
  const objects = obj.objects.filter(
    (o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as Record<string, unknown>).id === 'string',
  ) as unknown as Partial<ObjectNodeSchema>[];
  if (objects.length === 0) {
    throw new Error('가져올 오브젝트가 없습니다(각 항목에 문자열 "id" 필드가 필요합니다).');
  }
  const assets = Array.isArray(obj.assets)
    ? (obj.assets.filter(
        (a): a is Record<string, unknown> =>
          !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).id === 'string' && typeof (a as Record<string, unknown>).dracoUrl === 'string',
      ) as unknown as AssetRefSchema[])
    : [];
  const materialAssets = Array.isArray(obj.materialAssets)
    ? (obj.materialAssets.filter(
        (m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).id === 'string' && !!(m as Record<string, unknown>).material,
      ) as unknown as MaterialAsset[])
    : [];
  return { objects, assets, materialAssets };
}
