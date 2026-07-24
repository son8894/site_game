'use client';

import { useRef, useMemo, useContext } from 'react';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import type { ProjectSceneSchema, ObjectNodeSchema, EventSchema } from '@/types/scene';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ViewerObject } from './ViewerObject';
import { PhysicsObject } from './PhysicsObject';
import { PlayModeController } from './PlayModeController';
import { effectiveDialogue } from './useObjectDialogue';
import { computeMotion, makeWanderState } from '@/lib/motion';
import { computeActuator, computeDriveValue, makeDriveState, easeDrive } from '@/lib/actuator';
import { anchorLocalPoint } from '@/lib/pivotMath';
import { worldMatrix, localCenter, localBBox } from '@/lib/objectBBox';
import {
  classifyPlayObjects, isMovingColliderObj, isVisualOnlyMotionObj,
  isActuatorVisualObj, isActuatorColliderObj, type PlayBucket,
} from '@/lib/playRouting';
import { ActuatorDriveContext } from './ActuatorDriveContext';

const DEG2RAD = Math.PI / 180;

// 씬 라이트 렌더(플레이 모드) — spot/directional은 로컬 -Y target으로 방향이 object.rotation을
// 따라가게 한다(에디터/탐색 뷰어와 동일 규칙).
function PlaySceneLight({ object: o }: { object: ObjectNodeSchema }) {
  const lc = o.light!;
  const targetObj = useMemo(() => new THREE.Object3D(), []);
  const isDir = lc.type !== 'point';
  return (
    <group position={[o.position.x, o.position.y, o.position.z]}
      rotation={[o.rotation.x * DEG2RAD, o.rotation.y * DEG2RAD, o.rotation.z * DEG2RAD]}>
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

// (오브젝트별 거동 판정은 전부 src/lib/playRouting.ts — 이 파일과 GroupWithCollision이 같은 소스를 쓴다.
//  판정을 바꿀 땐 거기서 바꾸고 playRouting.test.ts로 상호배타/전수커버를 확인할 것.)

type ColliderAssets = Parameters<typeof ViewerObject>[0]['assets'];
type ColliderOnEvent = (obj: ObjectNodeSchema, trigger: EventSchema['trigger']) => void;

// motion.collider가 켜진 오브젝트 — kinematic RigidBody를 모션으로 구동해 "진짜 이동 장애물"로.
// (시각은 ViewerObject noMotion으로 정적 처리 → RigidBody가 움직이면 자식 메시가 함께 이동. pulse 제외)
const _mcOut = { pos: new THREE.Vector3(), rot: new THREE.Euler(), scl: new THREE.Vector3(), quat: new THREE.Quaternion() };
const _mcQuat = new THREE.Quaternion();
const _mcPos = new THREE.Vector3();
const _mcQuatBase = new THREE.Quaternion();
const _mcScl = new THREE.Vector3();
const _mcEuler = new THREE.Euler();
// 단일 오브젝트(또는 정적 그룹의 자식) 이동 콜라이더. kinematic은 월드 좌표로 구동되므로
// 부모 체인을 합성한 '월드 베이스' 기준으로 모션을 적용한다(루트면 로컬=월드).
function MovingCollider({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: Parameters<typeof ViewerObject>[0]['assets'];
  onEvent: (obj: ObjectNodeSchema, trigger: EventSchema['trigger']) => void;
  allObjects: ObjectNodeSchema[];
}) {
  const rbRef = useRef<RapierRigidBody>(null);
  const phase = useRef(Math.random() * 100);
  const wander = useRef(makeWanderState());
  worldMatrix(allObjects, object.id).decompose(_mcPos, _mcQuatBase, _mcScl);
  _mcEuler.setFromQuaternion(_mcQuatBase);
  const basePos: [number, number, number] = [_mcPos.x, _mcPos.y, _mcPos.z];
  const baseRot: [number, number, number] = [_mcEuler.x, _mcEuler.y, _mcEuler.z];
  const worldScl: [number, number, number] = [_mcScl.x, _mcScl.y, _mcScl.z];
  // 형상 중심 피벗(프리미티브=0, GLB 등은 원점이 중심과 달라 spin wobble → 중심 기준 회전)
  const lc = localCenter(allObjects, assets, object.id);
  const pivot: [number, number, number] | null = lc ? [lc.x, lc.y, lc.z] : null;
  useFrame((state, dt) => {
    const rb = rbRef.current;
    if (!rb || !object.motion) return;
    computeMotion(object.motion, basePos, baseRot, worldScl, state.clock.elapsedTime + phase.current, dt, wander.current, _mcOut, pivot);
    rb.setNextKinematicTranslation(_mcOut.pos);
    rb.setNextKinematicRotation(_mcOut.quat);
  });
  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders={getKinematicColliderType(object)}
      position={basePos}
      rotation={baseRot}
      userData={{ objectId: object.id }}
    >
      <group scale={worldScl}>
        <ViewerObject object={object} assets={assets} onEvent={onEvent} noTransform noMotion />
      </group>
    </RigidBody>
  );
}

// 관절(actuator.collider) 오브젝트 — kinematic 강체를 관절로 구동해 "진짜 부딪히는 문/장애물"로.
// 구동값: manual/oscillate=자체 계산 · variable/event=ActuatorDriveContext 목표를 향해 이징(MotionGroup과 동일).
function ActuatorCollider({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: ColliderAssets;
  onEvent: ColliderOnEvent;
  allObjects: ObjectNodeSchema[];
}) {
  const rbRef = useRef<RapierRigidBody>(null);
  const phase = useRef(Math.random() * 100);
  const driveState = useRef(makeDriveState());
  const driveMap = useContext(ActuatorDriveContext);
  worldMatrix(allObjects, object.id).decompose(_mcPos, _mcQuatBase, _mcScl);
  _mcEuler.setFromQuaternion(_mcQuatBase);
  const basePos: [number, number, number] = [_mcPos.x, _mcPos.y, _mcPos.z];
  const baseRot: [number, number, number] = [_mcEuler.x, _mcEuler.y, _mcEuler.z];
  const worldScl: [number, number, number] = [_mcScl.x, _mcScl.y, _mcScl.z];
  const hingeVec = useMemo(() => {
    const a = object.actuator;
    if (!a) return null;
    if (object.isActuator) return null; // 모터형: 원점이 경첩
    const lb = localBBox(allObjects, assets, object.id);
    if (!lb || lb.isEmpty()) return null;
    return anchorLocalPoint(lb, a.hinge ?? { x: 0.5, y: 0.5, z: 0.5 });
  }, [object.actuator, object.isActuator, object.id, allObjects, assets]);
  useFrame((state, dt) => {
    const rb = rbRef.current;
    const a = object.actuator;
    if (!rb || !a) return;
    let dv: number;
    if (a.drive === 'variable' || a.drive === 'event') {
      dv = easeDrive(driveState.current, driveMap[object.id] ?? a.value ?? 0, a.ease, a.speed ?? 1, dt);
    } else {
      dv = computeDriveValue(a, state.clock.elapsedTime + phase.current);
    }
    computeActuator(a, hingeVec, basePos, baseRot, worldScl, dv, _mcOut);
    rb.setNextKinematicTranslation(_mcOut.pos);
    rb.setNextKinematicRotation(_mcOut.quat);
  });
  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders={getKinematicColliderType(object)}
      position={basePos}
      rotation={baseRot}
      userData={{ objectId: object.id }}
    >
      <group scale={worldScl}>
        {/* allObjects 전달 — 모터형(그룹)이면 자식(연결된 부품)까지 렌더돼 hull/trimesh 콜라이더가 생성됨 */}
        <ViewerObject object={object} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform noMotion />
      </group>
    </RigidBody>
  );
}

