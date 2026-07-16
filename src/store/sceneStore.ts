import { create } from 'zustand';
import { MathUtils, Quaternion, Euler, Vector3, Matrix4 } from 'three';
import { worldBBox } from '@/lib/objectBBox';
import { normalizeClipPivots } from '@/lib/animPivot';
import { glbLocalBboxCache } from '@/lib/glbBboxCache';
import { OBJECT_PRESETS, PRESET_SELF } from '@/lib/objectPresets';

// 추가 직후 아직 bbox(GLB 로드)가 없어 바닥 스냅을 못한 오브젝트 id들 — 로드되면 GlbObject가 재시도
const pendingFloorSnap = new Set<string>();
import {
  ObjectNodeSchema,
  AssetRefSchema,
  EnvSchema,
  ProjectSceneSchema,
  PrefabSchema,
  PrefabOverrideGroup,
  MaterialAsset,
  ColorAsset,
  GameVariable,
  HudElement,
  EventSchema,
  AnimClip,
  AnimKeyframe,
  MaterialOverride,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PHYSICS,
  PrimitiveShape,
  ContentType,
  ParticlePreset,
  LightType,
  Vector3 as Vec3Schema,
} from '@/types/scene';
import {
  buildPrefab,
  instantiate as instantiatePrefabNodes,
  syncInstances,
  rebuildPrefabFromInstance,
  overrideGroupsFromPatch,
} from '@/lib/prefab';
import { regenerateCloner, clonerPlacement, DEFAULT_CLONER } from '@/lib/cloner';
import type { ClonerConfig } from '@/types/scene';

// 배치 모드 — add 버튼 클릭 시 즉시 생성하지 않고, 뷰포트에서 클릭한 위치에 생성한다.
export type PendingPlacement =
  | { kind: 'shape'; shape: PrimitiveShape }
  | { kind: 'asset'; asset: AssetRefSchema }
  | { kind: 'content'; contentType: ContentType; url?: string }
  | { kind: 'particle'; preset: ParticlePreset }
  | { kind: 'light'; lightType: LightType };
type PlaceXZ = { x: number; z: number };

interface HistoryEntry {
  objects: ObjectNodeSchema[];
  environment: EnvSchema;
  // 프리팹 정의도 함께 스냅샷(프리팹 관련 액션만 채움). 미설정 = 이 액션은 prefabs를 안 바꿈 → undo 시 현재값 유지.
  prefabs?: PrefabSchema[];
  // 재질 에셋 스냅샷(재질 에셋 액션만 채움). 미설정 = 안 바꿈.
  materialAssets?: MaterialAsset[];
  // 게임 변수 스냅샷(변수 액션만 채움). 미설정 = 안 바꿈.
  variables?: GameVariable[];
  // HUD 위젯 스냅샷(HUD 액션만 채움). 미설정 = 안 바꿈.
  hudElements?: HudElement[];
  // 씬 전역 규칙 스냅샷(게임 컨트롤러 액션만 채움). 미설정 = 안 바꿈.
  sceneEvents?: EventSchema[];
  // 애니메이션 클립 스냅샷(애니 액션만 채움). 미설정 = 안 바꿈.
  animClips?: AnimClip[];
}

interface SceneState {
  projectId: string | null;
  sceneId: string | null;
  objects: ObjectNodeSchema[];
  assets: AssetRefSchema[];
  environment: EnvSchema;
  // 프리팹 원본 정의 라이브러리(씬 단위). 인스턴스는 objects에 구워진 채로 존재한다.
  prefabs: PrefabSchema[];
  // 공용 재질/색 에셋 라이브러리(씬 단위). 오브젝트가 materialId로 참조(공존형).
  materialAssets: MaterialAsset[];
  colorAssets: ColorAsset[];
  // 게임 변수(상태) 정의(씬 단위). 런타임 값은 뷰어 로컬, 여기엔 정의(name/type/initial)만.
  variables: GameVariable[];
  // HUD 위젯(씬 단위) — 변수를 텍스트/체력바/목숨으로 화면 표시.
  hudElements: HudElement[];
  // 게임 컨트롤러(씬 전역 로직) — 오브젝트에 매달리지 않은 규칙들. GAME_LOGIC.md.
  sceneEvents: EventSchema[];
  // 사용자 저작 애니메이션 클립(키프레임). ANIMATION.md.
  animClips: AnimClip[];
  selectedId: string | null;
  selectedIds: string[];
  // 그룹 격리(isolation) 스코프 — 더블클릭으로 '진입'한 그룹 id. 설정 시 단일 클릭이 이 그룹 안에서만
  // 형제 오브젝트를 선택한다(최상위 그룹으로 튕기지 않음). 빈 곳 클릭/Esc/스코프 밖 클릭으로 해제.
  groupScope: string | null;
  transformMode: 'translate' | 'rotate' | 'scale';
  transformSpace: 'world' | 'local';
  snapEnabled: boolean;
  snapTranslate: number;
  snapRotate: number;
  objectSnap: boolean; // 오브젝트 스냅(자석) — 이동 시 다른 오브젝트의 bbox 모서리/중심에 정렬. 그리드 스냅과 독립.
  focusTarget: { x: number; y: number; z: number; _tick: number } | null;
  focusAllRequest: number | null;
  // 선택 오브젝트(들)로 카메라 프레이밍 요청(F키/더블클릭). tick 값으로 EditorCanvas가 감지.
  focusSelectedRequest: number | null;
  // .glb 내보내기 요청 — ids가 비면 씬 전체(루트 오브젝트 전부). EditorCanvas가 라이브 Three 객체로 처리.
  exportRequest: { ids: string[]; name: string; _tick: number } | null;
  // 펜 툴(2D 프로파일 → 돌출/회전체) 모달 열림 상태.
  penToolOpen: boolean;
  boundaryShapeOpen: boolean; // 경계 다각형 편집 모달 열림
  voxelToolOpen: boolean;
  // 인에디터 플레이 — true면 편집 중 씬을 뷰어로 구동(걷기/게임 테스트). 상단바 ▶로 토글.
  editorPlaying: boolean;
  cameraViewRequest: { view: 'top' | 'front' | 'right'; _tick: number } | null;
  // 씬 로드 카운터 — loadScene마다 증가. 에디터가 '로드 직후 1회 전체 맞춤'을 이 값 변화로 감지
  // (새 빈 씬에서 첫 오브젝트 추가 시 카메라가 튀지 않도록 objects 변화가 아닌 로드 시점에 묶음).
  sceneLoadTick: number;
  isModified: boolean;
  // 마지막으로 로드/저장한 시점의 DB scenes.version 값 — 저장 시 낙관적 잠금에 사용.
  // (scene_data 내부의 SCENE_VERSION[JSON 스키마 버전]과는 별개의 행 리비전 카운터)
  savedVersion: number;
  wireframeMode: boolean;
  gridPlane: 'xz' | 'xy' | 'yz'; // 에디터 기준 격자 평면(바닥/벽). 전환용 뷰 상태(씬에 저장 안 함)
  past: HistoryEntry[];
  future: HistoryEntry[];
  cameraBookmarks: Record<number, { position: [number, number, number]; target: [number, number, number] }>;
  bookmarkSaveRequest: { slot: number; _tick: number } | null;
  bookmarkRecallRequest: { slot: number; _tick: number } | null;
  copiedProperties: { material?: ObjectNodeSchema['material']; physics?: ObjectNodeSchema['physics'] } | null;
  _prevSnapshot: HistoryEntry | null;
}

