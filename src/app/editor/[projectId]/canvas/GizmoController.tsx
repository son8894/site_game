'use client';

import { useRef, useEffect, useState } from 'react';
import { TransformControls } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSceneStore } from '@/store/sceneStore';
import { useLiveTransformStore } from '@/store/liveTransformStore';
import { useObjectRefs } from './ObjectRefsContext';
import { CHARACTER_PREVIEW_ID } from './CharacterPreview';
import { localCenter, worldBBox, localBBox } from '@/lib/objectBBox';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// 재사용 스크래치 (프록시↔오브젝트 변환용)
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _lp = new THREE.Vector3();
const _lq = new THREE.Quaternion();
const _ls = new THREE.Vector3();
const _snapBox = new THREE.Box3();
const OBJECT_SNAP_THRESHOLD = 0.2; // 월드 거리(m) — 이 안쪽이면 다른 오브젝트 모서리/중심에 흡착

interface Props {
  orbitRef: React.RefObject<OrbitControlsImpl | null>;
  gizmoDraggingRef: React.MutableRefObject<boolean>;
}

function MultiGizmo({ orbitRef, gizmoDraggingRef }: Props) {
  const { selectedIds, transformMode, transformSpace,
    snapEnabled, snapTranslate, snapRotate, commitTransforms } = useSceneStore();
  const refsMap = useObjectRefs();

  // ref callback → group이 마운트되는 순간 상태 업데이트 → 리렌더 발생
  const [pivotEl, setPivotEl] = useState<THREE.Group | null>(null);

  const dragStartPivot = useRef(new THREE.Vector3());
  const dragStartPositions = useRef<Map<string, THREE.Vector3>>(new Map());
  const dragStartQuaternions = useRef<Map<string, THREE.Quaternion>>(new Map());
  const dragStartScales = useRef<Map<string, THREE.Vector3>>(new Map());

  // 피벗을 선택 오브젝트들의 '월드 bbox union 중심'에 둔다.
  //  - 그룹 단일 기즈모(bbox 중심)와 동일 기준 → 다중선택 기즈모와 그룹 기즈모 위치가 일치(문제 B 해결).
  //  - 드래그 중이 아니면 매 프레임 재동기화 → undo/redo 등 외부 위치 변경 후에도 피벗이 오브젝트를 따라간다
  //    (스테일 피벗이 다음 상호작용에서 잘못된 델타로 오브젝트를 끌어당기던 문제 A 해결).
  const syncPivot = () => {
    if (!pivotEl || selectedIds.length < 2) return;
    const { objects, assets } = useSceneStore.getState();
    const box = new THREE.Box3().makeEmpty();
    for (const id of selectedIds) {
      const b = worldBBox(objects, assets, id);
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) return;
    box.getCenter(pivotEl.position);
    pivotEl.rotation.set(0, 0, 0);
    pivotEl.scale.set(1, 1, 1);
  };
  useEffect(syncPivot, [pivotEl, selectedIds]); // 초기/선택 변경 시 배치
  useFrame(() => { if (!gizmoDraggingRef.current) syncPivot(); }); // 드래그 아닐 때 지속 동기화

  return (
    <>
      {/* ref callback: 그룹이 씬에 추가되는 순간 setPivotEl 호출 → 리렌더 */}
      <group ref={setPivotEl} />

      {pivotEl && (
        <TransformControls
          object={pivotEl}
          mode={transformMode}
          space={transformSpace}
          translationSnap={snapEnabled ? snapTranslate : null}
          rotationSnap={snapEnabled ? snapRotate * DEG2RAD : null}
          scaleSnap={snapEnabled ? 0.1 : null}
          onMouseDown={() => {
            gizmoDraggingRef.current = true;
            if (orbitRef.current) orbitRef.current.enabled = false;
            // 이전 드래그에서 pivotEl에 누적된 rotation/scale 초기화
            // 초기화하지 않으면 두 번째 rotate/scale 시 변환이 중첩 적용돼 좌표가 깨짐
            pivotEl.rotation.set(0, 0, 0);
            pivotEl.scale.set(1, 1, 1);
            dragStartPivot.current.copy(pivotEl.position);
            dragStartPositions.current.clear();
            dragStartQuaternions.current.clear();
            dragStartScales.current.clear();
            for (const id of selectedIds) {
              const ref = refsMap.current.get(id);
              if (ref && ref.parent) {
                dragStartPositions.current.set(id, ref.position.clone());
                dragStartQuaternions.current.set(id, ref.quaternion.clone());
                dragStartScales.current.set(id, ref.scale.clone());
              }
            }
          }}
          onChange={() => {
            if (transformMode === 'translate') {
              const dx = pivotEl.position.x - dragStartPivot.current.x;
              const dy = pivotEl.position.y - dragStartPivot.current.y;
              const dz = pivotEl.position.z - dragStartPivot.current.z;
              const { objects: objs } = useSceneStore.getState();
              for (const id of selectedIds) {
                const ref = refsMap.current.get(id);
                const start = dragStartPositions.current.get(id);
                const obj = objs.find((o) => o.id === id);
                const skipClamp = obj?.parentId != null;
                if (ref && start) {
                  let newY: number;
                  if (skipClamp) {
                    newY = start.y + dy;
                  } else if (obj?.isGroup) {
                    const kids = objs.filter(o => o.parentId === id && !o.isGroup && !o.assetId && !o.content && !o.particle && !o.light);
                    const minY = kids.reduce((m, c) => Math.max(m, (c.scale?.y ?? 1) * 0.5 - (c.position?.y ?? 0)), 0);
                    newY = Math.max(minY, start.y + dy);
                  } else {
                    newY = Math.max(0, start.y + dy);
                  }
                  ref.position.set(start.x + dx, newY, start.z + dz);
                }
              }
            } else if (transformMode === 'rotate') {
              for (const id of selectedIds) {
                const ref = refsMap.current.get(id);
                const startPos = dragStartPositions.current.get(id);
                const startQ = dragStartQuaternions.current.get(id);
                if (!ref || !startPos || !startQ) continue;
                const relPos = startPos.clone().sub(dragStartPivot.current);
                relPos.applyQuaternion(pivotEl.quaternion);
                ref.position.copy(relPos).add(dragStartPivot.current);
                ref.quaternion.copy(pivotEl.quaternion).multiply(startQ);
              }
            } else if (transformMode === 'scale') {
              const { x: sx, y: sy, z: sz } = pivotEl.scale;
              for (const id of selectedIds) {
                const ref = refsMap.current.get(id);
                const startPos = dragStartPositions.current.get(id);
                const startScale = dragStartScales.current.get(id);
                if (!ref || !startPos || !startScale) continue;
                const relPos = startPos.clone().sub(dragStartPivot.current);
                relPos.x *= sx; relPos.y *= sy; relPos.z *= sz;
                ref.position.copy(relPos).add(dragStartPivot.current);
                ref.scale.set(startScale.x * sx, startScale.y * sy, startScale.z * sz);
              }
            }
          }}
          onMouseUp={() => {
            gizmoDraggingRef.current = false;
            if (orbitRef.current) orbitRef.current.enabled = true;
            const { objects: objs } = useSceneStore.getState();
            // 모든 대상의 최종 트랜스폼을 모아 원자적으로 1회 커밋(undo 기준 오염 없음).
            type Vec3 = { x: number; y: number; z: number };
            const updates: { id: string; position: Vec3; rotation: Vec3; scale: Vec3 }[] = [];
            for (const id of selectedIds) {
              const ref = refsMap.current.get(id);
              if (!ref) continue;
              const obj = objs.find((o) => o.id === id);
              const skipClamp = obj?.parentId != null;
              let finalY = ref.position.y;
              if (!skipClamp) {
                if (obj?.isGroup) {
                  const kids = objs.filter(o => o.parentId === id && !o.isGroup && !o.assetId && !o.content && !o.particle && !o.light);
                  const minY = kids.reduce((m, c) => Math.max(m, (c.scale?.y ?? 1) * 0.5 - (c.position?.y ?? 0)), 0);
                  finalY = Math.max(minY, ref.position.y);
                } else {
                  finalY = Math.max(0, ref.position.y);
                }
              }
              updates.push({
                id,
                position: { x: ref.position.x, y: finalY, z: ref.position.z },
                rotation: { x: ref.rotation.x * RAD2DEG, y: ref.rotation.y * RAD2DEG, z: ref.rotation.z * RAD2DEG },
                scale: { x: ref.scale.x, y: ref.scale.y, z: ref.scale.z },
              });
            }
            if (updates.length > 0) commitTransforms(updates);
          }}
        />
      )}
    </>
  );
}