// 모션+콜라이더 켠 그룹 — 그룹 전체를 하나의 kinematic 강체로 묶어 자식 콜라이더가 함께 이동.
// 자식 메시들을 convex hull 콜라이더로 자동 생성(캐릭터와 견고하게 충돌). 그룹 스케일은 내부 group에 적용.
// 제약: 자식이 개별 실제형상(trimesh)이 아니라 볼록 껍질로 근사됨(오목 형상은 실제보다 두꺼운 충돌).
function MovingGroupCollider({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: ColliderAssets;
  onEvent: ColliderOnEvent;
  allObjects: ObjectNodeSchema[];
}) {
  const rbRef = useRef<RapierRigidBody>(null);
  const phase = useRef(Math.random() * 100);
  const wander = useRef(makeWanderState());
  const basePos: [number, number, number] = [object.position.x, object.position.y, object.position.z];
  const baseRot: [number, number, number] = [object.rotation.x * DEG2RAD, object.rotation.y * DEG2RAD, object.rotation.z * DEG2RAD];
  const baseScl: [number, number, number] = [object.scale.x, object.scale.y, object.scale.z];
  // 그룹은 원점(자식 위치 평균)이 형상 중심과 어긋날 수 있어, 형상 중심을 회전 피벗으로 넘겨 제자리 회전시킨다.
  const lc = localCenter(allObjects, assets, object.id);
  const pivot: [number, number, number] | null = lc ? [lc.x, lc.y, lc.z] : null;
  useFrame((state, dt) => {
    const rb = rbRef.current;
    if (!rb || !object.motion) return;
    computeMotion(object.motion, basePos, baseRot, baseScl, state.clock.elapsedTime + phase.current, dt, wander.current, _mcOut, pivot);
    rb.setNextKinematicTranslation(_mcOut.pos);
    rb.setNextKinematicRotation(_mcOut.quat);
  });
  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders="hull"
      position={basePos}
      rotation={baseRot}
      userData={{ objectId: object.id }}
    >
      <group scale={baseScl}>
        <ViewerObject object={object} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform noMotion />
      </group>
    </RigidBody>
  );
}

