// 레벨 도달 가능성(플러드 필) — "이 게임을 깰 수 있는가"를 좌표로 판정한다.
//
// 왜 필요한가: 방을 눈으로 배치하면 **벽 하나가 통로를 막아도 알아채지 못한다.**
// 실제로 그랬다 — 보관실과 제단실이 4×6m 겹쳐 있었고 지하 통로는 사방이 막혀 있었는데
// 오브젝트 수·이벤트 그래프 검사(49개)는 전부 통과했다. 구조 검사는 '연결성'을 못 본다.
//
// 방식: XZ 평면을 격자로 잘라 걸을 수 있는 칸을 찾고, 스폰에서 플러드 필로 퍼뜨린다.
//   걸을 수 있는 칸 = 바닥(plane) 위 && 솔리드 박스가 캐릭터 높이에서 막지 않음.
//   문(모터)은 '열린 상태'를 인자로 받아 단계별로 확인한다(열쇠 2개 → 격벽, 4개 → 철문).
import type { ObjectNodeSchema } from '../types/scene';

export interface ReachOptions {
  /** 격자 한 칸(m). 작을수록 정확하지만 느리다. 기본 0.25 */
  cell?: number;
  /** 캐릭터 반경(m) — 벽을 이만큼 두껍게 보아 좁은 틈을 통과 못 하게 한다. 기본 0.35 */
  radius?: number;
  /** 이 시점에 '열려 있는' 모터(문) id들. 여기 든 문은 통과 가능으로 본다. */
  openDoorIds?: Set<string>;
}

export interface ReachResult {
  /** 스폰에서 걸어 도달 가능한지 판정 */
  canReach: (x: number, z: number) => boolean;
  /** 도달 가능한 칸 수(디버그용) */
  reachedCells: number;
  /** 격자 범위 */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

interface Rect { x0: number; x1: number; z0: number; z1: number }

const rectOf = (o: ObjectNodeSchema): Rect => ({
  x0: o.position.x - Math.abs(o.scale.x) / 2,
  x1: o.position.x + Math.abs(o.scale.x) / 2,
  z0: o.position.z - Math.abs(o.scale.z) / 2,
  z1: o.position.z + Math.abs(o.scale.z) / 2,
});

/** 이 오브젝트가 '캐릭터 높이에서' 길을 막는가. 센서·장식·바닥·낮은 가구는 막지 않는다. */
function blocksWalking(o: ObjectNodeSchema, allObjects: ObjectNodeSchema[], openDoorIds: Set<string>): boolean {
  if (!o.physics?.enabled || o.physics.isSensor) return false;
  if (o.primitiveShape === 'plane') return false;      // 바닥
  if (o.light || o.particle) return false;
  // 문(모터)의 자식 메쉬 — 문이 열렸으면 통과 가능
  let anc = o.parentId ? allObjects.find((p) => p.id === o.parentId) : undefined;
  while (anc) {
    if (anc.isActuator && openDoorIds.has(anc.id)) return false;
    anc = anc.parentId ? allObjects.find((p) => p.id === anc!.parentId) : undefined;
  }
  // 높이 판정 — 캐릭터는 발밑 0 ~ 머리 1.7. 그 구간을 안 건드리면(천장·낮은 턱) 통과 가능.
  const top = o.position.y + Math.abs(o.scale.y) / 2;
  const bottom = o.position.y - Math.abs(o.scale.y) / 2;
  const STEP = 0.45;   // 이보다 낮은 턱은 넘어간다(캐릭터 컨트롤러의 계단 오르기)
  const HEAD = 1.7;
  if (top <= STEP) return false;        // 낮은 턱·문턱
  if (bottom >= HEAD) return false;     // 천장·상인방
  return true;
}

/**
 * 스폰에서 걸어갈 수 있는 영역을 계산한다.
 * 부모가 있는(중첩) 오브젝트는 부모 변환이 필요하므로, 여기선 **루트 오브젝트와 문 자식**만 본다
 * — 레벨 구조(벽·바닥)는 전부 루트라 이 근사로 충분하다.
 */
export function computeReachable(
  objects: ObjectNodeSchema[],
  spawn: { x: number; z: number },
  opts: ReachOptions = {},
): ReachResult {
  const cell = opts.cell ?? 0.25;
  const radius = opts.radius ?? 0.35;
  const openDoorIds = opts.openDoorIds ?? new Set<string>();

  const floors = objects.filter((o) => o.primitiveShape === 'plane' && !o.parentId);
  if (floors.length === 0) throw new Error('바닥(plane)이 하나도 없다');

  // 격자 범위 = 바닥 전체를 감싸는 사각형
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const floorRects = floors.map(rectOf);
  for (const r of floorRects) {
    minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
    minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
  }
  const W = Math.ceil((maxX - minX) / cell) + 1;
  const H = Math.ceil((maxZ - minZ) / cell) + 1;
  const idx = (i: number, j: number) => j * W + i;
  const cx = (i: number) => minX + i * cell;
  const cz = (j: number) => minZ + j * cell;

  // ① 바닥 위 칸 표시
  const walkable = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = cx(i), z = cz(j);
    if (floorRects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) walkable[idx(i, j)] = 1;
  }

