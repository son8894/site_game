import { MathUtils } from 'three';
import type { ProjectSceneSchema, ObjectNodeSchema, EventSchema } from '@/types/scene';
import { DEFAULT_PHYSICS, DEFAULT_ENVIRONMENT } from '@/types/scene';

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  build: (projectId: string, sceneId: string) => ProjectSceneSchema;
}

function obj(
  shape: ObjectNodeSchema['primitiveShape'],
  name: string,
  pos: [number, number, number],
  scale: [number, number, number],
  color: string,
  rot: [number, number, number] = [0, 0, 0],
): ObjectNodeSchema {
  return {
    id: MathUtils.generateUUID(),
    name,
    assetId: null,
    primitiveShape: shape,
    material: { color, roughness: 0.6, metalness: 0.1 },
    parentId: null,
    layer: 'default',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    rotation: { x: rot[0], y: rot[1], z: rot[2] },
    scale: { x: scale[0], y: scale[1], z: scale[2] },
    visible: true,
    locked: false,
    physics: { ...DEFAULT_PHYSICS, enabled: true, colliderType: 'box' },
    events: [],
  };
}

// ── 고급 템플릿용 헬퍼 ────────────────────────────────────────
// 위 obj()는 "회색 박스 나열"용이라 그림자·재질·형상 파라미터를 못 준다.
// 제대로 꾸민 씬은 아래 두 헬퍼를 쓴다 — **그림자 기본 on**이 핵심(오브젝트 render 기본값은 false라
// 그냥 두면 아무것도 그림자를 안 만들어 입체감이 사라진다).
interface MeshOpts {
  rot?: [number, number, number];
  roughness?: number;
  metalness?: number;
  emissive?: string;
  geom?: ObjectNodeSchema['geom'];
  /** 그림자 생성(기본 true). 벽/천장처럼 받기만 할 면은 false. */
  cast?: boolean;
  /** 그림자 수신(기본 true) */
  receive?: boolean;
  /** 충돌(기본 true). 장식용 작은 오브젝트는 false로 두면 걷기 모드가 답답하지 않다. */
  solid?: boolean;
  doubleSided?: boolean;
  /** 불투명도 0~1(기본 1). 유리·가림막·창문처럼 반투명이 필요할 때만. */
  opacity?: number;
}
function mesh(
  shape: ObjectNodeSchema['primitiveShape'],
  name: string,
  pos: [number, number, number],
  scale: [number, number, number],
  color: string,
  o: MeshOpts = {},
): ObjectNodeSchema {
  const rot = o.rot ?? [0, 0, 0];
  return {
    id: MathUtils.generateUUID(),
    name,
    assetId: null,
    primitiveShape: shape,
    geom: o.geom,
    material: {
      color,
      roughness: o.roughness ?? 0.6,
      metalness: o.metalness ?? 0,
      ...(o.emissive ? { emissive: o.emissive } : {}),
      ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
    },
    render: {
      castShadow: o.cast ?? true,
      receiveShadow: o.receive ?? true,
      ...(o.doubleSided ? { doubleSided: true } : {}),
    },
    parentId: null,
    layer: 'default',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    rotation: { x: rot[0], y: rot[1], z: rot[2] },
    scale: { x: scale[0], y: scale[1], z: scale[2] },
    visible: true,
    locked: false,
    physics: { ...DEFAULT_PHYSICS, enabled: o.solid ?? true, colliderType: 'box' },
    events: [],
  };
}

/** 포인트 라이트 — 펜던트 조명·촛불처럼 사방으로 퍼지는 광원. */
function point(
  name: string,
  pos: [number, number, number],
  opts: { color?: string; intensity?: number; distance?: number; castShadow?: boolean } = {},
): ObjectNodeSchema {
  return {
    id: MathUtils.generateUUID(),
    name,
    assetId: null,
    light: {
      type: 'point',
      color: opts.color ?? '#ffd9a0',
      intensity: opts.intensity ?? 12,
      distance: opts.distance ?? 8,
      decay: 2,
      castShadow: opts.castShadow ?? false,
    },
    parentId: null,
    layer: 'default',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    physics: { ...DEFAULT_PHYSICS },
    events: [],
  };
}

/** 스포트 라이트 — 로컬 -Y가 빔 방향이라 rotation으로 조준한다(기본: 바로 아래). */
//   ⚠ 성능: castShadow는 **광원마다 그림자맵을 매 프레임 렌더**한다. 기본을 false로 두고
//     각 씬에서 키 라이트 1개에만 켠다(4개 켜면 눈에 띄게 버벅인다).
function spot(
  name: string,
  pos: [number, number, number],
  opts: { color?: string; intensity?: number; angle?: number; penumbra?: number; distance?: number; rot?: [number, number, number]; shadow?: boolean } = {},
): ObjectNodeSchema {
  const rot = opts.rot ?? [0, 0, 0];
  return {
    id: MathUtils.generateUUID(),
    name,
    assetId: null,
    light: {
      type: 'spot',
      color: opts.color ?? '#fff4e6',
      intensity: opts.intensity ?? 40,
      distance: opts.distance ?? 14,
      decay: 2,
      angle: opts.angle ?? 0.5,
      penumbra: opts.penumbra ?? 0.7,
      castShadow: opts.shadow ?? false,
    },
    parentId: null,
    layer: 'default',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    rotation: { x: rot[0], y: rot[1], z: rot[2] },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    physics: { ...DEFAULT_PHYSICS },
    events: [],
  };
}