// move_object로 옮겨지는(모션 없는) 그룹 — 그룹 전체를 하나의 kinematic 강체로 묶어 자식 콜라이더가
// 함께 이동한다. 정적 GroupWithCollision은 자식 콜라이더가 부모 group 이동을 따라가지 않아
// '유령 콜라이더'(시각만 미끄러지고 벽은 원래 자리)가 되던 것을 해결. posOverride로 매 프레임 갱신되는
// object.position을 setNextKinematicTranslation으로 반영(회전/스케일은 이동 중 불변). hull 콜라이더 근사.
const _mgPos = new THREE.Vector3();
function MovedGroupCollider({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: ColliderAssets;
  onEvent: ColliderOnEvent;
  allObjects: ObjectNodeSchema[];
}) {
  const rbRef = useRef<RapierRigidBody>(null);
  const baseRot: [number, number, number] = [object.rotation.x * DEG2RAD, object.rotation.y * DEG2RAD, object.rotation.z * DEG2RAD];
  const baseScl: [number, number, number] = [object.scale.x, object.scale.y, object.scale.z];
  const initPos: [number, number, number] = [object.position.x, object.position.y, object.position.z];
  useFrame(() => {
    const rb = rbRef.current;
    if (!rb) return;
    // object.position은 effectiveScene(posOverride)으로 매 프레임 갱신 — 최신 위치로 kinematic 구동.
    _mgPos.set(object.position.x, object.position.y, object.position.z);
    rb.setNextKinematicTranslation(_mgPos);
  });
  return (
    <RigidBody
      ref={rbRef}
      type="kinematicPosition"
      colliders="hull"
      position={initPos}
      rotation={baseRot}
      userData={{ objectId: object.id }}
    >
      <group scale={baseScl}>
        <ViewerObject object={object} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform noMotion />
      </group>
    </RigidBody>
  );
}

function getColliderType(object: ObjectNodeSchema) {
  // GLB(산·바위 등 오목한 지형 포함)는 trimesh로 실제 메쉬 형태 그대로 충돌 처리.
  // hull(볼록 껍질)은 오목한 형태를 매끈하게 뭉개버려 절벽/급경사가 실제보다 완만한
  // 경사로 처리되는 원인이 되므로 사용하지 않는다 (fixed 바디는 trimesh 사용 가능).
  return object.primitiveShape === 'box' ? 'cuboid'
    : object.primitiveShape === 'sphere' ? 'ball'
    : 'trimesh';
}

