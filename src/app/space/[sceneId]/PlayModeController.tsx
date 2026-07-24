'use client';

import { useRef, useEffect, useState, MutableRefObject, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { RigidBody, CapsuleCollider, CoefficientCombineRule, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { QueryFilterFlags } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { normalizeGlbMaterials } from '@/lib/glbMaterials';

const DEG2RAD = Math.PI / 180;
// PlayCanvas의 <Physics gravity={[0, -20, 0]}>와 동일한 크기로 유지할 것
// (킨매틱 바디는 물리 월드의 중력을 받지 않아 여기서 수동으로 적분한다)
const GRAVITY = 20;
// 이 각도보다 가파른 경사(산 등)는 오를 수 없고 미끄러져 내려온다
const MAX_SLOPE_CLIMB_DEG = 46;
const MIN_SLOPE_SLIDE_DEG = 46;

// ── 유틸 ────────────────────────────────────────────────────────

function lerpAngle(a: number, b: number, t: number) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// 애니메이션 클립 이름에서 키워드로 찾기 (대소문자 무관)
function findClip(names: string[], keyword: string) {
  return names.find((n) => n.toLowerCase().includes(keyword.toLowerCase())) ?? null;
}

// ── 기본 캡슐 캐릭터 (GLB 미설정 시) ──────────────────────────

function DefaultCharacter() {
  return (
    <>
      <mesh position={[0, 0, 0]} castShadow>
        <capsuleGeometry args={[0.4, 1.0, 8, 16]} />
        <meshStandardMaterial color="#7c3aed" roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial color="#8b5cf6" roughness={0.3} metalness={0.1} />
      </mesh>
    </>
  );
}

// ── GLB 캐릭터 컴포넌트 ─────────────────────────────────────────

interface GlbCharacterProps {
  url: string;
  scale: number;
  movingRef: MutableRefObject<boolean>;
  jumpingRef: MutableRefObject<boolean>;
}

function GlbCharacter({ url, scale, movingRef, jumpingRef }: GlbCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene: rawScene, animations } = useGLTF(url);

  // 스킨드 메시는 인스턴스 공유 불가 → 클론
  const scene = useMemo(() => {
    const c = SkeletonUtils.clone(rawScene);
    normalizeGlbMaterials(c);
    return c;
  }, [rawScene]);

  const { actions, names } = useAnimations(animations, groupRef);
  const currentAnim = useRef<string | null>(null);

  // 마운트 시 idle 시작
  useEffect(() => {
    const idleClip = findClip(names, 'idle') ?? names[0] ?? null;
    if (idleClip) {
      actions[idleClip]?.reset().play();
      currentAnim.current = idleClip;
    }
  }, [actions, names]);

  useFrame(() => {
    // 상태에 따른 목표 애니메이션 결정
    const targetKeyword = jumpingRef.current ? 'jump'
      : movingRef.current             ? 'walk'
      :                                  'idle';

    const targetClip = findClip(names, targetKeyword)
      ?? (targetKeyword === 'walk' ? findClip(names, 'run') : null)
      ?? findClip(names, 'idle')
      ?? names[0]
      ?? null;

    if (targetClip && targetClip !== currentAnim.current) {
      const prev = currentAnim.current ? actions[currentAnim.current] : null;
      prev?.fadeOut(0.2);
      actions[targetClip]?.reset().fadeIn(0.2).play();
      currentAnim.current = targetClip;
    }
  });

  // 캡슐 콜라이더 중심 → 바닥 오프셋: -(halfHeight + radius) = -(0.5 + 0.4)
  return (
    <group ref={groupRef} scale={scale} position={[0, -0.9, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// ── 메인 컨트롤러 ───────────────────────────────────────────────

interface Props {
  azimuthRef: MutableRefObject<number>;
  playerRef: MutableRefObject<RapierRigidBody | null>;
  spawnPosition?: [number, number, number];
  characterUrl?: string;
  characterScale?: number;
  playerSpeed?: number;
  playerJumpForce?: number;
  mobileInputRef?: MutableRefObject<{ fwd: number; strafe: number; jump: boolean }>;
  onPositionChange?: (x: number, z: number) => void;
  /** 캐릭터가 솔리드 오브젝트에 새로 접촉했을 때 (RigidBody userData.objectId 기준, 접촉 지속 중 1회) */
  onObstacleEnter?: (objectId: string) => void;
  /** 접촉이 끝났을 때 (grace 시간 이상 떨어짐) — area_exit 트리거용 */
  onObstacleExit?: (objectId: string) => void;
  /** interact 이벤트를 가진 오브젝트들의 월드 위치 + 개별 근접 범위(range) */
  interactables?: { id: string; x: number; y: number; z: number; range: number }[];
  /** 상호작용 가능 범위(m) 폴백 — interactables/approachables 항목의 range가 우선. 기본 3 */
  interactRange?: number;
  /** 근접한 상호작용 대상이 바뀔 때 (없으면 null) — E 프롬프트 표시용 */
  onInteractableChange?: (objectId: string | null) => void;
  /** E키(또는 모바일 액션)로 상호작용 발동 시 */
  onInteract?: (objectId: string) => void;
  /** approach_enter/exit 이벤트를 가진 오브젝트들의 월드 위치 + 개별 근접 범위(range) */
  approachables?: { id: string; x: number; y: number; z: number; range: number }[];
  /** 캐릭터가 approach 대상 근접 범위에 새로 들어왔을 때 */
  onApproachEnter?: (objectId: string) => void;
  /** 캐릭터가 approach 대상 근접 범위를 벗어났을 때 */
  onApproachExit?: (objectId: string) => void;
  /** 플레이 모드 카메라 포커스 — 설정되면 팔로우 대신 이 지점을 프레이밍(줌). null이면 팔로우 복귀 */
  focusPoint?: { x: number; y: number; z: number; radius: number } | null;
  /** true면 캐릭터 이동(WASD/모바일/점프) 잠금 — 팝업·포커스 등 상호작용 진행 중 */
  movementLocked?: boolean;
  /** Esc로 포인터 락 해제 시 true, 캔버스 재클릭 시 false — 커서/크로스헤어 복귀를 뷰어가 처리 */
  onPointerFree?: (v: boolean) => void;
  /** 카메라 모드 — third(3인칭 팔로우)·first(1인칭)·topdown(위에서)·fixed(고정 지점). 구역별 전환/토글용. */
  cameraMode?: 'third' | 'first' | 'topdown' | 'fixed';
  /** fixed 모드일 때 카메라가 놓일 월드 지점(그 위치에서 캐릭터를 바라봄). */
  fixedTarget?: { x: number; y: number; z: number } | null;
  /** 값이 바뀌면 캐릭터를 스폰 지점으로 되돌린다(게임 재시작). 이게 없으면 죽은 자리에서 다시 시작한다. */
  respawnNonce?: number;
  /** 손전등 설정(EnvSchema.flashlight) — 있고 enabled면 T키로 토글되는 스팟라이트를 렌더. */
  flashlight?: {
    enabled: boolean;
    color?: string;
    intensity?: number;
    angle?: number;
    distance?: number;
  };
  /** 손전등 on/off가 바뀔 때 — 안개(부모 캔버스)·배터리 소모(뷰어)가 이 값을 구독한다. */
  onFlashlightChange?: (on: boolean) => void;
}

export function PlayModeController({
  azimuthRef,
  playerRef,
  spawnPosition = [0, 4, 0],
  characterUrl,
  characterScale = 1,
  playerSpeed = 5,
  playerJumpForce = 12,
  mobileInputRef,
  onPositionChange,
  onObstacleEnter,
  onObstacleExit,
  interactables,
  interactRange = 3,
  onInteractableChange,
  onInteract,
  approachables,
  onApproachEnter,
  onApproachExit,
  focusPoint,
  movementLocked = false,
  onPointerFree,
  cameraMode = 'third',
  fixedTarget = null,
  respawnNonce = 0,
  flashlight,
  onFlashlightChange,
}: Props) {
  const keys = useRef({ w: false, a: false, s: false, d: false, space: false });
  // 현재 근접한 상호작용 대상 id (useFrame이 갱신, keydown이 읽음)
  const activeInteractRef = useRef<string | null>(null);
  // 현재 approach 범위 안에 있는 오브젝트 id 집합 (enter/exit 경계 감지용)
  const approachingRef = useRef<Set<string>>(new Set());
  // keydown 핸들러(1회 등록)가 최신 콜백을 읽도록 ref로 보관
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  // 드래그/터치 회전 핸들러(1회 등록)가 최신 잠금 상태를 읽도록 ref로 보관
  const lockedRef = useRef(movementLocked);
  lockedRef.current = movementLocked;
  // 1회 등록되는 포인터 핸들러가 최신 콜백을 읽도록 ref로 보관(effect 의존성에 넣으면 재등록된다).
  const onPointerFreeRef = useRef(onPointerFree);
  onPointerFreeRef.current = onPointerFree;
  // 손전등 — on/off는 이 컴포넌트가 소유(입력이 여기서 일어나므로). 부모(배터리 소모·안개)는 콜백으로만 통지받는다.
  const [flashOn, setFlashOn] = useState(false);
  const flashLightRef = useRef<THREE.SpotLight>(null);
  const flashTargetObj = useMemo(() => new THREE.Object3D(), []);
  const onFlashlightChangeRef = useRef(onFlashlightChange);
  onFlashlightChangeRef.current = onFlashlightChange;
  const { camera, gl } = useThree();
  const { world, rapier } = useRapier();
  const elevationRef = useRef(0.45);
  const cameraDistanceRef = useRef(8);
  const isDragging = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const _targetPos = useRef(new THREE.Vector3());
  const _camPos = useRef(new THREE.Vector3());
  const _camDir = useRef(new THREE.Vector3()); // 카메라 충돌(벽 뚫음 방지) 레이 방향
  const camTarget = useRef(new THREE.Vector3());

  // 캐릭터 방향 + 애니메이션 상태 공유
  const characterGroupRef = useRef<THREE.Group>(null);
  const movingRef = useRef(false);
  const jumpingRef = useRef(false);
  // 수동으로 적분하는 수직 속도 (킨매틱 바디는 물리 솔버가 다루지 않음)
  const verticalVelRef = useRef(0);
  // KinematicCharacterController.computedGrounded()의 직전 프레임 결과
  const groundedRef = useRef(false);
  const controllerRef = useRef<ReturnType<typeof world.createCharacterController> | null>(null);
  // 오브젝트별 마지막 접촉 시각(ms) — 벽에 밀착하면 접촉 판정이 프레임 간 깜빡이므로
  // 짧은 끊김은 같은 접촉으로 간주하고, 일정 시간 이상 떨어졌다 다시 닿으면 재발동
  const touchingTimesRef = useRef<Map<string, number>>(new Map());

  // 재시작(respawnNonce 변화) 시 캐릭터를 스폰 지점으로 되돌린다.
  //   restartGame()은 변수·오버라이드만 초기화하고 **캐릭터 위치는 안 건드렸다** →
  //   함정에 죽고 '다시 시작'을 눌러도 죽은 자리(함정 위)에 그대로 서 있어 즉시 재사망했다.
  //   초기 마운트(nonce 0)에는 RigidBody의 position prop이 이미 스폰이므로 건너뛴다.
  const prevRespawn = useRef(respawnNonce);
  useEffect(() => {
    if (prevRespawn.current === respawnNonce) return;
    prevRespawn.current = respawnNonce;
    const rb = playerRef.current;
    if (!rb) return;
    rb.setNextKinematicTranslation({ x: spawnPosition[0], y: Math.max(spawnPosition[1], 1), z: spawnPosition[2] });
    rb.setTranslation({ x: spawnPosition[0], y: Math.max(spawnPosition[1], 1), z: spawnPosition[2] }, true);
    verticalVelRef.current = 0;
    touchingTimesRef.current.clear(); // 죽은 자리의 접촉 기록을 지워야 부활 직후 같은 트리거가 안 터진다
    approachingRef.current.clear();
    // 죽어서 손전등이 켜진 채였다면 재시작 시 꺼둔다(배터리 소모도 부모 쪽에서 같이 멈춘다).
    if (flashOn) { setFlashOn(false); onFlashlightChangeRef.current?.(false); }
  }, [respawnNonce, spawnPosition, playerRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // 캐릭터 컨트롤러 생성 — 경사각 제한/지면 스냅을 엔진이 직접 처리
  useEffect(() => {
    const controller = world.createCharacterController(0.02);
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB_DEG * DEG2RAD);
    controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE_DEG * DEG2RAD);
    // 오토스텝 비활성화: 저폴리곤 지형(산 등)은 표면이 작은 계단 모양 facet으로
    // 쪼개져 있는 경우가 많아, 오토스텝이 그걸 "계단"으로 오인해 매 점프마다
    // 조금씩 밀어 올려 결국 경사각 제한을 무력화시키고 산을 넘게 만든다.
    controller.disableAutostep();
    controller.enableSnapToGround(0.3);
    controller.setApplyImpulsesToDynamicBodies(true);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world]);

  // 키보드
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.w = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.a = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.s = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.d = true;
      if (e.code === 'Space') { e.preventDefault(); keys.current.space = true; }
      // 상호작용: 근접 대상이 있으면 E키로 발동 (연타 무해 — 이벤트가 다시 실행될 뿐)
      if (e.code === 'KeyE' && !e.repeat) {
        const id = activeInteractRef.current;
        if (id) onInteractRef.current?.(id);
      }
      // 손전등(T): on/off 토글. 씬에 flashlight.enabled가 없으면 무반응(다른 게임에 영향 없음).
      if (e.code === 'KeyT' && !e.repeat && flashlight?.enabled) {
        setFlashOn((prev) => {
          const next = !prev;
          onFlashlightChangeRef.current?.(next);
          return next;
        });
      }
      // 킥(F): 앞쪽 근처 dynamic 물체를 앞·위로 강하게 날린다(질량 무관 일정 속도).
      if (e.code === 'KeyF' && !e.repeat) {
        const rb = playerRef.current;
        if (rb) {
          const p = rb.translation();
          const az = azimuthRef.current;
          const fx = -Math.sin(az), fz = -Math.cos(az); // 캐릭터 전방(XZ)
          const RANGE = 2.8, LAUNCH = 9, LAUNCH_UP = 5; // 목표 속도(m/s)
          world.forEachRigidBody((body) => {
            if (!body.isDynamic()) return;
            const bp = body.translation();
            const dx = bp.x - p.x, dz = bp.z - p.z;
            const dist = Math.hypot(dx, dz);
            if (dist > RANGE || dist < 1e-3) return;
            const nx = dx / dist, nz = dz / dist;
            if (nx * fx + nz * fz < 0.2) return; // 앞쪽(전방 ~78° 콘) 안의 것만
            const m = body.mass() || 1;
            // 질량 무관하게 일정 속도로 날리도록 impulse = 목표속도 × 질량
            body.applyImpulse({ x: nx * LAUNCH * m, y: LAUNCH_UP * m, z: nz * LAUNCH * m }, true);
          });
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.w = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.a = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.s = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.d = false;
      if (e.code === 'Space') keys.current.space = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // 마우스 드래그 카메라 회전.
  //   ★ 화면 끝 문제: clientX/Y는 커서가 화면 가장자리에 닿으면 더 이상 안 변한다 → 계속 끌어도 dx=0이라
  //     회전이 멈춘다(오른쪽으로 쭉 돌리면 어느 순간 안 도는 증상). Pointer Lock을 걸면 커서가 화면에
  //     갇히지 않고 movementX/Y로 무한히 델타가 들어온다.
  //   락이 거부되는 환경(권한·브라우저)에서는 기존 clientX 방식으로 자동 폴백한다.
  useEffect(() => {
    const canvas = gl.domElement;
    const locked = () => document.pointerLockElement === canvas;
    const onDown = (e: MouseEvent) => {
      if (lockedRef.current) return;
      // ★ 3D 캔버스에서 시작한 드래그만 카메라 회전. UI(편집으로·시점 전환 버튼·팝업 등) 클릭은 건드리지 않는다.
      //   이 가드가 없으면 버튼을 눌러도 포인터 락이 걸려 **클릭이 삼켜진다**(락 중엔 커서가 캔버스에 갇힘).
      if (e.target !== canvas) return;
      onPointerFreeRef.current?.(false); // 캔버스 클릭 = 조준 모드 복귀
      isDragging.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      // 사용자 제스처(mousedown) 안에서 요청해야 허용된다. 실패해도 무시(폴백 경로로 동작).
      if (!locked()) canvas.requestPointerLock?.();
    };
    const onMove = (e: MouseEvent) => {
      if (lockedRef.current) return;
      // 포인터 락 중엔 버튼을 떼도 계속 돌 수 있으므로 isDragging을 함께 본다.
      if (!isDragging.current) return;
      let dx: number, dy: number;
      if (locked()) {
        dx = e.movementX;
        dy = e.movementY;
      } else {
        dx = e.clientX - lastMouseRef.current.x;
        dy = e.clientY - lastMouseRef.current.y;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      }
      azimuthRef.current -= dx * 0.006;
      elevationRef.current = Math.max(0.1, Math.min(1.3, elevationRef.current + dy * 0.006));
    };
    const onUp = () => {
      isDragging.current = false;
      if (locked()) document.exitPointerLock?.();
    };
    // Esc 등으로 락이 풀리면 드래그도 끝난 것으로 처리(버튼을 뗀 이벤트가 안 올 수 있다).
    const onLockChange = () => {
      if (locked()) return;
      // 마우스업으로 우리가 푼 경우엔 isDragging이 이미 false다. 아직 true면 **Esc로 사용자가 푼 것** →
      // 브라우저 안내("Esc를 눌러 커서 표시")대로 커서를 돌려준다(크로스헤어 해제·마우스 조준 복귀).
      if (isDragging.current) onPointerFreeRef.current?.(true);
      isDragging.current = false;
    };
    document.addEventListener('pointerlockchange', onLockChange);
    const onTouchStart = (e: TouchEvent) => {
      if (lockedRef.current) return;
      if (e.touches.length === 1) lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (lockedRef.current) return;
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchRef.current.x;
        const dy = e.touches[0].clientY - lastTouchRef.current.y;
        lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        azimuthRef.current -= dx * 0.006;
        elevationRef.current = Math.max(0.1, Math.min(1.3, elevationRef.current + dy * 0.006));
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      // 플레이 모드를 벗어날 때 락이 남아 있으면 커서가 갇힌다.
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, [azimuthRef, gl]);

  useFrame((_state, delta) => {
    const rb = playerRef.current;
    const controller = controllerRef.current;
    if (!rb || !controller || rb.numColliders() === 0) return;

    const pos = rb.translation();
    const az = azimuthRef.current;
    const speed = playerSpeed;

    // 카메라는 (sin(az), cos(az)) 방향 오프셋에서 캐릭터를 바라보므로,
    // 카메라가 실제로 바라보는(전진) 방향은 그 반대인 (-sin(az), -cos(az))다.
    let vx = 0, vz = 0;
    if (keys.current.w) { vx -= Math.sin(az); vz -= Math.cos(az); }
    if (keys.current.s) { vx += Math.sin(az); vz += Math.cos(az); }
    if (keys.current.a) { vx -= Math.cos(az); vz += Math.sin(az); }
    if (keys.current.d) { vx += Math.cos(az); vz -= Math.sin(az); }

    const mobile = mobileInputRef?.current;
    if (mobile) {
      vx += -Math.sin(az) * mobile.fwd + Math.cos(az) * mobile.strafe;
      vz += -Math.cos(az) * mobile.fwd - Math.sin(az) * mobile.strafe;
    }

    // 상호작용 잠금 — 이동 입력 무시(중력·낙사는 계속 적용, 캐릭터가 제자리에 멈춤)
    if (movementLocked) { vx = 0; vz = 0; }

    const len = Math.sqrt(vx * vx + vz * vz);
    if (len > 0) { vx = (vx / len) * speed; vz = (vz / len) * speed; }

    // 중력 수동 적분 — 착지 상태면 누적된 낙하 속도를 리셋
    if (groundedRef.current && verticalVelRef.current < 0) {
      verticalVelRef.current = 0;
    }
    verticalVelRef.current -= GRAVITY * delta;

    // 점프 — 직전 프레임의 지면 판정(computedGrounded)에서만 허용 (잠금 중 금지)
    if ((keys.current.space || mobile?.jump) && groundedRef.current && !movementLocked) {
      verticalVelRef.current = playerJumpForce;
      groundedRef.current = false;
      keys.current.space = false;
      if (mobile) mobile.jump = false;
    }

    // 지형과 충돌·슬라이딩되는 실제 이동량을 캐릭터 컨트롤러가 계산
    // (오토스텝·지면 스냅을 엔진이 처리 — 수동 위치 보정 불필요)
    // EXCLUDE_SENSORS: 센서(Is Sensor) 오브젝트는 벽이 아니라 통과 가능한 트리거 영역 —
    // 제외하지 않으면 캡슐이 센서 표면에서 막혀 겹침이 생기지 않아 area_enter가 절대 발동 못 한다
    const desired = { x: vx * delta, y: verticalVelRef.current * delta, z: vz * delta };
    controller.computeColliderMovement(rb.collider(0), desired, QueryFilterFlags.EXCLUDE_SENSORS);
    const corrected = controller.computedMovement();

    // computedGrounded()는 maxSlopeClimbAngle과 무관하게 "발밑에 뭔가 닿아있으면"
    // true를 반환한다(격리 시뮬레이션으로 확인된 동작) — 46도보다 가파른 절벽 위에
    // 서 있어도 grounded=true로 나와 그 자리에서 또 점프가 가능해지고, 이게 반복되면
    // 절벽을 타고 올라가버린다. 그래서 접촉면 노멀 각도를 직접 검사해, 걸을 수 있는
    // 각도(<=MAX_SLOPE_CLIMB_DEG)의 접촉이 하나라도 있을 때만 진짜 접지로 인정한다.
    const rawGrounded = controller.computedGrounded();
    let touchingAnything = false;
    let hasWalkableContact = false;
    const currentTouchingIds = new Set<string>();
    const numCollisions = controller.numComputedCollisions();
    for (let i = 0; i < numCollisions; i++) {
      const collision = controller.computedCollision(i);
      if (!collision?.normal1) continue;
      touchingAnything = true;
      const angleDeg = Math.acos(Math.min(1, Math.max(-1, collision.normal1.y))) / DEG2RAD;
      if (angleDeg <= MAX_SLOPE_CLIMB_DEG) hasWalkableContact = true;
      // 접촉한 콜라이더의 RigidBody userData에서 씬 오브젝트 ID 수집 (area_enter 발동용)
      const userData = collision.collider?.parent()?.userData as { objectId?: string } | undefined;
      if (userData?.objectId) currentTouchingIds.add(userData.objectId);
    }
    groundedRef.current = rawGrounded && (touchingAnything ? hasWalkableContact : true);

    // 새로 접촉한 솔리드 오브젝트 → onObstacleEnter
    // 0.5초 이내의 접촉 끊김은 같은 접촉으로 간주 (밀착 시 판정 깜빡임으로 인한 중복 발동 방지)
    const TOUCH_GRACE_MS = 500;
    const now = performance.now();
    for (const id of currentTouchingIds) {
      const last = touchingTimesRef.current.get(id);
      if ((last === undefined || now - last > TOUCH_GRACE_MS) && onObstacleEnter) {
        onObstacleEnter(id);
      }
      touchingTimesRef.current.set(id, now);
    }
    // 오래 전에 접촉이 끊긴 항목 정리 — 이 시점이 area_exit 발동 시점
    for (const [id, t] of touchingTimesRef.current) {
      if (!currentTouchingIds.has(id) && now - t > TOUCH_GRACE_MS) {
        touchingTimesRef.current.delete(id);
        onObstacleExit?.(id);
      }
    }

    // 위쪽 이동이 경사각 제한/천장 충돌로 막혔다면 수직 속도를 소모
    if (verticalVelRef.current > 0 && corrected.y < desired.y - 1e-4) {
      verticalVelRef.current = 0;
    }

    const newPos = { x: pos.x + corrected.x, y: pos.y + corrected.y, z: pos.z + corrected.z };

    // 낙사 리스폰 — 스폰 y가 바닥(y=0) 아래로 저장된 구버전 씬 데이터라도
    // 리스폰은 바닥 위에서 시작해 무한 낙사 루프에 빠지지 않게 한다
    if (newPos.y < -10) {
      newPos.x = spawnPosition[0];
      newPos.y = Math.max(spawnPosition[1], 1);
      newPos.z = spawnPosition[2];
      verticalVelRef.current = 0;
    }

    rb.setNextKinematicTranslation(newPos);

    // ── 상호작용 근접 판정 — 범위 내에서 가장 가까운 interact 대상 산출 ──
    // (대상이 바뀔 때만 콜백 → 매 프레임 setState 방지)
    if (interactables && interactables.length > 0) {
      let nearest: string | null = null;
      let nearestDist = Infinity;
      for (const it of interactables) {
        const dx = it.x - newPos.x;
        const dy = it.y - newPos.y;
        const dz = it.z - newPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // 각 오브젝트의 자체 범위(range) 안에 들면서 가장 가까운 것을 대상으로
        if (dist <= it.range && dist < nearestDist) { nearestDist = dist; nearest = it.id; }
      }
      if (nearest !== activeInteractRef.current) {
        activeInteractRef.current = nearest;
        onInteractableChange?.(nearest);
      }
    } else if (activeInteractRef.current !== null) {
      activeInteractRef.current = null;
      onInteractableChange?.(null);
    }

    // ── approach 근접 자동 트리거 — 범위 경계를 넘는 순간 enter/exit 발동 ──
    // (interact와 동일 반경. 오브젝트별 in/out 상태를 Set으로 추적해 프레임마다 경계 교차만 콜백)
    if (approachables && approachables.length > 0) {
      const inside = approachingRef.current;
      for (const it of approachables) {
        const dx = it.x - newPos.x;
        const dy = it.y - newPos.y;
        const dz = it.z - newPos.z;
        const within = Math.sqrt(dx * dx + dy * dy + dz * dz) <= it.range;
        const was = inside.has(it.id);
        if (within && !was) { inside.add(it.id); onApproachEnter?.(it.id); }
        else if (!within && was) { inside.delete(it.id); onApproachExit?.(it.id); }
      }
    } else if (approachingRef.current.size > 0) {
      approachingRef.current.clear();
    }

    // 애니메이션 상태 업데이트
    const horizSpeed = Math.sqrt(vx * vx + vz * vz);
    movingRef.current = horizSpeed > 0.5;
    jumpingRef.current = verticalVelRef.current > 1.5;

    // 이동 방향으로 캐릭터 회전 (lerp)
    if (movingRef.current && characterGroupRef.current) {
      const targetAngle = Math.atan2(vx, vz);
      characterGroupRef.current.rotation.y = lerpAngle(
        characterGroupRef.current.rotation.y,
        targetAngle,
        0.15,
      );
    }

    // 1인칭이면 캐릭터 모델 숨김(카메라가 머리 안에 있어 시야 가림 방지), 아니면 표시.
    if (characterGroupRef.current) characterGroupRef.current.visible = cameraMode !== 'first';

    // 카메라 — 포커스 지점이 있으면 대상을 프레이밍(줌), 없으면 캐릭터 팔로우
    if (focusPoint) {
      // 대상 크기(radius)에 맞춰 적당한 거리로 다가감.
      // 정면(수평) 프레이밍 — 현재 카메라가 있는 수평 방위(azimuth)는 유지하되 상하 틸트는 제거해
      //   대상 중심과 같은 높이에서 수평으로 바라본다(위/아래에서 비스듬히 보던 문제 해소).
      _targetPos.current.set(focusPoint.x, focusPoint.y, focusPoint.z);
      const persp = camera as THREE.PerspectiveCamera;
      const fov = persp.isPerspectiveCamera ? persp.fov : 60;
      const dist = (focusPoint.radius / Math.sin((fov / 2) * DEG2RAD)) * 2.2;
      _camPos.current.copy(camera.position).sub(_targetPos.current);
      _camPos.current.y = 0; // 수평화 — 카메라 높이를 대상 중심에 맞춰 정면 시선
      if (_camPos.current.lengthSq() < 1e-6) _camPos.current.set(0, 0, 1);
      _camPos.current.normalize().multiplyScalar(dist).add(_targetPos.current);
      camera.position.lerp(_camPos.current, 0.12);
      camTarget.current.lerp(_targetPos.current, 0.15);
      camera.lookAt(camTarget.current);
    } else if (cameraMode === 'first') {
      // 1인칭 — 카메라를 캐릭터 눈높이에 두고 방위(az)+고도(el) 방향을 바라봄. (캐릭터 모델은 위에서 숨김)
      const el = elevationRef.current;
      _targetPos.current.set(newPos.x, newPos.y + 1.5, newPos.z);
      camera.position.copy(_targetPos.current);
      // 시선 방향 = 3인칭에서 카메라가 캐릭터를 보던 방향과 동일(=궤도 오프셋의 반대).
      _camDir.current.set(-Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el));
      camTarget.current.copy(_targetPos.current).addScaledVector(_camDir.current, 10);
      camera.lookAt(camTarget.current);
    } else if (cameraMode === 'topdown') {
      // 탑다운 — 캐릭터 위 높은 곳에서 살짝 뒤로 기울여 내려다봄(심즈/쿼터뷰 느낌). 방위(az)로 회전 가능.
      _targetPos.current.set(newPos.x, newPos.y + 1, newPos.z);
      camTarget.current.lerp(_targetPos.current, 0.15);
      const H = 14, back = 5;
      _camPos.current.set(camTarget.current.x + Math.sin(az) * back, camTarget.current.y + H, camTarget.current.z + Math.cos(az) * back);
      camera.position.copy(_camPos.current);
      camera.lookAt(camTarget.current);
    } else if (cameraMode === 'fixed' && fixedTarget) {
      // 고정 — 지정 지점(fixedTarget)에 카메라를 두고 캐릭터를 계속 바라봄(방 전체가 보이는 고정 앵글).
      _targetPos.current.set(newPos.x, newPos.y + 1, newPos.z);
      camTarget.current.lerp(_targetPos.current, 0.15);
      _camPos.current.set(fixedTarget.x, fixedTarget.y, fixedTarget.z);
      camera.position.lerp(_camPos.current, 0.2); // 전환 시 부드럽게 이동
      camera.lookAt(camTarget.current);
    } else {
      // 팔로우 카메라 (3인칭)
      const d = cameraDistanceRef.current;
      const el = elevationRef.current;
      _targetPos.current.set(newPos.x, newPos.y + 1, newPos.z);
      camTarget.current.lerp(_targetPos.current, 0.12);

      const camX = camTarget.current.x + d * Math.sin(az) * Math.cos(el);
      const camY = camTarget.current.y + d * Math.sin(el);
      const camZ = camTarget.current.z + d * Math.cos(az) * Math.cos(el);

      _camPos.current.set(camX, camY, camZ);
      // ── 카메라 충돌(벽 뚫음 방지) ── 캐릭터(camTarget)→카메라 방향으로 레이를 쏴, 사이에 벽(콜라이더)이
      //   있으면 카메라를 벽 앞까지 당긴다. → 3인칭 카메라가 벽을 뚫고 밖으로 나가 외부가 보이는 문제 해결.
      //   센서(트리거)·플레이어 자신은 제외. 벽 앞 0.3m 버퍼 + 최소 0.4m(캐릭터 안으로 안 파고들게).
      _camDir.current.subVectors(_camPos.current, camTarget.current);
      const wantDist = _camDir.current.length();
      if (wantDist > 1e-3) {
        _camDir.current.multiplyScalar(1 / wantDist); // normalize
        const rayC = new rapier.Ray(camTarget.current, _camDir.current);
        const hit = world.castRay(rayC, wantDist, true, QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, playerRef.current ?? undefined);
        if (hit && hit.timeOfImpact < wantDist) {
          const dClamped = Math.max(0.4, hit.timeOfImpact - 0.3);
          _camPos.current.copy(camTarget.current).addScaledVector(_camDir.current, dClamped);
        }
      }
      // 관성 제거 — 카메라 위치를 궤도 지점에 즉시 반영(회전 시 미끄러지지 않고 손 떼면 즉시 멈춤).
      // 캐릭터 추적의 부드러움은 위의 camTarget lerp(0.12)가 담당하므로 팔로우 자체는 여전히 부드럽다.
      camera.position.copy(_camPos.current);
      camera.lookAt(camTarget.current);
    }

    // 손전등 — 시선 방향(az)으로 매 프레임 위치·타겟 갱신. 캐릭터 몸통 회전(이동 시에만 lerp)이 아니라
    //   카메라 시선 기준이라 3인칭에서도 "보는 쪽"을 정확히 비춘다(interact 판정과 동일 전방벡터).
    //   newPos.y는 캡슐 "중심"(바닥=중심−0.9, 정수리=중심+0.9 — 위 캡슐 콜라이더 주석 참고) → 눈높이는 +0.7 정도.
    if (flashLightRef.current && flashOn) {
      const fx = -Math.sin(az), fz = -Math.cos(az);
      const eyeY = newPos.y + 0.7;
      flashLightRef.current.position.set(newPos.x, eyeY, newPos.z);
      const dist = flashlight?.distance ?? 14;
      flashTargetObj.position.set(newPos.x + fx * dist, eyeY - dist * 0.12, newPos.z + fz * dist);
    }
  });

  return (
    <>
      <RigidBody
        ref={playerRef}
        type="kinematicPosition"
        position={spawnPosition}
        colliders={false}
      >
        <CapsuleCollider args={[0.5, 0.4]} friction={0} frictionCombineRule={CoefficientCombineRule.Min} />
        <group ref={characterGroupRef}>
          {characterUrl ? (
            <GlbCharacter
              url={characterUrl}
              scale={characterScale}
              movingRef={movingRef}
              jumpingRef={jumpingRef}
            />
          ) : (
            <DefaultCharacter />
          )}
        </group>
      </RigidBody>
      {/* 손전등 — RigidBody 밖(캐릭터 로컬이 아니라 월드 좌표로 매 프레임 직접 갱신, useFrame 끝부분 참고).
          target은 PlaySceneLight와 동일한 패턴(별도 Object3D, primitive로 씬에 편입). */}
      {flashlight?.enabled && (
        <>
          <spotLight
            ref={flashLightRef}
            visible={flashOn}
            color={flashlight.color ?? '#fff4e0'}
            intensity={flashlight.intensity ?? 22}
            angle={flashlight.angle ?? 0.45}
            penumbra={0.55}
            distance={(flashlight.distance ?? 14) * 1.3}
            decay={2}
            target={flashTargetObj}
          />
          <primitive object={flashTargetObj} />
        </>
      )}
    </>
  );
}