  // ② 벽/가구가 막는 칸 제거 — 캐릭터 반경만큼 부풀린다(좁은 틈 통과 방지)
  const solids = objects.filter((o) => blocksWalking(o, objects, openDoorIds));
  for (const o of solids) {
    // 자식(문짝)은 부모 위치를 더해 월드 좌표로. 회전은 무시(문은 닫힌 상태 기준이라 이게 맞다).
    let ox = o.position.x, oz = o.position.z;
    let anc = o.parentId ? objects.find((p) => p.id === o.parentId) : undefined;
    while (anc) { ox += anc.position.x; oz += anc.position.z; anc = anc.parentId ? objects.find((p) => p.id === anc!.parentId) : undefined; }
    const r = { x0: ox - Math.abs(o.scale.x) / 2 - radius, x1: ox + Math.abs(o.scale.x) / 2 + radius,
      z0: oz - Math.abs(o.scale.z) / 2 - radius, z1: oz + Math.abs(o.scale.z) / 2 + radius };
    const i0 = Math.max(0, Math.floor((r.x0 - minX) / cell)), i1 = Math.min(W - 1, Math.ceil((r.x1 - minX) / cell));
    const j0 = Math.max(0, Math.floor((r.z0 - minZ) / cell)), j1 = Math.min(H - 1, Math.ceil((r.z1 - minZ) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = cx(i), z = cz(j);
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) walkable[idx(i, j)] = 0;
    }
  }

  // ③ 스폰에서 플러드 필(4방향)
  const seen = new Uint8Array(W * H);
  const si = Math.round((spawn.x - minX) / cell), sj = Math.round((spawn.z - minZ) / cell);
  const queue: number[] = [];
  if (si >= 0 && si < W && sj >= 0 && sj < H && walkable[idx(si, sj)]) {
    seen[idx(si, sj)] = 1; queue.push(idx(si, sj));
  }
  let head = 0, reachedCells = queue.length;
  while (head < queue.length) {
    const k = queue[head++];
    const i = k % W, j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || ni >= W || nj < 0 || nj >= H) continue;
      const nk = idx(ni, nj);
      if (seen[nk] || !walkable[nk]) continue;
      seen[nk] = 1; reachedCells++; queue.push(nk);
    }
  }

  // 목표 지점 판정 — 정확히 그 칸이 막혀 있어도(가구 옆 등) 주변 0.8m 안에 도달 칸이 있으면 OK로 본다.
  const canReach = (x: number, z: number) => {
    const ci = Math.round((x - minX) / cell), cj = Math.round((z - minZ) / cell);
    const r = Math.ceil(0.8 / cell);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= W || j < 0 || j >= H) continue;
      if (seen[idx(i, j)]) return true;
    }
    return false;
  };

  return { canReach, reachedCells, bounds: { minX, maxX, minZ, maxZ } };
}