// 움직이는(kinematic) 강체용 콜라이더 — **trimesh를 쓰면 안 된다.**
// Rapier의 캐릭터 컨트롤러는 kinematic trimesh를 안정적으로 밀어내지 못해, 캐릭터가 그대로 통과한다
// (모터/그룹은 primitiveShape이 없어 getColliderType이 trimesh를 주므로 '닫힌 문을 뚫고 지나가는' 버그가 났다).
// 볼록 껍질(hull)은 kinematic에서도 견고하게 막는다. 오목 형상이 두꺼워지는 근사는 감수한다.
function getKinematicColliderType(object: ObjectNodeSchema) {
  const t = getColliderType(object);
  return t === 'trimesh' ? 'hull' : t;
}

// physics.enabled가 꺼진 오브젝트도 플레이 모드에서 고정 콜라이더를 부여
// userData.objectId: 캐릭터 컨트롤러 접촉 감지(area_enter)용 식별자
function AutoCollider({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: ColliderAssets;
  onEvent: ColliderOnEvent;
  allObjects: ObjectNodeSchema[];
}) {
  return (
    <RigidBody
      type="fixed"
      colliders={getColliderType(object)}
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={[object.rotation.x * DEG2RAD, object.rotation.y * DEG2RAD, object.rotation.z * DEG2RAD]}
      userData={{ objectId: object.id }}
    >
      <ViewerObject object={object} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform />
    </RigidBody>
  );
}

// 그룹 오브젝트를 재귀적으로 렌더링하면서 자식 오브젝트 각각에 콜라이더를 부여.
// THREE.js group으로 부모 transform을 적용하고, 그 안의 RigidBody position은 로컬 좌표로
// 해석되어 Rapier가 최종 world position을 올바르게 계산한다.
// 제약: Rapier는 강체에 비균일 스케일을 지원하지 않으므로, 회전된 중첩 그룹에
// 비균일 스케일이 걸리면 콜라이더와 비주얼이 어긋날 수 있다 (균일 스케일은 안전).
function GroupWithCollision({ object, assets, onEvent, allObjects }: {
  object: ObjectNodeSchema;
  assets: ColliderAssets;
  onEvent: ColliderOnEvent;
  allObjects: ObjectNodeSchema[];
}) {
  const children = allObjects.filter((o) => o.parentId === object.id && o.visible);

  return (
    <group
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={[object.rotation.x * DEG2RAD, object.rotation.y * DEG2RAD, object.rotation.z * DEG2RAD]}
      scale={[object.scale.x, object.scale.y, object.scale.z]}
    >
      {children.map((child) => {
        if (child.isGroup) {
          // 중첩 모션 그룹은 루트 그룹만 kinematic 지원 → 여기선 시각 전용(콜라이더 미동반)으로 애니메이션만.
          // 모터(액추에이터) 자식도 마찬가지 — 정적 GroupWithCollision로 두면 관절이 굳어 안 돈다.
          //   → ViewerObject가 서브트리를 구동(자식 회전). 이로써 평범한 그룹 안에 모터 여러 개를 넣은
          //   조립품(기어 한 쌍·쌍여닫이문 등)도 플레이 모드에서 동작한다. doc/PIVOT_MANIPULATION.md §6.
          // 관절(콜라이더 동반) 그룹 자식 → 상위에서 ActuatorCollider(월드 기준 kinematic)로 렌더 → 여기선 스킵(이중 렌더 방지).
          if (isActuatorColliderObj(child)) return null;
          // 모션·모터·관절이 걸린 그룹 자식은 ViewerObject가 구동(정적 GroupWithCollision로 두면 굳는다).
          if (child.motion || child.isActuator || child.actuator) {
            return <ViewerObject key={child.id} object={child} assets={assets} onEvent={onEvent} allObjects={allObjects} />;
          }
          return (
            <GroupWithCollision
              key={child.id}
              object={child}
              assets={assets}
              onEvent={onEvent}
              allObjects={allObjects}
            />
          );
        }
        if (child.physics.enabled) {
          return <PhysicsObject key={child.id} object={child} assets={assets} onEvent={onEvent} />;
        }
        if (child.light) {
          // 라이트는 콜라이더 불필요, 위치만 적용
          return (
            <ViewerObject key={child.id} object={child} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform />
          );
        }
        // 이동 콜라이더 자식 → 상위(PlayCanvas)에서 월드 kinematic으로 렌더하므로 여기선 스킵(이중 렌더 방지).
        if (isMovingColliderObj(child)) return null;
        // 관절(콜라이더 동반) 자식도 동일 — 상위에서 ActuatorCollider(월드 기준 kinematic)로 렌더.
        //   예전엔 이 분기가 없어 아래 정적 RigidBody로 떨어졌고, 관절이 시각적으로만 움직이고 실제로는 안 부딪혔다.
        if (isActuatorColliderObj(child)) return null;
        // 움직이는 모션·콜라이더 미동반 자식 → 콜라이더 없이 시각만(통과 가능). 부모 group이 로컬 좌표 담당.
        //   관절(콜라이더 미동반)도 같다 — 예전엔 정적 RigidBody로 떨어져, 시각은 관절로 움직이는데
        //   콜라이더는 원래 자리에 남는 '유령 콜라이더'가 됐다(루트 오브젝트는 이미 이렇게 처리 중).
        if (isVisualOnlyMotionObj(child) || isActuatorVisualObj(child)) {
          return <ViewerObject key={child.id} object={child} assets={assets} onEvent={onEvent} allObjects={allObjects} />;
        }
        // 일반(정적/펄스) 오브젝트: RigidBody position이 부모 group 기준 로컬 좌표로 처리됨
        return (
          <RigidBody
            key={child.id}
            type="fixed"
            colliders={getColliderType(child)}
            position={[child.position.x, child.position.y, child.position.z]}
            rotation={[child.rotation.x * DEG2RAD, child.rotation.y * DEG2RAD, child.rotation.z * DEG2RAD]}
            userData={{ objectId: child.id }}
          >
            <ViewerObject object={child} assets={assets} onEvent={onEvent} allObjects={allObjects} noTransform />
          </RigidBody>
        );
      })}
    </group>
  );
}

