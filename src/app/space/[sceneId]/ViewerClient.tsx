'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { createBrowserSupabase } from '@/lib/supabase';
import { MobileControls } from './MobileControls';
import { RichContent } from '@/components/ui/RichContent';
import { PopupFrame } from '@/components/ui/PopupFrame';
import { effectiveDialogue } from './useObjectDialogue';
import { Heart, Star, Circle, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import type { ProjectSceneSchema, ObjectNodeSchema, EventSchema, EventCondition, HudElement, Vector3, GameVariable } from '@/types/scene';
import { sampleClip, type ClipSample } from '@/lib/animSample';

// 애니 클립 키프레임 보간(경첩 원호 포함)은 공용 lib로 추출 — 뷰어/에디터 미리보기 공유(ANIMATION.md).

// 이 액션들이 (플레이 모드에서) 발동되면 상호작용이 끝날 때까지(팝업 닫기/Esc) 캐릭터 이동을 잠근다.
// 새로 "발동 중엔 못 움직이게" 하고 싶은 액션이 생기면 여기에 추가만 하면 자동 적용된다.
const MOVEMENT_LOCKING_ACTIONS: ReadonlySet<EventSchema['action']> = new Set<EventSchema['action']>([
  'show_popup',
  'focus_object',
]);

// HUD 위젯(Phase 2) — 게임 변수를 텍스트/체력바/목숨 아이콘으로 화면 구석에 표시.
const HUD_POS_CLS: Record<HudElement['position'], string> = {
  'top-left': 'top-3 left-3 items-start',
  'top-center': 'top-3 left-1/2 -translate-x-1/2 items-center',
  'top-right': 'top-3 right-3 items-end',
  'bottom-left': 'bottom-3 left-3 items-start',
  'bottom-center': 'bottom-3 left-1/2 -translate-x-1/2 items-center',
  'bottom-right': 'bottom-3 right-3 items-end',
};
function HudWidget({ el, value }: { el: HudElement; value: number | boolean | string | undefined }) {
  const label = el.label || el.variable;
  const color = el.color || '#ef4444';
  const num = typeof value === 'number' ? value : 0;
  if (el.kind === 'bar') {
    const max = el.max && el.max > 0 ? el.max : 100;
    const pct = Math.max(0, Math.min(1, num / max)) * 100;
    return (
      <div className="w-40 bg-black/45 backdrop-blur-sm rounded-md px-2 py-1.5">
        <div className="flex justify-between text-white text-[11px] font-semibold mb-0.5"><span>{label}</span><span className="tabular-nums">{num}/{max}</span></div>
        <div className="h-2.5 rounded-full bg-black/50 overflow-hidden"><div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: color }} /></div>
      </div>
    );
  }
  if (el.kind === 'lives') {
    const max = el.max && el.max > 0 ? el.max : 3;
    const Icon = el.icon === 'star' ? Star : el.icon === 'circle' ? Circle : Heart;
    return (
      <div className="flex items-center gap-1 bg-black/45 backdrop-blur-sm rounded-full px-2.5 py-1">
        {label && <span className="text-white text-[11px] font-semibold mr-1">{label}</span>}
        {Array.from({ length: max }).map((_, i) => (
          <Icon key={i} size={15} style={{ color }} fill={i < num ? color : 'transparent'} opacity={i < num ? 1 : 0.3} />
        ))}
      </div>
    );
  }
  // text
  return (
    <div className="px-3 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-sm font-semibold tabular-nums">
      {label}: {String(value ?? 0)}
    </div>
  );
}
function HudWidgets({ elements, vars }: { elements: HudElement[]; vars: Record<string, number | boolean | string> }) {
  const positions = Array.from(new Set(elements.map((e) => e.position)));
  return (
    <>
      {positions.map((pos) => (
        <div key={pos} className={`absolute z-20 pointer-events-none flex flex-col gap-1.5 ${HUD_POS_CLS[pos]}`}>
          {elements.filter((e) => e.position === pos).map((el) => (
            <HudWidget key={el.id} el={el} value={vars[el.variable]} />
          ))}
        </div>
      ))}
    </>
  );
}

const ViewerCanvas = dynamic(
  () => import('./ViewerCanvas').then((m) => m.ViewerCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-sidebar">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-2xl mx-auto mb-3 animate-pulse">
            ⬡
          </div>
          <p className="text-muted text-sm">3D 공간 로딩 중...</p>
        </div>
      </div>
    ),
  },
);

interface Props {
  scene: ProjectSceneSchema;
  projectName?: string;
  isOwner?: boolean;
  projectId?: string;
  hideBadge?: boolean;
  /** 'standalone' = 독립 URL(/space) 풀 UI, 'embed' = 최소 UI + 부모 브릿지 */
  variant?: 'standalone' | 'embed';
  /** 임베드 브릿지 — show_popup/emit_event를 부모 페이지로 postMessage할 때 사용 */
  onBridge?: (msg: Record<string, unknown>) => void;
}

