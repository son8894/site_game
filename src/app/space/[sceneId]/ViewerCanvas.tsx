'use client';

import { useRef, useEffect, Suspense, lazy, useMemo, useCallback } from 'react';
import { Canvas, useThree, useFrame, events as createPointerEvents } from '@react-three/fiber';
import { OrbitControls, Grid, Sky, Environment, ContactShadows } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { ProjectSceneSchema, ObjectNodeSchema, EventSchema, HdrPreset, AssetRefSchema, EnvSchema } from '@/types/scene';
import { glbLocalBboxCache } from '@/lib/glbBboxCache';
import { worldBBox } from '@/lib/objectBBox';
import { cameraLimits } from '@/lib/cameraLimits';
import { BoundaryWalls } from '@/components/three/BoundaryWalls';
import { ViewerObject } from './ViewerObject';
import { InstancedPrimitives, getInstancedIds } from './InstancedPrimitives';
import { ParticleEmitter } from '@/components/three/ParticleEmitter';
import { PostProcessingEffects } from '@/components/three/PostProcessingEffects';
import { GroundPlane } from '@/components/three/GroundPlane';
import { GradientSky } from '@/components/three/GradientSky';
import { DefaultEnvironment } from '@/components/three/DefaultEnvironment';
import { PlayModeContext } from './PlayModeContext';
import { ClipRequestContext, type ClipReq } from './ClipRequestContext';
import { ActuatorDriveContext } from './ActuatorDriveContext';
import { InteractHighlightContext } from './InteractHighlightContext';
import { DialogueAdvanceContext } from './DialogueAdvanceContext';
import { SceneToneMapping } from '@/components/three/SceneToneMapping';

const PlayCanvas = lazy(() => import('./PlayCanvas').then((m) => ({ default: m.PlayCanvas })));