interface SceneActions {
  loadScene: (data: ProjectSceneSchema, savedVersion?: number) => void;
  selectObject: (id: string | null) => void;
  /** 그룹 격리 스코프 진입/해제(null=해제) */
  setGroupScope: (id: string | null) => void;
  toggleSelectObject: (id: string) => void;
  selectObjects: (ids: string[]) => void;
  deleteSelected: () => void;
  alignSelected: (axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max') => void;
  setTransformMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  setTransformSpace: (space: 'world' | 'local') => void;
  addObject: (shape: PrimitiveShape, placeAt?: PlaceXZ) => void;
  // 완성형 프리셋(바퀴/문/동전)을 스탬프로 추가. 동전 등은 필요 시 'score' 변수 자동 생성.
  addPreset: (presetId: string, placeAt?: PlaceXZ) => void;
  /** 펜 툴 프로파일로 돌출/회전체 오브젝트 생성 */
  addProfileObject: (shape: 'extrude' | 'lathe', profile: { x: number; y: number }[], extrudeDepth: number, closed: boolean, profileRaw?: { x: number; y: number }[], smooth?: boolean) => void;
  /** 펜 툴 재편집 — 기존 돌출/회전체 오브젝트의 프로파일/두께를 갱신(형태 교체) */
  updateProfileObject: (id: string, shape: 'extrude' | 'lathe', profile: { x: number; y: number }[], extrudeDepth: number, closed: boolean, profileRaw?: { x: number; y: number }[], smooth?: boolean) => void;
  addAsset: (asset: AssetRefSchema) => void;
  addAssetObject: (asset: AssetRefSchema, placeAt?: PlaceXZ, extra?: Partial<ObjectNodeSchema>) => void;
  addContentObject: (type: ContentType, placeAt?: PlaceXZ, url?: string) => void;
  addParticleObject: (preset: ParticlePreset, placeAt?: PlaceXZ) => void;
  /** 배치 모드 — 뷰포트 클릭 위치에 생성. begin=시작(고스트 따라다님), commit=클릭 위치에 생성, cancel=ESC 취소 */
  pendingPlacement: PendingPlacement | null;
  beginPlacement: (p: PendingPlacement) => void;
  commitPlacement: (x: number, z: number) => void;
  cancelPlacement: () => void;
  setSnap: (enabled: boolean, translate?: number, rotate?: number) => void;
  requestFocus: () => void;
  requestFocusAll: () => void;
  /** 선택 오브젝트로 카메라 프레이밍(orbit pivot 이동 + 거리 맞춤). 시점 방향은 유지. */
  requestFocusSelected: () => void;
  /** 오브젝트(들)를 .glb로 내보내기. ids 비우면 씬 전체. */
  requestExport: (ids: string[], name: string) => void;
  /** 펜 툴 모달 열기/닫기 */
  setPenToolOpen: (open: boolean) => void;
  setBoundaryShapeOpen: (open: boolean) => void;
  /** 펜 툴 모달을 특정 오브젝트 재편집 모드로 열기 */
  penToolEditId: string | null;
  openPenToolEdit: (id: string) => void;
  setVoxelToolOpen: (open: boolean) => void;
  /** 복셀 오브젝트 — live 프리미티브(primitiveShape 'voxel'). 생성/재편집(B안). cellSize=한 칸 크기(미터, 미설정=1). */
  addVoxelObject: (voxels: { x: number; y: number; z: number; color: string }[], cellSize?: number, placeAt?: PlaceXZ) => void;
  updateVoxelObject: (id: string, voxels: { x: number; y: number; z: number; color: string }[], cellSize?: number) => void;
  voxelEditId: string | null;
  openVoxelEdit: (id: string) => void;
  setEditorPlaying: (v: boolean) => void;
  requestCameraView: (view: 'top' | 'front' | 'right') => void;
  duplicateInPlace: () => void;
  requestSaveBookmark: (slot: number) => void;
  requestRecallBookmark: (slot: number) => void;
  setCameraBookmark: (slot: number, position: [number, number, number], target: [number, number, number]) => void;
  updateObject: (id: string, patch: Partial<ObjectNodeSchema>) => void;
  /** 여러 오브젝트의 트랜스폼을 한 번에 원자적으로 커밋(기즈모 전용). _prevSnapshot에 의존하지 않아 undo 기준 오염이 없다. */
  commitTransforms: (updates: { id: string; position: Vec3Schema; rotation: Vec3Schema; scale: Vec3Schema }[]) => void;
  setObjectLocked: (id: string, locked: boolean) => void;
  moveObject: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
  duplicateSelected: () => void;
  // 오브젝트 클립보드(Ctrl+C/V) — transient(저장 안 함, 세션 유지=씬 넘어 붙여넣기 가능). 붙여넣기는 항상 최상위(root).
  clipboard: { objects: ObjectNodeSchema[]; clips: AnimClip[] } | null;
  copySelection: () => void;
  pasteClipboard: () => void;
  // 선택 오브젝트를 count개(원본 포함)로 배열 복제. linear=offset 간격 나열(울타리·기둥), radial=중심 기준 원형 배치(시계 숫자·원형 테이블 의자).
  arraySelected: (count: number, offset: { x: number; y: number; z: number }, radial?: { radius: number; axis: 'x' | 'y' | 'z' } | null) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  /** 선택 오브젝트를 '클로너 그룹'으로 감싼다(비파괴 배열). config 미지정 시 기본값. */
  makeCloner: (config?: ClonerConfig) => void;
  /** 클로너 설정 변경 → 복제본 실시간 재생성. _prevSnapshot 패턴(호출부 pushHistory로 커밋). */
  updateCloner: (groupId: string, config: ClonerConfig) => void;
  /** 구운(bake) GLB 에셋으로 대상 오브젝트(+자손)를 대체 — Merge/Boolean 결과 반영. 원본 제거 + 에셋 오브젝트 1개 추가(단일 undo) */
  mergeIntoAsset: (rootIds: string[], asset: AssetRefSchema, position: Vec3Schema, name: string) => void;
  // ── 프리팹 ──
  /** 선택한 루트 오브젝트/그룹으로 프리팹 정의를 만들고, 그 선택물을 인스턴스 #1로 태깅 */
  createPrefab: (name?: string) => void;
  /** 프리팹 정의를 새 인스턴스로 씬에 배치(bake) */
  instantiatePrefab: (prefabId: string, position?: Vec3Schema) => void;
  /** 선택 인스턴스의 현재 상태를 원본 정의에 반영하고 다른 인스턴스를 재동기화(각자 override 보존) */
  applyInstanceToPrefab: (instanceRootId: string) => void;
  /** 선택 인스턴스의 override를 버리고 원본 값으로 되돌림(그룹 지정 시 그 그룹만) */
  revertInstance: (instanceRootId: string, group?: PrefabOverrideGroup) => void;
  /** 프리팹 정의 삭제 — 인스턴스는 태그를 벗고 독립 오브젝트가 됨(씬에는 유지) */
  deletePrefab: (prefabId: string) => void;
  /** 프리팹 이름 변경 */
  renamePrefab: (prefabId: string, name: string) => void;
  // ── 공용 재질 에셋(공존형) ──
  addMaterialAsset: (name: string, material: MaterialOverride) => string; // 새 id 반환
  updateMaterialAsset: (id: string, material: MaterialOverride) => void;  // 원본 편집 → 참조 오브젝트 전부 반영
  renameMaterialAsset: (id: string, name: string) => void;
  removeMaterialAsset: (id: string) => void;                              // 참조 오브젝트는 인라인으로 detach 후 삭제
  assignMaterialAsset: (objectIds: string[], materialId: string) => void; // 오브젝트에 에셋 연결
  detachMaterial: (objectId: string) => void;                            // 연결 끊기(현재 재질을 인라인으로 복사)
  // ── JSON 가져오기 ──
  // 재질 JSON(들)을 공용 재질 라이브러리에 일괄 추가(1회 undo). 추가된 개수 반환.
  importMaterialAssets: (items: { name: string; material: MaterialOverride }[]) => number;
  // 씬 JSON(objects/assets/materialAssets)을 현재 씬에 병합. id는 전부 새로 발급해 충돌을 피하고,
  // parentId/assetId/materialId/이벤트 value의 오브젝트 참조를 새 id로 리맵한다. 가져온 assets는
  // external:true로 표시(스토리지 파일을 이 프로젝트로 복사하지 않고 원본 URL을 그대로 참조 — 삭제해도
  // 원본 파일은 지우지 않음). 루트 오브젝트를 선택 상태로 남긴다.
  importSceneJson: (data: { objects: Partial<ObjectNodeSchema>[]; assets: AssetRefSchema[]; materialAssets: MaterialAsset[] }) => {
    objectCount: number;
    assetCount: number;
    materialCount: number;
  };
  // ── 공용 색 에셋 ──
  addColorAsset: (name: string, color: string) => void;
  removeColorAsset: (id: string) => void;
  // ── 게임 변수(상태) ──
  addVariable: () => void;
  updateVariable: (id: string, patch: Partial<GameVariable>) => void;
  removeVariable: (id: string) => void;
  // ── HUD 위젯 ──
  addHudElement: () => void;
  updateHudElement: (id: string, patch: Partial<HudElement>) => void;
  removeHudElement: (id: string) => void;
  // ── 게임 컨트롤러(씬 전역 규칙) ──
  addSceneEvent: (ev: EventSchema) => void;
  updateSceneEvent: (id: string, patch: Partial<EventSchema>) => void;
  removeSceneEvent: (id: string) => void;
  // ── 애니메이션 클립 ──
  addAnimClip: (clip: AnimClip) => void;
  updateAnimClip: (id: string, patch: Partial<AnimClip>) => void;
  removeAnimClip: (id: string) => void;
  addTrackToClip: (clipId: string, objectId: string) => void;
  removeTrackFromClip: (clipId: string, objectId: string) => void;
  // 에디터 미리보기(▶) — transient(저장/undo 무관)
  animPreview: { clipId: string; startedAt: number } | null;
  startAnimPreview: (clipId: string) => void;
  stopAnimPreview: () => void;
  // 타임라인 스크럽 — 재생헤드를 특정 시간 t로. 뷰포트가 그 시점 보간 상태를 비파괴로 표시(P4). transient.
  animScrub: { clipId: string; t: number } | null;
  setAnimScrub: (clipId: string, t: number | null) => void;
  // 애니 저작 UI 모드 — 'simple'(포즈 리스트, 초보) / 'timeline'(시간축, 고급). UI 선호(저장 안 함).
  animMode: 'simple' | 'timeline';
  setAnimMode: (m: 'simple' | 'timeline') => void;
  // 지금 편집 중인 포즈(하이라이트·오토키 대상) — transient. 오브젝트 이동/선택전환에도 유지.
  poseEdit: { clipId: string; idx: number } | null;
  setPoseEdit: (clipId: string, idx: number | null) => void;
  goToPose: (clipId: string, idx: number) => void;
  // 타임라인 트랙별 키 선택/편집 (per-track 독립 타이밍) — transient. keySel이 있으면 오토키가 그 키만 갱신.
  keySel: { clipId: string; objectId: string; idx: number } | null;
  goToKey: (clipId: string, objectId: string, idx: number) => void;
  clearKeySel: () => void;
  addKeyToTrack: (clipId: string, objectId: string, t: number) => void;
  retimeKey: (clipId: string, objectId: string, idx: number, t: number) => void;
  removeKey: (clipId: string, objectId: string, idx: number) => void;
  updateEnvironment: (patch: Partial<EnvSchema>) => void;
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: (savedVersion?: number) => void;
  markModified: () => void;
  toggleWireframe: () => void;
  cycleGridPlane: () => void;
  toggleObjectSnap: () => void;
  copyObjectProperties: () => void;
  pasteObjectProperties: () => void;
  batchUpdateObjects: (ids: string[], patch: (obj: ObjectNodeSchema) => Partial<ObjectNodeSchema>) => void;
  addLightObject: (type: LightType, placeAt?: PlaceXZ) => void;
  removeAsset: (id: string) => void;
  /** 특정 에셋을 참조하는 오브젝트(+자손) 전부 삭제. 삭제된 개수 반환(연쇄 삭제용) */
  removeObjectsByAsset: (assetId: string) => number;
  /** 오브젝트 밑면을 바닥(y=0)에 자동 정렬. bbox 미준비면 pending으로 남겨 나중에 재시도 */
  floorSnapObject: (id: string) => void;
}

// 에디터 뷰포트의 플레이어 캐릭터 프리뷰가 쓰는 가상 오브젝트 ID.
// objects 배열에는 존재하지 않으므로 다중 선택 등에 섞이면 안 된다.
// (CharacterPreview.tsx에서 re-export — 스토어가 원본을 소유해 순환 import 방지)
export const CHARACTER_PREVIEW_ID = '__character_preview__';

const SHAPE_NAMES: Record<PrimitiveShape, string> = {
  box: '박스',
  sphere: '구체',
  cylinder: '원기둥',
  plane: '평면',
  frustum: '각뿔대',
  loft: '로프트',
  extrude: '돌출',
  lathe: '회전체',
  voxel: '복셀',
};

// 히스토리 스택 최대 길이 (past/future 공통)
const HISTORY_LIMIT = 49;

// 이전 스냅샷을 past에 push (한계 초과 시 오래된 항목 삭제)
function pushPast(past: HistoryEntry[], snapshot: HistoryEntry): HistoryEntry[] {
  return [...past.slice(-HISTORY_LIMIT), snapshot];
}

// 변경 직전 스냅샷을 past에 쌓고 future를 비우는 히스토리 필드 묶음.
// 즉시 히스토리를 커밋하는 액션(addObject/delete/group 등)에서 set()에 스프레드해 쓴다.
function withHistory(snapshot: HistoryEntry, past: HistoryEntry[]): { past: HistoryEntry[]; future: HistoryEntry[] } {
  return { past: pushPast(past, snapshot), future: [] };
}

// 복제(duplicate)·프리팹 인스턴스화 시 애니 클립도 함께 복제 — rootId/트랙 objectId를 idMap으로 리맵.
// 대상 오브젝트가 복제 집합(idMap)에 있으면 새 클립 생성 → 복제/프리팹에 애니가 따라간다. ANIMATION.md P2b.
//   clipIdMap(옛 클립id→새 클립id)도 반환 → 복제된 오브젝트의 play_clip 이벤트를 새 클립으로 리맵하는 데 씀.
// 클립 키프레임은 절대 트랜스폼(position)을 저장한다(뷰어가 그대로 덮어씀). 복제본은 원본과 다른 위치에
// 놓이므로(예: +1 오프셋), 복제 클립의 position 키프레임을 그 오브젝트의 이동량(posDelta)만큼 옮겨야
// "제 위치에서 같은 동작"을 한다. posDelta는 OLD 오브젝트 id로 키잉(없으면 이동 0). rotation/scale은 위치무관이라 그대로.
function dupAnimClips(
  animClips: AnimClip[],
  idMap: Map<string, string>,
  posDelta?: Map<string, { x: number; y: number; z: number }>,
): { clips: AnimClip[]; clipIdMap: Map<string, string> } {
  const clips: AnimClip[] = [];
  const clipIdMap = new Map<string, string>();
  // 재생 목록에서 구분되도록 복제 클립 이름을 "~ 복사"로(중복이면 번호). 기존 + 이번에 만든 이름과 겹치지 않게.
  const usedNames = new Set(animClips.map((c) => c.name));
  const uniqueName = (base: string): string => {
    let name = `${base} 복사`;
    let n = 2;
    while (usedNames.has(name)) name = `${base} 복사 ${n++}`;
    usedNames.add(name);
    return name;
  };
  for (const clip of animClips) {
    const rootIn = clip.rootId ? idMap.has(clip.rootId) : false;
    const trackIn = clip.tracks.some((t) => idMap.has(t.objectId));
    if (!rootIn && !trackIn) continue;
    const newId = MathUtils.generateUUID();
    clipIdMap.set(clip.id, newId);
    clips.push({
      ...clip,
      id: newId,
      name: uniqueName(clip.name),
      rootId: clip.rootId && idMap.has(clip.rootId) ? idMap.get(clip.rootId)! : clip.rootId,
      tracks: clip.tracks.map((t) => {
        const d = posDelta?.get(t.objectId);
        return {
          objectId: idMap.get(t.objectId) ?? t.objectId,
          keys: t.keys.map((k) => ({
            time: k.time,
            position: k.position ? (d ? { x: k.position.x + d.x, y: k.position.y + d.y, z: k.position.z + d.z } : { ...k.position }) : undefined,
            rotation: k.rotation ? { ...k.rotation } : undefined,
            scale: k.scale ? { ...k.scale } : undefined,
          })),
        };
      }),
      pivot: clip.pivot ? { ...clip.pivot } : undefined,
    });
  }
  return { clips, clipIdMap };
}
// 복제된 오브젝트들의 play_clip 이벤트 값(클립 id)을 새 클립 id로 교체. 그래야 복제본이 자기 애니를 재생.
function remapPlayClipEvents(objs: ObjectNodeSchema[], clipIdMap: Map<string, string>): ObjectNodeSchema[] {
  if (clipIdMap.size === 0) return objs;
  return objs.map((o) =>
    o.events?.some((e) => e.action === 'play_clip' && clipIdMap.has(e.value))
      ? { ...o, events: o.events.map((e) => (e.action === 'play_clip' && clipIdMap.has(e.value) ? { ...e, value: clipIdMap.get(e.value)! } : e)) }
      : o,
  );
}

// 삭제된 오브젝트를 참조하는 애니 클립을 정리(고아 클립 방지):
// 각 클립에서 삭제 오브젝트 트랙을 빼고, 트랙이 하나도 안 남으면 클립 자체를 제거. stale rootId도 비운다.
// changed=false면 animClips 원본을 그대로 반환(불필요한 히스토리/리렌더 방지).
function pruneOrphanClips(animClips: AnimClip[], deleted: Set<string>): { clips: AnimClip[]; changed: boolean } {
  if (animClips.length === 0) return { clips: animClips, changed: false };
  const origClip = new Map(animClips.map((c) => [c.id, c]));
  const clips = animClips
    .map((c) => ({
      ...c,
      rootId: c.rootId && deleted.has(c.rootId) ? undefined : c.rootId,
      tracks: c.tracks.filter((t) => !deleted.has(t.objectId)),
    }))
    .filter((c) => c.tracks.length > 0);
  const changed = clips.length !== animClips.length || clips.some((c) => { const o = origClip.get(c.id); return !o || c.tracks.length !== o.tracks.length || c.rootId !== o.rootId; });
  return { clips: changed ? clips : animClips, changed };
}

// 오토키(auto-key) — 편집 중 대상 키를 방금 바뀐 오브젝트의 트랜스폼으로 자동 갱신. objects는 '갱신 후' 배열.
//   keySel(타임라인 트랙별 선택)이 있으면 그 트랙의 그 키만 갱신(per-track 독립 타이밍).
//   없으면 poseEdit(간단 모드 포즈)로 정렬 포즈 갱신. 변경 없으면 null(히스토리/리렌더 최소화). goToPose/goToKey는 우회.
function autoKeyPose(
  poseEdit: { clipId: string; idx: number } | null,
  keySel: { clipId: string; objectId: string; idx: number } | null,
  animClips: AnimClip[],
  objects: ObjectNodeSchema[],
  changedIds: string[],
): AnimClip[] | null {
  const nearVec = (a: Vec3Schema | undefined, b: Vec3Schema) =>
    !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  // ── 타임라인: 선택 키(트랙 하나)만 갱신 ──
  if (keySel) {
    if (!changedIds.includes(keySel.objectId)) return null;
    const clip = animClips.find((c) => c.id === keySel.clipId);
    const track = clip?.tracks.find((t) => t.objectId === keySel.objectId);
    const o = objects.find((x) => x.id === keySel.objectId);
    const k = track?.keys[keySel.idx];
    if (!clip || !track || !o || !k) return null;
    if (nearVec(k.position, o.position) && nearVec(k.rotation, o.rotation) && nearVec(k.scale, o.scale)) return null;
    const tracks = clip.tracks.map((t) => (t.objectId !== keySel.objectId ? t : { ...t, keys: t.keys.map((kk, i) => (i === keySel.idx ? { ...kk, position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale } } : kk)) }));
    return animClips.map((c) => (c.id === clip.id ? { ...c, tracks } : c));
  }
  if (!poseEdit) return null;
  const clip = animClips.find((c) => c.id === poseEdit.clipId);
  if (!clip) return null;
  const idx = poseEdit.idx;
  if (idx < 0 || idx >= (clip.tracks[0]?.keys.length ?? 0)) return null;
  const nearV = (a: Vec3Schema | undefined, b: Vec3Schema) =>
    !!a && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  let touched = false;
  const tracks = clip.tracks.map((t) => {
    if (!changedIds.includes(t.objectId) || !t.keys[idx]) return t;
    const o = objects.find((x) => x.id === t.objectId);
    if (!o) return t;
    const k = t.keys[idx];
    if (nearV(k.position, o.position) && nearV(k.rotation, o.rotation) && nearV(k.scale, o.scale)) return t; // 변화 없음
    touched = true;
    return { ...t, keys: t.keys.map((kk, i) => (i === idx ? { time: kk.time, position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale } } : kk)) };
  });
  if (!touched) return null;
  return animClips.map((c) => (c.id === clip.id ? { ...c, tracks } : c));
}

