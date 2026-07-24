// 공포 게임 템플릿 검증 — `npx tsx src/lib/horrorTemplate.check.ts`
// 레벨은 오브젝트 90개 + 이벤트 그래프라 눈으로 못 본다. "게임이 성립하는가"를 데이터로 확인한다:
//   열쇠 3개가 실제로 3을 만드는가 · 문이 그 조건으로 열리는가 · 승/패 경로가 있는가 ·
//   이벤트가 가리키는 id가 실존하는가 · 방이 벽으로 닫혀 있고 통로가 뚫려 있는가.
import { SCENE_TEMPLATES } from './sceneTemplates';
import { normalizeSceneData } from '../types/scene';
import type { ObjectNodeSchema } from '../types/scene';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`); }
};

const t = SCENE_TEMPLATES.find((x) => x.id === 'horror');
if (!t) { console.log('  ✗ horror 템플릿 없음'); process.exit(1); }

const scene = t.build('P', 'S');
const objs = scene.objects;
const byId = new Map(objs.map((o) => [o.id, o]));
const allEvents = [...objs.flatMap((o) => (o.events ?? []).map((e) => ({ e, owner: o }))),
  ...(scene.sceneEvents ?? []).map((e) => ({ e, owner: null as ObjectNodeSchema | null }))];

console.log(`\n[공포 게임] 오브젝트 ${objs.length} · 이벤트 ${allEvents.length} · 변수 ${scene.variables?.length ?? 0}`);

console.log('\n스키마');
const norm = normalizeSceneData(JSON.parse(JSON.stringify(scene)), 'P', 'S');
ok('normalize 통과(저장·로드 왕복)', norm.objects.length === objs.length && !!norm.environment);
ok('id 중복 없음', new Set(objs.map((o) => o.id)).size === objs.length);
ok('부모 참조 유효', objs.every((o) => !o.parentId || byId.has(o.parentId)));
ok('이벤트 id 중복 없음', new Set(allEvents.map((x) => x.e.id)).size === allEvents.length);

console.log('\n게임 규칙');
const keyGains = allEvents.filter((x) => x.e.action === 'set_variable' && x.e.value.startsWith('keys|add'));
ok('열쇠 획득 이벤트 4개', keyGains.length === 4, `${keyGains.length}개`);
ok('열쇠 합계가 정확히 4', keyGains.reduce((n, x) => n + Number(x.e.value.split('|')[2] ?? 0), 0) === 4);
ok('열쇠는 센서(밟아야 발동)', keyGains.every((x) => x.owner?.physics?.isSensor === true && x.owner?.physics?.enabled === true));
ok('먹은 열쇠는 사라짐(hide_object 짝)',
  keyGains.every((x) => (x.owner?.events ?? []).some((e) => e.action === 'hide_object' && e.value === x.owner!.id)));

const actuatorEvents = (scene.sceneEvents ?? []).filter((e) => e.action === 'set_actuator');
// 최종 문 = 가장 높은 열쇠 조건을 요구하는 것
const doorOpen = actuatorEvents.slice().sort((a, b) =>
  Number(b.conditions?.[0]?.value ?? 0) - Number(a.conditions?.[0]?.value ?? 0))[0];
ok('문 열림 규칙 존재(set_actuator)', !!doorOpen);
ok('문 대상 id가 실존하는 모터', !!doorOpen && byId.get(doorOpen.value.split('|')[0])?.isActuator === true);
ok('열림 조건 = keys >= 4', !!doorOpen?.conditions?.some((c) => c.variable === 'keys' && c.op === '>=' && c.value === 4));
const door = doorOpen ? byId.get(doorOpen.value.split('|')[0]) : undefined;
ok('문 모터 drive=event(열쇠 전엔 안 열림)', door?.actuator?.drive === 'event');
ok('문 콜라이더 동반(실제로 길을 막음)', door?.actuator?.collider === true);
ok('문짝이 모터의 자식', objs.some((o) => o.parentId === door?.id && o.primitiveShape === 'box'));

ok('승리 경로 있음(game_win)', allEvents.some((x) => x.e.action === 'game_win'));
ok('패배 경로 있음(game_lose)', allEvents.some((x) => x.e.action === 'game_lose'));
// game_lose는 두 종류다 — 밟는 함정(오브젝트)과 배터리 소진(씬 전역). 함정 검사는 앞의 것만.
const traps = allEvents.filter((x) => x.e.action === 'game_lose' && x.owner);
ok('함정이 보이게 발광(회피 가능)',
  traps.every((x) => x.owner?.visible === true && !!x.owner?.material?.emissive && x.owner?.material?.emissive !== '#000000'),
  `${traps.length}개`);
ok('점프스케어는 1회(조건 가드)',
  allEvents.filter((x) => x.e.action === 'show_popup' && x.owner)
    .every((x) => (x.e.conditions?.length ?? 0) > 0));
ok('인트로 안내(scene_start)', (scene.sceneEvents ?? []).some((e) => e.trigger === 'scene_start' && e.action === 'show_popup'));

console.log('\n난이도 · 자원(공포 게임 레퍼런스)');
// ③ 자원 희소성(Amnesia의 기름 → 손전등) — 이번 버전은 "존재 비용"(상시 타이머 소모)이 아니라
//   "사용 비용"(켜져 있는 동안만 소모)이다. 2026-07-24 사용자 요청으로 실제 스포트라이트+안개 override가
//   붙었으므로, 여기선 엔진 설정(EnvSchema.flashlight)이 제대로 실려 있는지를 확인한다.
const fl = scene.environment.flashlight;
ok('손전등 기능 켜짐(flashlight.enabled)', fl?.enabled === true);
ok('배터리 변수와 연결됨', fl?.batteryVariable === 'battery');
ok('★ 상시 소모(on_timer) 이벤트 없음 — 사용 비용 모델로 전환됨',
  !(scene.sceneEvents ?? []).some((e) => e.trigger === 'on_timer' && e.value.startsWith('battery|sub')));
ok('배터리 0이면 패배', (scene.sceneEvents ?? []).some((e) =>
  e.action === 'game_lose' && e.conditions?.some((c) => c.variable === 'battery' && (c.op === '<=' || c.op === '<'))));
const pickups = allEvents.filter((x) => x.e.action === 'set_variable' && x.e.value.startsWith('battery|add'));
ok('배터리를 주울 수 있음(회복 수단)', pickups.length >= 3, `${pickups.length}개`);
// 자원 수지 — "켜 놓을 수 있는 총 시간"이 감당할 만해야 한다(너무 짧으면 운 게임, 너무 길면 무의미).
const startBat = Number((scene.variables ?? []).find((v) => v.name === 'battery')?.initial ?? 0);
const totalBat = startBat + pickups.reduce((n, x) => n + Number(x.e.value.split('|')[2] ?? 0), 0);
const drainPerSec = fl?.drainPerSec ?? 1 / 6;
const budgetSec = drainPerSec > 0 ? totalBat / drainPerSec : Infinity;
ok('총 점등 가능 시간이 1~5분(너무 짧지도 무제한도 아님)', budgetSec >= 60 && budgetSec <= 300,
  `최대 ${Math.round(budgetSec)}초 점등 (배터리 ${totalBat}개 = 시작 ${startBat} + 획득 ${totalBat - startBat})`);
ok('꺼짐 상태가 켜짐보다 안개가 짙음(끄면 실제로 안 보여야 강제력이 생김)',
  (fl?.offFogDensity ?? 0) > (fl?.onFogDensity ?? Infinity));
ok('함정이 앞 버전보다 많음(6개 이상)', traps.length >= 6, `${traps.length}개`);

// ② 세이프룸(RE) — 함정이 없는 밝은 구역이 있어야 긴장-이완 대비가 생긴다.
const trapObjs = traps.map((x) => x.owner!);
const safeRoomFloor = objs.find((o) => o.name.includes('보관실 바닥'));
ok('세이프룸(보관실) 존재', !!safeRoomFloor);
if (safeRoomFloor) {
  const inSafe = trapObjs.some((t) =>
    Math.abs(t.position.x - safeRoomFloor.position.x) < safeRoomFloor.scale.x / 2
    && Math.abs(t.position.z - safeRoomFloor.position.z) < safeRoomFloor.scale.z / 2);
  ok('세이프룸에 함정 없음', !inSafe);
  const safeLight = objs.find((o) => o.light && Math.hypot(
    o.position.x - safeRoomFloor.position.x, o.position.z - safeRoomFloor.position.z) < 3);
  ok('세이프룸이 밝음(전용 조명)', !!safeLight, safeLight ? `${safeLight.name} ${safeLight.light!.intensity}` : '');
}
// 진행 게이트 — 중간 관문이 있어야 '탐색 → 진행'의 리듬이 생긴다(한 번에 다 열리면 단조롭다).
ok('중간 관문(2단계 게이트) 존재', actuatorEvents.length >= 2, `게이트 ${actuatorEvents.length}개`);
const gateConds = actuatorEvents.map((e) => Number(e.conditions?.[0]?.value ?? 0)).sort((a, b) => a - b);
ok('게이트 조건이 단계적으로 상승', gateConds.length >= 2 && gateConds[0] < gateConds[gateConds.length - 1],
  `keys ${gateConds.join(' → ')}`);

console.log('\n변수 · HUD');
const names = new Set((scene.variables ?? []).map((v) => v.name));
ok('변수 keys·battery·scared 정의', names.has('keys') && names.has('battery') && names.has('scared'));
ok('이벤트가 쓰는 변수가 전부 정의됨', allEvents.every((x) => {
  const used: string[] = [];
  if (x.e.action === 'set_variable') used.push(x.e.value.split('|')[0]);
  for (const c of x.e.conditions ?? []) used.push(c.variable);
  return used.every((n) => names.has(n));
}));
ok('HUD가 실존 변수에 바인딩', (scene.hudElements ?? []).every((h) => names.has(h.variable)), `${scene.hudElements?.length ?? 0}개`);

console.log('\n오브젝트 참조');
const TARGET_ACTIONS = new Set(['hide_object', 'show_object', 'toggle_object', 'focus_object', 'set_passable', 'set_solid', 'toggle_collision']);
ok('오브젝트를 가리키는 액션의 대상이 전부 실존',
  allEvents.filter((x) => TARGET_ACTIONS.has(x.e.action)).every((x) => byId.has(x.e.value)));

console.log('\n분위기 · 성능');
const env = scene.environment;
ok('안개 켜짐(exp)', env.fog?.enabled === true && env.fog?.mode === 'exp');
ok('태양 off · 환경광 낮음', env.lights.sunEnabled === false && env.lights.ambientIntensity <= 0.2);
ok('걷기 모드로 시작', env.disableWalk === false && env.defaultMode === 'play');
ok('시작 시점(startView) 지정', !!env.startView);
const lights = objs.filter((o) => o.light);
ok('라이트 8개 이하', lights.length <= 8, `${lights.length}개`);
ok('그림자 라이트 1개 이하', lights.filter((o) => o.light?.castShadow).length <= 1);
// ★ 의도적 변경(2026-07-24, 사용자 피드백 "퀄리티 낮다") — 이 템플릿만 예외적으로 후처리를 켠다.
//   비네트(가장자리 어둠)·블룸(빛 번짐)이 공포 룩의 절반이라 끄면 밝은 회색 박스로 보인다.
//   비싼 SSAO/DoF는 여전히 안 씀 — 켠 항목이 vignette/bloom/contrast/saturation뿐인지만 확인.
const EXPENSIVE_EFFECTS = ['ssao', 'dof'];
ok('비싼 후처리(SSAO·DoF) 미사용', !EXPENSIVE_EFFECTS.some((k) => (env.effects as Record<string, number> | undefined)?.[k]));
ok('공포 분위기용 후처리(vignette·bloom) 켜짐', (env.effects?.vignette ?? 0) > 0 && (env.effects?.bloom ?? 0) > 0);

console.log('\n스폰(시작 위치)');
// 미설정이면 PlayModeController가 [0,4,0](공중)에 떨어뜨려 건물 밖에서 시작한다 — 반드시 명시.
const sp = env.playerStartPosition;
ok('스폰 위치 명시됨', !!sp, sp ? `(${sp.x}, ${sp.y}, ${sp.z})` : '미설정 → 공중 기본값');
if (sp) {
  // 스폰이 로비 바닥 위인지 — 바닥판(plane)의 XZ 범위 안에 들어와야 낙사·바깥 시작이 없다.
  const insideAnyFloor = objs.filter((o) => o.primitiveShape === 'plane').some((f) =>
    Math.abs(sp.x - f.position.x) <= f.scale.x / 2 && Math.abs(sp.z - f.position.z) <= f.scale.z / 2);
  ok('스폰이 바닥 위(건물 안)', insideAnyFloor);
  ok('스폰 높이가 지면 근처(공중 낙하 아님)', sp.y > 0 && sp.y < 2.5, `y=${sp.y}`);
  // 벽 안에 끼여 시작하지 않는지 — 캐릭터를 반경 0.4·높이 1.8의 기둥으로 보고 3축 전부 겹치는지 본다.
  // (XZ만 보면 머리 위 천장까지 '충돌'로 잡힌다 — 실제로 그렇게 오탐했다.)
  const feet = 0, head = 1.8; // 스폰 y는 발밑 기준이 아니라 몸 중심이라 여유롭게 지면~머리로 본다
  const stuck = objs.filter((o) => o.physics?.enabled && !o.physics?.isSensor && o.primitiveShape === 'box').find((w) =>
    Math.abs(sp.x - w.position.x) < w.scale.x / 2 + 0.4
    && Math.abs(sp.z - w.position.z) < w.scale.z / 2 + 0.4
    && w.position.y - w.scale.y / 2 < head && w.position.y + w.scale.y / 2 > feet);
  ok('스폰이 벽·가구에 안 끼임', !stuck, stuck ? `충돌: ${stuck.name}` : '');
}

console.log('\n레벨 구조');
// 벽/천장은 그림자를 만들 필요가 없다(내부에서만 보임) — 켜면 그림자맵 낭비.
//   ★ 이름만으로 거르면 '격벽 문짝'(모터에 달린 문)·'지하 격벽'(모터 그룹)·'보관함 벽'(가구)·
//   '천장 배관'/'벽 얼룩'/'벽 낙서'(장식, 이름에 우연히 벽/천장이 들어감)까지 잡힌다.
//   구조 벽 = 루트 + 실제 메쉬 + 모터 아님 + 장식/가구 키워드 제외.
const walls = objs.filter((o) =>
  /벽|천장|상인방/.test(o.name) && !o.parentId && !!o.primitiveShape && !o.isActuator
  && !/배관|얼룩|낙서|보관함/.test(o.name));
ok('벽·천장은 그림자 생성 off', walls.every((o) => o.render?.castShadow === false), `${walls.length}개`);
ok('벽은 전부 솔리드(통과 불가)', walls.every((o) => o.physics?.enabled === true && !o.physics?.isSensor));
// 방마다 바닥이 있는지 — 바닥이 없으면 낙사한다.
const floors = objs.filter((o) => o.primitiveShape === 'plane');
ok('바닥 5개(로비·복도·병실A·병실B·제단실+통로)', floors.length >= 5, `${floors.length}개`);
// 열쇠가 서로 다른 구역에 흩어져 있는지(한곳에 몰리면 게임이 아니다)
const keyObjs = keyGains.map((x) => x.owner!);
const spread = Math.max(...keyObjs.map((o) => o.position.x)) - Math.min(...keyObjs.map((o) => o.position.x));
ok('열쇠가 서로 다른 구역에 분산', spread > 10, `X 분포 ${spread.toFixed(1)}m`);
// 시작 지점과 출구가 충분히 멀어야 게임이 된다
const win = allEvents.find((x) => x.e.action === 'game_win')!.owner!;
const dist = Math.hypot(win.position.x - (env.startView?.position.x ?? 0), win.position.z - (env.startView?.position.z ?? 0));
ok('시작 → 출구 거리 20m 이상', dist > 20, `${dist.toFixed(1)}m`);

console.log(`\n결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