// ⚠ 템플릿은 `effects`(후처리)를 켜지 않는다 — 성능 때문.
//   `PostProcessingEffects`는 effects가 하나도 없고 preset이 'none'이면 **EffectComposer를 아예 안 만든다**.
//   하나라도 켜는 순간 에디터·뷰어 양쪽에 전체 화면 패스가 붙고, 에디터 캔버스는 `preserveDrawingBuffer: true`와
//   겹쳐 더 나빠진다(특히 Bloom의 mipmapBlur는 다단계 다운/업샘플). 분위기는 조명·emissive로 만들고,
//   후처리는 사용자가 Environment ▸ Post Processing에서 직접 켜도록 남겨 둔다.
const base = (): Omit<ProjectSceneSchema, 'projectId' | 'sceneId' | 'objects'> => ({
  version: 1,
  assets: [],
  environment: { ...DEFAULT_ENVIRONMENT },
});

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    id: 'empty',
    name: '빈 씬',
    description: '바닥만 있는 빈 공간',
    emoji: '□',
    build: (projectId, sceneId) => ({
      ...base(), projectId, sceneId, objects: [],
    }),
  },
  {
    // 쇼룸 — "회색 박스 나열"이 아니라 **공간 연출**로 설계.
    //   ① 실내라 태양을 끄고(sunEnabled:false) 스포트라이트로 제품에 빛 웅덩이를 만든다(명암 대비 = 쇼룸의 핵심).
    //   ② 어두운 페더 월(뒷벽) + 밝은 제품 → 시선이 제품에 꽂힌다. 전면은 열어 두어 진입 시야를 확보.
    //   ③ 구도: 히어로를 중앙에서 살짝 왼쪽으로 밀고(3분할), 좌우 플린스를 비대칭 배치 + 전경 벤치로 깊이 레이어링.
    //   ④ 코브 조명(자체발광 띠)으로 천장을 훑는 간접광 느낌 → bloom과 함께 "매장" 분위기.
    //   ⑤ startView로 오프닝 컷을 지정 — 처음 열었을 때의 첫인상이 곧 템플릿의 값어치.
    id: 'showroom',
    name: '쇼룸',
    description: '스포트라이트로 연출한 제품 전시 공간',
    emoji: '🏛',
    build: (projectId, sceneId) => ({
      ...base(),
      projectId,
      sceneId,
      environment: {
        ...DEFAULT_ENVIRONMENT,
        // 전면이 열려 있어 바깥이 살짝 보인다 — 실내가 어두우므로 바깥은 밝은 회색 그라데이션.
        sky: { type: 'gradient', value: '#c8d2dc', value2: '#eef1f4' },
        // 실내 씬: 태양 끔. 밝기는 스포트 + 낮은 환경광이 만든다(균일하게 밝히면 입체감이 죽는다).
        lights: {
          ambientIntensity: 0.28,
          ambientColor: '#c9d4e4',
          directionalIntensity: 0,
          directionalPosition: { x: 5, y: 10, z: 5 },
          sunEnabled: false,
        },
        toneMappingExposure: 1.05,
        contactShadows: false,
        disableWalk: false, // 걸어 들어가 볼 수 있는 공간
        startView: { position: { x: 6.2, y: 3.1, z: 10.5 }, target: { x: -0.6, y: 1.15, z: -3.5 }, fov: 38 },
      },
      objects: [
        // ── 구조 ─────────────────────────────────────────────
        // 광택 바닥 — roughness를 낮춰 조명이 은은하게 비친다(쇼룸의 '매끈한 바닥' 느낌).
        mesh('plane', '바닥', [0, 0, -2], [16, 1, 20], '#d9d6d2', { roughness: 0.14, metalness: 0.06, cast: false }),
        mesh('box', '천장', [0, 4.2, -2], [16, 0.2, 20], '#f2f0ee', { roughness: 0.95, cast: false }),
        // 페더 월(뒷벽) — 어두운 차콜. 밝은 제품과 대비를 만드는 배경.
        mesh('box', '페더 월', [0, 2.1, -12], [16, 4.2, 0.25], '#2f3237', { roughness: 0.85, cast: false }),
        mesh('box', '좌벽', [-8, 2.1, -2], [0.25, 4.2, 20], '#efece8', { roughness: 0.92, cast: false }),
        mesh('box', '우벽', [8, 2.1, -2], [0.25, 4.2, 20], '#efece8', { roughness: 0.92, cast: false }),
        // 코브 조명 — 천장 가장자리를 훑는 자체발광 띠(간접광 느낌 + bloom).
        mesh('box', '코브 조명 L', [-7.6, 3.95, -2], [0.12, 0.1, 19], '#ffffff', { emissive: '#ffe9c9', roughness: 1, cast: false, solid: false }),
        mesh('box', '코브 조명 R', [7.6, 3.95, -2], [0.12, 0.1, 19], '#ffffff', { emissive: '#ffe9c9', roughness: 1, cast: false, solid: false }),
        // 페더 월 백라이트 — 벽에서 살짝 띄운 띠. 벽면을 씻어 제품 실루엣을 세운다.
        mesh('box', '월 워시 라인', [0, 3.5, -11.6], [12, 0.08, 0.08], '#ffffff', { emissive: '#9fd4ff', roughness: 1, cast: false, solid: false }),

        // ── 히어로 존(중앙에서 살짝 왼쪽 — 3분할 구도) ────────
        mesh('cylinder', '히어로 포디움', [-1.2, 0.18, -6.5], [3.6, 0.36, 3.6], '#f7f5f2', { roughness: 0.35 }),
        mesh('box', '히어로 제품', [-1.2, 1.06, -6.5], [1.5, 1.4, 1.5], '#23262b', {
          roughness: 0.28, metalness: 0.35, geom: { cornerRadius: 0.16, cornerSegments: 6 }, rot: [0, 22, 0],
        }),
        mesh('torus', '히어로 액센트', [-1.2, 2.05, -6.5], [1.15, 1.15, 1.15], '#d9a441', {
          roughness: 0.22, metalness: 0.9, geom: { tubeRatio: 0.14 }, rot: [78, 0, 0], solid: false,
        }),

        // ── 좌/우 플린스(비대칭 — 깊이·높이를 다르게) ─────────
        mesh('box', '플린스 L', [-5.2, 0.55, -4.2], [1.3, 1.1, 1.3], '#f7f5f2', { roughness: 0.4, geom: { cornerRadius: 0.06 } }),
        mesh('sphere', '전시품 L', [-5.2, 1.48, -4.2], [0.76, 0.76, 0.76], '#3b6ea5', { roughness: 0.15, metalness: 0.2 }),
        mesh('box', '플린스 R', [4.3, 0.42, -7.4], [1.5, 0.84, 1.5], '#f7f5f2', { roughness: 0.4, geom: { cornerRadius: 0.06 } }),
        mesh('cylinder', '전시품 R', [4.3, 1.24, -7.4], [0.62, 0.8, 0.62], '#b8483a', { roughness: 0.3 }),

        // ── 전경 레이어(깊이감) ───────────────────────────────
        mesh('box', '라운지 벤치', [2.6, 0.22, 2.2], [3.4, 0.44, 1.1], '#8d8681', { roughness: 0.7, geom: { cornerRadius: 0.1 } }),
        mesh('box', '리셉션 카운터', [-6.1, 0.55, 1.6], [2.2, 1.1, 0.9], '#3a3d42', { roughness: 0.5, geom: { cornerRadius: 0.04 } }),
        // 화분 — 원기둥 화분 + 구체 수관 두 개(현실감용 소품).
        mesh('cylinder', '화분', [6.6, 0.3, 0.4], [0.7, 0.6, 0.7], '#57534e', { roughness: 0.8 }),
        mesh('sphere', '수관 하단', [6.6, 0.95, 0.4], [1.15, 0.95, 1.15], '#4a7c52', { roughness: 0.9, solid: false }),
        mesh('sphere', '수관 상단', [6.75, 1.45, 0.25], [0.8, 0.72, 0.8], '#568a5e', { roughness: 0.9, solid: false }),

        // ── 조명(제품마다 빛 웅덩이) ──────────────────────────
        spot('스포트 · 히어로', [-1.2, 3.9, -6.0], { intensity: 55, angle: 0.42, penumbra: 0.75, distance: 12, color: '#fff1dc', shadow: true }),
        spot('스포트 · 좌', [-5.2, 3.9, -4.2], { intensity: 26, angle: 0.38, penumbra: 0.8, distance: 10 }),
        spot('스포트 · 우', [4.3, 3.9, -7.4], { intensity: 26, angle: 0.38, penumbra: 0.8, distance: 10 }),
        // 진입부 쿨 필 — 전경이 새까매지지 않게 받쳐 준다(키=따뜻 / 필=차가움 대비).
        spot('필 라이트 · 입구', [1.5, 4.0, 4.5], { intensity: 18, angle: 0.85, penumbra: 1, distance: 16, color: '#cfe0f5' }),
      ],
    }),
  },
  {
    // 갤러리 — 쇼룸이 '제품'이라면 여기는 '벽면'이 주인공.
    //   ① 화이트 큐브: 벽·천장·바닥을 밝은 무채색으로 통일해 작품 색만 남긴다(쇼룸과 정반대 전략).
    //   ② 천창(skylight) — 천장 자체발광 패널로 위에서 고르게 떨어지는 자연광. 갤러리의 전형적인 빛.
    //   ③ 픽처 라이트: 액자마다 스포트를 벽 쪽으로 기울여 캔버스를 씻어낸다(rot X로 조준).
    //   ④ 구도: 가벽 두 장을 엇갈리게 세워 동선을 S자로 만들고, 정면이 한 번에 다 보이지 않게 한다.
    id: 'gallery',
    name: '갤러리',
    description: '천창과 픽처 라이트가 있는 화이트 큐브',
    emoji: '🖼',
    build: (projectId, sceneId) => ({
      ...base(),
      projectId,
      sceneId,
      environment: {
        ...DEFAULT_ENVIRONMENT,
        sky: { type: 'gradient', value: '#e8eaec', value2: '#f6f7f8' },
        lights: {
          ambientIntensity: 0.55,
          ambientColor: '#eef2f7',
          directionalIntensity: 0,
          directionalPosition: { x: 0, y: 10, z: 0 },
          sunEnabled: false,
        },
        toneMappingExposure: 1,
        contactShadows: false,
        disableWalk: false,
        startView: { position: { x: 5.4, y: 2.6, z: 11 }, target: { x: -1, y: 1.6, z: -2 }, fov: 42 },
      },
      objects: [
        // ── 화이트 큐브 ───────────────────────────────────────
        mesh('plane', '바닥', [0, 0, 0], [20, 1, 22], '#dcdad6', { roughness: 0.55, cast: false }),
        mesh('box', '천장', [0, 4.6, 0], [20, 0.2, 22], '#f4f4f5', { roughness: 0.95, cast: false }),
        mesh('box', '뒷벽', [0, 2.3, -11], [20, 4.6, 0.2], '#f2f1ef', { roughness: 0.95, cast: false }),
        mesh('box', '좌벽', [-10, 2.3, 0], [0.2, 4.6, 22], '#f2f1ef', { roughness: 0.95, cast: false }),
        mesh('box', '우벽', [10, 2.3, 0], [0.2, 4.6, 22], '#f2f1ef', { roughness: 0.95, cast: false }),
        // 천창 — 천장에 박힌 발광 패널 2줄(위에서 고르게 떨어지는 빛의 근원처럼 보이게).
        mesh('box', '천창 A', [-3.5, 4.44, -2], [3.2, 0.06, 13], '#ffffff', { emissive: '#ffffff', roughness: 1, cast: false, solid: false }),
        mesh('box', '천창 B', [3.5, 4.44, -2], [3.2, 0.06, 13], '#ffffff', { emissive: '#ffffff', roughness: 1, cast: false, solid: false }),

        // ── 가벽(엇갈리게 세워 S자 동선) ──────────────────────
        mesh('box', '가벽 L', [-3.6, 1.8, -3.5], [0.24, 3.6, 8], '#f2f1ef', { roughness: 0.95 }),
        mesh('box', '가벽 R', [3.6, 1.8, 1.5], [0.24, 3.6, 8], '#f2f1ef', { roughness: 0.95 }),

        // ── 작품(액자 = 프레임 박스 + 캔버스 면) ──────────────
        // 뒷벽 3점 — 가운데를 크게 걸어 시선의 종착점으로.
        mesh('box', '액자 1 · 프레임', [-4.6, 1.85, -10.8], [1.5, 1.9, 0.08], '#2b2b2b', { roughness: 0.6, solid: false }),
        mesh('box', '액자 1 · 캔버스', [-4.6, 1.85, -10.72], [1.34, 1.74, 0.02], '#8fa9c4', { roughness: 0.85, solid: false }),
        mesh('box', '액자 2 · 프레임', [0, 2.0, -10.8], [2.6, 2.6, 0.08], '#2b2b2b', { roughness: 0.6, solid: false }),
        mesh('box', '액자 2 · 캔버스', [0, 2.0, -10.72], [2.42, 2.42, 0.02], '#c98b6b', { roughness: 0.85, solid: false }),
        mesh('box', '액자 3 · 프레임', [4.6, 1.85, -10.8], [1.5, 1.9, 0.08], '#2b2b2b', { roughness: 0.6, solid: false }),
        mesh('box', '액자 3 · 캔버스', [4.6, 1.85, -10.72], [1.34, 1.74, 0.02], '#7e9c7f', { roughness: 0.85, solid: false }),
        // 가벽에 건 1점(측면에서만 보이게 — 돌아 들어가는 재미)
        mesh('box', '액자 4 · 프레임', [-3.44, 1.9, -3.5], [0.08, 2.2, 3], '#2b2b2b', { roughness: 0.6, solid: false, rot: [0, 0, 0] }),
        mesh('box', '액자 4 · 캔버스', [-3.36, 1.9, -3.5], [0.02, 2.0, 2.8], '#b9a4c9', { roughness: 0.85, solid: false }),

        // ── 조각 + 관람 벤치 ──────────────────────────────────
        mesh('cylinder', '조각 좌대', [2.2, 0.45, -5.5], [1.1, 0.9, 1.1], '#eceae7', { roughness: 0.4 }),
        mesh('sphere', '조각', [2.2, 1.32, -5.5], [0.9, 0.9, 0.9], '#9aa3ab', { roughness: 0.25, metalness: 0.65 }),
        mesh('box', '관람 벤치', [0, 0.21, -5.5], [2.8, 0.42, 0.8], '#3f3b38', { roughness: 0.7, geom: { cornerRadius: 0.08 } }),

        // ── 픽처 라이트(벽을 향해 기울인 스포트) ───────────────
        // rot X 음수 = 빔이 -Z(뒷벽) 쪽으로 기운다. 액자 위에서 캔버스를 비스듬히 씻어낸다.
        spot('픽처 라이트 · 좌', [-4.6, 4.1, -9.3], { intensity: 22, angle: 0.34, penumbra: 0.6, distance: 9, rot: [-28, 0, 0] }),
        spot('픽처 라이트 · 중', [0, 4.1, -9.0], { intensity: 30, angle: 0.38, penumbra: 0.6, distance: 9, rot: [-30, 0, 0] }),
        spot('픽처 라이트 · 우', [4.6, 4.1, -9.3], { intensity: 22, angle: 0.34, penumbra: 0.6, distance: 9, rot: [-28, 0, 0] }),
        spot('스포트 · 조각', [2.2, 4.2, -5.5], { intensity: 20, angle: 0.3, penumbra: 0.8, distance: 8, color: '#ffffff', shadow: true }),
      ],
    }),
  },
  {
    // 광장 — 유일한 '야외' 템플릿. 실내 둘과 정반대로 **태양이 주인공**.
    //   ① 늦은 오후의 낮은 태양(y가 낮음) → 긴 그림자가 바닥에 깔린다. 야외의 입체감은 이 그림자가 만든다.
    //   ② 안개(exp)로 원경 건물을 하늘에 녹여 깊이(공기원근)를 만든다 — 없으면 판때기처럼 보인다.
    //   ③ 구도: 중앙 분수를 축으로 삼되 정면 대칭을 피하고, 건물 스카이라인은 높낮이를 다르게 세운다.
    //      가로수를 화면 가장자리에 둬 프레이밍(자연스러운 액자) 효과.
    id: 'plaza',
    name: '광장',
    description: '늦은 오후의 야외 광장 — 긴 그림자와 분수',
    emoji: '🌆',
    build: (projectId, sceneId) => ({
      ...base(),
      projectId,
      sceneId,
      environment: {
        ...DEFAULT_ENVIRONMENT,
        // 오후 하늘 — 천정은 맑은 파랑, 지평선은 옅은 금빛.
        sky: { type: 'gradient', value: '#6ba3d6', value2: '#f3e2c8' },
        lights: {
          ambientIntensity: 0.5,
          ambientColor: '#bcd3ef',      // 하늘빛이 그림자에 스며든 느낌(그림자를 파랗게)
          directionalIntensity: 2.1,
          directionalPosition: { x: 14, y: 6, z: 9 }, // 낮은 고도 = 긴 그림자
          directionalColor: '#ffd9a8',  // 오후의 따뜻한 햇빛
          shadowIntensity: 0.85,
        },
        toneMappingExposure: 1,
        fog: { enabled: true, color: '#dbe6f0', near: 30, far: 120, mode: 'exp', density: 0.012 },
        contactShadows: false,
        disableWalk: false,
        startView: { position: { x: 9, y: 4.2, z: 15 }, target: { x: -1, y: 1.2, z: -2 }, fov: 45 },
      },
      objects: [
        // ── 지면 ──────────────────────────────────────────────
        mesh('plane', '광장 바닥', [0, 0, 0], [60, 1, 60], '#b9b2a6', { roughness: 0.9, cast: false }),
        // 중앙 원형 포장 — 바닥 톤을 나눠 '광장의 중심'을 만든다.
        mesh('cylinder', '중앙 포장', [0, 0.02, -2], [16, 0.04, 16], '#a79f92', { roughness: 0.85, cast: false, solid: false }),

        // ── 분수(중심축) ──────────────────────────────────────
        mesh('cylinder', '분수 외벽', [0, 0.35, -2], [5, 0.7, 5], '#cfc8bb', { roughness: 0.7 }),
        mesh('cylinder', '수면', [0, 0.62, -2], [4.5, 0.06, 4.5], '#4d8fb8', { roughness: 0.08, metalness: 0.3, cast: false, solid: false }),
        mesh('cylinder', '분수 기둥', [0, 1.1, -2], [0.8, 1.6, 0.8], '#cfc8bb', { roughness: 0.7 }),
        mesh('sphere', '분수 조형', [0, 2.15, -2], [1.3, 1.3, 1.3], '#9fb7c4', { roughness: 0.2, metalness: 0.5 }),

        // ── 스카이라인(높낮이를 다르게, 비대칭) ────────────────
        mesh('box', '건물 A', [-16, 7, -22], [10, 14, 10], '#8d8b86', { roughness: 0.9, cast: true, receive: false }),
        mesh('box', '건물 B', [-4, 11, -26], [9, 22, 9], '#7c7a76', { roughness: 0.9, cast: true, receive: false }),
        mesh('box', '건물 C', [9, 8.5, -24], [11, 17, 11], '#96938d', { roughness: 0.9, cast: true, receive: false }),
        mesh('box', '건물 D', [21, 5.5, -19], [9, 11, 9], '#83817c', { roughness: 0.9, cast: true, receive: false }),
        mesh('box', '저층 상가', [-20, 2.5, -6], [7, 5, 12], '#9a9186', { roughness: 0.9 }),

        // ── 가로수(가장자리 프레이밍) ─────────────────────────
        mesh('cylinder', '가로수 1 · 줄기', [-9, 1.4, 4], [0.42, 2.8, 0.42], '#6b5844', { roughness: 0.95 }),
        mesh('sphere', '가로수 1 · 수관', [-9, 3.5, 4], [4.2, 3.4, 4.2], '#5c8250', { roughness: 0.95, solid: false }),
        mesh('cylinder', '가로수 2 · 줄기', [10, 1.6, 2], [0.46, 3.2, 0.46], '#6b5844', { roughness: 0.95 }),
        mesh('sphere', '가로수 2 · 수관', [10, 4.0, 2], [4.8, 3.8, 4.8], '#547a49', { roughness: 0.95, solid: false }),
        mesh('cylinder', '가로수 3 · 줄기', [-13, 1.3, -9], [0.4, 2.6, 0.4], '#6b5844', { roughness: 0.95 }),
        mesh('sphere', '가로수 3 · 수관', [-13, 3.3, -9], [3.8, 3.1, 3.8], '#628a55', { roughness: 0.95, solid: false }),

        // ── 스트리트 퍼니처 ───────────────────────────────────
        mesh('box', '벤치 1', [-6, 0.24, 3.5], [2.6, 0.48, 0.7], '#7a5a3c', { roughness: 0.85, geom: { cornerRadius: 0.08 } }),
        mesh('box', '벤치 2', [6.5, 0.24, 4.2], [2.6, 0.48, 0.7], '#7a5a3c', { roughness: 0.85, geom: { cornerRadius: 0.08 }, rot: [0, -18, 0] }),
        mesh('cylinder', '가로등 · 기둥', [-4.5, 2.2, 6], [0.16, 4.4, 0.16], '#3f4349', { roughness: 0.6, metalness: 0.4 }),
        mesh('sphere', '가로등 · 등', [-4.5, 4.5, 6], [0.5, 0.5, 0.5], '#ffffff', { emissive: '#ffe6b0', roughness: 1, solid: false }),
        mesh('cylinder', '가로등 2 · 기둥', [7.5, 2.2, -8], [0.16, 4.4, 0.16], '#3f4349', { roughness: 0.6, metalness: 0.4 }),
        mesh('sphere', '가로등 2 · 등', [7.5, 4.5, -8], [0.5, 0.5, 0.5], '#ffffff', { emissive: '#ffe6b0', roughness: 1, solid: false }),
        // 계단 3단 — 광장 레벨 차이(원경으로 올라가는 느낌)
        mesh('box', '계단 1', [0, 0.09, 9.5], [18, 0.18, 1.1], '#b0a89b', { roughness: 0.9 }),
        mesh('box', '계단 2', [0, 0.27, 10.6], [18, 0.18, 1.1], '#b0a89b', { roughness: 0.9 }),
        mesh('box', '계단 3', [0, 0.45, 11.7], [18, 0.18, 1.1], '#b0a89b', { roughness: 0.9 }),
      ],
    }),
  },
  {
    // 카페 — 셋 중 가장 '따뜻한' 씬. 아늑함은 **빛의 색과 높이**에서 나온다.
    //   ① 창문(자체발광 패널) + 창 바깥에서 들어오는 스포트 → 낮 시간 자연광이 비스듬히 깔린다.
    //   ② 펜던트 조명: 테이블마다 낮게 매단 갓 + 포인트 라이트. 눈높이 아래 광원이 아늑함을 만든다.
    //   ③ 구도: 카운터를 한쪽 벽으로 몰고 테이블을 대각선으로 흩어 놔 정면 대칭을 피한다.
    //      창가 2인석을 전경에 둬 깊이 레이어를 만든다.
    id: 'cafe',
    name: '카페',
    description: '창가 자연광과 펜던트 조명이 있는 카페',
    emoji: '☕',
    build: (projectId, sceneId) => ({
      ...base(),
      projectId,
      sceneId,
      environment: {
        ...DEFAULT_ENVIRONMENT,
        sky: { type: 'gradient', value: '#cfe0ee', value2: '#f6efe2' }, // 창 밖 낮 하늘
        lights: {
          ambientIntensity: 0.42,
          ambientColor: '#e8d9c4',   // 나무·벽돌에 반사된 따뜻한 실내 반사광
          directionalIntensity: 0,
          directionalPosition: { x: 3, y: 8, z: 3 },
          sunEnabled: false,
        },
        toneMappingExposure: 1.05,
        contactShadows: false,
        disableWalk: false,
        startView: { position: { x: 4.6, y: 2.3, z: 7.4 }, target: { x: -0.8, y: 1.1, z: -1.5 }, fov: 44 },
      },
      objects: [
        // ── 공간 ──────────────────────────────────────────────
        mesh('plane', '바닥', [0, 0, 0], [12, 1, 13], '#8a5a34', { roughness: 0.75, cast: false }),
        mesh('box', '천장', [0, 3.4, 0], [12, 0.2, 13], '#e8ddcd', { roughness: 0.95, cast: false }),
        mesh('box', '뒷벽(벽돌)', [0, 1.7, -6.5], [12, 3.4, 0.2], '#8c5744', { roughness: 0.95, cast: false }),
        mesh('box', '좌벽', [-6, 1.7, 0], [0.2, 3.4, 13], '#e3d6c3', { roughness: 0.95, cast: false }),
        mesh('box', '우벽(창측)', [6, 1.7, 0], [0.2, 3.4, 13], '#e3d6c3', { roughness: 0.95, cast: false }),

        // ── 창 — 발광 패널 + 창틀. 빛이 들어오는 '근원'이 보여야 자연광으로 읽힌다.
        mesh('box', '창 1', [5.88, 1.9, -2.5], [0.06, 1.9, 3], '#ffffff', { emissive: '#fff3dd', roughness: 1, cast: false, solid: false }),
        mesh('box', '창 2', [5.88, 1.9, 2], [0.06, 1.9, 3], '#ffffff', { emissive: '#fff3dd', roughness: 1, cast: false, solid: false }),
        mesh('box', '창틀 중앙', [5.84, 1.9, -0.25], [0.1, 2.1, 0.14], '#5c4632', { roughness: 0.8, solid: false }),

        // ── 바 카운터(한쪽 벽으로) ────────────────────────────
        mesh('box', '카운터', [-3.6, 0.55, -4.6], [4.6, 1.1, 1.1], '#5f3d26', { roughness: 0.5, geom: { cornerRadius: 0.05 } }),
        mesh('box', '카운터 상판', [-3.6, 1.14, -4.6], [4.9, 0.09, 1.3], '#33251b', { roughness: 0.25, metalness: 0.15 }),
        mesh('box', '백 선반', [-3.6, 2.1, -6.2], [4.4, 0.08, 0.34], '#5f3d26', { roughness: 0.7, solid: false }),
        mesh('box', '백 선반 2', [-3.6, 2.6, -6.2], [4.4, 0.08, 0.34], '#5f3d26', { roughness: 0.7, solid: false }),
        mesh('cylinder', '에스프레소 머신', [-4.8, 1.45, -4.7], [0.66, 0.52, 0.66], '#c0c4c8', { roughness: 0.2, metalness: 0.8 }),
        // 스툴 2개
        mesh('cylinder', '스툴 1', [-2.4, 0.36, -3.4], [0.44, 0.72, 0.44], '#3f3a35', { roughness: 0.7 }),
        mesh('cylinder', '스툴 2', [-1.3, 0.36, -3.4], [0.44, 0.72, 0.44], '#3f3a35', { roughness: 0.7 }),

        // ── 테이블(대각선 배치) ───────────────────────────────
        mesh('cylinder', '테이블 1 · 다리', [1.6, 0.36, -1.6], [0.16, 0.72, 0.16], '#4a3728', { roughness: 0.6 }),
        mesh('cylinder', '테이블 1 · 상판', [1.6, 0.74, -1.6], [1.5, 0.08, 1.5], '#7a5233', { roughness: 0.45 }),
        mesh('box', '의자 1a', [0.65, 0.24, -1.6], [0.5, 0.48, 0.5], '#4a4038', { roughness: 0.8, geom: { cornerRadius: 0.06 } }),
        mesh('box', '의자 1b', [2.55, 0.24, -1.6], [0.5, 0.48, 0.5], '#4a4038', { roughness: 0.8, geom: { cornerRadius: 0.06 } }),

        mesh('cylinder', '테이블 2 · 다리', [3.4, 0.36, 2.6], [0.16, 0.72, 0.16], '#4a3728', { roughness: 0.6 }),
        mesh('cylinder', '테이블 2 · 상판', [3.4, 0.74, 2.6], [1.3, 0.08, 1.3], '#7a5233', { roughness: 0.45 }),
        mesh('box', '의자 2a', [3.4, 0.24, 1.75], [0.5, 0.48, 0.5], '#4a4038', { roughness: 0.8, geom: { cornerRadius: 0.06 } }),
        mesh('box', '의자 2b', [3.4, 0.24, 3.45], [0.5, 0.48, 0.5], '#4a4038', { roughness: 0.8, geom: { cornerRadius: 0.06 } }),

        // ── 소품 ──────────────────────────────────────────────
        mesh('cylinder', '컵', [1.35, 0.83, -1.4], [0.16, 0.11, 0.16], '#f2ede4', { roughness: 0.5, solid: false }),
        mesh('cylinder', '화분', [5, 0.3, -5.2], [0.66, 0.6, 0.66], '#8c6b4f', { roughness: 0.85 }),
        mesh('sphere', '식물', [5, 0.95, -5.2], [1.1, 0.9, 1.1], '#4f7a4a', { roughness: 0.95, solid: false }),

        // ── 조명 ──────────────────────────────────────────────
        // 펜던트 = 원뿔 갓(frustum topScale 0.25) + 그 안의 포인트 라이트. 낮게 매달아야 아늑하다.
        mesh('cylinder', '펜던트 1 · 선', [1.6, 2.75, -1.6], [0.03, 1.3, 0.03], '#2e2a26', { roughness: 0.8, solid: false }),
        mesh('frustum', '펜던트 1 · 갓', [1.6, 2.0, -1.6], [0.66, 0.44, 0.66], '#2e2a26', {
          roughness: 0.6, geom: { topScale: 0.25 }, emissive: '#3a2a18', solid: false,
        }),
        point('펜던트 1 · 빛', [1.6, 1.82, -1.6], { intensity: 9, distance: 6, color: '#ffcf94' }),

        mesh('cylinder', '펜던트 2 · 선', [3.4, 2.75, 2.6], [0.03, 1.3, 0.03], '#2e2a26', { roughness: 0.8, solid: false }),
        mesh('frustum', '펜던트 2 · 갓', [3.4, 2.0, 2.6], [0.66, 0.44, 0.66], '#2e2a26', {
          roughness: 0.6, geom: { topScale: 0.25 }, emissive: '#3a2a18', solid: false,
        }),
        point('펜던트 2 · 빛', [3.4, 1.82, 2.6], { intensity: 9, distance: 6, color: '#ffcf94' }),

        // 창에서 들어오는 낮빛 — 창 바깥에 두고 실내로 비스듬히(rot Z 양수 = -X 방향으로 기움).
        spot('창 자연광', [7.5, 3.2, -0.4], { intensity: 45, angle: 0.95, penumbra: 1, distance: 20, color: '#fff2da', rot: [0, 0, 58], shadow: true }),
        // 카운터 작업등
        spot('카운터 조명', [-3.6, 3.1, -4.6], { intensity: 16, angle: 0.6, penumbra: 0.9, distance: 8, color: '#ffe3b8' }),
      ],
    }),
  },
  {
    // ── 공포 게임: 「폐병원 — 마지막 근무」 ─────────────────────────────
    // 다른 템플릿이 '보여주는 공간'이라면 이건 **플레이 가능한 게임**이다. 새 엔진 기능 없이 기존 조합만 썼다.
    //
    // ── 레퍼런스 설계(Amnesia · Outlast · Resident Evil) ──
    //   ① **페이싱(긴장↔이완)**: 계속 최대 압박이면 지치기만 한다 → 로비·보관실은 밝게, 복도·제단실은 어둡게.
    //   ② **세이프룸(RE)**: '보관실' — 함정 없음·초록 등·보급품. 바깥이 위험할수록 안전한 곳이 위험을 실감시킨다.
    //   ③ **자원 희소성(Amnesia의 기름 → 배터리)**: 60초마다 1칸 소모, 0이면 사망. 주워서 버틴다.
    //   ④ **무력하되 완전히 무력하진 않게**: 싸울 수단은 없지만 함정은 **보이고**(붉은 발광) 배터리는 **모을 수 있다**.
    //   ⑤ **탐색 강제 + 단계적 관문**: 열쇠 2개 → 지하 격벽 · 4개 → 최종 철문.
    //
    // ★ **레이아웃은 반드시 `levelReachability`로 검증할 것.** 눈으로 배치하면 벽 하나가 통로를 막아도 모른다 —
    //   실제로 보관실과 제단실이 4×6m 겹치고 지하 통로가 사방이 막혀 **깰 수 없는 게임**이 나왔는데도
    //   구조 검사 49개는 전부 통과했다. 방 사각형은 아래 주석의 좌표표를 유지하고, 바꾸면 검사를 다시 돌릴 것.
    //
    //   방 배치(겹침 없음):
    //     로비      x[ -4,  4]  z[ -1,   7]   ← 스폰 (0, 5)
    //     복도      x[ -2,  2]  z[-17,  -1]
    //     병실A     x[-12, -2]  z[-14,  -5]   (복도 서벽 z[-10,-8] 통로)
    //     병실B     x[  2, 12]  z[-14,  -5]   (복도 동벽 z[-10,-8] 통로)
    //     지하통로  x[-11, -8]  z[-19, -14]   (병실A 북벽 x[-10.5,-8.5] = 격벽)
    //     보관실    x[-17, -8]  z[-26, -19]   (통로 남단으로 연결)
    //     영안실    x[-25,-17]  z[-26, -19]   (보관실 서벽 z[-24,-21] 통로)
    //     제단실    x[ -7,  7]  z[-25, -17]   (복도 북단 x[-1,1] = 철문)
    //     탈출통로  x[-1.5,1.5] z[-28.5,-25]
    id: 'horror',
    name: '공포 게임',
    description: '배터리를 아끼며 열쇠 4개를 찾아 탈출하는 폐병원 — 바로 플레이 가능',
    emoji: '🕯',
    build: (projectId, sceneId) => {
      const id = {
        door: MathUtils.generateUUID(),    // 최종 철문 — keys>=4
        gate: MathUtils.generateUUID(),    // 지하 격벽 — keys>=2
        key1: MathUtils.generateUUID(),
        key2: MathUtils.generateUUID(),
        key3: MathUtils.generateUUID(),
        key4: MathUtils.generateUUID(),
        scare1: MathUtils.generateUUID(),
        scare2: MathUtils.generateUUID(),
        scare3: MathUtils.generateUUID(),
      };
      const bat = [0, 1, 2, 3, 4, 5].map(() => MathUtils.generateUUID());
      const ev = (
        trigger: EventSchema['trigger'], action: EventSchema['action'], value: string,
        extra: Partial<EventSchema> = {},
      ): EventSchema => ({ id: MathUtils.generateUUID(), trigger, action, value, ...extra });

      const sensor = (
        name: string, pos: [number, number, number], scale: [number, number, number],
        color: string, emissive: string, events: EventSchema[],
        opts: { id?: string; opacity?: number } = {},
      ): ObjectNodeSchema => ({
        id: opts.id ?? MathUtils.generateUUID(),
        name,
        assetId: null,
        primitiveShape: 'box',
        material: { color, emissive, roughness: 0.9, metalness: 0, ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}) },
        render: { castShadow: false, receiveShadow: false },
        parentId: null,
        layer: 'default',
        position: { x: pos[0], y: pos[1], z: pos[2] },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: scale[0], y: scale[1], z: scale[2] },
        visible: true,
        locked: false,
        physics: { ...DEFAULT_PHYSICS, enabled: true, colliderType: 'box', isSensor: true },
        events,
      });

      // ── 재질 팔레트 ── 같은 회색을 반복하면 '박스 나열'로 보인다. 표면마다 거칠기·색조를 갈랐다.
      const WALL = '#43403b';        // 때 낀 회벽(따뜻한 회색)
      const WALL_D = '#332f2c';      // 어두운 구역 벽
      const FLOOR = '#2e2b27';       // 리놀륨 바닥(약간 광택 → 조명이 비침)
      const FLOOR_TILE = '#35322d';
      const CEIL = '#1b1a18';
      const TRIM = '#5a544c';        // 걸레받이·문틀
      const METAL = '#6a6b70';
      const RUST = '#6b4a35';

      /** 벽 — 그림자 생성 off(내부에서만 보임). 걸레받이를 따로 붙여 '박스' 느낌을 줄인다. */
      const wall = (name: string, pos: [number, number, number], scale: [number, number, number], color = WALL) =>
        mesh('box', name, pos, scale, color, { roughness: 0.95, cast: false });
      /** 걸레받이(baseboard) — 벽과 바닥 경계에 어두운 띠. 있고 없고가 '공간처럼 보이는지'를 가른다. */
      const base_ = (name: string, pos: [number, number, number], scale: [number, number, number]) =>
        mesh('box', name, pos, scale, TRIM, { roughness: 0.8, cast: false, solid: false });
      /** 문틀 — 통로 양옆 기둥. 벽 구멍이 '문'으로 읽히게 한다. */
      const frame = (name: string, pos: [number, number, number], scale: [number, number, number]) =>
        mesh('box', name, pos, scale, TRIM, { roughness: 0.7, cast: false });
      const trap = (name: string, pos: [number, number, number], s: [number, number, number]) =>
        sensor(name, pos, s, '#4a0d0d', '#7a0f0f', [
          ev('area_enter', 'game_lose', '어둠 속에서 무언가가 당신을 붙잡았다.'),
        ]);
      const key = (name: string, pos: [number, number, number], oid: string) =>
        sensor(name, pos, [0.24, 0.24, 0.24], '#f0cc72', '#a07a12', [
          ev('area_enter', 'set_variable', 'keys|add|1'),
          ev('area_enter', 'hide_object', oid),
        ], { id: oid });
      const battery = (name: string, pos: [number, number, number], oid: string) =>
        sensor(name, pos, [0.18, 0.32, 0.18], '#2f6f4a', '#14c078', [
          ev('area_enter', 'set_variable', 'battery|add|1'),
          ev('area_enter', 'hide_object', oid),
        ], { id: oid });

      return {
        ...base(),
        projectId,
        sceneId,
        environment: {
          ...DEFAULT_ENVIRONMENT,
          sky: { type: 'gradient', value: '#04060a', value2: '#0a0e14' },
          fog: { enabled: true, color: '#05070b', near: 1, far: 30, mode: 'exp', density: 0.105 },
          lights: {
            ambientIntensity: 0.11,
            ambientColor: '#8fa3c4',   // 차가운 달빛 — 촛불·비상등(주황)과 보색 대비
            directionalIntensity: 0,
            directionalPosition: { x: 5, y: 10, z: 5 },
            sunEnabled: false,
          },
          // ★ 이 템플릿만 후처리를 켠다 — 공포는 **비네트(가장자리 어둠)와 블룸(빛 번짐)이 룩의 절반**이라
          //   끄면 아무리 배치해도 '밝은 회색 박스'로 보인다. 다른 템플릿은 성능 때문에 여전히 끈 상태.
          //   (EffectComposer가 붙는 비용은 감수 — 대신 SSAO·DoF 같은 비싼 것은 안 켠다.)
          effects: { vignette: 0.62, bloom: 0.5, contrast: 0.14, saturation: -0.12 },
          toneMappingExposure: 1.05,
          contactShadows: false,
          disableWalk: false,
          defaultMode: 'play',
          interactRange: 2.5,
          playerStartPosition: { x: 0, y: 1.2, z: 5 },
          startView: { position: { x: 0, y: 1.7, z: 6.4 }, target: { x: 0, y: 1.5, z: -6 }, fov: 55 },
          defaultPopup: { width: '520px', height: '380px', position: 'center' },
          // 손전등 — T키 토글. 꺼짐(기본 시작 상태)=짙은 안개로 눈앞(~3.5m)만, 켜짐=옅은 안개로 멀리(~22m)까지.
          //   battery는 **켜져 있는 동안에만** 12초당 1씩 소모(꺼두면 안 준다 — "존재 비용"이 아니라 "사용 비용").
          //   배터리 10개(시작 4 + 획득 6) × 12초 = 총 120초(2분)의 사용 가능 시간. 안 켜면 무제한으로 버틸 수 있지만
          //   그 상태론 몇 미터 앞도 안 보여 사실상 탐색이 불가능 — "켜야만 진행할 수 있게" 강제하는 쪽으로 설계했다.
          flashlight: {
            enabled: true,
            color: '#fff4e0',
            intensity: 24,
            angle: 0.48,
            distance: 15,
            offFogDensity: 0.28,
            onFogDensity: 0.045,
            batteryVariable: 'battery',
            drainPerSec: 1 / 12,
          },
        },
        variables: [
          { id: MathUtils.generateUUID(), name: 'keys', type: 'number', initial: 0 },
          { id: MathUtils.generateUUID(), name: 'battery', type: 'number', initial: 4 },
          { id: MathUtils.generateUUID(), name: 'scared', type: 'boolean', initial: false },
          { id: MathUtils.generateUUID(), name: 'scared2', type: 'boolean', initial: false },
          { id: MathUtils.generateUUID(), name: 'scared3', type: 'boolean', initial: false },
        ],
        hudElements: [
          { id: MathUtils.generateUUID(), variable: 'keys', kind: 'text', label: '열쇠', position: 'top-left', color: '#f0cc72' },
          { id: MathUtils.generateUUID(), variable: 'battery', kind: 'bar', label: '손전등', position: 'top-left', color: '#14c078', max: 10 },
        ],
        sceneEvents: [
          ev('scene_start', 'show_popup',
            '<div style="font:15px/1.75 sans-serif;color:#d8d5d0;background:#0b0b0e;padding:26px;height:100%">'
            + '<div style="font-size:19px;color:#c9a227;margin-bottom:14px">폐병원 — 마지막 근무</div>'
            + '전기가 끊긴 병동에 혼자 남았다.<br>철문 너머로 나가려면 <b style="color:#f0cc72">열쇠 4개</b>가 필요하다.<br><br>'
            + '<b style="color:#14c078">T키로 손전등을 켠다.</b> 켜져 있는 동안만 배터리가 줄어드니 아껴 써라.<br>'
            + '배터리가 다 떨어지면 살아남지 못한다 — 방마다 <b style="color:#14c078">배터리</b>를 찾아라.<br><br>'
            + '<span style="color:#8a8780">WASD 이동 · 마우스 시점 · T 손전등 · 붉게 빛나는 바닥은 밟지 말 것</span></div>',
            { popup: { mode: 'html', bg: '#0b0b0e', title: '', width: '520px', height: '380px' } }),

          ev('variable_changed', 'show_popup', '배터리가 얼마 남지 않았다.', {
            conditions: [{ variable: 'battery', op: '<=', value: 1 }],
          }),
          ev('variable_changed', 'game_lose', '손전등이 꺼졌다. 어둠이 당신을 삼켰다.', {
            conditions: [{ variable: 'battery', op: '<=', value: 0 }],
          }),

          ev('variable_changed', 'set_actuator', id.gate + '|open', {
            conditions: [{ variable: 'keys', op: '>=', value: 2 }],
          }),
          ev('variable_changed', 'show_popup', '병실 안쪽에서 격벽이 열리는 소리가 들렸다.', {
            conditions: [{ variable: 'keys', op: '>=', value: 2 }],
          }),
          ev('variable_changed', 'set_actuator', id.door + '|open', {
            conditions: [{ variable: 'keys', op: '>=', value: 4 }],
          }),
          ev('variable_changed', 'show_popup', '복도 끝 철문이 열리는 소리가 들렸다.', {
            conditions: [{ variable: 'keys', op: '>=', value: 4 }],
          }),
        ],
        objects: [
          // ══════════ 로비 x[-4,4] z[-1,7] — 밝고 안전(이완) ══════════
          mesh('plane', '로비 바닥', [0, 0, 3], [8, 1, 8], FLOOR, { roughness: 0.55, metalness: 0.04, cast: false }),
          mesh('box', '로비 천장', [0, 4.2, 3], [8.4, 0.3, 8.4], CEIL, { roughness: 1, cast: false }),
          wall('로비 남벽', [0, 2.1, 7.15], [8.4, 4.2, 0.3]),
          wall('로비 서벽', [-4.15, 2.1, 3], [0.3, 4.2, 8.4]),
          wall('로비 동벽', [4.15, 2.1, 3], [0.3, 4.2, 8.4]),
          wall('로비 북벽 L', [-2.5, 2.1, -1.15], [3, 4.2, 0.3]),
          wall('로비 북벽 R', [2.5, 2.1, -1.15], [3, 4.2, 0.3]),
          base_('로비 걸레받이 S', [0, 0.09, 6.95], [8, 0.18, 0.08]),
          base_('로비 걸레받이 W', [-3.95, 0.09, 3], [0.08, 0.18, 8]),
          base_('로비 걸레받이 E', [3.95, 0.09, 3], [0.08, 0.18, 8]),
          frame('로비 문틀 L', [-1.1, 1.4, -1.15], [0.2, 2.8, 0.36]),
          frame('로비 문틀 R', [1.1, 1.4, -1.15], [0.2, 2.8, 0.36]),
          mesh('box', '접수 카운터', [-2.5, 0.52, 3.4], [3, 1.04, 0.8], '#4a3a2c', { roughness: 0.8, geom: { cornerRadius: 0.05 } }),
          mesh('box', '카운터 상판', [-2.5, 1.07, 3.4], [3.2, 0.08, 0.94], '#6b5a44', { roughness: 0.5, geom: { cornerRadius: 0.2 } }),
          mesh('box', '서류 더미', [-2.4, 1.16, 3.2], [0.44, 0.1, 0.32], '#c9c4b6', { roughness: 1, solid: false }),
          mesh('box', '서류 더미 2', [-1.6, 1.14, 3.6], [0.38, 0.06, 0.28], '#b8b3a4', { roughness: 1, rot: [0, 22, 0], solid: false }),
          mesh('box', '뒤집힌 의자', [2.3, 0.26, 2.4], [0.5, 0.52, 0.5], '#3a352f', { roughness: 0.9, rot: [0, 24, 74] }),
          mesh('box', '대기 벤치', [2.6, 0.24, 5.2], [2.4, 0.48, 0.7], '#4a4038', { roughness: 0.85, geom: { cornerRadius: 0.08 } }),
          mesh('box', '안내판', [0, 2.2, 6.95], [1.8, 0.6, 0.06], '#1f3a2c', { emissive: '#1f6b3c', roughness: 1, cast: false, solid: false }),
          mesh('cylinder', '천장 배관', [0, 3.95, 1.4], [0.16, 8, 0.16], RUST, { roughness: 0.85, rot: [90, 0, 0], cast: false, solid: false }),

          // ══════════ 복도 x[-2,2] z[-17,-1] ══════════
          mesh('plane', '복도 바닥', [0, 0, -9], [4, 1, 16], FLOOR_TILE, { roughness: 0.6, metalness: 0.04, cast: false }),
          mesh('box', '복도 천장', [0, 4.2, -9], [4.4, 0.3, 16], CEIL, { roughness: 1, cast: false }),
          wall('복도 서벽 A', [-2.15, 2.1, -13.5], [0.3, 4.2, 7]),
          wall('복도 서벽 B', [-2.15, 2.1, -4.5], [0.3, 4.2, 7]),
          wall('복도 동벽 A', [2.15, 2.1, -13.5], [0.3, 4.2, 7]),
          wall('복도 동벽 B', [2.15, 2.1, -4.5], [0.3, 4.2, 7]),
          base_('복도 걸레받이 W', [-1.95, 0.09, -9], [0.08, 0.18, 16]),
          base_('복도 걸레받이 E', [1.95, 0.09, -9], [0.08, 0.18, 16]),
          frame('병실A 문틀 N', [-2.15, 1.4, -10.2], [0.36, 2.8, 0.24]),
          frame('병실A 문틀 S', [-2.15, 1.4, -7.8], [0.36, 2.8, 0.24]),
          frame('병실B 문틀 N', [2.15, 1.4, -10.2], [0.36, 2.8, 0.24]),
          frame('병실B 문틀 S', [2.15, 1.4, -7.8], [0.36, 2.8, 0.24]),
          // 철문 벽(문 폭 2)
          wall('철문 벽 L', [-1.5, 2.1, -17.15], [1, 4.2, 0.3]),
          wall('철문 벽 R', [1.5, 2.1, -17.15], [1, 4.2, 0.3]),
          wall('철문 상인방', [0, 3.45, -17.15], [2, 1.5, 0.3]),
          mesh('box', '복도 들것', [1.3, 0.36, -3.2], [0.7, 0.7, 1.9], METAL, { roughness: 0.6, metalness: 0.35, rot: [0, 8, 0] }),
          mesh('box', '넘어진 링거대', [-1.4, 0.1, -12], [1.6, 0.12, 0.12], '#8a8d92', { roughness: 0.4, metalness: 0.6, rot: [0, 28, 0], solid: false }),
          mesh('cylinder', '복도 배관 L', [-1.85, 3.95, -9], [0.13, 15, 0.13], RUST, { roughness: 0.85, rot: [90, 0, 0], cast: false, solid: false }),
          mesh('cylinder', '복도 배관 R', [1.85, 3.95, -9], [0.1, 15, 0.1], '#4a4d52', { roughness: 0.7, rot: [90, 0, 0], cast: false, solid: false }),
          mesh('box', '벽 얼룩 1', [-1.98, 1.5, -6.4], [0.03, 1.6, 1.1], '#241d1b', { roughness: 1, cast: false, solid: false }),
          mesh('box', '벽 얼룩 2', [1.98, 1.2, -12.4], [0.03, 1.2, 0.9], '#241d1b', { roughness: 1, cast: false, solid: false }),

          // ══════════ 병실A x[-12,-2] z[-14,-5] ══════════
          mesh('plane', '병실A 바닥', [-7, 0, -9.5], [10, 1, 9], FLOOR, { roughness: 0.6, metalness: 0.03, cast: false }),
          mesh('box', '병실A 천장', [-7, 4.2, -9.5], [10.4, 0.3, 9.4], CEIL, { roughness: 1, cast: false }),
          wall('병실A 서벽', [-12.15, 2.1, -9.5], [0.3, 4.2, 9.4]),
          wall('병실A 남벽', [-7, 2.1, -5.15], [10.4, 4.2, 0.3]),
          // 북벽 — 격벽 통로 x[-10.5,-8.5]
          wall('병실A 북벽 L', [-11.25, 2.1, -14.15], [1.5, 4.2, 0.3]),
          wall('병실A 북벽 R', [-5.25, 2.1, -14.15], [6.5, 4.2, 0.3]),
          base_('병실A 걸레받이 W', [-11.95, 0.09, -9.5], [0.08, 0.18, 9]),
          base_('병실A 걸레받이 S', [-7, 0.09, -5.3], [10, 0.18, 0.08]),
          frame('격벽 문틀 L', [-10.62, 1.4, -14.15], [0.24, 2.8, 0.4]),
          frame('격벽 문틀 R', [-8.38, 1.4, -14.15], [0.24, 2.8, 0.4]),
          mesh('box', '침대 프레임', [-10, 0.32, -11.6], [1.1, 0.64, 2.2], '#5a5751', { roughness: 0.65, metalness: 0.3 }),
          mesh('box', '매트리스', [-10, 0.72, -11.6], [1.02, 0.2, 2.06], '#b8b2a4', { roughness: 1 }),
          mesh('box', '베개', [-10, 0.87, -12.4], [0.7, 0.14, 0.44], '#d2ccbe', { roughness: 1, solid: false }),
          mesh('box', '침대 프레임 2', [-10, 0.32, -7.8], [1.1, 0.64, 2.2], '#5a5751', { roughness: 0.65, metalness: 0.3 }),
          mesh('box', '매트리스 2', [-10, 0.72, -7.8], [1.02, 0.2, 2.06], '#a8a294', { roughness: 1, rot: [0, 5, 0] }),
          mesh('box', '가림막 레일', [-8.2, 2.9, -9.7], [0.06, 0.06, 4.4], METAL, { roughness: 0.5, metalness: 0.6, cast: false, solid: false }),
          mesh('box', '가림막', [-8.2, 1.75, -10.6], [0.06, 2.2, 2.2], '#7a8a86', { roughness: 1, opacity: 0.85 }),
          mesh('box', '수납장', [-3.4, 0.62, -13.2], [1.6, 1.24, 0.6], '#4a453e', { roughness: 0.88 }),
          mesh('box', '휠체어 좌판', [-4.6, 0.5, -6.6], [0.6, 0.1, 0.6], '#2f3238', { roughness: 0.7, metalness: 0.2, rot: [0, 30, 0] }),
          mesh('cylinder', '휠체어 바퀴', [-4.3, 0.32, -6.6], [0.62, 0.06, 0.62], '#22252a', { roughness: 0.8, rot: [0, 0, 90], solid: false }),
          mesh('cylinder', '수액 걸이', [-8.9, 0.9, -10.4], [0.05, 1.8, 0.05], '#8a8d92', { roughness: 0.4, metalness: 0.6, solid: false }),
          mesh('box', '깨진 창', [-12, 1.8, -8], [0.06, 1.2, 1.6], '#1a2430', { emissive: '#16324a', roughness: 0.3, cast: false, solid: false }),

          // ══════════ 병실B x[2,12] z[-14,-5] — 차가운 색(수술실) ══════════
          mesh('plane', '병실B 바닥', [7, 0, -9.5], [10, 1, 9], FLOOR_TILE, { roughness: 0.45, metalness: 0.06, cast: false }),
          mesh('box', '병실B 천장', [7, 4.2, -9.5], [10.4, 0.3, 9.4], CEIL, { roughness: 1, cast: false }),
          wall('병실B 동벽', [12.15, 2.1, -9.5], [0.3, 4.2, 9.4], '#474540'),
          wall('병실B 북벽', [7, 2.1, -14.15], [10.4, 4.2, 0.3]),
          wall('병실B 남벽', [7, 2.1, -5.15], [10.4, 4.2, 0.3]),
          base_('병실B 걸레받이 E', [11.95, 0.09, -9.5], [0.08, 0.18, 9]),
          base_('병실B 걸레받이 N', [7, 0.09, -13.95], [10, 0.18, 0.08]),
          mesh('box', '수술대 다리', [7.4, 0.4, -9.8], [0.5, 0.8, 0.5], METAL, { roughness: 0.5, metalness: 0.5 }),
          mesh('box', '수술대', [7.4, 0.88, -9.8], [1.3, 0.16, 2.4], '#8d939a', { roughness: 0.35, metalness: 0.45, geom: { cornerRadius: 0.1 } }),
          mesh('box', '기구 트레이', [9.6, 0.52, -7.4], [1, 1.04, 0.7], '#5a5b60', { roughness: 0.55, metalness: 0.35 }),
          mesh('box', '수술 도구', [9.6, 1.09, -7.4], [0.5, 0.06, 0.3], '#b8bec6', { roughness: 0.2, metalness: 0.9, solid: false }),
          mesh('box', '캐비닛', [3.6, 0.92, -13.2], [1.4, 1.84, 0.5], '#454039', { roughness: 0.88 }),
          mesh('box', '무너진 선반', [11, 0.72, -12], [1.2, 1.44, 0.5], '#454039', { roughness: 0.9, rot: [0, 0, 13] }),
          mesh('box', '무영등 암', [7.4, 3.235, -9.8], [0.1, 1.93, 0.1], METAL, { roughness: 0.4, metalness: 0.6, cast: false, solid: false }),
          mesh('cylinder', '무영등', [7.4, 2.24, -9.8], [1.1, 0.16, 1.1], '#c8ced6', { emissive: '#4a6a86', roughness: 0.3, metalness: 0.4, solid: false }),
          mesh('sphere', '깨진 전구', [4.6, 2.9, -9.5], [0.2, 0.2, 0.2], '#20201e', { roughness: 0.4, solid: false }),
          mesh('box', '타일 균열', [9, 0.02, -11.4], [2.2, 0.03, 1.6], '#232019', { roughness: 1, cast: false, solid: false }),

          // ══════════ 지하 통로 x[-11,-8] z[-19,-14] ══════════
          mesh('plane', '지하 통로 바닥', [-9.5, 0, -16.5], [3, 1, 5], '#292623', { roughness: 0.8, cast: false }),
          mesh('box', '통로 천장', [-9.5, 4.2, -16.5], [3.4, 0.3, 5], CEIL, { roughness: 1, cast: false }),
          wall('통로 서벽', [-11.15, 2.1, -16.5], [0.3, 4.2, 5], WALL_D),
          wall('통로 동벽', [-7.85, 2.1, -16.5], [0.3, 4.2, 5], WALL_D),
          mesh('cylinder', '통로 배관', [-8.2, 3.5, -16.5], [0.18, 4.8, 0.18], RUST, { roughness: 0.9, rot: [90, 0, 0], cast: false, solid: false }),
          mesh('box', '계단 턱', [-9.5, 0.12, -14.6], [3, 0.24, 0.5], '#3a352f', { roughness: 0.9 }),

          // ══════════ 보관실(세이프룸) x[-17,-8] z[-26,-19] ══════════
          mesh('plane', '보관실 바닥', [-12.5, 0, -22.5], [9, 1, 7], '#332f2a', { roughness: 0.75, cast: false }),
          mesh('box', '보관실 천장', [-12.5, 4.2, -22.5], [9.4, 0.3, 7.4], CEIL, { roughness: 1, cast: false }),
          wall('보관실 서벽 A', [-17.15, 2.1, -25.25], [0.3, 4.2, 1.5]),
          wall('보관실 서벽 B', [-17.15, 2.1, -20.05], [0.3, 4.2, 2.1]),
          wall('보관실 남벽', [-12.5, 2.1, -26.15], [9.4, 4.2, 0.3]),
          wall('보관실 동벽', [-7.85, 2.1, -22.5], [0.3, 4.2, 7.4]),
          wall('보관실 북벽', [-14, 2.1, -19.15], [6.4, 4.2, 0.3]),
          base_('보관실 걸레받이 S', [-12.5, 0.09, -25.95], [9, 0.18, 0.08]),
          mesh('box', '선반 A', [-16.4, 0.95, -24], [1.1, 1.9, 0.5], '#4a453e', { roughness: 0.88, rot: [0, 90, 0] }),
          mesh('box', '선반 B', [-16.4, 0.95, -21], [1.1, 1.9, 0.5], '#4a453e', { roughness: 0.88, rot: [0, 90, 0] }),
          mesh('box', '작업대', [-11.5, 0.46, -25.2], [2.6, 0.92, 1], '#4a3a2c', { roughness: 0.82 }),
          mesh('box', '작업대 상판', [-11.5, 0.95, -25.2], [2.76, 0.08, 1.1], '#6b5a44', { roughness: 0.5 }),
          mesh('box', '공구 상자', [-12.4, 1.11, -25.2], [0.7, 0.24, 0.4], '#7a4a20', { roughness: 0.6, metalness: 0.2, solid: false }),
          mesh('box', '보급 상자 1', [-9.4, 0.3, -24.4], [0.9, 0.6, 0.9], '#5a4a30', { roughness: 0.9 }),
          mesh('box', '보급 상자 2', [-9.4, 0.85, -24.4], [0.7, 0.5, 0.7], '#4a3d28', { roughness: 0.9, rot: [0, 18, 0] }),
          mesh('box', '안전 표식', [-12.5, 2.4, -25.95], [1.8, 0.5, 0.06], '#0f3a1e', { emissive: '#26b45c', roughness: 1, cast: false, solid: false }),
          mesh('box', '비상 등갓', [-12.5, 3.85, -22.5], [1.2, 0.14, 0.5], '#1f4a30', { emissive: '#2fd47a', roughness: 1, cast: false, solid: false }),

          // ══════════ 영안실 x[-25,-17] z[-26,-19] — 가장 깊은 곳 ══════════
          mesh('plane', '영안실 바닥', [-21, 0, -22.5], [8, 1, 7], '#26241f', { roughness: 0.8, cast: false }),
          mesh('box', '영안실 천장', [-21, 4.2, -22.5], [8.4, 0.3, 7.4], CEIL, { roughness: 1, cast: false }),
          wall('영안실 서벽', [-25.15, 2.1, -22.5], [0.3, 4.2, 7.4], WALL_D),
          wall('영안실 남벽', [-21, 2.1, -26.15], [8.4, 4.2, 0.3], WALL_D),
          wall('영안실 북벽', [-21, 2.1, -19.15], [8.4, 4.2, 0.3], WALL_D),
          frame('영안실 문틀 N', [-17.15, 1.4, -20.9], [0.4, 2.8, 0.24]),
          frame('영안실 문틀 S', [-17.15, 1.4, -24.1], [0.4, 2.8, 0.24]),
          // 시신 보관함 — 벽면 격자(이 방의 정체성)
          mesh('box', '보관함 벽', [-21, 1.2, -25.6], [7.6, 2.4, 0.8], '#7a8086', { roughness: 0.35, metalness: 0.45 }),
          mesh('box', '보관함 문 1', [-23.4, 1.7, -25.16], [1.1, 0.8, 0.06], '#9aa2a8', { roughness: 0.25, metalness: 0.6 }),
          mesh('box', '보관함 문 2', [-22.1, 1.7, -25.16], [1.1, 0.8, 0.06], '#9aa2a8', { roughness: 0.25, metalness: 0.6 }),
          mesh('box', '보관함 문 3', [-20.8, 1.7, -25.16], [1.1, 0.8, 0.06], '#8d949a', { roughness: 0.25, metalness: 0.6 }),
          mesh('box', '보관함 문 4', [-23.4, 0.75, -25.16], [1.1, 0.8, 0.06], '#9aa2a8', { roughness: 0.25, metalness: 0.6 }),
          mesh('box', '열린 보관함', [-22.1, 0.75, -25.16], [1.1, 0.8, 0.06], '#3a3f44', { roughness: 0.8 }),
          mesh('box', '빠져나온 트레이', [-22.1, 0.75, -24.2], [1, 0.08, 1.8], '#b8bec6', { roughness: 0.3, metalness: 0.7, solid: false }),
          mesh('box', '해부대', [-19.6, 0.46, -21.6], [1.3, 0.92, 2.4], '#8d939a', { roughness: 0.3, metalness: 0.5, geom: { cornerRadius: 0.06 } }),
          mesh('box', '기록 캐비닛', [-24.2, 0.9, -20.6], [0.6, 1.8, 1.6], '#454039', { roughness: 0.88 }),
          mesh('cylinder', '영안실 배관', [-21, 3.92, -21], [0.15, 7.6, 0.15], RUST, { roughness: 0.9, rot: [0, 0, 90], cast: false, solid: false }),

          // ══════════ 제단실 x[-7,7] z[-25,-17] — 종착지 ══════════
          mesh('plane', '제단실 바닥', [0, 0, -21], [14, 1, 8], '#241f1f', { roughness: 0.85, cast: false }),
          mesh('box', '제단실 천장', [0, 4.2, -21], [14.4, 0.3, 8.4], '#171514', { roughness: 1, cast: false }),
          wall('제단실 서벽', [-7.15, 2.1, -21], [0.3, 4.2, 8.4], WALL_D),
          wall('제단실 동벽', [7.15, 2.1, -21], [0.3, 4.2, 8.4], WALL_D),
          wall('제단실 남벽 L', [-4, 2.1, -17.15], [6, 4.2, 0.3], WALL_D),
          wall('제단실 남벽 R', [4, 2.1, -17.15], [6, 4.2, 0.3], WALL_D),
          wall('제단실 북벽 L', [-4.25, 2.1, -25.15], [5.5, 4.2, 0.3], WALL_D),
          wall('제단실 북벽 R', [4.25, 2.1, -25.15], [5.5, 4.2, 0.3], WALL_D),
          wall('출구 상인방', [0, 3.45, -25.15], [3.3, 1.5, 0.3], WALL_D),
          frame('출구 문틀 L', [-1.62, 1.4, -25.15], [0.24, 2.8, 0.4]),
          frame('출구 문틀 R', [1.62, 1.4, -25.15], [0.24, 2.8, 0.4]),
          mesh('plane', '탈출 통로', [0, 0, -26.8], [3, 1, 3.6], '#1c1a18', { roughness: 1, cast: false }),
          wall('탈출 통로 서벽', [-1.65, 2.1, -26.8], [0.3, 4.2, 3.6], WALL_D),
          wall('탈출 통로 동벽', [1.65, 2.1, -26.8], [0.3, 4.2, 3.6], WALL_D),
          mesh('box', '출구 표식', [0, 2.5, -28.4], [1.4, 0.44, 0.08], '#0f3a1e', { emissive: '#2fd47a', roughness: 1, cast: false, solid: false }),
          // 제단 — 방의 초점
          mesh('box', '제단 단', [0, 0.16, -21.5], [4, 0.32, 2.2], '#221d1c', { roughness: 0.92 }),
          mesh('box', '제단', [0, 0.62, -21.5], [3.2, 0.6, 1.4], '#2a2422', { roughness: 0.88, geom: { cornerRadius: 0.04 } }),
          mesh('cylinder', '촛불 1', [-1.2, 1.07, -21.5], [0.1, 0.3, 0.1], '#e8e0cf', { emissive: '#ff9a3c', roughness: 1, solid: false }),
          mesh('cylinder', '촛불 2', [0, 1.12, -21.7], [0.1, 0.4, 0.1], '#e8e0cf', { emissive: '#ffb060', roughness: 1, solid: false }),
          mesh('cylinder', '촛불 3', [1.2, 1.07, -21.4], [0.1, 0.3, 0.1], '#e8e0cf', { emissive: '#ff9a3c', roughness: 1, solid: false }),
          mesh('torus', '붉은 고리', [0, 0.04, -21.5], [5.4, 5.4, 5.4], '#5a0f0f', {
            emissive: '#8a1414', roughness: 1, rot: [90, 0, 0], geom: { tubeRatio: 0.018 }, cast: false, solid: false,
          }),
          mesh('torus', '붉은 고리 2', [0, 0.04, -21.5], [3.4, 3.4, 3.4], '#5a0f0f', {
            emissive: '#8a1414', roughness: 1, rot: [90, 0, 0], geom: { tubeRatio: 0.024 }, cast: false, solid: false,
          }),
          mesh('box', '벽 낙서 L', [-6.98, 1.7, -20], [0.03, 1.8, 2.4], '#3a0a0a', { emissive: '#5a0e0e', roughness: 1, cast: false, solid: false }),
          mesh('box', '벽 낙서 R', [6.98, 1.6, -22.4], [0.03, 1.6, 2], '#3a0a0a', { emissive: '#5a0e0e', roughness: 1, cast: false, solid: false }),
          mesh('box', '부서진 의자', [-4.6, 0.24, -19.4], [0.5, 0.5, 0.5], '#2f2a26', { roughness: 0.92, rot: [12, 40, 68] }),
          mesh('box', '흩어진 서류', [4.2, 0.02, -19.2], [1.6, 0.03, 1.2], '#6b665c', { roughness: 1, cast: false, solid: false }),

          // ══════════ 조명 8개 · 그림자는 제단 1개만 ══════════
          point('로비 비상등', [0, 3.8, 3], { color: '#ffb066', intensity: 7, distance: 10 }),
          point('복도 등 A', [0, 3.8, -5], { color: '#ffa85c', intensity: 3.2, distance: 7 }),
          point('복도 등 B', [0, 3.8, -14], { color: '#ff9a4c', intensity: 2.6, distance: 7 }),
          point('병실A 등', [-7, 3.8, -9.5], { color: '#ffb066', intensity: 3.4, distance: 9 }),
          point('병실B 무영등', [7.4, 2.3, -9.8], { color: '#cfe0f5', intensity: 5, distance: 8 }),
          point('보관실 등', [-12.5, 3.8, -22.5], { color: '#8ff0b8', intensity: 7, distance: 10 }),  // 세이프룸
          point('영안실 등', [-21, 3.8, -22.5], { color: '#9fb6d4', intensity: 2.4, distance: 8 }),
          spot('제단 조명', [0, 4, -21.5], { color: '#ff8a3c', intensity: 26, angle: 0.62, penumbra: 0.9, distance: 12, shadow: true }),

          // ══════════ 열쇠 4개 — 각 방 안쪽 구석 ══════════
          key('열쇠 1', [-11, 0.5, -12.9], id.key1),    // 병실A 북서 구석
          key('열쇠 2', [11, 0.5, -12.9], id.key2),     // 병실B 북동 구석
          key('열쇠 3', [-16.2, 1.05, -21], id.key3),   // 보관실 선반(세이프룸 보상)
          key('열쇠 4', [-23.6, 0.5, -22.6], id.key4),  // 영안실 가장 깊은 곳

          // ══════════ 배터리 6개 ══════════
          battery('배터리 1', [3, 0.38, 5.4], bat[0]),        // 로비
          battery('배터리 2', [-3.4, 1.5, -13.2], bat[1]),    // 병실A 수납장 위
          battery('배터리 3', [9.6, 1.28, -7.4], bat[2]),     // 병실B 트레이 위
          battery('배터리 4', [-9.5, 0.38, -17.6], bat[3]),   // 지하 통로
          battery('배터리 5', [-11.5, 1.18, -25.2], bat[4]),  // 보관실 작업대
          battery('배터리 6', [-19.6, 1.1, -21.6], bat[5]),   // 영안실 해부대

          // ══════════ 함정 8개 — 문틀·통로 입구는 피해서 배치 ══════════
          trap('핏자국 1', [0.7, 0.06, -3.6], [1.5, 0.12, 1.5]),
          trap('핏자국 2', [-0.8, 0.06, -6.8], [1.5, 0.12, 1.6]),
          trap('핏자국 3', [0.8, 0.06, -12.6], [1.5, 0.12, 1.6]),
          trap('핏자국 4', [-7.6, 0.06, -8.2], [1.8, 0.12, 1.8]),   // 병실A 열쇠 가는 길
          trap('핏자국 5', [-11.2, 0.06, -10.4], [1.4, 0.12, 2]),   // 병실A 서쪽
          trap('핏자국 6', [8, 0.06, -11.6], [1.8, 0.12, 1.8]),     // 병실B 열쇠 가는 길
          trap('핏자국 7', [-2.8, 0.06, -20.4], [2.2, 0.12, 2.2]),  // 제단실
          trap('핏자국 8', [3.2, 0.06, -22.8], [2.2, 0.12, 2.2]),   // 제단실

          // ══════════ 점프스케어 3회(각 1회) ══════════
          sensor('그림자', [0, 1.2, -9], [4, 2.4, 0.5], '#000000', '#000000', [
            ev('area_enter', 'show_popup',
              '<div style="font:16px/1.6 sans-serif;color:#ff5a5a;background:#12070a;padding:30px;height:100%;display:flex;align-items:center;justify-content:center;text-align:center">'
              + '무언가가<br>바로 옆을 스쳐 지나갔다.</div>',
              { popup: { mode: 'html', bg: '#12070a', title: '', width: '460px', height: '240px', anim: 'fade' }, conditions: [{ variable: 'scared', op: '==', value: false }] }),
            ev('area_enter', 'set_variable', 'scared|set|true', { conditions: [{ variable: 'scared', op: '==', value: false }] }),
          ], { id: id.scare1, opacity: 0.02 }),
          sensor('속삭임', [-9.5, 1.2, -18], [3, 2.4, 0.5], '#000000', '#000000', [
            ev('area_enter', 'show_popup',
              '<div style="font:16px/1.6 sans-serif;color:#ff5a5a;background:#12070a;padding:30px;height:100%;display:flex;align-items:center;justify-content:center;text-align:center">'
              + '뒤에서<br>당신의 이름을 부르는 소리가 났다.</div>',
              { popup: { mode: 'html', bg: '#12070a', title: '', width: '460px', height: '240px', anim: 'fade' }, conditions: [{ variable: 'scared2', op: '==', value: false }] }),
            ev('area_enter', 'set_variable', 'scared2|set|true', { conditions: [{ variable: 'scared2', op: '==', value: false }] }),
          ], { id: id.scare2, opacity: 0.02 }),
          sensor('보관함 소리', [-21, 1.2, -23.6], [7, 2.4, 0.5], '#000000', '#000000', [
            ev('area_enter', 'show_popup',
              '<div style="font:16px/1.6 sans-serif;color:#ff5a5a;background:#12070a;padding:30px;height:100%;display:flex;align-items:center;justify-content:center;text-align:center">'
              + '닫혀 있던 보관함 하나가<br>천천히 열렸다.</div>',
              { popup: { mode: 'html', bg: '#12070a', title: '', width: '460px', height: '240px', anim: 'fade' }, conditions: [{ variable: 'scared3', op: '==', value: false }] }),
            ev('area_enter', 'set_variable', 'scared3|set|true', { conditions: [{ variable: 'scared3', op: '==', value: false }] }),
          ], { id: id.scare3, opacity: 0.02 }),

          // ══════════ 출구 ══════════
          sensor('탈출구', [0, 1.2, -28.2], [2.8, 2.4, 0.8], '#0f3a1e', '#1a6b34', [
            ev('area_enter', 'game_win', '병원을 빠져나왔다.'),
          ], { opacity: 0.06 }),

          // ══════════ 최종 철문 — keys>=4, 복도 끝 x[-1,1] z=-17 ══════════
          {
            id: id.door,
            name: '잠긴 철문',
            assetId: null,
            isGroup: true,
            isActuator: true,
            material: {},
            parentId: null,
            layer: 'default',
            position: { x: -1, y: 0, z: -17 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            locked: false,
            physics: { ...DEFAULT_PHYSICS },
            events: [],
            actuator: { kind: 'rotate', axis: 'y', min: 0, max: 100, drive: 'event', value: 0, speed: 1.1, ease: 'smooth', collider: true },
          },
          { ...mesh('box', '철문', [1, 1.35, 0], [2, 2.7, 0.14], '#4a4640', { roughness: 0.55, metalness: 0.4 }), parentId: id.door },
          { ...mesh('box', '철문 보강대', [1, 1.9, 0.09], [1.8, 0.14, 0.05], '#5f5a52', { roughness: 0.4, metalness: 0.6, solid: false }), parentId: id.door },
          { ...mesh('sphere', '문 손잡이', [1.78, 1.3, 0.12], [0.13, 0.13, 0.13], '#8a8272', { roughness: 0.3, metalness: 0.85, solid: false }), parentId: id.door },

          // ══════════ 지하 격벽 — keys>=2, 병실A 북벽 x[-10.5,-8.5] z=-14 ══════════
          {
            id: id.gate,
            name: '지하 격벽',
            assetId: null,
            isGroup: true,
            isActuator: true,
            material: {},
            parentId: null,
            layer: 'default',
            position: { x: -10.5, y: 0, z: -14.15 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            visible: true,
            locked: false,
            physics: { ...DEFAULT_PHYSICS },
            events: [],
            actuator: { kind: 'rotate', axis: 'y', min: 0, max: 95, drive: 'event', value: 0, speed: 1.1, ease: 'smooth', collider: true },
          },
          { ...mesh('box', '격벽 문짝', [1, 1.35, 0], [2, 2.7, 0.16], '#4d4a44', { roughness: 0.5, metalness: 0.45 }), parentId: id.gate },
          { ...mesh('box', '격벽 표식', [1, 2.05, 0.11], [0.9, 0.26, 0.05], '#5a4a10', { emissive: '#d49a1e', roughness: 1, solid: false }), parentId: id.gate },
        ],
      };
    },
  },
];