let objectCounter = 0;

// 모든 오브젝트가 공유하는 기본값 팩토리. overrides로 타입별 필드(assetId/content/particle/light 등)를 덮어쓴다.
// objectCounter는 건드리지 않으므로 name은 이미 번호가 매겨진 값을 전달할 것.
function makeBaseObject(overrides: Partial<ObjectNodeSchema> & { name: string }): ObjectNodeSchema {
  return {
    id: MathUtils.generateUUID(),
    assetId: null,
    primitiveShape: undefined,
    material: {},
    parentId: null,
    layer: 'default',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
    physics: { ...DEFAULT_PHYSICS },
    events: [],
    ...overrides,
  };
}

// 셰이프별 기본 지오메트리 파라미터(둥근 박스·각뿔대 등). 미지정 = 기존 각진 형태.
const SHAPE_DEFAULT_GEOM: Partial<Record<PrimitiveShape, ObjectNodeSchema['geom']>> = {
  frustum: { topScale: 0.5 },
  loft: { sections: [1, 0.7, 0.4] },
};

function makeObject(shape: PrimitiveShape): ObjectNodeSchema {
  objectCounter += 1;
  const geom = SHAPE_DEFAULT_GEOM[shape];
  return makeBaseObject({
    name: `${SHAPE_NAMES[shape]} ${objectCounter}`,
    primitiveShape: shape,
    ...(geom ? { geom: { ...geom } } : {}),
    material: { color: '#ffffff', roughness: 0.5, metalness: 0.1 },
    position: { x: 0, y: 0.5, z: 0 },
  });
}

const DEG2RAD_M = Math.PI / 180;
const RAD2DEG_M = 180 / Math.PI;

// 오브젝트의 월드 변환 행렬 — 부모 체인의 로컬 변환을 루트→자신 순서로 누적
function computeWorldMatrix(objects: ObjectNodeSchema[], id: string): Matrix4 {
  const chain: ObjectNodeSchema[] = [];
  let cur: ObjectNodeSchema | undefined = objects.find((o) => o.id === id);
  while (cur) {
    chain.unshift(cur);
    const parentId: string | null = cur.parentId;
    cur = parentId ? objects.find((o) => o.id === parentId) : undefined;
  }
  const m = new Matrix4();
  const p = new Vector3(), q = new Quaternion(), s = new Vector3(), e = new Euler();
  for (const o of chain) {
    p.set(o.position.x, o.position.y, o.position.z);
    e.set(o.rotation.x * DEG2RAD_M, o.rotation.y * DEG2RAD_M, o.rotation.z * DEG2RAD_M);
    q.setFromEuler(e);
    s.set(o.scale.x, o.scale.y, o.scale.z);
    m.multiply(new Matrix4().compose(p, q, s));
  }
  return m;
}

// candidateId가 rootId의 자손인지 (그룹을 자기 자손 안에 넣는 순환 방지)
export function isDescendant(objects: ObjectNodeSchema[], candidateId: string, rootId: string): boolean {
  let cur: ObjectNodeSchema | undefined = objects.find((o) => o.id === candidateId);
  while (cur?.parentId) {
    if (cur.parentId === rootId) return true;
    const parentId: string = cur.parentId;
    cur = objects.find((o) => o.id === parentId);
  }
  return false;
}

// 그룹 원점(피벗)을 직속 자식들의 중심(centroid=위치 평균)으로 재배치한다.
// 자식 월드 위치는 그대로 유지하고 로컬 좌표만 보정 → 기즈모/회전·크기 피벗이 항상 자식 중심에 온다.
// 그룹 회전·크기는 유지하고 위치만 이동하므로 자식은 위치만 바뀐다(회전·크기 불변).
// (groupSelected·MultiGizmo와 동일하게 '위치 평균'을 중심으로 사용)
function recenterGroup(objects: ObjectNodeSchema[], groupId: string): ObjectNodeSchema[] {
  const group = objects.find((o) => o.id === groupId);
  if (!group?.isGroup) return objects;
  const children = objects.filter((o) => o.parentId === groupId);
  if (children.length === 0) return objects;

  // 각 자식의 월드 위치 + centroid(월드)
  const childWorldPos = new Map<string, Vector3>();
  const centroid = new Vector3();
  for (const c of children) {
    const wp = new Vector3().setFromMatrixPosition(computeWorldMatrix(objects, c.id));
    childWorldPos.set(c.id, wp);
    centroid.add(wp);
  }
  centroid.divideScalar(children.length);

  // 그룹의 현재 회전·크기는 유지하고 원점만 centroid로 이동한 새 월드행렬의 역행렬
  const gWorld = computeWorldMatrix(objects, groupId);
  const gPos = new Vector3(), gQuat = new Quaternion(), gScale = new Vector3();
  gWorld.decompose(gPos, gQuat, gScale);
  const gWorldNewInv = new Matrix4().compose(centroid, gQuat, gScale).invert();

  // 그룹의 새 로컬 위치(부모 기준) — centroid를 부모 공간으로 변환
  const parentInv = group.parentId ? computeWorldMatrix(objects, group.parentId).invert() : new Matrix4();
  const gLocalPos = centroid.clone().applyMatrix4(parentInv);

  const patches = new Map<string, ObjectNodeSchema>();
  patches.set(groupId, { ...group, position: { x: gLocalPos.x, y: gLocalPos.y, z: gLocalPos.z } });
  for (const c of children) {
    const lp = childWorldPos.get(c.id)!.clone().applyMatrix4(gWorldNewInv);
    patches.set(c.id, { ...c, position: { x: lp.x, y: lp.y, z: lp.z } });
  }
  return objects.map((o) => patches.get(o.id) ?? o);
}