function SingleGizmo({ orbitRef, gizmoDraggingRef }: Props) {
  const { selectedId, transformMode, transformSpace, snapEnabled, snapTranslate, snapRotate, objectSnap,
    objects, assets, animClips, commitTransforms, updateEnvironment, pushHistory } = useSceneStore();
  const refsMap = useObjectRefs();
  // 기즈모는 "형상 중심에 놓인 프록시"에 붙는다 → 위젯이 원점(하단)이 아니라 중심에 뜨고,
  // 프록시는 재부모화되지 않으므로 예전의 scene graph 에러도 없다. 조작은 오브젝트로 역매핑.
  const proxyRef = useRef<THREE.Object3D | null>(null);
  if (proxyRef.current === null) proxyRef.current = new THREE.Object3D();
  const cLocalRef = useRef(new THREE.Vector3()); // 선택 오브젝트의 로컬 형상 중심
  const floorMinYRef = useRef(0);
  const snapTargetsRef = useRef<THREE.Box3[]>([]); // 오브젝트 스냅 대상(다른 루트 오브젝트 월드 bbox, 드래그 시작 시 스냅샷)
  // TransformControls 'change'는 드래그 중 매우 빠르게(때론 한 틱에 여러 번) 발생 →
  // setLive를 직접 호출하면 React 동기 업데이트 한도 초과("Maximum update depth exceeded").
  // NumInput 드래그 스크럽과 동일하게 rAF로 프레임당 1회로 스로틀.
  const liveRafRef = useRef<number | null>(null);

  const isCharPreview = selectedId === CHARACTER_PREVIEW_ID;
  const selectedObject = isCharPreview ? null : objects.find((o) => o.id === selectedId);
  const target = selectedId ? refsMap.current.get(selectedId) : undefined;

  const valid = !!selectedId && (isCharPreview || (!!selectedObject && !selectedObject.locked && selectedObject.visible));
  const effectiveMode = isCharPreview ? 'translate' : transformMode;
  const skipYClamp = !isCharPreview && (selectedObject?.parentId != null);

  // 선택 오브젝트의 로컬 회전중심(cLocal) 갱신 — 기본은 형상 중심(프리미티브/캐릭터는 원점 0).
  //   단, 회전 모드 + 이 오브젝트를 rootId로 갖는 pivot(경첩) 클립이 있으면 → cLocal을 그 경첩 점으로.
  //   pivot은 오브젝트 원점 기준 스케일드 오프셋(0.5×scale) → 지오메트리-로컬은 pivot/scale (형상중심 안 더함:
  //   런타임 pivotOffset·노란 표식과 동일하게 원점 기준). 프록시가 그 점 기준으로 회전 →
  //   origin = restOrigin + (pivot − R·pivot)로 baked 저장(= 런타임 pivotOffset과 픽셀 일치).
  useEffect(() => {
    if (isCharPreview || !selectedId) { cLocalRef.current.set(0, 0, 0); return; }
    // 선택 오브젝트가 어느 클립의 트랙이고 그 트랙(또는 클립레벨 폴백)에 pivot이 있으면 그 경첩 기준으로 회전.
    let pivot: { x: number; y: number; z: number } | undefined;
    if (transformMode === 'rotate') {
      for (const cl of animClips) {
        const tr = cl.tracks.find((t) => t.objectId === selectedId);
        if (tr) { pivot = tr.pivot ?? (cl.rootId === selectedId ? cl.pivot : undefined); break; }
      }
    }
    if (pivot) {
      const sc = objects.find((o) => o.id === selectedId)?.scale ?? { x: 1, y: 1, z: 1 };
      cLocalRef.current.set(
        sc.x ? pivot.x / sc.x : 0,
        sc.y ? pivot.y / sc.y : 0,
        sc.z ? pivot.z / sc.z : 0,
      );
    } else {
      cLocalRef.current.copy(localCenter(objects, assets, selectedId) ?? _p.set(0, 0, 0));
    }
  }, [selectedId, isCharPreview, objects, assets, transformMode, animClips]);

  // Shift 누르는 동안 회전 15° 스냅 (Figma식)
  const [shiftSnap, setShiftSnap] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setShiftSnap(e.shiftKey);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    return () => { window.removeEventListener('keydown', sync); window.removeEventListener('keyup', sync); };
  }, []);

  // 드래그 중이 아니면 프록시를 오브젝트(형상 중심/회전/스케일)에 매 프레임 동기화
  useFrame(() => {
    const proxy = proxyRef.current!;
    if (gizmoDraggingRef.current || !valid || !target || !target.parent) return;
    target.updateWorldMatrix(true, false);
    target.matrixWorld.decompose(_p, _q, _s);
    proxy.position.copy(cLocalRef.current).applyMatrix4(target.matrixWorld); // 월드 형상 중심
    proxy.quaternion.copy(_q);
    proxy.scale.copy(_s);
  });

  if (!valid || !target) return null;

  // 프록시(월드) → 오브젝트 로컬 pos/rot/scale 역매핑
  const applyProxyToTarget = () => {
    const proxy = proxyRef.current!;
    // 오브젝트 원점(월드) = 프록시위치 − Q·(S ⊙ cLocal) → 형상 중심이 프록시 위치에 오게 한다
    const cScaled = _lp.copy(cLocalRef.current).multiply(proxy.scale).applyQuaternion(proxy.quaternion);
    const originWorld = _ls.copy(proxy.position).sub(cScaled);
    const mWorld = new THREE.Matrix4().compose(originWorld, proxy.quaternion, proxy.scale);
    const parent = target.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      mWorld.premultiply(new THREE.Matrix4().copy(parent.matrixWorld).invert());
    }
    mWorld.decompose(_lp, _lq, _ls);
    if (effectiveMode === 'translate' && !skipYClamp && !isCharPreview) {
      _lp.y = Math.max(floorMinYRef.current, _lp.y); // bbox 밑면 바닥 클램프(루트 기준)
    }
    target.position.copy(_lp);
    target.quaternion.copy(_lq);
    target.scale.copy(_ls);
    // 오브젝트 스냅(자석) — 이동 시, 다른 루트 오브젝트의 bbox 모서리/중심에 축별로 흡착.
    // 루트 오브젝트 전용(중첩은 로컬좌표라 제외). 토글 OFF면 완전 무영향.
    if (objectSnap && effectiveMode === 'translate' && !isCharPreview && selectedObject && !selectedObject.parentId) {
      applyObjectSnap();
    }
  };

  // 드래그 중인 오브젝트의 월드 bbox(정밀, 가이드박스 오염 없는 스키마 기반)를 계산해
  // 각 축의 min/center/max를 스냅 대상들의 min/center/max와 비교, 임계값 내 최근접에 흡착.
  const applyObjectSnap = () => {
    const lb = localBBox(objects, assets, selectedId!);
    if (!lb || lb.isEmpty() || snapTargetsRef.current.length === 0) return;
    target!.updateWorldMatrix(true, false);
    _snapBox.copy(lb).applyMatrix4(target!.matrixWorld); // 후보 위치의 월드 bbox
    (['x', 'y', 'z'] as const).forEach((axis) => {
      const feats = [_snapBox.min[axis], (_snapBox.min[axis] + _snapBox.max[axis]) / 2, _snapBox.max[axis]];
      let best: number | null = null;
      let bestDist = OBJECT_SNAP_THRESHOLD;
      for (const tb of snapTargetsRef.current) {
        const tf = [tb.min[axis], (tb.min[axis] + tb.max[axis]) / 2, tb.max[axis]];
        for (const f of feats) for (const t of tf) {
          const d = Math.abs(f - t);
          if (d < bestDist) { bestDist = d; best = t - f; }
        }
      }
      if (best !== null) target!.position[axis] += best;
    });
    if (!skipYClamp) target!.position.y = Math.max(floorMinYRef.current, target!.position.y);
  };

  return (
    <>
      <primitive object={proxyRef.current} />
      <TransformControls
        object={proxyRef.current}
        mode={effectiveMode}
        space={transformSpace}
        translationSnap={snapEnabled ? snapTranslate : null}
        rotationSnap={shiftSnap ? 15 * DEG2RAD : (snapEnabled ? snapRotate * DEG2RAD : null)}
        scaleSnap={snapEnabled ? 0.1 : null}
        onMouseDown={() => {
          gizmoDraggingRef.current = true;
          if (orbitRef.current) orbitRef.current.enabled = false;
          if (effectiveMode === 'translate' && !skipYClamp && !isCharPreview) {
            const st = useSceneStore.getState();
            const o = st.objects.find((x) => x.id === selectedId);
            const b = worldBBox(st.objects, st.assets, selectedId!);
            floorMinYRef.current = o && b ? o.position.y - b.min.y : 0;
          }
          // 오브젝트 스냅 대상 스냅샷 — 다른 루트 오브젝트들의 월드 bbox(드래그 중 고정).
          if (objectSnap && effectiveMode === 'translate' && !isCharPreview) {
            const st = useSceneStore.getState();
            const boxes: THREE.Box3[] = [];
            for (const o of st.objects) {
              if (o.id === selectedId || o.parentId || !o.visible || o.isGroup) continue;
              const b = worldBBox(st.objects, st.assets, o.id);
              if (b && !b.isEmpty()) boxes.push(b.clone());
            }
            snapTargetsRef.current = boxes;
          }
        }}
        onChange={() => {
          if (!gizmoDraggingRef.current) return;
          applyProxyToTarget();
          // 라이브 채널에 실시간 트랜스폼 게시 → Inspector 수치가 드래그 중 즉시 갱신(캔버스 리렌더 없음).
          // rAF로 프레임당 1회로 스로틀(과도한 동기 리렌더로 인한 "Maximum update depth exceeded" 방지).
          if (!isCharPreview && selectedId) {
            if (liveRafRef.current !== null) cancelAnimationFrame(liveRafRef.current);
            liveRafRef.current = requestAnimationFrame(() => {
              liveRafRef.current = null;
              const p = target.position, r = target.rotation, s = target.scale;
              useLiveTransformStore.getState().setLive({
                id: selectedId,
                position: { x: p.x, y: p.y, z: p.z },
                rotation: { x: r.x * RAD2DEG, y: r.y * RAD2DEG, z: r.z * RAD2DEG },
                scale: { x: s.x, y: s.y, z: s.z },
              });
            });
          }
        }}
        onMouseUp={() => {
          gizmoDraggingRef.current = false;
          if (orbitRef.current) orbitRef.current.enabled = true;
          if (liveRafRef.current !== null) { cancelAnimationFrame(liveRafRef.current); liveRafRef.current = null; }
          useLiveTransformStore.getState().setLive(null); // 확정값은 아래 commitTransforms가 메인 스토어에 반영
          const pos = target.position, rot = target.rotation, scl = target.scale;
          if (isCharPreview) {
            updateEnvironment({ playerStartPosition: { x: pos.x, y: Math.max(0, pos.y), z: pos.z } });
            pushHistory();
          } else {
            // 원자적 커밋(단일 대상) — _prevSnapshot 오염 없이 undo 기준 일관.
            commitTransforms([{
              id: selectedId!,
              position: { x: pos.x, y: pos.y, z: pos.z },
              rotation: { x: rot.x * RAD2DEG, y: rot.y * RAD2DEG, z: rot.z * RAD2DEG },
              scale: { x: scl.x, y: scl.y, z: scl.z },
            }]);
          }
        }}
      />
    </>
  );
}

export function GizmoController({ orbitRef, gizmoDraggingRef }: Props) {
  const selectedIds = useSceneStore((s) => s.selectedIds);
  return selectedIds.length > 1
    ? <MultiGizmo orbitRef={orbitRef} gizmoDraggingRef={gizmoDraggingRef} />
    : <SingleGizmo orbitRef={orbitRef} gizmoDraggingRef={gizmoDraggingRef} />;
}