// 탐색 모드 → 플레이 모드 전환 시 현재 카메라 방향을 azimuthRef에 캡처
// 플레이 카메라가 같은 수평 방향에서 시작되어 씬이 동일하게 보임
function CameraAzimuthCapture({
  playMode,
  azimuthRef,
}: {
  playMode: boolean;
  azimuthRef: React.MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const prevRef = useRef(false);

  useFrame(() => {
    if (playMode && !prevRef.current) {
      azimuthRef.current = Math.atan2(camera.position.x, camera.position.z);
    }
    prevRef.current = playMode;
  });

  return null;
}

// 오브젝트의 월드 위치 근사(부모 체인 위치 합산) — 카메라 포커스 대상 좌표 계산용.
// 부모 회전/스케일은 무시하지만 포커스 용도로는 충분.
function objWorldPos(objects: ObjectNodeSchema[], id: string): THREE.Vector3 | null {
  let o: ObjectNodeSchema | undefined = objects.find((x) => x.id === id);
  if (!o) return null;
  const v = new THREE.Vector3();
  while (o) {
    v.x += o.position.x; v.y += o.position.y; v.z += o.position.z;
    const pid: string | null = o.parentId;
    o = pid ? objects.find((p) => p.id === pid) : undefined;
  }
  return v;
}

// 씬 라이트 오브젝트 렌더. spot/directional은 그룹의 로컬 -Y에 target을 둬서 emission이
// object.rotation을 따라가게 한다(에디터 방향 기즈모와 동일 규칙 — 편집/게시 룩 일치).
function SceneLight({ object: o }: { object: ObjectNodeSchema }) {
  const lc = o.light!;
  const targetObj = useMemo(() => new THREE.Object3D(), []);
  const isDir = lc.type !== 'point';
  return (
    <group
      position={[o.position.x, o.position.y, o.position.z]}
      rotation={[o.rotation.x * Math.PI / 180, o.rotation.y * Math.PI / 180, o.rotation.z * Math.PI / 180]}
    >
      {lc.type === 'point' && (
        <pointLight color={lc.color} intensity={lc.intensity}
          distance={lc.distance ?? 20} decay={lc.decay ?? 2} castShadow={lc.castShadow} />
      )}
      {lc.type === 'spot' && (
        <spotLight color={lc.color} intensity={lc.intensity}
          distance={lc.distance ?? 20} decay={lc.decay ?? 2}
          angle={lc.angle ?? Math.PI / 6} penumbra={lc.penumbra ?? 0.1}
          castShadow={lc.castShadow} target={targetObj} />
      )}
      {lc.type === 'directional' && (
        <directionalLight color={lc.color} intensity={lc.intensity}
          castShadow={lc.castShadow} target={targetObj} />
      )}
      {isDir && <primitive object={targetObj} position={[0, -3, 0]} />}
    </group>
  );
}

// 포커스 프레이밍용 대상 반경(월드) — GLB는 캐시된 로컬 bbox×스케일, 그 외는 스케일 근사
function objFocusRadius(objects: ObjectNodeSchema[], assets: AssetRefSchema[], id: string): number {
  const o = objects.find((x) => x.id === id);
  if (!o) return 1;
  const s = Math.max(o.scale.x, o.scale.y, o.scale.z, 0.001);
  const url = o.assetId ? assets.find((a) => a.id === o.assetId)?.dracoUrl : null;
  const bbox = url ? glbLocalBboxCache.get(url) : undefined;
  if (bbox) {
    const size = new THREE.Vector3();
    bbox.getSize(size);
    return Math.max(0.5 * Math.max(size.x, size.y, size.z) * s, 0.2);
  }
  return Math.max(0.5 * s, 0.2); // 프리미티브 등 단위 지오메트리 가정
}

// Canvas 초기 카메라와 동일한 "홈" 시점 (시점 초기화 시 복귀 지점)
const HOME_CAM = new THREE.Vector3(5, 4, 8);
const HOME_TARGET = new THREE.Vector3(0, 0, 0);

// 카메라 요청 처리 — 0.6초 이징으로 부드럽게 이동.
// request.id가 objectId면 그 오브젝트로 포커스(앵글·거리 유지 팬), null이면 홈 시점으로 복귀.
function CameraFocus({ request, objects, assets, orbitRef }: {
  request: { id: string | null; t: number } | null;
  objects: ObjectNodeSchema[];
  assets: AssetRefSchema[];
  orbitRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  const anim = useRef<{ camFrom: THREE.Vector3; camTo: THREE.Vector3; tgtFrom: THREE.Vector3; tgtTo: THREE.Vector3; t: number } | null>(null);
  const lastTick = useRef(0);

  useEffect(() => {
    if (!request || request.t === lastTick.current || !orbitRef.current) return;
    lastTick.current = request.t;
    const orbit = orbitRef.current;
    const tgtFrom = orbit.target.clone();
    const camFrom = camera.position.clone();

    let tgtTo: THREE.Vector3;
    let camTo: THREE.Vector3;
    if (request.id === null) {
      // 홈 시점으로 복귀
      tgtTo = HOME_TARGET.clone();
      camTo = HOME_CAM.clone();
    } else {
      const wp = objWorldPos(objects, request.id);
      if (!wp) return;
      // 대상 크기에 맞춰 줌인(프레이밍) — 현재 보던 각도는 유지한 채 적당한 거리로 다가간다
      const radius = objFocusRadius(objects, assets, request.id);
      const persp = camera as THREE.PerspectiveCamera;
      const fov = persp.isPerspectiveCamera ? persp.fov : 60;
      const dist = (radius / Math.sin((fov / 2) * (Math.PI / 180))) * 1.5; // 마진
      const dir = camFrom.clone().sub(tgtFrom);
      if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.5, 0.8); // 카메라·타겟이 겹칠 때 기본 각도
      dir.normalize();
      tgtTo = wp.clone();
      camTo = wp.clone().add(dir.multiplyScalar(dist));
    }
    anim.current = { tgtFrom, tgtTo, camFrom, camTo, t: 0 };
  }, [request, objects, orbitRef, camera]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !orbitRef.current) return;
    a.t = Math.min(1, a.t + dt / 0.6);
    const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2; // easeInOutQuad
    orbitRef.current.target.lerpVectors(a.tgtFrom, a.tgtTo, e);
    camera.position.lerpVectors(a.camFrom, a.camTo, e);
    orbitRef.current.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

// 상호작용(클릭/호버) 오브젝트 위에 떠다니는 힌트 링 — "여기 클릭하세요" 어포던스.
// 오브젝트 렌더 경로(재질/GLB)를 전혀 건드리지 않는 별도 레이어. 탐색 모드에서만 렌더한다.
// depthTest=false + 높은 renderOrder로 오브젝트에 가려지지 않고 항상 보인다.
function isInteractive(o: ObjectNodeSchema): boolean {
  return o.events.some(
    (e) => e.trigger === 'click' || e.trigger === 'hover_enter' || e.trigger === 'hover_exit',
  );
}

// 링 높이(오브젝트 원점 기준 상단 + 여백) — GLB는 캐시된 로컬 bbox.max.y×스케일, 그 외/미로딩은 스케일 근사
function hintTopOffset(url: string | null, scaleY: number): number {
  const cached = url ? glbLocalBboxCache.get(url) : undefined;
  const top = cached ? cached.max.y * scaleY : Math.max(scaleY * 0.5, 0.3);
  return top + 0.35;
}

function InteractionHints({ objects, assets }: { objects: ObjectNodeSchema[]; assets: AssetRefSchema[] }) {
  const groupRef = useRef<THREE.Group>(null);

  const hints = useMemo(() => {
    const out: { id: string; x: number; z: number; baseY: number; url: string | null; scaleY: number }[] = [];
    for (const o of objects) {
      if (!o.visible || o.isGroup || !isInteractive(o)) continue;
      const wp = objWorldPos(objects, o.id);
      if (!wp) continue;
      const url = o.assetId ? (assets.find((a) => a.id === o.assetId)?.dracoUrl ?? null) : null;
      out.push({ id: o.id, x: wp.x, z: wp.z, baseY: wp.y, url, scaleY: o.scale.y });
    }
    return out;
  }, [objects, assets]);

  // 매 프레임: 실제 상단 높이 반영(GLB bbox가 늦게 로드돼도 반영됨) + 카메라 빌보드 + 펄스
  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.children.forEach((child, i) => {
      const h = hints[i];
      if (h) child.position.set(h.x, h.baseY + hintTopOffset(h.url, h.scaleY), h.z);
      child.quaternion.copy(state.camera.quaternion);
      child.scale.setScalar(1 + Math.sin(t * 2.6 + i * 0.7) * 0.16);
    });
  });

  if (hints.length === 0) return null;

  return (
    <group ref={groupRef}>
      {hints.map((h) => (
        // 초기 위치(근사) — useFrame이 매 프레임 정확한 높이로 갱신. depthTest 기본값(true)이라
        // 앞 오브젝트에 정상적으로 가려진다(뒤쪽/가려진 오브젝트 링은 안 보임 → 겹침 감소).
        <group key={h.id} position={[h.x, h.baseY + hintTopOffset(h.url, h.scaleY), h.z]}>
          <mesh>
            <ringGeometry args={[0.11, 0.17, 28]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh>
            <circleGeometry args={[0.05, 20]} />
            <meshBasicMaterial color="#22d3ee" transparent opacity={0.7} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface Props {
  scene: ProjectSceneSchema;
  playMode: boolean;
  onObjectClick: (obj: ObjectNodeSchema, trigger: EventSchema['trigger']) => void;
  mobileInputRef?: React.MutableRefObject<{ fwd: number; strafe: number; jump: boolean }>;
  focusRequest?: { id: string | null; t: number } | null;
  clipRequests?: Record<string, ClipReq>;
  actuatorDrive?: Record<string, number>;
  onInteractPromptChange?: (obj: ObjectNodeSchema | null) => void;
  /** 근접한 interact 대상 id — 3D 트리에 내려 해당 오브젝트를 하이라이트 */
  interactHighlightId?: string | null;
  /** E키 nonce — 대화 열기/다음 문장 */
  dialogueNonce?: number;
  /** 런타임 통과 가능(콜라이더 제거) 오브젝트 id 집합 — set_passable/toggle_collision */
  passableIds?: Set<string>;
  /** move_object로 런타임 이동 중인 오브젝트 id 집합 — 그룹 콜라이더 동반 이동 라우팅 */
  movedIds?: Set<string>;
  /** 플레이 모드 카메라 포커스 대상 objectId — focus_object가 플레이에서 발동됐을 때 */
  playFocusId?: string | null;
  /** 게임 재시작 카운터 — 바뀌면 캐릭터가 스폰으로 되돌아간다(PlayModeController까지 전달). */
  respawnNonce?: number;
  /** 캐릭터 이동 잠금 — 팝업·포커스 등 상호작용 진행 중 */
  movementLocked?: boolean;
  /** 중앙 조준(crosshair) 포인터 — true면 hover/click 레이캐스트를 마우스가 아니라 화면 중앙에서(플레이 데스크톱). */
  centerPointer?: boolean;
  /** Esc로 포인터 락 해제 시 true, 캔버스 재클릭 시 false — 커서/크로스헤어 복귀용 */
  onPointerFree?: (v: boolean) => void;
  /** 카메라 모드 (플레이) — 구역별/토글 */
  cameraMode?: 'third' | 'first' | 'topdown' | 'fixed';
  /** fixed 카메라 대상 오브젝트 id */
  cameraFixedId?: string | null;
  /** 손전등 on/off(ViewerClient가 소유) — exp 안개 밀도를 override해 "꺼지면 시야 제한/켜면 시야 확장"을 만든다. */
  flashlightOn?: boolean;
  /** PlayCanvas→PlayModeController까지 내려가 T키 토글 시 호출된다. */
  onFlashlightChange?: (on: boolean) => void;
}

const EMPTY_CLIPS: Record<string, ClipReq> = {};
const EMPTY_DRIVE: Record<string, number> = {};

// 매 프레임 R3F 포인터 이벤트 재평가 — 중앙 조준(compute=center)에서 카메라가 움직여도(걷기/둘러봄) hover가 갱신되게.
//   (R3F는 기본적으로 실제 포인터 이동 때만 교차 판정 → 마우스 안 움직이고 걸어가면 hover가 안 바뀜)
function HoverUpdater() {
  const update = useThree((s) => s.events.update);
  useFrame(() => update?.());
  return null;
}

// 탐색 모드 진입 시 1회 자동 전체 맞춤 — 저장한 공간을 다시 열 때 카메라가 너무 가깝지 않도록
// 모든 루트 오브젝트가 화면에 들어오는 뷰로 시작(에디터 Shift+F 전체 맞춤과 동일 기준).
function InitialFit({ objects, orbitRef, startView }: {
  objects: ObjectNodeSchema[];
  orbitRef: React.RefObject<OrbitControlsImpl | null>;
  startView?: EnvSchema['startView'];
}) {
  const done = useRef(false);
  const camObj = useThree((s) => s.camera);
  // useFrame 1회 — orbitRef가 준비될 때까지 프레임마다 대기 후 fit(useEffect의 ref 타이밍 취약성 회피).
  useFrame(() => {
    if (done.current) return;
    const orbit = orbitRef.current;
    if (!orbit) return;
    done.current = true;
    // 시작 뷰에 저장된 시야각이 있으면 적용. 없으면 카메라 기본값 그대로.
    const fov = startView?.fov;
    if (fov && (camObj as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camObj as THREE.PerspectiveCamera).fov = fov;
      (camObj as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    // 게시 시작 뷰가 있으면 자동fit 대신 저장된 위치·시선(·fov)에서 시작.
    if (startView) {
      orbit.object.position.set(startView.position.x, startView.position.y, startView.position.z);
      orbit.target.set(startView.target.x, startView.target.y, startView.target.z);
      orbit.update();
      return;
    }
    const roots = objects.filter((o) => o.visible && o.parentId === null);
    if (roots.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const o of roots) {
      minX = Math.min(minX, o.position.x); maxX = Math.max(maxX, o.position.x);
      minY = Math.min(minY, o.position.y); maxY = Math.max(maxY, o.position.y);
      minZ = Math.min(minZ, o.position.z); maxZ = Math.max(maxZ, o.position.z);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const spread = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 4);
    orbit.target.set(cx, cy, cz);
    orbit.object.position.set(cx + spread * 0.8, cy + spread * 0.6, cz + spread * 0.8);
    orbit.update();
  });
  return null;
}

export function ViewerCanvas({ scene, playMode, onObjectClick, mobileInputRef, focusRequest, clipRequests, actuatorDrive, onInteractPromptChange, interactHighlightId, dialogueNonce, passableIds, movedIds, playFocusId, movementLocked, centerPointer, onPointerFree, cameraMode, cameraFixedId, respawnNonce, flashlightOn, onFlashlightChange }: Props) {
  const { environment, objects } = scene;
  // 둘러보기 카메라 제한 — 고정 기본값 + 저장된 시작 뷰가 잘리지 않도록 보정. lib/cameraLimits.ts 참고.
  const exploreLim = cameraLimits(environment).effective;
  const azimuthRef = useRef(0);
  // 중앙 조준 포인터 — events.compute가 매 이벤트 참조(리렌더 무관하게 ref).
  const centerPointerRef = useRef(!!centerPointer);
  centerPointerRef.current = !!centerPointer;
  // R3F 이벤트 매니저 — 기본 포인터 이벤트 + compute만 override(중앙 조준). 메모이즈로 재설정 방지.
  const eventsFactory = useCallback((store: Parameters<typeof createPointerEvents>[0]) => {
    const base = createPointerEvents(store);
    return {
      ...base,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compute: (event: any, s: any, previous: any) => {
        if (centerPointerRef.current) {
          s.pointer.set(0, 0); // 화면 중앙(조준점)에서 레이캐스트
          s.raycaster.setFromCamera(s.pointer, s.camera);
        } else {
          base.compute?.(event, s, previous); // 탐색 모드는 R3F 기본 compute 그대로(정확성 보존)
        }
      },
    };
  }, []);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  // 플레이 모드 포커스 지점 — 대상의 월드 bbox '중심'과 반경을 PlayCanvas에 넘겨 카메라 줌에 사용.
  //   (원점 objWorldPos가 아니라 형상 중심 → GLB 원점이 발밑/한쪽이라 가까이서 프레임 밖으로 밀리는 문제 방지)
  const playFocusPoint = playFocusId
    ? (() => {
        const wb = worldBBox(objects, scene.assets ?? [], playFocusId);
        if (wb && !wb.isEmpty()) {
          const c = wb.getCenter(new THREE.Vector3());
          const size = wb.getSize(new THREE.Vector3());
          const radius = Math.max(size.x, size.y, size.z) * 0.5;
          return { x: c.x, y: c.y, z: c.z, radius: Math.max(radius, 0.3) };
        }
        // bbox 없으면(미로딩 등) 원점+근사 반경으로 폴백
        const wp = objWorldPos(objects, playFocusId);
        if (!wp) return null;
        return { x: wp.x, y: wp.y, z: wp.z, radius: objFocusRadius(objects, scene.assets ?? [], playFocusId) };
      })()
    : null;

  // HDR은 **조명/반사(IBL) 전용** — 배경은 아래 sky.type이 담당한다(2026-07-20).
  //   예전엔 <Environment background />로 HDRI 사진을 배경에 깔아 "사진 붙인 느낌 + 지평선 하드컷"이 났다.
  const useHdr = (environment.hdrPreset ?? 'none') !== 'none';
  const isSkyMode = environment.sky.type === 'sky';
  const isGradient = environment.sky.type === 'gradient';
  // 레거시 sky.type==='hdr'은 배경 소스가 없어졌으므로 단색으로 폴백.
  const isSolid = !isSkyMode && !isGradient;
  const skyColor = environment.sky.value || '#f3f1f1';
  const skyHorizon = environment.sky.value2 || skyColor;

  const instancedIds = useMemo(() => getInstancedIds(objects), [objects]);
  const particleObjects = useMemo(() => objects.filter((o) => o.visible && o.particle), [objects]);
  const rootObjects = useMemo(() => objects.filter((o) => o.parentId === null), [objects]);
  const nonInstancedObjects = useMemo(
    () => rootObjects.filter((o) => !instancedIds.has(o.id) && !o.particle && !o.isGroup),
    [rootObjects, instancedIds],
  );
  const rootGroups = useMemo(() => rootObjects.filter((o) => o.isGroup), [rootObjects]);

  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [5, 4, 8], fov: 60 }}
      // dpr 상한 — 기본값(devicePixelRatio 무제한)이면 고배율 화면에서 픽셀 수가 4~6배로 튄다.
      dpr={[1, 2]}
      gl={{ toneMapping: THREE.LinearToneMapping }}
      events={eventsFactory}
      style={{ width: '100%', height: '100%', cursor: (centerPointer && !movementLocked) ? 'none' : undefined }}
    >
      <PlayModeContext.Provider value={playMode}>
      <ClipRequestContext.Provider value={clipRequests ?? EMPTY_CLIPS}>
      <ActuatorDriveContext.Provider value={actuatorDrive ?? EMPTY_DRIVE}>
      <InteractHighlightContext.Provider value={interactHighlightId ?? null}>
      <DialogueAdvanceContext.Provider value={dialogueNonce ?? 0}>
      {/* 톤매핑 Neutral 고정 + 씬별 노출 — 저장 색을 최대한 그대로 렌더 */}
      <SceneToneMapping exposure={environment.toneMappingExposure ?? 1} />
      {/* 탐색/플레이 전환 시 카메라 수평 방향 캡처 */}
      <CameraAzimuthCapture playMode={playMode} azimuthRef={azimuthRef} />

      {/* ── 배경 (HDR / Sky / 단색 — 상호 배타) ── */}
      {isSolid && <color attach="background" args={[skyColor]} />}
      {isGradient && <GradientSky top={skyColor} horizon={skyHorizon} />}
      {isSkyMode && (
        <Sky
          sunPosition={[
            environment.lights.directionalPosition.x,
            environment.lights.directionalPosition.y,
            environment.lights.directionalPosition.z,
          ]}
          turbidity={8}
          rayleigh={2}
          mieCoefficient={0.005}
          mieDirectionalG={0.85}
        />
      )}
      {useHdr && (
        <Suspense fallback={null}>
          {/* background 프롭 없음 = 조명/반사만. 배경은 위 sky.type이 그린다. */}
          <Environment preset={environment.hdrPreset as Exclude<HdrPreset, 'none'>} />
        </Suspense>
      )}
      {/* HDR 미설정 시에도 은은한 IBL 제공 → PBR 재질 생기 (에디터와 동일) */}
      {!useHdr && <DefaultEnvironment />}

      {/* ── Fog ── linear(near/far) 또는 exp(FogExp2, density) ──
          단색 배경이면 fog 색 = 하늘색으로 자동 일치 → 먼 바닥이 하늘로 매끄럽게 사라짐(수평선 하드컷 완화). */}
      {environment.fog.enabled && (() => {
        // fog 색 = 배경이 수렴하는 색과 일치시켜 지평선 하드컷을 없앤다.
        //   그라데이션이면 **수평선 색**, 단색이면 하늘색, 대기(Sky) 모드만 사용자가 지정한 fog 색.
        const fogColor = isGradient ? skyHorizon : isSolid ? skyColor : environment.fog.color;
        // 손전등 — 플레이 모드 + exp 안개일 때만 밀도를 override한다(꺼짐=짙게/시야제한, 켜짐=옅게).
        //   linear 모드는 미지원(범위 스키마가 near/far 2개뿐이라 손전등 전용 필드를 또 늘리지 않음 — 문서화된 제약).
        const fl = environment.flashlight;
        const density = playMode && fl?.enabled && environment.fog.mode === 'exp'
          ? (flashlightOn ? (fl.onFogDensity ?? environment.fog.density ?? 0.02) : (fl.offFogDensity ?? 0.35))
          : environment.fog.density ?? 0.02;
        return environment.fog.mode === 'exp'
          ? <fogExp2 attach="fog" args={[fogColor, density]} />
          : <fog attach="fog" args={[fogColor, environment.fog.near, environment.fog.far]} />;
      })()}

      {/* ── 조명 ── */}
      {/* fill 광을 낮춰 방향광 그림자를 더 진하게. ambient/hemisphere/IBL이 그림자를 씻어내므로
          fill 기여를 줄인다(ambient 저장값의 0.2배, hemisphere 0.02, IBL 0.25). */}
      <hemisphereLight args={['#b9d5ff', '#4a5568', 0.02]} />
      <ambientLight intensity={environment.lights.ambientIntensity * 0.2} color={environment.lights.ambientColor ?? '#ffffff'} />
      {environment.lights.sunEnabled !== false && (
        <directionalLight
          position={[
            environment.lights.directionalPosition.x,
            environment.lights.directionalPosition.y,
            environment.lights.directionalPosition.z,
          ]}
          intensity={environment.lights.directionalIntensity}
          color={environment.lights.directionalColor ?? '#ffffff'}
          castShadow
          shadow-intensity={environment.lights.shadowIntensity ?? 1}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
          shadow-camera-near={0.5}
          shadow-camera-far={120}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
        />
      )}

      {/* ── 에디터 전용: 그리드 ── */}
      {!playMode && (
        <Grid
          position={[0, 0, 0]}
          cellSize={1}
          cellThickness={0.3}
          cellColor="#27272a"
          sectionSize={5}
          sectionThickness={0.6}
          sectionColor="#3f3f46"
          fadeDistance={60}
          fadeStrength={1.5}
          infiniteGrid
        />
      )}
      {/* 경계 벽 — 스타일(단색/텍스처)일 때 실제 벽 렌더. 탐색·플레이 공통. none이면 안 보임.
          (충돌은 PlayCanvas의 경계 콜라이더가 담당) */}
      {(environment.boundary ?? 0) > 0 && environment.boundaryWall && (
        <BoundaryWalls sizeX={environment.boundary!} sizeZ={environment.boundaryZ ?? environment.boundary!} shape={environment.boundaryShape ?? 'rect'} polygon={environment.boundaryPolygon} config={environment.boundaryWall} />
      )}

      {/* ── 바닥 ── */}
      {environment.ground?.enabled && (
        <GroundPlane
          preset={environment.ground.preset ?? 'custom'}
          color={environment.ground.color}
          textureUrl={environment.ground?.textureUrl}
          positionY={playMode ? 0 : -0.002}
          infinite={environment.ground?.infinite}
        />
      )}

      {/* ── 접지 그림자(ContactShadows) — 오브젝트가 바닥에 붙은 느낌 강화. 기본 꺼짐(opt-in) ── */}
      {/* 플레이 모드에선 제외: 캐릭터가 움직이면 접지 그림자가 이동 경로를 따라 검게 칠해지는
          트레일 아티팩트가 생긴다(움직이는 대상에 부적합). 탐색 모드 정적 씬에서만 렌더. */}
      {environment.contactShadows === true && !playMode && (
        <ContactShadows position={[0, 0.005, 0]} scale={60} far={12} blur={2.4} opacity={0.55} resolution={1024} color="#000000" />
      )}

      {/* ── 씬 오브젝트 (에디터 뷰) ── */}
      {!playMode && (
        <>
          <InstancedPrimitives objects={objects} />
          {nonInstancedObjects.map((obj) => (
            <ViewerObject key={obj.id} object={obj} assets={scene.assets ?? []} onEvent={onObjectClick} allObjects={objects} />
          ))}
          {rootGroups.map((obj) => (
            <ViewerObject key={obj.id} object={obj} assets={scene.assets ?? []} onEvent={onObjectClick} allObjects={objects} />
          ))}
          {particleObjects.filter((o) => o.parentId === null).map((obj) => (
            <ParticleEmitter
              key={obj.id}
              config={obj.particle!}
              position={[obj.position.x, obj.position.y, obj.position.z]}
            />
          ))}
        </>
      )}

      {/* 중앙 조준 hover — 카메라가 움직여도(걷기/둘러봄) 매 프레임 중앙 레이캐스트 재평가(R3F는 기본적으로 포인터 이동 때만 갱신). */}
      {centerPointer && <HoverUpdater />}

      {/* ── 플레이 모드 ── */}
      {playMode && (
        <Suspense fallback={null}>
          <PlayCanvas scene={scene} azimuthRef={azimuthRef} onObjectClick={onObjectClick} mobileInputRef={mobileInputRef} onInteractPromptChange={onInteractPromptChange} passableIds={passableIds} movedIds={movedIds} focusPoint={playFocusPoint} movementLocked={movementLocked} onPointerFree={onPointerFree} cameraMode={cameraMode} cameraFixedId={cameraFixedId} respawnNonce={respawnNonce} onFlashlightChange={onFlashlightChange} />
        </Suspense>
      )}

      {/* ── 씬 라이트 오브젝트 ── */}
      {objects.filter((o) => o.light && o.visible).map((o) => (
        <SceneLight key={o.id} object={o} />
      ))}

      <PostProcessingEffects preset={environment.postProcessing?.preset ?? 'none'} effects={environment.effects} />

      {!playMode && (
        <OrbitControls
          ref={orbitRef}
          makeDefault
          minPolarAngle={0.1}
          maxPolarAngle={exploreLim.maxPolar}
          minDistance={exploreLim.minDistance}
          maxDistance={exploreLim.maxDistance}
        />
      )}

      {/* 탐색 진입 시 1회 자동 전체 맞춤(너무 가까운 초기 뷰 방지) */}
      {!playMode && <InitialFit objects={objects} orbitRef={orbitRef} startView={environment.startView} />}

      {/* focus_object 액션 — 탐색 모드에서만 (플레이 모드는 orbitRef 없음 → no-op) */}
      {!playMode && <CameraFocus request={focusRequest ?? null} objects={objects} assets={scene.assets ?? []} orbitRef={orbitRef} />}

      {/* 인터랙션 어포던스 — 탐색 모드 + 씬 설정 on(미설정=on)일 때만 상호작용 오브젝트 위에 힌트 링 */}
      {!playMode && environment.showInteractionHints !== false && <InteractionHints objects={objects} assets={scene.assets ?? []} />}
      </DialogueAdvanceContext.Provider>
      </InteractHighlightContext.Provider>
      </ActuatorDriveContext.Provider>
      </ClipRequestContext.Provider>
      </PlayModeContext.Provider>
    </Canvas>
  );
}