export function ViewerClient({ scene, projectName = '', isOwner = false, projectId = '', hideBadge = false, variant = 'standalone', onBridge }: Props) {
  const [popup, setPopup] = useState<{ title: string; content: string; config?: EventSchema['popup'] } | null>(null);
  // 둘러보기 전용 씬은 걷기(플레이) 불가 — 항상 탐색으로만 동작
  const walkDisabled = scene.environment.disableWalk === true;
  // 씬별 기본 진입 모드 — 'play'면 접속하자마자 플레이 모드로 시작 (미설정/둘러보기전용 = 탐색)
  const [playMode, setPlayMode] = useState(scene.environment.defaultMode === 'play' && !walkDisabled);
  // 플레이 모드에서 캐릭터가 근접한 interact 대상 (E 프롬프트 표시용). 탐색 모드에선 항상 null.
  const [interactTarget, setInteractTarget] = useState<{ id: string; name: string } | null>(null);
  const [crosshairHot, setCrosshairHot] = useState(false); // 중앙 조준점이 상호작용 대상 위 → 레티클 강조
  // 포인터 해제 — 드래그 중 Esc로 포인터 락을 풀면 커서를 돌려준다(브라우저 안내 "Esc를 눌러 커서 표시"와 동작 일치).
  //   해제 중엔 크로스헤어를 숨기고 조준 기준도 마우스 위치로 되돌린다. 캔버스를 다시 클릭하면 복귀.
  const [pointerFree, setPointerFree] = useState(false);
  const [cameraMode, setCameraMode] = useState<'third' | 'first' | 'topdown' | 'fixed'>('third'); // 카메라 모드(구역별/토글)
  const [cameraFixedId, setCameraFixedId] = useState<string | null>(null); // fixed 모드 대상 오브젝트
  // E키를 누를 때마다 증가 — 대화 열기/다음 문장(DialogueAdvanceContext로 3D 트리에 전달)
  const [dialogueNonce, setDialogueNonce] = useState(0);
  // 손전등 on/off — 입력은 PlayModeController(T키)가 담당, 여기선 통지만 받아 안개(ViewerCanvas)·배터리 소모(아래)에 쓴다.
  const [flashlightOn, setFlashlightOn] = useState(false);

  // 런타임 오브젝트 표시/숨김 오버라이드 (show/hide/toggle_object 액션) — objectId → visible
  const [visOverride, setVisOverride] = useState<Record<string, boolean>>({});
  // 런타임 콜라이더 통과 오버라이드 (set_passable/set_solid/toggle_collision — 문 열기/닫기) — objectId → passable
  //   true면 플레이 모드에서 콜라이더 제거(시각은 유지, 통과 가능). PlayCanvas로 id Set 전달.
  const [passOverride, setPassOverride] = useState<Record<string, boolean>>({});
  // 런타임 모델 교체 오버라이드 (swap_model — 변수/에셋으로 오브젝트 모델 바꾸기) — objectId → assetId. 변수 Phase C.
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  // 애니 클립 재생 오버라이드 (play_clip) — objectId → {position?,rotation?,scale?}. ANIMATION.md. 비파괴(rest 트랜스폼 위에 얹음).
  const [clipOverride, setClipOverride] = useState<Record<string, ClipSample>>({});
  const playingClips = useRef<Map<string, number>>(new Map()); // clipId → 시작시각(performance.now)
  const clipRaf = useRef<number | null>(null);
  const animClipsRef = useRef(scene.animClips); animClipsRef.current = scene.animClips; // 최신 클립(스테일 클로저 방지)
  const tickClips = useCallback(() => {
    const now = performance.now();
    const clips = animClipsRef.current ?? [];
    const ov: Record<string, ClipSample> = {};
    for (const [clipId, startedAt] of Array.from(playingClips.current.entries())) {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) { playingClips.current.delete(clipId); continue; }
      let t = (now - startedAt) / 1000;
      if (clip.loop) { t = clip.duration > 0 ? t % clip.duration : 0; }
      else if (t >= clip.duration) { t = clip.duration; playingClips.current.delete(clipId); } // 끝나면 마지막 포즈 유지
      const samples = sampleClip(clip, t); // 경첩 원호 포함 — 공용 lib
      for (const id in samples) ov[id] = { ...ov[id], ...samples[id] };
    }
    setClipOverride((prev) => ({ ...prev, ...ov })); // 병합 — 끝난 클립의 마지막 포즈 유지
    clipRaf.current = playingClips.current.size > 0 ? requestAnimationFrame(tickClips) : null;
  }, []);
  useEffect(() => () => { if (clipRaf.current != null) cancelAnimationFrame(clipRaf.current); }, []); // 언마운트 정리
  const passableIds = useMemo(() => {
    const s = new Set<string>();
    for (const id in passOverride) if (passOverride[id]) s.add(id);
    return s;
  }, [passOverride]);
  // 카메라 요청 — id가 objectId면 그 오브젝트로 포커스, null이면 초기(홈) 시점으로 복귀
  const [focusRequest, setFocusRequest] = useState<{ id: string | null; t: number } | null>(null);
  const resetCamera = () => setFocusRequest({ id: null, t: Date.now() });
  // 플레이 모드 카메라 포커스 대상 — focus_object가 플레이에서 발동되면 그 오브젝트로 줌(팔로우 대체).
  const [playFocus, setPlayFocus] = useState<{ id: string } | null>(null);
  // 상호작용 진행 중 플래그 — true면 캐릭터 이동 잠금. MOVEMENT_LOCKING_ACTIONS 발동 시 켜짐.
  const [interactionLock, setInteractionLock] = useState(false);
  // 상호작용 종료 — 팝업 닫기·카메라 포커스 복귀·이동 잠금 해제를 한 번에 (팝업 닫기 버튼/Esc가 호출)
  const endInteraction = () => { setPopup(null); setPlayFocus(null); setInteractionLock(false); };
  // Esc로 상호작용 종료 (팝업 없는 포커스 단독일 때도 빠져나올 수 있게)
  useEffect(() => {
    if (!interactionLock) return;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') endInteraction(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [interactionLock]);
  // Esc로 조준(크로스헤어) 모드 해제 → 커서 복귀. 브라우저 포인터 락 안내("Esc를 눌러 커서 표시")와 동작 일치.
  //   ※ 포인터 락이 걸린 동안엔 브라우저가 Esc를 가로채 keydown이 안 올 수 있다 → 그 경우는
  //     PlayModeController의 pointerlockchange 경로가 처리한다(두 경로가 서로를 보완).
  //   상호작용 중(팝업/포커스)엔 위 핸들러가 Esc를 먼저 쓰므로 여기선 빠진다(팝업 닫기가 우선).
  useEffect(() => {
    // (터치 기기는 Esc 키가 없어 조건에서 뺐다 — isTouch는 아래에서 선언된다.)
    if (!playMode || interactionLock || pointerFree) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      setPointerFree(true);
      if (document.pointerLockElement) document.exitPointerLock?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playMode, interactionLock, pointerFree]);
  // 모드를 벗어나면 조준 모드 상태 초기화(플레이로 다시 들어올 때 커서가 풀린 채 시작하지 않게).
  useEffect(() => { if (!playMode) setPointerFree(false); }, [playMode]);

  // animate_object 액션용 런타임 클립 요청 (objectId → {name, t})
  const [clipRequests, setClipRequests] = useState<Record<string, { name: string; t: number }>>({});

  // ── move_object 액션 — 런타임 위치 오버라이드 (objectId → 현재 렌더 위치) ──
  // visOverride와 같은 방식으로 씬 데이터에 주입해 렌더한다. 모든 뷰어 경로(탐색·인스턴스드·
  // 플레이 RigidBody)가 object.position을 존중하고, rapier RigidBody는 position prop 변경 시
  // setTranslation으로 텔레포트하므로 플레이 모드에선 콜라이더도 함께 이동한다.
  const [posOverride, setPosOverride] = useState<Record<string, Vector3>>({});
  // 진행 중인 이동 애니메이션 — 단일 rAF 루프가 모든 대상을 이징(easeInOutQuad) 갱신
  const moveAnims = useRef<Map<string, { from: Vector3; to: Vector3; start: number; dur: number }>>(new Map());
  const moveRaf = useRef<number | null>(null);
  // 마지막으로 렌더된 위치(애니메이션 도중 재트리거 시 현재 위치에서 이어가기 위함)
  const posCurrent = useRef<Record<string, Vector3>>({});

  const startMove = (targetId: string, to: Vector3, dur: number) => {
    const base = scene.objects.find((o) => o.id === targetId)?.position;
    if (!base) return;
    const from = posCurrent.current[targetId] ?? base;
    moveAnims.current.set(targetId, { from: { ...from }, to, start: performance.now(), dur });
    if (moveRaf.current !== null) return; // 루프가 이미 돌고 있음
    const tick = (now: number) => {
      const next = { ...posCurrent.current };
      moveAnims.current.forEach((a, id) => {
        const t = a.dur <= 0 ? 1 : Math.min(1, (now - a.start) / (a.dur * 1000));
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        next[id] = {
          x: a.from.x + (a.to.x - a.from.x) * e,
          y: a.from.y + (a.to.y - a.from.y) * e,
          z: a.from.z + (a.to.z - a.from.z) * e,
        };
        if (t >= 1) moveAnims.current.delete(id);
      });
      posCurrent.current = next;
      setPosOverride(next);
      moveRaf.current = moveAnims.current.size > 0 ? requestAnimationFrame(tick) : null;
    };
    moveRaf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => {
    if (moveRaf.current !== null) cancelAnimationFrame(moveRaf.current);
  }, []);

  // ── play_sound 액션 — URL별 오디오 엘리먼트 재사용 (반복 트리거 시 무한 생성 방지) ──
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playSound = (url: string) => {
    let el = audioCache.current.get(url);
    if (!el) {
      el = new Audio(url);
      audioCache.current.set(url, el);
    }
    el.currentTime = 0;
    // area 트리거는 사용자 제스처가 아니라 자동재생 정책에 막힐 수 있다 — 조용히 무시
    el.play().catch(() => {});
  };
  useEffect(() => {
    const cache = audioCache.current;
    return () => {
      cache.forEach((el) => { el.pause(); el.src = ''; });
      cache.clear();
    };
  }, []);

  // ── 게임 변수(상태) 런타임 — GAME_LOGIC.md Phase 1 ──
  // varsRef: 권위값(동기 읽기/쓰기). hudVars: 화면 HUD 재렌더용 미러. watcherState: variable_changed 엣지 감지.
  const varsRef = useRef<Record<string, number | boolean | string>>({});
  const [hudVars, setHudVars] = useState<Record<string, number | boolean | string>>({});
  // 액추에이터 구동 목표(objectId→0..1) — variable(변수값)·event(set_actuator) 구동. ViewerObject가 이징. doc §6.
  const [actuatorDrive, setActuatorDrive] = useState<Record<string, number>>({});
  const watcherState = useRef<Record<string, boolean>>({}); // eventId → 직전 조건 평가값
  const evalDepth = useRef(0); // variable_changed 반응형 재진입 가드
  // Phase 2 — 런타임 스폰/디스폰·승패·재시작 상태
  const [spawned, setSpawned] = useState<ObjectNodeSchema[]>([]);          // spawn_object로 생성된 오브젝트
  const [despawnedIds, setDespawnedIds] = useState<Set<string>>(new Set()); // despawn_object로 제거된 id
  const [gameResult, setGameResult] = useState<{ kind: 'win' | 'lose'; message: string } | null>(null);
  const [runNonce, setRunNonce] = useState(0); // 재시작 시 bump → 변수/타이머/scene_start 초기화
  // Phase E — 변수 지속 범위. global=세션(씬 이동해도 유지), persistent=로컬(브라우저 저장). scene=저장 안 함.
  const scopeStore = (scope?: string): Storage | null => {
    if (typeof window === 'undefined') return null;
    if (scope === 'global') return window.sessionStorage;
    if (scope === 'persistent') return window.localStorage;
    return null;
  };
  const varStoreKey = (name: string) => `p3v:${projectId}:${name}`;
  const readScopedInitial = (v: GameVariable): number | boolean | string => {
    const st = scopeStore(v.scope);
    if (st) {
      const raw = st.getItem(varStoreKey(v.name));
      if (raw != null) { try { return JSON.parse(raw); } catch { /* 손상 시 initial */ } }
    }
    return v.initial;
  };
  const persistScoped = () => {
    for (const v of scene.variables ?? []) {
      const st = scopeStore(v.scope);
      if (st) { try { st.setItem(varStoreKey(v.name), JSON.stringify(varsRef.current[v.name])); } catch { /* 용량 초과 무시 */ } }
    }
  };

  // 씬 로드/변수 정의 변경/재시작 시 초기화. scene=initial / global·persistent=저장값(없으면 initial).
  useEffect(() => {
    const init: Record<string, number | boolean | string> = {};
    for (const v of scene.variables ?? []) init[v.name] = readScopedInitial(v);
    varsRef.current = init;
    watcherState.current = {};
    setHudVars(init);
    syncVarActuators(); // variable 구동 관절 초기값 반영
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.variables, runNonce]);

  // Phase D — timer 변수 자동 카운트다운(1초마다 -1, 0에서 멈춤). 게임오버 시 정지, 재시작 시 재설정.
  useEffect(() => {
    const timerVars = (scene.variables ?? []).filter((v) => v.type === 'timer');
    if (timerVars.length === 0) return;
    const iv = window.setInterval(() => {
      if (gameResultRef.current) return;
      let changed = false;
      for (const v of timerVars) {
        const cur = varsRef.current[v.name];
        if (typeof cur === 'number' && cur > 0) { varsRef.current[v.name] = Math.max(0, cur - 1); changed = true; }
      }
      if (changed) onVarsChanged();
    }, 1000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.variables, runNonce]);

  // 손전등 배터리 — **켜져 있는 동안에만** 초당 drainPerSec 소모(꺼져 있으면 소모 없음).
  //   기존 on_timer 상시소모와 다른 지점: 배터리는 "존재 비용"이 아니라 "사용 비용" — 손전등을 안 켜면 안 준다.
  //   0이 되면 여기선 그냥 0에서 멈추고, 실제 게임오버는 씬의 variable_changed(battery<=0) 이벤트가 담당(일반화 유지).
  useEffect(() => {
    const fl = scene.environment.flashlight;
    const varName = fl?.batteryVariable;
    if (!fl?.enabled || !varName || !flashlightOn) return;
    const rate = fl.drainPerSec ?? 1 / 6;
    const iv = window.setInterval(() => {
      if (gameResultRef.current) return;
      const cur = varsRef.current[varName];
      if (typeof cur === 'number' && cur > 0) {
        varsRef.current[varName] = Math.max(0, cur - rate);
        onVarsChanged();
      }
    }, 1000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashlightOn, scene.environment.flashlight, runNonce]);

  // 오버라이드를 씬 데이터에 반영해 렌더 (모든 뷰어 경로가 object.visible을 존중하므로 이걸로 충분)
  //   + 공용 재질 에셋(materialId) 리졸브 → ViewerObject는 object.material만 읽으므로 여기서 미리 주입.
  //   + 런타임 스폰 오브젝트 병합 + 디스폰 필터(Phase 2).
  const effectiveScene = useMemo(() => {
    const matAssets = scene.materialAssets;
    const hasMatRefs = !!matAssets && matAssets.length > 0 && scene.objects.some((o) => o.materialId);
    const hasSpawn = spawned.length > 0 || despawnedIds.size > 0;
    const hasModel = Object.keys(modelOverride).length > 0;
    const hasClip = Object.keys(clipOverride).length > 0;
    if (Object.keys(visOverride).length === 0 && Object.keys(posOverride).length === 0 && !hasMatRefs && !hasSpawn && !hasModel && !hasClip) return scene;
    const all = spawned.length > 0 ? [...scene.objects, ...spawned] : scene.objects;
    return {
      ...scene,
      objects: all
        .filter((o) => !despawnedIds.has(o.id))
        .map((o) => {
          const vis = o.id in visOverride ? visOverride[o.id] : o.visible;
          const co = clipOverride[o.id]; // 애니 클립 재생 중 트랜스폼(있는 속성만 덮음)
          const pos = co?.position ?? posOverride[o.id] ?? o.position;
          const rot = co?.rotation ?? o.rotation;
          const scl = co?.scale ?? o.scale;
          const resolvedMat = hasMatRefs && o.materialId ? matAssets!.find((m) => m.id === o.materialId)?.material : undefined;
          const swapAsset = modelOverride[o.id]; // swap_model로 바뀐 모델 에셋 id
          if (vis === o.visible && pos === o.position && rot === o.rotation && scl === o.scale && !resolvedMat && !swapAsset) return o;
          return { ...o, visible: vis, position: pos, rotation: rot, scale: scl, ...(resolvedMat ? { material: resolvedMat } : {}), ...(swapAsset ? { assetId: swapAsset } : {}) };
        }),
    };
  }, [scene, visOverride, posOverride, spawned, despawnedIds, modelOverride, clipOverride]);
  // move_object로 이동 중인 오브젝트 id 집합 — PlayCanvas가 그룹을 kinematic 강체로 라우팅(콜라이더 동반).
  const movedIds = useMemo(() => new Set(Object.keys(posOverride)), [posOverride]);

  // 타이머/scene_start가 게임오버 후에도 발동하지 않도록 최신 결과를 ref로 보관(Phase 2).
  const gameResultRef = useRef<typeof gameResult>(null);
  gameResultRef.current = gameResult;

  // 게임 컨트롤러(전역 로직) — 씬 이벤트(sceneEvents)는 오브젝트가 없어 합성 self로 실행. GAME_LOGIC.md 게임 컨트롤러 Phase 1.
  const sceneControllerObj = useRef<ObjectNodeSchema>({
    id: '__scene__', name: 'Scene', parentId: null, visible: true, locked: false, layer: 0,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    events: [],
  } as unknown as ObjectNodeSchema).current;

  // scene_start — 뷰어 로드/재시작 시 1회 발동. 원본 오브젝트만(스폰 클론 제외 → 무한 스폰 방지) + 씬 전역 규칙.
  useEffect(() => {
    for (const o of scene.objects) {
      for (const ev of o.events) {
        if (ev.trigger !== 'scene_start') continue;
        if (evalGate(ev)) runEventAction(o, ev, 'scene_start');
        else if (ev.elseAction) runElseAction(o, ev, 'scene_start');
      }
    }
    for (const ev of scene.sceneEvents ?? []) {
      if (ev.trigger !== 'scene_start') continue;
      if (evalGate(ev)) runEventAction(sceneControllerObj, ev, 'scene_start');
      else if (ev.elseAction) runElseAction(sceneControllerObj, ev, 'scene_start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, runNonce]);

  // on_timer — everySec 간격 반복(once면 그 시간 뒤 1회). 원본 오브젝트만. 게임오버 시 발동 중지.
  useEffect(() => {
    const ids: number[] = [];
    const setupTimer = (host: ObjectNodeSchema, ev: EventSchema) => {
      if (ev.trigger === 'on_timer' && ev.timer && ev.timer.everySec > 0) {
        const ms = ev.timer.everySec * 1000;
        const fire = () => {
          if (gameResultRef.current) return;
          if (evalGate(ev)) runEventAction(host, ev, 'on_timer');
          else if (ev.elseAction) runElseAction(host, ev, 'on_timer');
        };
        ids.push(ev.timer.once ? window.setTimeout(fire, ms) : window.setInterval(fire, ms));
      }
    };
    for (const o of scene.objects) for (const ev of o.events) setupTimer(o, ev);
    for (const ev of scene.sceneEvents ?? []) setupTimer(sceneControllerObj, ev); // 씬 전역 타이머
    return () => { ids.forEach((id) => { window.clearInterval(id); window.clearTimeout(id); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, runNonce]);

  const [isTouch, setIsTouch] = useState(false);
  const supabase = useState(() => createBrowserSupabase())[0];
  const mobileInputRef = useRef({ fwd: 0, strafe: 0, jump: false });

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // 모드 전환 시 근접 프롬프트 + 진행 중 상호작용(포커스/잠금) 정리 — 잠금이 다음 모드로 새는 것 방지
  useEffect(() => {
    if (!playMode) { setInteractTarget(null); setCrosshairHot(false); setCameraMode('third'); setCameraFixedId(null); }
    setPlayFocus(null);
    setInteractionLock(false);
  }, [playMode]);

  // 방문 이벤트 수집
  useEffect(() => {
    supabase.from('scene_events').insert({ scene_id: scene.sceneId, event_type: 'view' });
  }, [scene.sceneId, supabase]);

  const trackEvent = (eventType: string, objectId?: string, objectName?: string) => {
    supabase.from('scene_events').insert({
      scene_id: scene.sceneId,
      event_type: eventType,
      object_id: objectId,
      object_name: objectName,
    });
  };

  // ── 게임 변수 조건/연산 (GAME_LOGIC.md Phase 1) ──
  function evalCondition(cond: EventCondition): boolean {
    const cur = varsRef.current[cond.variable];
    if (cur === undefined) return false; // 미정의 변수 조건은 거짓
    const target = cond.value;
    switch (cond.op) {
      // ==/!=는 문자열(string/enum/color)·숫자·불리언 공통. 타입 느슨 비교(에디터 값이 문자열일 수 있어 String 정규화).
      case '==': return String(cur) === String(target);
      case '!=': return String(cur) !== String(target);
      case '>': return Number(cur) > Number(target);
      case '>=': return Number(cur) >= Number(target);
      case '<': return Number(cur) < Number(target);
      case '<=': return Number(cur) <= Number(target);
      case 'contains': return String(cur).includes(String(target)); // 문자열 포함
      default: return false;
    }
  }
  // 이벤트 조건 게이트 — conditions[](다중, AND/OR) 우선, 없으면 condition(단일 레거시). 조건 없으면 true.
  function evalGate(ev: EventSchema): boolean {
    const list = ev.conditions && ev.conditions.length > 0 ? ev.conditions : (ev.condition ? [ev.condition] : []);
    if (list.length === 0) return true;
    // 혼합 AND/OR — 왼쪽→오른쪽 순차 평가. 각 조건의 logic(직전과의 연결어), 없으면 레거시 전역 conditionLogic → 'and'.
    let acc = evalCondition(list[0]);
    for (let i = 1; i < list.length; i++) {
      const connector = list[i].logic ?? ev.conditionLogic ?? 'and';
      const cur = evalCondition(list[i]);
      acc = connector === 'or' ? (acc || cur) : (acc && cur);
    }
    return acc;
  }
  // 값(리터럴 숫자) 또는 다른 변수명을 숫자로 해석 — 변수↔변수 연산 지원(Phase B).
  function resolveNum(raw: string): number {
    const n = Number(raw);
    if (Number.isFinite(n) && raw.trim() !== '') return n;
    const other = varsRef.current[raw];
    if (typeof other === 'number') return other;
    if (typeof other === 'boolean') return other ? 1 : 0;
    return 0;
  }
  function applyVarOp(name: string, op: string, amountRaw: string) {
    const cur = varsRef.current[name];
    if (cur === undefined) return; // 정의되지 않은 변수는 무시
    // 문자열/enum/color — set(교체) / append(이어붙이기) / next(enum 다음 상태)
    if (typeof cur === 'string') {
      if (op === 'append') { varsRef.current[name] = cur + amountRaw; return; }
      if (op === 'next') {
        const opts = scene.variables?.find((v) => v.name === name)?.options;
        if (opts && opts.length) { const i = opts.indexOf(cur); varsRef.current[name] = opts[(i + 1) % opts.length]; }
        return;
      }
      varsRef.current[name] = amountRaw; // set
      return;
    }
    if (typeof cur === 'boolean') {
      if (op === 'toggle') varsRef.current[name] = !cur;
      else if (op === 'set') varsRef.current[name] = amountRaw === 'true' || amountRaw === '1';
      return;
    }
    if (op === 'random') {
      // amountRaw = "min,max" — [min,max] 정수 랜덤(주사위 등)
      const [lo, hi] = amountRaw.split(',').map(Number);
      const min = Number.isFinite(lo) ? lo : 0;
      const max = Number.isFinite(hi) ? hi : min;
      varsRef.current[name] = Math.floor(Math.min(min, max) + Math.random() * (Math.abs(max - min) + 1));
      return;
    }
    if (op === 'clamp') {
      // amountRaw = "min,max" — 현재값을 [min,max]로 제한(체력/골드 등)
      const [loR, hiR] = amountRaw.split(',');
      const lo = resolveNum(loR ?? ''); const hi = resolveNum(hiR ?? '');
      varsRef.current[name] = Math.max(lo, Math.min(hi, cur));
      return;
    }
    const a = resolveNum(amountRaw); // 리터럴 또는 변수 참조
    switch (op) {
      case 'set': varsRef.current[name] = a; break;
      case 'add': varsRef.current[name] = cur + a; break;
      case 'sub': varsRef.current[name] = cur - a; break;
      case 'mul': varsRef.current[name] = cur * a; break;
      case 'div': varsRef.current[name] = a !== 0 ? cur / a : cur; break;
      case 'mod': varsRef.current[name] = a !== 0 ? cur % a : cur; break;
      default: break; // toggle은 숫자에 무의미
    }
  }
  // else 분기용 — 조건 거짓일 때 대신 실행할 액션을 합성 이벤트로 돌린다.
  function runElseAction(obj: ObjectNodeSchema, ev: EventSchema, trigger: EventSchema['trigger']) {
    if (!ev.elseAction) return;
    runEventAction(obj, { ...ev, action: ev.elseAction, value: ev.elseValue ?? '' }, trigger);
  }
  // 변수 변경 후: HUD 갱신 + variable_changed 워처 재평가(엣지에서만 발동, 재진입 가드).
  //   then=false→true 엣지 / elseAction=true→false 엣지.
  function evaluateWatchers() {
    if (evalDepth.current > 16) return;
    evalDepth.current += 1;
    try {
      const runWatcher = (host: ObjectNodeSchema, ev: EventSchema) => {
        if (ev.trigger !== 'variable_changed') return;
        const pass = evalGate(ev);
        const prev = watcherState.current[ev.id] ?? false;
        watcherState.current[ev.id] = pass;
        if (pass && !prev) runEventAction(host, ev, 'variable_changed');
        else if (!pass && prev && ev.elseAction) runElseAction(host, ev, 'variable_changed');
      };
      for (const o of effectiveScene.objects) for (const ev of o.events) runWatcher(o, ev);
      for (const ev of scene.sceneEvents ?? []) runWatcher(sceneControllerObj, ev); // 씬 전역 규칙
    } finally {
      evalDepth.current -= 1;
    }
  }
  // variable 구동 액추에이터 — 바인딩 변수값(0..1로 clamp)을 구동 목표로 반영. event 목표는 보존(머지).
  function syncVarActuators() {
    const upd: Record<string, number> = {};
    for (const o of scene.objects) {
      const a = o.actuator;
      if (a?.drive === 'variable' && a.variable) {
        const raw = varsRef.current[a.variable];
        const n = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
        const v = Number.isFinite(n) ? n : 0;
        // 범위 매핑: [varMin, varMax] → [0, 1] (기본 0..1). 역방향(varMin>varMax)도 허용.
        const lo = a.varMin ?? 0, hi = a.varMax ?? 1;
        const t = hi === lo ? 0 : (v - lo) / (hi - lo);
        upd[o.id] = Math.max(0, Math.min(1, t));
      }
    }
    if (Object.keys(upd).length) setActuatorDrive((m) => ({ ...m, ...upd }));
  }
  function onVarsChanged() {
    setHudVars({ ...varsRef.current });
    persistScoped(); // global/persistent 변수는 저장(씬 이동·재방문 유지)
    syncVarActuators(); // variable 구동 관절 반영
    evaluateWatchers();
  }

  // 게임 재시작 — 변수 initial 복구 + 스폰/오버라이드/결과 초기화 + scene_start·타이머 재실행(Phase 2).
  function restartGame() {
    setSpawned([]);
    setDespawnedIds(new Set());
    setVisOverride({});
    setPassOverride({});
    setPosOverride({});
    setModelOverride({});
    setClipOverride({});
    playingClips.current.clear();
    if (clipRaf.current != null) { cancelAnimationFrame(clipRaf.current); clipRaf.current = null; }
    posCurrent.current = {};
    moveAnims.current.clear();
    setGameResult(null);
    setInteractionLock(false);
    setActuatorDrive({}); // 관절 구동 목표 초기화(variable은 변수 재초기화 시 재동기)
    setFlashlightOn(false); // 손전등도 꺼둔다(PlayModeController가 respawnNonce로 자체 리셋+통지하지만 이중 안전)
    // Phase E — 재시작 시 global(세션) 변수도 initial로(세션 저장 제거). persistent(최고점수 등)는 유지.
    for (const v of scene.variables ?? []) {
      if (v.scope === 'global') { try { window.sessionStorage.removeItem(varStoreKey(v.name)); } catch { /* ignore */ } }
    }
    setRunNonce((n) => n + 1);
  }

  // 커스텀 스크립트 실행(Phase 3) — 제작자가 작성한 JS. api로 안전한 헬퍼만 노출(window 직접 노출 안 함).
  //   주의: 제작자 자신의 코드가 뷰어에서 실행됨(자기 사이트에 스크립트 넣는 것과 동일 수준). 진짜 샌드박스는 후속.
  function runScript(code: string, self: ObjectNodeSchema) {
    const api = {
      get: (name: string) => varsRef.current[name],
      set: (name: string, val: number | boolean | string) => { if (name in varsRef.current) { varsRef.current[name] = val; onVarsChanged(); } },
      add: (name: string, delta: number) => { const c = varsRef.current[name]; if (typeof c === 'number') { varsRef.current[name] = c + Number(delta); onVarsChanged(); } },
      show: (id: string) => setVisOverride((v) => ({ ...v, [id]: true })),
      hide: (id: string) => setVisOverride((v) => ({ ...v, [id]: false })),
      despawn: (id?: string) => setDespawnedIds((s) => { const n = new Set(s); n.add(id ?? self.id); return n; }),
      popup: (content: string, title?: string) => setPopup({ title: title ?? self.name, content }),
      sound: (url: string) => playSound(url),
      win: (msg?: string) => setGameResult({ kind: 'win', message: msg ?? '승리!' }),
      lose: (msg?: string) => setGameResult({ kind: 'lose', message: msg ?? '게임 오버' }),
      log: (...args: unknown[]) => console.log('[script]', ...args),
    };
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('api', 'self', code);
      fn(api, self);
    } catch (e) {
      console.warn('[run_script] 실행 오류:', e);
    }
  }

  // 단일 이벤트의 액션 실행(조건 게이트 통과 후 호출). variable_changed 워처도 이 함수를 재사용.
  function runEventAction(obj: ObjectNodeSchema, ev: EventSchema, trigger: EventSchema['trigger']) {
      if (ev.action === 'open_url' && ev.value) {
        // area_enter는 사용자 제스처가 아닌 물리 콜백이라 브라우저가 window.open을
        // 차단할 수 있다 — 차단되면 링크가 담긴 팝업으로 폴백
        const opened = window.open(ev.value, '_blank', 'noopener noreferrer');
        if (!opened) setPopup({ title: obj.name, content: ev.value });
      } else if (ev.action === 'show_popup') {
        // 팝업은 뷰어(임베드 포함) 안에 직접 렌더 — 플레이어가 바로 본다.
        setPopup({ title: ev.popup?.title?.trim() || obj.name, content: ev.value, config: ev.popup });
        // iframe이면 부모에도 통지(호스트가 자체 UI로 처리하고 싶을 때 선택적으로 구독).
        if (onBridge && window.parent !== window) {
          onBridge({ type: 'park3d:popup', sceneId: scene.sceneId, objectId: obj.id, objectName: obj.name, value: ev.value });
        }
      } else if (ev.action === 'go_to_scene' && ev.value) {
        // 현재 경로의 씬 id를 대상 id로 치환해 이동 → /space·/embed·커스텀도메인 모두 대응.
        // (경로에 현재 씬 id가 없으면 독립 URL 기준으로 폴백)
        const path = window.location.pathname;
        const target = path.includes(scene.sceneId) ? path.replace(scene.sceneId, ev.value) : `/space/${ev.value}`;
        window.location.href = target + window.location.search;
      } else if (ev.action === 'show_object' && ev.value) {
        setVisOverride((v) => ({ ...v, [ev.value]: true }));
      } else if (ev.action === 'hide_object' && ev.value) {
        setVisOverride((v) => ({ ...v, [ev.value]: false }));
      } else if (ev.action === 'toggle_object' && ev.value) {
        setVisOverride((v) => {
          // 현재 표시 상태 = 오버라이드가 있으면 그 값, 없으면 원본 씬의 visible
          const cur = ev.value in v ? v[ev.value] : (scene.objects.find((o) => o.id === ev.value)?.visible ?? true);
          return { ...v, [ev.value]: !cur };
        });
      } else if (ev.action === 'focus_object' && ev.value) {
        // 탐색 모드: OrbitControls 카메라를 대상으로 이동. 플레이 모드: 팔로우 대신 대상 줌(playFocus).
        if (playMode) setPlayFocus({ id: ev.value });
        else setFocusRequest({ id: ev.value, t: Date.now() });
      } else if (ev.action === 'reset_camera') {
        // 카메라를 초기 시점으로 복귀 (탐색 모드)
        resetCamera();
      } else if (ev.action === 'animate_object' && ev.value) {
        // value = "대상objectId|클립이름" → 대상 오브젝트에 클립 재생 요청
        const sep = ev.value.indexOf('|');
        const targetId = sep >= 0 ? ev.value.slice(0, sep) : ev.value;
        const clip = sep >= 0 ? ev.value.slice(sep + 1) : '';
        if (targetId && clip) setClipRequests((m) => ({ ...m, [targetId]: { name: clip, t: Date.now() } }));
      } else if (ev.action === 'play_animation' && ev.value) {
        // 자기 자신 클립 재생 — 모든 트리거에서 동작하도록 clipRequests(→ ViewerObject externalClip)로 라우팅.
        // 핵심: interact(E)에서도 재생돼 "근접 하이라이트+E프롬프트"와 애니메이션이 같은 상호작용에 묶인다.
        // click/hover는 ViewerObject internalClip, area는 PhysicsObject activeClip 경로와 중복되나 같은 클립이라 무해.
        setClipRequests((m) => ({ ...m, [obj.id]: { name: ev.value, t: Date.now() } }));
      } else if (ev.action === 'move_object' && ev.value) {
        // value = "대상objectId|dx,dy,dz|초" — 원래 저장 위치 기준 오프셋으로 부드럽게 이동
        const [targetId, offsetStr, durStr] = ev.value.split('|');
        const base = scene.objects.find((o) => o.id === targetId)?.position;
        if (base) {
          const [dx, dy, dz] = (offsetStr ?? '').split(',').map((s) => parseFloat(s));
          const dur = parseFloat(durStr ?? '');
          startMove(targetId, {
            x: base.x + (Number.isFinite(dx) ? dx : 0),
            y: base.y + (Number.isFinite(dy) ? dy : 0),
            z: base.z + (Number.isFinite(dz) ? dz : 0),
          }, Number.isFinite(dur) ? Math.max(0, dur) : 1);
        }
      } else if (ev.action === 'set_passable' && ev.value) {
        setPassOverride((p) => ({ ...p, [ev.value]: true }));
      } else if (ev.action === 'set_solid' && ev.value) {
        setPassOverride((p) => ({ ...p, [ev.value]: false }));
      } else if (ev.action === 'toggle_collision' && ev.value) {
        setPassOverride((p) => ({ ...p, [ev.value]: !p[ev.value] }));
      } else if (ev.action === 'play_sound' && ev.value) {
        playSound(ev.value);
      } else if (ev.action === 'set_variable' && ev.value) {
        // value = "변수명|연산|값"  (연산: set/add/sub/mul/toggle)
        const [vname, op, amount] = ev.value.split('|');
        applyVarOp(vname, op ?? 'set', amount ?? '');
        onVarsChanged();
      } else if (ev.action === 'spawn_object' && ev.value) {
        // value = "템플릿objectId|dx,dy,dz" — 템플릿을 복제 생성(원본 위치 + 오프셋). Phase 2.
        // value = "템플릿id|dx,dy,dz|모델소스?"  모델소스(선택): '@변수'(asset 변수) 또는 에셋 id → 스폰 모델 교체. 변수 Phase C.
        const [templateId, offStr, modelSrc = ''] = ev.value.split('|');
        const tmpl = scene.objects.find((o) => o.id === templateId);
        if (tmpl) {
          const [dx, dy, dz] = (offStr ?? '').split(',').map((s) => parseFloat(s));
          const swapAssetId = modelSrc.startsWith('@') ? String(varsRef.current[modelSrc.slice(1)] ?? '') : modelSrc;
          const clone: ObjectNodeSchema = {
            ...(structuredClone(tmpl) as ObjectNodeSchema),
            id: (crypto.randomUUID?.() ?? `spawn_${Date.now()}_${Math.random().toString(36).slice(2)}`),
            visible: true,
            parentId: null,
            ...(swapAssetId ? { assetId: swapAssetId } : {}),
            position: {
              x: tmpl.position.x + (Number.isFinite(dx) ? dx : 0),
              y: tmpl.position.y + (Number.isFinite(dy) ? dy : 0),
              z: tmpl.position.z + (Number.isFinite(dz) ? dz : 0),
            },
          };
          setSpawned((s) => [...s, clone]);
        }
      } else if (ev.action === 'swap_model' && ev.value) {
        // value = "대상objectId|소스"  소스: '@변수명'(asset 변수의 값) 또는 에셋 id 직접. 변수 Phase C.
        const [targetId, source = ''] = ev.value.split('|');
        const assetId = source.startsWith('@') ? String(varsRef.current[source.slice(1)] ?? '') : source;
        if (targetId && assetId) setModelOverride((m) => ({ ...m, [targetId]: assetId }));
      } else if (ev.action === 'play_clip' && ev.value) {
        // value = clipId — 사용자 저작 애니 클립 재생(키프레임 보간). ANIMATION.md.
        if ((scene.animClips ?? []).some((c) => c.id === ev.value)) {
          playingClips.current.set(ev.value, performance.now());
          if (clipRaf.current == null) clipRaf.current = requestAnimationFrame(tickClips);
        }
      } else if (ev.action === 'set_actuator' && ev.value) {
        // value = "대상objectId|목표" — 목표 = 0..1 숫자 · open(1) · close(0) · toggle(반전). 관절이 부드럽게 이동. doc §6.
        const sep = ev.value.indexOf('|');
        const id = sep >= 0 ? ev.value.slice(0, sep) : ev.value;
        const tRaw = (sep >= 0 ? ev.value.slice(sep + 1) : '').trim();
        if (id) setActuatorDrive((m) => {
          const cur = m[id] ?? (scene.objects.find((o) => o.id === id)?.actuator?.value ?? 0);
          let target: number;
          if (tRaw === 'open') target = 1;
          else if (tRaw === 'close') target = 0;
          else if (tRaw === 'toggle') target = cur >= 0.5 ? 0 : 1;
          else { const n = parseFloat(tRaw); target = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1; }
          return { ...m, [id]: target };
        });
      } else if (ev.action === 'set_camera_mode' && ev.value) {
        // value = "third" | "first" | "topdown" | "fixed|<대상objectId>" — 플레이 카메라 모드 전환(구역별).
        const [mode = 'third', fixedId = ''] = ev.value.split('|');
        if (mode === 'first' || mode === 'topdown' || mode === 'fixed' || mode === 'third') {
          setCameraMode(mode);
          setCameraFixedId(mode === 'fixed' ? (fixedId || null) : null);
        }
      } else if (ev.action === 'despawn_object') {
        // value = 대상 objectId (빈 값이면 자기 자신). Phase 2.
        const target = ev.value || obj.id;
        setDespawnedIds((s) => { const n = new Set(s); n.add(target); return n; });
      } else if (ev.action === 'game_win') {
        setGameResult({ kind: 'win', message: ev.value?.trim() || '승리!' });
      } else if (ev.action === 'game_lose') {
        setGameResult({ kind: 'lose', message: ev.value?.trim() || '게임 오버' });
      } else if (ev.action === 'run_script' && ev.value) {
        runScript(ev.value, obj); // Phase 3 — 커스텀 JS(api 제공)
      } else if (ev.action === 'emit_event') {
        // Event Bridge — 임베드(iframe)일 때만 부모 페이지로 커스텀 이벤트 전송
        if (onBridge && window.parent !== window) {
          onBridge({ type: 'park3d:event', sceneId: scene.sceneId, objectId: obj.id, objectName: obj.name, trigger, value: ev.value });
        }
      }
  }

  const handleObjectEvent = (obj: ObjectNodeSchema, trigger: EventSchema['trigger']) => {
    // 중앙 조준(crosshair) 하이라이트 — hover 이벤트가 있는 대상을 조준하면 레티클 강조.
    if (trigger === 'hover_enter') setCrosshairHot(true);
    if (trigger === 'hover_exit') setCrosshairHot(false);
    if (trigger === 'click') trackEvent('click', obj.id, obj.name);
    if (trigger === 'area_enter') trackEvent('area_enter', obj.id, obj.name);
    if (trigger === 'area_exit') trackEvent('area_exit', obj.id, obj.name);
    if (trigger === 'interact') { trackEvent('interact', obj.id, obj.name); setDialogueNonce((n) => n + 1); }

    const matchingEvents = obj.events.filter((e) => e.trigger === trigger);
    // 조건 게이트 — 다중조건(AND/OR) 통과 시 액션, 거짓이고 elseAction 있으면 else 분기(GAME_LOGIC.md).
    const lockActions: EventSchema['action'][] = [];
    for (const ev of matchingEvents) {
      if (evalGate(ev)) { runEventAction(obj, ev, trigger); lockActions.push(ev.action); }
      else if (ev.elseAction) { runElseAction(obj, ev, trigger); lockActions.push(ev.elseAction); }
    }

    // 이동 잠금 — 플레이 모드에서 이동을 막는 액션(팝업·포커스 등)이 하나라도 발동되면 상호작용 잠금.
    // 해제는 endInteraction()(팝업 닫기/Esc). 중앙 목록 MOVEMENT_LOCKING_ACTIONS로 확장 관리.
    if (playMode && lockActions.some((a) => MOVEMENT_LOCKING_ACTIONS.has(a))) {
      setInteractionLock(true);
    }
  };

  // E 프롬프트/버튼 표시 조건 — 근접 대상이 interact 이벤트를 갖거나, E로 여는 대화(show='interact')일 때.
  // (항상/근접 표시 대화나 자동 넘김은 E 프롬프트 없이 말풍선만 뜨거나 내부 'E ▶' 힌트로 안내)
  const interactTargetObj = interactTarget ? effectiveScene.objects.find((o) => o.id === interactTarget.id) : null;
  const interactTargetDlg = interactTargetObj ? effectiveDialogue(interactTargetObj) : null;
  const interactTargetHasE = !!interactTargetObj?.events.some((e) => e.trigger === 'interact')
    || interactTargetDlg?.show === 'interact';

  // 고정 화면 비율(frameAspect) — 설정 시 캔버스를 그 비율로 레터박스(가운데 정렬 + 배경 여백).
  const frameAspect = scene.environment.frameAspect && scene.environment.frameAspect > 0 ? scene.environment.frameAspect : null;
  const viewerCanvasEl = (
    <ViewerCanvas scene={effectiveScene} playMode={playMode} onObjectClick={handleObjectEvent} mobileInputRef={mobileInputRef} focusRequest={focusRequest} clipRequests={clipRequests} actuatorDrive={actuatorDrive} onInteractPromptChange={(obj) => setInteractTarget(obj ? { id: obj.id, name: obj.name } : null)} interactHighlightId={interactTarget?.id ?? null} dialogueNonce={dialogueNonce} passableIds={passableIds} movedIds={movedIds} playFocusId={playFocus?.id ?? null} movementLocked={interactionLock} centerPointer={playMode && !isTouch && !pointerFree} onPointerFree={setPointerFree} cameraMode={playMode ? cameraMode : 'third'} cameraFixedId={cameraFixedId} respawnNonce={runNonce} flashlightOn={flashlightOn} onFlashlightChange={setFlashlightOn} />
  );

  return (
    <div className="w-screen h-screen relative overflow-hidden bg-canvas">
      {frameAspect ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{ width: '100%', height: '100%', maxWidth: `calc(100vh * ${frameAspect})`, maxHeight: `calc(100vw / ${frameAspect})` }}
          >
            {viewerCanvasEl}
          </div>
        </div>
      ) : (
        viewerCanvasEl
      )}

      {/* 게임 변수 HUD — showInHud인 변수의 현재값 표시 (탐색/플레이·임베드 공통). GAME_LOGIC.md */}
      {(scene.variables ?? []).some((v) => v.showInHud) && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center gap-1">
          {(scene.variables ?? []).filter((v) => v.showInHud).map((v) => (
            <div key={v.id} className="px-3 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-sm font-semibold tabular-nums">
              {v.name}: {String(hudVars[v.name] ?? v.initial)}
            </div>
          ))}
        </div>
      )}

      {/* HUD 위젯 — 체력바·목숨 등 (Phase 2) */}
      {(scene.hudElements ?? []).length > 0 && (
        <HudWidgets elements={scene.hudElements ?? []} vars={hudVars} />
      )}

      {/* 승리/패배 화면 (Phase 2) */}
      {gameResult && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-[popupBackdrop_0.25s_ease-out]">
          <div className="text-center px-8 py-10 rounded-2xl bg-surface border border-border shadow-2xl animate-[popupScale_0.25s_ease-out] max-w-[90vw]">
            <p className={`text-4xl font-black mb-2 ${gameResult.kind === 'win' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {gameResult.kind === 'win' ? '🎉' : '💀'}
            </p>
            <p className="text-2xl font-bold text-foreground mb-6 whitespace-pre-line">{gameResult.message}</p>
            <button
              onClick={restartGame}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/80 text-white font-semibold transition-colors"
            >
              <RotateCcw size={16} /> 다시 시작
            </button>
          </div>
        </div>
      )}

      {/* 상단 오버레이 — 독립 URL(/space)에서만 풀 UI */}
      {variant === 'standalone' && (
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {isOwner && (
            <button
              onClick={() => {
                if (window.opener) window.close();
                else window.location.href = `/editor/${projectId}`;
              }}
              className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm border border-white/10 text-white text-xs px-3 py-1.5 rounded-xs hover:bg-black/70 transition-colors"
            >
              ← 에디터로
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="text-white/60 text-xs font-medium bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-xs">
            {projectName}
          </span>
          {/* 시점 초기화 — 탐색 모드에서 카메라를 초기 위치로 복귀 (포커스 후 되돌리기) */}
          {!playMode && (
            <button
              onClick={resetCamera}
              title="카메라를 처음 시점으로"
              className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm border border-white/10 text-white/70 text-xs px-3 py-1.5 rounded-xs hover:bg-black/60 transition-colors"
            >
              ⌂ 시점 초기화
            </button>
          )}
          {/* 둘러보기 전용 씬은 플레이 토글 자체를 숨김 (캐릭터 소환 불가) */}
          {!walkDisabled && (
            <button
              onClick={() => setPlayMode((v) => !v)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xs border backdrop-blur-sm transition-all ${
                playMode
                  ? 'bg-primary/80 border-primary/50 text-white'
                  : 'bg-black/40 border-white/10 text-white/70 hover:bg-black/60'
              }`}
            >
              {playMode ? '⏹ 탐색 모드' : '▶ 플레이'}
            </button>
          )}
        </div>
      </div>
      )}

      {/* 임베드는 모드 전환 버튼 없음 — 씬의 "기본 진입 모드"로 고정(몰입형). */}

      {playMode && !isTouch && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm border border-white/10 rounded-xs px-4 py-2 text-white/50 text-xs flex items-center gap-3">
            <span>WASD 이동</span>
            <span className="text-white/20">|</span>
            <span>Space 점프</span>
            <span className="text-white/20">|</span>
            <span>E 상호작용</span>
            <span className="text-white/20">|</span>
            <span>마우스 드래그 시점</span>
          </div>
        </div>
      )}

      {/* 화면 중앙 조준점(crosshair) — 플레이 모드(데스크톱). 내가 어디를 보는지 표시(FPS식 레티클).
          (다음 단계: 조준점이 상호작용 대상 위에 오면 강조 + 중앙을 클릭/호버 포인터로 사용) */}
      {/* 시점 전환 (플레이) — 좌하단. 클릭 = 3인칭↔1인칭 수동 토글(topdown/fixed는 구역 이벤트로, 클릭 시 3인칭 복귀). */}
      {playMode && !interactionLock && !isTouch && (
        <button
          onClick={() => { setCameraMode((m) => (m === 'first' ? 'third' : 'first')); setCameraFixedId(null); }}
          title="시점 전환 (1인칭/3인칭)"
          className="absolute bottom-4 left-4 z-20 px-3 py-1.5 rounded-xs bg-black/50 hover:bg-black/65 backdrop-blur-sm border border-white/15 text-white/85 text-[11px] font-medium transition-colors"
        >
          {cameraMode === 'first' ? '👁 1인칭 시점' : cameraMode === 'topdown' ? '🚁 위에서' : cameraMode === 'fixed' ? '🎬 고정 시점' : '🎥 3인칭 시점'}
        </button>
      )}

      {playMode && !isTouch && !interactionLock && !pointerFree && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
          {/* 대상 조준 시 강조 = 커지고 노란 링. 평소 = 작은 흰 십자. */}
          <div
            className="relative transition-all duration-100"
            style={{ width: crosshairHot ? 22 : 16, height: crosshairHot ? 22 : 16, filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.9))' }}
          >
            <div className="absolute top-1/2 left-0 w-full h-[1.5px] -translate-y-1/2 rounded-full" style={{ background: crosshairHot ? '#ffd24d' : 'rgba(255,255,255,0.8)' }} />
            <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 rounded-full" style={{ background: crosshairHot ? '#ffd24d' : 'rgba(255,255,255,0.8)' }} />
            {crosshairHot && <div className="absolute inset-0 rounded-full border-2 border-[#ffd24d]/80" />}
          </div>
        </div>
      )}

      {/* 근접 상호작용 프롬프트 (데스크톱) — 범위 내 대상이 있을 때만. E 키캡만 표시(대상은 3D 하이라이트로 구분) */}
      {playMode && !isTouch && interactTarget && interactTargetHasE && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 pointer-events-none">
          <kbd className="inline-flex items-center justify-center min-w-[40px] h-10 px-3 bg-black/65 backdrop-blur-sm border border-white/25 rounded-xs text-white text-base font-bold shadow-lg">E</kbd>
        </div>
      )}

      {/* 근접 상호작용 버튼 (모바일) */}
      {playMode && isTouch && interactTarget && interactTargetHasE && (
        <button
          onClick={() => {
            const obj = effectiveScene.objects.find((o) => o.id === interactTarget.id);
            if (obj) handleObjectEvent(obj, 'interact');
          }}
          className="absolute bottom-32 right-6 z-20 flex items-center justify-center w-16 h-16 rounded-full bg-primary/80 border border-primary/50 text-white text-2xl font-bold backdrop-blur-sm active:scale-95 transition-transform"
        >
          E
        </button>
      )}

      {playMode && isTouch && <MobileControls inputRef={mobileInputRef} />}

      {/* Park3D 배지 — 독립 URL, Free 플랜만 */}
      {variant === 'standalone' && !hideBadge && (
        <a
          href="https://park3d.io"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-black/40 backdrop-blur-sm border border-white/10 text-white/50 hover:text-white/80 text-[10px] px-2.5 py-1.5 rounded-xs transition-colors"
        >
          <span className="text-sm leading-none">⬡</span>
          Powered by Park3D
        </a>
      )}

      {/* 임베드 워터마크 */}
      {variant === 'embed' && (
        <div className="absolute bottom-3 left-3 pointer-events-none">
          <div className="flex items-center gap-1 bg-black/30 backdrop-blur-sm text-white/30 text-[9px] px-2 py-1 rounded-xs">
            <span className="text-xs leading-none">⬡</span>
            Park3D
          </div>
        </div>
      )}

      {/* 팝업 모달 — 위치 프리셋(center/left/right/bottom) + iframe/auto 본문 + 등장 애니메이션.
          씬 기본 팝업 스타일(defaultPopup)을 이벤트별 config로 덮어쓴다(이벤트 우선). */}
      {popup && (() => {
        const d = scene.environment.defaultPopup;
        const c = popup.config;
        const mode = c?.mode ?? 'auto';
        const isFrame = mode === 'url' || mode === 'html';
        const pos = c?.position ?? d?.position ?? 'center';
        const width = c?.width ?? d?.width;
        const height = c?.height ?? d?.height;
        const bg = c?.bg ?? d?.bg;
        const anim = c?.anim ?? d?.anim ?? 'auto';
        const chrome = c?.chrome !== false;  // 미설정/true = 제목바+닫기버튼, false = 몰입형(플로팅 ✕)
        const pad = c?.padding;              // 카드 내부 여백 override

        // center + auto + 크기 미지정 + chrome = 기존 컴팩트 모달 그대로(하위호환).
        const legacyCompact = pos === 'center' && !isFrame && !width && !height && chrome;

        // 위치별 오버레이 정렬 / 카드 기본 크기 / 모서리 / 기본 애니메이션
        const posCfg = {
          center: { wrap: 'items-center justify-center p-4', w: 'min(90vw, 860px)', h: 'min(82vh, 620px)', round: 'rounded-2xl', anim: 'animate-[popupScale_0.18s_ease-out]' },
          bottom: { wrap: 'items-end justify-center p-0 sm:p-4', w: 'min(100vw, 1100px)', h: 'min(62vh, 540px)', round: 'rounded-t-2xl sm:rounded-2xl', anim: 'animate-[popupSlideUp_0.24s_ease-out]' },
          left:   { wrap: 'items-stretch justify-start p-0', w: 'min(92vw, 440px)', h: '100%', round: 'rounded-r-2xl', anim: 'animate-[popupSlideInLeft_0.24s_ease-out]' },
          right:  { wrap: 'items-stretch justify-end p-0', w: 'min(92vw, 440px)', h: '100%', round: 'rounded-l-2xl', anim: 'animate-[popupSlideInRight_0.24s_ease-out]' },
        }[pos];

        // 애니메이션 종류 — auto면 위치별 기본, 그 외는 지정값(slide는 위치에 맞는 방향).
        const animClass =
          anim === 'none' ? '' :
          anim === 'fade' ? 'animate-[popupFade_0.2s_ease-out]' :
          anim === 'scale' ? 'animate-[popupScale_0.18s_ease-out]' :
          anim === 'slide' ? (pos === 'left' ? 'animate-[popupSlideInLeft_0.24s_ease-out]' : pos === 'right' ? 'animate-[popupSlideInRight_0.24s_ease-out]' : 'animate-[popupSlideUp_0.24s_ease-out]') :
          posCfg.anim;

        // 여백: padding 지정 우선 → 몰입형(chrome=false)은 0 → 그 외는 클래스 기본(p-6/p-4)
        const padStyle = pad != null ? { padding: pad } : (!chrome ? { padding: 0 } : {});
        const cardStyle = legacyCompact
          ? { background: bg, ...padStyle }
          : { width: width || posCfg.w, height: height || (isFrame || pos !== 'center' ? posCfg.h : undefined), background: bg, ...padStyle };

        return (
          <div className={`absolute inset-0 flex ${posCfg.wrap} z-50`}>
            {/* 배경(overlay) 클릭으로는 닫히지 않음 — 오직 '닫기' 버튼으로만. 뒤 캔버스 클릭도 이 div가 가림 */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[popupBackdrop_0.2s_ease-out]" />
            <div
              className={`relative bg-white border border-slate-200 shadow-modal ${posCfg.round} ${animClass} ${legacyCompact ? 'p-6 w-full max-w-md' : 'flex flex-col p-4 max-w-[96vw] max-h-full'}`}
              style={cardStyle}
            >
              {chrome && <h3 className="text-lg font-bold text-slate-900 mb-3 shrink-0">{popup.title}</h3>}
              {isFrame ? (
                <div className="flex-1 min-h-0">
                  <PopupFrame value={popup.content} config={c} />
                </div>
              ) : legacyCompact ? (
                <RichContent value={popup.content} onLight />
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <RichContent value={popup.content} onLight />
                </div>
              )}
              {chrome ? (
                <button
                  onClick={endInteraction}
                  className="mt-4 shrink-0 w-full py-2.5 rounded-xs bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-semibold text-sm hover:from-violet-500 hover:to-cyan-500 transition-all"
                >
                  닫기
                </button>
              ) : (
                // 몰입형 — 카드 우상단 플로팅 ✕
                <button
                  onClick={endInteraction}
                  aria-label="닫기"
                  className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/45 text-white text-sm hover:bg-black/65 transition-colors"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 포커스 단독(팝업 없음) — 투명 차단막으로 뒤 캔버스 클릭 차단. 우상단 닫기 버튼 + Esc로 복귀 */}
      {interactionLock && !popup && (
        <>
          <div className="absolute inset-0 z-40" />
          <button
            onClick={endInteraction}
            className="absolute top-4 right-4 z-50 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm text-white text-xs font-semibold px-3 py-2 rounded-xs hover:bg-black/70 transition-colors"
          >
            ✕ 닫기 <span className="text-white/50">(Esc)</span>
          </button>
        </>
      )}
    </div>
  );
}