export const useSceneStore = create<SceneState & SceneActions>((set, get) => ({
  projectId: null,
  sceneId: null,
  objects: [],
  assets: [],
  environment: DEFAULT_ENVIRONMENT,
  prefabs: [],
  materialAssets: [],
  colorAssets: [],
  variables: [],
  hudElements: [],
  sceneEvents: [],
  animClips: [],
  animPreview: null,
  animScrub: null,
  animMode: 'simple',
  poseEdit: null,
  keySel: null,
  selectedId: null,
  groupScope: null,
  transformMode: 'translate',
  transformSpace: 'world',
  snapEnabled: false,
  snapTranslate: 0.5,
  snapRotate: 15,
  objectSnap: false,
  selectedIds: [],
  clipboard: null,
  focusTarget: null,
  focusAllRequest: null,
  focusSelectedRequest: null,
  exportRequest: null,
  penToolOpen: false,
  boundaryShapeOpen: false,
  penToolEditId: null,
  editorPlaying: false,
  voxelToolOpen: false,
  voxelEditId: null,
  cameraViewRequest: null,
  sceneLoadTick: 0,
  isModified: false,
  savedVersion: 1,
  wireframeMode: false,
  gridPlane: 'xz',
  past: [],
  future: [],
  cameraBookmarks: {},
  pendingPlacement: null,
  bookmarkSaveRequest: null,
  bookmarkRecallRequest: null,
  copiedProperties: null,
  _prevSnapshot: null,

  loadScene: (data, savedVersion = 1) => {
    objectCounter = 0;
    set((s) => ({
      projectId: data.projectId,
      sceneId: data.sceneId,
      objects: data.objects,
      assets: data.assets ?? [],
      environment: data.environment,
      prefabs: data.prefabs ?? [],
      materialAssets: data.materialAssets ?? [],
      colorAssets: data.colorAssets ?? [],
      variables: data.variables ?? [],
      hudElements: data.hudElements ?? [],
      sceneEvents: data.sceneEvents ?? [],
      animClips: normalizeClipPivots(data.animClips ?? []), // 레거시 pivot→트랙별 이전 + baked 통일(에디터=재생 일치)
      animPreview: null,
      animScrub: null,
      poseEdit: null,
      keySel: null,
      selectedId: null,
      selectedIds: [],
      groupScope: null,
      isModified: false,
      savedVersion,
      sceneLoadTick: s.sceneLoadTick + 1, // 로드 직후 1회 자동 전체 맞춤 트리거(EditorCanvas InitialFit)
      past: [],
      future: [],
      _prevSnapshot: null,
    }));
  },

  selectObject: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
  setGroupScope: (id) => set({ groupScope: id }),
  selectObjects: (ids) => set({ selectedIds: ids, selectedId: ids[ids.length - 1] ?? null }),

  toggleSelectObject: (id) => set((s) => {
    // 캐릭터 프리뷰(가상 오브젝트)는 실제 오브젝트 다중 선택에 섞이지 않도록 제외
    const base = s.selectedIds.filter((x) => x !== CHARACTER_PREVIEW_ID);
    const already = base.includes(id);
    const selectedIds = already
      ? base.filter((x) => x !== id)
      : [...base, id];
    return { selectedIds, selectedId: selectedIds[selectedIds.length - 1] ?? null };
  }),

  setTransformMode: (mode) => set({ transformMode: mode }),
  setTransformSpace: (space) => set({ transformSpace: space }),

  addObject: (shape, placeAt) => {
    let obj = makeObject(shape);
    if (placeAt) obj = { ...obj, position: { ...obj.position, x: placeAt.x, z: placeAt.z } };
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  addPreset: (presetId, placeAt) => {
    const def = OBJECT_PRESETS.find((p) => p.id === presetId);
    if (!def) return;
    objectCounter += 1;
    const b = def.build;
    let obj = makeBaseObject({
      name: `${def.label} ${objectCounter}`,
      primitiveShape: b.primitiveShape,
      material: { ...b.material },
      position: { ...b.position },
      rotation: b.rotation ? { ...b.rotation } : { x: 0, y: 0, z: 0 },
      scale: b.scale ? { ...b.scale } : { x: 1, y: 1, z: 1 },
    });
    if (b.motion) obj = { ...obj, motion: { ...b.motion } };
    if (b.physics) obj = { ...obj, physics: { ...obj.physics, ...b.physics } };
    if (b.events) {
      const selfId = obj.id;
      obj = {
        ...obj,
        events: b.events.map((e) => ({
          id: MathUtils.generateUUID(),
          trigger: e.trigger,
          action: e.action,
          value: e.value === PRESET_SELF ? selfId : e.value,
        })),
      };
    }
    if (placeAt) obj = { ...obj, position: { ...obj.position, x: placeAt.x, z: placeAt.z } };

    const { objects, environment, variables, past } = get();
    // 'score' 변수 자동 생성(동전 등). 이미 있으면 그대로 둔다.
    let nextVars = variables;
    if (def.ensureScore && !variables.some((v) => v.name === 'score')) {
      const scoreVar: GameVariable = { id: MathUtils.generateUUID(), name: 'score', type: 'number', initial: 0, showInHud: true };
      nextVars = [...variables, scoreVar];
    }
    set({
      objects: [...objects, obj],
      variables: nextVars,
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      // 변수를 건드릴 때만 스냅샷에 포함(undo가 자동 생성 변수도 되돌리도록)
      ...withHistory({ objects, environment, ...(def.ensureScore ? { variables } : {}) }, past),
    });
  },

  addProfileObject: (shape, profile, extrudeDepth, closed, profileRaw, smooth) => {
    objectCounter += 1;
    const geom = shape === 'extrude'
      ? { profile, extrudeDepth, profileRaw, profileSmooth: smooth }
      : { profile, profileClosed: closed, profileRaw, profileSmooth: smooth };
    const obj = makeBaseObject({
      name: `${shape === 'lathe' ? '회전체' : '돌출'} ${objectCounter}`,
      primitiveShape: shape,
      geom,
      material: { color: '#a78bfa', roughness: 0.5, metalness: 0.1 },
      position: { x: 0, y: 0.5, z: 0 },
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  updateProfileObject: (id, shape, profile, extrudeDepth, closed, profileRaw, smooth) => {
    const { objects, environment, past } = get();
    const target = objects.find((o) => o.id === id);
    if (!target) return;
    // 기존 geom(subdivisions 등)은 보존하고 프로파일 관련 필드만 교체. 모드 전환도 반영(primitiveShape).
    const base = { ...target.geom, profile, profileRaw, profileSmooth: smooth };
    const geom = shape === 'extrude'
      ? { ...base, extrudeDepth, profileClosed: undefined }
      : { ...base, profileClosed: closed, extrudeDepth: undefined };
    set({
      objects: objects.map((o) => (o.id === id ? { ...o, primitiveShape: shape, geom } : o)),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  setSnap: (enabled, translate, rotate) =>
    set((s) => ({
      snapEnabled: enabled,
      snapTranslate: translate ?? s.snapTranslate,
      snapRotate: rotate ?? s.snapRotate,
    })),

  requestFocus: () => {
    const { selectedId, objects } = get();
    if (!selectedId) return;
    // 중첩 구조에서 월드 위치 근사 계산 (부모 체인 translation 합산)
    const approxWorldPos = (id: string): { x: number; y: number; z: number } => {
      const o = objects.find((x) => x.id === id);
      if (!o) return { x: 0, y: 0, z: 0 };
      if (!o.parentId) return o.position;
      const p = approxWorldPos(o.parentId);
      return { x: o.position.x + p.x, y: o.position.y + p.y, z: o.position.z + p.z };
    };
    const wp = approxWorldPos(selectedId);
    set({ focusTarget: { ...wp, _tick: Date.now() } });
  },

  requestFocusAll: () => set({ focusAllRequest: Date.now() }),
  requestFocusSelected: () => set({ focusSelectedRequest: Date.now() }),
  requestExport: (ids, name) => set({ exportRequest: { ids, name, _tick: Date.now() } }),
  setPenToolOpen: (open) => set(open ? { penToolOpen: true } : { penToolOpen: false, penToolEditId: null }),
  setBoundaryShapeOpen: (open) => set({ boundaryShapeOpen: open }),
  openPenToolEdit: (id) => set({ penToolEditId: id, penToolOpen: true }),
  setVoxelToolOpen: (open) => set(open ? { voxelToolOpen: true } : { voxelToolOpen: false, voxelEditId: null }),
  openVoxelEdit: (id) => set({ voxelEditId: id, voxelToolOpen: true }),

  addVoxelObject: (voxels, cellSize, placeAt) => {
    objectCounter += 1;
    // 지오메트리는 X/Z 중심·바닥 y=0 정렬이라 position.y=0이면 지면에 앉는다(바닥 스냅 불필요).
    const obj = makeBaseObject({
      name: `복셀 ${objectCounter}`,
      primitiveShape: 'voxel',
      geom: cellSize && cellSize !== 1 ? { voxels, cellSize } : { voxels },
      material: { color: '#ffffff', roughness: 0.75, metalness: 0 },
      position: { x: placeAt?.x ?? 0, y: 0, z: placeAt?.z ?? 0 },
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  updateVoxelObject: (id, voxels, cellSize) => {
    const { objects, environment, past } = get();
    const target = objects.find((o) => o.id === id);
    if (!target) return;
    set({
      objects: objects.map((o) => (o.id === id ? { ...o, geom: { ...o.geom, voxels, cellSize: cellSize && cellSize !== 1 ? cellSize : undefined } } : o)),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },
  setEditorPlaying: (v) => set({ editorPlaying: v }),

  requestCameraView: (view) => set({ cameraViewRequest: { view, _tick: Date.now() } }),

  duplicateInPlace: () => {
    const { selectedId, objects, environment, animClips, past } = get();
    if (!selectedId) return;
    const src = objects.find((o) => o.id === selectedId);
    if (!src) return;
    objectCounter += 1;
    if (src.isGroup) {
      // 중첩 그룹 포함 전체 하위 계층 재귀 복제
      const idMap = new Map<string, string>();
      const newDescendants: ObjectNodeSchema[] = [];
      const collectAll = (parentId: string): void => {
        const children = objects.filter((o) => o.parentId === parentId);
        for (const child of children) {
          const newId = MathUtils.generateUUID();
          idMap.set(child.id, newId);
          newDescendants.push({ ...child, id: newId });
          if (child.isGroup) collectAll(child.id);
        }
      };
      const newGroupId = MathUtils.generateUUID();
      idMap.set(src.id, newGroupId);
      collectAll(src.id);
      const newGroup: ObjectNodeSchema = { ...src, id: newGroupId, name: `${src.name} 복사` };
      const fixedDescendants = newDescendants.map((o) => ({
        ...o,
        parentId: idMap.get(o.parentId!) ?? o.parentId,
      }));
      const { clips: dupClips, clipIdMap } = dupAnimClips(animClips, idMap);
      const remapped = remapPlayClipEvents([newGroup, ...fixedDescendants], clipIdMap);
      set({ objects: [...objects, ...remapped], animClips: dupClips.length ? [...animClips, ...dupClips] : animClips, selectedId: newGroupId, selectedIds: [newGroupId], isModified: true, ...withHistory({ objects, environment, animClips }, past) });
    } else {
      // 그룹 내부 오브젝트는 같은 부모 아래에 제자리 복제
      const copy: ObjectNodeSchema = { ...src, id: MathUtils.generateUUID(), name: `${src.name} 복사`, parentId: src.parentId };
      const { clips: dupClips, clipIdMap } = dupAnimClips(animClips, new Map([[src.id, copy.id]]));
      const [remappedCopy] = remapPlayClipEvents([copy], clipIdMap);
      set({ objects: [...objects, remappedCopy], animClips: dupClips.length ? [...animClips, ...dupClips] : animClips, selectedId: copy.id, selectedIds: [copy.id], isModified: true, ...withHistory({ objects, environment, animClips }, past) });
    }
  },

  beginPlacement: (p) => set({ pendingPlacement: p }),
  cancelPlacement: () => set({ pendingPlacement: null }),
  commitPlacement: (x, z) => {
    const p = get().pendingPlacement;
    if (!p) return;
    const at: PlaceXZ = { x, z };
    if (p.kind === 'shape') get().addObject(p.shape, at);
    else if (p.kind === 'asset') get().addAssetObject(p.asset, at);
    else if (p.kind === 'content') get().addContentObject(p.contentType, at, p.url);
    else if (p.kind === 'particle') get().addParticleObject(p.preset, at);
    else if (p.kind === 'light') get().addLightObject(p.lightType, at);
    set({ pendingPlacement: null });
  },

  requestSaveBookmark: (slot) => set({ bookmarkSaveRequest: { slot, _tick: Date.now() } }),
  requestRecallBookmark: (slot) => set({ bookmarkRecallRequest: { slot, _tick: Date.now() } }),
  setCameraBookmark: (slot, position, target) =>
    set((s) => ({ cameraBookmarks: { ...s.cameraBookmarks, [slot]: { position, target } } })),

  addContentObject: (type, placeAt, url) => {
    objectCounter += 1;
    const defaults = {
      text: { text: '텍스트를 입력하세요', fontSize: 0.5, color: '#ffffff', depth: 0.1 },
      image: { url: '' },
      video: { url: '' },
    };
    const obj = makeBaseObject({
      name: type === 'text' ? `텍스트 ${objectCounter}` : type === 'image' ? `이미지 ${objectCounter}` : `동영상 ${objectCounter}`,
      primitiveShape: 'plane',
      position: { x: placeAt?.x ?? 0, y: 0.5, z: placeAt?.z ?? 0 },
      scale: type === 'video' ? { x: 16 / 9, y: 1, z: 1 } : { x: 2, y: 1, z: 1 },
      content: { type, ...defaults[type], ...(url ? { url } : {}) },
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  addParticleObject: (preset, placeAt) => {
    objectCounter += 1;
    const PRESET_NAMES: Record<string, string> = { fire: '불꽃', dust: '먼지', light: '빛 파티클', snow: '눈' };
    const obj = makeBaseObject({
      name: `${PRESET_NAMES[preset] ?? '파티클'} ${objectCounter}`,
      ...(placeAt ? { position: { x: placeAt.x, y: 0.5, z: placeAt.z } } : {}),
      particle: { preset },
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  addAsset: (asset) => {
    const { assets } = get();
    if (assets.find((a) => a.id === asset.id)) return;
    set({ assets: [...assets, asset] });
  },

  removeAsset: (id) => {
    const { assets } = get();
    set({ assets: assets.filter((a) => a.id !== id), isModified: true });
  },

  removeObjectsByAsset: (assetId) => {
    const { objects, environment, animClips, past, selectedId, selectedIds } = get();
    const directIds = objects.filter((o) => o.assetId === assetId).map((o) => o.id);
    if (directIds.length === 0) return 0;
    const collectDescendants = (oid: string): string[] => {
      const children = objects.filter((o) => o.parentId === oid);
      return [oid, ...children.flatMap((c) => collectDescendants(c.id))];
    };
    const allToDelete = new Set(directIds.flatMap((id) => collectDescendants(id)));
    const { clips: nextClips, changed: clipsChanged } = pruneOrphanClips(animClips, allToDelete);
    set({
      objects: objects.filter((o) => !allToDelete.has(o.id)),
      animClips: nextClips,
      selectedId: selectedId && allToDelete.has(selectedId) ? null : selectedId,
      selectedIds: selectedIds.filter((id) => !allToDelete.has(id)),
      isModified: true,
      ...withHistory(clipsChanged ? { objects, environment, animClips } : { objects, environment }, past),
    });
    return allToDelete.size;
  },

  addAssetObject: (asset, placeAt, extra) => {
    objectCounter += 1;
    const obj = makeBaseObject({
      name: asset.name,
      ...(placeAt ? { position: { x: placeAt.x, y: 0, z: placeAt.z } } : {}),
      assetId: asset.id,
      ...(extra ?? {}),
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
    // 밑면을 바닥에 자동 정렬 — bbox가 이미 캐시돼 있으면 즉시, 아니면 pending으로 두고 GlbObject 로드 시 재시도
    pendingFloorSnap.add(obj.id);
    get().floorSnapObject(obj.id);
  },

  mergeIntoAsset: (rootIds, asset, position, name) => {
    const { objects, assets, environment, past } = get();
    // 대상 루트들의 모든 자손 수집 → 제거
    const collectDesc = (id: string): string[] => {
      const children = objects.filter((o) => o.parentId === id);
      return [id, ...children.flatMap((c) => collectDesc(c.id))];
    };
    const toRemove = new Set(rootIds.flatMap(collectDesc));
    objectCounter += 1;
    const merged = makeBaseObject({ name, assetId: asset.id, position: { ...position } });
    set({
      objects: [...objects.filter((o) => !toRemove.has(o.id)), merged],
      assets: assets.some((a) => a.id === asset.id) ? assets : [...assets, asset],
      selectedId: merged.id,
      selectedIds: [merged.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  floorSnapObject: (id) => {
    if (!pendingFloorSnap.has(id)) return;
    const { objects, assets } = get();
    const o = objects.find((x) => x.id === id);
    if (!o || o.parentId) { pendingFloorSnap.delete(id); return; } // 루트만
    if (o.assetId) {
      const url = assets.find((a) => a.id === o.assetId)?.dracoUrl;
      if (!url || !glbLocalBboxCache.has(url)) return; // GLB bbox 아직 → pending 유지
    }
    const b = worldBBox(objects, assets, id);
    if (!b) return;
    pendingFloorSnap.delete(id);
    const newY = o.position.y - b.min.y; // 밑면이 y=0에 오도록
    if (Math.abs(newY - o.position.y) < 1e-4) return; // 이미 맞음
    // 히스토리 없이 위치만 보정(추가 액션에 묻어가는 자동 보정)
    set({
      objects: get().objects.map((x) => (x.id === id ? { ...x, position: { ...x.position, y: newY } } : x)),
      isModified: true,
    });
  },

  updateObject: (id, patch) => {
    const { objects, environment, prefabs, animClips, poseEdit, keySel, _prevSnapshot } = get();
    const target = objects.find((o) => o.id === id);
    // 프리팹 인스턴스 노드를 편집하면, 바뀐 필드가 속한 override 그룹을 기록 → 동기화 시 그 그룹은 원본을 안 따른다.
    let overridePatch: Partial<ObjectNodeSchema> | null = null;
    if (target?.prefabInstanceId && target.prefabId) {
      const def = prefabs.find((p) => p.id === target.prefabId);
      const isRoot = !!def && target.prefabNodeKey === def.rootKey;
      const groups = overrideGroupsFromPatch(Object.keys(patch), isRoot);
      if (groups.length > 0) {
        const merged = new Set<PrefabOverrideGroup>(target.prefabOverrides ?? []);
        groups.forEach((g) => merged.add(g));
        overridePatch = { prefabOverrides: [...merged] };
      }
    }
    const newObjects = objects.map((o) => (o.id === id ? { ...o, ...patch, ...overridePatch } : o));
    // 오토키 — 트랜스폼 편집 시 편집 중 포즈가 있으면 그 포즈 키프레임에 자동 반영.
    const isTransform = 'position' in patch || 'rotation' in patch || 'scale' in patch;
    const ak = isTransform ? autoKeyPose(poseEdit, keySel, animClips, newObjects, [id]) : null;
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment, ...(ak ? { animClips } : {}) },
      objects: newObjects,
      ...(ak ? { animClips: ak } : {}),
      isModified: true,
    });
  },

  commitTransforms: (updates) => {
    const { objects, environment, animClips, poseEdit, keySel, past } = get();
    const map = new Map(updates.map((u) => [u.id, u]));
    const newObjects = objects.map((o) => {
      const u = map.get(o.id);
      return u ? { ...o, position: { ...u.position }, rotation: { ...u.rotation }, scale: { ...u.scale } } : o;
    });
    // 오토키 — 편집 중 포즈가 있으면 옮긴 오브젝트를 그 포즈 키프레임에 자동 반영(objects·animClips 원자 커밋).
    const ak = autoKeyPose(poseEdit, keySel, animClips, newObjects, updates.map((u) => u.id));
    set({
      objects: newObjects,
      ...(ak ? { animClips: ak } : {}),
      isModified: true,
      // 직전에 커밋 안 된 편집 스냅샷 잔재를 버려 히스토리 오염 차단(기즈모는 자체 baseline으로 원자 커밋).
      _prevSnapshot: null,
      // 이 변환 '직전'의 objects(오토키면 animClips도)를 undo 기준으로 원자적 커밋.
      ...withHistory(ak ? { objects, environment, animClips } : { objects, environment }, past),
    });
  },

  // 잠금 토글 — 잠글 때는 현재 선택에서도 제외한다(잠긴 오브젝트는 기즈모/하이라이트 대상이 아니므로).
  // updateObject와 동일하게 _prevSnapshot만 세팅 → 호출부의 pushHistory()가 커밋(undo 1회).
  setObjectLocked: (id, locked) => {
    const { objects, environment, _prevSnapshot, selectedId, selectedIds } = get();
    // 그룹을 잠그면(풀면) 하위 요소도 함께 잠금(해제) — 재귀로 자손 전체 수집.
    const ids = new Set<string>([id]);
    const target = objects.find((o) => o.id === id);
    if (target?.isGroup) {
      const collect = (pid: string) => {
        for (const o of objects) if (o.parentId === pid) { ids.add(o.id); if (o.isGroup) collect(o.id); }
      };
      collect(id);
    }
    const nextIds = locked ? selectedIds.filter((x) => !ids.has(x)) : selectedIds;
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment },
      objects: objects.map((o) => (ids.has(o.id) ? { ...o, locked } : o)),
      selectedIds: nextIds,
      selectedId: locked && selectedId && ids.has(selectedId) ? (nextIds[nextIds.length - 1] ?? null) : selectedId,
      isModified: true,
    });
  },

  // 계층 리스트 드래그 이동 — 순서 변경 + 그룹 안팎 재부모화(reparent).
  // 배열 순서 = 같은 부모 내 형제 순서. before/after는 target의 형제로, inside는 target(그룹) 자식으로.
  // 부모가 바뀌면 월드 위치를 유지하도록 월드 변환을 새 부모 기준 로컬 변환으로 재계산한다
  // (그룹 자체를 옮겨도 자식은 로컬 좌표라 서브트리 전체가 제자리를 유지).
  moveObject: (draggedId, targetId, position) => {
    if (draggedId === targetId) return;
    const { objects, environment, past } = get();
    const dragged = objects.find((o) => o.id === draggedId);
    const target = objects.find((o) => o.id === targetId);
    if (!dragged || !target) return;
    if (position === 'inside' && !target.isGroup) return;

    const newParentId = position === 'inside' ? targetId : target.parentId;
    // 순환 방지 — 새 부모가 자기 자신이거나 자기 자손이면 거부
    if (newParentId === draggedId) return;
    if (newParentId && isDescendant(objects, newParentId, draggedId)) return;

    let moved = dragged;
    if (newParentId !== dragged.parentId) {
      // 월드 변환 유지 → 새 부모 기준 로컬 변환으로 변환
      const world = computeWorldMatrix(objects, draggedId);
      const parentWorld = newParentId ? computeWorldMatrix(objects, newParentId) : new Matrix4();
      const local = parentWorld.invert().multiply(world);
      const p = new Vector3(), q = new Quaternion(), s = new Vector3();
      local.decompose(p, q, s);
      const e = new Euler().setFromQuaternion(q);
      moved = {
        ...dragged,
        parentId: newParentId,
        position: { x: p.x, y: p.y, z: p.z },
        rotation: { x: e.x * RAD2DEG_M, y: e.y * RAD2DEG_M, z: e.z * RAD2DEG_M },
        scale: { x: s.x, y: s.y, z: s.z },
      };
    }

    const rest = objects.filter((o) => o.id !== draggedId);
    const targetIdx = rest.findIndex((o) => o.id === targetId);
    if (targetIdx < 0) return;
    // inside: 그룹 헤더 바로 뒤(첫 자식), before/after: target 앞/뒤
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    let next = [...rest.slice(0, insertIdx), moved, ...rest.slice(insertIdx)];

    // 멤버십이 바뀐 경우에만 관련 그룹 피벗을 자식 중심으로 재배치
    // (같은 부모 내 순서 변경은 중심이 그대로이므로 제외)
    const oldParentId = dragged.parentId;
    if (newParentId !== oldParentId) {
      if (newParentId && next.find((o) => o.id === newParentId)?.isGroup) {
        next = recenterGroup(next, newParentId);
      }
      if (oldParentId && next.find((o) => o.id === oldParentId)?.isGroup) {
        next = recenterGroup(next, oldParentId);
      }
    }

    set({ objects: next, isModified: true, ...withHistory({ objects, environment }, past) });
  },

  deleteSelected: () => {
    const { selectedId, selectedIds, objects, environment, animClips, past } = get();
    const roots = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
    if (roots.length === 0) return;
    // 그룹의 모든 자손도 함께 삭제
    const collectDescendants = (id: string): string[] => {
      const children = objects.filter((o) => o.parentId === id);
      return [id, ...children.flatMap((c) => collectDescendants(c.id))];
    };
    const allToDelete = new Set(roots.flatMap((id) => collectDescendants(id)));
    // 삭제되는 오브젝트를 참조하는 애니 클립 제거(고아 클립 정리)
    const { clips: nextClips, changed: clipsChanged } = pruneOrphanClips(animClips, allToDelete);
    set({
      objects: objects.filter((o) => !allToDelete.has(o.id)),
      animClips: nextClips,
      selectedId: null,
      selectedIds: [],
      isModified: true,
      ...withHistory(clipsChanged ? { objects, environment, animClips } : { objects, environment }, past),
    });
  },

  alignSelected: (axis, mode) => {
    const { selectedIds, objects, assets, environment, past } = get();
    const targets = objects.filter((o) => selectedIds.includes(o.id));
    if (targets.length < 2) return;
    // 원점이 아니라 월드 바운딩박스 기준으로 정렬(min=좌/하/뒤 모서리, max=우/상/앞, center=중심)
    // → 원점이 형상 중심이 아니거나 회전돼 있어도 시각 모서리가 맞는다.
    const boxes = new Map(targets.map((o) => [o.id, worldBBox(objects, assets, o.id)]));
    const edge = (id: string, fallback: number): number => {
      const b = boxes.get(id);
      if (!b) return fallback;
      return mode === 'min' ? b.min[axis] : mode === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2;
    };
    const vals = targets.map((o) => edge(o.id, o.position[axis]));
    const targetVal = mode === 'min' ? Math.min(...vals) : mode === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
    set({
      objects: objects.map((o) => {
        if (!selectedIds.includes(o.id)) return o;
        // 현재 모서리/중심을 targetVal로 옮기는 만큼 position[axis] 이동(루트 기준 1:1)
        const delta = targetVal - edge(o.id, o.position[axis]);
        return { ...o, position: { ...o.position, [axis]: o.position[axis] + delta } };
      }),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  duplicateSelected: () => {
    const { selectedId, objects, environment, animClips, past } = get();
    if (!selectedId) return;
    const src = objects.find((o) => o.id === selectedId);
    if (!src) return;
    objectCounter += 1;

    if (src.isGroup) {
      // 중첩 그룹 포함 전체 하위 계층 재귀 복제
      const idMap = new Map<string, string>();
      const newDescendants: ObjectNodeSchema[] = [];

      const collectAll = (parentId: string): void => {
        const children = objects.filter((o) => o.parentId === parentId);
        for (const child of children) {
          const newId = MathUtils.generateUUID();
          idMap.set(child.id, newId);
          newDescendants.push({ ...child, id: newId });
          if (child.isGroup) collectAll(child.id);
        }
      };

      const newGroupId = MathUtils.generateUUID();
      idMap.set(src.id, newGroupId);
      collectAll(src.id);

      const newGroup: ObjectNodeSchema = {
        ...src,
        id: newGroupId,
        name: `${src.name} 복사`,
        position: { ...src.position, x: src.position.x + 1 },
      };
      // parentId를 새로 생성된 ID로 교체
      const fixedDescendants = newDescendants.map((o) => ({
        ...o,
        parentId: idMap.get(o.parentId!) ?? o.parentId,
      }));
      // 그룹 루트만 +1 이동(자식은 로컬 위치 유지) → 클립 키프레임도 루트 이동량만 오프셋
      const posDelta = new Map([[src.id, { x: newGroup.position.x - src.position.x, y: newGroup.position.y - src.position.y, z: newGroup.position.z - src.position.z }]]);
      const { clips: dupClips, clipIdMap } = dupAnimClips(animClips, idMap, posDelta); // 애니 클립도 복제 + play_clip 리맵 + 위치 오프셋
      const remapped = remapPlayClipEvents([newGroup, ...fixedDescendants], clipIdMap);
      set({
        objects: [...objects, ...remapped],
        animClips: dupClips.length ? [...animClips, ...dupClips] : animClips,
        selectedId: newGroupId,
        selectedIds: [newGroupId],
        isModified: true,
        ...withHistory({ objects, environment, animClips }, past),
      });
    } else {
      // 그룹 내부 오브젝트는 같은 부모 아래에 복제 (parentId 유지)
      const copy: ObjectNodeSchema = {
        ...src,
        id: MathUtils.generateUUID(),
        name: `${src.name} 복사`,
        position: { ...src.position, x: src.position.x + 1 },
        parentId: src.parentId,
      };
      const posDelta = new Map([[src.id, { x: copy.position.x - src.position.x, y: copy.position.y - src.position.y, z: copy.position.z - src.position.z }]]);
      const { clips: dupClips, clipIdMap } = dupAnimClips(animClips, new Map([[src.id, copy.id]]), posDelta);
      const [remappedCopy] = remapPlayClipEvents([copy], clipIdMap);
      set({
        objects: [...objects, remappedCopy],
        animClips: dupClips.length ? [...animClips, ...dupClips] : animClips,
        selectedId: copy.id,
        selectedIds: [copy.id],
        isModified: true,
        ...withHistory({ objects, environment, animClips }, past),
      });
    }
  },

  // Ctrl+C — 선택 오브젝트(그룹이면 하위 계층 포함)를 클립보드에 스냅샷. 루트는 월드 좌표로 baking(parentId=null)해
  //   나중에 항상 최상위로 붙여넣어도 제자리에 놓이게 한다. 다중 선택 시 각 선택 루트만(자손 중복 방지) 담는다.
  copySelection: () => {
    const { selectedIds, selectedId, objects, animClips } = get();
    const ids = selectedIds.length ? selectedIds : (selectedId ? [selectedId] : []);
    if (!ids.length) return;
    const idSet = new Set(ids);
    const hasSelectedAncestor = (o: ObjectNodeSchema): boolean => {
      let p = o.parentId;
      while (p) { if (idSet.has(p)) return true; p = objects.find((x) => x.id === p)?.parentId ?? null; }
      return false;
    };
    const roots = ids
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is ObjectNodeSchema => !!o && !hasSelectedAncestor(o));
    if (!roots.length) return;
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
    const clipObjects: ObjectNodeSchema[] = [];
    for (const root of roots) {
      const wm = computeWorldMatrix(objects, root.id);
      const wp = new Vector3(), wq = new Quaternion(), ws = new Vector3();
      wm.decompose(wp, wq, ws);
      const we = new Euler().setFromQuaternion(wq);
      clipObjects.push({
        ...clone(root),
        parentId: null,
        position: { x: wp.x, y: wp.y, z: wp.z },
        rotation: { x: we.x * RAD2DEG_M, y: we.y * RAD2DEG_M, z: we.z * RAD2DEG_M },
        scale: { x: ws.x, y: ws.y, z: ws.z },
      });
      const collect = (parentId: string): void => {
        for (const child of objects.filter((o) => o.parentId === parentId)) {
          clipObjects.push(clone(child));
          if (child.isGroup) collect(child.id);
        }
      };
      collect(root.id);
    }
    const copiedIds = new Set(clipObjects.map((o) => o.id));
    const clips = animClips
      .filter((c) => (c.rootId ? copiedIds.has(c.rootId) : false) || c.tracks.some((t) => copiedIds.has(t.objectId)))
      .map(clone);
    set({ clipboard: { objects: clipObjects, clips } });
  },

  // Ctrl+V — 클립보드를 새 ID로 리맵해 항상 최상위(root)에 붙여넣기(+1 오프셋). 애니 클립도 함께 복제·리맵. 붙여넣은 것 선택.
  pasteClipboard: () => {
    const { clipboard, objects, environment, animClips, past } = get();
    if (!clipboard || !clipboard.objects.length) return;
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
    const idMap = new Map<string, string>();
    for (const o of clipboard.objects) idMap.set(o.id, MathUtils.generateUUID());
    const posDelta = new Map<string, { x: number; y: number; z: number }>();
    const newObjs: ObjectNodeSchema[] = clipboard.objects.map((o) => {
      const n: ObjectNodeSchema = { ...clone(o), id: idMap.get(o.id)!, parentId: o.parentId ? (idMap.get(o.parentId) ?? null) : null };
      if (n.parentId === null) {
        n.position = { ...n.position, x: n.position.x + 1 };
        n.name = `${n.name} 복사`;
        posDelta.set(o.id, { x: 1, y: 0, z: 0 });
      }
      return n;
    });
    const { clips: dupClips, clipIdMap } = dupAnimClips(clipboard.clips, idMap, posDelta);
    const remapped = remapPlayClipEvents(newObjs, clipIdMap);
    const newRootIds = newObjs.filter((o) => o.parentId === null).map((o) => o.id);
    set({
      objects: [...objects, ...remapped],
      animClips: dupClips.length ? [...animClips, ...dupClips] : animClips,
      selectedId: newRootIds[0] ?? null,
      selectedIds: newRootIds,
      isModified: true,
      ...withHistory({ objects, environment, animClips }, past),
    });
  },

  arraySelected: (count, offset, radial) => {
    const { selectedId, objects, environment, past } = get();
    if (!selectedId || count < 2) return;
    const src = objects.find((o) => o.id === selectedId);
    if (!src) return;

    const additions: ObjectNodeSchema[] = [];
    const newIds: string[] = [];

    // radial: 원 위의 각 위치(중심 기준 오프셋). axis=원이 도는 축(원 평면의 법선).
    const ringOffset = (theta: number) => {
      const r = radial!.radius, c = Math.cos(theta) * r, s = Math.sin(theta) * r;
      if (radial!.axis === 'x') return { x: 0, y: c, z: s };
      if (radial!.axis === 'z') return { x: c, y: s, z: 0 };
      return { x: c, y: 0, z: s }; // y(기본): XZ 평면
    };
    // 원본을 각도 0에 두고 중심을 역산 → 원본은 제자리, 나머지가 원을 그린다.
    const o0 = radial ? ringOffset(0) : null;
    const center = o0 ? { x: src.position.x - o0.x, y: src.position.y - o0.y, z: src.position.z - o0.z } : null;

    for (let i = 1; i < count; i++) {
      let pos: { x: number; y: number; z: number };
      if (radial && center) {
        const off = ringOffset((2 * Math.PI / count) * i);
        pos = { x: center.x + off.x, y: center.y + off.y, z: center.z + off.z };
      } else {
        pos = { x: src.position.x + offset.x * i, y: src.position.y + offset.y * i, z: src.position.z + offset.z * i };
      }

      if (src.isGroup) {
        // 중첩 그룹 포함 전체 하위 계층 재귀 복제 (duplicateSelected와 동일 패턴)
        const idMap = new Map<string, string>();
        const newDescendants: ObjectNodeSchema[] = [];
        const collectAll = (parentId: string): void => {
          for (const child of objects.filter((o) => o.parentId === parentId)) {
            const newId = MathUtils.generateUUID();
            idMap.set(child.id, newId);
            newDescendants.push({ ...child, id: newId });
            if (child.isGroup) collectAll(child.id);
          }
        };
        const newGroupId = MathUtils.generateUUID();
        idMap.set(src.id, newGroupId);
        collectAll(src.id);
        additions.push({ ...src, id: newGroupId, name: `${src.name} ${i}`, position: pos });
        for (const o of newDescendants) {
          additions.push({ ...o, parentId: idMap.get(o.parentId!) ?? o.parentId });
        }
        newIds.push(newGroupId);
      } else {
        const id = MathUtils.generateUUID();
        additions.push({ ...src, id, name: `${src.name} ${i}`, position: pos, parentId: src.parentId });
        newIds.push(id);
      }
    }

    if (additions.length === 0) return;
    set({
      objects: [...objects, ...additions],
      selectedId: newIds[newIds.length - 1],
      selectedIds: [selectedId, ...newIds],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  makeCloner: (config) => {
    const { selectedId, objects, environment, past } = get();
    if (!selectedId) return;
    const src = objects.find((o) => o.id === selectedId);
    if (!src || src.parentId || src.clonerConfig || src.clonerClone) return; // 루트·비클로너·비복제본만
    const cfg: ClonerConfig = config ? { ...config } : { ...DEFAULT_CLONER };
    objectCounter += 1;
    const clonerGroup = makeBaseObject({
      name: `클로너 ${objectCounter}`,
      isGroup: true,
      position: { ...src.position }, // 그룹(=패턴 중심)을 소스 자리에
      clonerConfig: cfg,
    });
    const gid = clonerGroup.id;
    const p0 = clonerPlacement(cfg, 0); // 소스를 placement(0)로
    const rebased = objects.map((o) => (o.id === src.id ? { ...o, parentId: gid, position: { x: p0.x, y: p0.y, z: p0.z } } : o));
    const regenerated = regenerateCloner([...rebased, clonerGroup], gid, cfg);
    set({
      objects: regenerated,
      selectedId: gid,
      selectedIds: [gid],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  updateCloner: (groupId, config) => {
    const { objects, environment, _prevSnapshot } = get();
    const withCfg = objects.map((o) => (o.id === groupId ? { ...o, clonerConfig: { ...config } } : o));
    const regenerated = regenerateCloner(withCfg, groupId, config);
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment },
      objects: regenerated,
      isModified: true,
    });
  },

  groupSelected: () => {
    const { selectedIds, objects, environment, past } = get();
    if (selectedIds.length < 2) return;

    // 그룹 내부 아이템 선택 시 최상위 조상으로 정규화
    // (로컬 좌표와 월드 좌표 혼용 방지)
    const getRootId = (id: string): string => {
      const o = objects.find((x) => x.id === id);
      if (!o || !o.parentId) return id;
      return getRootId(o.parentId);
    };
    const normalizedIds = [...new Set(selectedIds.map(getRootId))];
    if (normalizedIds.length < 2) return;

    const toGroup = objects.filter((o) => normalizedIds.includes(o.id));

    // 정규화된 아이템은 모두 최상위(world 좌표) → centroid 계산 정확
    let cx = 0, cy = 0, cz = 0;
    toGroup.forEach((o) => { cx += o.position.x; cy += o.position.y; cz += o.position.z; });
    cx /= toGroup.length; cy /= toGroup.length; cz /= toGroup.length;

    objectCounter += 1;
    const groupObj = makeBaseObject({
      name: `그룹 ${objectCounter}`,
      position: { x: cx, y: cy, z: cz },
      isGroup: true,
    });
    const groupId = groupObj.id;

    const updatedObjects = objects.map((o) =>
      normalizedIds.includes(o.id)
        ? { ...o, parentId: groupId, position: { x: o.position.x - cx, y: o.position.y - cy, z: o.position.z - cz } }
        : o
    );

    set({
      objects: [...updatedObjects, groupObj],
      selectedId: groupId,
      selectedIds: [groupId],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  ungroupSelected: () => {
    const { selectedId, objects, environment, past } = get();
    if (!selectedId) return;
    const group = objects.find((o) => o.id === selectedId);
    if (!group?.isGroup) return;

    // 행렬 기반: 자식의 참 월드행렬(그룹 체인 포함)을 새 부모(그룹의 부모=중첩이면 조부모, 아니면 root)
    // 기준 로컬로 변환해 decompose. 회전+비균일 스케일에서도 위치/방향/크기가 어긋나지 않는다
    // (기존엔 scale을 성분별 곱 후 회전 → 회전·스케일 비가환으로 자식 위치가 산발적으로 틀어졌음).
    const newParentId = group.parentId;
    const parentInv = newParentId
      ? computeWorldMatrix(objects, newParentId).invert()
      : new Matrix4();

    const children = objects.filter((o) => o.parentId === selectedId);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    const restoredChildren = children.map((c) => {
      const world = computeWorldMatrix(objects, c.id);
      const local = new Matrix4().multiplyMatrices(parentInv, world);
      local.decompose(p, q, s);
      const e = new Euler().setFromQuaternion(q);
      return {
        ...c,
        parentId: newParentId,
        position: { x: p.x, y: p.y, z: p.z },
        rotation: { x: e.x * RAD2DEG_M, y: e.y * RAD2DEG_M, z: e.z * RAD2DEG_M },
        scale: { x: s.x, y: s.y, z: s.z },
      };
    });

    const remaining = objects.filter((o) => o.id !== selectedId && !children.find((c) => c.id === o.id));

    set({
      objects: [...remaining, ...restoredChildren],
      selectedId: null,
      selectedIds: restoredChildren.map((c) => c.id),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  // ── 프리팹 ──
  createPrefab: (name) => {
    const { selectedId, objects, environment, prefabs, past } = get();
    if (!selectedId) return;
    const src = objects.find((o) => o.id === selectedId);
    if (!src || src.parentId) return; // 루트 오브젝트/그룹만
    if (src.prefabInstanceId) return;  // 이미 프리팹 인스턴스면 무시
    const { prefab, tagged } = buildPrefab(objects, selectedId, name?.trim() || src.name || '프리팹');
    const taggedById = new Map(tagged.map((t) => [t.id, t]));
    set({
      objects: objects.map((o) => taggedById.get(o.id) ?? o),
      prefabs: [...prefabs, prefab],
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  instantiatePrefab: (prefabId, position?: Vec3Schema) => {
    const { objects, environment, prefabs, past } = get();
    const prefab = prefabs.find((p) => p.id === prefabId);
    if (!prefab) return;
    const { objects: newObjects, rootId } = instantiatePrefabNodes(prefab, { position });
    set({
      objects: [...objects, ...newObjects],
      selectedId: rootId,
      selectedIds: [rootId],
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  applyInstanceToPrefab: (instanceRootId) => {
    const { objects, environment, prefabs, past } = get();
    const root = objects.find((o) => o.id === instanceRootId);
    if (!root?.prefabId || !root.prefabInstanceId) return;
    const prefab = prefabs.find((p) => p.id === root.prefabId);
    if (!prefab) return;
    const iid = root.prefabInstanceId;
    // 1) 인스턴스 현재 상태로 def 재구성  2) 소스 인스턴스의 override 초기화(이제 def에 반영됨)  3) 전체 재동기화
    const newPrefab = rebuildPrefabFromInstance(objects, prefab, instanceRootId);
    const clearedSource = objects.map((o) =>
      o.prefabInstanceId === iid ? { ...o, prefabOverrides: [] } : o,
    );
    const newPrefabs = prefabs.map((p) => (p.id === newPrefab.id ? newPrefab : p));
    const synced = syncInstances(clearedSource, newPrefab);
    set({
      objects: synced,
      prefabs: newPrefabs,
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  revertInstance: (instanceRootId, group) => {
    const { objects, environment, prefabs, past } = get();
    const root = objects.find((o) => o.id === instanceRootId);
    if (!root?.prefabId || !root.prefabInstanceId) return;
    const prefab = prefabs.find((p) => p.id === root.prefabId);
    if (!prefab) return;
    const iid = root.prefabInstanceId;
    // override 제거(그룹 지정 시 그 그룹만) → 재동기화가 원본 값을 다시 당겨온다.
    const cleared = objects.map((o) =>
      o.prefabInstanceId === iid
        ? { ...o, prefabOverrides: group ? (o.prefabOverrides ?? []).filter((g) => g !== group) : [] }
        : o,
    );
    const synced = syncInstances(cleared, prefab);
    set({
      objects: synced,
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  deletePrefab: (prefabId) => {
    const { objects, environment, prefabs, past } = get();
    if (!prefabs.some((p) => p.id === prefabId)) return;
    // 인스턴스는 씬에 유지하되 프리팹 태그를 벗겨 독립 오브젝트로 만든다.
    const detached = objects.map((o) =>
      o.prefabId === prefabId
        ? { ...o, prefabId: undefined, prefabInstanceId: undefined, prefabNodeKey: undefined, prefabOverrides: undefined }
        : o,
    );
    set({
      objects: detached,
      prefabs: prefabs.filter((p) => p.id !== prefabId),
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  renamePrefab: (prefabId, name) => {
    const { environment, objects, prefabs, past } = get();
    const trimmed = name.trim();
    if (!trimmed || !prefabs.some((p) => p.id === prefabId)) return;
    set({
      prefabs: prefabs.map((p) => (p.id === prefabId ? { ...p, name: trimmed } : p)),
      isModified: true,
      ...withHistory({ objects, environment, prefabs }, past),
    });
  },

  // ── 공용 재질 에셋(공존형) ──
  addMaterialAsset: (name, material) => {
    const { objects, environment, materialAssets, past } = get();
    const id = MathUtils.generateUUID();
    set({
      materialAssets: [...materialAssets, { id, name: name.trim() || `재질 ${materialAssets.length + 1}`, material: { ...material } }],
      isModified: true,
      ...withHistory({ objects, environment, materialAssets }, past),
    });
    return id;
  },
  updateMaterialAsset: (id, material) => {
    const { objects, environment, materialAssets, _prevSnapshot } = get();
    if (!materialAssets.some((m) => m.id === id)) return;
    // 드래그 슬라이더 대응 — _prevSnapshot 패턴(연속 편집을 1회 undo로). pushHistory가 확정.
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment, materialAssets },
      materialAssets: materialAssets.map((m) => (m.id === id ? { ...m, material: { ...material } } : m)),
      isModified: true,
    });
  },
  renameMaterialAsset: (id, name) => {
    const { objects, environment, materialAssets, past } = get();
    const t = name.trim();
    if (!t || !materialAssets.some((m) => m.id === id)) return;
    set({
      materialAssets: materialAssets.map((m) => (m.id === id ? { ...m, name: t } : m)),
      isModified: true,
      ...withHistory({ objects, environment, materialAssets }, past),
    });
  },
  removeMaterialAsset: (id) => {
    const { objects, environment, materialAssets, past } = get();
    const asset = materialAssets.find((m) => m.id === id);
    if (!asset) return;
    // 참조 오브젝트는 인라인으로 detach(에셋 재질 복사) 후 참조 해제 → 유령 참조 방지.
    const nextObjects = objects.map((o) =>
      o.materialId === id ? { ...o, materialId: undefined, material: { ...asset.material } } : o,
    );
    set({
      objects: nextObjects,
      materialAssets: materialAssets.filter((m) => m.id !== id),
      isModified: true,
      ...withHistory({ objects, environment, materialAssets }, past),
    });
  },
  assignMaterialAsset: (objectIds, materialId) => {
    const { objects, environment, materialAssets, past } = get();
    if (!materialAssets.some((m) => m.id === materialId)) return;
    const idset = new Set(objectIds);
    set({
      objects: objects.map((o) => (idset.has(o.id) ? { ...o, materialId } : o)),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },
  detachMaterial: (objectId) => {
    const { objects, environment, materialAssets, past } = get();
    const o = objects.find((x) => x.id === objectId);
    if (!o || !o.materialId) return;
    const asset = materialAssets.find((m) => m.id === o.materialId);
    set({
      objects: objects.map((x) => (x.id === objectId ? { ...x, materialId: undefined, material: { ...(asset?.material ?? x.material) } } : x)),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },
  // ── JSON 가져오기 ──
  importMaterialAssets: (items) => {
    if (items.length === 0) return 0;
    const { objects, environment, materialAssets, past } = get();
    const additions: MaterialAsset[] = items.map((it, i) => ({
      id: MathUtils.generateUUID(),
      name: it.name.trim() || `가져온 재질 ${materialAssets.length + i + 1}`,
      material: { ...it.material },
    }));
    set({
      materialAssets: [...materialAssets, ...additions],
      isModified: true,
      ...withHistory({ objects, environment, materialAssets }, past),
    });
    return additions.length;
  },

  importSceneJson: (data) => {
    const { objects, assets, environment, materialAssets, past } = get();

    // 1. 새 id 발급(오브젝트/에셋/재질 전부 이 씬의 기존 항목과 충돌하지 않게)
    const idMap = new Map<string, string>();
    for (const raw of data.objects) {
      if (typeof raw.id === 'string') idMap.set(raw.id, MathUtils.generateUUID());
    }
    const assetIdMap = new Map<string, string>();
    for (const a of data.assets) assetIdMap.set(a.id, MathUtils.generateUUID());
    const materialIdMap = new Map<string, string>();
    for (const m of data.materialAssets) materialIdMap.set(m.id, MathUtils.generateUUID());

    // 2. 에셋/재질 병합 — external:true = 원본 URL을 그대로 참조(스토리지 복사 없음, 삭제 시 원본 보호)
    const newAssets: AssetRefSchema[] = data.assets.map((a) => ({ ...a, id: assetIdMap.get(a.id)!, external: true }));
    const newMaterialAssets: MaterialAsset[] = data.materialAssets.map((m) => ({
      id: materialIdMap.get(m.id)!,
      name: (m.name || '가져온 재질').trim(),
      material: { ...m.material },
    }));

    // 이벤트 value(objectId 또는 "objectId|...") 안의 오브젝트 참조를 새 id로 리맵
    const remapEventValue = (value: string): string => {
      const parts = value.split('|');
      const mapped = idMap.get(parts[0]);
      if (!mapped) return value;
      parts[0] = mapped;
      return parts.join('|');
    };
    const remapEvents = (events: unknown): EventSchema[] => {
      if (!Array.isArray(events)) return [];
      return (events as EventSchema[]).map((ev) => ({
        ...ev,
        value: typeof ev.value === 'string' ? remapEventValue(ev.value) : ev.value,
        ...(typeof ev.elseValue === 'string' ? { elseValue: remapEventValue(ev.elseValue) } : {}),
      }));
    };

    // 3. 오브젝트 리맵 — parentId가 가져온 집합 밖을 가리키면 루트로 승격
    const importedRootIds: string[] = [];
    const newObjects: ObjectNodeSchema[] = data.objects.map((raw) => {
      const newId = idMap.get(raw.id as string)!;
      const oldParentId = typeof raw.parentId === 'string' ? raw.parentId : null;
      const newParentId = oldParentId && idMap.has(oldParentId) ? idMap.get(oldParentId)! : null;
      if (!newParentId) importedRootIds.push(newId);
      const newAssetId = typeof raw.assetId === 'string' && assetIdMap.has(raw.assetId) ? assetIdMap.get(raw.assetId)! : null;
      const newMaterialId = typeof raw.materialId === 'string' && materialIdMap.has(raw.materialId) ? materialIdMap.get(raw.materialId) : undefined;
      return makeBaseObject({
        ...raw,
        id: newId,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : '가져온 오브젝트',
        parentId: newParentId,
        assetId: newAssetId,
        materialId: newMaterialId,
        physics: { ...DEFAULT_PHYSICS, ...(raw.physics as Partial<typeof DEFAULT_PHYSICS> | undefined) },
        events: remapEvents(raw.events),
        locked: false,
      });
    });

    set({
      objects: [...objects, ...newObjects],
      assets: [...assets, ...newAssets],
      materialAssets: [...materialAssets, ...newMaterialAssets],
      selectedId: importedRootIds[0] ?? null,
      selectedIds: importedRootIds,
      isModified: true,
      ...withHistory({ objects, environment, materialAssets }, past),
    });

    return { objectCount: newObjects.length, assetCount: newAssets.length, materialCount: newMaterialAssets.length };
  },

  addColorAsset: (name, color) => {
    const { colorAssets } = get();
    set({ colorAssets: [...colorAssets, { id: MathUtils.generateUUID(), name: name.trim() || color, color }], isModified: true });
  },
  removeColorAsset: (id) => {
    const { colorAssets } = get();
    set({ colorAssets: colorAssets.filter((c) => c.id !== id), isModified: true });
  },

  // ── 게임 변수(상태) ── (GAME_LOGIC.md Phase 1)
  addVariable: () => {
    const { variables, objects, environment, past } = get();
    // 고유한 기본 이름(var1, var2 …) 생성
    let n = variables.length + 1;
    const taken = new Set(variables.map((v) => v.name));
    let name = `var${n}`;
    while (taken.has(name)) { n += 1; name = `var${n}`; }
    const v: GameVariable = { id: MathUtils.generateUUID(), name, type: 'number', initial: 0, showInHud: true };
    set({ variables: [...variables, v], isModified: true, ...withHistory({ objects, environment, variables }, past) });
  },
  updateVariable: (id, patch) => {
    const { variables, objects, environment, _prevSnapshot } = get();
    if (!variables.some((v) => v.id === id)) return;
    // 이름 변경 시 공백 제거(참조 키라 안정적으로). type 변경 시 initial을 타입에 맞게 보정.
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment, variables },
      variables: variables.map((v) => {
        if (v.id !== id) return v;
        const next = { ...v, ...patch };
        if (patch.name !== undefined) next.name = patch.name.replace(/\s+/g, '');
        if (patch.type !== undefined && patch.type !== v.type) {
          // 타입 변경 시 initial을 새 타입에 맞게 보정. enum은 옵션 목록도 준비.
          const t = patch.type;
          if (t === 'boolean') next.initial = false;
          else if (t === 'number') next.initial = 0;
          else if (t === 'timer') next.initial = 30; // 카운트다운 기본 30초
          else if (t === 'string' || t === 'asset') next.initial = '';
          else if (t === 'color') next.initial = '#ffffff';
          else if (t === 'enum') {
            if (!next.options || next.options.length === 0) next.options = ['A', 'B'];
            next.initial = next.options[0];
          }
        }
        // enum 옵션 편집 시 initial이 목록에 없으면 첫 옵션으로 맞춤.
        if (patch.options !== undefined && next.type === 'enum') {
          if (!next.options || next.options.length === 0) next.options = [''];
          if (!next.options.includes(next.initial as string)) next.initial = next.options[0];
        }
        return next;
      }),
      isModified: true,
    });
  },
  removeVariable: (id) => {
    const { variables, objects, environment, past } = get();
    if (!variables.some((v) => v.id === id)) return;
    set({ variables: variables.filter((v) => v.id !== id), isModified: true, ...withHistory({ objects, environment, variables }, past) });
  },

  // ── HUD 위젯 ── (GAME_LOGIC.md Phase 2)
  addHudElement: () => {
    const { hudElements, variables, objects, environment, past } = get();
    const el: HudElement = {
      id: MathUtils.generateUUID(),
      variable: variables[0]?.name ?? '',
      kind: 'text',
      position: 'top-left',
    };
    set({ hudElements: [...hudElements, el], isModified: true, ...withHistory({ objects, environment, hudElements }, past) });
  },
  updateHudElement: (id, patch) => {
    const { hudElements, objects, environment, _prevSnapshot } = get();
    if (!hudElements.some((h) => h.id === id)) return;
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment, hudElements },
      hudElements: hudElements.map((h) => (h.id === id ? { ...h, ...patch } : h)),
      isModified: true,
    });
  },
  removeHudElement: (id) => {
    const { hudElements, objects, environment, past } = get();
    if (!hudElements.some((h) => h.id === id)) return;
    set({ hudElements: hudElements.filter((h) => h.id !== id), isModified: true, ...withHistory({ objects, environment, hudElements }, past) });
  },

  // ── 게임 컨트롤러(씬 전역 규칙) ── (GAME_LOGIC.md 게임 컨트롤러 Phase 1)
  addSceneEvent: (ev) => {
    const { sceneEvents, objects, environment, past } = get();
    set({ sceneEvents: [...sceneEvents, ev], isModified: true, ...withHistory({ objects, environment, sceneEvents }, past) });
  },
  updateSceneEvent: (id, patch) => {
    const { sceneEvents, objects, environment, past } = get();
    if (!sceneEvents.some((e) => e.id === id)) return;
    set({
      sceneEvents: sceneEvents.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      isModified: true,
      ...withHistory({ objects, environment, sceneEvents }, past),
    });
  },
  removeSceneEvent: (id) => {
    const { sceneEvents, objects, environment, past } = get();
    if (!sceneEvents.some((e) => e.id === id)) return;
    set({ sceneEvents: sceneEvents.filter((e) => e.id !== id), isModified: true, ...withHistory({ objects, environment, sceneEvents }, past) });
  },

  // ── 애니메이션 클립 ── (ANIMATION.md Phase 1)
  addAnimClip: (clip) => {
    const { animClips, objects, environment, past } = get();
    set({ animClips: [...animClips, clip], isModified: true, ...withHistory({ objects, environment, animClips }, past) });
  },
  updateAnimClip: (id, patch) => {
    // 지연 커밋(_prevSnapshot) — 필드 편집 시 키 입력마다 undo 안 쌓임. 커밋은 pushHistory에서.
    const { animClips, objects, environment, _prevSnapshot } = get();
    if (!animClips.some((c) => c.id === id)) return;
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment, animClips },
      animClips: animClips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      isModified: true,
    });
  },
  removeAnimClip: (id) => {
    const { animClips, objects, environment, past } = get();
    if (!animClips.some((c) => c.id === id)) return;
    set({ animClips: animClips.filter((c) => c.id !== id), isModified: true, ...withHistory({ objects, environment, animClips }, past) });
  },
  // 다중 트랙 — 클립에 오브젝트(트랙) 추가. 기존 키 시간에 맞춰 현재 트랜스폼으로 키 생성(정렬 유지). (ANIMATION.md P3)
  addTrackToClip: (clipId, objectId) => {
    const { animClips, objects, environment, past } = get();
    const clip = animClips.find((c) => c.id === clipId);
    const o = objects.find((x) => x.id === objectId);
    if (!clip || !o || clip.tracks.some((t) => t.objectId === objectId)) return;
    const times = (clip.tracks[0]?.keys ?? [{ time: 0 }]).map((k) => k.time);
    const keys = times.map((time) => ({ time, position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale } }));
    set({
      animClips: animClips.map((c) => (c.id === clipId ? { ...c, tracks: [...c.tracks, { objectId, keys }] } : c)),
      isModified: true,
      ...withHistory({ objects, environment, animClips }, past),
    });
  },
  removeTrackFromClip: (clipId, objectId) => {
    const { animClips, objects, environment, past } = get();
    const clip = animClips.find((c) => c.id === clipId);
    if (!clip || clip.tracks.length <= 1 || !clip.tracks.some((t) => t.objectId === objectId)) return; // 마지막 트랙은 유지(빈 클립 방지)
    set({
      animClips: animClips.map((c) => (c.id === clipId ? { ...c, tracks: c.tracks.filter((t) => t.objectId !== objectId) } : c)),
      isModified: true,
      ...withHistory({ objects, environment, animClips }, past),
    });
  },
  // 에디터 미리보기(▶) — 클립을 뷰포트에서 재생. transient(저장/undo 무관). EditorCanvas ClipPreview가 구동.
  startAnimPreview: (clipId) => set({ animPreview: { clipId, startedAt: performance.now() }, animScrub: null }),
  stopAnimPreview: () => set({ animPreview: null }),
  setAnimScrub: (clipId, t) => set({ animScrub: t == null ? null : { clipId, t }, ...(t == null ? {} : { animPreview: null }) }),
  setAnimMode: (m) => set({ animMode: m }),
  setPoseEdit: (clipId, idx) => set({ poseEdit: idx == null ? null : { clipId, idx }, keySel: null }),
  // 포즈로 이동 — 모든 트랙 오브젝트를 그 키프레임으로. objects를 직접 세팅(updateObject 우회 → 오토키 무발동).
  //   이 포즈를 '편집 중 포즈'로 지정 → 이후 오브젝트를 옮기면 오토키가 이 포즈에 반영.
  goToPose: (clipId, idx) => {
    const { animClips, objects, environment, past } = get();
    const clip = animClips.find((c) => c.id === clipId);
    if (!clip) return;
    const keyById = new Map<string, AnimKeyframe>();
    for (const t of clip.tracks) { const k = t.keys[idx]; if (k) keyById.set(t.objectId, k); }
    if (keyById.size === 0) return;
    set({
      objects: objects.map((o) => {
        const k = keyById.get(o.id);
        return k ? { ...o, ...(k.position ? { position: { ...k.position } } : {}), ...(k.rotation ? { rotation: { ...k.rotation } } : {}), ...(k.scale ? { scale: { ...k.scale } } : {}) } : o;
      }),
      poseEdit: { clipId, idx },
      keySel: null,
      isModified: true,
      _prevSnapshot: null,
      ...withHistory({ objects, environment }, past),
    });
  },
  clearKeySel: () => set({ keySel: null }),
  // 타임라인: 특정 트랙의 특정 키로 이동 — 그 오브젝트만 그 키 값으로. keySel 지정(오토키가 이 키만 갱신), poseEdit 해제.
  goToKey: (clipId, objectId, idx) => {
    const { animClips, objects, environment, past } = get();
    const track = animClips.find((c) => c.id === clipId)?.tracks.find((t) => t.objectId === objectId);
    const k = track?.keys[idx];
    if (!k) return;
    set({
      objects: objects.map((o) => (o.id === objectId ? { ...o, ...(k.position ? { position: { ...k.position } } : {}), ...(k.rotation ? { rotation: { ...k.rotation } } : {}), ...(k.scale ? { scale: { ...k.scale } } : {}) } : o)),
      keySel: { clipId, objectId, idx },
      poseEdit: null,
      isModified: true,
      _prevSnapshot: null,
      ...withHistory({ objects, environment }, past),
    });
  },
  // 타임라인: 한 트랙에만 키 추가(현재 트랜스폼 캡처, 시간 t). 그 키를 선택.
  addKeyToTrack: (clipId, objectId, t) => {
    const { animClips, objects, environment, past } = get();
    const clip = animClips.find((c) => c.id === clipId);
    const o = objects.find((x) => x.id === objectId);
    if (!clip || !o) return;
    const time = Math.round(Math.max(0, t) * 100) / 100;
    const tracks = clip.tracks.map((tr) => tr.objectId !== objectId ? tr
      : { ...tr, keys: [...tr.keys.filter((k) => Math.abs(k.time - time) > 1e-3), { time, position: { ...o.position }, rotation: { ...o.rotation }, scale: { ...o.scale } }].sort((a, b) => a.time - b.time) });
    const dur = Math.max(0.1, ...tracks.flatMap((tr) => tr.keys.map((k) => k.time)));
    const idx = tracks.find((tr) => tr.objectId === objectId)!.keys.findIndex((k) => Math.abs(k.time - time) < 1e-3);
    set({ animClips: animClips.map((c) => (c.id === clipId ? { ...c, tracks, duration: dur } : c)), keySel: { clipId, objectId, idx }, poseEdit: null, isModified: true, ...withHistory({ objects, environment, animClips }, past) });
  },
  // 타임라인: 한 트랙 키 시간 이동(이웃 사이 클램프). 지연 커밋(드래그) — 호출부 pushHistory로 확정.
  retimeKey: (clipId, objectId, idx, t) => {
    const { animClips, objects, environment, _prevSnapshot } = get();
    const clip = animClips.find((c) => c.id === clipId);
    const track = clip?.tracks.find((tr) => tr.objectId === objectId);
    if (!clip || !track || !track.keys[idx]) return;
    const times = track.keys.map((k) => k.time);
    const lo = idx > 0 ? times[idx - 1] + 0.01 : 0;
    const hi = idx < times.length - 1 ? times[idx + 1] - 0.01 : Infinity;
    const nt = Math.round(Math.min(hi, Math.max(lo, t)) * 100) / 100;
    const tracks = clip.tracks.map((tr) => tr.objectId !== objectId ? tr : { ...tr, keys: tr.keys.map((k, i) => (i === idx ? { ...k, time: nt } : k)) });
    const dur = Math.max(0.1, ...tracks.flatMap((tr) => tr.keys.map((k) => k.time)));
    set({ _prevSnapshot: _prevSnapshot ?? { objects, environment, animClips }, animClips: animClips.map((c) => (c.id === clipId ? { ...c, tracks, duration: dur } : c)), isModified: true });
  },
  // 타임라인: 한 트랙 키 삭제(트랙 최소 1키 유지).
  removeKey: (clipId, objectId, idx) => {
    const { animClips, objects, environment, past } = get();
    const clip = animClips.find((c) => c.id === clipId);
    const track = clip?.tracks.find((tr) => tr.objectId === objectId);
    if (!clip || !track || track.keys.length <= 1) return;
    const tracks = clip.tracks.map((tr) => tr.objectId !== objectId ? tr : { ...tr, keys: tr.keys.filter((_, i) => i !== idx) });
    const dur = Math.max(0.1, ...tracks.flatMap((tr) => tr.keys.map((k) => k.time)));
    set({ animClips: animClips.map((c) => (c.id === clipId ? { ...c, tracks, duration: dur } : c)), keySel: null, isModified: true, ...withHistory({ objects, environment, animClips }, past) });
  },

  updateEnvironment: (patch) => {
    const { environment, objects, _prevSnapshot } = get();
    set({
      _prevSnapshot: _prevSnapshot ?? { objects, environment },
      environment: { ...environment, ...patch },
      isModified: true,
    });
  },

  pushHistory: () => {
    const { _prevSnapshot, objects, environment, past } = get();
    const snapshot = _prevSnapshot ?? { objects, environment };
    set({ ...withHistory(snapshot, past), _prevSnapshot: null });
  },

  undo: () => {
    const { past, objects, environment, prefabs, materialAssets, variables, hudElements, sceneEvents, animClips, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      objects: prev.objects,
      environment: prev.environment,
      // 스냅샷에 있으면 복원(그 액션이 변경한 것), 없으면 현재값 유지.
      prefabs: prev.prefabs ?? prefabs,
      materialAssets: prev.materialAssets ?? materialAssets,
      variables: prev.variables ?? variables,
      hudElements: prev.hudElements ?? hudElements,
      sceneEvents: prev.sceneEvents ?? sceneEvents,
      animClips: prev.animClips ?? animClips,
      past: past.slice(0, -1),
      future: [{ objects, environment, prefabs, materialAssets, variables, hudElements, sceneEvents, animClips }, ...future],
      isModified: true,
      _prevSnapshot: null,
    });
  },

  redo: () => {
    const { past, objects, environment, prefabs, materialAssets, variables, hudElements, sceneEvents, animClips, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      objects: next.objects,
      environment: next.environment,
      prefabs: next.prefabs ?? prefabs,
      materialAssets: next.materialAssets ?? materialAssets,
      variables: next.variables ?? variables,
      hudElements: next.hudElements ?? hudElements,
      sceneEvents: next.sceneEvents ?? sceneEvents,
      animClips: next.animClips ?? animClips,
      past: pushPast(past, { objects, environment, prefabs, materialAssets, variables, hudElements, sceneEvents, animClips }),
      future: future.slice(1),
      isModified: true,
      _prevSnapshot: null,
    });
  },

  markSaved: (savedVersion) => set(savedVersion !== undefined ? { isModified: false, savedVersion } : { isModified: false }),
  markModified: () => set({ isModified: true }),
  toggleWireframe: () => set((s) => ({ wireframeMode: !s.wireframeMode })),
  cycleGridPlane: () => set((s) => ({ gridPlane: s.gridPlane === 'xz' ? 'xy' : s.gridPlane === 'xy' ? 'yz' : 'xz' })),
  toggleObjectSnap: () => set((s) => ({ objectSnap: !s.objectSnap })),

  copyObjectProperties: () => {
    const { selectedId, objects } = get();
    if (!selectedId) return;
    const obj = objects.find((o) => o.id === selectedId);
    if (!obj) return;
    set({ copiedProperties: { material: obj.material ? { ...obj.material } : undefined, physics: { ...obj.physics } } });
  },

  pasteObjectProperties: () => {
    const { selectedId, objects, copiedProperties, environment, past } = get();
    if (!selectedId || !copiedProperties) return;
    set({
      objects: objects.map((o) =>
        o.id === selectedId
          ? {
              ...o,
              ...(copiedProperties.material !== undefined ? { material: { ...copiedProperties.material } } : {}),
              physics: copiedProperties.physics ? { ...copiedProperties.physics } : o.physics,
            }
          : o
      ),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  batchUpdateObjects: (ids, patch) => {
    const { objects, environment, past } = get();
    set({
      objects: objects.map((o) => ids.includes(o.id) ? { ...o, ...patch(o) } : o),
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },

  addLightObject: (type, placeAt) => {
    objectCounter += 1;
    const LIGHT_NAMES: Record<LightType, string> = { point: '포인트 라이트', spot: '스팟 라이트', directional: '방향 라이트' };
    const obj = makeBaseObject({
      name: `${LIGHT_NAMES[type]} ${objectCounter}`,
      position: { x: placeAt?.x ?? 0, y: 3, z: placeAt?.z ?? 0 },
      light: { type, color: '#ffffff', intensity: 1, distance: 20, decay: 2, castShadow: false },
    });
    const { objects, environment, past } = get();
    set({
      objects: [...objects, obj],
      selectedId: obj.id,
      selectedIds: [obj.id],
      isModified: true,
      ...withHistory({ objects, environment }, past),
    });
  },
}));
