// 공포 게임 "실제로 깰 수 있는가" 검증 — `npx tsx src/lib/horrorReachability.check.ts`
// 오브젝트/이벤트 그래프 검사(horrorTemplate.check.ts)는 데이터의 정합성만 본다 — "문이 열리는 조건이
// 맞는가"는 확인해도 "그 문까지 실제로 걸어갈 수 있는가"는 못 본다. 실제로 방 두 개가 겹치고
// 지하 통로가 막혀 있었는데 그 검사는 전부 통과했다. 이 스크립트가 그 구멍을 메운다:
//   각 진행 단계(문 닫힘 → 격벽 열림 → 철문 열림)에서 스폰~목표 지점이 걸어서 연결되는지 플러드 필로 확인.
import { SCENE_TEMPLATES } from './sceneTemplates';
import { computeReachable } from './levelReachability';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const t = SCENE_TEMPLATES.find((x) => x.id === 'horror');
if (!t) { console.log('  ✗ horror 템플릿 없음'); process.exit(1); }
const scene = t.build('P', 'S');
const objs = scene.objects;
const spawn = scene.environment.playerStartPosition!;

// 이벤트에서 오브젝트 위치를 이름/역할로 찾는다 (좌표 사본이 아니라 씬 데이터에서 직접 읽어 어긋날 일이 없다).
const byName = (n: string) => objs.find((o) => o.name === n)!;
const gateDoor = objs.find((o) => o.isActuator && o.name === '지하 격벽')!;
const finalDoor = objs.find((o) => o.isActuator && o.name === '잠긴 철문')!;
const keys = ['열쇠 1', '열쇠 2', '열쇠 3', '열쇠 4'].map(byName);
const batteries = ['배터리 1', '배터리 2', '배터리 3', '배터리 4', '배터리 5', '배터리 6'].map(byName);
const exit = byName('탈출구');

console.log(`\n[도달 가능성] 스폰 (${spawn.x}, ${spawn.z}) · 바닥 ${objs.filter((o) => o.primitiveShape === 'plane').length}개`);

// ── 단계 0: 문 전부 닫힌 상태 — 로비·복도와 양쪽 병실까지는 항상 갈 수 있어야 한다 ──
{
  const r0 = computeReachable(objs, spawn);
  console.log(`\n0단계(문 전부 닫힘) — 도달 칸 ${r0.reachedCells}`);
  ok('병실A 진입 가능', r0.canReach(-7, -9.5));
  ok('병실B 진입 가능', r0.canReach(7, -9.5));
  ok('열쇠1(병실A) 도달 가능', r0.canReach(keys[0].position.x, keys[0].position.z));
  ok('열쇠2(병실B) 도달 가능', r0.canReach(keys[1].position.x, keys[1].position.z));
  ok('배터리1(로비) 도달 가능', r0.canReach(batteries[0].position.x, batteries[0].position.z));
  ok('배터리2(병실A) 도달 가능', r0.canReach(batteries[1].position.x, batteries[1].position.z));
  ok('배터리3(병실B) 도달 가능', r0.canReach(batteries[2].position.x, batteries[2].position.z));
  // ★ 이게 핵심 회귀 케이스 — 지난 버전엔 이게 막혀 있었는데도 다른 검사는 다 통과했다.
  ok('지하 격벽 전엔 보관실에 갈 수 없음(관문이 진짜 막는지)', !r0.canReach(-12.5, -22.5));
  ok('지하 격벽 전엔 제단실에 갈 수 없음(철문이 진짜 막는지)', !r0.canReach(0, -21));
}

// ── 단계 1: 격벽 열림(keys>=2) — 보관실·영안실·열쇠3·4·나머지 배터리까지 뚫려야 한다 ──
{
  const r1 = computeReachable(objs, spawn, { openDoorIds: new Set([gateDoor.id]) });
  console.log(`\n1단계(격벽 열림, keys>=2) — 도달 칸 ${r1.reachedCells}`);
  ok('지하 통로 진입 가능', r1.canReach(-9.5, -16.5));
  ok('보관실(세이프룸) 도달 가능', r1.canReach(-12.5, -22.5));
  ok('영안실 도달 가능', r1.canReach(-21, -22.5));
  ok('열쇠3(보관실) 도달 가능', r1.canReach(keys[2].position.x, keys[2].position.z));
  ok('열쇠4(영안실) 도달 가능', r1.canReach(keys[3].position.x, keys[3].position.z));
  ok('배터리4(지하통로) 도달 가능', r1.canReach(batteries[3].position.x, batteries[3].position.z));
  ok('배터리5(보관실) 도달 가능', r1.canReach(batteries[4].position.x, batteries[4].position.z));
  ok('배터리6(영안실) 도달 가능', r1.canReach(batteries[5].position.x, batteries[5].position.z));
  // 격벽만 열렸을 뿐 철문은 아직 안 열렸다 — 제단실은 여전히 막혀야 한다(복도 쪽에서든 지하 쪽에서든).
  ok('격벽만 열려선 제단실 못 감(철문이 여전히 막음)', !r1.canReach(0, -21));
}

// ── 단계 2: 둘 다 열림(keys>=4) — 제단실·출구까지 완주 가능해야 한다 ──
{
  const r2 = computeReachable(objs, spawn, { openDoorIds: new Set([gateDoor.id, finalDoor.id]) });
  console.log(`\n2단계(철문까지 열림, keys>=4) — 도달 칸 ${r2.reachedCells}`);
  ok('제단실 도달 가능', r2.canReach(0, -21));
  ok('탈출구 도달 가능(★ 클리어 가능 여부)', r2.canReach(exit.position.x, exit.position.z));
}

// ── 함정을 피해서도 각 열쇠/출구에 갈 수 있는지 — 함정이 유일한 길을 막고 있으면 안 된다 ──
// (levelReachability는 함정을 안 막는다 — 밟으면 죽을 뿐 지나갈 순 있어서다. 대신 "우회로가 있는가"를
//  함정을 벽처럼 취급한 별도 패스로 확인 — 있으면 더 좋고, 없어도 게임 자체는 성립하니 정보성 체크.)
{
  const trapObjs = objs.filter((o) => o.physics?.isSensor && o.material?.emissive === '#7a0f0f');
  const asWalls = objs.map((o) => (trapObjs.includes(o) ? { ...o, physics: { ...o.physics!, isSensor: false } } : o));
  const r3 = computeReachable(asWalls, spawn, { openDoorIds: new Set([gateDoor.id, finalDoor.id]) });
  console.log(`\n우회로 확인(함정을 벽으로 취급, 참고용) — 도달 칸 ${r3.reachedCells}`);
  ok('(참고) 함정을 다 피해도 출구 도달 가능', r3.canReach(exit.position.x, exit.position.z));
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