interface Props {
  scene: ProjectSceneSchema;
  azimuthRef: React.MutableRefObject<number>;
  onObjectClick: (obj: ObjectNodeSchema, trigger: EventSchema['trigger']) => void;
  mobileInputRef?: React.MutableRefObject<{ fwd: number; strafe: number; jump: boolean }>;
  /** 근접한 상호작용(interact) 대상이 바뀔 때 — 뷰어의 E 프롬프트 표시용 */
  onInteractPromptChange?: (obj: ObjectNodeSchema | null) => void;
  /** 런타임 통과 가능(콜라이더 제거) 오브젝트 id 집합 — set_passable/toggle_collision */
  passableIds?: Set<string>;
  /** move_object로 런타임 이동 중인 오브젝트 id 집합 — 그룹을 kinematic 강체로 라우팅(콜라이더 동반 이동) */
  movedIds?: Set<string>;
  /** 플레이 모드 카메라 포커스 지점(월드+반경) — 있으면 팔로우 대신 대상 줌 */
  focusPoint?: { x: number; y: number; z: number; radius: number } | null;
  /** 캐릭터 이동 잠금 — 팝업·포커스 등 상호작용 진행 중 */
  movementLocked?: boolean;
  /** Esc로 포인터 락 해제 시 true — 커서/크로스헤어 복귀용(ViewerClient가 처리) */
  onPointerFree?: (v: boolean) => void;
  /** 카메라 모드 (구역별/토글) */
  cameraMode?: 'third' | 'first' | 'topdown' | 'fixed';
  /** fixed 카메라 대상 오브젝트 id — 그 위치에서 캐릭터를 바라봄 */
  cameraFixedId?: string | null;
  /** 재시작 카운터 — 바뀌면 캐릭터를 스폰으로 되돌린다. */
  respawnNonce?: number;
  /** 손전등 on/off가 바뀔 때(뷰어가 배터리 소모·안개 시야를 구독) — scene.environment.flashlight는 여기서 직접 읽는다. */
  onFlashlightChange?: (on: boolean) => void;
}

export function PlayCanvas({ scene, azimuthRef, onObjectClick, mobileInputRef, onInteractPromptChange, passableIds, movedIds, focusPoint, movementLocked, onPointerFree, cameraMode, cameraFixedId, respawnNonce, onFlashlightChange }: Props) {
  const playerRef = useRef<RapierRigidBody>(null);
  const assets = scene.assets ?? [];

  const allObjects = scene.objects;
  // 근접 감지 대상(루트 오브젝트) — E키/프롬프트가 필요한 것들.
  // interact 이벤트가 있거나, 근접이 필요한 대화(항상+자동 앰비언트는 근접 불필요라 제외).
  // (중첩 그룹 자식은 위치가 로컬 좌표라 월드 근접 판정이 어긋나므로 v1은 루트만 지원)
  const needsProximity = (o: ObjectNodeSchema) => {
    if (o.events?.some((e) => e.trigger === 'interact')) return true;
    const dlg = effectiveDialogue(o);
    return !!dlg && (dlg.show === 'approach' || dlg.show === 'interact' || dlg.advance === 'manual');
  };
  // 상호작용 근접 범위 — 오브젝트별 값 우선, 없으면 씬 기본값(EnvSchema.interactRange), 그것도 없으면 3m.
  const sceneRange = scene.environment.interactRange ?? 3;
  const effRange = (o: ObjectNodeSchema) => o.interactRange ?? sceneRange;
  const interactables = allObjects
    .filter((o) => !o.parentId && o.visible && needsProximity(o))
    .map((o) => ({ id: o.id, x: o.position.x, y: o.position.y, z: o.position.z, range: effRange(o) }));
  // approach 근접 자동 트리거 대상 — approach_enter/exit 이벤트를 가진 루트 오브젝트.
  // (interact와 동일 범위 규칙. 오브젝트는 솔리드 유지 가능 — area와 달리 센서 불필요)
  const approachables = allObjects
    .filter((o) => !o.parentId && o.visible && o.events?.some((e) => e.trigger === 'approach_enter' || e.trigger === 'approach_exit'))
    .map((o) => ({ id: o.id, x: o.position.x, y: o.position.y, z: o.position.z, range: effRange(o) }));
  // 런타임 통과(콜라이더 제거) 대상 — set_passable/toggle_collision. 시각은 유지하고 콜라이더만 뺀다(문 열림).
  // fixed 카메라 대상 오브젝트의 월드 위치(그 지점에서 캐릭터를 바라봄). 대상 없으면 null → third로 폴백.
  const cameraFixedTarget = useMemo(() => {
    if (cameraMode !== 'fixed' || !cameraFixedId) return null;
    if (!allObjects.some((o) => o.id === cameraFixedId)) return null;
    const m = worldMatrix(allObjects, cameraFixedId);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    return { x: pos.x, y: pos.y, z: pos.z };
  }, [cameraMode, cameraFixedId, allObjects]);
  // ── 렌더 라우팅 ────────────────────────────────────────────────
  // 버킷 판정은 전부 순수 함수 `classifyPlayObjects`에 있다(src/lib/playRouting.ts).
  //   여기 흩어진 filter 체인으로 두던 동안 같은 종류의 버그가 4번 났다(유령 콜라이더·이중 렌더·
  //   중첩 모터 누락·그룹 관절 얼어붙음). 이제 상호배타/전수커버가 테스트로 고정된다
  //   → `npx tsx src/lib/playRouting.test.ts`. **판정을 바꿀 땐 이 파일이 아니라 playRouting.ts를 고칠 것.**
  const routing = useMemo(
    () => classifyPlayObjects(allObjects, { passableIds, movedIds }),
    [allObjects, passableIds, movedIds],
  );
  const inBucket = (b: PlayBucket) => allObjects.filter((o) => routing.get(o.id) === b);
  const lightObjects = inBucket('light');
  const movingGroupColliders = inBucket('group-moving-collider');
  const movedGroups = inBucket('group-moved');
  const groupObjects = inBucket('group-static');
  const movingGroups = inBucket('group-visual');
  const movingColliderObjects = inBucket('moving-collider');
  const visualMotionObjects = inBucket('visual-motion');
  const actuatorVisualObjects = inBucket('actuator-visual');
  const actuatorColliderObjects = inBucket('actuator-collider');
  const passableVisualObjects = inBucket('passable-visual');
  const autoObjects = inBucket('auto');
  const physicsObjects = inBucket('physics');

  const characterAsset = scene.environment.playerCharacterId
    ? assets.find((a) => a.id === scene.environment.playerCharacterId)
    : undefined;

  return (
    <Physics gravity={[0, -20, 0]} timeStep="vary">
      {/* 씬 라이트 오브젝트 */}
      {lightObjects.map((o) => (
        <PlaySceneLight key={o.id} object={o} />
      ))}

      {/* 바닥 */}
      <RigidBody type="fixed" name="floor">
        <CuboidCollider args={[500, 0.1, 500]} position={[0, -0.1, 0]} />
      </RigidBody>

      {/* 경계 벽 — friction=0 으로 벽에 눌렸을 때 공중에 걸리는 현상 방지 */}
      {(scene.environment.boundary ?? 0) > 0 && (() => {
        const bx = scene.environment.boundary!;
        const bshape = scene.environment.boundaryShape ?? 'rect';
        // 다각형: 각 변(edge)마다 그 변에 정렬된 박스 콜라이더 한 개.
        if (bshape === 'polygon') {
          const poly = scene.environment.boundaryPolygon;
          if (!poly || poly.length < 3) return null;
          return (
            <>
              {poly.map((a, i) => {
                const b = poly[(i + 1) % poly.length];
                const dx = b.x - a.x, dz = b.z - a.z;
                const len = Math.hypot(dx, dz);
                if (len < 1e-3) return null;
                return (
                  <RigidBody key={i} type="fixed" friction={0} position={[(a.x + b.x) / 2, 15, (a.z + b.z) / 2]} rotation={[0, Math.atan2(dx, dz), 0]}>
                    <CuboidCollider args={[0.5, 15, len / 2 + 0.3]} />
                  </RigidBody>
                );
              })}
            </>
          );
        }
        // 원형: 반지름 r 밖으로 못 나가게 접선 방향 박스 N개를 링으로 배치(속 빈 실린더 프리미티브 없음).
        if (bshape === 'circle') {
          const r = bx;
          const N = Math.max(24, Math.min(72, Math.round(r * 3)));  // 반지름 클수록 세분↑
          const chordHalf = (Math.PI * r / N) * 1.35;               // 이웃과 겹치게 여유
          return (
            <>
              {Array.from({ length: N }).map((_, i) => {
                const a = (i / N) * Math.PI * 2;
                const cx = Math.cos(a) * (r + 0.5), cz = Math.sin(a) * (r + 0.5); // 벽을 r 살짝 밖에(안쪽면≈r)
                return (
                  <RigidBody key={i} type="fixed" friction={0} position={[cx, 15, cz]} rotation={[0, -a, 0]}>
                    <CuboidCollider args={[0.5, 15, chordHalf]} />
                  </RigidBody>
                );
              })}
            </>
          );
        }
        const bz = scene.environment.boundaryZ ?? bx;
        return (
          <>
            <RigidBody type="fixed" friction={0}><CuboidCollider args={[bx + 1, 30, 0.5]} position={[0, 15, -(bz + 0.5)]} /></RigidBody>
            <RigidBody type="fixed" friction={0}><CuboidCollider args={[bx + 1, 30, 0.5]} position={[0, 15,   bz + 0.5 ]} /></RigidBody>
            <RigidBody type="fixed" friction={0}><CuboidCollider args={[0.5, 30, bz + 1]} position={[  bx + 0.5,  15, 0]} /></RigidBody>
            <RigidBody type="fixed" friction={0}><CuboidCollider args={[0.5, 30, bz + 1]} position={[-(bx + 0.5), 15, 0]} /></RigidBody>
          </>
        );
      })()}

      {/* 그룹 오브젝트 — 자식 각각에 재귀적으로 콜라이더 부여 */}
      {groupObjects.map((obj) => (
        <GroupWithCollision key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 모션+콜라이더 그룹 — 하나의 kinematic 강체로 묶어 이동(진짜 장애물) */}
      {movingGroupColliders.map((obj) => (
        <MovingGroupCollider key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* move_object로 옮겨지는 그룹 — kinematic 강체로 콜라이더까지 함께 이동 */}
      {movedGroups.map((obj) => (
        <MovedGroupCollider key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 모션 걸린 그룹(콜라이더 미동반) — 시각 전용, MotionGroup 애니메이션 유지 */}
      {movingGroups.map((obj) => (
        <ViewerObject key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* motion.collider 오브젝트(루트+정적그룹 자식) — 월드 kinematic 이동 장애물 */}
      {movingColliderObjects.map((obj) => (
        <MovingCollider key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 움직이는 모션·콜라이더 미동반 — 시각 전용(콜라이더 없음, 통과 가능) */}
      {visualMotionObjects.map((obj) => (
        <ViewerObject key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 관절(콜라이더 미동반) — 시각 전용 ViewerObject가 관절 구동(문 여닫힘). */}
      {actuatorVisualObjects.map((obj) => (
        <ViewerObject key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 관절(콜라이더 동반) — kinematic 강체를 관절로 구동(진짜 부딪히는 문/장애물). 5c.
          오브젝트·모터·평범한 그룹 공통(그룹이면 서브트리가 하나의 hull 강체로 묶여 함께 움직인다). */}
      {actuatorColliderObjects.map((obj) => (
        <ActuatorCollider key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* 통과(set_passable/toggle_collision) 대상 루트 오브젝트 — 콜라이더 없이 시각만(문 열림) */}
      {passableVisualObjects.map((obj) => (
        <ViewerObject key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* physics 미설정 오브젝트 — 자동 고정 콜라이더 */}
      {autoObjects.map((obj) => (
        <AutoCollider key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} allObjects={allObjects} />
      ))}

      {/* physics 설정 오브젝트 — 기존 설정 그대로 */}
      {physicsObjects.map((obj) => (
        <PhysicsObject key={obj.id} object={obj} assets={assets} onEvent={onObjectClick} />
      ))}

      <PlayModeController
        azimuthRef={azimuthRef}
        playerRef={playerRef}
        onObstacleEnter={(objectId) => {
          // 캐릭터가 솔리드 오브젝트에 접촉 — area_enter 이벤트가 있으면 발동
          const obj = allObjects.find((o) => o.id === objectId);
          if (obj && obj.events.some((e) => e.trigger === 'area_enter')) {
            onObjectClick(obj, 'area_enter');
          }
        }}
        onObstacleExit={(objectId) => {
          // 접촉이 끝남 — area_exit 이벤트가 있으면 발동
          const obj = allObjects.find((o) => o.id === objectId);
          if (obj && obj.events.some((e) => e.trigger === 'area_exit')) {
            onObjectClick(obj, 'area_exit');
          }
        }}
        spawnPosition={scene.environment.playerStartPosition
          ? [scene.environment.playerStartPosition.x, scene.environment.playerStartPosition.y, scene.environment.playerStartPosition.z]
          : undefined}
        characterUrl={characterAsset?.dracoUrl}
        characterScale={scene.environment.playerCharacterScale ?? 1}
        playerSpeed={scene.environment.playerSpeed}
        playerJumpForce={scene.environment.playerJumpForce}
        respawnNonce={respawnNonce}
        flashlight={scene.environment.flashlight}
        onFlashlightChange={onFlashlightChange}
        mobileInputRef={mobileInputRef}
        interactables={interactables}
        onInteractableChange={(id) =>
          onInteractPromptChange?.(id ? (allObjects.find((o) => o.id === id) ?? null) : null)
        }
        onInteract={(id) => {
          const obj = allObjects.find((o) => o.id === id);
          if (obj) onObjectClick(obj, 'interact');
        }}
        approachables={approachables}
        onApproachEnter={(id) => {
          const obj = allObjects.find((o) => o.id === id);
          if (obj && obj.events.some((e) => e.trigger === 'approach_enter')) onObjectClick(obj, 'approach_enter');
        }}
        onApproachExit={(id) => {
          const obj = allObjects.find((o) => o.id === id);
          if (obj && obj.events.some((e) => e.trigger === 'approach_exit')) onObjectClick(obj, 'approach_exit');
        }}
        focusPoint={focusPoint}
        movementLocked={movementLocked}
        onPointerFree={onPointerFree}
        cameraMode={cameraFixedTarget || cameraMode !== 'fixed' ? cameraMode : 'third'}
        fixedTarget={cameraFixedTarget}
      />
    </Physics>
  );
}
