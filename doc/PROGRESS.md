# PROGRESS — 작업 진행 상황 & 핸드오프 노트

> 이 문서는 `AGENTS.md`에서 `@doc/PROGRESS.md`로 자동 로드된다.
> 다른 컴퓨터/새 세션에서 작업을 이어갈 때 여기를 읽으면 현재 맥락을 파악할 수 있다.
> **작업 중 중요한 변경/결정이 생기면 이 파일을 갱신할 것.**

## 프로젝트 한 줄 요약

코드 없이 GUI 에디터로 3D 공간/웹사이트를 만들고 배포하는 노코드 SaaS 플랫폼.
Project > Scene > Asset(.glb) > Object(인스턴스) > (Prefab, 미구현).

## 기술 스택

- **에디터/뷰어**: Next.js 16(App Router) + React 19 + React Three Fiber + Three.js(0.185)
- **상태**: Zustand (`src/store/sceneStore.ts`) — Command 패턴 Undo/Redo
- **물리**: Rapier (`@react-three/rapier`) — 플레이 모드 캐릭터
- **백엔드**: Supabase (Postgres + Storage + Auth)
- **씬 데이터**: 단일 JSON 스키마 `ProjectSceneSchema`(`src/types/scene.ts`)를 `scenes.scene_data`(jsonb)에 저장. 에디터·뷰어·임베드가 이 스키마 공유.

## 로컬 실행

```bash
npm install
npm run dev   # http://localhost:3000 (루트는 /login 리다이렉트)
```

- **`.env.local` 필수** (Supabase URL/키) — `.gitignore`에 있어 git에 없음. 다른 컴퓨터에선 직접 복사해야 함.

---

## 핵심 아키텍처 결정 (변경 주의)

- **Next.js 16**: 미들웨어 파일은 `src/proxy.ts`, 함수명 `proxy`(not middleware). 모든 라우트에서 세션 갱신.
- **@supabase/ssr**: `getUser()` 사용(`getSession()`은 보안 취약).
- **뷰어 RLS 우회**: `createServiceSupabase()` + 수동 소유자 체크. `is_published` 씬만 외부 노출.
- **에디터 오브젝트 좌표는 명령형**: `EditorObjectInstance`가 position/rotation/scale을 `useLayoutEffect`로 Three 객체에 직접 set. (gizmo가 드래그 중 직접 조작하기 위함) → **visible은 언마운트가 아니라 `g.visible` 플래그로 토글**(언마운트 시 좌표 리셋 버그 방지). 뷰어(`ViewerObject`)는 position을 prop으로 준다.
- **기즈모(GizmoController)**: 재부모화 시 ref 교체로 TransformControls가 분리 객체를 물어 "scene graph" 에러 → ref 등록 `useLayoutEffect` + `attachedKey` state로 전환 프레임 렌더 스킵.
- **저장 낙관적 잠금**: `scenes.version`(행 리비전)으로 멀티탭 덮어쓰기 방지. `src/lib/saveScene.ts`의 `persistCurrentScene()`. ViewportToolbar·AssetBrowser 모두 사용.
- **플레이 모드**: 항상 바닥 콜라이더(`CuboidCollider 500`) + 기본 캡슐 캐릭터 존재 → 낙사 없음. 캐릭터 컨트롤러는 센서를 `EXCLUDE_SENSORS`로 제외.
- **area 애니메이션 재생**: 센서 오브젝트는 `PhysicsObject`의 Rapier `onIntersectionEnter/Exit` → `activeClip`. 솔리드는 area play_animation 미지원(제약).
- **커스텀 드롭다운**: `useDropdown` + `SelectBox` + `useListNav` 조합(portal 기반).
- **조명 기본값**: HDR 미설정 시 `DefaultEnvironment`(RoomEnvironment IBL) 자동 주입. directionalLight에 shadow bias/frustum 설정됨. ambient는 저장값 ×0.5로 렌더(그림자 대비).

## 데이터 스키마 핵심 (`src/types/scene.ts`)

- `EventSchema.trigger`: click / hover_enter / hover_exit / area_enter / area_exit
- `EventSchema.action`: open_url / show_popup / emit_event / play_animation / go_to_scene
- `EnvSchema.defaultMode`: 'explore' | 'play' — 뷰어 진입 모드
- `EnvSchema.disableWalk`: true면 둘러보기 전용(캐릭터·플레이 없음)
- `ObjectNodeSchema.prefabId`: 스키마엔 정의됐으나 **미구현**

---

## 🎨 진행 중 (2026-07-22) — 재질/컬러픽커 고도화 로드맵 (Spline/Figma 대비 격차 해소)
> 사용자: "재질 만들 때 너무 단순. Spline·Figma는 더 고도화돼 있다." 분석 후 **큰/중간 격차 전부 순차 진행** 합의(사용자: "일단 진행하고 실제 화면에서 성능 보고 뺄건 빼고 수정/보완"). 우선순위 = **Phase 1(파라미터) → 3(셰이딩) → 2(픽커) → 4(맵)**, 6(레이어)·7(GLB)은 별도 판단. 전부 옵셔널 필드라 하위호환 보존. 성능 원칙: opt-in 주입(안 쓰면 비용 0)·텍스처 상한·유리/레이어 캡.
> 로드맵 문서(`MATERIAL_UPGRADE.md`)는 사용자가 반려(문서 대신 바로 구현) — 설계 요지는 이 블록에 로그로 남김.

### Phase 1 (2026-07-22) — 재질 파라미터 확장 (🟢 배관, 저위험) — 브라우저 확인 대기
> MeshPhysicalMaterial이 이미 지원하는 파라미터를 스키마·배선·UI로 노출. **새 셰이더 없음**(prop 직결)이라 성능/회귀 위험 낮음. tsc 클린 + dev 편집 라우트 200 컴파일. **브라우저 확인 대기.**
- **스키마(`MaterialOverride`, 전부 옵셔널)**: `opacity`(<1=반투명 transparent)·`emissiveIntensity`(발광 세기, 미설정=현재 로직)·`envMapIntensity`(환경 반사 강도)·`clearcoatRoughness`·`sheenColor`·`sheenRoughness`·`iridescence`·`iridescenceIOR`·`anisotropy`·`thickness`(투과 두께, 기존 1 하드코딩 해제)·`attenuationColor`(유리 틴트)·`attenuationDistance`.
- **렌더(`PrimitiveMaterial`)**: props 추가 + 배선. `hasPhysical` 판정에 iridescence·anisotropy 포함(physical 전용). opacity<1→transparent. **함정 처리**: 틴트 색만 지정하고 거리 미설정 시 Infinity라 틴트가 안 보임 → 틴트 색 있으면 거리 기본을 유한값(1)으로 보정. sheenColor/clearcoatRoughness 하드코딩(base/0.1) 해제해 override 존중.
- **배선**: `EditorObjectInstance`·`ViewerObject` 호출부 12필드 전달. emissiveIntensity는 `mat?.emissiveIntensity ?? (기존 로직)`으로 하위호환. 재질 에셋 경로도 `effectiveMaterial`이 MaterialOverride 통째 반환이라 자동 흐름.
- **UI(`MaterialSection`)**: 거칠기/금속성 아래 **Opacity·Emissive intensity** 행 + "Physical material (advanced)" 블록 확장(Reflection(env)·Anisotropy·Clearcoat+거칠기·Sheen+거칠기+색·Iridescence+IOR·Transmission+IOR+두께+유리 틴트/거리). **조건부 노출**(값 올릴 때만 하위 컨트롤 등장 — reveal on use).
- **버그픽스(2026-07-22)**: Opacity가 에디터에서 안 먹던 문제 — Three는 재질을 **불투명→반투명 처음 전환 시 재컴파일 필요**한데 material `key`에 transparent가 없어 in-place 갱신되며 안 켜짐 → **key에 `${transparent?'tr':'op'}` 추가**(텍스처/flatShading 전환과 동일 재마운트 패턴). **✅ Opacity 반투명 확인(사용자).**
- **확인 필요(브라우저, 미확인)**: ②Emissive intensity(발광색 준 뒤) ③Reflection(env)(금속성↑ 후) ④Iridescence ⑤Anisotropy ⑥Clearcoat ⑦Sheen ⑧유리+틴트 · 게시 뷰어 일치 · undo. (opacity 배선이 맞았으니 동일 경로라 저위험.)

### Phase 3 part 1 (2026-07-22) — Fresnel/Rim(가장자리 발광) — 브라우저 확인 대기
> 스타일라이즈드 셰이딩 첫 조각. **가장 깨끗하고 효과 큰 additive 주입**(standard·physical 공통, 안 켜면 비용 0). Toon/Matcap은 재질 클래스가 갈려 리스크 커 후속. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **스키마(`MaterialOverride`)**: `fresnelColor?`(기본 흰색)·`fresnelIntensity?`(0=끔)·`fresnelPower?`(가장자리 집중도, 기본 3). 옵셔널.
- **렌더(`PrimitiveMaterial`)**: `onBeforeCompile`에 uniform(uFresColor/uFresIntensity/uFresPower) + 정점 varying(뷰공간 위치 `vFresView`·법선 `vFresNrm`=normalMatrix*normal) + 프래그먼트 `#include <emissivemap_fragment>`에 rim 주입(`pow(1-clamp(dot(N,V)),power)`를 `totalEmissiveRadiance`에 additive → 라이팅 무관 발광). `customShader`/`triKey`에 fresActive 포함(켜고 끌 때만 재마운트). 그라데이션/triplanar와 공존(같은 onBeforeCompile, 독립 replace).
- **배선**: `EditorObjectInstance`·`ViewerObject`에 fresnel 3필드.
- **UI(`MaterialSection`)**: Physical 블록 아래 "Rim glow (Fresnel)" — intensity + (켜면) width(power)·color. reveal on use.
- **확인 필요(브라우저)**: Rim intensity 올리면 박스 가장자리 발광 · width로 테두리 두께 · 색 변경 · 다른 재질(유리·금속)과 조합 · 게시 뷰어 · 성능. (HMR "changed size" 경고는 하드 리프레시로 사라짐 — 실버그 아님.)

### Phase 3 part 2 (2026-07-22) — Toon/Cel(카툰 셰이딩) — 브라우저 확인 대기
> `MeshToonMaterial`(별도 재질 클래스). **`shading==='toon'`일 때만 분기**라 기존 standard/physical 오브젝트엔 무영향(격리·회귀 저위험). tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **스키마(`MaterialOverride`)**: `shading?: 'standard'|'toon'`(미설정=standard) + `toonSteps?`(음영 단계, 기본 3·2~6). 옵셔널.
- **렌더(`PrimitiveMaterial`)**: `buildToonGradient(n)`=N단계 계단 gradientMap(DataTexture·RedFormat·NearestFilter → 딱딱한 밴딩). `isToon`이면 `hasPhysical`보다 먼저 `<meshToonMaterial>` 반환(color/map/normalMap/emissive/gradientMap/opacity). roughness/metalness/physical은 무시(카툰). **gradient·triplanar·fresnel 주입은 표준 셰이더 청크(color/map/emissivemap_fragment) 공유라 toon에도 그대로 동작**. key에 shading·transparent 포함.
- **배선**: `EditorObjectInstance`·`ViewerObject`에 shading·toonSteps.
- **UI(`MaterialSection`)**: 최상단 "Shading" 드롭다운(Standard/Toon) + toon일 때 Steps + "toon은 roughness/metalness/reflection 무시, color/emissive/texture/gradient/rim은 적용" 안내.
- **확인 필요(브라우저)**: Shading=Toon → 박스가 단계 음영(카툰) · Steps 2~6로 밴딩 수 · 색/발광/Rim glow 병용 · standard로 되돌리면 원복 · 게시 뷰어.
- **미구현(후속)**: Matcap — 별도 재질 클래스 + **내장 matcap 프리셋 이미지 필요**(없으면 저가치)라 보류.

### Phase 4 core (2026-07-22) — Normal map(법선 맵·요철) — 브라우저 확인 대기
> 평평한 프리미티브를 진짜 재질감(벽돌·천·요철)으로. 기존 텍스처 업로드/픽커 재사용. Standard·Physical·Toon 전부 적용. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **스키마(`MaterialOverride`)**: `normalUrl?`·`normalScale?`(요철 강도, 기본 1·0~2). 옵셔널.
- **렌더(`PrimitiveMaterial`)**: 2번째 텍스처 로더(normalTex) — **노멀맵은 방향 데이터라 `NoColorSpace`**(sRGB 변환 금지). RepeatWrapping·albedo와 타일 공유. 세 재질 분기 전부 `normalMap`+`normalScale`(Vector2). key에 normal 유무(`nm`) 포함(USE_NORMALMAP define 토글=재마운트).
- **배선**: `EditorObjectInstance`·`ViewerObject`에 normalUrl·normalScale.
- **UI(`MaterialSection`)**: 텍스처 블록 아래 "Normal map (bump)" 토글 + TexturePicker(업로드/재사용) + Bump strength. 별도 업로드 핸들러(`handleNormalUpload`→normalUrl). textures 라이브러리 공유(albedo와 같은 'texture' 타입).
- **확인 필요(브라우저)**: 파란톤 노멀맵 업로드/선택 → 박스 표면 요철(빛 각도 따라) · Bump strength 0~3 · Toon/유리와 병용 · 게시 뷰어 · VRAM(맵 많을 때).
- **미구현(후속 Phase 4)**: roughness/metalness/AO/displacement/alpha map · 텍스처 2K 업로드 상한.

### Phase 4 나머지 + 2K 상한 (2026-07-22) — Roughness/Metalness 맵 + MapSlot 리팩터 + 텍스처 다운스케일 — 브라우저 확인 대기
> normal 맵 파이프라인 확장. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **스키마**: `roughnessUrl?`·`metalnessUrl?`(흑백 데이터 맵, roughness/metalness 스칼라에 곱해짐). standard·physical만(toon 제외).
- **렌더(`PrimitiveMaterial`)**: 재사용 로더 훅 `useDataMap(url, rx, ry)`(NoColorSpace·RepeatWrapping·타일 공유) → roughnessTex·metalnessTex. standard·physical 분기에 `roughnessMap`/`metalnessMap` + key에 `rm`/`mm`. (기존 albedo/normal 로더는 안 건드림 — 안전.)
- **★ 2K 다운스케일(`uploadImageTexture`)**: 신규 `downscaleImage(file)` — 최대 변 2048 초과 시 canvas로 축소(PNG 무손실 유지·그 외 JPEG 0.92). **VRAM/대역폭 상한**(성능). 이미 작으면 원본 그대로. **신규 업로드만 적용**(기존 에셋 무영향). ground/boundary 등 모든 이미지 텍스처 공유 경로라 함께 적용.
- **UI(`MaterialSection`)**: 반복되던 맵 블록을 **재사용 `MapSlot` 컴포넌트**(토글+TexturePicker+업로드)로 추출 → normal(+strength)·roughness·metalness 3개를 깔끔하게. normal 인라인 핸들러/상태 제거(MapSlot이 업로드 자체 처리). roughness/metalness는 toon일 때 숨김.
- **확인 필요(브라우저)**: 거칠기/금속 맵 업로드→부분 광택/금속 · 큰 이미지 업로드 시 2K로 줄어드는지 · normal과 병용.

### Phase 2 (2026-07-22) — 컬러픽커 개선(최근 색·씬 내 색·복사) — 브라우저 확인 대기
> 알파 채널은 재질 opacity(Phase 1)와 중복+전역 리플이라 보류. 자체완결·저위험 3종만. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **최근 색(Recent)**: `colorPickerStore`에 `recent[]`(세션 유지·최신순·중복제거·최대 12) + `pushRecent`. ColorPicker `commit`에서 solid 색만 기록. 팝업에 Recent 스와치 행.
- **씬 내 색(In this scene)**: 팝업 열 때 1회 계산(비반응 — `useSceneStore.getState().objects`의 material.color 수집·중복제거·최대 16). 드래그 중 리렌더 없음.
- **복사**: 현재 hex를 클립보드로(Copy 버튼, 스포이드 옆).
- **확인 필요(브라우저)**: 색 바꾸면 Recent에 쌓임 · In this scene에 씬 색 표시 · 복사 · 클릭 적용.

### Phase 3 part 3 (2026-07-22) — Matcap(절차적 프리셋 5종) — 브라우저 확인 대기
> 셰이딩 모드 마지막(Standard/Toon/Matcap 완성). **외부 이미지 없이 절차적 생성** — 픽셀마다 구 법선+조명 모델(확산/Blinn 스페큘러/프레넬/금속 반사 그라데이션)로 '진짜 라이팅된 구' 이미지를 구움. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **신규 `lib/matcap.ts`**: `getMatcapTexture(preset)`(프리셋별 캐시·1회 생성) + `MATCAP_PRESETS`. 프리셋 5종 = **Studio(중립 글로시)·Chrome(거울금속)·Gold(금)·Clay(무광 점토)·Pearl(무지개빛)**. 256² CanvasTexture, sRGB. 원반 밖은 가장자리로 투영해 이음새 제거.
- **스키마(`MaterialOverride`)**: `shading`에 `'matcap'` 추가 + `matcapPreset?`(studio/chrome/gold/clay/pearl).
- **렌더(`PrimitiveMaterial`)**: `isMatcap`이면 `<meshMatcapMaterial matcap=프리셋텍스처 map=albedo color=틴트 normalMap opacity>`. **customShader 미적용**(matcap 프래그먼트는 emissive 청크가 없어 fresnel/gradient 주입 불가 → 별도 룩). key에 프리셋 포함.
- **배선**: `EditorObjectInstance`·`ViewerObject`에 matcapPreset. UI: Shading 드롭다운에 Matcap + 프리셋 버튼 5개 + 안내(color가 matcap을 틴트·roughness/metal/gradient/rim 무시·normal은 적용). roughness/metal 맵 슬롯은 standard일 때만 노출로 좁힘.
- **확인 필요(브라우저)**: Shading=Matcap → Chrome/Gold 등 프리셋별 스튜디오 룩(라이트 없이도) · color를 흰색으로 두면 순수 프리셋 · normal map 병용 · 게시 뷰어.

### Phase 4 마무리 (2026-07-22) — AO/Displacement 맵 + Matcap 커스텀 업로드 — 브라우저 확인 대기
> Phase 4 맵 세트 완성 + matcap 커스텀. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **스키마(`MaterialOverride`)**: `aoUrl?`·`aoIntensity?`(기본 1)·`displacementUrl?`·`displacementScale?`(기본 0.1) + `matcapUrl?`(커스텀 matcap, 있으면 프리셋 무시).
- **렌더(`PrimitiveMaterial`)**: `useDataMap`에 **`tex.channel = 0`** 추가 → **aoMap이 uv1 대신 프리미티브 기본 uv 사용**(핵심 — 안 하면 프리미티브에서 AO 안 보임). aoTex·dispTex 로드. standard·physical·toon 분기에 `aoMap`/`aoMapIntensity`/`displacementMap`/`displacementScale`(맵 없으면 0) + key에 `mapKey2`(ao/dp 유무). matcap 커스텀 = SRGB 로더(`matcapCustom`) → `matcapCustom ?? getMatcapTexture(preset)`.
- **배선**: 두 호출부에 6필드. UI(`MaterialSection`): AO/Displacement MapSlot(matcap 제외 — 조명 기반만) + AO intensity/Height 자식 컨트롤. Matcap 섹션에 "Custom matcap (overrides preset)" MapSlot.
- **확인 필요(브라우저)**: AO 맵→틈새 그늘 · Displacement→**Subdivision 올린 상태**에서 정점 밀림(박스는 세분 필요) · matcap 커스텀 업로드→프리셋 대신 적용 · 게시 뷰어.
- **한계**: displacement는 지오 세분 없으면 박스 8정점만 이동(거의 안 보임 — UI 안내함). AO는 조명의 간접광에만 영향(미묘할 수 있음).
- **다음(후속·미착수)**: 픽커 알파(보류) · alpha/opacity map(선택).

#### 🐛 Reflection(env) 제거 (2026-07-22, 사용자 검증 중 발견)
> 사용자: Reflection(env) 슬라이더가 아무 반응 없음(0으로 내려도 반사 안 사라짐). **three 소스에서 원인 확정** — `WebGLRenderer.js:2694`: 재질에 자체 envMap이 없고 `scene.environment`로 반사할 때(=우리 구조) three가 `envMapIntensity` uniform을 **`scene.environmentIntensity`로 덮어써 `material.envMapIntensity`를 무시**한다. → per-material 반사 강도 조절 불가(구조적). **UI 슬라이더 제거**(죽은 컨트롤). 반사 강도는 Metalness/Roughness/HDR로 조절. 스키마 `envMapIntensity`·PrimitiveMaterial 배선은 무해하게 잔존(three가 덮어써 inert). Anisotropy·나머지 물리 파라미터는 정상(사용자 Anisotropy 확인).
> - **후속 후보(미착수)**: 금속이 기본 환경에서 검게 보이는 문제 — 원인은 `DefaultEnvironment`의 `scene.environmentIntensity=0.25`(그림자 진하게 하려 낮춤)라 금속 반사도 죽음. per-material `envMap=scene.environment` 할당하면 slider도 살고 금속도 밝아지나(→2694 우회), **기존 씬 금속 룩이 밝아지는 하위호환 변경**이라 보류. 필요 시 opt-in.

#### 🔮 재질 미리보기(Material Preview) (2026-07-22) — 브라우저 확인 대기
> 사용자 피드백: "재질 보려면 씬 태양 각도를 매번 맞춰야 해서 엄청 힘들다"(Toon은 직접광 필요·IBL 무시라 씬 조명 안 맞으면 새까맣게 보임). → **씬 조명과 분리된 고정 스튜디오 미리보기 구**를 인스펙터 Material 섹션 최상단에 추가. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **신규 `panels/inspector/MaterialPreview.tsx`**: 별도 `<Canvas>`(h-28) 안에 회전하는 구 + **고정 조명**(ambient 0.35·directional 2.6/0.7·`DefaultEnvironment intensity=1`) + 배경 #26262e. **실제 렌더의 `PrimitiveMaterial`을 그대로** 사용 → Toon/Matcap/유리/Fresnel/맵/그라데이션 정확히 일치. 구 bbox(반경1)로 wrapMin/Size 전달. LinearToneMapping(앱과 일치).
- **배선**: `MaterialSection` 본문 최상단에 `{obj.primitiveShape && !isVoxel && <MaterialPreview mat={matRef ? matRef.material : obj.material}/>}`. 섹션 펼침 시에만 렌더(접으면 언마운트) + 선택 오브젝트별 remount.
- **효과**: 씬 태양 각도 안 맞춰도 재질 자체를 바로 판단. 특히 Toon(직접광 필요)·금속/유리(반사 필요)가 미리보기에선 항상 제대로 보임.
- **확인 필요(브라우저)**: Material 섹션 상단 미리보기 구에 색/거칠기/금속/Toon/Matcap/유리/Fresnel/맵 변화가 실시간 반영 · 회전 · 성능(작은 캔버스 상시 렌더).

#### 🎨 내장 흑백 패턴 텍스처 프리셋 (2026-07-22) — 브라우저 확인 대기
> 사용자: 맵(roughness/normal/AO/displacement) 테스트에 흑백 이미지가 매번 필요해 불편. → **절차적 패턴 프리셋 6종**을 내장해 이미지 없이 즉시 사용. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **신규 `lib/patternTextures.ts`**: 6종(Checker/Dots/Noise/Brick/Stripes/Cells) + `heightAt(id,u,v)` 높이 필드. `makePatternTexture(id, 'gray'|'normal')` — gray=흑백, **normal=높이 기울기(sobel)로 노멀맵 변환**. 캔버스는 캐시(`id:mode`), 텍스처는 사용처마다 새로(repeat 독립). **URL 스킴 `pattern:<id>`** 로 material.*Url에 저장 → **에셋/스토리지·scene JSON 비대화 없음**.
- **로더(`PrimitiveMaterial`)**: `useDataMap`·normal 로더가 `isPatternUrl`이면 `makePatternTexture`로 즉시 생성(gray/normal 슬롯별 mode). 일반 URL은 기존 TextureLoader.
- **UI(`MapSlot`)**: 활성 시 상단에 패턴 프리셋 버튼 6개(→ `onPick('pattern:id')`) + 기존 TexturePicker(업로드/에셋). 전 맵 슬롯(normal/roughness/metalness/ao/displacement) 공용.
- **확인 필요(브라우저)**: 맵 토글→패턴 버튼 클릭→즉시 적용(미리보기 구로 확인). Normal 슬롯=요철·Roughness=부분광택·AO=틈새그늘·Displacement(+Subdivision)=정점 밀림.

### 🌍 무한 바닥(Infinite ground) (2026-07-22) — 브라우저 확인 대기
> 사용자: fly.pieter.com 같은 광활한 맵 원함. **UI 먼저 결정**(AskUserQuestion) → **Environment ▸ Ground에 토글 하나**("Infinite ground") + 시야 거리 자동. 무작정 안 만들고 배치·조작 방식 합의 후 구현. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **방식**: 카메라 추종(follow) 대신 **아주 큰 정적 평면(20000) + far plane 8000**. 가장자리(10000)가 far plane 밖이라 **절대 안 보임 + 걸어서 도달 불가 = 사실상 무한**. follow 시 텍스처 swim/프리셋별 타일(REPEAT 48/32/40/22) 정렬 문제를 회피(더 단순·튼튼).
- **스키마**: `EnvSchema.ground.infinite?: boolean`(옵셔널).
- **`GroundPlane` 재작성**: `infinite`면 size 1000→20000, `FarPlane`(useThree camera.far→8000, 언마운트 복원) 렌더. 프리셋 텍스처는 **클론+repeat×20**(타일 밀도 유지·캐시 오염 방지, dispose 정리). URL 텍스처 repeat×20. 물/단색도 크기 반영.
- **배선**: `ViewerCanvas`·`EditorCanvas` GroundPlane에 `infinite={env.ground.infinite}`. UI: EnvironmentPanel Ground 섹션에 "Infinite ground" 토글 + "안개와 함께 쓰면 광활" 안내.
- **확인 필요(브라우저)**: 토글 켜기 → 바닥이 끝없이 이어짐·먼 오브젝트 안 잘림 · Fog 켜면 지평선 페이드 · 끄면 원복(far plane 복원) · 게시 뷰어.
- **미구현(후속·별도)**: 절차적 지형(청크)·LOD·비행 컨트롤러 — three로 가능하나 각각 별 작업(엔진 기능화 필요).

#### 🐛 다중선택 스케일 revert 버그픽스 (2026-07-22) — ✅ 확인 완료
> 사용자 보고: 여러 오브젝트 선택→Scale 기즈모로 크기 조절→다른 곳 클릭하면 **이전 크기로 되돌아감**. 진단 로그로 확정 — onMouseUp `commitTransforms`는 정상(새 스케일로 커밋·스토어 반영 OK)인데, **마우스를 놓은 뒤 `syncPivot`(useFrame)이 `pivotEl.scale`을 1로 리셋하며 TransformControls의 stray `onChange`가 한 번 더 발동** → scale 브랜치가 `dragStartScales`(시작값) 기준으로 refs를 시작 스케일로 되돌려 커밋 결과를 시각적으로 덮어씀. → **`MultiGizmo` onChange 최상단에 `if (!gizmoDraggingRef.current) return;` 가드**(드래그 중일 때만 적용). SingleGizmo는 proxy 방식이라 자가교정돼 무영향. tsc 클린. **✅ 확인 완료(사용자 "이제 된다").**

#### 🧭 상단바 해체 → 좌/우 패널로 재배치 (2026-07-22) — ✅ 확인 완료
> 사용자 요청: 상단바 내용을 좌/우 패널로 옮기고 상단바는 hidden. tsc 클린 + dev 편집 200. **✅ 확인 완료(사용자, 5개 항목 전부 정상).**
- **Version history → 좌측 ☰ 메뉴**(`LeftPanel`): 기존 'Back to file' 아래에 'Version history' 항목 추가 + `VersionHistoryModal`(showHistory state·createPortal).
- **Save/Play/Preview → 우측 패널 상단**(신규 `InspectorActionBar.tsx`): 아이콘만 + 영문 툴팁(Save (Ctrl+S)·Play (test in-editor)·Preview (open published view)). `EditorClient` 인스펙터 컨테이너를 flex-col로 바꿔 `<InspectorActionBar/>` + `<InspectorPanel/>`. Environment 위에 항상 노출.
- **저장 로직 추출**(신규 `useEditorSave.ts`): ViewportToolbar의 handleSave(낙관적잠금+버전스냅샷+썸네일)를 훅으로 추출 → InspectorActionBar가 사용. `id="save-btn"`을 액션바로 이동(Ctrl+S가 보이는 버튼 클릭). ViewportToolbar의 중복 id 제거.
- **Park3D 브랜드/로고 → 좌측 패널**: `LeftPanel` 타이틀바를 2행으로(브랜드+☰ / 프로젝트명). Hexagon 로고 그라데이션.
- **상단바 hidden**(`EditorClient`): `<div className="hidden ...">`로 감싸 hidden 처리(삭제 아님·나중에 살릴 수 있게 유지). `ViewportToolbar` 컴포넌트/파일 유지.
- **패널 높이 조정**: `panelTop`을 `edge+44+gap`(64) → `edge`(12)로 → 레일·좌패널·인스펙터가 위 가장자리까지 확장.
- **확인 필요(브라우저)**: ①좌측 ☰ > Version history 열림 ②우측 상단 Save/Play/Preview 아이콘+툴팁·동작(Ctrl+S 저장) ③Park3D 브랜드가 좌측 프로젝트명 위 ④상단바 안 보임·패널이 위까지 참 ⑤플로팅 툴바/기즈모 위치 안 겹침.

#### 🧭 2차 — Settings/Account → ☰ 통합 · GNB 레일 삭제 · Logic 팝업화 (2026-07-22) — ✅ 확인 완료
> 사용자 요청 3건. tsc 클린 + dev 편집 200. **✅ 확인 완료(사용자 "잘된다").**
> **🔜 후속 예정(사용자 지시)**: **Logic 팝업의 UI/콘텐츠 보강** — 현재는 기존 LogicPanel 섹션(GameVariables/SceneLogic/Hud)을 드래그 팝업에 그대로 담은 상태. 팝업에 맞는 레이아웃·콘텐츠 다듬기 필요(폭/스크롤/섹션 구성 등). 나중에 진행.
- **Settings/Account → 좌측 ☰ 메뉴**(`LeftPanel`): 일반적 사용자 메뉴 형태 — **이메일(Signed in as) 제일 위** → Back to file · Version history → **Settings** 소제목(Dark/Light mode·Share/Embed·Custom domain) → **Account** 소제목(Account settings·Sign out). ShareModal/CustomDomainModal·theme·email 로직을 EditorGnb에서 LeftPanel로 이관. 소제목=`text-[9px] uppercase` 회색.
- **좌측 GNB 레일 삭제**: `EditorClient`에서 레일 div·`EditorGnb` 렌더·`handleGnbTabClick` 제거. `EditorGnb.tsx`는 **GnbTab 타입만 남긴 파일로 축소**(컴포넌트 삭제). 레이아웃 `railW` 제거 → `leftPanelX = edge`(좌패널이 왼쪽 가장자리부터), 좌패널 높이/폭 확장. Objects/Assets는 좌패널 가로 탭이 담당.
- **Logic → Environment 타이틀 버튼 + 드래그 팝업**(신규 `LogicPopup.tsx`): Inspector의 Environment 헤더 우측에 `Cpu` 버튼(`data-logic-trigger`) → `setLogicOpen(true)`. LogicPopup = `createPortal` 고정 위치 + **드래그 헤더 이동** + **바깥클릭/Esc 닫기**(트리거 버튼 제외 → 재오픈 방지). 내용=GameVariables/SceneLogic/Hud 섹션(기존 LogicPanel과 동일). 스토어 `logicOpen`/`setLogicOpen` 추가. (구 `LogicPanel.tsx`는 미사용 — 잔존.)
- **확인 필요(브라우저)**: ①☰ 메뉴에 이메일 위·Settings/Account 소제목·다크모드/Share/도메인/로그아웃 동작 ②좌측 레일 사라지고 좌패널이 왼쪽 끝부터 ③Environment 타이틀 우측 Logic 버튼 → 팝업 열림·드래그 이동·바깥클릭/Esc 닫기·변수/규칙/HUD 편집.

#### 🔧 모터 표식 화면 고정 크기 (2026-07-22) — 브라우저 확인 대기
> 사용자: 오브젝트를 작게 만들고 모터를 달면 모터(기어 아이콘)가 오브젝트보다 커서 덮어버림. tsc 클린 + dev 편집 200. **브라우저 확인 대기.**
- **원인**: `MotorObjectInstance`의 dot(히트구 0.24·기어 0.15/0.19·선택링 0.32)이 **고정 월드 크기** → 작은 오브젝트를 덮음(줌해도 함께 커져 항상 덮음).
- **수정**: dot 표식을 `iconRef` 그룹으로 묶고 **useFrame으로 화면 고정 픽셀 크기** 적용(ManipulationHandles와 동일 거리·화각(fovK)·뷰포트(vpk) 보정). `s = dist*0.022*vpk*fovK`, `iconRef.scale = (s/0.15)/부모월드스케일`. → 줌인 시 오브젝트는 커지고 기어는 작은 마커로 남아 안 덮음. 라벨(Html)은 그룹 밖(무영향).
- **확인 필요(브라우저)**: 작은 오브젝트+모터 → 줌인 시 기어가 오브젝트 안 덮음·마커 일정 크기·클릭/선택 정상.

### ✅ 재질 고도화 로드맵 실행분 완료 (2026-07-22)
> Phase 1(파라미터)·2(픽커)·3(Fresnel·Toon·Matcap)·4(normal/rough/metal/AO/displacement 맵 + 2K 상한) 전부 구현. tsc 클린 + dev 편집 200. **브라우저 종합 확인 대기.** 미착수 잔여 = 픽커 알파(보류)·AO uv2 정밀화(현재 uv0 공유로 동작).

---

## 🕯 완료 (2026-07-23) — 공포 게임 템플릿 + ★kinematic 콜라이더 관통 버그 수정
> 사용자 요청 "기존 기능만 써서 공포게임 만들어줘". 새 엔진 기능 없이 **조합만으로** 플레이 가능한 게임을 만들었고, 그 과정에서 **모든 모터/무빙 콜라이더에 영향을 주던 실버그**를 찾아 고쳤다. tsc 클린 + **템플릿 검증 35/35**(`npx tsx src/lib/horrorTemplate.check.ts`) + 라우팅 25/25 + 브라우저 플레이 확인.
- **★ 버그: kinematic 콜라이더를 캐릭터가 그대로 통과 (`PlayCanvas.getKinematicColliderType` 신설)**: 닫힌 철문을 뚫고 지나가 즉시 승리하는 걸로 발견. 원인 = `getColliderType`이 `primitiveShape` 없는 오브젝트(**모터·그룹**)에 `trimesh`를 주는데, **Rapier 캐릭터 컨트롤러는 kinematic trimesh를 안정적으로 밀어내지 못한다**(같은 함수 주석이 "fixed 바디는 trimesh 사용 가능"이라고 이미 단서를 달고 있었다 — fixed에서만 검증된 값이 kinematic 경로에 그대로 흘러갔다). → kinematic 전용 래퍼가 trimesh를 **hull**로 바꾼다. `MovingCollider`·`ActuatorCollider` 두 곳 적용(그룹 2곳은 원래 hull이라 무영향).
  - **영향 범위 = 공포게임 밖**: 모터 콜라이더·무빙 플랫폼 전부. PROGRESS의 "모터 콜라이더 ON→캐릭터 막힘(TC-3)"은 프리미티브 자식이 있어 통과했지만, **빈 모터/GLB 모터는 안 막히고 있었다.**
- **템플릿 `horror`(`sceneTemplates.ts`) — 오브젝트 72개**: 로비 → 복도 → 병실 A·B → 제단실 → 탈출구. 조합 = **게임변수(keys)** + **센서 area_enter**(열쇠 3개·함정 4개·점프스케어·출구) + **variable_changed + set_actuator**(keys>=3이면 철문 열림) + **game_win/lose** + **HUD 텍스트** + **scene_start 인트로 팝업**(html 모드).
  - 설계 원칙 3가지(주석에도 남김): ①죽는 조건은 **눈에 보여야** 한다(함정을 붉게 발광 → 회피 가능) ②어둠은 라이트를 줄이는 게 아니라 **fog(exp)**로 만든다(더 싸고 시야 제한이 곧 공포) ③라이트 6개·그림자 1개만(광원마다 그림자맵을 매 프레임 렌더).
  - 브라우저 확인 중 고친 것: 시작 지점이 벽에 붙어 **3인칭 카메라가 벽을 뚫던 것**(로비를 뒤로 2m 확장) · 인트로 팝업 글 잘림(높이 380px) · 복도가 너무 어두워 길을 못 찾던 것(fog 0.11→0.095, 복도 등 소폭 상향).
  - **★ 함정: `playerStartPosition`을 안 주면 건물 밖에서 시작한다**(사용자 보고 "게임 시작을 밖에서 해버리네요"). 미설정 시 `PlayModeController`가 **`[0, 4, 0]`(공중 4m)** 로 떨어뜨리는데, `startView`는 **카메라만** 옮기지 캐릭터 스폰과 무관하다 — 둘을 혼동하기 쉽다. **걷기 씬을 만들 땐 `playerStartPosition`을 항상 명시할 것.** 검사 스크립트에 스폰 4종(명시 여부·바닥 위인지·공중 아닌지·벽/가구에 안 끼는지)을 추가해 재발을 막았다.
    - 그 검사를 처음엔 XZ만 봐서 **머리 위 천장을 '충돌'로 오탐**했다 → 캐릭터를 반경 0.4·높이 1.8 기둥으로 보고 **3축 전부** 겹칠 때만 걸리도록 수정.
- **검증 도구(신규) `src/lib/horrorTemplate.check.ts` 35/35**: "게임이 성립하는가"를 데이터로 확인 — 열쇠 3개가 실제로 3을 만드는지 · 문 조건이 keys>=3인지 · 문 모터가 drive=event·collider=true인지 · 승/패 경로 존재 · **이벤트가 가리키는 id가 전부 실존** · 변수/HUD 바인딩 · 벽이 솔리드이고 그림자 off인지 · 라이트 수 상한 · 열쇠 분산·시작~출구 거리. 레벨을 손보면 이걸 먼저 돌릴 것.
- **미리보기 `src/app/test/horror/page.tsx`**: 로그인·게시 없이 템플릿을 **실제 `ViewerClient`로** 플레이(`?t=<templateId>`로 다른 템플릿도). 에디터 ▶ 플레이와 같은 경로라 게임 규칙·HUD·안개가 전부 실동작.
- **사용자 프로젝트에 씬 생성**: `에셋 테스트`(7991f47b…)에 **"공포게임 — 폐병원"** 씬 추가(sceneId `65b798e4-3015-47b8-9459-b87a6c5f23ee`). 기존 씬은 무변경.
- **남은 확인(사용자)**: 에디터에서 씬 전환 → ▶ 플레이 · 열쇠 3개 수집 시 철문 열림 · 함정 밟으면 패배 · 점프스케어 1회.

### 🕯 2차 개편 (2026-07-23) — 난이도 상향 + ★재시작 위치 버그 수정
> 사용자 피드백 두 개: **"붙잡히면 처음부터 다시 시작해야죠"** · **"게임 너무 쉬워요, 레퍼런스 보고 퀄리티 올려줘"**. tsc 클린 + **검증 49/49** + 라우팅 25/25.
- **★ 엔진 버그: 재시작해도 죽은 자리에서 부활 (`PlayModeController.respawnNonce` 신설)**: `restartGame()`이 변수·오버라이드·타이머만 초기화하고 **캐릭터 위치는 안 건드렸다** → 함정에 죽고 '다시 시작'을 눌러도 함정 위에 그대로 서서 즉시 재사망. `runNonce`를 `respawnNonce`로 내려보내(ViewerClient→ViewerCanvas→PlayCanvas→PlayModeController) 값이 바뀌면 스폰으로 텔레포트 + 수직속도·접촉기록(`touchingTimesRef`)·근접기록 초기화. **접촉 기록을 안 지우면 부활 직후 같은 트리거가 다시 터진다.**
  - **영향 = 공포게임 밖**: `game_win`/`game_lose`를 쓰는 **모든** 게임의 재시작이 지금까지 깨져 있었다.
- **레퍼런스 기반 재설계(Amnesia · Outlast · Resident Evil)** — 오브젝트 72 → **106**, 이벤트 16 → 39:
  - **자원 희소성(Amnesia의 기름 → 배터리)**: `battery` 변수 + `on_timer`로 60초마다 -1, 0이면 사망. 배터리 5개를 주워 버틴다(시작 3 + 획득 5 = **최대 8분**). HUD는 숫자가 아니라 **막대**(줄어드는 게 보여야 압박이 된다).
  - **세이프룸(RE)**: '보관실' — 함정 없음 + 초록 등 + 배터리/열쇠 보상. **바깥이 위험할수록 안전한 곳이 그 위험을 실감시킨다.**
  - **페이싱(긴장↔이완)**: 계속 최대 압박이면 지치기만 한다 → 로비·보관실은 밝게, 복도·제단실은 어둡게(fog 0.095→**0.13**, ambient 0.14→**0.09**).
  - **2단계 게이트**: 열쇠 2개 → 지하 격벽 · 4개 → 최종 철문. 한 번에 다 열리면 단조롭다.
  - **탐색 강제**: 열쇠 4개를 전부 방 **안쪽 구석**에 배치(복도 직진으로는 절대 못 깬다). 함정 4→**8개**, 점프스케어 1→2회.
- **검증 확장 49/49**: 자원 수지(**제한 시간이 3~12분인지** — 너무 빡빡하면 운 게임) · 세이프룸에 함정 없는지 · 세이프룸이 밝은지 · 게이트 조건이 단계적으로 오르는지 · 배터리 회복 수단 존재.
  - 검사 자체가 두 번 오탐했다: `game_lose`에 **배터리 소진(씬 전역)** 이 섞여 함정 검사가 깨졌고, 이름만 보고 **'격벽 문짝'(문)** 을 벽으로 잡았다 → 소유자 유무·`primitiveShape`·`isActuator`로 구분.
- **미확인**: 실제 플레이 완주(열쇠 4개 → 탈출)와 죽고 재시작. 브라우저 연결이 끊겨 확인 못 했다.

### 🕯 3차 개편 (2026-07-24) — ★"깰 수 없는 게임"이었던 것을 발견·수정 + 시각 퀄리티 상향
> 사용자 피드백: **"게임 꺨 수는 있게 만들어줘야죠"**(2차 레벨이 실제로 클리어 불가능했다는 지적) **· "너무 퀄리티 낮은 느낌"**. tsc 클린 + **구조 검사 50/50 + 도달가능성 검사 21/21**(신규) + 라우팅 25/25.
- **★★ 근본 원인 발견 — 방 두 개가 물리적으로 겹쳐 있었다**: 이전 좌표표만 보고 배치했는데 **보관실과 제단실이 4×6m 겹치고, 지하 통로는 사방이 막혀 있어 도달 불가**였다. 그런데 **오브젝트/이벤트 그래프 검사(49개)는 전부 통과**했다 — 그 검사들은 "데이터가 정합한가"(id 존재·조건 맞음·좌표 분산됨)만 보지 "실제로 걸어서 갈 수 있는가"는 아예 검증 대상이 아니었다. **깰 수 있는지 확인 안 하고 "구현 완료"라 보고한 게 이번 실수의 핵심.**
- **신규 `src/lib/levelReachability.ts` — 플러드필 기반 도달가능성 계산**: XZ 평면을 0.25m 격자로 잘라 바닥(plane) 위 && 캐릭터 높이(0~1.7m)에서 솔리드에 안 막히는 칸을 걸을 수 있는 칸으로 표시, 스폰에서 4방향 플러드필로 전파. 문(모터)은 `openDoorIds`로 "이 시점엔 열려 있다" 취급해 **단계별**(격벽 전/후, 철문 전/후) 검증이 가능. 캐릭터 반경(0.35m)만큼 벽을 부풀려 좁은 틈 통과를 막는다.
- **신규 `src/lib/horrorReachability.check.ts` 21/21**: 0단계(문 전부 닫힘)에 로비·복도·양쪽 병실·열쇠1·2·배터리1~3이 닿는지, **격벽 전엔 보관실·제단실에 절대 못 감**을 확인(관문이 진짜 막는지 — 데코레이션이 아니라 진짜 장벽인지) → 1단계(격벽 열림)에 보관실·영안실·열쇠3·4가 닿는지, **철문 전엔 제단실에 못 감** → 2단계(둘 다 열림)에 **★탈출구까지 도달 가능**(이게 "깰 수 있는가"의 최종 답) → 참고용으로 함정을 전부 벽 취급해도 우회로가 있는지.
- **레이아웃 전면 재배치(겹침 0 검증됨)**: 8개 방 좌표를 주석에 표로 박아두고(로비·복도·병실A/B·지하통로·보관실·**영안실(신규)**·제단실·탈출통로) 서로 안 겹치게 재설계. 영안실을 새로 추가해 열쇠4를 더 깊숙이(최장 경로 34.6m).
- **시각 퀄리티 — "박스 나열"에서 "공간"으로**: 오브젝트 106 → **183개**.
  - **★후처리(vignette 0.62 + bloom 0.5 + contrast/saturation) — 이 템플릿만 예외적으로 켠다.** 다른 템플릿은 성능 때문에 여전히 끈 채인데, 공포는 비네트(가장자리 어둠)·블룸(빛 번짐)이 룩의 절반이라 끄면 아무리 배치해도 밝은 회색 박스로 보인다. SSAO·DoF 같은 비싼 건 안 씀(검사로 확인).
  - **걸레받이(baseboard)·문틀(frame)** 헬퍼 신설 — 벽과 바닥 경계·통로 입구에 테두리를 줘 "판을 이어붙인 것"에서 "지어진 공간"으로.
  - 재질 팔레트를 방마다 갈랐다(로비=따뜻한 회벽·병실B=차가운 타일·영안실=금속 보관함벽) · 소품 밀도 대폭 증가(무영등·해부대·시신 보관함 격자·깨진 창·벽 낙서·배관 등) · 붉은 고리 2겹으로.
  - `mesh()` 헬퍼에 `opacity` 옵션 추가(가림막 반투명에 필요했는데 없었다 — tsc가 잡음).
- **검사 오탐 2건 수정**: `/벽|천장/` 정규식이 **'보관함 벽'(가구)·'천장 배관'/'벽 얼룩'/'벽 낙서'(장식)** 를 구조 벽으로 오판 → 장식 키워드 제외. 후처리 검사는 "미사용"에서 **"비싼 것만 미사용"** 으로 성격이 바뀌었다(의도적 변경이므로).
- **미확인(중요)**: 이번에도 **브라우저 렌더/플레이는 확인 못 했다**(claude-in-chrome 확장 연결 끊김, 재연결 안 됨). 데이터·도달가능성 검증(71개)은 이번엔 "깰 수 있는가"까지 실제로 확인했지만, **시각적으로 실제 얼마나 나아졌는지·프레임이 끊기지 않는지·붉은 함정이 실제로 눈에 잘 띄는지는 사용자 확인이 반드시 필요.**

#### 🐛 후속 — 천장 층고 상향 (2026-07-24, 사용자 "천장 층고가 너무 낮아요")
> 3차 개편의 3.3m 층고가 다른 템플릿(쇼룸 4.2m·갤러리 4.6m)보다 낮았다. tsc 클린 + **구조 50/50 + 도달가능성 21/21 재검증**.
- **층고 3.3m → 4.2m**(+0.9m, 쇼룸과 동일 수준): 벽 y중심(1.65→2.1)·높이(3.3→4.2)·천장 mesh y(3.3→4.2)를 전 방 일괄 상향. 문 위 인방(철문·출구 상인방)은 **문 상단(2.7)에서 새 천장(4.2)까지** 다시 계산(높이 1.5·중심 y 3.45) — 안 하면 인방과 천장 사이에 구멍이 생긴다. 천장 근처 배관 6개·무영등 암(길이까지 늘림)·실내 조명 7개도 함께 올려 비례 유지.
- **덤으로 수정**: 이전 편집에서 남아있던 오타 색상값(`'#474views'.slice(0,4)+'540'` — 계산은 우연히 유효했으나 유지보수 불가) → `'#474540'` 리터럴로 정리.
- **재검증**: 벽 상단(4.20)과 천장 하단(4.05)이 겹쳐 빈틈 없음·인방이 문~천장을 정확히 채움을 수치로 확인 + 기존 검사 71개 전부 재통과(도달가능성은 격자 높이 판정이 절대값이 아니라 상대 임계라 영향 없음이 확인됨).
- **미확인**: 역시 브라우저 시각 확인 못 함(연결 끊김 지속).

#### 💡 진행 중 — 손전등 신규 엔진 기능 (2026-07-24, 사용자 "손전등은 어떤 기능이죠?" → "꺼지면 눈앞만, 켜면 일시적으로 밝게+타이머") — 브라우저 확인 대기
> 사용자 질문에 답하며 코드로 확인해보니 **"손전등"은 이름만 붙은 카운트다운 타이머**였다(실제 빛 없음·시야 변화 없음, `on_timer`로 상시 소모만). 지적을 받고 **진짜 엔진 기능**으로 새로 만들었다 — 씬 하나에 박아넣지 않고 `EnvSchema.flashlight`로 **재사용 가능한 설정**화(다른 템플릿도 켤 수 있음). tsc 클린 + **구조 검사 53/53(신규 4개 추가) + 도달가능성 21/21**(레이아웃 무변경이라 영향 없음 확인).
- **스키마(`EnvSchema.flashlight`, 전부 옵셔널·미설정=기존 동작 무변화)**: `enabled`·색·세기·원뿔각·거리 + `offFogDensity`/`onFogDensity`(꺼짐=짙은 안개로 시야 제한·켜짐=옅은 안개로 확장, exp 모드 전용) + `batteryVariable`/`drainPerSec`(연동할 변수·초당 소모, 미설정=배터리 무한).
- **`PlayModeController` — 입력·시각을 소유**: 로컬 `flashOn` state, **T키**(고정 — F는 이미 킥에 쓰임)로 토글. `<spotLight>`+타겟 `Object3D`(PlaySceneLight와 동일 패턴)를 캐릭터 몸통(이동시에만 lerp회전) 대신 **카메라 시선(az)** 기준으로 매 프레임 위치·조준 갱신 — 3인칭에서도 "보는 쪽"을 정확히 비춘다. 첫 구현 때 눈높이 오프셋을 잘못 잡아(+1.35, 캡슐 중심 기준 정수리보다 위) 허공에서 비추는 버그가 있었는데, 캡슐 콜라이더 주석(중심↔바닥 −0.9)을 다시 계산해 **+0.7로 수정**.
- **배선 체인(기존 패턴 재사용 — `interactHighlightId`/`onInteractPromptChange`와 동일 구조)**: PlayModeController가 토글 시 `onFlashlightChange` 콜백만 위로 통지(자기 시각은 로컬 소유) → PlayCanvas(`scene.environment.flashlight` 직접 읽어 전달) → ViewerCanvas(`flashlightOn` prop으로 **fog exp density를 override**) → ViewerClient(진짜 상태 소유, `useState` + 배터리 소모 인터벌).
- **★ 자원 모델 전환 — "존재 비용"에서 "사용 비용"으로**: 기존 `on_timer battery|sub|1`(상시 60초마다 소모, 손전등 개념과 무관하게 그냥 죽어가는 타이머)을 **삭제**하고, ViewerClient에 **켜져 있는 동안에만** 초당 `drainPerSec` 소모하는 인터벌 추가(꺼두면 소모 0). "안 켜면 무제한으로 버틸 수 있지만 그 상태로는 몇 미터 앞도 안 보여 사실상 진행 불가"로 강제한다 — 시간이 아니라 필요가 자원을 쓰게 만드는 설계(리얼 호러게임에 더 가까움).
- **재시작 시 리셋**: `respawnNonce` 변화 시 PlayModeController가 `flashOn=false`+통지(죽어서 켠 채였어도 부활 시 꺼짐), `restartGame()`도 이중으로 `setFlashlightOn(false)`.
- **horror 템플릿 적용**: `flashlight.enabled=true`·`batteryVariable='battery'`·`drainPerSec=1/12`(12초당 1) — 배터리 10개(시작4+획득6) × 12초 = **총 120초(2분) 점등 가능**. `offFogDensity 0.28`(~3.5m, "눈앞만") / `onFogDensity 0.045`(~22m, "일시적으로 밝게"). 인트로 팝업 문구를 T키 안내로 갱신.
- **검사 갱신(`horrorTemplate.check.ts`)**: 옛 상시소모 검사(`제한 시간 3~12분`)를 **"총 점등 가능 시간 1~5분"** + "★상시 소모 이벤트 없음(사용 비용 모델 확인)" + "꺼짐 안개가 켜짐보다 짙은지"로 교체.
- **미확인(중요)**: **또 브라우저로 못 봤다**(claude-in-chrome 연결 끊김 지속). 스포트라이트가 실제로 어디를 비추는지, T키가 먹는지, 꺼졌을 때 정말 "눈앞만" 보이는지·켰을 때 자연스럽게 밝아지는지, 2분 배터리가 실제 플레이 감각에 적절한지 — **전부 사용자 확인 필요.** 특히 눈높이 오프셋(+0.7)은 계산으로만 검증했고 실측(옆에서 봤을 때 빛이 진짜 눈높이서 나오는지)은 못 했다.

## 🦾 진행 중 (2026-07-17) — 액추에이터(관절) Phase 5a: 시각 저작 (기준 `doc/PIVOT_MANIPULATION.md §6`) — 브라우저 확인 대기

> 결정 확정(사용자): **①A 경첩 전용 필드 · ②A set_actuator+변수(5b) · ③A 5a부터 확인**. 앵커 근간(Phase 1~3) 위에 관절을 얹음. tsc 클린 + **수학 테스트 10/10**. **✅ ▶ 플레이 동작 확인 완료(사용자, oscillate 문 여닫힘).** speed 최대 5→10(Actuator·Motion).
> - **버그픽스(확인 중 발견)**: ①`PlayCanvas`가 관절 오브젝트를 autoObjects(고정 콜라이더)로 보내 관절 무시 → `actuatorVisualObjects` 라우팅 추가(콜라이더 없이 ViewerObject, autoObjects 제외). ②`ViewerObject` 렌더 분기 3곳(676·761·939, **프리미티브 경로 포함**)이 `{motion ? ...}`로 motion만 검사 → actuator만 있으면 MotionGroup 건너뜀 → 전부 `motion || actuator`로 수정.

- **스키마**(`scene.ts`): `ActuatorConfig{kind(rotate/slide)·axis·hinge?(정규화, 중/엣지 허용)·min·max·drive(manual/oscillate/variable/event)·value·speed·loop·variable·collider}` + `ObjectNodeSchema.actuator?`(옵셔널·**motion과 배타**, 하위호환). `saveScene`는 `objects` 통과라 자동 보존.
- **런타임 수학**(신규 `lib/actuator.ts`): `computeActuator(act, hingeLocal, base pos/rot/scl, driveValue, out)` — rotate=축 회전(로컬 post-multiply)+**경첩 고정 위치보정**(computeMotion 피벗 방식: 회전 전후 경첩 월드위치 일치)·slide=축 방향 이동(오브젝트 회전 반영). `computeDriveValue`(manual=value·oscillate=pingpong/forward). **결정론 테스트 10/10**(경첩 고정·오프셋 위치·dv0 불변·slide·회전반영·oscillate 범위).
- **뷰어 적용**(`ViewerObject`): `MotionGroup`/`Xform`을 **motion·actuator 공용**으로 확장(actuator 우선). `actHinge`=`anchorLocalPoint(localBBox, hinge)`. 호출부 프롭에 `actuator`/`actHinge` 배선(replace_all 7곳 + Xform 내부). → **▶ 플레이·게시 뷰어에서 관절 동작**(에디터 뷰포트는 정적, motion과 동일 패턴).
- **에디터 UI**(신규 `ActuatorSection.tsx`, InspectorPanel Motion 아래·기본 접힘): 사용 토글(켜면 motion 제거·기본 Y축 좌측경첩 문) + 종류/축 + **경첩 3×3 피커**(회전축 수직면, 중/엣지 포함 — 감췄던 "중" 여기서 씀) + Min/Max(°/m) + Drive(manual/oscillate) + value 미리보기/speed·loop. "▶로 확인·motion 배타·변수/콜라이더는 5b/5c" 안내.
- **확인 필요(브라우저)**: 박스에 관절 켜기→문(Y·좌측경첩·0~90)·▶플레이서 여닫힘(manual value / oscillate 자동왕복) · 축/경첩 바꿔가며 · slide 피스톤 · motion과 배타.
### Phase 5b (2026-07-17) — 변수·이벤트 구동 — ✅ 이벤트 구동 확인 완료
> "다가가서/클릭으로 문 열기" 게임 로직. tsc·컴파일 클린. **✅ Click→관절 여닫기(토글) ▶ 플레이 동작 확인(사용자).** variable 구동은 미확인.
- **스키마**: `EventAction`에 **`set_actuator`** 추가. **컨텍스트**(신규 `ActuatorDriveContext.ts`): objectId→목표 driveValue(0..1), ViewerCanvas Provider(clip 옆·탐색/플레이 공통).
- **뷰어 이징**(`ViewerObject` MotionGroup): drive=variable/event면 컨텍스트 목표(`actDrive`)를 향해 speed 비례 이징(첫 프레임 스냅), manual/oscillate는 `computeDriveValue`. `actDrive` prop 배선.
- **런타임**(`ViewerClient`): `actuatorDrive` 상태 + **`set_actuator` 핸들러**(`"objId|open/close/toggle/0~1"`, toggle=현재값 반전) + **variable 동기**(`syncVarActuators`: 변수값 clamp01→목표, onVarsChanged·init, event 목표 머지 보존) + restart 리셋 + ViewerCanvas prop.
- **에디터**: `ActuatorSection` Drive에 변수/이벤트(변수=바인딩 SelectBox·이벤트=안내·Ease speed) · `EventsSection` **set_actuator 액션**(관절 오브젝트 대상 + open/close/toggle).
- **확인 필요(브라우저)**: Actuator Drive=이벤트 → 박스 Click(또는 interact/approach) '관절 여닫기·자신·토글' → ▶ 플레이서 클릭/근접 시 부드럽게 여닫힘 · 변수 구동은 변수 0↔1 시 따라감.
### Phase 5c (2026-07-17) — 콜라이더 동반 (진짜 부딪히는 관절) — ✅ 확인 완료
> tsc·컴파일 클린. **✅ 콜라이더 동반 ON + 이벤트/oscillate 구동 → ▶ 플레이서 여닫히는 문에 캐릭터 충돌 확인(사용자).**
- **신규 `ActuatorCollider`**(`PlayCanvas`, MovingCollider 패턴): `actuator.collider===true` 루트 → **kinematic 강체**를 매 프레임 `computeActuator`로 구동(`setNextKinematicTranslation/Rotation`). 구동값 = manual/oscillate 자체계산 · variable/event는 `ActuatorDriveContext` 목표를 향해 이징(MotionGroup과 동일). 월드베이스(`worldMatrix` decompose)·경첩(`anchorLocalPoint`)·`getColliderType`. 시각=`ViewerObject noTransform noMotion`(강체가 이동).
- **라우팅**: `isActuatorColliderObj` + `actuatorColliderObjects` 필터, autoObjects·physicsObjects·actuatorVisual에서 제외, `<ActuatorCollider>` 렌더.
- **UI**: `ActuatorSection`에 **콜라이더 동반 토글**.
- **확인 필요(브라우저)**: 관절+콜라이더 ON → ▶ 플레이서 캐릭터가 **여닫히는 문/스윙 장애물에 실제로 막힘**. (제약: hull 근사·비균일 스케일 왜곡·라이딩 미지원)
### 에디터 관절 가이드 (2026-07-17) — ✅ 확인 완료
> 신규 `canvas/ActuatorGizmo.tsx`(EditorCanvas, SelectionOutline 패턴). 선택 관절 오브젝트의 **경첩(주황 구)+축(주황 선)** 을 에디터에 실시간 표시(읽기전용, raycast 제외). 경첩=`anchorLocalPoint`·축=오브젝트 월드회전 반영·선길이=월드bbox 최대변×0.6. tsc·컴파일 클린. **✅ 표시·경첩 이동 확인(사용자).**

- **✅ Phase 5 핵심 완료·검증**: 5a(시각) · 5b(이벤트 구동) · 5c(콜라이더) · 에디터 가이드 전부 브라우저 확인 완료. (variable 구동만 미확인 — 이벤트와 동일 경로라 저위험)

### 🦾 진행 중 (2026-07-19) — 액추에이터 Phase 6: 로봇팔 프리셋(A) + 스윕 가이드(B) + 다듬기(C) — 브라우저 확인 대기
> Phase 5 핵심 완료 후, 아래 A·B·C **셋 다 구현**(사용자 "액추에이터 중요하니 제대로"). tsc 클린 + **easeDrive 테스트 10/10 · 로봇팔 구조 테스트 11/11** + dev 컴파일/편집 라우트 200. **브라우저 확인 대기.**

- **(B) 범위 스윕 가이드 — `canvas/ActuatorGizmo.tsx`**: rotate 관절 선택 시 경첩 중심으로 **min→max 회전 범위를 주황 부채꼴(채움 opacity 0.16)+테두리 라인**으로 표시. 기준 반경 벡터=회전축 수직 로컬축(bbox 긴 쪽)→월드, 반경=축선 길이. 범위 0이면 부채꼴 숨김. slide는 부채꼴 없음(축 선만). depthTest off·raycast null(가이드).
- **(C-2) min/max 뷰포트 핸들 — 같은 파일**: 부채꼴 양 끝에 **드래그 핸들**(min=주황·max=연노랑 구). 끌면 포인터를 회전 평면(경첩·축 법선)에 투영해 각도(°) 산출→`updateObject`로 min/max 실시간 반영(드래그 끝 `pushHistory` 1회). orbit는 드래그 중 비활성. `ActuatorGizmo`에 `orbitRef` prop 추가(EditorCanvas 배선). **±180° 범위 한계**(그 이상은 인스펙터 입력).
- **(C-3) variable 범위 매핑 — `scene.ts`·`ViewerClient.syncVarActuators`·`ActuatorSection`**: `ActuatorConfig.varMin?/varMax?`(기본 0/1). 변수값 [varMin,varMax]→구동 [0,1] 정규화(역방향 허용). 예: 체력 0~100→0/100. UI=variable 구동 시 varMin/varMax 입력.
- **(C-1) 이징 종류 — `lib/actuator.ts`(신규 `makeDriveState`/`easeDrive`·`DriveEaseState`)·`ViewerObject`·`PlayCanvas`·`ActuatorSection`**: `ActuatorConfig.ease?: 'smooth'|'linear'|'inout'`(기본 smooth=기존 지수감쇠, **회귀 0**). 이징 로직을 공용 헬퍼로 추출 → **시각(ViewerObject)·콜라이더(ActuatorCollider) 동일 로직 공유**(콜라이더 동반 시 어긋남 방지). smooth=감쇠·linear=등속·inout=가감속 트윈(재타겟 시 현재값서 새 트윈). 테스트 10/10(수렴·범위·등속·가감속·재타겟).
- **(A) 로봇팔 다관절 프리셋 — `lib/objectPresets.ts`(신규 `PresetNode`/`NodePreset`/`NODE_PRESETS`·`ROBOT_ARM`)·`sceneStore.addNodePreset`·툴바**: **중첩 그룹 트리**를 한 번에 스탬프 = 베이스(Y턴테이블)→어깨(Z경첩)→팔꿈치(Z경첩)→손목(Y회전), 각 관절 그룹에 actuator + 시각 마디 메쉬. 자식 담으려면 **그룹이어야** 렌더가 자식 순회(확인함). 구동=**oscillate**(마디마다 속도 다름+개별 위상 → 자연 스윕, ▶ 플레이서 스스로 움직임). 경첩=각 그룹 밑면(hinge y:0). `addNodePreset`=key→UUID 리맵·parentId 연결·루트 placeAt·단일 undo. 툴바 프리셋 드롭다운에 '로봇팔(다관절)'(node:true→addNodePreset). **구조 테스트**: 관절 원점이 부모 마디 상단과 정확히 연결(gap 0)·경첩 y:0 확인.
- **확인 필요(브라우저)**: ~~①로봇팔 스탬프→▶플레이서 4관절 스윕~~ **✅ 확인 완료(사용자, "잘 움직인다")** · ②박스 rotate 관절 선택 시 부채꼴 표시·min/max 핸들 드래그로 각도 조절(undo 1회) · ③variable 구동 varMin/varMax 매핑(체력바 등) · ④이징 smooth/linear/inout 느낌 차이(event/variable 구동) · ⑤콜라이더 동반 시 시각=콜라이더 이징 일치.
- **미확인 잔여**: 액추에이터 variable 구동 자체(Phase 5b부터 미확인, 이벤트와 동일 경로).

### 🦾 진행 중 (2026-07-19) — 액추에이터 Phase 7: 모터형(부품) 액추에이터 M1 — 브라우저 확인 대기
> 사용자 요청·확정: **액추에이터를 "독립 부품(모터)"으로** — 씬에 모터 오브젝트(dot)를 놓고 **다른 오브젝트를 연결(재부모화)** 하면 모터가 그것을 구동. 기존 속성형(오브젝트에 actuator 얹기)과 **공존, 모터형을 주력**. 연결=재부모화. tsc 클린. **브라우저 확인 대기.**
> - **핵심**: 모터 = `isGroup:true + isActuator:true + actuator`. 자식(연결된 오브젝트)을 **모터 원점(=경첩)** 기준으로 구동 → 런타임은 기존 그룹+actuator 중첩 경로 그대로 재사용(로봇팔과 동일 원리). 경첩=원점이라 3×3 피커 불필요(모터를 경첩 자리로 옮기고 회전시켜 축 맞춤).
- **스키마**(`scene.ts`): `ObjectNodeSchema.isActuator?`(옵셔널·하위호환, normalize 통과 보존).
- **스토어**(`sceneStore`): `addActuatorObject(placeAt?)`(모터 오브젝트 생성, 기본 Y회전·oscillate) + `PendingPlacement 'actuator'` + `commitPlacement`. **★ `moveObject`의 `recenterGroup`를 모터엔 스킵**(모터는 원점=경첩이라 재중심하면 경첩이 자식 중심으로 튐 — 중요 수정). `ungroupSelected`도 모터 제외(부품은 삭제로만).
- **뷰어/콜라이더**: `ViewerObject.actHinge`·`PlayCanvas.hingeVec`가 `isActuator`면 **null(원점 경첩)** 반환 → 자식이 모터 원점 기준 회전. (motion과 배타·이징·drive 전부 승계.)
- **에디터**: 신규 `MotorObjectInstance`(EditorObjectInstance 분기, isGroup보다 먼저) — 원점에 **클릭 가능한 주황 dot**(비어 있어도 선택 가능) + 자식 중첩 렌더. `ActuatorGizmo`가 모터면 경첩=원점·빈 모터도 축/부채꼴 표시(기본 반경 1.2).
- **인스펙터**(`ActuatorSection` 모터 모드): 켜기 토글·경첩 피커·콜라이더 토글 숨김, "트리에서 드래그해 연결" 안내. `InspectorPanel`에서 모터는 Motion/Animation 숨기고 Actuator만 노출(항상 펼침).
- **연결 = 트리 드래그**: 오브젝트를 모터 아래로 드롭 → `moveObject inside`가 **월드 변환 보존하며 재부모화**(기존 로직). → ▶ 플레이서 그 오브젝트가 모터 축 기준으로 돎.
- **진입점/아이콘**: 툴바 ✨ 프리셋 드롭다운에 **"모터 (연결해서 돌리기)"**(`Cog`, 배치 모드) · 트리 아이콘 `Cog`.
- **확인 필요(브라우저)**: 툴바→모터 배치(dot) → 트리에서 박스를 모터로 드래그(연결, 제자리 유지) → ▶ 플레이서 박스가 모터 원점 기준 회전 · 모터 옮겨도 경첩 안 튐 · 모터 선택 시 축/부채꼴/핸들 · 축·범위·drive(oscillate/event/variable) 바꿔보기.
- **M1 미포함(후속 M2)**: 인스펙터 "연결/해제" 버튼(드래그 대신 클릭) · 로봇팔을 모터 체인으로 재구성 · 모터+콜라이더(그룹 콜라이더 구동) · set_actuator 이벤트 대상에 모터 노출 확인 · 모터 라벨/문구 다듬기.

#### Phase 7 M2 (2026-07-19) — 모터 연결 UX·콜라이더·모터체인 + ★M1 플레이 라우팅 버그픽스 — 브라우저 확인 대기
> M1 위에 M2 전부 구현(사용자 "컨펌 없이 순차 진행"). tsc 클린 + **로봇팔(모터체인) 구조 테스트 11/11** + dev 컴파일/편집·플레이 라우트 200.
- **★ M1 플레이 라우팅 버그픽스(중요)**: 모터(그룹·모션없음)가 `PlayCanvas`에서 `groupObjects→GroupWithCollision`(정적 자식 콜라이더)로 가서 **플레이 모드에서 관절이 안 돌던** 문제. `groupObjects`에서 `isActuator` 제외 → 모터는 `movingGroups`(시각)로 가 **ViewerObject가 actuator 구동**(자식 회전). (M1 시각 검증은 됐으나 플레이 콜라이더 경로가 정적으로 굳던 것.)
- **M2-1 연결/해제 UI**(신규 `MotorLinkSection.tsx` + `sceneStore.reparentObject`): 신규 `reparentObject(objId, newParentId|null)`(월드 변환 보존 재부모화·단일 undo). 인스펙터 = 모터 선택 시 **연결된 부품 목록+해제**, 일반 오브젝트 선택 시(씬에 모터 있으면) **"모터에 연결" 드롭다운/해제**. InspectorPanel Actuator 아래 렌더. (트리 드래그 연결과 병행.)
- **M2-2 이벤트 대상**: `set_actuator`가 이미 `objects.filter(o=>o.actuator)`라 **모터 자동 포함**(모터 Drive=이벤트로 설정 시 여닫힘). 무변경 확인.
- **M2-4 모터+콜라이더**: `PlayCanvas`에 `actuatorGroupColliders`(=`isActuator && actuator.collider`) 버킷 추가 → **기존 `ActuatorCollider` 재사용**(hinge=원점 이미 처리·`ViewerObject noTransform noMotion`에 `allObjects` 전달해 자식 서브트리 렌더 → hull/trimesh 콜라이더 자동 생성, kinematic 구동). `ActuatorSection` 모터에도 **콜라이더 토글 재노출**. → 연결된 부품이 플레이서 진짜 부딪힘.
- **M2-5 로봇팔=모터 체인**: `ROBOT_ARM` 4관절을 `isActuator:true`(hinge 제거·원점=경첩)로 전환 = **모터 체인**. 마디 base가 각 모터 원점이라 예전 hinge{y:0}과 **동일 거동**(behavior-preserving). `PresetNode.isActuator?` + `addNodePreset` 반영. 구조 테스트 11/11(연결 정렬·모터·hinge 없음).
- ~~**확인 필요(브라우저)**: ①모터 연결→▶플레이서 회전(콜라이더 경로 버그픽스) · ②연결 부품 목록·해제 · ③모터 콜라이더 ON→캐릭터 막힘~~ **✅ 전부 확인 완료(사용자, 2026-07-20 — TC-1~5). ④로봇팔 관절=모터(Cog) 표시도 확인.**

### ✅ 모터 액추에이터 M1+M2 브라우저 검증 완료 (2026-07-20)
> 사용자 TC-1~5 전부 확인("잘되는거 같아"). 액추에이터 핵심 기능 검증 종료. **variable 구동도 확인(Phase 5b부터 미확인이던 잔여 해소).**
- ✅ **TC-1 ★모터 연결→▶플레이서 회전** (M1 플레이 라우팅 버그픽스 검증 — 최우선) · ✅ TC-2 인스펙터 연결/해제(`MotorLinkSection`) · ✅ TC-3 모터 콜라이더 ON→캐릭터 막힘 · ✅ TC-4 이벤트 구동(set_actuator toggle) · ✅ TC-5 variable 구동(boolean 변수 토글 0↔1).
- **이번 세션 수정**: ①**기즈모 피벗** — 모터 선택 시 이동/회전/스케일 기즈모가 자식 중심이 아니라 **원점(dot=경첩)** 에 뜨도록 `GizmoController`에 `isActuator` 분기 추가(`cLocal=(0,0,0)`). ②**TC-5 안내 정정** — number 변수엔 토글 연산 없음(add/sub/…만), **boolean 변수라야 한 버튼 토글(반전)** 가능. `syncVarActuators`가 boolean을 0/1로 매핑(거짓=닫힘·참=열림).
- **알려진 제약(보류)**: 무빙/액추에이터 콜라이더가 **가만히 선 캐릭터를 밀지 못하고 관통**(W 놓으면 통과) — Rapier kinematic character controller 한계. 하단 '알려진 제약/한계' 참고.

### 🦾 진행 중 (2026-07-20) — 모터 M3-A: 모터 프리셋 4종 + 그룹내 다중모터 라우팅 픽스 — 브라우저 확인 대기
> M3 후보 중 **모터 프리셋**을 우선 선택(가치 최고·위험 최저 — 검증 끝난 addNodePreset 파이프라인 위 순수 데이터). tsc 클린 + dev 편집 라우트 200 컴파일. **브라우저 확인 대기.**
- **★ 라우팅 픽스(`PlayCanvas.tsx` GroupWithCollision)**: 평범한 그룹 자식이 **모터(isActuator)** 면 정적 GroupWithCollision로 굳어 플레이서 안 돌던 문제 → `if (child.motion || child.isActuator)`로 **ViewerObject 시각 구동**(루트 모터 픽스와 동일 논리를 그룹 자식에도). → **평범한 그룹 안에 모터 여러 개** 넣은 조립품(기어·쌍여닫이문 등) 플레이 동작. (기존 비-모터 그룹 무영향 — strictly 개선.)
- **프리셋 4종(`objectPresets.ts` NODE_PRESETS, 전부 모터·oscillate 자동구동·콜라이더 기본 OFF)**:
  - **여닫이문(hinged_door)**: 왼쪽 경첩 Y회전(0~100°) 자동 여닫힘. Drive를 이벤트로 바꾸면 E로 여는 문. 문짝+손잡이.
  - **엘리베이터(elevator)**: slide Y(0~3m) 오르내림. 바닥판+3면 벽.
  - **회전문(revolving_door)**: 한 모터 Y 연속회전 + 중심기둥 + 유리날개 4개 = **"한 모터에 여러 부품" 표본**.
  - **기어 한 쌍(gears)**: 평범한 그룹 + 모터 2개(Z 연속회전), B를 180° 뒤집어 반대로 맞물림, 표식 박스로 회전 가시화 → **라우팅 픽스 동작 검증용**.
- **툴바(`ViewportFloatingToolbar`)**: ✨ 프리셋 드롭다운에 4종 추가(node:true → 기존 배치 모드/addNodePreset 경로 재사용). 아이콘 DoorOpen·ArrowUpDown·RotateCw·Settings.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "기어가 둘 다 잘 도네") — 그룹내 다중모터 라우팅 픽스 실전 검증.** (기어=핵심 검증. 문·엘베·회전문 동일 파이프라인.)

### 🦾 진행 중 (2026-07-20) — 모터 M3-B: 뷰포트 3D 연결(클릭으로 부품 붙이기) — 브라우저 확인 대기
> M3 다음 항목. **축 드래그 기즈모는 우선순위 내림**(기즈모 피벗=dot 픽스로 일반 회전 기즈모가 축 조준 커버 — 중복). tsc 클린 + dev 편집 라우트 200. **브라우저 확인 대기.**
- **설계 = 격리된 "연결 모드"**(회귀 위험 최소화): 모터 선택 → 인스펙터 `MotorLinkSection` **"3D로 부품 연결"** 버튼 → 뷰포트에서 오브젝트 클릭할 때마다 그 오브젝트(최상위 조상)를 모터에 연결(reparent). **연속 연결**(여러 개 붙이기), 빈 곳 클릭/ESC로 종료.
- **핵심 배선 — 단일 인터셉트**: 모든 에디터 클릭이 `EditorObjectInstance.selectByClick` 한 함수를 거치는 걸 확인 → **거기 최상단에 연결 모드 분기 하나** 추가로 프리미티브·그룹·모터dot·GLB·라이트·콘텐츠 전 경로 커버(저위험). `reparentObject`가 self/자손/사이클을 이미 no-op 처리(월드 변환 보존·단일 undo)라 가드 재사용.
- **스토어**: `connectMotorId` state + `beginConnect(motorId)`/`cancelConnect()`.
- **EditorCanvas**: 연결 모드 배너(주황 "오브젝트를 클릭 · 빈 곳/ESC 종료") + ESC 핸들러 + crosshair 커서 + `onPointerMissed`=연결 종료 + `handlePointerDown`에서 마퀴 시작 가드(연결 모드 중 드래그선택 방지).
- **확인**: ✅ ①모터 선택→"3D로 부품 연결"→클릭 연결 · ②여러 개 연속 연결 · ③빈 곳/ESC 종료 **— 확인 완료(2026-07-20, 사용자 "잘된다").** / (미확인·저위험) ④모터 자신·자손 클릭 무시(사이클) · ⑤연결 후 ▶ 플레이 회전.
- **🐛 버그픽스(2026-07-20, 사용자 보고 "모터는 드래그해서 선택이 안됨")**: 마퀴(드래그) 선택 루프(`EditorCanvas` handlePointerUp)가 `obj.isGroup`을 통째 스킵(그룹=자식→루트 해석) → **빈 그룹인 모터는 잡아줄 자식이 없어 마퀴 선택 불가**(기존 잠복). → 조건을 `obj.isGroup && !obj.isActuator`로 완화, **모터는 스킵 제외**(dot/연결 부품 bbox로 직접 판정, getRootId가 루트 해석). tsc 클린. **✅ 확인 완료(2026-07-20, 사용자 "된다") — 모터 드래그 선택됨.**
- **M3 남은 후보**: ~~라벨·색·dot 다듬기~~ **✅ 완료(2026-07-20, 아래 폴리시 블록)** · 축 드래그 기즈모(보류·중복) · 추가 프리셋(쌍여닫이문 등).

#### ✨ 폴리시 (2026-07-20) — 모터 라벨·색·dot 다듬기 — 브라우저 확인 대기
> M3 폴리시 마무리. tsc 클린 + dev 편집 라우트 200. **브라우저 확인 대기.**
- **dot 다듬기(`MotorObjectInstance`)**: 연결 부품(로봇팔 베이스·기어 등)에 dot이 **묻혀 안 보이던 것** → 보이는 dot·선택 링·후광을 **`depthTest=false`+renderOrder 999/1000**으로 항상 최상단 표시(부품 안에 있어도 찾김). **클릭 히트 영역**을 보이는 dot(0.12)보다 큰 투명 구(0.24)로 확대(잡기 쉬움).
- **색 일관성**: 모터 오렌지를 **`#ff7a0d`로 통일** — dot·기즈모는 이미 #ff7a0d인데 연결 UI(배너·`MotorLinkSection` 버튼)만 #c04a2b(다른 오렌지)였음 → #ff7a0d로 맞춤.
- **라벨**: 모터 인스펙터 섹션 제목 `Motor` → **`모터 (Motor)`**(한글 UI 일관).
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — dot 항상 보임·클릭됨, 색 통일, 제목 "모터".**

#### ✨ 폴리시 2차 (2026-07-20) — 모터 아이콘 = 기어 + 라벨 · 부채꼴 핸들 드래그 수정 — 브라우저 확인 대기
> 사용자 요청 2건. tsc 클린 + dev 편집 라우트 200. **브라우저 확인 대기.**
- **모터 표식 = 기어 아이콘 + 빌보드 라벨(사용자 선택)**: 주황 원(구)이 모터인지 알기 어렵다는 피드백 → `MotorObjectInstance`의 dot을 **톱니바퀴(기어) 실루엣 메쉬**(`MOTOR_GEAR_GEO`=ExtrudeGeometry, 이빨 8개+구멍, 모듈 1회 생성)로 교체. drei **`<Billboard>`** 로 항상 카메라를 향해 어느 각도서도 '기계 부품'으로 읽힘. `depthTest=false`+renderOrder로 부품에 묻혀도 보임. **선택 시 `<Html>` 라벨 "⚙ 모터"**(선택 때만 — 여러 모터 화면 지저분 방지, 한글이라 troika 대신 DOM). 클릭 히트 구·선택 링 유지.
- **부채꼴(min/max) 핸들 드래그 버그 수정(`ActuatorGizmo`)**: 각도 계산이 `atan2`(±180°)라 180° 넘게 끌면 값이 음수로 점프 → 부채꼴 뒤집힘·360° 도달 불가. → **프레임 간 델타 unwrap 누적**(경계 넘어도 연속)+첫 move는 기준만 잡아 잡는 순간 점프 방지. **클램프 = 반대 핸들 기준 상대(`min ≤ max ≤ min+360`)** → 스윕(max−min) 0~360° 보장(절대 [-360,360]만 막으면 min 음수+max 양수로 스윕이 360° 초과하던 버그 수정, 2026-07-20 사용자 재보고).
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — 기어 아이콘·라벨·부채꼴 드래그(스윕 0~360° 클램프) 정상.**

#### ✨ 폴리시 3차 (2026-07-20) — 핸들 크기(줌아웃 시 가림) + 부채꼴 핸들 회전 커서 — 브라우저 확인 대기
> 사용자 2건. tsc 클린 + dev 편집 라우트 200. **브라우저 확인 대기.**
- **핸들 크기 상한(`ManipulationHandles`·`ActuatorGizmo`)**: 화면 고정 픽셀 크기라 **줌아웃 시 오브젝트는 작아지는데 핸들은 그대로라 핸들만 보이던 문제**. → ①**뷰포트 높이 보정**(`800/size.height`)으로 창 리사이즈에도 픽셀 크기 일정 + ②**오브젝트 크기 비율 상한**(`min(화면고정, objMax*0.12)` / 모터는 `len*0.16`) → 가까이선 잡기 좋은 고정 크기, 멀리선 오브젝트에 비례해 작아져 안 가림.
- **부채꼴 핸들 회전 커서(`ActuatorGizmo`)**: 오브젝트 핸들의 리사이즈 커서처럼, 모터 min/max 핸들에 **원형 화살표(회전) 커서**(주황 SVG data-URI, 폴백 grab). hover·드래그 중 표시, 놓으면 해제.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "좋아") — 핸들 크기 상한·회전 커서 정상.**

### 🔧 진행 중 (2026-07-21) — 모터 사용성 개선 A·B·라우팅 (A·B ✅ 확인 / 라우팅 확인 대기)
> **사용자 문제 제기**: "모터 사용성이 아주 안 좋다. 잘못하면 작업물을 전부 삭제해야 할지도." 사례 = **새에 날개를 붙이고 날개에 모터를 달려는데**, 경첩을 어깨로 보내려면 모터가 아니라 **날개를 옮겨야** 하고, 그러면 몸통과의 위치 관계가 깨져 **다시 몸에 붙이는 왕복**이 생긴다.
> **진단(3개 문제)**: ①경첩=모터 원점=부모라 **경첩만 옮기는 게 구조적으로 불가능** ②모터 제거가 **파괴적**(`ungroupSelected`가 모터를 걸러서 삭제밖에 없고, 삭제는 자손까지 지움 — 우려가 사실이었음) ③이 케이스는 사실 **속성형 관절**이 맞는 도구인데 안내가 없어 더 무거운 모터를 집게 됨.
> 합의한 순서 **A → B → C**. tsc 클린 + **결정론 테스트 25/25**(`npx tsx src/store/motorPivot.test.ts`) + dev 편집 라우트 200.

- **✅ A — 경첩만 이동(`moveMotorPivot`)**: `recenterGroup`의 계산(원점만 옮기고 자식 로컬 역보정)을 **`setGroupOriginWorld(objects, groupId, target)`** 으로 추출해 임의 지점으로 일반화(`recenterGroup`은 centroid를 넘기는 얇은 래퍼 = 동작 무변경). 신규 액션 `moveMotorPivot(motorId, world)` — 모터 전용 가드, `_prevSnapshot` 지연커밋이라 **드래그 전체가 undo 1회**.
  - **UI = 격리된 "경첩 이동 모드"**(`pivotMotorId`+`beginPivotMove`/`cancelPivotMove`, 기존 3D 연결 모드와 동일 패턴). **★모드 중 이동 기즈모를 숨기는 게 필수** — 모터 기즈모는 피벗이 dot(=경첩)이라 **기즈모 중심(XYZ 자유이동 핸들)이 경첩과 같은 자리**여서, 안 숨기면 경첩 드래그를 기즈모가 가져간다(`GizmoController.showGizmo`에 `!pivotMoving`).
  - `ActuatorGizmo`: 경첩 구 옆에 **투명 히트 구(hScale×3)** + `startPivotDrag`(카메라를 향한 평면에 포인터 투영, 잡은 순간 오프셋 고정 → 점프 방지) + 4방향 이동 커서. `hingeW` 갱신을 rotate 분기 **이전**으로 올림(slide 관절에서도 최신이어야 함).
  - 진입 = `MotorLinkSection` "경첩 위치 옮기기 (부품은 제자리)" · ESC 종료 · 주황 배너 · 마퀴 방지.
  - **한계**: 깊이는 카메라 평면 위에서만 이동(시점 돌려 재드래그). **✅ 확인 완료(2026-07-21, 사용자 "기능은 된다").**
  - **🐛 후속 버그픽스 (2026-07-21, 사용자 보고 "확대 후 다시 드래그하면 카메라가 회전 / 모터가 안 움직임")**: 원인은 결국 **하나 — 경첩 핸들이 안 잡혔던 것**. 증상만 3가지로 달라 보였다(선택이 부품으로 넘어가 기즈모 부활 → 드래그가 orbit로 샘 → 아무 반응 없음).
    - **★진짜 원인 = 커스텀 레이캐스트 누락**: 레이캐스트는 `depthTest`와 무관하게 **카메라에서 가장 가까운** 교차를 고른다. 경첩은 대개 부품 모서리/내부라 **앞을 가린 부품 표면이 먼저 잡혀** 핸들러가 호출조차 안 됐다(확대하면 부품이 화면을 채워 거의 항상 재현). → 히트 구에 **`topRaycast`(교차 거리를 1e-6으로 덮어써 최우선)** 적용 — `ManipulationHandles`가 코너 핸들 occlusion에 쓰던 것과 동일 수법.
    - **orbit 누수**: orbit 비활성화를 pointerdown → **hover 시점**으로 이동. R3F `stopPropagation`은 **네이티브 OrbitControls 리스너를 못 막아** pointerdown에서 끄면 이미 시작된 카메라 조작이 샌다(ManipulationHandles 선례와 동일). + 핸들에 hover한 채 모드가 끝나면 `onPointerOut`이 안 와 orbit이 꺼진 채 남는 문제 → `pivotMoving` 해제 시 무조건 복구하는 안전장치.
    - **선택 넘어감**: `selectByClick`에 경첩 모드 인터셉트(모드 중 클릭으로 선택 변경 차단) + 모터 기어 히트 구를 모드 중 레이캐스트에서 제외(고정 반경 0.24라 확대 시 화면 크기 일정인 경첩 핸들을 삼킴) + 빈 곳 클릭·`selectObject`/`selectObjects`에서 선택이 모터를 벗어나면 모드 자동 종료(유령 상태 방지).
    - **교훈**: 뷰포트 3D 핸들을 새로 만들 땐 **`ManipulationHandles`를 먼저 참고할 것** — occlusion(topRaycast)·orbit 누수(hover 비활성)·복구 안전장치가 이미 다 풀려 있다. 이번 3연속 수정은 전부 그걸 안 봐서 생겼다.
    - **✅ 확인 완료(2026-07-21, 사용자 "지금은 확대해도 이동된다").**
- **✅ B — 모터만 제거(`removeMotorKeepParts`)**: 부품을 **모터의 부모(중첩이면 조부모)** 로 승격시키며 월드 변환 보존(ungroupSelected와 같은 행렬 기반 복원) 후 모터 노드만 삭제. 단일 undo, 풀려난 부품이 선택됨, 사라진 모터를 대상으로 하던 연결/경첩 모드는 자동 종료.
  - UI = 인스펙터 "모터만 제거 (부품 N개 유지)" + **트리 우클릭**. 삭제와의 차이 안내 문구 포함.
  - **🐛 기존 버그 수정**: 모터도 `isGroup`이라 우클릭에 **"그룹 해제"가 떴지만 `ungroupSelected`가 모터를 early-return**해서 눌러도 아무 일도 안 하던 죽은 메뉴 항목 → 모터일 땐 숨기고 "모터만 제거"로 대체. **✅ 확인 완료(2026-07-21).**
- **🐛 라우팅 갭 수정(`PlayCanvas` `GroupWithCollision`) — 브라우저 확인 대기**: C의 전제("부품 하나면 속성형 관절로 처리")를 세우려 확인하다 발견. **그룹 자식 처리에 속성형 관절(`child.actuator`) 분기가 아예 없어** 맨 아래 정적 RigidBody로 떨어지고 있었다(루트 오브젝트는 `isActuatorVisualObj`/`isActuatorColliderObj`로 이미 옳게 처리 중 — **그룹 안에서만** 빠져 있던 것).
  - 증상 ①**콜라이더 OFF** → 정적 콜라이더가 남아 **유령 콜라이더**(시각은 관절로 움직이는데 안 보이는 벽이 원래 자리에). ②**콜라이더 ON** → kinematic 구동 없이 정적 → 시각만 움직이고 **실제로 안 부딪힘**.
  - 수정 ①`isVisualOnlyMotionObj(child) || isActuatorVisualObj(child)` → 콜라이더 없이 시각만. ②`actuatorColliderObjects`를 루트 전용 → **전 depth**로 확장(`ActuatorCollider`가 `worldMatrix` 기반이라 깊이 무관) + `GroupWithCollision`에서 스킵해 이중 렌더 방지. `movingColliderObjects`와 동일 규칙(움직이는 그룹 아래·숨은 조상·통과 제외).
  - ~~**의도적 미수정**: *그룹 자체*에 속성형 `actuator`~~ → **아래 "라우팅 갭 2차"에서 수정함**(사용자가 실제로 쓰던 경로였음 — 미루기로 한 판단이 틀렸다).

#### 🐛 라우팅 갭 2차 (2026-07-21) — 관절 판정에서 `!o.isGroup` 제거 + 버킷 중복 3종 — 브라우저 확인 대기
> 사용자 보고("복셀·클로너에 액추에이터가 적용 안 됨" → 좁혀서 **클로너**)로 발견. **복셀은 정상**이었고 진짜 원인은 **그룹**. tsc 클린 + 스토어 테스트 61/61 + dev 컴파일.
- **★ 근본 원인 — 관절 판정에 `!o.isGroup`이 박혀 있었다**: `isActuatorVisualObj`/`isActuatorColliderObj`가 그룹을 배제해서, **모터가 아닌 그룹(클로너 등)에 관절을 걸면 정적 버킷(`groupObjects`)으로 떨어져 플레이에서 관절이 통째로 얼어붙었다.** "그룹은 모터 경로가 전담한다"는 전제였는데 **"평범한 그룹 + 속성형 관절"이 그 전제에서 빠져** 있었다.
  - **모드 간 불일치였다**: 둘러보기(`ViewerCanvas`)는 모든 오브젝트를 `ViewerObject` 하나로 그려 `motion || actuator`면 그룹이든 아니든 움직인다 → **둘러보기는 되는데 플레이만 안 되는** 상태.
  - 수정 = 판정에서 `!o.isGroup` 제거(`hasActuator` 공용화) + 관절 그룹을 `groupObjects`(정적)·`movingGroups`(시각)에서 제외 + `GroupWithCollision` 그룹 자식 분기에 `child.actuator` 추가.
  - **덤으로 버킷 하나 소멸**: `actuatorGroupColliders`(모터 전용)와 `actuatorColliderObjects`(오브젝트 전용)가 **똑같이 `<ActuatorCollider>`를 렌더**하고 있었다 → 판정 통합으로 하나로 합침. 갈래가 줄어 누락 여지도 줄었다.
- **버킷 중복/누락 2종 추가 수정**: ①`physicsObjects`가 `isActuatorVisualObj`를 제외하지 않아 **물리 켠 관절 오브젝트가 두 버킷에 동시에 들어가 이중 렌더**(정적 물리 복사본 + 움직이는 시각 복사본이 겹쳐 "안 도는" 것처럼 보임). ②`actuatorGroupColliders`가 `allGroups`(루트 전용)라 **중첩 모터는 콜라이더를 아예 못 받았다** — C("부품 자리에 모터 삽입")가 중첩 모터를 흔하게 만들면서 표면화.
- **✅ 확인 완료(2026-07-21, 사용자 "잘된다")**: ①클로너+관절 → ▶플레이서 복제본 통째 회전·콜라이더 ON→막힘 ②기어 프리셋(그룹 안 모터 2개) 회전 ③로봇팔(중첩 모터 체인) 스윕 ④관절 없는 평범한 그룹은 여전히 벽(TC-4 회귀 없음). **라우팅 순수 함수 추출 후 상태로 검증된 것이라, 리팩터도 함께 확인된 셈.**
#### ✅ 플레이 라우팅 순수 함수 추출 (2026-07-21) — 신규 `lib/playRouting.ts` + 테스트 25/25
> 오늘 이 파일에서만 라우팅 버그가 **4건**(유령 콜라이더·이중 렌더·중첩 모터 누락·그룹 관절 얼어붙음) 났다. 원인은 공통 — "어느 버킷에 들어가는가"가 컴포넌트 안에 **흩어진 filter 체인**으로 표현돼 **조건 하나만 놓쳐도 에러 없이 조용히 틀린다**. 사용자 동의 하에 순수 함수로 추출. tsc 클린 + 라우팅 25/25 + 스토어 61/61 + dev 컴파일.
- **신규 `src/lib/playRouting.ts`**: `PlayBucket`(14종) + **`classifyPlayObjects(objects, {passableIds, movedIds}) → Map<id, PlayBucket>`** + 거동 판정 함수 전부(`isMovingColliderObj`·`isVisualOnlyMotionObj`·`hasActuator`·`isActuatorVisualObj`·`isActuatorColliderObj`·`isGroupMovingCollider`). **판정을 바꿀 땐 PlayCanvas가 아니라 이 파일을 고칠 것.**
- **PlayCanvas 배선**: 12개 filter 체인 → `inBucket('...')` 12줄로 교체(`useMemo`로 분류 1회). GroupWithCollision도 같은 판정 함수를 import → **단일 소스**.
- **`src/lib/playRouting.test.ts` 25/25**: **불변식 A 상호배타 + B 전수커버**(isGroup×isActuator×actuator×motion×physics×visible **144조합** 전수) + **오늘 버그 4건을 회귀 케이스로 고정** + 숨김(보이지 않는 벽 방지)·통과(set_passable)·움직이는 그룹 아래 자식(강체에 실림) 케이스.
- **남은 후속**: **자식(그룹 내부) 렌더 결정**은 아직 `GroupWithCollision` 안에 있다(분류는 `'child'`까지만). 자식 버킷(`child-static`/`child-visual`/`child-carried` 등)까지 분류에 넣으면 그룹 내부 라우팅도 테스트로 덮인다.
  - **✅ 확인 완료(2026-07-21)**: **TC-4**(그룹 안 *관절 없는* 박스가 여전히 벽 — 회귀 없음, 최우선 항목) · **TC-1**(콜라이더 OFF → 움직이는 박스도 **원래 자리도** 통과 = 유령 콜라이더 해소) · **TC-2**(ON → 움직이는 박스에 실제로 막힘). 미확인(저위험): TC-3(그룹 밖 루트 — 코드상 동일 경로) · TC-5(기어 프리셋).
  - 테스트 팁: **slide·Drive=oscillate**로 두면 박스가 원래 자리를 완전히 비워 유령 콜라이더가 바로 드러남. (관절은 **에디터에선 정적**, ▶ 플레이에서만 구동. Drive 기본값 `manual`은 저절로 안 움직임.)
- **C — 부품에서 시작하는 흐름 (모터 삽입 + 승격) — 브라우저 확인 대기**: 원래 계획은 "부품 하나면 속성형 → 둘째 부품 연결 시 **자동 승격**"이었으나, **A를 만든 뒤 판단을 수정**했다(사용자 동의). 자동 승격은 "나중에 갑자기 구조가 바뀌는" 동작이라 예측이 어렵고 표현이 두 개가 된다 → **속성형 기본 + 승격은 명시적 버튼**.
  - **핵심 연산 `insertMotorForObject(objId)`**: 모터를 **부품의 부모로 삽입**하고 **부품의 자리(같은 parentId)를 승계**. 모터 원점(=경첩)은 부품의 hinge 월드 위치(속성형 설정이 있으면 그 점, 없으면 왼쪽 면 중앙), 회전은 **부품 방향을 물려받아** 축 의미가 유지되고, 스케일은 항상 1(물려받으면 자식 로컬이 나눠져 값이 헷갈림). 속성형 설정이 있으면 모터로 **이관**하고 `obj.actuator`를 지운다(이중 적용 방지, hinge는 모터 원점이 대신하므로 제외). 월드 변환 보존·단일 undo.
  - **→ 몸통과의 관계가 유지되므로 "재부착 왕복"이 원천 소멸**(모터를 씬에 놓고 부품을 끌어오는 기존 흐름은 부품이 원래 부모에서 떨어져 나온다).
  - **UI(`ActuatorSection`)**: ①**꺼짐 상태 안내 추가** — 예전엔 스위치만 있어 속성형이 안 보이고 모터형만 눈에 띄었다. 이제 "스위치=이 부품 자체가 움직임(경첩은 모서리로 고름·계층 안 바뀜)" + **`⚙ 모터로 달기 (여러 부품 묶기)`** 버튼을 나란히 노출. ②속성형 ON 상태 하단에 **`⚙ 모터로 바꾸기`**(승격) + "되돌리려면 모터에서 모터만 제거" 안내.
  - **테스트 43/43**(`npx tsx src/store/motorPivot.test.ts`) — 삽입 시 부품 월드 변환 완전 보존·부모 자리 승계 · 승격 시 설정 이관/hinge 제거/이중 적용 방지 · **삽입→모터만 제거 왕복이 원상복구**(C와 B 정합) · 모터에 재삽입 no-op.
  - **선택 기준(사용자 안내용)**: 속성형 = 물체 하나가 통째로(문·서랍·시소), 경첩을 **모서리 이름으로 정확히** 지정, 계층 불변. 모터형 = 여러 부품을 한 축으로(회전문·기어·로봇팔), 경첩이 부품 **바깥**에도 가능. **속성형의 경첩은 자기 bbox 안(0~1)에 갇힘** — 이게 모터로 올려야 하는 유일한 구조적 이유.
  - **확인 필요(브라우저)**: 부품 선택 → Actuator 꺼짐 상태에 안내·모터 버튼 보임 · 스위치 ON→경첩 모서리 피커로 문 동작(▶ 플레이) · `모터로 바꾸기` → **부품 안 움직이고** 트리에 모터가 부모로 삽입·설정 유지 · 모터에서 `모터만 제거`로 원상복구 · 그룹 자식(새 몸통>날개)에서도 동일.

#### 🎨 UI 다듬기 (2026-07-21) — 섹션 헤더 아이콘 + lucide 전역 stroke + 트리 텍스트 — ✅ 확인 완료
> 사용자 요청 연속 처리. tsc 클린 + dev 컴파일. **✅ 확인 완료(사용자 "지금 좋아").**
- **섹션 헤더 아이콘 전면 도입(`inspector/ui.tsx` `SectionHeader`)**: 아이콘을 **연한 회색 박스**(`w-6 h-6 rounded-xs bg-foreground/[0.04] text-foreground`) 안에 넣고 헤더 높이 `py-3`→`py-3.5`. **아이콘이 없던 25곳에 전부 추가** — Transform=Move3d·Material=Palette·Geometry=Shapes·Subdivision=Spline·Visibility=Eye·Physics=Atom·Motion=Wind·Actuator/모터=Cog·Animation(키프레임)=Film·Animation(GLB)=Clapperboard·Events=Zap·Content=FileText·Light=Lightbulb·Particle=Sparkles·Array=Grid3x3 / Env: StartView=Camera·Frame=Frame·Sky=Cloud·Ground=Mountain·Fog=CloudFog·Mood=SunMoon·Lights=Sun·Interaction=MousePointerClick·Popup=MessageSquare·Player=PersonStanding·Boundary=Square·Post=Wand2·Memo=StickyNote·게임변수=Variable·HUD=Gauge·GameLogic=Cpu. MultiSelectPanel의 Boolean만 문자 `◑`를 쓰고 있어 `Blend`로 통일.
- **lucide 전역 stroke 1 (`app/layout.tsx`)**: `<LucideProvider strokeWidth={1}>`로 앱 전체 기본값. **패키지 재설치 불필요** — `lucide-react@1.22.0`에 Provider가 이미 있고(`dist/esm/context.mjs`, `'use client'` 포함이라 서버 컴포넌트 layout에서 바로 감쌀 수 있음), 우선순위는 **개별 prop > Provider > 기본값 2**.
  - **`className`은 일부러 안 넘긴다**: Provider의 className은 `mergeClasses("lucide", contextClass, className)`로 **아이콘 SVG에 직접** 붙어서, 부모의 `text-muted` 등을 상속받던 곳(트리 아이콘의 선택/미선택 구분 등)을 전부 덮어쓴다. 색은 각 위치에서 관리.
  - 아이콘 크기는 `icon={...}` prop 전부 **14**로 통일(44곳 — 인스펙터·Env·MultiSelect·InspectorPanel·EditorGnb 레일). lucide는 크기를 줄이면 stroke도 비례해 얇아지므로, 더 또렷하게 하려면 Provider에 `absoluteStrokeWidth` 추가(크기 무관 1px 고정).
- **계층 트리(`HierarchyPanel`)**: 이름 `text-[12px] text-foreground/70` → **`text-[11px] text-foreground`**(선택 여부와 무관하게 또렷) · **아이콘은 선택 시에만 `text-foreground`**(미선택 `text-muted/60` 유지, 프리팹은 `var(--prefab)` 그대로) · **이름 편집 중엔 우측 액션 아이콘(표시/잠금) 미렌더**(`hidden` 대신 조건부 렌더 — DOM에 남으면 입력 포커스가 샌다) · **이름 변경 제약 해제**: 잠금·그룹 여부와 무관하게 항상 가능(더블클릭·우클릭 메뉴 둘 다). 잠금은 뷰포트 조작을 막는 것이지 이름까지 막을 이유가 없다.
- **인스펙터 헤더 개편(`InspectorPanel`)**: 기존 `[이름 입력창][GLB 버튼]` + 아래 전체폭 '모델 에셋으로 저장' 버튼 → **`justify-between` 2단 헤더**로 재구성.
  - 좌: **이름(읽기 전용 `text-[14px]`, truncate+title)** + 그 아래 **타입 뱃지**(`bg-foreground/[0.04]`, `inline-flex`+래퍼 `w-fit`이라 텍스트 폭에만 배경). 이름 수정은 트리(더블클릭·우클릭)로 일원화.
  - 우: **아이콘 버튼 3개**(`w-6 h-6 text-foreground`) = 표시(Eye/EyeOff)·잠금(Lock/Unlock)·더보기(MoreHorizontal), `gap-0`.
  - **더보기 = 팝오버**(공용 `DropdownMenu`, `placement="bottom-end"`(우측 정렬)·`w-max`+`whitespace-nowrap`(텍스트 폭)): `GLB로 내보내기` + `모델 에셋으로 저장`(프리미티브만).
  - **신규 `objectTypeLabel`/`objectTypeHint`**: 뱃지 문구와 호버 툴팁(공용 `Tooltip` `wide`). **판정 순서는 좁은 것부터** — 모터·클로너·프리팹이 전부 그룹이기도 해서 `isGroup`보다 먼저 봐야 하고, **두 함수의 순서가 같아야** 라벨과 설명이 안 어긋난다.
  - **`DropdownMenu.placement` 타입 확장**: `'bottom' | 'right'`로 좁혀져 있어 `bottom-end`를 못 넘기고 있었음 → `useDropdown`의 `DropdownPlacement`를 그대로 노출(7종 전부 사용 가능).
- **`VisibilitySection` → `Render`로 개편**: 표시/잠금 토글이 헤더 아이콘과 중복 → **토글 제거**. 남는 게 프리미티브 렌더 옵션(Flat Shading·Double-sided·Cast/Receive Shadow)뿐이라 **프리미티브가 아니면 섹션 자체를 미렌더**(안 그러면 GLB·그룹·라이트에서 빈 섹션이 뜬다). 제목 `Visibility`→**`Render`**(4개 중 셰이딩은 1개뿐이고 나머지는 렌더 동작이라 'Shading'보다 포괄적·일반 사용자에게 익숙), 아이콘 `Eye`→**`Contrast`**(명암). **파일명·섹션 키는 `visibility` 유지** — 내부 식별자라 바꾸면 사용자 접힘 상태만 리셋된다.

#### 🧭 좌측 패널 재구성 (2026-07-21) — 프로젝트명·탭·Scenes를 한 패널로 — 브라우저 확인 대기
> 사용자 제공 레퍼런스 이미지 기준. **큰 방향: 상단 바(`ViewportToolbar`)와 GNB 세로 레일을 걷어내고 좌측 패널로 모은다.** 이번은 그 1단계 — 옮길 수 있는 것부터 옮기고, 상단 바 최종 형태는 나중에 결정. tsc 클린 + dev 컴파일. **브라우저 확인 대기.**
- **`LeftPanel` 재구성** — 위→아래: **프로젝트명 + ☰** / **Objects·Assets 가로 탭**(`text-[12px]`·`flex-1` 균등폭·활성 `bg-foreground/[0.06]`) / **Scenes** / 트리·에셋. 검색은 원래 `HierarchyPanel` 최상단이라 위치가 이미 맞아 **그대로 뒀다**(이동 불필요).
  - **☰ 메뉴** = 공용 `DropdownMenu`(`bottom-end`·`w-max`). 지금은 **`Back to file`(대시보드) 한 항목**뿐 — 앞으로 늘어날 자리. **이게 유일한 이탈 경로**다(상단 바 ← 제거했으므로).
  - Scenes는 **Objects 탭에서만** 표시(에셋 라이브러리는 프로젝트 단위라 씬과 무관).
- **`SceneSwitcher`(드롭다운) → `ScenesSection`(인라인) 이동**: 상단 바에서 좌측 패널로 **옮긴 것**이라 두 곳에서 그리지 않는다(공유 훅·동기화 불필요). 드롭다운 시절의 키보드 순환(`useListNav`)은 인라인 목록에 안 맞아 제거. 씬 목록 조회 시점도 '열 때'→'마운트 시'로 변경. **구 파일 삭제.**
  - 현재 씬 = **행 하이라이트(`bg-foreground/[0.06]`) + 텍스트 강조**(체크 아이콘은 메인 씬 집 아이콘과 헷갈려 제거). 메인 씬 = **🏠 상시 표식**.
  - **우클릭 메뉴**(공용 `ContextMenu` 3번째 사용처): 메인 씬 지정 / 복사 / 이름 변경 / 삭제. **씬이 하나뿐이면 '지정'(이미 메인)과 '삭제'(마지막 씬)를 숨긴다** — 눌러도 아무 일 없는 죽은 항목을 만들지 않기 위함(오늘 트리의 '그룹 해제'가 정확히 그 상태였다).
  - **신규 기능 2개**: **이름 변경**(인라인 편집, Enter 확정·Esc 취소·빈 이름 무시) · **복사**(`scene_data` 통째 복제 + 내부 `sceneId`만 새 id로. `"{이름} 복사본"`을 원본 바로 아래 삽입하고 **전환하지 않는다** — 작업 중이던 씬 보호).
- **★ 신규 `editor/[projectId]/actions.ts` — `setMainScene`**: `projects.default_scene_id`를 갱신하는 서버 액션. **이 값은 지금까지 프로젝트 생성 시 첫 씬으로 자동 설정될 뿐 에디터에서 바꿀 UI가 아예 없었다**(`dashboard/actions.ts`에서만 사용). 소유자 확인 + 그 씬이 해당 프로젝트 소속인지 검증. 클라이언트는 낙관적 갱신 후 실패 시 롤백. **메인 씬 '해제'는 없다** — 공유 링크가 열 씬이 사라지므로 항상 하나는 메인이어야 한다(다른 씬으로 옮기는 것만 가능).
- **상단 바(`ViewportToolbar`)에서 제거**: `←` 뒤로가기 · 프로젝트명 · `SceneSwitcher`. 미사용이 된 `Link`·`ArrowLeft` import와 `projectName` prop도 정리(`EditorClient` 호출부 동반 수정). 남은 것 = 브랜드·저장 상태·저장·미리보기·▶플레이·버전기록.
- **GNB 레일은 유지** — Objects/Assets 진입점이 레일과 가로 탭 둘로 늘었지만, **레일 자체를 걷어낼 예정**(Logic은 다른 곳으로 이동 예정)이라 과도기로 감수. 가로 탭은 `setGnbTab` 직접 호출(레일의 `handleGnbTabClick`은 같은 탭 재클릭 시 패널을 접는데, 패널 안 탭에선 그 동작이 어색하다).
- **확인 필요(브라우저)**: ①☰ > Back to file → 대시보드 ②탭 전환이 레일과 동기화 ③씬 전환·추가·삭제 ④**⌂ 메인 씬 지정**(신규 — 다른 씬 지정 시 집 아이콘이 옮겨가는지) ⑤씬 우클릭 메뉴(하나뿐일 때 지정·삭제 숨김) ⑥이름 변경·복사.

#### 🏛 씬 템플릿 전면 재작성 (2026-07-21) — 쇼룸·갤러리·광장·카페 — 브라우저 확인 대기
> 사용자: "템플릿이 있으나 마나다. 정말 쇼룸처럼 만들어 달라 — 매핑이 아니라 **구도**로." tsc 클린 + `npx tsx src/lib/sceneTemplates.check.ts` 통과.
- **기존이 부실했던 진짜 이유 = 에디터 기능을 안 썼다**: 회색 박스 몇 개 + `ambientIntensity 1.2`로 **전체를 균일하게** 밝히고 있었고, 결정적으로 오브젝트 `render.castShadow` **기본값이 false**라 **아무것도 그림자를 안 만들었다**(그림자가 없으면 아무리 배치해도 평평하다). 조명 오브젝트·그라데이션 하늘·후처리·startView·cornerRadius를 하나도 안 씀.
- **신규 헬퍼(`sceneTemplates.ts`)**: `mesh()`(그림자·재질·geom·솔리드 지정, **그림자 기본 on**) · `spot()` · `point()`. 기존 `obj()`는 손대지 않았다(다른 템플릿이 쓰는 중).
- **네 템플릿을 서로 다른 조명 전략으로** 갈랐다 — 전부 비슷하면 여러 개일 이유가 없다:
  - **쇼룸**: 실내·태양off·환경광 0.28 → 어두운 페더 월(차콜) 배경 + 제품마다 스포트 '빛 웅덩이'. 히어로를 3분할로 밀고 좌우 플린스 비대칭, 전경(벤치·카운터·화분)으로 깊이 3겹. 코브 조명(자체발광 띠).
  - **갤러리**: 화이트 큐브 + 천창(천장 발광 패널) + 액자마다 **픽처 라이트**(rot X로 벽 쪽 기울임). 가벽 2장을 엇갈려 S자 동선.
  - **광장**: 유일한 야외 — **태양이 주인공**(낮은 고도 = 긴 그림자), 안개(exp)로 공기원근, 스카이라인 높낮이 비대칭, 가로수로 프레이밍.
  - **카페**: 창(발광 패널)+바깥 스포트로 자연광, **눈높이 아래 펜던트**(원뿔 갓 + point light)로 아늑함. 카운터를 한쪽 벽으로 몰고 테이블 대각 배치.
- **`startView` 지정** — 템플릿의 값어치는 "처음 열었을 때 보이는 화면"에서 결정된다. 넷 다 오프닝 컷을 짰다. 걷기 모드도 켬(`disableWalk:false`).
- **⚠️ 성능 — 심하게 버벅였다(사용자 보고). ★결론: 범인은 후처리(EffectComposer)였다. ✅ 확인 완료(사용자 "후처리가 엄청나네").**
  - **★핵심 — `PostProcessingEffects`는 `effects`가 하나도 없고 preset이 `'none'`이면 `EffectComposer`를 아예 만들지 않는다**(20행 early return). 기존 씬들이 가벼웠던 건 오브젝트가 적어서가 아니라 **후처리가 통째로 없었기 때문**. 새 템플릿이 처음으로 그걸 켜면서 전체 화면 패스가 붙었다.
  - **에디터에도 똑같이 붙는다** — `EditorCanvas:1278`도 같은 컴포넌트를 쓴다. 게다가 에디터 캔버스는 `preserveDrawingBuffer: true`(썸네일 캡처용)라 컴포저와 겹치면 더 나빠진다. `Bloom`의 `mipmapBlur`는 다단계 다운/업샘플이라 그중 가장 비싸다.
  - **조치**: 템플릿에서 **`effects`를 전부 제거**(주석으로 이유 명시) + SSAO·contactShadows 제거 + 그림자는 키 라이트 1개만(`spot()` 기본 `castShadow:false`). 분위기는 조명 배치·색온도·emissive가 만들므로 손실이 작고, 후처리는 사용자가 Environment ▸ Post Processing에서 직접 켜면 된다.
  - **★함께 발견한 구조적 낭비 2건(앱 전역 수정)**:
    1. **`dpr` 설정이 두 캔버스 모두 없었다** — R3F 기본값은 `devicePixelRatio` **무제한**이라 배율 200%면 픽셀 4배, 250%면 6배 넘게 그린다. 씬 내용과 무관하게 항상. → **`dpr={[1, 2]}`** 상한.
    2. **▶ 플레이 중 에디터 캔버스가 계속 렌더**되고 있었다(가려져 있는데도 그림자·후처리 계산). 카메라 보존 때문에 언마운트는 안 하므로 → **`frameloop={editorPlaying ? 'never' : 'always'}`** 로 렌더 루프만 정지.
  - **📌 함정 — 템플릿 수정은 "새로 만드는 씬"에만 적용된다**: 템플릿은 씬 생성 시점에 `scene_data`로 구워져 DB에 저장되므로, **이미 만든 씬은 예전(무거운) 설정을 그대로 갖고 있다.** 성능 조치 후에도 계속 버벅인다면 그 씬을 새로 만들거나 Environment 패널에서 직접 꺼야 한다. (이번에도 이것 때문에 "고쳤는데 그대로"인 구간이 있었다.)
  - **남은 후보(미착수)**: `ContactShadows`에 `frames` 제한 추가(정적 씬은 1회면 충분 — 지금은 매 프레임 1024 해상도로 전체 재렌더). 단 모션·관절 오브젝트가 있으면 그림자가 멈춘 채 남으므로 별도 검토.

### 📌 중요 — 후처리 비용 구조 개선안 (2026-07-21 설계, **보류**)
> 사용자: "후처리 없으면 밋밋하지 않냐" → 맞다. **해결책은 있고 설계까지 마쳤으나, 지금은 후처리 없이 써 보고 정 안 되면 착수**하기로 함(사용자 결정). 착수 시 아래 그대로 진행하면 된다.

**문제의 본질**: `PostProcessingEffects`가 6종을 **전부 같은 취급**한다 — 하나만 켜도 `EffectComposer` + 전체 화면 렌더 타깃이 생긴다. 그런데 **그중 넷은 3D 정보가 전혀 필요 없다.**

| 효과 | 3D 정보(깊이/법선/HDR) | 지금 | 있어야 할 곳 |
|---|---|---|---|
| SSAO(N8AO) | 필요 | EffectComposer | EffectComposer (단 반해상도) |
| Bloom | 필요 | 〃 | 〃 (단 저해상도) |
| DoF | 필요 | 〃 | 〃 |
| **Vignette** | **불필요** — 가장자리만 어둡게 | 〃 | **CSS 오버레이** |
| **Brightness/Contrast** | **불필요** — 색 변환 | 〃 | **CSS filter** |
| **Saturation** | **불필요** — 색 변환 | 〃 | **CSS filter** |

**① 싼 넷을 CSS로 내린다(핵심)**: 비네트 = 캔버스 위 `radial-gradient` 오버레이, 밝기·대비·채도 = 캔버스에 `filter: brightness() contrast() saturate()`. 브라우저 합성 단계라 **3D 렌더 비용 0**. → **이 넷만 쓰면 `EffectComposer`가 아예 안 뜬다**(현재의 early-return 조건을 그대로 활용). 템플릿에 **비네트+대비를 공짜로 되살려** 밋밋함 해소 가능.
**② 비싼 둘은 반해상도**: `N8AO`에 **`halfRes`**(설치된 n8ao·R3F 래퍼 모두 지원 확인함), `Bloom`에 `resolutionScale={0.5}`. SSAO는 저주파 음영이라 반해상도가 업계 표준 — 체감 화질 차이 거의 없이 비용이 크게 떨어진다.

**감수할 점**: CSS 필터는 **톤매핑 이후** 적용이라 셰이더 버전과 미세하게 다르다(실사용 차이 미미). **캔버스 스크린샷/썸네일 캡처엔 CSS 효과가 안 담긴다** — 캡처 경로(`preserveDrawingBuffer`로 뽑는 썸네일)가 있으므로 착수 시 반드시 확인할 것.

**착수 조건**: 후처리 없는 지금 상태로 써 보고 "밋밋해서 못 쓰겠다"가 되면. 그때 ①부터(②는 선택).
- **검증 스크립트 `src/lib/sceneTemplates.check.ts`**: 전 템플릿 build→normalize 통과·id 중복 없음·부모 참조 유효 + 오브젝트/조명/그림자캐스터 수를 출력. 템플릿을 고치면 이걸로 확인.

#### 🎮 플레이 카메라 회전이 화면 끝에서 멈추던 문제 (2026-07-21) — ✅ 확인 완료
> 사용자: "오른쪽으로 드래그하다 어느 순간 더 못 돈다."
- **원인**: `azimuth`엔 클램프가 없다. 진짜 이유는 **커서가 화면 가장자리에 닿으면 `clientX`가 더 이상 변하지 않아** `dx=0`이 되는 것. 마우스는 움직여도 좌표가 멈춘다.
- **수정(`PlayModeController`)**: 드래그 시작 시 **Pointer Lock**을 걸고 `movementX/Y`로 델타를 받는다(커서가 화면에 안 갇히므로 무한 회전). 락이 거부되면 기존 `clientX` 방식으로 **자동 폴백**. Esc로 락이 풀리거나 플레이 모드를 벗어날 때 정리(`pointerlockchange` + cleanup).
- **🐛 이 수정이 만든 회귀(즉시 수정)**: `window` mousedown에서 무조건 락을 요청해서 **"■ 편집으로" 버튼 클릭이 삼켜졌다**(락 중엔 커서가 캔버스에 갇힘) → `if (e.target !== canvas) return;`로 **캔버스에서 시작한 드래그만** 회전 처리. 덤으로 예전부터 있던 "UI 버튼 위에서 드래그해도 카메라가 돌던" 허술함도 해소.
- **✅ 확인 완료(2026-07-21, 사용자 "잘된다")** — 무한 회전 · 편집으로 버튼 · 시점 전환 버튼.

#### 🎯 피벗 피커 통일 (2026-07-20) — 애니메이션 피벗 = 오브젝트 앵커와 같은 코너 큐브 — 브라우저 확인 대기
> 사용자 지적: "오브젝트 모서리(앵커) 선택을 애니메이션·모터엔 적용 안 함." 소신대로 진행(사용자 위임). tsc 클린 + dev 편집 라우트 200. **브라우저 확인 대기.**
- **배경**: 피벗 고르는 UI가 3군데 제각각 — 오브젝트 앵커=`PivotPicker`(8코너 큐브) · 애니메이션=면 프리셋 버튼 7개(코너 없음) · 모터 경첩=3×3 평면 그리드.
- **결정**: **애니메이션을 `PivotPicker`(코너 큐브)로 통일**(오브젝트 앵커와 동일 UX). **모터 경첩은 3×3 유지** — 경첩은 축 따르는 선이라 수직면 위 위치만 의미, 3D 코너 큐브는 과함(경첩엔 3×3이 올바른 도구).
- **애니메이션(`AnimationClipSection`)**: 면 프리셋 7개 → `PivotPicker` + "중심으로" 리셋 버튼. **핵심 재베이킹(`setPivot`)은 무변경**(회귀 저위험) — 정규화 코너(0~1) ↔ 애니 피벗 오프셋(`lerp(bbox.min,max,정규화)×scale`) 변환 헬퍼만 추가(`normToAnimPivot`/`animPivotToNorm`). 레거시 면-center 피벗은 코너로 안 떨어지면 하이라이트 안 되지만 데이터·동작은 보존(재선택 시 코너로 갱신).
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — 애니 피벗 코너 큐브 통일 정상.**

### 🧰 UX 배치 작업 (2026-07-20) — 툴바 아이콘·영어화·토러스·선택해제 버그·크로스헤어 — 브라우저 확인 대기
> 사용자 6건 배치. tsc 클린 + dev 편집/대시보드 200. **브라우저 확인 대기.**
- **① 툴바 아이콘 확대(`ViewportFloatingToolbar`)**: 주 아이콘 13/14→16, 메뉴 12→14, 셰브론 11→12.
- **② 영어화**: **오브젝트 기본 이름**(`sceneStore` SHAPE_NAMES·content·PRESET_NAMES·LIGHT_NAMES·모터/복셀/돌출·회전체/클로너/그룹/복사 suffix → Box·Sphere·Motor·Voxel·Extrude·Cloner·Group·copy 등, **앞으로 생성분부터**) + **툴바 라벨/툴팁**(SHAPES·PRESET_ITEMS·MODE_BTNS·스냅·정렬·펜/복셀/프리셋 등). (CommandPalette는 한글 유지 — 요청 범위 밖.)
- **③ 토러스(도넛) 프리미티브**: `PrimitiveShape`에 `torus` + `PrimitiveGeom.tubeRatio`(관 굵기). `createPrimitiveGeometry` TorusGeometry(외경 1·눕힘)·`primitiveGeomKey`·SHAPE_NAMES/DEFAULT_GEOM·툴바 SHAPES(Donut)·CommandPalette·GeometrySection(Tube thickness 슬라이더)·HierarchyPanel 아이콘(Donut)·InspectorPanel geometry 노출. 콜라이더=hull 근사(무변경).
- **④ 선택 해제 버그 수정(`EditorCanvas` handlePointerUp)**: 확대 시 선택 오브젝트 화면 AABB가 커서, 빈 곳 클릭에 미세 드래그(≥6px)가 섞이면 작은 마퀴가 그 AABB에 걸쳐 재선택돼 해제 안 되던 문제 → **마퀴 사각형이 아주 작으면(가로·세로 <8px) 클릭으로 간주해 선택 해제**(selectObject(null)). 진짜 드래그 선택은 무영향.
- **⑤ 크로스헤어(플레이 모드) — 시각만 우선(`ViewerClient`)**: 플레이+데스크톱에서 화면 중앙에 `+` 레티클(흰색+그림자). **미완(다음 단계)**: 중앙 조준을 클릭/호버 포인터로 사용 + 상호작용 대상 위에서 강조 → **뷰어 코어(ViewerObject 브랜치 objectId 태깅 + 중앙 레이캐스트 + handleObjectEvent 마우스 억제 게이트)** 손봐야 해 검증 필요. 시각은 안전(추가만). 결정: 플레이=중앙조준·둘러보기=마우스 유지, 대상 위 강조.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — 아이콘·영어화·토러스·선택해제·크로스헤어 시각 정상.**

#### ⑤ 크로스헤어 상호작용 (2026-07-20) — 중앙 조준 = 클릭/호버 포인터 + 강조 — 브라우저 확인 대기
> ⑤의 상호작용 부분 구현. tsc 클린 + dev 컴파일. **브라우저 확인 대기.**
- **핵심 = R3F `events.compute` 오버라이드(`ViewerCanvas`)**: 플레이+데스크톱(`centerPointer`)이면 hover/click 레이캐스트 원점을 마우스가 아니라 **화면 중앙(0,0)** 으로. → **기존 ViewerObject onClick/onPointerOver 파이프라인이 그대로 "중앙 조준" 기준으로 동작**(오브젝트 태깅·새 레이캐스터 불필요, 검증된 경로 재사용). 탐색 모드는 `base.compute`(R3F 기본) 그대로 → **무변경**.
- **`HoverUpdater`**(신규, Canvas 내부): 매 프레임 `events.update()` 호출 → R3F가 포인터 이동 때만 교차 판정하는 한계 보완, **카메라가 움직여도(걷기/둘러봄) 중앙 hover 갱신**.
- **크로스헤어 강조(`ViewerClient`)**: `handleObjectEvent`의 hover_enter/exit로 `crosshairHot` 토글 → 레티클이 **커지고 노란 링**으로 강조. (hover 이벤트 있는 대상 기준 — 클릭전용 대상은 클릭은 되나 강조는 미표시, MVP 한계.)
- **배선**: `ViewerCanvas` props에 `centerPointer` + `eventsFactory`(memoized) · `ViewerClient`가 `centerPointer={playMode && !isTouch}` 전달 · 모드 이탈 시 crosshairHot 리셋.
- **드래그-룩 무영향**: PlayModeController는 자체 window 리스너라 compute와 무관. 클릭=비드래그 시 중앙 오브젝트 클릭.
- **마우스 커서 숨김(2026-07-20, 사용자 지적)**: 플레이+데스크톱(centerPointer)이면 Canvas `cursor: none`(크로스헤어가 포인터 역할). 단 **팝업/포커스(movementLocked) 중엔 커서 복귀 + 크로스헤어 숨김**(DOM 팝업 클릭용). 캔버스 명시 cursor가 body cursor보다 우선이라 ViewerObject hover cursor 무영향.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — 중앙 조준 클릭/호버/강조·커서 숨김 동작.** 단 사용자 "이 부분 좀 손봐야 함 — 테스트 거쳐 나중에 추가 요청 예정"(디테일 다듬기 여지 남김).

### 🌅 배경/바닥 룩 개선 (2026-07-20) — 수평선 하드컷·radial 흰빛 완화 (A+B) — 브라우저 확인 대기
> 사용자: 수평선 잘림·fog 흰 그라데이션·fog 끄면 중앙 radial 흰빛. **설명 결과 = 평면 바닥+환경조명의 정상 3D 동작**(버그 아님). 사용자 선택 A+B로 개선. tsc 클린 + dev 컴파일. **브라우저 확인 대기.**
- **A — fog 색 = 하늘색 자동 일치(`ViewerCanvas`·`EditorCanvas`)**: 단색 배경(`!useHdr && !isSkyMode`)이면 fog 색을 `environment.fog.color` 대신 **skyColor**로 렌더 → 먼 바닥이 하늘로 매끄럽게 사라짐(수평선 하드컷·fog 색 불일치 완화). Sky/HDR 모드는 기존 fog.color 유지(그라데이션 하늘/이미지가 이미 블렌드). 에디터 Fog 패널 Color 필드는 단색 배경일 때 "하늘색 자동" 안내로 대체(Sky 색으로 조절).
- **B — 바닥 환경반사 억제(`GroundPlane`)**: 평평한 matte 바닥이 DefaultEnvironment(스튜디오 IBL)를 반사해 생기는 넓은 radial 하이라이트("스포트라이트 흰빛") → 바닥 재질 `envMapIntensity={0.3}`(신규 `GROUND_ENV`)로 낮춤. **오브젝트는 무영향**(각 재질 기본 1). 물(MeshReflectorMaterial)은 제외.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "지금까진 좋아") — 수평선·radial 흰빛 개선 만족.**

### 🌇 배경 룩 대수술 (2026-07-20) — HDRI 배경 폐기 → HDR=조명 전용 + 그라데이션 하늘 — 브라우저 확인 대기
> 사용자 스크린샷 + 지적: **"각 배경 사진이 이상하고 어울리지도 않고, 수평선이 딱 잘리고, 가장 큰 문제는 너무 올드하고 사진을 따다 붙인 느낌"**. 진단 결과 **정확한 지적**이었고 원인은 한 줄. tsc 클린 + dev 편집 라우트 200.
- **원인**: 에디터·뷰어 모두 `<Environment preset={hdrPreset} background />` — **`background` 프롭이 HDRI 파노라마 사진을 배경에 직접 칠하고 있었다**(스크린샷의 건물·나무 = Poly Haven HDRI). 파생 증상 전부가 여기서 나옴: ①실사 사진이라 "붙인 느낌" ②HDRI 배경은 2015년대 three.js 룩(요즘 Spline·Womp 등은 HDRI를 **절대 배경으로 보여주지 않음**) ③사진에 구워진 자체 지평선이 우리 바닥판(y=0)과 안 맞아 **흰 띠/하드컷** ④실사 배경 + 납작한 스타일라이즈드 바닥 = 톤 충돌.
- **① HDR = 조명/반사(IBL) 전용으로 격하**: 두 캔버스에서 `background` 프롭 제거. 배경은 이제 **항상 `sky.type`이 담당**(예전엔 HDR이 배경을 독점하고 sky를 무시했음). HDRI의 장점(부드러운 주변광·금속 반사)은 그대로 유지.
- **② 신규 `components/three/GradientSky.tsx`**: 천정→수평선 2단 그라데이션 배경 구. **셰이더 대신 1D CanvasTexture 램프**(PrimitiveMaterial 그라데이션과 동일 패턴) — ShaderMaterial 직접 작성 시 `colorspace_fragment` 수동 처리로 색이 틀어지기 쉬운데 텍스처는 three가 SRGB 변환을 알아서 함. `side=BackSide`·`fog={false}`(하늘은 fog가 수렴하는 목적지)·`toneMapped={false}`(단색 배경과 톤 일치)·**카메라 추종**(구 밖으로 못 나감)·raycast 제외.
- **③ 스키마**: `sky.type`에 **`'gradient'`** 추가 + `value2`(수평선 색, 미설정=value). 레거시 `'hdr'` 타입은 배경 소스가 사라졌으므로 **단색 폴백**.
- **④ fog 색 자동 일치**: `isGradient ? 수평선색 : isSolid ? 하늘색 : fog.color` → **바닥이 하늘로 자연스럽게 사라져 지평선 하드컷 제거**(7-16/7-20의 fog 개선을 그라데이션까지 확장).
- **⑤ 패널(Sky 섹션) 재구성**: 배경 모드 = **Gradient / Solid color / Sky**(HDR 제거 — 더 이상 배경이 아니므로). 그라데이션 선택 시 **천정 색·수평선 색 픽커 2개**. 그 아래 **"HDR 조명"** SelectBox를 별도 행으로 분리(기본=스튜디오, +기존 프리셋 10종) + ⓘ "배경으로 보이지 않고 반사/주변광만".
- **Mood와의 관계**: 사용자가 앞서 "Mood가 안 이쁘다"고 한 것의 실체가 **Mood가 HDRI 사진을 갈아끼우던 것**이었음. 배경에서 사진이 빠지면 Mood는 "조명 분위기(빛 색·강도·노출)"라는 제 역할만 하게 됨 → **Mood 값 재조정은 이 변경 확인 후 판단**.
- **⚠️ 기존 씬 영향**: HDR을 쓰던 씬은 배경이 **사진 → 하늘색/그라데이션**으로 바뀐다(의도된 변경). 게시된 프로젝트도 동일.
- **기본값은 아직 'color' 유지** — 사용자가 Gradient를 먼저 보고 판단한 뒤 기본값 전환 결정.
- **확인 필요(브라우저)**: Environment▸Sky → **Gradient 선택 → 천정/수평선 색 조절** · 사진 배경이 사라졌는지 · HDR 조명을 켜도 배경이 안 덮이는지(반사만) · **Fog 켜고 수평선이 부드럽게 사라지는지** · 게시 뷰어도 동일한지.

### 🧭 배치 편의 (2026-07-20) — ① 바닥 드롭라인/발자국 + ② 시점 버튼 — 브라우저 확인 대기
> 사용자: 에디터서 오브젝트 3D 위치 파악 어려움. 확정 ①+②. tsc 클린 + dev 컴파일. **브라우저 확인 대기.**
- **① 신규 `SelectionGroundGuide.tsx`**(EditorCanvas, SelectionOutline 패턴): 단일 선택 오브젝트의 **월드 AABB**에서 → 밑면 중앙→바닥 **수직 점선**(떠 있을 때만) + 바닥 **발자국 윤곽(점선)+반투명 채움**(#0D99FF) + **높이 라벨**(`baseY.toFixed(2)m`, drei Html, 떠 있을 때만). 라이트/파티클 제외·단일 선택·드래그 중 라이브(매 프레임). depthTest off·raycast 무관(가이드).
- **② 시점 버튼(`ViewportFloatingToolbar`)**: 그리드 버튼 옆에 **T/F/S 버튼**(Top/Front/Side) → 기존 `requestCameraView('top'|'front'|'right')`(키보드 Numpad 7/1/3만 있던 것) 클릭 노출. 그리드 툴팁 영어화 겸사.
- **⚠️ 시점 프리셋 원근감 → near-ortho로 해결(2026-07-20)**: 원인 = **원근 투영**(world/local 아님). 진짜 직교 카메라 스왑은 에디터 카메라 핵심(OrbitControls·기즈모 크기·마퀴·camera 참조)에 파급 커서 위험 → 사용자 승인 하에 **near-ortho(준-직교)** 채택.
  - **프리셋 핸들러(`EditorCanvas`)**: T/F/S 시 카메라 **화각 fov=14로 좁히고(망원) 거리 `spread*0.7/tan(7°)`로 멀리** 배치 → 원근 왜곡 거의 사라져 **평행 도면 룩**. 원근 카메라 그대로라 OrbitControls·기즈모·마퀴 전부 정상.
  - **focus-all("3D" 복귀)**: fov를 60으로 복원(near-ortho→원근). 툴바에 **"3D" 버튼**(requestFocusAll) 추가 — T/F/S 옆.
  - **화각 보정 핸들 크기(`ManipulationHandles`·`ActuatorGizmo`)**: 거리기반 크기에 `fovK=tan(fov/2)/tan(30°)`(fov 60=1, **무변**) 곱해, 좁은 화각+먼 거리서 핸들 거대해짐 방지. (GizmoController=drei TransformControls는 자체 스크린스페이스라 무변.)
  - ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다").**
  - **near-ortho 부작용 픽스(2026-07-20)**: 카메라가 멀어 ①fog가 씬 통째로 덮음 ②격자 fade 밖으로 사라짐 → `flatView` state로 **평행뷰에선 fog off + 격자 fadeDistance 2000**. `3D`/Shift+F 복귀 시 원래대로.

### 🙈 숨긴 오브젝트 뷰포트 클릭 선택 차단 (2026-07-20) — ✅ 확인 완료
> 사용자 보고: visibility off 오브젝트가 눈엔 안 보이는데 뷰포트 클릭으로 선택됨(패널 바뀜). **원인 = three Raycaster는 invisible 메쉬를 안 건너뜀**(`.visible===false` 체크가 렌더러에만 있음). tsc·컴파일 클린. **✅ 확인 완료(2026-07-20, 사용자 "잘된다").**
- **수정(`EditorObjectInstance`)**: 중앙 클릭 함수 `selectByClick`·`selectExact`에 `if (!object.visible) return` 가드. → 숨긴 오브젝트 뷰포트 클릭 선택 불가. **트리(HierarchyPanel)는 `selectObject` 직접 호출이라 무영향** — 숨긴 것도 트리서 선택해 편집/재표시 가능.
- (한계) 숨긴 메쉬는 여전히 `stopPropagation`으로 클릭을 소비 → 바로 뒤 오브젝트로 클릭 통과는 안 됨(선택만 차단). 필요 시 raycast 게이트로 후속.
- **확인 필요(브라우저)**: ①오브젝트 선택 시 바닥 점선·발자국·높이 라벨(떠 있을 때)·바닥에 붙으면 점선/라벨 사라짐·드래그 중 추종 · ②T/F/S 버튼 시점 전환.

#### 🐛 버그픽스 (2026-07-20) — 빈 모터/그룹 선택 시 원점에 파란 박스 — 브라우저 확인 대기
> 사용자 보고: "모터 배치하면 푸른색 박스가 화면 중간에 생긴다." 원인 규명 후 수정. tsc 클린.
- **원인**: `ManipulationHandles`(코너/면 스케일 핸들 = `boxGeometry[1,1,1]`·파란 `#0d99ff`·depthTest off·renderOrder 1000)의 렌더 조건 `valid = obj && !locked && visible`이 **bbox 없는 오브젝트를 안 걸러냄**. 빈 모터(자식 없음→`localBBox=null`)는 valid=true라 핸들이 렌더되나, 위치 계산 `layoutHandles`가 null bbox에 조기 return → 핸들 14개가 위치 못 잡고 **월드 원점·크기1 기본값**에 겹쳐 1×1×1 파란 박스로 보임(화면 중앙). 기존 잠복 버그(모터=배치 직후 선택되는 빈 그룹이라 표면화).
- **수정**: `valid`에 **실제 bbox 존재 조건** 추가 + 라이트/파티클/모터 제외 → `hbb = obj && !light && !particle && !isActuator ? localBBox : null; valid = ... && hbb && !hbb.isEmpty()`. 프리미티브/자식 있는 그룹은 정상(non-empty bbox), 빈 모터·빈 그룹·라이트·파티클·모터는 핸들 미표시.
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "잘된다") — 모터 배치 시 파란 박스 안 뜸.**
- **M3 남은 후보**: 뷰포트 3D 연결/축 드래그 기즈모 · 라벨·색·dot 다듬기 · 쌍여닫이문 등 추가 프리셋.

### 🔜 다음 세션 시작점 (2026-07-20, 다른 PC) — 모터 액추에이터 이어보기
> 오늘(07-19) 모터형 액추에이터 M1+M2 구현 완료. **✅ 2026-07-20 브라우저 검증 완료(위 블록).** M3-A(프리셋) 구현 완료·확인 대기. 다음은 **모터 다듬기(M3) 나머지**.
- ~~**① 남은 브라우저 검증**~~ **✅ 완료(2026-07-20, TC-1~5).**
- **이번 세션 추가**: 기즈모 피벗(모터=dot) · 모터 프리셋 4종 + 그룹내 다중모터 라우팅 픽스(위 M3-A 블록).
- **② 모터 다듬기 후보(M3)** — 골라서:
  - 뷰포트에서 **3D로 연결**(오브젝트 클릭→모터 클릭, 트리 드래그 대안) · 모터 **축 방향 드래그 기즈모**(로컬축 회전 대신 자유 방향)
  - **모터 프리셋**: 문(모터+판자)·엘리베이터(slide 모터)·기어 한 쌍·회전문 — 스탬프로 바로
  - 한 모터에 **여러 부품**(양문·톱니 여러 개) UX 확인(런타임은 이미 됨)
  - 모터 라벨/문구·가이드 색·dot 크기 다듬기
- **핵심 파일**: 모델=`types/scene.ts`(`isActuator`) · 생성/연결=`sceneStore`(`addActuatorObject`·`reparentObject`·`addNodePreset`) · 에디터=`EditorObjectInstance`(`MotorObjectInstance` dot)·`ActuatorGizmo`(경첩=원점 분기)·`ActuatorSection`(모터 모드)·`MotorLinkSection`(연결 UI) · 플레이=`PlayCanvas`(`actuatorGroupColliders`·`groupObjects`서 모터 제외) · 뷰어=`ViewerObject`(actHinge null) · 프리셋=`objectPresets.ts`(로봇팔 모터체인).
- **기준 문서**: `doc/PIVOT_MANIPULATION.md §6`. 위 "Phase 7 M1/M2" 블록에 상세.

### 프리셋 배치 모드 (2026-07-19) — ✅ 확인 완료
> 툴바 ✨ 프리셋(바퀴·문·동전·로봇팔)도 프리미티브처럼 **클릭 위치에 배치**(사용자 요청). `PendingPlacement`에 `preset`/`nodePreset` 종류 추가 + `commitPlacement`가 `addPreset`/`addNodePreset(presetId, at)` 호출. 툴바는 직접 생성 대신 `beginPlacement` 사용(고스트·ESC 취소·배너 기존 시스템 재사용). 로봇팔은 루트만 placeAt로 옮기고 자식 관절은 로컬이라 자동 추종. tsc·컴파일 클린. **✅ 확인 완료(사용자, "잘된다").**

### (이전) 🧭 다음 작업 결정 대기 (2026-07-18)
- **(D) Phase 5 마무리 → 다른 영역 전환**:
  - **Phase 4** — 애니 피벗(AnimTrack.pivot) 통합(정규화 변환). 기준 `doc/PIVOT_MANIPULATION.md §3.1 결정①(A 단계적)`.
    - **⏸ 보류 확정(2026-07-20) — 착수 조건이 충족될 때만 진행.** 판단: **이득은 가설, 손실은 구체적**이라 지금은 안 하는 게 맞다.
      - 원래 명분이던 "피벗 피커 UI가 제각각"은 **이미 해소**(2026-07-20 `PivotPicker` 코너 큐브로 통일 + `normToAnimPivot`/`animPivotToNorm` 변환 헬퍼). 사용자 체감 불편은 남아있지 않음.
      - 남은 실익 = **"오브젝트 크기를 바꿔도 애니 경첩이 유지된다"** 하나(절대 오프셋 → 정규화). 아직 보고된 적 없는 시나리오.
      - 리스크 = ①기존 저장된 **모든** 애니 클립을 건드림 ②실패해도 **에러 없이 경첩만 조용히 이동**(재생해봐야 앎) ③`pivotBaked`와 얽혀 **이중 적용** 위험 ④**★변환에 필요한 `localBBox`가 뷰어/플레이에선 단위 큐브로 폴백**(프리미티브 bbox 캐시는 에디터에서만 채워짐) → **"에디터는 맞는데 게시하면 틀린" 버그**가 될 수 있음.
      - 미루는 비용은 누적되지 않음 — 변환 헬퍼가 두 표현의 경계를 격리 중.
    - **▶ 착수 조건(트리거)**: **"애니를 건 오브젝트의 크기(scale/Size)를 바꿨더니 경첩이 어긋난다"를 실제로 만났을 때.** 그때는 재현 케이스가 있어 검증이 확실해진다. (그 전까진 열지 말 것.)
    - **착수 시 안전한 방식**: 로드 시 일괄 변환 대신 **에디터에서 피벗을 다시 만질 때만 정규화로 승격(lazy migration)** → 기존 클립 무변경. 단 두 표현이 더 오래 공존.
  - **우클릭 컨텍스트 메뉴(Layer 3)** — `doc/PIVOT_MANIPULATION.md §5`(축 지정·정렬·복제·프리팹 통합). 대부분 기존 기능 재노출.
  - **카메라** — `doc/CAMERA.md`(카메라 오브젝트·설정·플라이스루).
  - **Improvements.md** — UX/UI 개선 백로그.
- **미확인 잔여(저위험)**: 액추에이터 **variable 구동** 브라우저 확인(변수 0↔1 → 관절 따라감). 이벤트 구동과 동일 경로.

## 🧭 진행 중 (2026-07-17) — 피벗/조작 근간 Phase 1: 오브젝트 앵커 + 스케일 앵커 (기준: `doc/PIVOT_MANIPULATION.md`) — 브라우저 확인 대기

> 사용자 확정 방향(프로젝트 근간): 오브젝트마다 **변형 기준점(앵커)** → 스케일/회전이 그 점 기준. **하단 앵커=바닥 고정+위로만 성장**(중심 스케일로 밑면이 바닥 뚫던 문제 해결). 애니 경첩·액추에이터·카메라의 공통 근간. 결정(사용자 승인): 애니통합=단계적(Phase4)·조작평면=카메라향한면·핸들=기즈모 공존. tsc 클린 + `✓ Compiled` + **수학 테스트 11/11**. **브라우저 확인 대기.**

- **스키마**: `ObjectNodeSchema.pivot?: Vector3`(정규화 0..1, 0=min면·0.5=중심·1=max면. 미설정=중심=현재동작, 하위호환). 실제 로컬점 = `lerp(localBBox.min,max,pivot)`.
- **수학**(`src/lib/pivotMath.ts`): `anchorLocalPoint`·`scaleAnchorDelta`(스케일 s0→s1 시 앵커 고정 position 보정 = R·(A⊙(s0−s1)))·`rotateAnchorDelta`(Phase3용, animPivot 일반화)·`isCenterAnchor`. **결정론 테스트 11/11**(하단/상단/좌하단엣지/회전+앵커/중심판정).
- **필드 스케일 앵커**(`TransformSection.setScl`): 앵커 설정 시 Size/Scale 변경이 position 동반 보정 → 앵커 고정. 미설정=중심(현재).
- **기즈모 스케일 앵커**(`GizmoController` SingleGizmo): 프록시 `cLocal`을 스케일모드+앵커면 **앵커 점**으로 → 기즈모가 이미 cLocal 기준 스케일하는 구조라 자동 앵커 스케일(위젯도 앵커에 뜸). 기본(중심)·회전(애니경첩)은 무변경.
- **피벗 피커**(신규 공용 `panels/inspector/PivotPicker.tsx`): 축별 3단(좌/중/우·하/중/상·앞/중/뒤)=27점 + '중심으로' 리셋. Transform 섹션(라이트 제외)에 노출. **애니/액추에이터 재사용 예정**.
- **확인 필요(브라우저)**: 박스 선택→기준점 '하'→Size 높이 키우면 **바닥 붙은 채 위로만** 성장(필드·기즈모 둘 다) · 좌하단 엣지 등 조합 · 중심(기본)은 기존과 동일 · 그룹/GLB.
- **한계/다음**: 이번은 **스케일**만 앵커(회전 기즈모는 기존 중심/애니경첩). 상단 앵커 성장 시 루트 y 언더그라운드 미클램프(앵커 우선, 의도).

### 내비게이션 통일 (2026-07-17) — 회전 = Ctrl+우드래그 (사용자 확인 완료)
> `EditorCanvas`. **회전을 Ctrl+우드래그로 일원화**(예전엔 오브젝트 위 좌드래그·Ctrl+좌가 회전으로 새던 것 정리). tsc 클린 + `✓ Compiled`.
- **좌드래그**: 회전 제거 → 빈 곳=마퀴·오브젝트=선택만(둘 다 orbit 끔, pointerUp resetDrag가 복구). `handlePointerDown`에서 ctrl 분기 제거.
- **회전**: OrbitControls `mouseButtons.RIGHT=PAN` 고정. **★핵심 발견**: three OrbitControls는 PAN 드래그 중 **Ctrl/Shift/Meta 누르면 자동으로 회전으로 스왑**(내장). → 우드래그=패닝, **Ctrl+우드래그=회전**. (초기에 ctrl→ROTATE로 억지 설정하니 스왑과 겹쳐 반대로 나오던 것·키 down/up 추적은 stuck 문제 → PAN 고정으로 해결.) `LEFT:undefined`로 좌버튼 orbit 제외.
- **한계**: 내장 스왑이 Ctrl/Shift/Meta 구분 안 해 **Shift+우드래그도 회전**됨(무해, 사용자 "패스"). Ctrl-only 원하면 pointerdown modifier로 base 스왑 보정 필요(미적용).

### Phase 2 (2026-07-17) — 조작 핸들(코너 드래그 스케일) — 사용자 확인 완료
> 신규 `canvas/ManipulationHandles.tsx`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("정상적으로 되는거 같아").**
- **코너 핸들 8개**(선택 오브젝트 로컬 bbox 코너, 화면상 일정 크기·매 프레임 위치 갱신, 드래그 중 커지는 박스 따라감). **앵커(고정점) = 패널 pivot(설정 시) · 미설정이면 잡은 코너의 반대 코너**(C 하이브리드) → 필드·기즈모·핸들 앵커 일관.
- **스케일 팩터 = "잡은 코너↔앵커" 화면 대각선 축에 마우스 투영**(방사형 거리 아님 — 옆으로 비껴 끌어도 축 방향만 반영, 일관). 앵커 고정은 Phase 1 `scaleAnchorDelta` 재사용.
- **시각 피드백**: 잡은 핸들=흰색·앵커 코너=주황·앵커점 주황 마커(구). "무엇이 고정되는지" 눈으로 보임.
- **실시간**: `liveTransformStore.setLive` → Inspector 즉시. **놓을 때** `commitTransforms`(undo 1회).
- **버그 수정 3건**: ①**occlusion** — 뒤쪽 코너가 오브젝트에 가려 반응 안 하던 것 → 핸들 메쉬 `raycast`가 거리 1e-6로 항상 최우선(8코너 다 잡힘). ②**orbit 회전으로 샘** — R3F stopPropagation은 네이티브 orbit 못 막음 → 핸들 **hover 시 orbit 미리 비활성**(+선택해제/드래그종료 복구). ③스케일 팩터 방사형→대각선 투영.
- **기즈모 공존**: 스케일 모드 TransformControls(스케일 박스) **숨김**(핸들 담당, `GizmoController.showGizmo`), 이동=화살표·회전=링 유지. 핸들 항상 표시.
- **다음**: Phase 3(뷰포트 피벗 핸들[패널 은퇴]·엣지 핸들[1축]·회전 핸들·모디파이어·드래그 HUD) → Phase 4(컨텍스트 메뉴+애니 통합) → Phase 5(액추에이터).

### Phase 3 (2026-07-17) — 진행 중 (기준 `doc/PIVOT_MANIPULATION.md`)
> 문서 Phase 3 = 회전 앵커 통일 + 모디파이어 + HUD, PROGRESS의 엣지/면 핸들·뷰포트 피벗 핸들 더함. **한 항목씩 완성**해서 쌓는 중.

- **①회전 기즈모 앵커 통일 (사용자 확인 완료)**: `GizmoController` SingleGizmo `cLocalRef` 계산 리팩터 — 이제 **오브젝트 앵커(pivot) 설정 시 스케일뿐 아니라 회전도** 그 앵커 점을 축(cLocal)으로. 우선순위 **애니 경첩(animPivot) > 오브젝트 앵커 > 형상 중심**. 앵커 미설정=중심 회전(회귀 없음). tsc 클린. → 박스 하단 앵커 후 R 회전 시 밑면 고정 회전.
- **②면 핸들(1축 스케일) — 브라우저 확인 대기**: `ManipulationHandles`를 **8 코너(3축 균일) + 6 면(1축)** 로 일반화. `HandleDef{norm, ax/ay/az(축 마스크)}` + `HANDLES` 배열. 면 핸들 = 폭/높이/깊이만 스케일(축 마스크로 `ns[k]=def.a? *factor : 유지`). 앵커 = 중심모드=반대쪽(코너 `^7`·면 `^1`)·패널pivot=pivot. 스케일 팩터·`scaleAnchorDelta` 위치 보정은 코너와 동일 경로 공유. 면 핸들 크기 0.8×(부차적). 커서·주황 앵커 표시도 14개로 확장. **코너 동작 무변경**(회귀 없음).
  - **확인 필요(브라우저)**: 면 핸들 6개로 한 축만 늘어남(반대 면 고정)·코너는 기존대로 균일·하단 앵커 조합·커서 방향.
- **③모디파이어 — 브라우저 확인 대기**: `ManipulationHandles` 핸들 드래그에 **Alt=중심 기준**(앵커 무시·bbox 중심 고정·양쪽 대칭 성장, 드래그 시작 시 캡처·주황 앵커 억제) + **Ctrl/Cmd=스냅**(실시간 토글: 면=그 축 치수를 `snapTranslate`(기본 0.5m) 그리드에 · 코너=팩터 0.1 단위 균일). tsc 클린.
  - **확인 필요(브라우저)**: Alt로 양쪽 대칭 스케일 · Ctrl로 면 치수 그리드 스냅·코너 균일 스냅 · 모디파이어 없을 때 기존과 동일.
- **④드래그 HUD — 브라우저 확인 대기**: 핸들 드래그 중 잡은 핸들 옆에 **실시간 치수(W×H×D m)** 표시. drei `Html`로 핸들 위치 추종(`hudGroupRef`를 useFrame로 잡은 핸들 위치에 복사), 텍스트는 **명령형 갱신**(pointermove `textContent`, 리렌더 없음). `draggingState`로만 마운트, `pointerEvents:none`(드래그 방해 없음). 치수=bbox 로컬치수×scale. font-mono 미사용(sans).
  - **확인 필요(브라우저)**: 드래그 중 치수 실시간·핸들 추종·놓으면 사라짐·성능.
- **뒤쪽 핸들 숨김 (2026-07-17, 사용자 요청) — 브라우저 확인 대기**: 예전엔 `depthTest=false`+강제 레이캐스트로 **가려진 뒤 핸들까지 전부 겹쳐 보이고 다 잡혀** 지저분했음 → 사용자가 "앞면만 표시·조작, 뒤는 완전 숨김(카메라 돌려 앞으로 와야 조작)" 요청(A안). **내적 판정**: 핸들 바깥방향(`_out`=핸들−bbox중심) vs 시선(`_view`=핸들−카메라), `dot>0`(카메라 반대=뒤면)이면 `h.visible=false`. `topRaycast`에 `if(this.visible===false) return` 가드(숨긴 핸들 클릭 제외). 앞 핸들은 depthTest=false 또렷 유지. **부수효과**: 중심모드 앵커(=잡은 핸들 반대편)가 대개 뒤라 주황 앵커 표시가 안 보일 수 있음(수용).
  - **확인 필요(브라우저)**: 뒤 핸들 안 보임·앞 핸들만 잡힘·카메라 돌리면 앞으로 온 핸들 나타남·면/코너 모두.
- **⑤ 취소 → 패널 앵커를 토글화 (2026-07-17, 사용자 결정) — 브라우저 확인 대기**: 뷰포트 피벗 핸들+패널 은퇴는 **취소**(사용자: 패널로 앵커를 딱 고정해두는 방식이 유용하니 남긴다). 대신 `TransformSection`의 기준점 피커를 **"기준점 (앵커) 고정" 토글 스위치**로 감쌈 — ON=XYZ 피커 표시·OFF=숨김+앵커 해제(`setPivot(undefined)`). 제목 옆 **`InfoHint`(ⓘ) 툴팁**. 토글은 **pivot과 별도 로컬 state(`lockOpen`)** — 축 모두 '중'→pivot 해제돼도 안 꺼짐, 비중심 앵커면 선택 시 자동 ON(InspectorInner가 selectedId key로 remount라 오브젝트별 초기화). `PivotPicker`에 `hideHeader` prop(내부 중복 라벨/‘중심으로’ 숨김). tsc 클린.
  - **확인 필요(브라우저)**: 토글 ON→XYZ 표시·앵커 동작 · OFF→해제·기존과 동일 · ⓘ 툴팁 · 오브젝트 전환 시 토글 상태 유지(비중심 앵커).
- **버그픽스 3종 (2026-07-17) — 브라우저 확인 대기**: (1) **핸들 실시간 추종** — 위치 갱신을 `layoutHandles()`로 추출해 useFrame + **드래그 move에서도 직접 호출**(윈도우 pointermove로 스케일 바뀌는 순간 즉시 재배치). (2) **뒤핸들 숨김 과함(보이는 코너인데 숨음)** — 대각선 내적 방식 폐기 → **면 법선 기반**: 오브젝트 월드 회전으로 6면 앞/뒷면 판정(중심→카메라 내적), **코너는 인접 3면 중 하나라도 앞면이면 표시**(완전히 가려진 코너만 숨김), 면 핸들은 그 면이 앞면일 때만. → 실루엣 코너 정상 표시. (3) **HUD 반올림** — `fmtDim` 소수 1자리(`toFixed(1)`, 3.12→3.1). tsc 클린.
  - **확인 필요(브라우저)**: 드래그 중 핸들 즉시 추종 · 보이는 코너 핸들 다 보임(가려진 것만 숨음) · HUD 3.1 형식.
  - **(4) 핸들 스케일 중 XYZ 기즈모 실시간 추종** — 핸들 드래그 신호를 **`handleDraggingRef`(신규)** 로 분리(EditorCanvas). 예전엔 핸들이 `gizmoDraggingRef`를 켜서 기즈모 프록시 동기화가 멈춰 기즈모가 안 따라왔음. 이제 핸들 드래그 중 `gizmoDraggingRef`는 false → 기즈모가 오브젝트 실시간 추종. 마퀴 게이트는 두 ref 모두 검사, 기즈모 onChange는 `gizmoDraggingRef`만 봐 피드백 없음. tsc 클린.
- **선택 외곽선 대시화 → 월드 공용 컴포넌트로 재작성 (2026-07-17, 사용자 요청) — 브라우저 확인 대기**: 단일 선택 가이드라인을 **점선(dash)** 으로. **1차**: per-type EdgeBox/EdgePlane에 dashed prop(로컬 지오메트리 기준). **문제**: 오브젝트 비균일 스케일이 대시를 늘려 **간격 불균일**(넓은 축=긴 대시) + 그룹/프리팹/GLB 미적용. **2차(현재)**: 신규 **`canvas/SelectionOutline.tsx`**(월드 공간 공용) — 매 프레임 오브젝트 **월드 코너 8개→12모서리**를 BufferGeometry(24정점)에 직접 채우고 `computeLineDistances()`가 **월드 단위**라 스케일/회전 무관 **대시 간격 항상 일정**. `localBBox`+`matrixWorld`로 **프리미티브·GLB·그룹·프리팹·콘텐츠 전부 공통 커버**(라이트/파티클 제외). EditorCanvas에 `<SelectionOutline/>` 1개 렌더. **중복 방지**: 단일 선택 시 per-type 외곽선(EdgeBox/EdgePlane 조건 `hovered||(isSelected&&!isSingleSel)`, GLB는 `singleSelected` prop로 box3Helper 숨김) → 공용 점선만. **호버·다중선택은 per-type 실선 유지**. dashSize 0.14·gap 0.09(월드). 라이브 추종(핸들/기즈모 드래그 중 매 프레임). tsc 클린.
  - **확인 필요(브라우저)**: 박스/GLB/그룹/프리팹 단일 선택 점선·대시 간격 균일(넓은 축도)·비균일 스케일 균일 · 호버/다중 실선 · 스케일/이동 중 실시간 추종.
- **PivotPicker 큐브형 재설계 + "중" UI 감춤 (2026-07-17, 사용자 요청) — 브라우저 확인 대기**: 배경 = 앵커에 "중"(0.5) 있으면 면/엣지 앵커라 **주황 핸들 표시 안 됨**(pivotCornerIdx는 코너만). 사용자 결정 = 코너 전용으로 단순화하되 **"중"은 제거 말고 UI에서만 감춤**(스키마/pivotMath/center 로직 유지, 나중 재노출). UI 교체: 축별 3단 버튼 → **앞/뒤 사각형 2개 + 각 4꼭지점 버튼(총 8 코너)**(가로=좌/우·세로=하/상·왼=앞 z0·오른=뒤 z1, 선택 파랑). 토글 ON 기본 앵커 = **하단-앞-좌 `{0,0,0}`**(면 앵커 {0.5,0,0.5}에서 변경). → 앵커 항상 코너라 **주황 앵커 핸들 항상 표시**(ManipulationHandles 무수정). tsc 클린.
  - **확인 필요(브라우저)**: 토글 ON→앞/뒤 8버튼·기본 하단앞좌 강조 · 코너 클릭→고정 스케일 · 핸들 주황 항상 · OFF 해제.
- **Phase 3 정리**: ①회전 앵커 통일 · ②면 핸들 · ③모디파이어 · ④HUD · 뒤핸들 숨김 · 앵커 토글화 완료. ※회전 핸들은 "회전=기즈모 공존" 결정에 따라 생략(①로 커버). 남은 후보: 우클릭 컨텍스트 메뉴(Layer 3, doc §5) · Phase 4 애니 피벗 통합 · Phase 5 액추에이터.

#### Phase 2 후속 (2026-07-17) — 핸들 시각 개선 (사용자 확인 완료)
- **크기**: 코너 핸들 배율 0.022→**0.016**(min 0.015)로 축소(너무 크던 것).
- **앵커 = 핸들 색 변경**(사용자 제안): 별도 주황 구 마커(`markerRef`/sphere) **제거** → **앵커 코너의 핸들 자체가 주황**(`#ff7a0d`). 중심모드=hover 시 반대 코너 주황(`anchorIdx = oppOfHot`), 패널pivot=그 코너 항상 주황(`pivotCornerIdx(obj.pivot)` — 각 축 0/1이면 코너 인덱스). 잡은 핸들=흰색 유지.
- **방향별 리사이즈 커서**: `cursorForCorner(i)` — 코너↔bbox중심 화면각(atan2)을 45°씩 8분할 → `CURSORS`(ew/nwse/ns/nesw 순환). hover·드래그 중 적용, 박스 회전 시 화면 방향 따라감.

---

## 🎨 진행 중 (2026-07-16) — 커스텀 컬러픽커 공통 컴포넌트 (피그마식) — 브라우저 확인 대기 / 롤아웃 진행중

> 사용자 요청: "input[type=color]이 너무 단순하다. 피그마처럼 자체 컬러픽커를 **공통 컴포넌트**로." 신규 `lib/color.ts` + `components/ui/ColorPicker.tsx`. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.** (3종 로드맵 중 ② — 다음: 액추에이터[맨 나중 상의])

- **`lib/color.ts`**: 순수 색 변환(normalizeHex·hex↔rgb↔hsv). 픽커 HSV 사각형/Hue 슬라이더·hex/RGB 입력 공유.
- **`ColorPicker.tsx`**(공통): 트리거 스와치 버튼 + 팝오버(`useDropdown`+portal 재사용). 기능 = **SV(채도·명도) 사각형 드래그 · Hue 슬라이더 · hex/RGB 입력 · 저장 팔레트(`colorAssets`) 연동(클릭 적용·+Save·우클릭 삭제) · 스포이드(EyeDropper API, 크로미엄만)**. props `{value, onChange(hex), onCommit(=pushHistory), className, showHex, palette, disabled, title}`. onChange=실시간, onCommit=조작 끝 1회(드래그업/입력확정/스와치). **그레이스케일에서 hue 보존**(내부 HSV state + 드래그 중 외부 동기화 skip).
- **드롭인 규약**: 기존 `<input type=color value onChange onBlur={pushHistory}>` → `<ColorPicker value onChange={hex→} onCommit={pushHistory}>`. className으로 트리거 크기 조절(기본 w-8 h-8, showHex면 스와치 위 hex 표시).
- **적용 완료**: `MaterialSection`(Color·Emissive) · `MultiSelectPanel`(일괄 색) · `VoxelToolModal`(칠할 색).

### ✅ 완료 (2026-07-17) — 컬러픽커 전역 롤아웃 (input[type=color] → ColorPicker)
> 프로젝트 전역의 네이티브 색 입력을 자체 `ColorPicker`로 통일. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**
- **교체 18곳**: `EnvironmentPanel`(7: Sky·Ground·Fog·Sun·Ambient·팝업 기본배경·경계벽) · `EventsSection`(3: set_variable 색·팝업 배경·조건 색) · `SceneLogicSection`(2: 조건 색·set_variable 색) · `LightSection`(1: 라이트 색) · `ParticleSection`(1) · `HudSection`(1) · `GameVariablesSection`(1: color 변수 초기값) · `AssetBrowser`(2: 재질 라이브러리 색·자체발광). (VoxelTool30·Material·MultiSelect는 앞서 완료.)
- **패턴**: 스와치+hex 텍스트 필드(`<div>...<input color><input text></div>`)는 통째로 `<ColorPicker value onChange onCommit={pushHistory}/>`로 교체. 작은 스와치(AssetBrowser 재질)는 `showHex={false}` 소형. 폼 상태만인 곳(SceneLogic·Events 일부)은 onCommit 생략.
- **제외(의도)**: MaterialSection **복셀 disabled** 색 표시(안내용) · LightSection **주석 처리**된 옛 입력.
- **정리**: EnvironmentPanel 미사용 `inputCls`(팝업 배경 텍스트 입력 제거로 고아) 삭제. ※EnvironmentPanel의 X/Trash2/Plus 미사용 import 경고는 기존(무관).
- **결과**: 전역 색 입력이 SV/Hue·HEX/RGB/HSL·저장 팔레트·스포이드·팝업형 픽커로 통일. Material Color만 그라데이션 지원, 나머지는 solid.

### 후속 (2026-07-17) — 컬러픽커 전역 싱글턴 + 우측 패널 밖 표시 (사용자 요청) — 브라우저 확인 대기
> **확정(사용자)**: ①화면에 픽커는 **하나만** — 다른 색 필드 클릭 시 팝업은 **그 자리 유지, 내용만 교체**(피그마식). ②**우측 패널(Inspector/Env) 픽커는 패널 왼쪽 바깥**에 떠서 정보 안 가림. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**
- **싱글턴**: 신규 `store/colorPickerStore.ts`(zustand: `activeFieldId`+`panelPos`). 각 `<ColorPicker>`는 `useId()` fieldId가 active일 때만 팝업 렌더 → 항상 하나. 다른 필드 클릭 = 이미 열려있으면 `switchTo`(위치 유지·내용 스왑), 닫혀있으면 `openAt`(위치 계산). 같은 필드 재클릭=닫기. 드래그 위치도 스토어 공유. 언마운트 시 active면 close. 로컬 open/panelPos state 제거.
- **우측 패널 밖(자동 배치)**: `placement` 미지정 시 트리거 `rect.left > vw*0.55`(우측)면 **left**(패널 밖 왼쪽), 아니면 **bottom-start**. 호출부 무수정으로 Inspector/Env 픽커 자동 왼쪽·AssetBrowser(좌)/복셀모달(중앙) 자동 아래. `placement` 명시 지정도 유지.
- 성능: active만 panelPos 구독(드래그 시 active 하나만 리렌더). isActive는 전 인스턴스 구독이나 open/switch 시에만 갱신.

### 후속 (2026-07-17) — placement prop (useDropdown/SelectBox/ColorPicker) (사용자 확인 완료)
> 드롭다운·픽커 열리는 위치 지정 prop. `useDropdown`에 `DropdownPlacement`(bottom/bottom-start/bottom-end/top(-start/-end)/right/left) — 상하 공간부족 시 자동 뒤집기·가로 start/end 정렬·뷰포트 클램프. SelectBox·ColorPicker에 `placement` prop 노출, 기본 bottom-start(왼쪽+하단). 기존 'bottom'/'right' 호출부 호환.

### 후속 (2026-07-17) — 컬러픽커 팝업화 + SV/정지점 버그 수정 (사용자 확인 완료)
- **SV 사각형 색배치 버그**: 흰색 겹이 검정 겹 위라 좌하단이 시각상 흰색인데 클릭값은 검정(#000000)으로 불일치 → **검정(명도) 겹을 위로** 순서 교체(좌상=흰·우상=순색·하단=검정, 클릭값 일치).
- **정지점 선택 시 SV/Hue thumb 미이동**: `startStopDrag`가 켜던 `draggingRef`가 thumb 재동기화를 막았음(위치 드래그는 색 불변이라 불필요) → 제거. 이제 정지점 클릭하면 그 색으로 SV/Hue 작은 원이 이동(선택 정지점=SV에서 편집).
- **떠 있는 팝업 전환**(펜툴/복셀 모달 패턴): `useDropdown` 제거 → 로컬 open/panelPos + **드래그 헤더("Color")+닫기(X)** + ~~**Esc 닫기, 바깥클릭 안 닫힘**(3D 씬 보며 색 조절)~~ → **2026-07-21 뒤집힘: 바깥 클릭도 닫는다**(사용자 요청·확인 완료). `pointerdown`을 capture 단계에서 받아 패널 내부·트리거만 예외(트리거를 빼면 닫혔다 곧바로 다시 열린다). **트레이드오프**: 카메라를 돌려 색을 확인하려 뷰포트를 드래그하면 픽커가 닫힌다 — 불편하면 ①뷰포트만 예외 ②드래그/클릭 구분으로 완화 가능. 여러 색 필드 동시 오픈 가능(각각 X). 드래그 캡처 레이어(dragging 시).

### 후속 (2026-07-17) — 픽커 UI 리팩터 2·3·4 (사용자 요청) — 브라우저 확인 대기
> 사용자 5개 요청 중 **알파(5)=보류(추후 요청)**, **그라데이션(1)=선형+라디얼 다중stop으로 확정했으나 사용자가 git push 후 진행 요청 → 대기**. 이번엔 **2·3·4만** 반영. tsc 클린 + `✓ Compiled`.
- **②트리거 필드형**: 버튼 전체가 색 → **`[스와치 네모][hex 텍스트]` 필드형**(border/bg 있는 입력 박스 모양, 색은 작은 네모에만). `showHex` 기본 true.
- **③font-mono 삭제**: 픽커 hex/값 텍스트의 `font-mono` 전부 제거(앞으로 미사용).
- **④표현 드롭다운**: hex+RGB 동시표시 → **HEX/RGB/HSL 드롭다운**(패널 내부 인라인 — 포탈 아님, 픽커 안 닫힘) + 선택한 표현의 입력만 노출. `color.ts`에 **HSL 변환 추가**(rgb/hex↔hsl).
- **확인 필요(브라우저)**: 트리거 필드 모양 · HEX/RGB/HSL 전환·입력 · SV/Hue 드래그 · 팔레트 · 스포이드.

### ✅ 완료 (2026-07-17) — ①그라데이션 (선형+라디얼 다중 stop) — 브라우저 확인 대기
> **범위**: linear+radial **다중 stop**. 대상 = 프리미티브·복셀·돌출·회전체(전부 `PrimitiveMaterial`). tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**
- **스키마**(`scene.ts`): `GradientStop{color,pos}`·`GradientFill{type,angle?,stops[]}` + `MaterialOverride.gradient?`(옵셔널=하위호환, 없으면 solid).
- **셰이더**(`PrimitiveMaterial`): 정지점 램프를 **1D CanvasTexture**로 굽고(`buildGradientTexture`, useMemo+dispose), `onBeforeCompile`이 `#include <color_fragment>` 뒤에 그라데이션 주입 — **bbox 로컬좌표**(`vTriPos`, 기존 uWrapMin/uWrapSize uniform 재사용)로 좌표 `t` 계산(linear=각도 방향 투영, radial=중심 거리) → `uGradTex` 샘플 후 `pow(2.2)` sRGB 디코드로 diffuse 대체. `customShader = triplanar || gradActive`(둘 다 onBeforeCompile), key에 grad 유무 포함(토글 시 재마운트), 정지점/각도 변경은 uniform 갱신(재컴파일 X, per-instance cacheKey).
- **배선**: `EditorObjectInstance`·`ViewerObject`가 `gradient={mat?.gradient}` 전달(이미 wrapMin/wrapSize 넘기던 자리). 에디터=뷰어 동일 렌더.
- **픽커 UI**(`ColorPicker`, opt-in `allowGradient`): **Solid/Gradient 토글** + 그라데이션 바(**클릭=정지점 추가·핸들 드래그=위치·클릭=선택·Remove**) + **Linear/Radial** 타입 + Linear **각도** 입력. SV/Hue/hex/RGB/HSL이 **선택된 정지점 색**을 편집(`applyColor`가 solid=onChange / gradient=선택 stop 갱신으로 분기). 트리거 스와치는 그라데이션 미리보기. Solid↔Gradient 전환은 commit(undo 1회).
- **적용**: `MaterialSection`의 **Color 필드만** `allowGradient`(Emissive·라이트·안개 등은 solid 유지). 그라데이션 변경도 `updateObject`+`pushHistory` 경로라 단일 undo.
- **확인 필요(브라우저)**: Color 픽커 Gradient 토글 → 바에서 stop 추가/드래그/삭제·색 편집 · Linear 각도·Radial · 프리미티브/복셀/돌출/회전체 표면 렌더(에디터=게시 뷰어) · undo · solid 복귀.
- **radial 투영 3방식**(`GradientFill.radialMode`, uniform uRadMode): **facing(기본)** = 카메라 바라보는 쪽 원형(뷰공간 XY 거리/반경, 줌 무관·어느 각도서도 정원·앞면만) / **surface** = 면 법선 지배축 제외 2D로 면마다 중앙 원형(패널·벽) / **axis** = 로컬 XY 고정. 픽커에 Facing/Surface/Axis 세그먼트. **facing이 '타원·양쪽 찍힘' 해결**(axis는 로컬 Z축 무시 XY라 비스듬히 보면 타원+앞뒤 대칭이던 것). 정점 셰이더에 뷰공간 위치/중심/반경(vGViewPos/vGViewCtr/vGRadius) varying 추가.
- **radial 컨트롤**: Spread(퍼짐)·Angle(중심 미는 방향)·Offset(중심 이동거리) — 세 모드 공통(facing=화면 기준, surface/axis=면/로컬 기준).
- **한계/후속**: linear는 로컬 XY 방향. 알파(투명 stop) 미지원(색만). GLB·텍스트 콘텐츠 제외(프리미티브 전용). 텍스처와 동시 사용 시 gradient×texture로 곱해짐. ※radial 초기 3D bbox 거리→박스 단색 버그로 XY 2D로, 이후 facing/surface/axis 3방식으로 확장.

### 후속 (2026-07-16) — Tidy/Distribute (위 별도 항목 참조)
- (알파 슬라이더 등 나머지는 요청 시)

---

## 📐 진행 중 (2026-07-16) — Tidy Up & Distribute Spacing (피그마식 정돈/간격 균등) — 브라우저 확인 대기

> 기준 문서 `doc/# Tidy Up & Distribute Spacing 기능 구현 명세.md`. 기존 `alignSelected`(min/center/max)에 **자동 정돈 + 간격 균등** 추가. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.** (3종 로드맵 중 ① — 다음: 컬러픽커 → 액추에이터[맨 나중 상의])

- **`tidyUpSelected()`**(2개+): 선택 전체 bbox가 **가장 긴 축=주 축**으로 순서(중심)대로 **균등 간격 팩**(전체 스팬 유지, gap=(span−Σsize)/(n−1)≥0) + **나머지 두 축은 중심 평균으로 맞춤**. 아무렇게나 놓인 것 → 한 줄 정돈.
- **`distributeSelected(axis)`**(3개+): 위치 순서·양끝 유지하고 **축 방향 사이 간격만 균등**. 크기 불변. X/Y/Z 각각.
- **공통**: `worldBBox`(AABB, 회전 반영) 기준 + position 델타 1:1(루트 기준, `alignSelected`와 동일 제약). **잠김·숨김·bbox 미로딩(GLB) 제외**. spacing 음수→0. **단일 undo**(`withHistory`).
- **3D 대응**: 명세는 2D(x/y)지만 우린 3D → Distribute는 **X/Y/Z 축 버튼**, Tidy는 최장축 자동. `MultiSelectPanel` **Arrange 섹션** 신설(Tidy up 버튼 + Distribute X/Y/Z, 3개 미만이면 Distribute disabled).
- **확인 필요(브라우저)**: 흩어진 오브젝트 Tidy up→한 줄 균등·교차축 중심 정렬 · Distribute 축별 간격 균등(양끝 유지) · 잠김/숨김 제외 · undo 1회 · 회전된 오브젝트 AABB 기준.
- **후속(선택)**: 격자(rows×cols) 정돈 · 방향 강제 지정 옵션 · 뷰포트 툴바 노출.

---

## 🧩 진행 중 (2026-07-16) — 프리팹 원본/사본(Figma 컴포넌트 모델) — 브라우저 확인 대기

> 사용자 요청: "프리팹 = 피그마 컴포넌트인데 원본/사본 구분이 없다. 피그마처럼 원본 편집→사본 자동 반영이면 좋겠다." **확정(사용자)**: ①원본 편집 시 **자동 전파**(Apply 불필요) ②원본 삭제 시 **다른 사본 자동 승격** ③아이콘 = **원본=현재(CirclePile), 사본=`Focus`**. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**

- **배경(기존 갭)**: 프리팹 "원본"은 라이브러리 속 **데이터(def)** 일 뿐 화면엔 동등한 인스턴스만 존재. 원본 반영은 인스턴스 편집 후 **수동 Apply**("원본에 반영")뿐 → 피그마의 "메인 컴포넌트↔인스턴스" 자동 동기화가 체감 안 됨.
- **모델**: `PrefabSchema.masterInstanceId?`(옵셔널, 미설정=레거시=수동 Apply 유지) — 한 인스턴스를 **원본(master)** 으로 지정. 원본 편집 = def 갱신 + 사본 자동 동기화(각 사본 override 존중). **루트 배치 transform(pos/rot/scale)은 항상 인스턴스 소유**(전파 안 함)라 사본 위치는 그대로.
- **순수 로직**(`lib/prefab.ts`): `propagateMaster(objects, prefab)` = master로부터 `rebuildPrefabFromInstance`→def 재구성 + `syncInstances`. 원본이 씬에 없으면(삭제) 무변경 반환(승격은 스토어가).
- **스토어**(`sceneStore.ts`):
  - `createPrefab`: 만든 선택물을 **원본으로 지정**(`masterInstanceId=instanceId`).
  - `updateObject`: 대상이 **원본 노드면 override 안 쌓고** `propagateMaster`로 즉시 전파. 사본 노드는 기존대로 override 기록. undo 정합 위해 **원본 편집이면 `_prevSnapshot`에 pre-edit `prefabs` 포함**.
  - `commitTransforms`(기즈모): 원본 자식 트랜스폼 편집→해당 프리팹 전파. **사본 자식은 `transform` override 기록**(향후 동기화 시 보존 — 기존 gizmo 경로의 누락 보완). 원본 편집이면 snapshot에 prefabs.
  - `setPrefabMaster(instanceRootId)`: 이 인스턴스를 원본으로 지정(= 현재 상태로 def 재구성 + 사본 동기화, Apply와 동일 전파). 우클릭 메뉴/Inspector에서 호출.
  - `deleteSelected`: 원본 인스턴스가 통째로 삭제되면 **남은 사본 하나를 `masterInstanceId`로 자동 승격**(비파괴 — def·다른 사본 무변경). snapshot에 prefabs 포함.
- **UI**:
  - **트리**(`HierarchyPanel`): 프리팹 루트 아이콘 = 원본 `CirclePile` / 사본 `Focus`(둘 다 `--prefab` 색). **레거시(원본 미지정)는 사본 취급 안 하고 현행 아이콘 유지**. 사본/레거시 루트 우클릭에 **"원본으로 지정"**(`Focus` 아이콘).
  - **Inspector**(`PrefabSection`): 인스턴스에 **Master·원본 / Copy·사본 뱃지**. 원본=「편집 시 자동 반영」 안내(Apply/Revert 숨김). 사본=override 뱃지+Revert+**"Set as master"**(Apply는 숨김 — 원본이 전파원). 레거시(원본 없음)=기존 Apply+Revert+Set as master.
- **하위호환**: `masterInstanceId` 옵셔널 → 기존 씬/프리팹은 레거시(수동 Apply)로 그대로. normalize/save는 prefabs 통째 통과라 자동 보존.
- **확인 필요(브라우저)**: 프리팹 만들기→배치(사본 여러 개)→**원본 편집(색·트랜스폼)이 사본에 즉시 반영**·사본 개별 편집은 그 사본만(override)·**원본 삭제 시 사본 자동 승격**·우클릭 "원본으로 지정"·트리 아이콘(원본/사본)·undo가 원본 편집+전파를 1회로 되돌리는지.
- **알려진 제약/후속**: 전파는 **commit 시점**(updateObject 지연커밋의 pushHistory / gizmo 놓을 때) — 슬라이더 드래그 중엔 놓아야 사본 반영(사실상 즉시). 승격은 최소 동작(def·다른 사본 무변경)이라 승격 직후 새 원본의 기존 override는 다음 편집 때 def로 흡수. `removeObjectsByAsset` 등 다른 삭제 경로는 자동 승격 미적용(propagateMaster가 안전 무변경 반환).

### 후속 (2026-07-16) — 프리팹 그룹 해제 차단 + 사본 detach(프리팹 해제)

> 사용자 지적: "프리팹은 그룹과 다른데 Ctrl+Shift+G로 그룹 해제가 된다. **원본은 일반 오브젝트로 못 돌아가야** 한다." + "**사본 우클릭에 프리팹 해제** → 일반 그룹+기본색 전환" + "프리팹의 '그룹 해제' 메뉴는 숨김". **확정(사용자)**: 원본 detach 없음 · detach는 **메뉴+Inspector 둘 다**. tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**

- **문제**: `ungroupSelected`가 프리팹 루트도 그냥 그룹으로 해제 + **프리팹 태그를 안 지워서** def의 rootKey가 가리키는 노드가 사라진 **손상된 유령 프리팹**이 됐음.
- **그룹 해제 차단**: `ungroupSelected`에 `if (group.prefabId) return` — 프리팹(원본/사본, 프리팹 내 하위 그룹 포함) Ctrl+Shift+G 무효. `HierarchyPanel` 컨텍스트 메뉴의 "그룹 해제"는 `obj.isGroup && !obj.prefabId`로 **일반 그룹만 표시**(프리팹은 숨김).
- **사본 detach**(`detachPrefabInstance(instanceRootId)`): 같은 `prefabInstanceId` 서브트리의 프리팹 태그(prefabId/prefabInstanceId/prefabNodeKey/prefabOverrides) 전부 제거 → **일반 그룹 + 기본색**(트리 색은 `obj.prefabId` 기반이라 자동 복귀). **원본(master)은 가드로 detach 불가**(`masterInstanceId===iid`면 no-op). def·다른 사본·원본 **무영향**. 피그마 "Detach instance"와 동일.
- **UI**: 트리 사본 루트 우클릭에 **"프리팹 해제"**(`Unlink` 아이콘, "원본으로 지정" 아래) + Inspector `PrefabSection` 사본 브랜치에 **"Detach · 프리팹 해제" 버튼**. 원본엔 둘 다 없음. 겸사겸사 `HierarchyPanel` 미사용 `ShoppingBag` import 정리.
- **원본 제거 정식 경로**: 라이브러리에서 **프리팹 정의 삭제**(`deletePrefab`) — 모든 인스턴스(원본 포함) 태그 벗고 일반 그룹으로. 이게 원본까지 없애는 유일한 길.
- **확인 필요(브라우저)**: 프리팹 원본/사본에서 Ctrl+Shift+G 무반응 · 프리팹 우클릭에 "그룹 해제" 안 뜸 · 사본 "프리팹 해제"(메뉴/Inspector)→일반 그룹+기본색·원본/다른 사본 유지 · 원본엔 detach 없음.

---

## 🌫️ 진행 중 (2026-07-16) — 에디터 fog 렌더링 추가 (수평선 하드컷 완화) — 브라우저 확인 대기

> `EditorCanvas`에 뷰어(`ViewerCanvas`)와 동일한 `<fog>`/`<fogExp2>` 블록 추가(배경 렌더 직후). tsc 클린 + `✓ Compiled`. **브라우저 확인 대기.**

- **문제(사용자 보고)**: sky 흰색·ground 녹색에서 카메라 상하 이동 시 **평평한 1000×1000 바닥 + 단색 하늘**이 만나는 **수평선이 면도날처럼 하드컷**. Spline은 fog/그라데이션으로 지평선을 페이드시켜 안 그럼.
- **원인**: fog가 **게시 뷰어에만** 있고 **`EditorCanvas`엔 없어서**, 씬 Fog를 켜도 에디터에선 수평선이 안 부드러워졌음.
- **수정**: 에디터에도 `environment.fog.enabled`면 linear(near/far)·exp(density) fog 렌더 → Fog 색을 하늘색(흰색)으로 맞추면 먼 바닥이 페이드돼 수평선 완화. 에디터=뷰어 룩 일치.
- **나중에 논의(사용자 보류)**: fog 켤 때 색=현재 하늘색 자동 제안 · fog 없이도 바닥을 하늘색으로 페이드하는 그라데이션 하늘/자동 대기 블렌드.

---

## ✅ 완료 (2026-07-16) — 🎨 라이브 클로너 material 편집 (소스→복제본 전파 + 클로너/일반 그룹 Material 섹션 정리) (사용자 확인 완료)

> `sceneStore.updateObject` + `InspectorPanel`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").**

- **문제**: 라이브 클로너는 복제본이 생성 시점에 구워진 복사본 + `regenerateCloner`는 config(개수/간격) 변경 때만 돌아서, **소스 material을 바꿔도 복제본 미반영**. 또 Material 섹션 조건에 `!obj.isGroup`가 없어 **모든 그룹(일반 포함)에 무의미한 Material 섹션**이 떴음(그룹은 메쉬 없음).
- **소스→복제본 전파**: `updateObject`에서 대상이 **클로너 소스**(부모가 `clonerConfig` 그룹 & 자신은 `clonerClone` 아님)면 같은 patch를 그 그룹의 복제본들에 전파(material·geom·physics·motion·visible·scale 등). **위치/회전/이름/식별자는 복제본 고유(배치·rotStep)라 제외**. regenerate 없이 직접 map이라 가벼움.
- **Material 섹션 정리**(`InspectorPanel`): 편집대상 `mt` = 클로너 그룹이면 **내부 소스**, 아니면 obj. `mt.isGroup||assetId||particle||비텍스트콘텐츠`면 미표시 → **일반 그룹=Material 숨김**, **클로너 그룹=소스 편집(→전파)**, 프리미티브=기존과 동일. 클로너 그룹을 펼치지 않고도 색/재질 지정 가능.
- **한계**: 소스가 **그룹(하위 자식)** 인 클로너는 소스 루트 편집만 전파(깊은 자식 material 미전파). 프리미티브 단일 소스는 완전 동작.

---

## ✅ 완료 (2026-07-16) — 🧩 프리팹 개선 5종 (단일그룹·geom동기화·그룹래핑/아이콘·복제=인스턴스·트리색) (사용자 확인 완료)

> `sceneStore`(groupSelected·createPrefab·duplicateSelected·pasteClipboard·arraySelected) + `lib/prefab`(mergeDefIntoNode) + `HierarchyPanel` + `globals.css`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("동작은 잘된다").**

1. **단일 오브젝트 그룹화**: `groupSelected` 가드 `<2`→`<1`. 오브젝트 1개도 제자리에 그룹으로 감쌈.
2. **프리팹 geom 동기화**: `mergeDefIntoNode`에 `out.geom = cloneVal(def.geom)` 추가(assetId/primitiveShape처럼 구조적 필드로 항상 def 따름). 원본 형상(복셀·펜툴 프로파일·cornerRadius 등) 수정 시 전 인스턴스 반영. (PrefabNodeData는 이미 geom 포함이라 def엔 있었고, 병합만 누락됐던 것.)
3. **프리팹 등록 시 그룹 래핑 + 아이콘**: `createPrefab`이 대상이 단일 오브젝트면 먼저 그룹으로 감싼 뒤(그룹이면 그대로) 프리팹화 → 프리팹 루트는 항상 그룹. `HierarchyPanel.getIcon`에 `isGroup && prefabId → Package`(프리팹 아이콘, Folder보다 먼저).
4. **복제/붙여넣기/배열 = prefab place처럼**: 프리팹 인스턴스 복제 시 **새 `prefabInstanceId` 발급**(prefabId·nodeKey·override 유지) → 같은 프리팹의 독립 인스턴스(sync가 뭉치던 버그 해결). `duplicateSelected`(withInst)·`pasteClipboard`(instMap 인스턴스별)·`arraySelected`(복사본마다 instI) 적용.
5. **트리 텍스트 색**: 프리팹 인스턴스 노드(`prefabId` 있음) 이름을 `var(--prefab)`(초록)으로 — 일반 오브젝트와 구분. `--prefab` 토큰(사용자 지정값).

---

## ✅ 완료 (2026-07-16) — 🎨 트리 아이콘 교체 + Array/Cloner 패널 전 모드 UI 통일 (사용자 확인 완료)

> `HierarchyPanel`·`PrefabSection` + 신규 공용 `inspector/GridPreview.tsx` + `ArraySection`·`ClonerSection`·`ui.tsx(XYZRow)`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료.**

### 트리/패널 아이콘 (`HierarchyPanel.getIcon` + `PrefabSection` 헤더)
- **프리팹 그룹(루트)**: `Package` → **`CirclePile`**(사용자 최종 선택) + **`--prefab` 색**. **자식 아이콘 색도 `--prefab`**(prefabId 있는 노드 아이콘 span에 `color: var(--prefab)`, 없으면 `text-muted/60`). Inspector Prefab 섹션 타이틀 아이콘도 `Component` → **`ShoppingBag`**(+`--prefab`색). (※"paper-bag"은 lucide 1.22에 없어 처음엔 ShoppingBag, 트리는 사용자가 `CirclePile`로 교체.)
- **클로너 그룹**: `Grid2x2` → **`Grid3x3`**(사용자 조정). **그룹 폴더**: `Folder` → **`Group`**. **구체**: `Circle` → **`CircleDot`**.

### Array/Cloner 패널 통일 (처음 생성 `ArraySection` ↔ 생성 후 수정 `ClonerSection`)
> **문제**: 생성 후 라이브 클로너를 수정할 때 UI가 생성 시와 달랐음(프리뷰 없음·Count 컨트롤 다름·싱크 버튼 없음).
- **GridPreview 공용화**: ArraySection 내부에만 있던 미니 격자 SVG를 신규 **`inspector/GridPreview.tsx`** 로 추출 → 양쪽 import. ClonerSection Grid 모드에도 실시간 프리뷰 표시.
- **Grid 싱크 버튼**: ClonerSection Grid에 `LinkToggle` 2개(열⟷행 `linkCR`·간격 x⟷z `linkSp`, 로컬 state) + 레이아웃을 ArraySection과 동일(`flex items-end` + 링크 맨 끝).
- **Count 컨트롤 통일**: ClonerSection Count `LabeledNum` → **`RangeSlider`**(ArraySection과 동일, `onCommit={pushHistory}`로 드래그 놓을 때 undo 커밋).
- **Linear 싱크 버튼**: Linear Spacing(XYZ)에 3축 잠금 `LinkToggle`(`linkSpL`, X=Y=Z) 추가 — 양쪽 패널. **위치는 Grid와 동일하게 입력열 맨 끝**: `XYZRow`에 신규 **`rowEnd` slot** 추가(있으면 입력열을 flex로 배치, X/Y/Z 뒤에 요소 렌더 / 없으면 기존 `grid-cols-3` 유지 → 다른 XYZRow 무영향).
- **Grid 프리뷰 좌표 정렬 버그**: ClonerSection은 전 모드가 `cfg.offset` 하나를 공유해 Linear(비대칭 offset)→Grid 전환 시 격자가 한쪽으로 몰림(ox=22.5). ArraySection은 grid 간격을 별도 state(`gridSpacing` 기본 `{1,1}`)로 관리해 정사각(ox=9)이던 것. → **ClonerSection에서 비-Grid→Grid 전환 시 간격을 정사각 `{x:1,z:1}`로 시작**(이미 Grid면 사용자 간격 보존). Rows 폴백도 `?? 3`→`?? 4`(ArraySection 기본과 일치).
- 결과: Grid(프리뷰+열/행/간격+링크2)·Linear(Count슬라이더+Spacing+링크1)·Radial(Count슬라이더+Radius/축/Rise/나선) 전 모드에서 두 패널 UI·프리뷰 일치.

---

## ✅ 완료 (2026-07-16) — 🗂️ AssetBrowser: ground·boundary 텍스처 에셋 통합 (사용자 확인 완료)

> `EnvironmentPanel` 단독. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").**

- **문제**: ground/boundary 텍스처가 `ground/`·`boundary/` 경로로 **직접 스토리지 업로드**(에셋 미등록)라 Textures 라이브러리에 안 뜨고 재사용/삭제 관리 불가.
- **통합**: 공용 `uploadTextureAsset`(= `uploadImageTexture` + `addAsset`, `textures/{pid}/` + assets DB insert)로 3개 핸들러(handleGroundTexUpload·handleBoundaryTexUpload·uploadBoundaryImage[면별/스카이박스 공유]) 통일 → **전부 에셋으로 등록**(오브젝트 텍스처와 동일 파이프라인, Textures 탭에 노출·관리 가능).
- **라이브러리 픽커**: ground(Texture 모드)·boundary 메인 텍스처에 **`TexturePicker`**(썸네일 그리드 + 업로드) → 업로드뿐 아니라 **기존 텍스처 재사용**. 면별/스카이박스는 업로드(이제 등록)만.
- 중복 3핸들러 정리, 미사용 `createBrowserSupabase` import 제거. **로드맵 완료.**
- **🐛 덤 수정(기존 버그)**: boundary 텍스처가 **그라데이션 켤 때만** 보이던 문제 — 경계 벽 재질(`WallFace`·`CylinderWall`·`PolygonCap`)에 `key`가 없어 **텍스처 비동기 로드 시 셰이더 재컴파일 안 됨**(USE_MAP 미정의). 그라데이션의 `vertexColors`가 우연히 재컴파일을 유발해 그때만 보였던 것. → 세 재질에 `key={텍스처 유무}` 추가(PrimitiveMaterial과 동일 트릭)로 그라데이션 무관하게 정상 적용.

---

## ✅ 완료 (2026-07-16) — 🧊 복셀 후속: 3D 클릭 빌드 + 단일 스킨 + 색별 텍스처(멀티 스킨) (사용자 확인 완료)

> `VoxelToolModal` + `voxelGeometry` + `primitiveGeometry` + `sceneStore`(add/updateVoxelObject) + `EditorObjectInstance` + `ViewerObject` + 신규 `useVoxelSkinMaterials`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘동작한다").**

- **3D 클릭 빌드(마인크래프트식)**: 복셀 모달 3D 프리뷰에서 **면 좌클릭=인접 복셀 추가**(`e.face.normal`로 방향 계산)·**우클릭=삭제**·**빈 바닥 좌클릭=y=0 추가**(투명 클릭 평면). 드래그=OrbitControls 회전(클릭과 자연 분리). 범위 밖·중복 무시, 각 조작 pushUndo. 편집 층 판은 `raycast={()=>null}`. 2D 페인터는 그대로(추가 방식).
- **단일 스킨**: 모달 툴바 "스킨" 업로드 → `material.textureUrl`로 저장 → 복셀 지오메트리의 면별 UV로 **모든 면에 한 장**. 렌더에서 `vertexColors = voxel && !textureUrl`로 색 틴트 없이 순수 텍스처. (Inspector Material Texture로도 동일.)
- **색별 텍스처(멀티 스킨, 진짜 여러 텍스처)**: `PrimitiveGeom.voxelSkins?: {color,texUrl}[]`. 있으면 `buildVoxelGeometry(grouped=true)`가 **색별 그룹(mergeGeometries useGroups)** 지오메트리 + `userData.voxelGroupColors`. 신규 훅 **`useVoxelSkinMaterials`**가 그룹 색 순서에 맞춰 **재질 배열**(매핑 색=텍스처·나머지=단색, 텍스처 async 로드/dispose). 에디터·뷰어 프리미티브 메쉬가 `voxelSkins` 있으면 `material={배열}`, 없으면 기존 `PrimitiveMaterial`(단일 메쉬 유지 → bbox/콜라이더 무영향). 우선순위: **색별 > 단일 스킨 > 칸 색**.
- **모달 UI**: "색별 스킨" 섹션(사용 중인 색마다 스와치+이미지 지정/제거) + 3D 프리뷰 WYSIWYG(색→URL 해석해 큐브별 텍스처). 저장 시 실제 사용 색만 유지.
- **배선**: `primitiveGeomKey`/memo deps에 `voxelSkinsSig` 추가(매핑 변경 시 재생성). `add/updateVoxelObject`에 `skinUrl`·`voxelSkins` 인자. 재편집 로드.
- **로드맵**: 복셀 후속(텍스처 스킨·3D 면클릭) 완료.

---

## ✅ 완료 (2026-07-16) — 🔢 배열(Array/Cloner) 툴 후속: Grid·회전 증분·나선 계단·미니 프리뷰·LinkToggle (사용자 확인 완료)

> `scene.ts`(ClonerConfig) + `lib/cloner` + `sceneStore`(arraySelected) + `ArraySection` + `ClonerSection` + 신규 `components/ui/LinkToggle`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘돼네").**

- **모드 3종**: Linear(직선) / **Grid(격자)** / Radial(원형). `ClonerConfig`에 `'grid'`·`cols`·`rows`·`rotStep`·`rise` 추가(옵셔널, 기존 씬 무영향).
- **Grid**: Columns×Rows + 열/행 간격(grid 전용 spacing 상태, 기본 4×4·간격 1). **실시간 미니 프리뷰**(`GridPreview` SVG — cols×rows 점, 간격 비율 반영, 20 초과 시 영역 사각형). **LinkToggle 2개**(cols⟷rows·간격 x⟷z, 켜면 함께 움직임, 버튼 위치=각 줄 맨 끝).
- **회전 증분**(`rotStep`, °/copy): 복제마다 Y축 회전 — 나선/트위스트. 전 모드 공통.
- **나선 계단**(Radial): `rise`(칸마다 Y 상승) + **"나선 계단 방향 맞춤" 버튼**(rotStep=360÷Count). 위치는 항상 한 바퀴 고정(Turns 옵션은 Rotation step과 역할 혼동+다바퀴 겹침 이슈로 제거).
- **공용화**: `lib/cloner`에 `clonerCount`·`clonerRotYDeg` 추가, `clonerPlacement`에 grid/rise 분기 → `arraySelected`(한 번 복제)와 `regenerateCloner`(라이브)가 **동일 배치 로직 공유**. `arraySelected` 시그니처를 `ClonerConfig` 하나로 리팩터(원본 제자리 = placement(i)−placement(0)). 그룹·중첩 지원 유지.
- **재사용 컴포넌트** `LinkToggle`(Link2/Link2Off) — 동기화는 부모가, 컴포넌트는 순수 토글이라 다른 "두 수치 묶기" UI에 재사용 가능.
- **후속(선택)**: 다바퀴(멀티턴) 나선은 제거된 Turns를 되살려야 함 · Grid를 XZ 외 수직 격자 · 배열 미리보기를 linear/radial까지 확장.

### 로드맵 갱신 — 배열 툴 후속
> 기존 "배열 툴 후속(그리드/원형/회전 증분)"은 이 작업으로 완료. (원형 배열은 이미 있었고, 그리드·회전·나선 추가.)

---

## ✅ 완료 (2026-07-16) — 🔷 경계 벽 원형(Circle) + 커스텀(자유 다각형) 모양 (사용자 확인 완료)

> `scene.ts` + `BoundaryWalls` + `PlayCanvas`(콜라이더) + `EditorCanvas`(BoundaryGizmo) + `ViewerCanvas` + `EnvironmentPanel` + 신규 `BoundaryShapeModal`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("만족해").**

### 원형(Circle)
- **스키마**: `EnvSchema.boundaryShape?: 'rect'|'circle'|'polygon'`(미설정=rect, 기존 씬 무영향). 원형은 `boundary`=반지름.
- **렌더**: 신규 `CylinderWall`(열린 실린더, 색·텍스처[둘레 2πr 타일]·그라데이션·oneSided=BackSide) + 천장=원반. **콜라이더**: 반지름 비례 24~72개 박스를 접선 링으로. **가이드**: 주황 원 링.

### 커스텀(자유 다각형)
- **편집 UI**(`BoundaryShapeModal`, 펜툴 패턴 재사용): 위에서 내려다본 씬 **풋프린트 배경**(오브젝트 worldBBox=파란 사각형·스폰=초록 점·월드 격자) 위에 꼭짓점 클릭→**첫 점 클릭해 닫기**(3점+)·점 드래그·Ctrl+Z·스냅(1m)·Esc. 적용 시 월드 XZ `boundaryPolygon` 저장 + `boundary`=경계반경 자동. 스토어 `boundaryShapeOpen` 플래그, `EditorClient` 마운트.
- **렌더**: `PolygonWall`(변마다 `WallFace` 한 장 `rot=[0,atan2(-dz,dx),0]`) + `PolygonCap`(천장, `THREE.Shape`→ShapeGeometry earcut 삼각분할). **콜라이더**: 변마다 정렬 박스(`rot=[0,atan2(dx,dz),0]`, len/2+0.3 겹침). **가이드**: 주황 다각형 외곽선 + 꼭짓점 기둥.
- **제약**: oneSided(안쪽만)는 다각형 윈딩 판정 복잡해 미지원(항상 양면). 오목/볼록 다 됨.

### 공통
- **에디터 바닥 채움 가이드**(2026-07-16 추가): 라인만으론 안쪽 구분 어려워 `BoundaryGizmo`에 **반투명 주황 바닥(opacity 0.08, depthWrite=false, y=0.03)** 추가 — rect=plane·circle=circle·polygon=shapeGeometry. **에디터 전용**(뷰어 무영향).
- **UI**: Boundary 모양 드롭다운(사각형/원형/**커스텀**) + 원형=반지름·사각형=가로/세로·커스텀=**"모양 그리기/편집" 버튼**.
- 원형/다각형 모두 **면별 텍스처 개념 없음**(변/둘레마다 반복). 스카이박스는 모양 무관.

---

## ✅ 완료·헤드리스 검증 (2026-07-16) — 🟦 둥근 박스 직사각형 모서리 균일화 (비균일 스케일 왜곡 수정)

> `primitiveGeometry`(신규 `createRoundedBoxDims`) + `EditorObjectInstance` + `ViewerObject` + `InstancedPrimitives`. tsc 클린 + `✓ Compiled`. **헤드리스 스크린샷 검증 + 사용자 확인 완료("잘되는거 같아").** (직전 "얇은 판" 회귀는 편집 중 HMR 중간상태였고 하드리프레시로 해소.)

- **문제**: 박스를 비균일 스케일(예 3:1)로 직사각형 만들고 `cornerRadius`↑ 하면 둥근 모서리가 타원으로 찌그러짐(1×1×1 단위 박스에 굽고 스케일로 늘려서 — 사진 늘리기). 정육면체는 정상.
- **해결(역스케일 트릭)**: 둥근 박스(`box`+`cornerRadius>0`)만 지오메트리를 **실치수(object.scale)로 굽고 메쉬에 `1/scale` 역스케일**을 걸어 group.scale과 상쇄 → **group.scale(=object.scale) 그대로**라 기즈모·objectBBox·Size·바닥스냅·정렬 **전부 무변경**, 최종 렌더만 균일한 모서리. 드래그 중엔 늘어나 보이다 놓으면(스토어 커밋) 재생성돼 균일.
- **반경**: `cornerRadius(0~0.5)×최소 변` = 짧은 변 기준 절대 반경 → 비율 무관 균일. **정육면체(scale 1,1,1)는 이전과 100% 동일**(기존 씬 무변).
- **1차 시도 회귀 원인 규명**: "얇은 판" 증상은 **여러 파일 연속 편집 중 HMR 중간상태**(메쉬 역스케일 적용됐는데 지오메트리 아직 단위)였음. 신규 **`/test/rounded-box`** 페이지 + 헤드리스 Edge 스크린샷으로 **정육면체·3×1×1·납작판(3,0.15,3)·0.3×1.5×3 전부 균일·정상** 확인([[project_e2e_play_mode_testing]] 방식). 재적용 시 비-둥근 박스 메쉬에 명시적 `scale=[1,1,1]`(R3F `undefined` 미리셋 함정 회피) 추가.
- **구현 상세**: 신규 `createRoundedBoxDims(sx,sy,sz,cornerRadius,seg,subdivisions)`(RoundedBoxGeometry 실치수+subdivision). 둥근 박스는 가이드/캐시 bbox를 **단위 박스로 고정**(group 스케일과 곱해 실제 크기 → objectBBox 무변경). 인스턴싱은 scale별 고유 지오메트리라 배칭 제외.
- **남은 확인(에디터 실사용)**: 기즈모 스케일 드래그(놓으면 균일)·Size 필드·선택 외곽선·게시 뷰어·subdivision 병용.
- **문제(사용자 보고)**: 박스를 비균일 스케일(예: 3:1)로 직사각형을 만들고 `cornerRadius`를 올리면, 정사각형은 잘 되는데 **직사각형은 둥근 모서리가 타원으로 찌그러져** 긴 쪽이 덜 둥글고 각져 보임. 원인 = 둥근 모서리를 **1×1×1 단위 박스에 굽고 비균일 스케일로 늘려서**(사진 늘리기와 동일).
- **해결 방식(사용자 확정, 옵션 A)**: 둥근 박스(`box`+`cornerRadius>0`)만 **지오메트리를 실제 치수(object.scale)로 굽고, 메쉬에 역스케일 `1/scale`을 걸어 group.scale과 상쇄**. → **group.scale(=object.scale)은 그대로**라 기즈모·objectBBox·Size·바닥스냅·정렬 **전부 무변경**, 최종 렌더만 균일한 모서리. **드래그 중엔 늘어나 보이다가 놓으면(스토어 커밋) 재생성돼 균일**해짐(기즈모 경로 안 깨는 핵심 트릭).
- **반경 의미**: `cornerRadius(0~0.5) × 최소 변` = 짧은 변 기준 절대 반경 → 비율 무관 균일. **정육면체(scale 1,1,1)는 이전과 100% 동일**(기존 씬 무변). 비균일이던 기존 둥근 박스만 균일하게 바뀜(=의도된 수정).
- **구현**: 신규 `createRoundedBoxDims(sx,sy,sz,cornerRadius,seg,subdivisions)`(three RoundedBoxGeometry 실치수+subdivision). 에디터/뷰어: `isRoundedBox`면 이 지오메트리 사용 + 메쉬 `scale={[1/s...]}`, 가이드/캐시 bbox는 **단위 박스로 고정**(group 스케일과 곱해 실제 크기 → objectBBox 무변경). 인스턴싱: 둥근 박스는 scale별 고유 지오메트리라 **배칭 제외**(getInstancedIds 두 루프).
- **확인 필요(브라우저)**: ①직사각형 둥근 박스 모서리 균일 ②정육면체는 기존과 동일 ③기즈모 스케일 드래그(놓으면 균일)·Size 필드·바닥스냅·정렬·선택 가이드 정상 ④뷰어(게시)에서 동일 ⑤subdivision 함께 쓸 때 ⑥성능(둥근 박스 다수).
---

## ✅ 완료 (2026-07-15) — 🧩 공통 DropdownMenu 컴포넌트(버튼 액션 메뉴) + GNB 적용

> 신규 `src/components/ui/DropdownMenu.tsx` + `EditorGnb` 리팩터. tsc 클린 + `✓ Compiled`. **브라우저 실동작 확인 대기.** ([[feedback_extract_reusable_shared_components]])

- **배경**: "버튼 액션 메뉴"(값 선택 SelectBox와 별개)가 화면마다 제각각 — GNB·SceneSwitcher는 `useDropdown` 훅(위치·바깥클릭·Esc) 사용하나 **createPortal+패널 div 마크업을 매번 반복**, ViewportFloatingToolbar는 `useDropdown`도 안 쓰고 자체 `openMenu` union+rootRef 바깥클릭.
- **공통 컴포넌트 `DropdownMenu`**: `useDropdown` 위에 **createPortal + 패널 컨테이너**를 감싼 컨테이너형(값 목록 아님). props `{trigger, children, placement, panelClassName}`. trigger=render-prop `({open,toggle,close,ref})`, children=자유 콘텐츠 또는 `({close})=>…`. 패널 기본 스타일(`bg-surface border rounded-xs shadow-dropdown`)은 공통, **폭/여백은 `panelClassName`으로 화면별 override**(SelectBox 트리거 className과 같은 철학).
- **적용 — EditorGnb**(Settings·Account): 각 메뉴의 `useDropdown`+createPortal 블록 → `<DropdownMenu placement="right" panelClassName="w-48/w-52 py-1" trigger=…>…</DropdownMenu>`. Account 이메일 로드는 트리거 `onClick`에서 `!open`일 때 호출(기존 open-time 로드 동작 보존). 미사용 `useDropdown`/`createPortal` import 정리.
- **의도적 제외**: **SceneSwitcher**는 `useListNav`(키보드 목록 탐색)+panelRef 스크롤이 얽힌 **값 선택기**라 단순 액션 메뉴 아님 → 옮기면 기능 깨짐(유지). SelectBox/TexturePicker도 값 선택기(유지).
- **ViewportFloatingToolbar는 A안(그대로 유지)로 결정**(사용자): 툴바는 한 파일 자기완결(중복 아님)이고, 옮기면 스냅/정렬 메뉴가 중앙정렬→좌측정렬로 이동하는 **시각적 사이드이펙트** 위험 + 도형 스플릿버튼 앵커 이슈 → 이득 대비 리스크로 미적용. `DropdownMenu`는 향후 새 버튼 메뉴용으로 확보.
- **확인 필요**(브라우저): GNB 우측 Settings/Account 메뉴 — 열림/닫힘/위치(트리거 오른쪽)/바깥클릭·Esc, 테마 토글·Share·도메인·이메일 표시·로그아웃.

---

## ✅ 완료 (2026-07-15) — 🧩 공통 ContextMenu 컴포넌트 추출(중복 제거)

> 신규 `src/components/ui/ContextMenu.tsx` + `HierarchyPanel`·`TimelinePanel` 리팩터. tsc 클린 + `✓ Compiled`. **브라우저 실동작 확인 대기.** (사용자 원칙: 재사용 가능 UI는 공통 컴포넌트로 → [[feedback_extract_reusable_shared_components]])

- **배경**: 컨텍스트(우클릭) 메뉴가 공통이 아니라 `HierarchyPanel`(포인터 위치+뷰포트 클램핑+data-ctx-menu 바깥클릭/Esc/스크롤 닫기)·`TimelinePanel`(포인터 위치+전체화면 백드롭 닫기)에 각각 인라인 중복.
- **공통 컴포넌트 `ContextMenu`**: props `{x, y, onClose, children, className?}`. 담당 = **fixed 배치 + 뷰포트 클램핑(넘치면 좌/상 되접기, useLayoutEffect)** + **바깥 mousedown/스크롤/Esc 닫기(data-ctx-menu 표식으로 내부 클릭 무시, 백드롭 없음 → 다른 대상 우클릭 시 자연 전환)** + 컨테이너 스타일(`bg-surface border rounded-xs shadow z-[101]`). 호출부는 트리거(onContextMenu→좌표 state)와 메뉴 항목(children)만 소유.
- **TimelinePanel**: `<>백드롭+메뉴 div</>` → `<ContextMenu x y onClose className="text-[11px]">…</ContextMenu>`. 덤으로 클램핑·Esc 획득.
- **HierarchyPanel**: HierarchyItem의 menuRef/menuStyle/클램핑 `useLayoutEffect` 제거 + 패널 레벨 바깥클릭 `useEffect` 제거 → `<ContextMenu x={menuPos.x} y={menuPos.y} onClose={onCloseMenu} className="w-44">…</ContextMenu>`. 우클릭 시 selectObject·행 전환 등 트리거 동작은 그대로. 미사용 `useLayoutEffect` import 정리.
- **효과**: 위치·클램핑·닫기 로직 단일화. 앞으로 새 화면의 우클릭 메뉴는 이 컴포넌트만 사용. **확인 필요**(브라우저): 트리 우클릭 메뉴 위치/뷰포트 되접기/다른 행 전환/Esc·바깥클릭 닫기, 타임라인 우클릭 '키 추가'.

---

## ✅ 완료 (2026-07-15) — 🧊 복셀 해상도(cellSize) + 2D 페인터 확대/이동 + 3D 박스 정사각형 (사용자 확인 완료)

> 스키마·`voxelGeometry`·`primitiveGeometry`·`voxelModel`·`sceneStore`·`VoxelToolModal`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").** B안(같은 발판, 고해상도) 채택 — A안(균일 축소)은 오브젝트 Scale/Size와 동일해 가치 낮아 제외. C안(칸 크기 혼용)은 데이터/UI 재설계라 보류.

- **Phase 1 — 셀 해상도(cellSize)**: `PrimitiveGeom.cellSize?`(옵셔널, 미설정=1) 추가 → 한 칸의 로컬 크기(미터). `buildVoxelGeometry(voxels, cellSize=1)`가 BoxGeometry(s)+좌표×s로 촘촘한 복셀 생성. `primitiveGeomKey`에 cellSize 포함, `voxelModel.buildVoxelGlb`도 미러. 스토어 `addVoxelObject(voxels, cellSize?, placeAt?)`/`updateVoxelObject(id, voxels, cellSize?)` — cellSize≠1일 때만 geom에 저장(하위호환). 모달: **해상도 드롭다운(1 기본/0.5칸/0.25칸)** + **그리드 프리셋 48·64 추가**, 재편집 시 cellSize 로드. **핵심 판단**: cellSize는 정수 셀 그리드에 곱만 하므로 페인터 로직 무변경 → 저위험.
- **Phase 2 — 2D 페인터 확대/이동**: **휠=커서 기준 확대**(viewBox 폭 축소+커서 고정, 그리드 밖 클램프) + **Space/가운데버튼 드래그=이동**(좌=칠하기·우=지우기 유지). **칸별 투명 rect 격자(gridN² 개)를 제거**하고 **svg 레벨 핸들러(onSvgDown/Move) + `clientToCell`(clientXY→viewBox 반영→칸 번호 환산)** 로 전환 → 64칸에서도 가볍고 확대/이동과 호환. **함정**: React `onWheel`은 passive라 preventDefault 무효(페이지 스크롤) → **네이티브 `addEventListener('wheel', …, {passive:false})`** effect로 붙임(viewRef로 최신 view 참조). Space는 캡처 keydown/keyup으로 spaceRef+커서 표시.
- **3D 미리보기 박스 정사각형화**: 2D는 `shrink-0`(고정 340) / 3D는 `flex-1`(가변 폭)이라 3D만 가로가 늘어남 → 3D를 **동일한 340×340 div 래퍼**로 통일(패널 폭 720→740). 추가로 **좌측 컬럼 폭도 SIZE(340)로 고정** — 긴 안내 문구(`<p>`)가 shrink-0 컬럼을 박스보다 넓게 늘리던 것 수정(진짜 원인). svg는 width 속성 대신 래퍼 div 안에서 `w-full h-full`.

---

## ✅ 완료 (2026-07-15) — ⌨️ 숫자 입력 화살표 키 증감 + 음수 방지 감사 (사용자 확인 완료)

> 공용 `ui.tsx`(`NumInput`/`XYZRow`) + `TransformSection`. tsc 클린 + `✓ Compiled`(editor 200). **사용자 확인 완료("잘되네").**

- **화살표 키 ↑/↓ 증감**: 공용 `NumInput`(드래그 스크럽 text input)에 `onKeyDown`/`onKeyUp` 추가 → **모든 숫자 입력에 일괄 적용**(Transform·재질·조명·물리·파티클·환경 등, `NumInput`을 쓰는 `LabeledNum`/`XYZRow` 전부). 1회 증감 = 각 필드 **`dragStep`**(드래그 1px과 동일), **Shift=×10 / Alt=÷10**. `clamp`(min/max)·`round`(precision) 재사용. **히스토리는 keyup에 1회 커밋**(`pendingKeyCommit` ref → 홀드 반복=undo 1개). 캐럿 이동/스크롤 막음(preventDefault).
- **음수 입력 방지 감사**: 전체 숫자 입력 감사 → **`LabeledNum` 기반은 이미 전부 `min` 지정**(재질/조명/물리/지오메트리/파티클/환경 — perl로 min 없는 블록 0개 확인)이라 음수 불가. **`XYZRow`만 min 미전달**이던 것 → `XYZRow`에 옵셔널 `min?`/`max?` prop 추가(3축 공통, `NumInput`으로 전달). 적용: **Scale `min={0.001}`**(음수/0=degenerate·뒤집힘 방지)·**Size `min={0.001*uf}`**(단위 환산 하한). Position(X/Z 음수 정상·Y는 `setPos`가 root만 store 클램프)·Rotation·이벤트/배열 오프셋은 음수가 정상이라 미적용. min 클램프는 타이핑·드래그·화살표 모든 경로 일관.

---

## ✅ 완료 (2026-07-15) — 📏 Size(m) 단위 토글 mm/cm/m + 모든 프리미티브 노출 + tsc 에러 2건 수정

> `TransformSection` + 공용 `ui.tsx XYZRow` + 신규 `store/editorPrefsStore.ts`. tsc 클린 + `✓ Compiled`(editor 200). **사용자 확인 완료("잘된다").**

- **선행: tsc 에러 2건 수정**(PROGRESS 기록은 "tsc 클린"이었으나 실제로 남아있던 것): ① `objectPresets.ts` 동전 프리셋 `colliderType:'cylinder'`(ColliderType에 없음) → `'hull'`. ② `MotionSection.tsx` `hasMotion = !!obj.motion && obj.motion.type !== 'none'`(MotionConfig.type에 'none' 없어 오버랩 에러) → `!!obj.motion`.
- **Size 단위 토글**: Transform ▸ Size 라벨 옆 **mm/cm/m 3버튼**(활성=`bg-primary text-white`, 기존 토글 패턴). 클릭 시 input 표시/입력 숫자가 그 단위로 환산(예 0.5m 박스 → m:0.5·cm:50·mm:500). **저장 데이터는 항상 미터/스케일 불변** — 입력값 v(현재 단위)→미터(v/uf)→스케일 역산, 표시=`ls×scale×uf`. `dragStep=0.1×uf`(물리적 드래그량 일정), 소수자리 m=3·cm=1·mm=0.
- **적용 범위(사용자 확정)**: **Size에만** 적용. Position(길이지만 배치 개념)·Rotation(각도)·Scale(배율)은 무변경(차원이 달라 단위 개념 없음). `XYZRow`에 옵셔널 `labelExtra?:ReactNode` prop 추가(라벨 우측 토글 자리) — 다른 행 무영향.
- **Size 노출 확대(사용자 확정)**: 기존엔 로컬 크기≠1 모양(평면·돌출·로프트)에만 표시하고 박스·구체·원기둥은 숨겼으나(size=scale 중복 이유) → **모든 프리미티브에 표시**(단위 토글로 크기 감을 주려면 기본 도형에도 필요). `nonUnit` 게이트 제거.
- **단위 지속성**: 신규 `editorPrefsStore`(zustand persist, `park3d-editor-prefs` localStorage) — 오브젝트 전환·새로고침에도 선택 단위 유지. 씬 데이터 아님(기기/세션 취향). `SIZE_UNIT_FACTOR`/`SIZE_UNITS` export.
- **제약**: 프리미티브 전용(GLB·콘텐츠 제외, 기존과 동일). Position 단위 토글은 미구현(요청 시 별도 토글 추가 가능).

---

## ✅ 완료 (2026-07-15) — 📋 오브젝트 Ctrl+C / Ctrl+V 복사·붙여넣기 (사용자 확인 완료)

> `sceneStore` + `EditorClient`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료.** 기존 Ctrl+D(복제)와 별개.

- **Ctrl+C**: 선택 오브젝트(그룹=하위 계층 포함, 다중 선택 지원)를 클립보드에 스냅샷. 각 선택 '루트'만(자손 중복 방지). **루트는 월드 좌표로 baking**(`computeWorldMatrix`→decompose, `parentId=null`) → 그룹 안 자식을 복사해도 root로 붙일 때 제자리.
- **Ctrl+V**: 새 UUID로 리맵해 **항상 최상위(root)** 에 붙여넣기(+1 x 오프셋, 붙여넣은 것 자동 선택). `dupAnimClips`/`remapPlayClipEvents` 재사용 → 애니 클립·play_clip 이벤트도 복제·리맵. 단일 undo.
- **배선**: 스토어 `clipboard`(transient·세션 유지=씬 넘어 붙여넣기 가능) + `copySelection`/`pasteClipboard`. `EditorClient` 전역 키핸들러에 `Ctrl+C`/`Ctrl+V`(shift 없음 — Ctrl+Shift+C/V=속성 복사와 구분, 입력창에선 무시해 텍스트 복붙 유지). 트리·뷰포트 공통.
- **제약**: 크로스-씬 붙여넣기 시 GLB/텍스처 등 에셋 참조는 대상 씬에 그 에셋이 있어야 표시(assetId만 참조).

---

## ✅ 완료 (2026-07-15) — 🟫 Ground 프리셋 Color/Texture 분리 (사용자 확인 완료)

> `EnvironmentPanel` + `scene.ts` + `GroundPlane`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료.**

- **변경**: Ground 드롭다운에서 기존 "Custom"(텍스처+컬러 혼합) 제거 → **Color**(단색)·**Texture**(이미지) 두 옵션으로 분리. 최종: Grass/Dirt/Sand/Stone/Water/**Color**/**Texture**. Color 선택=컬러 필드만, Texture 선택=업로드 버튼/미리보기만 노출(모드별 하나씩).
- **스키마**: `GroundPreset`에 `'color'|'texture'` 추가(`'custom'`은 레거시 유지). **하위호환**: preset='custom'/미설정 → textureUrl 있으면 Texture, 없으면 Color로 표시(derive). 기존 씬 룩 무변.
- **렌더**: `GroundPlane`이 color=단색 / texture=이미지(없으면 단색 폴백) / custom(레거시)=textureUrl 유무 처리. `TexturedGround` Exclude 타입에 color/texture 추가. 아이콘 Color=Palette·Texture=Image.

---

## ✅ 완료 (2026-07-15) — 🖼️ 텍스처 Mapping 3종 (면마다 / Wrap 구면 / Pattern) (사용자 확인 완료)

> 프리미티브 텍스처 투영 방식 선택. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("만족해").** 여러 차례 시행착오(triplanar bbox정규화→원통→구면) 끝에 **구면 투영**이 정답.

- **목적**: 박스 등에 사진 한 장을 "구에 텍스처 넣은 것처럼 사방을 하나의 그림으로 감싸기". 기존 면별(6면 복제)과 별개 옵션.
- **스키마**: `MaterialOverride.textureMapping?: 'face'|'wrap'|'pattern'` + `triplanarScale?`(pattern용). 옵셔널=기존 씬 무영향.
- **PrimitiveMaterial `onBeforeCompile`**(표준·물리 재질 공통):
  - **face**(기본): 기존 UV(면마다 한 장) + Tile repeat.
  - **wrap**: **구면 투영** — 중심 기준 방향의 경도(atan)=U·위도(asin)=V. 앞=이미지 중앙, 옆=당겨짐, 위/아래=극점. 도형 무관. (원통·bbox정규화 방식은 6면 복제/캡 색칠 문제로 폐기.)
  - **pattern**: triplanar 3축 타일 반복 + Pattern Scale 슬라이더.
  - 값(mode/scale/bbox center·size)은 uniform으로 실시간 갱신(재컴파일 없음). **인스턴스별 고유 `customProgramCacheKey`**로 "일부 오브젝트 uniform 누락" 함정 회피. face↔triplanar 전환 시에만 key로 재마운트.
  - 색공간=GPU sRGB 샘플러 자동 처리(face와 톤 동일).
- **bbox 전달**: EditorObjectInstance·ViewerObject가 `primGeom.boundingBox`(로컬)에서 min/size 계산해 셰이더로 전달(에디터=게시 뷰어 동일).
- **에디터 UI**: MaterialSection 텍스처 블록에 Mapping 드롭다운(3종) + pattern Scale + 모드별 안내. face일 때만 Tile repeat 노출.
- **한계/후속**: wrap은 구면 특성상 뒷면 이음새·극점 모임 존재(구 텍스처와 동일). GLB·텍스트 콘텐츠 제외(프리미티브 전용). 감는 방향/시작위치 옵션은 미구현(요청 시).

---

## ✅ 완료 (2026-07-15) — 🌑 그림자 농도(Shadow Density) 슬라이더 (사용자 확인 완료)

> 씬 전역 태양 그림자 진하기 조절. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").**

- **배경**: 오브젝트별 Cast Shadow는 on/off만 가능(표준 shadow mapping은 오브젝트별 농도 불가). 대신 **씬 전역** `directionalLight.shadow.intensity`(three r185 지원, 0~1)로 그림자 진하기 조절 가능 → 1=진함·0.5=옅음·0=없음.
- **스키마**: `EnvSchema.lights.shadowIntensity?`(옵셔널, 미설정=1 → 기존 씬 룩 무영향). `environment`는 normalize에서 통째 통과라 자동 보존.
- **렌더**: EditorCanvas·ViewerCanvas 태양 directionalLight에 `shadow-intensity={env.lights.shadowIntensity ?? 1}` 배선(에디터=게시 동일). PlayCanvas는 전역 태양 없음(뷰어 조명 사용)이라 무변.
- **UI**: EnvironmentPanel ▸ Lights ▸ **Shadow Density** RangeSlider(0~1, step 0.05) + 툴팁("per-object는 on/off, 이건 씬 전체"). Exposure 아래·Contact Shadows 위 배치.

---

## ✅ 완료 (2026-07-15) — 🐛 Events 폼 편집→추가 전환 시 이전 값 잔존 수정 (사용자 확인 완료)

> `EventsSection.tsx`. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("좋아").**

- **버그**: 기존 이벤트 **편집**(연필) 클릭 → `startEdit`가 폼 전 필드(트리거·액션·값·팝업·조건·로직·else·타이머+editingId)를 채움. 그 상태로 **"이벤트 추가"** 클릭 시 버튼이 `editingId`·`value`만 초기화하고 **트리거·액션·팝업·조건·타이머는 잔존** → 추가 폼이 기본값이 아닌 **직전 편집 이벤트 설정**으로 열림. (`cancelEventForm`도 트리거·액션 초기화 누락이던 동일 결함.)
- **수정**: 전 필드를 신규 기본값(트리거 `click`·액션 `show_popup`·값/팝업/조건/else 비움·타이머 3초·editingId null)으로 되돌리는 **`resetNewEvent()`** 헬퍼 신설 → "이벤트 추가" 버튼과 `cancelEventForm`이 공통 사용.

---

## ✅ 완료 (2026-07-15) — 🧩 Subdivision 패널 UI 개편 (스위치 + 1/2/3 버튼, 사용자 확인 완료)

> `SubdivisionSection.tsx` 재작성 + `InspectorPanel` 호출부 prop 정리. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").**

- **배경**: subdivision 레벨은 Loop subdivision **반복 횟수(정수)**라 소수점 없음(레벨마다 삼각형 4배). max 3은 성능 보호용 소프트 캡(라이브러리 한계 아님). 슬라이더가 과함 → 정수 단계에 맞는 UI로.
- **변경**: 화살표 접기(`open`/`onToggle`) → **헤더 스위치**(Physics 섹션 패턴 = `SectionHeader`(화살표 없음) + `absolute top-3 right-4` Toggle). 스위치 ON=**기본 레벨 1** 자동 지정, OFF=0(원본). 본문은 `RangeSlider` → **1/2/3 버튼 행**(현재 레벨 강조 primary). 호출부 `<SubdivisionSection obj={obj} />`로 단순화(open/onToggle 제거). `RangeSlider` import 제거.

---

## ✅ 완료 (2026-07-15) — 🎨 선택 하이라이트 틴트 제거 + 가이드 색상/토큰 (사용자 확인 완료)

> 에디터 캔버스 색/선택 표현 손질. tsc 클린 + `✓ Compiled`. **사용자 확인 완료.**

- **선택 시 색 틴트 제거(모든 선택 가능 요소)**: 선택하면 오브젝트에 indigo emissive가 입혀져 원래 색을 보려면 해제해야 하던 불편 → **선택 emissive 틴트 전부 제거**, 선택 표시는 **외곽선(와이어박스/box3Helper)만**. 대상: 프리미티브(`EditorObjectInstance` PrimitiveMaterial `emissive={emissive}`)·텍스트 콘텐츠(Text3D)·GLB(`GlbObject` 클론 재질 emissive)·캐릭터 프리뷰(`CharacterPreview`)·이미지/영상 placeholder 평면(선택 violet 채움 → 상시 `#334155`). **주의(과거 함정)**: `replace_all`이 들여쓰기 다른 실제 프리미티브 경로(666줄)를 놓쳐 텍스트 경로만 바뀌었던 적 있음 → 두 번째 패스로 프리미티브도 수정(호버 옅은 글로우는 GLB만 유지).
- **선택 가이드 색상 변경**: 단일 선택/호버 와이어박스(기존 보라 `#7c3aed`/`#a78bfa`, 드래그 마퀴 3D 프리뷰+DOM 사각형 포함, 그룹 1개 박스, 캐릭터 프리뷰) → **`#0D99FF`(파랑)**. 2개 이상 묶음 가이드라인(`EditorCanvas:461` 기존 청록 `#22d3ee`) → **`#ff7a0d`(주황)**.
- **globals.css 포인트/선택 토큰 추가**: `--accent:#0092b8`(포인트 컬러 사이언, 이전 세션) + `--select:#0D99FF`·`--select-multi:#ff7a0d`(이번). Light/Dark 공통 + `@theme inline`에 `--color-accent`/`--color-select`/`--color-select-multi` 매핑(→ `bg-accent`·`text-select` 등). **3D 캔버스는 Three.js라 hex 리터럴 하드코딩(토큰 자동연동 X)** — 토큰은 나중 DOM/Tailwind UI용. (후속 후보: 색 공용 상수 파일로 뽑아 캔버스가 import하도록 통합.)
- **안 건드린 것**: `#a78bfa` 오브젝트 기본 색상 폴백(가이드 아님, 실제 오브젝트/컬러픽커 기본색)·펜툴 모달 2D 그리기 보라선(별개 도구 UI).
- **선택 와이어박스 면 대각선 제거(2026-07-15, 사용자 확인 완료)**: `boxGeometry`/`planeGeometry` + `wireframe`은 각 면이 삼각형 2개라 **면을 가로지르는 대각선(삼각형 경계)**이 보였음 → **`EdgesGeometry`(실제 모서리만)로 교체**. 신규 헬퍼 `EdgeBox`(박스 12모서리)·`EdgePlane`(평면 4변) — 지오메트리 useMemo + dispose. 적용: 프리미티브 선택/호버 박스·이미지/영상 콘텐츠 박스. GLB(`box3Helper`)·2+묶음/드래그 마퀴는 이미 모서리/선분이라 무변. **유지(의도)**: 파티클/라이트 선택 **구**(sphere wireframe — Edges로 바꾸면 hard edge 없어 선이 사라져 표식 소멸)·라이트 spot **콘**(방향 표식, 선택 박스 아님).

---

## ✅ 완료 (2026-07-15) — 🧊 복셀 툴 개선 3종 (사용자 확인 완료)

> `VoxelToolModal.tsx` 단독 변경. tsc 클린 + `✓ Compiled`. **사용자 브라우저 확인 완료("잘된다").**

- **① Ctrl+Z가 에디터 undo로 새던 문제 수정**: 모달은 Escape만 캡처하고 Ctrl+Z는 window **버블 단계**의 `EditorClient` 전역 핸들러(undo)로 흘러갔음. → 모달 전용 **로컬 undo/redo 히스토리**(`undoRef`/`redoRef`, 최근 200단계, `voxelsRef` 미러로 스냅샷) + 키다운을 **캡처 단계**에서 처리해 `Ctrl+Z`·`Ctrl+Shift+Z`/`Ctrl+Y`를 `stopImmediatePropagation`으로 가로챔(에디터로 전파 차단). 한 획(드래그)=1단계, shift직선/아래복사/전체채색/전체지우기/그리드변경도 각각 되돌림 대상. 모달 열 때 스택 초기화.
- **② Shift+클릭 직선 일괄 채우기**: 마지막 찍은 칸(`lastCellRef`) 기억 → shift+클릭 시 두 칸 사이 **직선 경로(Bresenham `lineCells`)** 를 한 번의 `setVoxels`로 일괄 채움(`applyCells`). 좌클릭=칠하기/우클릭=지우기 직선. 레이어(높이 Y) 전환·undo 시 기준점 리셋(다른 평면 오작동 방지).
- **③ 생성 후 색상 변경**: 툴바 **"전체 채색" 버튼** 추가 — 배치된 모든 칸을 현재 선택 색으로 일괄 재채색(다시 만들 필요 없음). 참고: 새 색 선택 후 **기존 칸 클릭 = 그 칸만 재채색**은 원래 동작(칠하기가 덮어씀). 재편집은 오브젝트 리스트 우클릭 "복셀 수정"으로 진입.
- **④ Inspector Material Color 복셀 안내 처리(2026-07-15, 사용자 확인 완료)**: 복셀은 정점색이 지오메트리에 구워지고 `vertexColors=true`면 베이스색을 흰색 강제 → Inspector 색상 피커가 무의미. **틴트/재빌드 대신 오해 제거 방식 채택**(사용자 결정): `MaterialSection`에서 `obj.primitiveShape==='voxel'`이면 Color 스와치(#fff)+hex 텍스트 레이아웃은 **유지하되 disabled**(반투명)+**툴팁**("색은 '복셀 수정'에서 변경") + **"복셀 수정 열기 →" 버튼**(`openVoxelEdit`). Emissive·거칠기·금속성 등 복셀에도 유효한 건 그대로. 색 변경 경로 = 모달의 "전체 채색"/칸별 재클릭.

---

## ✅ 완료 (2026-07-15) — 🧭 접이식 섹션 펼칠 때 자동 스크롤 (사용자 확인 완료)

> `inspector/ui.tsx`의 공용 `SectionHeader` 단독 변경 → Inspector·Environment·Logic 등 **모든 접이식 섹션에 일괄 적용**. tsc 클린 + `✓ Compiled`. **사용자 확인 완료("잘된다").**

- **문제**: 스크롤 컨테이너 아래쪽의 접힌 섹션을 펼치면 본문이 컨테이너 밖(아래)에 렌더돼 안 보이고, 사용자가 직접 스크롤해야 보였음.
- **수정**: `SectionHeader`에 `rootRef`+`prevOpen` ref로 **닫힘→열림 전환 감지** → 스크롤 가능한 조상(`overflow-y auto/scroll` && `scrollHeight>clientHeight`)을 찾아 `requestAnimationFrame`(본문 렌더 후) 시점에 섹션을 드러냄: **섹션이 컨테이너에 다 들어가면** 끝까지 보이게(헤더 유지), **컨테이너보다 크면** 헤더를 상단에 붙여 그만큼만(`Math.min(alignBottom, alignHeaderTop)`) `scrollBy({behavior:'smooth'})`. 이미 다 보이면 무동작, 마운트 시 기본 열린 섹션도 무동작(사용자 조작 전환만).

---

## ✅ 완료 (2026-07-15) — 🎬 타임라인 ② per-트랙 독립 타이밍 (기준: `doc/ANIMATION.md`)

> 접속 끊겨 중단됐던 작업 재개·완료. **사용자 브라우저 확인 완료("잘된거 같아").** tsc 클린(새 에러 0). 상세 = ANIMATION.md.

- **목적**: 타임라인 키 추가/이동/삭제/오토키가 **정렬 포즈(모든 트랙 공유 시간)가 아니라 '그 트랙 하나'에만** 작용 → 트랙마다 키를 서로 다른 시간에 자유 배치(진짜 트랙별 타이밍).
- **스토어**(`sceneStore.ts`): transient `keySel:{clipId,objectId,idx}` + 액션 `goToKey`/`clearKeySel`/`addKeyToTrack`/`retimeKey`(이웃 클램프·지연 커밋)/`removeKey`(트랙 최소 1키 유지). **오토키 확장**: `autoKeyPose(poseEdit, keySel, …)` — keySel 있으면 그 트랙의 그 키만 갱신, 없으면 기존 poseEdit 정렬포즈 폴백. `updateObject`/`commitTransforms`가 keySel 전달. goToPose/setPoseEdit는 keySel 해제(모드 배타).
- **TimelinePanel.tsx**: `poseTimes`/`curPoseIdx`(공유 시간축) 제거 → `keySel`/`selTrack`/`selKey`/`totalKeys`/`targetObjId` 기반. **중단 지점이던 렌더 JSX**(눈금자/레인 우클릭·트랙 행·키 렌더·컨텍스트 메뉴)를 새 시그니처로 마무리: 우클릭 대상=행별 `onCtx(e,objectId)`(눈금자는 `targetObjId`=선택 트랙||root), `beginKey(e,objectId,idx)`, 키 하이라이트=keySel 매칭, 키 클릭=goToKey+selectObject, 컨텍스트 메뉴=`addKeyToTrack`. 죽은 코드(`snap`/`eqV`) 정리.
- **간단 모드 무영향**: poseEdit/goToPose/setPoseEdit는 스토어에 그대로 유지(`AnimationClipSection` 계속 사용). 런타임(`sampleTrack`)은 트랙별 키를 이미 독립 샘플 → 변경 불필요.
- **남음(선택)**: 격리 편집모드 · P5 다듬기(회전 최단경로·커스텀 피벗·GLB 통일).

---

## ✅ 완료 (2026-07-14) — 🎬 애니메이션 저작 Phase 1 (기준: `doc/ANIMATION.md`)

> 사용자가 임의 애니를 직접 저작(포즈/키프레임) → 하나의 재사용 오브젝트. **포즈=키프레임의 부분집합**이라 처음부터 키프레임 데이터로 설계(나중 타임라인은 얹기만). tsc 클린 + editor 307. **브라우저 실동작 대기.** 상세 = ANIMATION.md.

- **전부 추가형·옵셔널(사이드이펙트 0)**: 기존 motion/move_object/animate_object·이벤트·렌더경로 무변경. 런타임은 활성 클립 있을 때만 동작.
- **스키마**: `AnimClip{tracks:AnimTrack[], duration, loop, easing, rootId}`·`AnimKeyframe{time,position?,rotation?,scale?}` + `scene.animClips?` + 이벤트 액션 `play_clip`.
- **스토어**: animClips CRUD + persist/undo/load (sceneEvents 패턴).
- **런타임**(ViewerClient): `sampleTrack`(N키 보간), `clipOverride`+rAF `tickClips`, `play_clip` 핸들러, effectiveScene에 적용(pos/rot/scale 비파괴, override 패턴 재사용 → 그룹 자식도 자동). restartGame 초기화.
- **에디터**: 신규 `AnimationClipSection`(인스펙터 Animation) — 클립 생성·**포즈 추가(현재 트랜스폼 캡처, 그룹이면 자식 함께)**·포즈 목록/삭제·시작포즈 복귀·길이/이징/loop. EventsSection `play_clip` 액션(클립 선택).
- **저작 흐름**: 오브젝트 옮김 → 포즈 추가 반복 → Events `트리거→애니 재생(play_clip)` → ▶플레이/뷰어 재생.
- **다음(ANIMATION.md 로드맵)**: Phase 2 다중오브젝트/격리 편집모드·계층 동기 · Phase 3 타임라인 UI·모드토글 · Phase 4 다듬기(회전 최단경로·에디터 미리보기·Prefab 통합).

---

## ✅ 완료 (2026-07-14) — 🎮 변수 고도화 Phase A+B + 게임 컨트롤러 Phase 1 (기준: `doc/GAME_LOGIC.md`)

> tsc 클린 + dev 컴파일(editor 307). **브라우저 실동작 확인 대기.** 상세·체크리스트는 GAME_LOGIC.md.

- **변수 타입 확장(Phase A)**: `GameVariable.type`에 **string·enum·color** 추가(기존 number/boolean). enum은 `options[]`(상태 목록)+초기값 선택, color=컬러픽커, string=텍스트. `EventCondition.op`에 `contains`, value에 string. 스토어 `updateVariable` 타입변경 initial 보정. 에디터 EnvironmentPanel 변수 카드 타입별 입력 + enum 선택지 편집. EventsSection set_variable/조건 입력 타입별(숫자값=“값 또는 변수명” 텍스트).
- **연산 강화(Phase B)**: `applyVarOp`에 div·mod·**clamp(범위제한)** + **변수↔변수 연산**(`resolveNum`이 리터럴 또는 변수명 해석 → `score add coins`). enum `next`(다음 상태 순환)·string append. `evalCondition` ==/!= String 정규화 + contains.
- **게임 컨트롤러 Phase 1(전역 로직 홀더)**: 오브젝트에 안 매달린 **씬 전역 규칙**. `ProjectSceneSchema.sceneEvents?: EventSchema[]`(재사용). 스토어 `sceneEvents`+CRUD(withHistory)+loadScene/persist/undo. 런타임 `ViewerClient`가 합성 `sceneControllerObj`로 scene_start·on_timer·variable_changed 3패스에 sceneEvents 순회 추가(기존 runEventAction 재사용). 신규 에디터 **`SceneLogicSection.tsx`**(Environment 패널, 기본 접힘 `gamelogic`) — 트리거 3종+조건(타입인지)+액션 subset(set_variable·승패·팝업·오브젝트 표시/통과). 목적: `score>=3 → gateOpen` 같은 **공유 규칙을 한 곳에**.
- **변수 Phase C (asset 모델 변수 + swap_model)**: `GameVariable.type`에 `'asset'`(값=에셋 id). 액션 `swap_model`(value=`"대상id|소스"`, 소스 `@변수` 또는 에셋 id) → 런타임 `modelOverride`가 effectiveScene에서 assetId 교체. **`@변수` 간접지정 첫 도입**(오브젝트 참조 변수의 토대). 에디터: 변수 카드 asset=모델 드롭다운, EventsSection swap_model=대상+소스 2단.
- **변수 Phase D (timer)**: `type:'timer'`(number 기반) — 런타임 1초 카운트다운(0 정지, 게임오버 시 멈춤), `timer<=0 → game_lose` 등 워처로. 에디터: 초 입력, 조건/연산은 number 취급.
- **변수 Phase E (scope/지속성)**: `GameVariable.scope: scene|global|persistent`. global=sessionStorage(씬 이동 유지)·persistent=localStorage(최고점수·이어하기), 키 `p3v:{projectId}:{name}`. init 저장값 우선, onVarsChanged 저장, restart는 scene+global 리셋·persistent 유지. 에디터 변수 카드 '유지 범위' 드롭다운.
- **게임 컨트롤러 Phase 2**: **GNB 'Logic' 전용 탭** 신설(EditorGnb Cpu 버튼 → LeftPanel이 신규 `panels/LogicPanel` 렌더 = 게임변수+전역규칙+HUD 한 곳). EnvironmentPanel에서 게임 로직 3블록 제거(추출: `GameVariablesSection`·`HudSection`·기존 `SceneLogicSection`) → 로직은 Logic 탭이 단일 홈. SceneLogicSection 액션에 swap_model·play_sound·spawn_object 추가.
- **spawn `@변수`**: `spawn_object` value 3번째 세그먼트 `|모델소스`(@변수/에셋)로 스폰 클론 모델 교체.
- **하위호환**: 전부 옵셔널 추가(normalize 통과). 기존 씬·이벤트 무변경.
- **남은 로드맵(선택)**: EventsSection 폼 완전 일반화(현재 SceneLogicSection 자체완결로 대체됨) · 컨트롤러 나머지 액션(go_to_scene/move/focus). **변수 A~E·게임 컨트롤러 Phase 1~2 전부 완료.**

---

## ✅ 완료 (2026-07-14) — 복셀 B안(편집형 오브젝트) + 펜툴 Ctrl+클릭 + 컨텍스트 메뉴 전환

> **사용자 브라우저 확인 완료("잘된다").**

- **복셀 B안 — GLB bake 폐기, live 편집형 프리미티브**:
  - **`primitiveShape: 'voxel'` + `geom.voxels`** 로 만들어 프리미티브 파이프라인(에디터/뷰어 렌더·bbox·subdivision·물리) 상속. **Models 탭 안 거치고 오브젝트 리스트에만** 나옴(에셋 아님). 우클릭 "복셀 수정"으로 재편집.
  - 신규 `src/lib/voxelGeometry.ts`: `buildVoxelGeometry`(복셀→정점색 BufferGeometry, X/Z중심·바닥0)·`voxelSig`(정수 해시, 재편집 변경 감지). `voxelModel.ts`(GLB 굽기)도 이걸 재사용(내보내기 등 후속용 유지).
  - `createPrimitiveGeometry`에 `'voxel'` case. `primitiveGeomKey`·에디터/뷰어 primGeom 메모 의존성에 `voxelSig` 추가. `PrimitiveMaterial`에 **`vertexColors`** prop(복셀 정점색, 베이스 흰색) — 에디터/뷰어 배선. `InstancedPrimitives`에서 복셀 제외. `SHAPE_NAMES`에 '복셀'.
  - 스토어: `addVoxelObject`(assetId 없는 live, 바닥 y=0)·`updateVoxelObject`·`voxelEditId`·`openVoxelEdit`. `VoxelToolModal` = bake/업로드 제거, 열 때 저장된 복셀 로드(그리드 크기 좌표로 추정), 타이틀/버튼 수정모드.
  - 한계: 재편집 그리드 크기 추정 · 물리 콜라이더는 프리미티브 기본(거침) · subdivision 시 정점색 보존 미검증(기본 0) · 지난 GLB 복셀은 그대로.
- **펜툴 Ctrl+클릭 = 점 추가**: `onSvgDown`에 Ctrl(⌘)+클릭 분기 → 가장 가까운 변에 점 삽입. **닫힌 경로(재편집 도형)에도** 점 추가 가능(기존엔 막힘). `distToSeg` 헬퍼.
- **🐛 계층 컨텍스트 메뉴 전환**: 각 행 로컬 `menuOpen`+전체화면 백드롭 → 다른 행 우클릭이 백드롭에 막혀 네이티브 메뉴가 뜨던 문제. **패널 레벨 단일 `openMenuId` + 백드롭 제거**(mousedown/scroll/Esc 문서 리스너로 바깥클릭 닫기, 메뉴 내부는 `data-ctx-menu`로 무시). 이제 A 열린 채 B 우클릭 → A 닫히고 B 메뉴 즉시 전환.
- **계층 컨텍스트 메뉴 마우스 포인터 위치 (2026-07-14, 사용자 "잘된다" 확인)**: 행 기준 `absolute left-2 top-full` 고정 → 우클릭 `clientX/Y` 저장 후 `position:fixed`로 **포인터 오른쪽**에 표시. 뷰포트 클램핑(오른쪽 넘치면 왼쪽 뒤집기·아래 넘치면 위로, `useLayoutEffect`로 렌더 후 크기 재 보정=깜빡임 없음). 패널 레벨 `menuPos` state 추가, ItemProps에 `menuPos`+`onOpenMenu(x,y)`.

---

## ✅ 완료 (2026-07-14) — 펜툴 오브젝트 재편집 + 계층 아이콘(펜툴/복셀)

> **사용자 브라우저 확인 완료.** 만든 오브젝트를 되돌아가 고치는 첫 걸음. 복셀은 B안(편집형) 예정 — 이번엔 식별 표식만.

- **펜툴 재편집(돌출/회전체)** — 오브젝트 리스트 **우클릭 → "펜툴로 수정"**(뷰포트 클릭 아님):
  - `HierarchyPanel` 컨텍스트 메뉴에 항목 추가(extrude/lathe만). `sceneStore.openPenToolEdit(id)` → `penToolEditId` 세팅 + 모달 오픈.
  - `PenToolModal`: 열 때 `penToolEditId`면 저장된 프로파일 로드(모델→SVG 역변환 `CENTER + x*SCALE` / `CENTER - y*SCALE`), 모드/두께/닫힘/스무딩 복원. "수정 적용" → `updateProfileObject`(기존 오브젝트 geom 교체, primitiveShape도 갱신=모드전환 반영, undo 1회). 타이틀·버튼 라벨 수정모드 반영.
  - **재편집 충실도**: `PrimitiveGeom.profileRaw`(스무딩 전 원본 점)+`profileSmooth` 추가 저장 → 곡선으로 만든 것도 컨트롤 점으로 재편집. `profile`(스무딩 반영)은 지오메트리용 그대로.
  - **🐛 핵심 버그 수정**: `primGeom` useMemo 의존성이 `profile?.length`(개수)만 봐서 **점만 옮기면 지오메트리 재생성 안 되던** 문제 → `profileSig(object.geom)`+`profileClosed`로 교체. `profileSig`도 첫/끝점만→**전체 점** 직렬화로 강화(`primitiveGeometry.ts`). 이제 중간 점만 옮겨도 형태 갱신.
  - 아이콘: extrude/lathe → `PenTool`(SHAPE_ICONS).
- **복셀 계층 아이콘** — 복셀 오브젝트에 **`ObjectNodeSchema.voxels`(복셀 레시피) 저장**(`addAssetObject`에 `extra` 파라미터 추가 → `VoxelToolModal`이 전달). `HierarchyPanel.getIcon`이 `obj.voxels`면 `Boxes` 아이콘(assetId보다 먼저 체크). **이 레시피 저장이 복셀 B안(편집형 렌더+재편집) 재편집의 기반**. 현재는 여전히 GLB로 구움.
- 스키마 무해 추가(전부 옵셔널, normalizeSceneData·buildSceneData가 objects 그대로 통과 → 자동 보존). 한계: 이번 변경 **이전** 생성물엔 profileRaw/voxels 없음(펜툴은 profile 폴백, 복셀 아이콘은 안 뜸) — 새로 만드는 것부터 적용.

### ⏭️ 다음 후보 (사용자와 논의 중)
- **복셀 B안** — 복셀을 프리미티브형 편집 오브젝트로(GLB bake 대신 live 렌더 + 모달 재오픈 재편집). subdivision·재질 등 프리미티브 도구 상속 가능(정점색 보존·성능·색충돌 주의). Models 탭 대신 오브젝트 리스트에만.
- **메쉬 편집(half-edge Edit Mode)** — 숙제로 보류(스코프 아웃 검토 완료, `이것좀 검토` 결론).
- 그 외: 게임 저작 접근성(문장형 이벤트 2단계·GNB 탭), 에디터 UX(Undo/Redo 툴바·오토세이브 결정), 게임 완성도(세이브/로드·리더보드), 미검증 항목 정리.

---

## ✅ 완료 (2026-07-13) — 라이트 방향/길이 기즈모 + 그림자·색 기본값 + AssetBrowser 3단

> 이 세션 작업. **라이트 방향 기즈모는 사용자 브라우저 확인 완료("잘된다")**, 나머지는 tsc/컴파일 클린(실동작 확인 권장).

- **🔦 라이트 방향/길이 드래그 기즈모** (`EditorObjectInstance.tsx` `LightObjectInstance` — spot/directional):
  - **빔 방향 = 라이트 로컬 -Y를 object.rotation으로 회전**. 실제 three 라이트에 **`target`(로컬 -Y)** 을 붙여 emission이 회전을 따라감("후레쉬 위로 하면 빛도 위로"). 뷰어(`ViewerCanvas` `SceneLight`)·플레이(`PlayCanvas` `PlaySceneLight`)도 동일 target 방식으로 통일(편집=게시 룩 일치).
  - **끝 핸들(원+화살촉) 드래그 = 방향 + 길이 동시 조절**: 카메라 평면에 광선 투영한 3D 지점으로 방향(rotation)과 길이(=`light.distance`) 산출. **min=라이트, max=바닥**(`hit.y≥0` 클램프). dash가 실시간으로 늘었다 줄었다.
  - **실시간성 2종**: ①핸들 드래그 중 `liveTransformStore`에 회전 게시(Inspector 수치 실시간)+그룹 quaternion 즉시. ②**메인 기즈모로 라이트를 옮길 때도 `liveTransformStore` 구독**으로 dash가 실시간 따라옴(예전엔 놓을 때 "딱" 붙던 것 해결). 드래그는 window 리스너+카메라 레이캐스트(커서가 핸들 벗어나도 안정).
  - **visible=false면 dash·핸들 통째로 사라짐**(`object.visible` 게이트). point 라이트는 방향 없음 → 위치/높이용 수직 드롭라인만.
  - 커밋: 놓을 때 `updateObject({rotation, light:{...distance}})`+`pushHistory`(undo 1회).
  - ⚠️ **동작 변경**: 기존 spot/directional은 원점을 향해 비췄으나 이제 회전 기준(기본 아래). 회전 0인 기존 라이트는 곧바로 아래로.
- **🌞 전역 태양 방향 화살표**(`EditorCanvas.tsx` `SunDirectionGizmo`): `env.lights.directionalPosition` 방향으로 노랑 구+화살표(광선=원점 방향). `depthTest=false`+`renderOrder=999`로 바닥에 안 가림. 읽기전용·에디터 전용.
- **오브젝트 그림자 기본값 false**: `render.castShadow`/`receiveShadow` 기본 `?? true`→`?? false` (에디터 `EditorObjectInstance`·뷰어 `ViewerObject`·Inspector `VisibilitySection` def 3곳). 새 프리미티브는 기본적으로 그림자 안 만들고 안 받음.
- **프리미티브 기본 색 흰색**: `sceneStore.makeObject` `#00a4eb`→`#ffffff`.
- **호버 시 원래 색 유지**: `EditorObjectInstance` 프리미티브·텍스트의 **hover emissive 틴트 제거**(가이드 와이어박스는 유지). 선택 하이라이트는 유지.
- **AssetBrowser 아이템 그리드 2단→3단**: 전 탭 `grid-cols-2`→`grid-cols-3`(8곳).

---

## ✅ 완료 (2026-07-13) — 전역 태양 방향 화살표 (읽기 전용 표식)

> **다른 PC에서 이어작업 시 참고.** 이 세션에서 구현 완료. `EditorCanvas.tsx` 단독 변경(스키마·스토어·뷰어 무변경).

- **구현**: `EditorCanvas.tsx`에 **`SunDirectionGizmo`** 컴포넌트 신설(`SpawnMarker` 아래). Canvas 내부 `GizmoController` 앞에 `<SunDirectionGizmo position={environment.lights.directionalPosition} />` 렌더 — **에디터 전용**(뷰어/플레이 미표시).
  - `dir = normalize(directionalPosition)`(0벡터면 (0,1,0) 폴백) → 노랑 구(`#facc15` `meshBasicMaterial`, 반경 0.5)를 `dir × R`(R=10)에 배치 = 태양 위치.
  - 그 구에서 **원점 방향(광선 방향, `-dir`)으로 화살표**: 실린더 샤프트(길이 2.4)+끝 cone. 로컬 +Y축을 `rayDir`로 돌리는 quaternion `setFromUnitVectors((0,1,0), rayDir)`. 전부 `depthWrite={false}`.
  - Sun Position 값(props)에 `useMemo` 의존 → 슬라이더 돌리면 **실시간 회전**. 읽기 전용(클릭/기즈모 없음).
- **하지 않은 것(의도적)**: 전역 directionalLight/Sky는 **읽기만** 하고 무변경(지난 삽질 교훈 준수). 라이트 오브젝트도 무관하게 유지.
- **검증**: 진단 클린 + dev `✓ Compiled` + 에디터 라우트 200(로그인 세션 렌더). **브라우저 실동작(Sun Position XYZ 바꿀 때 화살표 따라 도는지) 확인 대기.**
- **후속(선택, 미착수)**: 화살표 드래그로 태양 방향 직접 조절(기즈모 상호작용) · 뷰어에도 표시 토글.

---

## 🎯 다음 작업 후보 (2026-07-12 기준 — 다른 PC에서 이어서)

> 오늘까지: 게임 로직 Phase 1~3 완료, 인스펙터 리팩터 완료(3855→277줄). 아래 둘 중 골라 진행. **상세 스펙은 각 기준 문서에 있음.**

1. **UI 디자인 리뉴얼** → 기준 문서 **`doc/UI_REDESIGN.md`** (진단·벤치마킹·**토큰 before→after 값**·4단계 계획). 사용자 결정 대기: 액센트 색(바이올렛 추천)·다크/라이트. 정해지면 `globals.css` 토큰 교체(Step 1)부터 바로 착수 가능.
2. **P0 UX 5종** (검토 리포트): ①오토세이브 재활성(`ViewportToolbar` 주석 해제, 낙관적잠금 이미 있음) ②인에디터 플레이 토글(▶︎, 뷰어 로직 재사용) ③게임/로직 GNB 탭(변수·HUD 발견성) ④Undo/Redo 툴바 노출 ⑤인스펙터 기본/고급 분리(= UI리뉴얼 Step 3과 동일 작업).
   - **UI리뉴얼 Step 3 ≡ P0 ⑤** 이라 병행 권장. 게임 로직 후속(랜덤 완료; 세이브/로드·리더보드·노드에디터는 GAME_LOGIC.md)도 선택지.

## 🎨 진행 중 (2026-07-13) — UI 디자인 리뉴얼 (기준: `doc/UI_REDESIGN.md`)

> **확정(사용자)**: ①액센트=**바이올렛**(`--primary` light `#6A4DFF`/dark `#7C6CFF`) ②**다크 우선**(themeStore 이미 기본) ③레이아웃=**떠있는 패널**(Figma/Spline — 도킹 컬럼 폐기, 캔버스 풀블리드+유리 패널) ④**모든 UI 타이틀 영문화**. 실렌더 비주얼 설계서(아티팩트) 있음.

- **STEP 1 — 토큰 교체 ✅ 완료**: `src/app/globals.css`. 중립색 slate→바이올렛-편향(light/dark), `--primary` 파랑→바이올렛, radius↑(`xs 6→8·sm 8→10·md 12→14·lg 16→18·xl 20→22`, Tailwind v4 `--radius-*`라 `rounded-xs` 전역 즉시 반영), 떠있는 패널용 `--glass`(light `rgba(255,255,255,.80)`/dark `rgba(22,20,30,.82)`)+`@theme inline`에 `--color-glass`+`--shadow-float` 추가. 검증: dev 컴파일 200(editor/login/dashboard) `✓ Compiled`. **브라우저 색감/radius 체감 확인 대기.**
- **STEP 2 — 떠있는 패널 ✅ 완료 (2026-07-13)**: `EditorClient` 그리드→**캔버스 풀블리드(absolute inset-0) + 유리 패널 absolute floating**. 공용 shell `rounded-lg bg-glass backdrop-blur-xl border-border/60 shadow-float`. 배치: Top bar `top-3 left-3 right-3 h-11`, Rail `left-3 w-12`, 좌패널 `left-[68px] w-60`, Inspector `right-3 w-72`(전부 `top-[64px] bottom-3`). **핵심 트릭**: 뷰포트 오버레이(FloatingToolbar/OrientationGizmo/StatusBar)를 **'자유 캔버스' 사각형 인셋 컨테이너**(top-[60]·bottom-3·left=leftOpen?316:68·right=308)로 감싸 기존 top-3/right-3/bottom-3 좌표 무수정으로 패널 충돌 회피(기즈모 top-3 right-3가 인스펙터와 겹치던 문제 해결). 좌패널 토글 핸들도 패널 모서리로 이동. **패널 투명화**: ViewportToolbar(header)·EditorGnb(root `w-full`)·LeftPanel·InspectorPanel(aside 2곳)·MultiSelectPanel의 `bg-surface/bg-sidebar border-*` 제거 → 유리가 비침. **영문화**: 상단바(Save/Preview/Version history/Back to dashboard/Unsaved changes…), GNB(Settings/Account 메뉴 전체). 검증: dev `✓ Compiled`+editor 200(브라우저 렌더 중)+편집 파일 진단 클린. **브라우저 실동작(유리 blur·오버레이 비충돌·토글) 확인 대기.**
- **STEP 2 후속(2026-07-13)**: 떠있는 패널 `bg-glass`+blur → **`bg-surface` 불투명**으로 교체(ViewportFloatingToolbar와 톤 일치, glass 탁함 제거). `--glass` 토큰은 미사용으로 잔존(무해).
- **STEP 3 — 점진적 공개 ✅ 완료(2026-07-13)**: 인스펙터 고급 섹션 기본 접힘 + 상태점. `SectionHeader`에 `dot` prop 추가(접힘+값 있음 → 액센트 점, collapsible 헤더에 `cursor-pointer`/hover). 기본 접힘 셋 = `array·subdivision·particle·physics·motion·events·animation`(펼침 유지 = transform·material·content·geometry·visibility·light). 항상 펼쳐지던 **Motion·Subdivision을 접기 가능하게**(open/onToggle+본문 `{open&&}` 래핑). dot 판정: physics=`enabled`·motion=`type!==none`·events=`events.length>0||dialogue`·subdivision=`subdivisions>0`·animation=`defaultClip`·particle=존재. 검증: 전 파일 진단 클린 + dev `✓ Compiled`. **브라우저 실동작(접힘·점·펼치기) 확인 대기.** 한계: 접힘 상태는 오브젝트 전환 시 리셋(InspectorInner가 selectedId key로 remount) — 오브젝트별 접힘 기억은 후속.
- **STEP 4 — 시그니처 모먼트 (진행 중)**: ✅ **빈 상태 코칭** 완료 — `panels/EditorEmptyState.tsx`(신규). `objects.length===0`이면 뷰포트 중앙에 카드(상자/구체/원기둥 즉시추가 `addObject` + 툴바·Ctrl+K 안내), 오브젝트 생기면 자체 숨김(objects 길이만 select). `EditorClient`가 캔버스 위 z-10에 렌더. 진단 클린+`✓ Compiled`. **브라우저 확인 대기.**
  - ✅ **오브젝트 프리셋(바퀴/문/동전) 완료(2026-07-13)**: **설계 합의** — 프리셋 = 플랫폼이 미리 만든 "완성형 재료"를 **스탬프로 찍어냄**(찍는 순간 링크 끊긴 평범한 오브젝트, 새 런타임 아님). 재사용·일괄수정은 **기존 Prefab**에 맡김(프리셋≠프리팹, 릴레이 관계). 신규 `src/lib/objectPresets.ts`(OBJECT_PRESETS·PRESET_SELF 센티넬) — 바퀴=cylinder 눕힘+motion spin(구름) / 문=box 솔리드+`interact→set_passable` / 동전=cylinder 세움+spin+sensor+`area_enter→set_variable score+1·hide_object`. 스토어 `addPreset(id, placeAt?)`(makeBaseObject 기반, `@self`→생성 id 치환, 동전은 'score' 변수 없으면 자동 생성, undo에 variables 스냅샷). 배선: 빈 상태 카드 '게임 재료' 행 + 툴바 ✨ 프리셋 드롭다운. 기존 motion/events/변수/물리 재사용이라 저리스크. 진단 클린+`✓ Compiled`. **브라우저 실동작(굴림·E 통과·점수+숨김) 확인 대기.**
  - ✅ **문장형 이벤트 UI — 1단계(목록 표시) 완료(2026-07-13)**: `EventsSection`의 이벤트 **리스트 렌더만** 문장 카드로 교체(추가/편집 폼 `renderEventForm`·핸들러·데이터·미리보기/수정/삭제 버튼 전부 무변경 = 저위험). 각 이벤트를 **"When ⟨트리거 pill⟩ → ⟨액션 pill⟩ 값요약"** + 조건 있으면 "**단, {변수 op 값} 일 때만**"(AND/OR·레거시 단일 지원) + else 있으면 "**아니면 → …**" 꼬리로 렌더. valueSummary는 기존 씬/오브젝트/오프셋 요약 로직 재사용. 진단 클린+`✓ Compiled`. **브라우저 확인 대기.** 2단계(추가·편집까지 인라인 pill)는 후속.
  - ✅ **인에디터 ▶ 플레이 토글 완료(2026-07-13, MVP)**: 상단바 **▶ 플레이** 버튼 → 편집 중 씬을 **뷰어 스택(`ViewerClient`)으로 전체 오버레이 구동**(걷기/게임 테스트), **■ 편집으로** 버튼(top-center)으로 종료. 배선: `saveScene.ts`에 **`buildSceneData()` 추출**(스토어 상태→ProjectSceneSchema, DB 저장 없이 뷰어에 전달 — persist와 공유). 스토어 `editorPlaying`+`setEditorPlaying`. `EditorClient`가 `editorPlaying`이면 `absolute inset-0 z-50`에 `<ViewerClient scene={playScene} isOwner hideBadge>`(dynamic import) 렌더 — playScene은 플레이 시작 시점 스냅샷(useMemo, `defaultMode:'play'` 강제). **중요 안전장치**: 플레이 중 전역 keydown 핸들러 early-return(삭제·변환·undo 등 에디터 단축키가 뷰어 입력에 발동 안 되게). **standalone variant 사용**(embed는 show_popup을 부모로 postMessage해 팝업이 안 뜸 → standalone이라야 팝업 자체 렌더). EditorCanvas는 오버레이(opaque) 뒤에 마운트 유지(복귀 시 카메라 보존, perf는 캔버스 2개지만 MVP 허용). 진단 클린+`✓ Compiled`. **브라우저 실동작 확인 필수(구조 큰 기능)** — ▶로 걷기·프리셋(문 E/동전 점수) 동작·팝업·HUD·■ 복귀. 알려진 한계: 저장 안 함(스냅샷만)·플레이 중 편집 불가(테스트 전용)·캔버스 2개.
  - 남은 STEP 4: 문장형 이벤트 **2단계**(인라인 pill 편집) — 선택.

## ✅ 완료 (2026-07-12) — 🧹 InspectorPanel 리팩터 (섹션 컴포넌트화)

> **최종 결과: InspectorPanel.tsx 3,855 → 277줄 (−93%)**. `panels/inspector/` 폴더에 18개 파일로 분리 완료. tsc 클린 + editor 컴파일 200(SSR 정상). 순수 리팩터(동작 무변경). **브라우저 실동작 최종 확인 대기**(특히 EventsSection — 이벤트 추가/수정/조건/타이머/대화/미리보기).
> - 공용: `ui.tsx`(프리미티브)·`GlbClipPicker.tsx`. 패널: `EnvironmentPanel.tsx`(1085)·`MultiSelectPanel.tsx`(다중선택)·`EventsSection.tsx`(1034 — 이벤트/조건/대화 전부). 단일오브젝트 섹션 13개: Transform·Material·Geometry·Subdivision·Visibility·Physics·Motion·Light·Content·Particle·Cloner·Array·Prefab.
> - **EventsSection(마지막·최고난도)**: 이벤트 폼 상태 11개·핸들러·600줄 renderEventForm·리스트·대화 UI를 통째 이동. previewPopup 오버레이는 부모(aside relative 기준 positioning 보존)에 남기고 리스트 미리보기는 `onPreview` 콜백으로 위임. 상수(TRIGGER_LABELS/ACTION_LABELS/OBJECT_TARGET_ACTIONS/ELSE_ACTION_OPTIONS)도 함께 이동.
> - InspectorPanel 잔여 미사용 import·store 구조분해 전면 정리(three·bbox·lib·icons·types·store 액션 15개 제거).
> - **패턴 확립**(향후 새 섹션): `panels/inspector/XSection.tsx` 만들어 `<GroupBox>` 반환 + 스토어 직접 select, 부모는 `{guard && <XSection obj={obj} open={isOpen('x')} onToggle={()=>toggleSection('x')}/>}` 한 줄. 접힘/미리보기 등은 prop으로.

### (이력) 진행 과정

> 사용자 합의: 3,855줄 InspectorPanel을 **섹션별 컴포넌트로 분리**(기능 늘면 파일 추가해 붙이는 구조). 순수 리팩터(동작 무변경). 점진적·tsc+컴파일 확인하며 진행. 신규 폴더 `panels/inspector/`.

- **1단계 완료 — 공용 UI 프리미티브 추출** → `panels/inspector/ui.tsx`(294줄): `fmt·evalMath·NumInput·LabeledNum·XYZRow·LiveTransformRows·SectionHeader·Toggle·GroupBox`. InspectorPanel·EnvironmentPanel이 import. (주의: 원본 GroupBox가 className을 받고도 무시하던 동작까지 그대로 보존.)
- **2단계 완료 — EnvironmentPanel 분리** → `panels/inspector/EnvironmentPanel.tsx`(1,085줄): MOOD_PRESETS + 함수 통째 이동(자체 완결). InspectorPanel은 import만. 미사용 lucide import 정리.
- **3단계 완료 — 공용 GlbClipPicker 분리** → `panels/inspector/GlbClipPicker.tsx`(78줄): 이벤트(play_animation/animate_object)·Animation(defaultClip) 공용. parseGlbAnimationNames·캐시 포함.
- **4단계 진행 — 섹션 컴포넌트화** (사용자 브라우저 확인: Motion/Environment 정상). **패턴 확립**: 부모가 guard(`{cond && <XSection obj={obj} open={isOpen('x')} onToggle={()=>toggleSection('x')}/>}`)만 유지, 섹션은 `<GroupBox>` 반환 + 스토어 직접 select + 접힘은 open/onToggle prop.
  - 추출 완료 섹션: **Motion·Physics·Light·Content·Particle·Visibility·Subdivision·Geometry·Cloner·Array·Prefab·Transform·Material**(각 자체 파일). GlbClipPicker(공용)도 별도. Array는 로컬 상태, Transform은 setPos/setRot/setScl·바닥스냅 헬퍼, Prefab은 OVERRIDE_LABELS, Material은 텍스처 업로드 헬퍼(objTexUploading/objTexInputRef/texPanelOpen/handleObjectTexUpload)도 함께 이동.
  - 패턴 주의점(전부 tsc가 잡음): ①섹션 끝 `</GroupBox>)}`가 한 줄이면 추출 범위에 `</GroupBox>` 포함해야(off-by-one 주의) ②`obj.light`/`obj.content` 등 부모 guard 좁히기가 사라지므로 컴포넌트 상단에 `if (!obj.X) return null;` ③섹션에서 쓰는 lucide 아이콘 개별 import.
- **다중선택 패널 완료** → `panels/inspector/MultiSelectPanel.tsx`(186줄): `if(isMultiSelect) return <MultiSelectPanel/>` 반환 브랜치 + async 핸들러(handleMerge/handleBoolean)·merging busy state 통째 이동. 일괄편집·거리·합치기·Boolean·정렬. (Prefab 라이브러리는 무선택 Environment 브랜치라 별개 — 유지.)
- **결과(현재)**: InspectorPanel.tsx **3,855 → 1,300줄(−66%)**. 신규 파일 17개(ui·Environment·GlbClipPicker·MultiSelectPanel + 단일오브젝트 섹션 13개). tsc 클린 + editor 컴파일 200(SSR 정상).
- **남음(마지막 1종 — 최고난도)**: **EventsSection** — 이벤트 폼 상태 11개(showAddEvent·newTrigger·newAction·newValue·newPopup·newConditions·newLogic·newElse·newTimer·editingId·previewPopup)+sceneList/needScenes effect·sceneName/objectName·cleanPopup·addEvent/startEdit/cancelEventForm/removeEvent·hints·dlg/setDlg(대화)·**600줄 renderEventForm**·previewPopup 오버레이·이벤트 리스트가 InspectorInner 곳곳 분산 → 전용 신중 패스 필요(단일 오브젝트 반환 브랜치 안). 이후 InspectorPanel 잔여 미사용 import(THREE·worldBBox·localBBox·glbLocalBboxCache 등) 최종 정리. **순수 리팩터라 브라우저 확인 권장** — 다중선택(2+ 선택 시 일괄편집/합치기/Boolean/정렬).

## 최근 완료 (2026-07-12) — 🎮 게임 로직 Phase 2 (타이머·스폰·HUD·승패) + Phase 3 (커스텀 스크립트)

> 기준 문서 **`doc/GAME_LOGIC.md`** 갱신(Phase 2 완료·Phase 3 run_script 완료·비주얼 노드 에디터 분석/보류·HUD 커스터마이즈 분석). 전부 **tsc 클린 + editor/space 컴파일 200**, **브라우저 실동작 검증 대기**.

- **HUD 커스터마이즈(사용자 요청 — 스코어/체력바를 사용자가 만들기)**: 가능하며 구현함. **위젯 바인딩 모델** — `HudElement{variable(연결),kind:text|bar|lives,position(6구석),label,color,max,icon}` + `scene.hudElements[]`. 에디터 Environment **'HUD (화면 표시)' 섹션**(위젯 추가→변수 연결→종류/위치/색/최대/아이콘). 뷰어 `HudWidgets`가 실시간 렌더(체력바=값/max 게이지, 목숨=하트/별/원 N개, 텍스트). 변수의 간단 `showInHud` 텍스트와 별개(공존).
- **Phase 2 — 타이머**: 트리거 `scene_start`(로드/재시작 시 1회)·`on_timer`(`timer.everySec` 간격 반복, once=1회). `ViewerClient`가 setInterval/Timeout 구동, 게임오버 시 정지, 재시작 시 재설정. 에디터 on_timer에 간격/1회 입력.
- **Phase 2 — 스폰/디스폰**: 액션 `spawn_object`(템플릿 복제 생성, value=`"템플릿id|dx,dy,dz"`, `spawned[]`→effectiveScene 병합)·`despawn_object`(value=대상, 빈 값=자기, `despawnedIds` Set 필터). 제약: 단일 오브젝트만(그룹·자식 미지원), 스폰 클론은 timer/scene_start 미대상(무한 스폰 방지). 에디터: 템플릿 SelectBox+오프셋 XYZ.
- **Phase 2 — 승리/패배**: 액션 `game_win`/`game_lose`(value=메시지 선택). 뷰어 결과 오버레이(🎉/💀+메시지+**다시 시작**). `restartGame()`=변수 initial 복구+스폰/오버라이드(vis/pass/pos)/결과 초기화+scene_start·타이머 재실행(`runNonce` bump).
- **Phase 3 — 커스텀 스크립트**: 액션 `run_script`(value=JS). `new Function('api','self',code)` 실행, **안전 api만 노출**(get/set/add·show/hide·despawn·popup·sound·win/lose·log, self) — window 직접 노출 안 함, try/catch 격리. 에디터: textarea+api 안내. **보안**: 제작자 자신 코드 실행(자기 사이트 script 수준) — 진짜 샌드박스는 후속(타인코드/마켓 배포 시 필수).
- **Phase 2 후속(다중조건·if/else·랜덤) ✅ 완료**: (1) **다중조건 AND/OR** — `conditions[]`+`conditionLogic`, 런타임 `evalGate`(every/some), 레거시 단일 condition 폴백·승격. (2) **if/else** — `elseAction`/`elseValue`, 조건 거짓 시 대신 실행(`runElseAction`), variable_changed는 true→false 엣지. (3) **랜덤** — set_variable `random` 연산(`"var|random|min,max"` 정수). 에디터: 조건 다중추가+AND/OR 토글·else 액션(간단입력 `ELSE_ACTION_OPTIONS`)·랜덤 min~max. trigger/action을 `EventTrigger`/`EventAction` 명명타입으로 추출(elseAction 재사용). tsc·컴파일 200.
- **Phase 3 — 비주얼 노드 에디터**: 분석 후 **별도 스프린트 보류**. 이미 Events가 경량 비주얼 스크립팅이라 노드 에디터는 표현 레이어(대형 UI, `@xyflow/react` 필요). 설계 메모는 GAME_LOGIC.md. → **이제 Phase 2 후속 완료했으니 다음은 노드 에디터 or 세이브/로드 등 선택.**
- 스키마: `scene.ts`(트리거 2·액션 5·`HudElement`·`EventSchema.timer` 추가+normalize). 스토어: `hudElements` state+CRUD+저장/undo. 배선: `saveScene`·복제(JSON 딥클론 자동 보존).
- **미구현(Phase 2 후속)**: 랜덤(set_variable 범위)·다중조건(AND/OR)·if/else 분기·세이브/로드·리더보드. 검증: **브라우저 실동작 대기**(타이머·스폰·체력바·승패/재시작·스크립트).

## 최근 완료 (2026-07-12) — 🎮 게임 로직 레이어 Phase 1 (변수 + 조건) + 킥 넉백

> **방향 전환**: 사용자가 "실질적인 게임/인터랙티브 홈페이지를 만드는 플랫폼"을 원함 → 3D 뷰어를 **게임 메이커**로 확장 시작. 설계 기준 문서 **`doc/GAME_LOGIC.md`** 신설(범용·장르비의존 철학, Phase 1~3 로드맵, 구현 위치·결정 로그). 이어서 작업할 땐 **GAME_LOGIC.md가 기준**.

- **게임 로직 Phase 1 — 변수 + 조건 (범용 상태 시스템)**: "버튼→팝업" 단발 이벤트에 **상태(변수)+규칙(조건)**을 얹어 진짜 게임 규칙("동전 N개 모으면 문 열림", "체력 0이면…")을 노코드로. **기존 Events 시스템 확장(비침습)**.
  - **스키마**(`src/types/scene.ts`): `GameVariable{id,name,type:number|boolean,initial,showInHud}`, `EventCondition{variable,op,value}`, `EventSchema.condition?`(조건 게이트), 트리거 `variable_changed`(변수 바뀔 때 조건 false→true 엣지에서 1회 발동), 액션 `set_variable`(value=`"변수명|연산|값"`, 연산 set/add/sub/mul/toggle), `ProjectSceneSchema.variables?`. `normalizeSceneData` 갱신.
  - **스토어**(`sceneStore.ts`): `variables` state + `addVariable/updateVariable/removeVariable`(이름 공백제거·타입변경 시 initial 보정) + loadScene/undo/redo/HistoryEntry 반영. **저장**(`saveScene.ts`)·**복제**(remapSceneData JSON 딥클론) 자동 보존.
  - **뷰어 런타임**(`ViewerClient.tsx`): `varsRef`(권위 동기값)+`hudVars`(HUD 재렌더)+`watcherState`(엣지 감지)+`evalDepth`(재진입 가드 16). `evalCondition`/`applyVarOp`/`evaluateWatchers`(variable_changed 순회, false→true만 발동)/`onVarsChanged`. **핵심 리팩터**: 이벤트 실행부를 `runEventAction(obj,ev,trigger)`(단일 이벤트)로 추출 → 워처도 재사용. `handleObjectEvent`는 **조건 게이트**(`ev.condition` 참인 것만) 후 디스패치. **HUD 오버레이**(showInHud 변수 상단 표시, 탐색/플레이·임베드 공통).
  - **에디터 UI**(`InspectorPanel.tsx`): Environment(빈 곳 클릭) **'게임 변수' 섹션**(추가/이름/타입/초기값/HUD토글/삭제) + 이벤트 폼에 **`set_variable` 입력**(변수 SelectBox+연산+값, bool은 참/거짓·토글) · **`variable_changed` 트리거**(+안내) · **조건 게이트 UI**(변수/비교연산/값, 접이식 "+조건 추가", bool/number 적응).
  - **검증 예제(GAME_LOGIC.md §6)**: score(number,0,HUD) → 동전 interact=`set_variable score|add|1`+hide_object / 문 `variable_changed`+condition `score>=3`=`set_passable`. → 3개 먹으면 문 열림·HUD 점수.
  - 검증: **tsc 클린 + editor/space 컴파일 200**. **브라우저 실동작 검증 대기**(로그인 필요). Phase 2(타이머·스폰·HUD고도화·승패)·Phase 3(커스텀 스크립트·노드 에디터)는 GAME_LOGIC.md 로드맵.
- **킥/강한 넉백(F키)**(`PlayModeController.tsx`): 캐릭터가 이미 dynamic 밀기(`setApplyImpulsesToDynamicBodies`)는 됐고, **F키**로 앞쪽 콘 2.8m 내 dynamic 물체를 앞·위로 **질량 무관 일정 속도**(impulse=목표속도×질량)로 날림. keydown 핸들러에 `world.forEachRigidBody`+`isDynamic()`+전방 dot 필터. 튜닝상수 RANGE/LAUNCH/LAUNCH_UP. **F키 확인됨(사용자)**. (모바일 버튼·온스크린 힌트는 미구현.)
- **Physics Dynamic 토글 + Mass 입력**(`InspectorPanel.tsx`): Physics 섹션에 mass 컨트롤이 없어 중력 낙하를 켤 수 없던 갭 → **Dynamic 토글**(mass 0↔1)+**Mass 입력**(Is Sensor 아닐 때). 플레이 모드에서 dynamic 낙하·Restitution 튕김. **낙하 확인됨(사용자)**.

## 최근 완료 (2026-07-06)

- 계층 리스트 **드래그 정렬 + 그룹 안팎 재부모화**(월드 좌표 보존) + 그룹 피벗 recenter + 기즈모 안정화
- GLB 호버 하이라이트 전파 버그(재질 공유) 수정
- **조명 L1**: 기본 환경광(IBL)·그림자 bias/frustum·GLB castShadow·fill 재조정
- **Events E1**: `go_to_scene`(씬 이동), 리치 팝업(이미지/영상/YouTube — `RichContent`), hover_exit/area_exit 트리거, 이벤트 **인라인 수정** 기능
- **Events E2(진행 중)**: 오브젝트 표시/숨김/토글(`show/hide/toggle_object` — 뷰어 `visOverride` 런타임 오버라이드), **카메라 포커스**(`focus_object` — 대상으로 부드러운 팬) + **카메라 초기화**(`reset_camera` 액션 + 우측 상단 ⌂ 시점초기화 UI 버튼, 카메라 로직 `ViewerCanvas`의 `CameraFocus`), **대상 오브젝트 애니메이션**(`animate_object` — value `"objectId|clip"`, 뷰어 `ClipRequestContext` 런타임 클립 요청; 에디터는 대상+클립 2단 선택). 이벤트 Action 드롭다운에서 `play_animation(자기)`↔`animate_object(다른 오브젝트)` 나란히 배치.
  - **E2 완료**: 아래 '오브젝트 이동/사운드', '인터랙션 어포던스' 항목 참고.
- **뷰어 모드**: 씬별 기본 진입 모드(`defaultMode`) + "걷기 모드 사용" 토글(`disableWalk`, 둘러보기 전용)
- **🔴 visible 토글 좌표 리셋 버그** 수정(데이터 유실 치명 버그, 명령형 좌표+조건부 언마운트 → `g.visible` 플래그 토글)
- **뷰어 GLB 호버 전파 버그** 수정(재질 인스턴스 복제 — 에디터 GlbObject와 동일). **플레이 모드 호버 가이드라인 제거**(`PlayModeContext` — Outlines/box3Helper만 숨김, 커서·emissive 하이라이트는 유지).
- 계층 리스트 visible 아이콘도 lock처럼 숨김 시 상시 표시.
- 에셋 URL 만료 해결(0006 마이그레이션, public 버킷)
- **Events E2 — 오브젝트 이동 + 사운드**: `move_object`(value `"objectId|dx,dy,dz|초"` — **원래 저장 위치 기준** 오프셋으로 easeInOutQuad 이동, (0,0,0) 이벤트로 원위치 복귀) + `play_sound`(value=오디오 URL, URL별 HTMLAudioElement 재사용). 구현은 visOverride와 동일 패턴 — `ViewerClient`의 `posOverride`를 effectiveScene에 주입, 단일 rAF 루프가 이징. rapier 2.2.0은 RigidBody position prop 변경 시 setTranslation 텔레포트라 **플레이 모드에서 콜라이더도 함께 이동**(E2E 검증: `/test/move-object` 페이지 + 헤드리스 Edge — 탐색 클릭 move·플레이 area_enter move·Audio 패치 사운드 로그 모두 확인). 에디터는 대상 SelectBox+XYZRow 이동량+시간 입력, 사운드는 URL 입력·▶ 미리듣기.
- **Events E2 완료 — 인터랙션 어포던스**: 클릭/호버 이벤트가 있는 오브젝트 위에 카메라를 향한 펄스 **힌트 링**을 띄워 방문자에게 상호작용 가능함을 알림. `ViewerCanvas`의 별도 레이어 `InteractionHints`로 구현 — **오브젝트 렌더 경로(재질/GLB) 미변경**(depthTest=false + renderOrder 999, `objWorldPos` 재사용, useFrame 빌보드·펄스). **탐색 모드 뷰어/임베드에서만** 렌더(플레이 모드·에디터 미표시). 씬별 토글 `EnvSchema.showInteractionHints`(미설정=켜짐) — 에디터 Environment 패널 'Interaction' 섹션. area_enter/exit만 있는 오브젝트엔 링 없음(호버로 발견되는 트리거가 아니라서). E2E: `/test/move-object`에서 클릭·호버 오브젝트에만 링 뜨는 것 스크린샷 확인.

## 진행 중 (2026-07-09) — 그룹/변환/undo 크리티컬 버그 4종 (사용자 보고 "이대로는 못 씀")

계획 순서: ①spin wobble → ②그룹 자식 클릭 → ③ungroup 행렬화 → ④undo 경합.

- **버그 1 완료 — spin 회전 wobble(눕힌 바퀴가 삐뚤빼뚤)**: `motion.ts`의 spin이 **오일러 성분을 직접 더함**(`ry = baseRot[1] + t·spd`)이라 baseRot≠0(눕힌/기운 물체)이면 오일러 재조합으로 **세차운동(wobble)**. → **쿼터니언 합성**(`baseQuat ∘ 축회전(angle)`, post-multiply=로컬 축)으로 교체, out.rot는 setFromQuaternion으로 유지(시각 `g.rotation`·콜라이더 `setFromEuler` 양쪽 API 무변경). **결정적 테스트로 재현·수정 확인**: 눕힌 바퀴(Z 90°) spin 회전축 이탈(drift) **1.99 → 0.00**, 똑바로 선 물체도 정상. 시각·플레이 콜라이더 동시 해결. 참고: 모션을 *그룹*에 걸면 원점 기준이라 자식이 공전할 수 있음(제자리 회전은 각 자식에 모션) — 별개 UX.
- **버그 4 완료 — 그룹 자식 뷰포트 클릭 선택**: `handleClick`이 항상 `findRootAncestorId`(최상위 그룹)만 선택 → 트리에서만 자식 선택 가능하던 불편. **모듈 스코프 더블클릭 감지 `selectByClick`** 신설(같은 오브젝트 350ms 내 재클릭=자식 리프 직접 선택, Figma/Illustrator식 그룹 진입). 3개 핸들러(라이트·그룹·메인=프리미티브/콘텐츠/GLB 콜백)가 공유 → 모든 렌더 경로 커버. tsc 클린·컴파일 정상. **브라우저 실동작 확인 필요**(그룹 자식 더블클릭 선택·기즈모/인스펙터 자식 반영).
- **버그 2 완료 — 재그룹(중첩)→이동→그룹해제→위치 급변**: 근본 원인 = `ungroupSelected`가 **그룹의 로컬 TRS를 월드로 착각** → 그룹이 중첩(재그룹화)되면 조상 변환이 누락돼 자식 위치가 크게 틀어짐(회전+비균일스케일은 부차적, 위치는 원래 맞았음). **결정적 테스트로 확정**: 중첩(Go>Gi>C)에서 OLD 자식위치 (1.61,1.01,0.20) vs 참값 (5.20,3.01,-0.04) — 3유닛+ 오차. → **행렬 기반 재작성**: `computeWorldMatrix`(전체 부모체인)로 자식 참 월드행렬 구하고, **새 부모=그룹의 부모**(중첩이면 조부모로 승격) 역행렬 곱 후 decompose. 위치 정확 보존(NEW err ~1e-16). 한계: 회전+비균일스케일 그룹의 전단(shear)은 TRS로 표현 불가라 형상만 근사(위치는 항상 정확 — 어차피 Three 객체는 전단 불가). 2/2 테스트 통과·tsc 클린.
- **버그 3 완료 — 다중이동+Ctrl+Z 일부만 복원·좌표틀어짐·유령 오브젝트**: 근본 원인 = 기즈모가 `updateObject`의 **`_prevSnapshot` 지연커밋 패턴**에 의존(N회 updateObject + 1회 pushHistory) → **직전에 커밋 안 된 편집이 남긴 stale `_prevSnapshot`**이 있으면 undo 기준이 과거로 오염(일부 오브젝트가 과거값·유령 오브젝트 재등장). **재동기화(useLayoutEffect deps)는 정상**임을 확인 후 상태관리 문제로 특정. → 스토어에 **원자적 `commitTransforms(updates[])`** 신설(자체 baseline으로 `withHistory` 1회 커밋 + `_prevSnapshot:null`로 잔재 제거). `MultiGizmo`/`SingleGizmo` onMouseUp을 이걸로 교체(N회 updateObject+pushHistory 폐기). **스토어 테스트 8/8 통과**: 다중이동 undo 일관복원·오염방어(undo가 커밋 직전으로 복원, 과거로 안 튐)·유령 없음(오브젝트 수 유지)·그룹 포함 이동 undo. tsc 클린·컴파일 정상.
- **4종 전부 코드+결정적 테스트 완료. 브라우저 실동작 최종 확인만 남음**(특히 버그 4 더블클릭, 버그 2 중첩그룹 해제, 버그 3 대규모 다중선택 undo). 신규 lib/액션: `motion.ts`(쿼터니언 spin)·`sceneStore.commitTransforms`·`EditorObjectInstance.selectByClick`·`sceneStore.ungroupSelected`(행렬화).

## 진행 중 (2026-07-09) — 인앱 3D 모델링 (일반인 온보딩 장벽 해소)
> **스코프 5단계 전부 완료 — ✅ 브라우저 실동작 확인 완료(2026-07-10, 사용자). 각뿔대/둥근박스/Merge/Boolean/Loft 정상.**

### 배경/합의
- **문제 인식(사용자)**: 일반인은 GLB를 어디서 구하는지 모르고 Blender를 못 씀 → import-only만으론 진입장벽. 간단하게라도 객체를 만들고·조합하고·움직일 수 있어야 함(예: 바퀴 만들고 몸체 만들고 색 입혀 조립해 굴리기).
- **경쟁 조사 결론(2026-07-09)**: Spline은 이미 물리·Walk/Fly 게임컨트롤·19종+ 이벤트·인툴 모델링(프리미티브+불리언)·AI 3D생성 보유 → **기능 체크박스 경쟁으론 불리**. 우리 빈칸 = **다중 씬 사이트 + 커스텀 도메인 배포 + Event Bridge(임베드 호스트 페이지 연동)**. 인툴 모델링은 "Blender 재구현"이 아니라 **간단 조립 도구** 수준으로 진입장벽만 낮추는 게 목표.
- **확정 스코프(순서)**: ①**프리미티브 확장**(둥근 박스·각뿔대) → **Merge**(여러 오브젝트→진짜 하나, GLB로 구워 기존 에셋 파이프라인 재사용) → **Boolean**(합치기/빼기·구멍 뚫기, bake 방식) → ②**Loft**(다단면) → ③**서브디비전 제외**. (유선형 자유곡면=서브디비전 박스모델링은 스코프 밖 — Loft까지가 현실적 상한.)
- **핵심 판단**: "조립+움직임"은 이미 프리미티브+그룹+Prefab+motion(spin)으로 대부분 가능. 진짜 부족한 건 "새 형태 만들기". 콜라이더: 둥근 박스=box→cuboid 근사, 각뿔대=hull/trimesh 근사(변경 불필요).

### Phase 1 완료 — 프리미티브 확장 (둥근 박스 + 각뿔대)
- **스키마(`scene.ts`)**: `PrimitiveShape`에 `'frustum'` 추가 + `PrimitiveGeom { cornerRadius?, cornerSegments?, topScale? }` + `ObjectNodeSchema.geom?`(옵셔널=하위호환).
- **공용 팩토리 `src/lib/primitiveGeometry.ts`(신규)**: `createPrimitiveGeometry(shape, geom)` 단일 소스 — 기존 5곳 인라인 `<boxGeometry>` 등을 대체. 둥근 박스=`RoundedBoxGeometry`(three/examples), **각뿔대=4각 CylinderGeometry(radiusTop=0.5√2·topScale)를 45° 회전**해 축정렬 사각 단면(법선·UV 정확). `primitiveGeomKey`(인스턴싱/메모 키).
- **배선**: `EditorObjectInstance`·`ViewerObject`(둘 다 `geometry={primGeom}` prop + useMemo/dispose, ViewerObject는 early-return 前 hook·isPrimitive 가드) · `InstancedPrimitives`(배칭 키에 geom 포함 + 대표 오브젝트로 지오메트리 생성). 콜라이더(`PhysicsObject`/`PlayCanvas`)는 무변경(frustum→hull/trimesh, 둥근박스→cuboid 자연 근사).
- **UI**: 추가 메뉴(`ViewportFloatingToolbar` SHAPES + `CommandPalette`)에 '각뿔대' 추가 + Inspector **Geometry 섹션**(box=모서리 둥글기·둥근면 부드러움, frustum=윗면 크기). 둥근 박스는 별도 타입 아니라 **box의 cornerRadius 파라미터**(0=기존 각진 박스).
- **bbox**: 프리미티브는 단위 박스([-0.5,0.5]³) — frustum(topScale≤1)·둥근 박스 모두 범위 내라 바닥스냅/정렬 그대로 정확.
- **검증**: **tsc 클린** + **지오메트리 수치 테스트 11/11 통과**(각뿔대 아랫면 반폭 0.5·윗면 0.25@topScale0.5·apex@0·box@1, 둥근 박스 단위 박스 유지, 키 구분 — `tsx` 임시 스크립트) + **에디터/뷰어 라우트 200·컴파일 정상**. **에디터 실클릭(각뿔대 추가·둥근 박스 슬라이더·인스턴싱) 브라우저 확인 필요**.
### Phase 2 완료 — Merge (여러 프리미티브 → 진짜 하나의 객체)
- **핵심 결정**: 병합 결과를 새 스키마 필드 없이 **GLB로 구워(bake) 기존 에셋 파이프라인에 태운다** → '하나의 에셋 오브젝트'가 됨. Prefab(개별 요소 살아있는 묶음)과 달리 **되돌릴 수 없는 진짜 병합**(Blender Join).
- **업로드 공용화 `src/lib/uploadAsset.ts`(신규)**: `uploadGlbBlob(body, name, projectId, type)` — Storage 업로드 + assets DB insert + 썸네일 → AssetRefSchema. `AssetBrowser.uploadGlb`의 중복 로직을 이 함수로 추출(AssetBrowser도 이걸 호출하도록 리팩터, 회귀 없음 확인).
- **병합 로직 `src/lib/mergeObjects.ts`(신규)**: `buildMergedGlb(objects, rootIds)` — 루트들의 서브트리에서 **프리미티브만** 수집(GLB/콘텐츠/라이트/파티클 제외) → 각 월드행렬로 `createPrimitiveGeometry`+`MeshStandardMaterial` 메쉬 생성 → 전체 월드 bbox 중심 기준 로컬로 옮겨 `GLTFExporter.parseAsync({binary})` → `{ blob, center, count }`. 대상 없으면 null.
- **스토어 `mergeIntoAsset(rootIds, asset, position, name)`**: 대상 루트+자손 제거 + 에셋 추가(중복 방지) + 에셋 오브젝트 1개를 center에 배치(단일 undo).
- **UI**: Inspector **다중선택 패널에 '합치기' 섹션**(⛶ 하나로 합치기) — async(GLB 굽기+업로드) busy 상태·토스트·persist. 안내: 병합 후 개별 편집 불가·Ctrl+Z 취소 가능·GLB/콘텐츠/라이트 제외.
- **검증**: **tsc 클린** + **병합 GLB 빌드 테스트 7/7 통과**(count·유효 GLB 'glTF' 매직·중심 계산·프리미티브 필터·GLB만이면 null — `tsx`+FileReader 폴리필. Node엔 FileReader 없지만 **브라우저엔 항상 있어 실앱 정상**) + 에디터/뷰어 200. **에디터 실클릭(2+ 선택→합치기→에셋화·바닥배치·원본 제거) 브라우저 확인 필요**.
- **알려진 제약**: 프리미티브만(GLB 병합 후속) · undo 시 원본은 복원되나 업로드된 에셋 파일/DB행·assets 목록 항목은 남음(파일은 이미 커밋됨 — 일관성 위해 유지) · 텍스처 UV 없음(단색/PBR만).
- **다음**: Boolean(합치기/빼기·구멍 뚫기, `three-bvh-csg`로 bake→같은 파이프라인) → Loft.

### Phase 3 완료 — Boolean (합집합/차집합/교집합·구멍 뚫기)
- **의존성**: `three-bvh-csg@0.0.16` 설치(최신 0.0.18은 three-mesh-bvh≥0.9.7 peer라 drei의 three-mesh-bvh@0.8.3과 충돌 → **0.0.16이 0.8.3과 호환**, 기존 것에 dedupe·충돌 없음). `npm install three-bvh-csg@0.0.16`.
- **로직 `src/lib/booleanObjects.ts`(신규)**: `buildBooleanGlb(objects, baseId, toolId, op)` — 프리미티브 2개를 `Brush`로 만들어(월드행렬 반영, base 월드 bbox 중심으로 정렬) `Evaluator`(useGroups=false)로 ADDITION/SUBTRACTION/INTERSECTION 계산 → base 머티리얼 적용 → GLTFExporter로 GLB. 대상이 프리미티브 아니면 null.
- **UI**: Inspector 다중선택 패널에 **정확히 2개 선택 시** 'Boolean' 섹션(합집합/빼기/교집합) — Merge와 동일하게 `mergeIntoAsset`으로 원본 2개→에셋 1개 대체. **빼기=먼저 선택(base) − 나중 선택(tool)**(안내에 이름 표기). 예: 몸체에서 실린더 빼 바퀴 자리 구멍.
- **검증**: **tsc 클린** + **CSG 테스트 10/10 통과**(union/subtract/intersect 각각 유효 GLB 'glTF' 매직·크기>0 + 프리미티브 아니면 null — `tsx`+FileReader 폴리필) + 에디터 200·컴파일 정상. **에디터 실클릭(2개 선택→빼기→구멍 뚫린 결과) 브라우저 확인 필요**.
- **알려진 제약**: 프리미티브 2개만(GLB·다중 대상 후속) · 연쇄 Boolean은 결과 에셋을 다시 프리미티브와 못 뺌(에셋이 됨 — 후속은 GLB Boolean 지원 시) · 되돌릴 수 없음(Ctrl+Z 취소).

### Phase 4 완료 — Loft (다단면·각뿔대의 N단면 일반화)
- **로직**: `primitiveGeometry.ts`에 `makeLoft(sections[])` — **각뿔대(2단면)를 N단면으로 일반화**. `LatheGeometry`(4각+45° 회전)의 프로파일 **양끝을 축(반경 0)에 붙여 상·하 캡을 자동 생성** → 법선·캡·UV 안전. 각 단면 배율(0~1)로 층마다 폭 조절 → 병·꽃병·로켓·탑처럼 굴곡진 형태. 새 `PrimitiveShape 'loft'` + `PrimitiveGeom.sections?: number[]`.
- **배선**: 팩토리/키(`primitiveGeomKey`·InstancedPrimitives makeKey)·3개 렌더 경로 memo 의존성에 sections 반영. SHAPE_NAMES('로프트')·기본 geom(`{sections:[1,0.7,0.4]}`)·추가 메뉴(툴바+커맨드팔레트). Inspector Geometry 섹션에 **단면 슬라이더 목록 + 추가/제거(2~8층)**.
- **콜라이더/bbox**: loft→trimesh/hull 근사(변경 불필요), sections≤1이라 단위 박스 bbox 유지.
- **검증**: **tsc 클린** + **로프트 지오메트리 테스트 5/5 통과**(높이 1·최대 반폭 0.5·가운데 단면이 끝보다 좁음[다단면 증명]·법선 유한·미지정 폴백 — `tsx`) + 에디터 200·컴파일 정상. **에디터 실클릭(로프트 추가·단면 추가/조절) 브라우저 확인 필요**.

### 🎯 인앱 모델링 스코프 전체 완료 (①프리미티브확장 → Merge → Boolean → ②Loft, ③서브디비전 제외)
- **신규 라이브러리/의존성**: `three-bvh-csg@0.0.16`(Boolean). 신규 lib 4개: `primitiveGeometry.ts`·`mergeObjects.ts`·`booleanObjects.ts`·`uploadAsset.ts`.
- **자동차 예시 달성 경로**: 둥근 박스(몸체) + 각뿔대/실린더(바퀴) → 색·재질 → 그룹/프리팹 → motion(spin) 굴리기, 또는 Boolean 빼기로 바퀴 자리 구멍, Merge로 하나의 객체화. "만들고·조합하고·움직이는" 흐름이 코드로 완성됨.
- **미착수(스코프 밖/후속)**: 유선형 자유곡면(서브디비전 박스모델링) · GLB 대상 Merge/Boolean · 텍스처 UV · loft 원형 단면 옵션 · 대칭(mirror) 편집.

## 최근 완료 (2026-07-11) — 기능 갭 A그룹 4종 (Visibility 옵션·실측 Size·Frame 비율·Grid 평면)

사용자 기획서(11개 기능) 대조 후 "A그룹(저비용·고효과)" 우선 구현.
- **#9 per-object Visibility 렌더 옵션**(프리미티브): `ObjectNodeSchema.render?{flatShading,doubleSided,castShadow,receiveShadow}` 추가. `PrimitiveMaterial`에 `flatShading`(key에 포함해 런타임 전환 시 재마운트)·`side` prop → 에디터(`EditorObjectInstance`)·뷰어(`ViewerObject`) 프리미티브 mesh 배선(castShadow/receiveShadow도). Inspector Visibility 섹션에 토글 4종(프리미티브 전용). 미설정=스무스·앞면·그림자 생성+수신(기존 동작).
- **#6 실측 Size(m) 필드**: Transform 섹션에 `크기(m)` XYZRow — `localBBox × scale`로 표시, 입력 시 `scale = size/localSize` 역산. box/구체는 size=scale, 돌출/로프트는 실측 반영(localBBox 캐시 활용). (놓쳤던 `⤓ 바닥에 놓기` 글리프도 `ArrowDownToLine`로 교체.)
- **#1 Frame 고정 화면 비율**: `EnvSchema.frameAspect?`(width/height, 미설정=자유). **게시 뷰어**(`ViewerClient`)가 설정 시 캔버스를 그 비율로 레터박스(`maxWidth: 100vh*ar`, `maxHeight: 100vw/ar`로 가운데 정렬+배경 여백). 에디터 Environment 패널에 Frame 섹션(자유/16:9/4:3/1:1/9:16/3:4). 에디터 캔버스는 미변경(오버레이/좌표계 안전).
- **#4a Grid 평면 전환**: 스토어 전환 상태 `gridPlane('xz'|'xy'|'yz')`+`cycleGridPlane`(씬 저장 X). `EditorCanvas` drei `<Grid>`에 회전 적용(바닥/벽). 툴바에 격자 순환 버튼(`Grid3x3` + XZ/XY/YZ 라벨).
- 검증: tsc 클린 + editor 200. **실동작 브라우저 확인 필요**(셰이딩/양면/그림자 토글, Size 입력 역산, 게시 뷰어 레터박스, 격자 평면 전환).
- **B그룹 진행 중** — 아래 참고. 남음: #3 Effects+FogExp2+SSAO(N8AO 설치 필요) · #7 Subdivision(패키지 설치 필요) · #2b 에디터 실시간 물리 프리뷰. 대형(C): #5 글로벌 재질/색 에셋 · #8b 레이어 재질/AI.

### B그룹 (2026-07-11, 무설치분) — #8a MeshPhysicalMaterial · #4b 오브젝트 스냅
- **#8a MeshPhysicalMaterial**: `MaterialOverride`에 `clearcoat`/`sheen`/`transmission`/`ior` 추가. `PrimitiveMaterial`이 셋 중 하나라도 >0이면 **`meshPhysicalMaterial`로 전환**(key로 std↔physical 재마운트), 전부 0이면 기존 `meshStandardMaterial`. 에디터·뷰어 프리미티브 배선. Inspector Material 섹션에 '물리 재질(고급)' 슬라이더(clearcoat/sheen/transmission + transmission>0일 때 IOR). transmission은 유리처럼 투명(transparent+thickness).
- **#4b 오브젝트 스냅(자석)**: 스토어 토글 `objectSnap`(그리드 스냅과 독립, 기본 OFF) + 툴바 스냅 드롭다운에 토글. `SingleGizmo` translate에서 **루트 오브젝트** 이동 시, 드래그 시작 시 스냅샷한 다른 루트들의 월드 bbox와 비교해 **각 축의 min/center/max를 임계 0.2m 내 최근접에 흡착**(`localBBox×matrixWorld`로 가이드박스 오염 없는 정밀 bbox 사용). 토글 OFF면 완전 무영향(격리). 중첩/캐릭터 프리뷰 제외. 가이드 라인 시각화는 미포함(MVP).
- 검증: tsc 클린 + editor 200 + ✓ Compiled. **실동작 브라우저 확인 필요**(물리 재질 clearcoat/sheen/유리, 오브젝트 스냅 흡착).
  - **#8a 투과 보강(2026-07-11)**: 표준 `meshPhysicalMaterial transmission`이 뒤가 안 비치던 원인 = **metalness**(유리는 비금속). three r185 렌더리스트 소스 확인 결과 `transparent` 플래그는 무관(transmission이 먼저 transmissive 리스트로 분류)이었음 → 내가 넣었던 `transparent` 제거 + **transmission>0이면 metalness 0 강제**. drei `MeshTransmissionMaterial`(무거움)로 잠깐 갔다가, 성능 위해 내장 physical로 되돌림.

### B그룹 (2026-07-11, 설치분) — #3 Effects/FogExp2/SSAO · #7 Subdivision
- **#3 개별 포스트이펙트 + SSAO + FogExp2**: `@react-three/postprocessing`가 이미 N8AO/SSAO/DoF/BrightnessContrast/HueSaturation 제공 → **무설치**. 스키마 `EnvSchema.effects{ssao,bloom,vignette,brightness,contrast,saturation,dof}` + `fog.mode('linear'|'exp')`/`fog.density`. `PostProcessingEffects` 재작성 — 개별 효과 하나라도 활성이면 프리셋 대신 그 조합(활성 효과만 배열로 EffectComposer에 전달, N8AO=SSAO), 아니면 기존 프리셋. `ViewerCanvas` fog가 mode='exp'면 `<fogExp2 density>`. 에디터: Post Processing 섹션에 '개별 효과(고급)' 슬라이더 7종, Fog 섹션에 방식(linear/exp)+density. (에디터/뷰어 둘 다 effects 전달.)
- **#7 Subdivision Modifier**: **`three-subdivide` 설치**(`LoopSubdivision`). `PrimitiveGeom.subdivisions?(0~3)` + `createPrimitiveGeometry`가 base 지오메트리 생성 후 level>0이면 `LoopSubdivision.modify(base, level, {split, uvSmooth:false})`로 세분화(각진 박스→둥근 유기 곡면). `primitiveGeomKey`·primGeom useMemo deps에 subdivisions 포함. Inspector에 'Subdivision' 섹션(모든 프리미티브, 레벨 0~3 슬라이더).
- 검증: tsc 클린 + editor 200 + ✓ Compiled(three-subdivide 로드 정상). **실동작 브라우저 확인 필요**(SSAO 구석음영·개별효과·지수안개, subdivision 레벨↑ 곡면화).
- **B그룹 남음**: #2b 에디터 실시간 물리 프리뷰 — **선택/보류**(에디터에서 Rapier 구동은 편집 중 오브젝트가 떨어져 기즈모/좌표와 충돌 → 리스크. 이미 플레이 모드가 있어 우선순위 낮음).

### C그룹 Phase 1 (2026-07-11) — #5 글로벌 재질 에셋 (공존형)
"재질을 라이브러리에 한 번 만들어 여러 오브젝트가 id로 공유, 원본 수정 시 일괄 반영"(피그마 색 스타일 개념). 기존 인라인 재질과 **공존** — materialId 있으면 참조, 없으면 기존 인라인(하위호환 100%).
- **스키마**: `MaterialAsset{id,name,material}`·`ColorAsset{id,name,color}` + `ProjectSceneSchema.materialAssets?/colorAssets?` + `ObjectNodeSchema.materialId?`.
- **리졸버** `src/lib/effectiveMaterial.ts`: `effectiveMaterial(object, materialAssets)` — materialId 참조 유효하면 에셋 재질, 아니면 인라인(에셋 삭제 시 인라인 폴백).
- **스토어**: `materialAssets`/`colorAssets` state(loadScene·persist·normalizeSceneData·**undo 스냅샷**에 포함) + 액션 `addMaterialAsset`(id 반환)·`updateMaterialAsset`(원본 편집=전 인스턴스 반영, _prevSnapshot 패턴)·`renameMaterialAsset`·`removeMaterialAsset`(참조 오브젝트는 인라인으로 detach 후 삭제 — 유령참조 방지)·`assignMaterialAsset`·`detachMaterial` + color add/remove.
- **렌더 배선**: 에디터 `EditorObjectInstance`가 `effectiveMaterial`로 색/거칠기/금속/발광/텍스처/물리속성 읽음. 뷰어는 `ViewerClient.effectiveScene`에서 materialId→에셋 재질을 object.material에 미리 주입(ViewerObject 무변경).
- **UI**: Inspector Material — 참조 중이면 **배너(에셋 이름)+"연결 끊기(detach)"**(슬라이더 숨김), 인라인이면 기존 편집+**"이 재질을 에셋으로 저장(공유)"** 버튼. AssetBrowser Materials 탭 상단에 **저장된 재질 라이브러리**(색 스와치 편집=공유 반영·이름 변경·"적용"(선택 프리미티브에 연결)·삭제).
- 검증: tsc 클린 + editor 200 + ✓ Compiled. **실동작 브라우저 확인 필요**(에셋 저장→여러 오브젝트 적용→라이브러리서 색 변경 시 일괄 반영→연결 끊기).

### C그룹 Phase 2 (2026-07-11) — 색 팔레트 · 라이브러리 전 속성 편집 · 복제
- **색 팔레트(ColorAsset)**: AssetBrowser Materials 탭 하단에 색 스와치 그리드 + "현재 색 저장"(선택 프리미티브 색) + 클릭 적용(선택 프리미티브 material.color, 참조 재질 제외) + 삭제. 스토어 `addColorAsset`/`removeColorAsset`.
- **라이브러리 재질 전 속성 편집**: Materials 탭 저장된 재질에 펼침(`SlidersHorizontal`) 토글 → 거칠기/금속성/코팅광택/투과 range 슬라이더 + 자체발광 색 → `updateMaterialAsset`(공유 반영). 기존엔 색만 편집 가능했음.
- **프로젝트 복제 리맵**: `remapSceneData`가 scene_data를 통째 JSON 딥클론하므로 **materialAssets·object.materialId가 이미 보존**됨(내부 UUID·씬 스코프라 충돌 없음) → **별도 작업 불필요**로 확인됨(PROGRESS 이전 우려 정정).
- 검증: tsc 클린 + editor 200 + ✓ Compiled. **실동작 브라우저 확인 필요**(색 저장/적용, 라이브러리 슬라이더로 공유 재질 속성 편집→일괄 반영).
- **#5 재질/색 에셋 전체 완료**(Phase 1+2). 남은 대형: #8b 레이어 재질/AI 텍스처(별개 스프린트).

## 최근 완료 (2026-07-10) — 에디터 UX 3종 (아이콘 lucide화 · 배치 모드 · 툴바 드롭다운)

사용자 요청 3건. 컨펌 후 진행(단순 반투명 고스트 · 한 번 배치 후 종료 · 이모지 전부 lucide).

- **아이콘 전면 lucide화**: 이모지·텍스트 글리프(▾▸ ↺ ⌂ ✕ ▶ ■ ✓ ✏ 📦🧍🎵 🔥❄️ 🌅🌙 ⬛⬤ 등)·이미지 아이콘을 전부 `lucide-react`로 교체. 대상: `ViewportFloatingToolbar`(도형·펜·복셀), `AssetBrowser`(카드·탭·오디오·재질·HDR·콘텐츠·파티클·라이트), `HierarchyPanel`(트리 아이콘·표시/잠금·컨텍스트메뉴), `InspectorPanel`(SectionHeader 화살표/아이콘·무드·그라운드·파티클/라이트 SelectBox·합치기·정렬·프리팹·클로너·GLB내보내기·이벤트 미리보기/수정/삭제), `CommandPalette`(전 명령 아이콘), `SceneSwitcher`·`VersionHistoryModal`·`PenToolModal`·`VoxelToolModal`·`EditorOnboarding`·`EditorClient`·`EditorGnb`·`Toaster`·`ThemeToggle`, 대시보드(`ProjectCard`·`ShareModal`·`CustomDomainModal`·`page`·`NewProject*`). 카테고리/무드 라벨 이모지까지 전부 아이콘화(사용자 결정). **유지**: 키보드 단축키 표기(⌃⇧G·⌃D)와 범례 화살표(↑↓↵)는 아이콘 아니라 텍스트 표기라 그대로. **주의**: `CheckCircle2`(deprecated alias)가 Turbopack HMR에서 module-factory 에러 → 정식 `CircleCheck`로 교체. 검증: tsc 클린 + editor·dashboard 200 + 렌더 에러 없음.
- **오브젝트/에셋 배치 모드**: add 버튼(도형·GLB·콘텐츠·파티클·라이트) 클릭 시 즉시 중앙 생성하지 않고 **뷰포트에서 클릭한 위치에 생성**. 스토어 `pendingPlacement` state + `beginPlacement`/`commitPlacement`/`cancelPlacement`. add* 5종에 `placeAt?:{x,z}` 옵션 파라미터(단일 히스토리 유지, y는 타입별 기본/바닥스냅 유지). `EditorCanvas`: 바닥(y=0) 평면 레이캐스트로 **단순 반투명 박스+바닥 링 고스트가 마우스 따라다님**(`PlacementGhost`, useFrame), 좌클릭=생성(**한 번 배치 후 종료**), **ESC 취소**, 상단 안내 배너 + crosshair 커서. 배치 클릭이 OrbitControls 좌드래그·선택박스·onPointerMissed 해제와 안 겹치게 게이트(`justPlacedRef`·orbit 일시 비활성). 호출부: 툴바 도형 + AssetBrowser 4탭. 검증: tsc 클린 + editor 200.
- **툴바 드롭다운화**(`ViewportFloatingToolbar`): 펼쳐져 있던 **스냅**(켜기 토글 + 0.25/0.5/1/2)과 **카메라 북마크**(1~5, 저장/이동)를 각각 **아이콘+ChevronDown 드롭다운**으로 접음(정렬 드롭다운과 동일 `openMenu` 패턴·바깥클릭 닫기). 북마크는 Shift+클릭 대신 슬롯별 이동/저장 버튼 명시. 도형 아이콘도 lucide(Box/Circle/Cylinder/Cone/Hexagon/Square)·펜=PenTool·복셀=Boxes. 검증: tsc 클린.

### 후속 3종 (2026-07-10) — 트리 잠금 캐스케이드 · 라이트 아이콘 · 도형 드롭다운
- **그룹 잠금 시 하위 요소도 잠금**: `sceneStore.setObjectLocked`가 대상이 그룹이면 자손 전체를 재귀 수집해 함께 locked 토글(선택 해제도 자손 포함). 단일 undo(_prevSnapshot) 유지.
- **트리 라이트 아이콘 종류별**: `HierarchyPanel.getIcon`에 라이트 분기 추가(point=Lightbulb / spot=Flashlight / directional=Sun). 기존엔 라이트가 분기 없어 Circle로 떴음.
- **툴바 도형 추가 드롭다운**: 박스~평면 6개 버튼 나열 → `Shapes` 아이콘+ChevronDown 드롭다운 1개로(각 항목 아이콘+라벨, 클릭 시 `beginPlacement`+닫기). 펜/복셀은 기존 버튼 유지. `Menu`에 'shapes' 추가.
- 검증: tsc 클린 + editor 200.

### 후속 (2026-07-11) — 도형추가 스플릿 버튼 · 프리미티브 bbox 정확화 · 박스선택 오선택 수정
- **도형추가 스플릿 버튼**: `ViewportFloatingToolbar` 도형 드롭다운을 `[아이콘][▾]`로 분리 — 아이콘=마지막 선택 도형(기본 박스) **즉시 배치**, 화살표=목록 열기. 목록 선택 시 `selectedShape` 갱신+즉시 배치. 화살표는 다른 드롭다운과 통일해 **우측**.
- **선택/호버 가이드 + 콜라이더 오버레이 실측 bbox화**(`EditorObjectInstance`): 고정 `1.05³`/`1.02` 단위 박스 → `primGeom` 실측 bbox 기준(여백 ×1.04/×1.02). 돌출/로프트/평면처럼 얇은 형상 가이드 과대 표시 수정. box/구체는 bbox=1이라 무변화.
- **`localBBox` 프리미티브 실측화 (bbox 캐시)**: `objectBBox.localBBox`가 프리미티브를 단위 큐브로 반환하던 것 → **`primLocalBboxCache`**(신규, GLB `glbLocalBboxCache`와 동일 패턴, `primitiveGeomKey` 키)를 `EditorObjectInstance`가 렌더 시 채우고 localBBox가 읽음. 드래그 미리보기·정렬·바닥스냅이 실제 크기 반영. **캐시는 에디터에서만 채워짐 → 뷰어/플레이는 단위 큐브 폴백(무변화)**, box/구체도 무변화.
- **🔴 박스 선택 오선택 수정 (카메라 뒤 꼭짓점 폭주)**: 확대(줌인) 시 드래그 영역 밖 오브젝트가 같이 선택되던 버그. **원인**: 줌인으로 카메라 **뒤로 넘어간 오브젝트**의 bbox 꼭짓점을 `project()`하면 원근분할 부호 반전으로 스크린 좌표가 ±수만 px로 폭주 → 스크린 AABB가 화면 전체를 덮어 아무 드래그나 다 걸림(사용자 콘솔 로그로 `screenAABB x[-52996~31029]` 확인). **수정**(`EditorCanvas` handlePointerUp + SelectionOverlay): 8꼭짓점을 투영 전에 **카메라 앞 여부(`dot(p−camPos, camDir)>0.05`) 판정** → 모두 앞이면 기존 AABB '닿기 선택'(피그마식 유지), 하나라도 뒤면 AABB 불신 → **중심점이 카메라 앞+드래그 영역 안일 때만** 선택. 미리보기도 동일 게이트. 겸사겸사 드래그 사각형·선택·미리보기의 좌표 소스를 **캔버스 엘리먼트 rect로 통일**(`dragCanvasRectRef`, 드래그 시작 시 1회 캐시 — DPR/배율 대비 정확성). 검증: tsc 클린 + editor 200 + **사용자 콘솔 로그로 원인 확정**.

### 후속 4종 (2026-07-11) — 툴바 정리 + 잠금 UX
- **잠긴 그룹 하위 자물쇠 disabled**: `HierarchyPanel`이 각 행의 조상 체인을 확인(`lockedByAncestor`)해, 잠긴 조상이 있으면 그 행의 자물쇠 토글을 **disabled**(개별 해제 불가, "상위 그룹에서 잠금 해제" 안내). 그룹 잠금 캐스케이드(자손 locked=true)와 짝을 이룸.
- **툴바 Undo/Redo·카메라 북마크 버튼 주석 처리**(`ViewportFloatingToolbar`): 두 블록을 `{/* ... */}`로 감싸 숨김(중첩 라벨 주석 제거 후 래핑). 관련 import·store 값은 복원 편의로 유지(미사용 경고만, noUnusedLocals off라 빌드 무해). 단축키 Ctrl+Z/Y는 유지.
- **도형 추가 = 스플릿 버튼**: `[아이콘][▾]` (아이콘 좌·화살표 우, 다른 드롭다운과 통일). **아이콘=마지막 선택 도형(기본 박스) 즉시 배치**(`beginPlacement`), **화살표=목록 열기**. 목록에서 도형 고르면 `selectedShape` 갱신 + 즉시 배치. `Shapes` 아이콘 import 제거.
- **선택/호버 가이드 외곽선을 실제 bbox 기준으로**(`EditorObjectInstance`): 기존 고정 `1.05³` 단위 박스라 **돌출/로프트/평면 등 한 축이 얇은 형상에서 가이드가 실제보다 크게** 떴음(`normalizeUnit`이 최대 변만 1로 맞춰 나머지 축<1). → `primGeom.boundingBox`로 `guideBox`(size·center) 계산해 여백 ×1.04로 감싸게 수정. box/구체는 bbox=1이라 무변화. **브라우저 확인 완료(펜툴 돌출 가이드 정상)**. (물리 켠 오브젝트의 `ColliderOverlay` 고정 박스는 별개 이슈로 미수정 — 돌출 런타임 콜라이더는 trimesh.)
- 검증: tsc 클린 + editor 200 + ✓ Compiled.

## 최근 완료 (2026-07-10) — 경계 벽 2차 + move_object 그룹 플레이 모드

### 경계 벽 2차 (원형 제외 — 그라데이션·one-sided·면별 텍스처·스카이박스)
`BoundaryWalls.tsx` 재작성 + 스키마 확장. **하위호환**: 기존 color/texture 벽은 그대로.
- **스키마(`scene.ts` `boundaryWall`)**: `style`에 `'skybox'` 추가 + `gradient?`·`oneSided?`·`faceTextures?{front/back/left/right}`·`skyboxUrl?`.
- **그라데이션**: 위→아래 알파 페이드. **셰이더 수정 없이** planeGeometry 정점에 vertexColors 알파(위 정점 a=0, 아래 a=1, quad 보간) — three 0.185 vertex-alpha 지원 이용(안전). 지평선처럼 벽 윗부분이 사라짐.
- **one-sided**: 중심을 향한 면만 보이게 `FrontSide`(밖에선 투명). **에디터는 편집 편의로 항상 양면(DoubleSide)**, 뷰어에서만 적용. 천장은 항상 양면(아래서 보이게).
- **면별 텍스처**: texture 스타일에서 앞/뒤/왼/오 각 면에 개별 이미지(미지정 면은 기본 textureUrl 폴백). 벽별 벽화/창문 등.
- **스카이박스**: 4면 벽 대신 360° equirect 파노라마를 큰 구(BackSide, `meshBasicMaterial toneMapped=false`)로 씬을 감쌈. 반경=max(경계)×2.2+20.
- **렌더 안전화**: 기존 drei `useTexture`(Suspense)를 **비-Suspense `TextureLoader`**로 교체(PrimitiveMaterial 패턴) — 인라인 mesh에 Suspense 경계 불필요.
- **에디터 UI**(Environment→Boundary): 스타일에 '스카이박스' 추가 + 면별 텍스처 2×2 슬롯(업로드/교체/제거) + 스카이박스 업로드 + 그라데이션·안쪽만 토글. 공용 업로더 `uploadBoundaryImage` + 단일 파일입력 target 라우팅(`bwUploadTarget`).
- **검증**: tsc 클린 + dev 컴파일(editor 200). **실동작 브라우저 확인 필요**(그라데이션 페이드·one-sided 밖에서 투명·면별 이미지·스카이박스 파노라마). 남음: 원형/커스텀 모양(콜라이더도 원형 대응 필요).

### move_object 그룹 플레이 모드
그룹을 move_object로 옮기면 시각만 미끄러지고 콜라이더는 원자리에 남던(유령 콜라이더) 문제 해결. **먼저 '이미 되어있나' 꼼꼼히 확인 → 미구현 확정 후 착수.**
- **원인**: `GroupWithCollision`은 자식 콜라이더가 부모 `<group>` 이동을 안 따라감(fixed 바디는 부모 월드행렬을 매 프레임 재샘플 안 함).
- **해결**: `ViewerClient`가 `movedIds`(=posOverride 대상 id 집합) 생성 → `ViewerCanvas`→`PlayCanvas` 배선(passableIds와 동일 패턴). PlayCanvas가 옮겨지는(모션 없는) 그룹을 **`MovedGroupCollider`**(신규)로 라우팅 = `kinematicPosition` + `colliders="hull"` 강체를 매 프레임 `setNextKinematicTranslation(object.position)`으로 구동(effectiveScene이 posOverride로 위치 갱신). 그룹 라우팅 필터(`groupObjects`/`movingGroups`)에서 movedGroups 제외(이중 렌더/시각전용 누락 방지).
- **단일 오브젝트**는 기존대로 정상(fixed 바디 position prop → setTranslation) — 무변경.
- **검증**: tsc 클린 + dev 컴파일. **실동작 브라우저 확인 필요**(플레이 모드에서 그룹 move_object 시 캐릭터가 옮겨진 그룹에 실제로 막히는지, [[project_e2e_play_mode_testing]] 방식 권장). 제약: hull 근사·라이딩 미구현.

## 최근 완료 (2026-07-10) — AssetBrowser Materials·HDR 탭 (WIP 해제)

마지막 두 WIP 탭 구현 → **AssetBrowser 4개 탭(Materials/Textures/HDR/Audio) 전부 완료.** 둘 다 `AssetBrowser.tsx` 단독 변경(스키마·렌더 경로 무변경 — 기존 필드 재사용).

- **Materials 탭**: 재질 프리셋 8종(기본·무광·유광·플라스틱·금속·크롬·고무·네온발광) 그리드. 클릭 → **선택한 프리미티브(들)의 `MaterialOverride` 질감(roughness/metalness/emissive)만 교체, 색·텍스처는 유지**. 대상 필터는 텍스처 탭과 동일(`o.primitiveShape && !o.content`, GLB 제외). 네온(`emissive:'SELF'`)은 오브젝트 현재 색으로 자체 발광(emissive≠검정이면 렌더가 자동 glow). `applyMaterialToSelection` + `pushHistory` 1회 undo + 토스트. 프리셋 값은 EditorObjectInstance 기본값(rough 0.5·metal 0.1·emissive #000)에 맞춤 → '기본' 프리셋이 곧 리셋.
- **HDR 탭**: 환경 프리셋 타일 11개(끄기 + Sunset/Dawn/Night/Forest/Park/City/Factory/Indoor/Lobby/Studio, 무드 그라데이션 스와치+이모지). 클릭 → `environment.hdrPreset` 설정(`applyHdr`), 현재 선택 타일 하이라이트(ring+✓). Environment 패널의 기존 HDR 드롭다운과 **동일 값**을 브라우저블 그리드로 노출(중복 아님, 발견성↑). 'none'=단색/하늘 배경 복귀.
- 정리: `TABS`에서 materials/hdr의 `wip` 플래그 제거, 미사용 `currentTab`·wip placeholder 블록 삭제.
- **검증**: tsc 클린 + dev 컴파일(editor 200, 인증 세션, `✓ Compiled`). **실동작 브라우저 확인 필요**(재질 프리셋이 선택 프리미티브에 적용·색 유지·네온 발광, HDR 타일 클릭 시 배경/반사 전환·활성 표시).

## 최근 완료 (2026-07-10) — 조명 L2 (c) 라이트 색(warm/cool)

L2의 마지막 미착수 항목. 환경 조명(태양·환경광)에 색이 없어(흰색 고정) 노을/밤 같은 색감 무드가 안 나오던 것 → **씬 전역 태양·환경광 색조** 추가. **L2 전 항목 완료.**

- **스키마(`scene.ts`)**: `EnvSchema.lights`에 `directionalColor?`(태양)·`ambientColor?`(환경광) 추가. **둘 다 optional — 미설정 = 흰색('#ffffff'), 기존 씬 100% 하위호환**(기존 published 씬 룩 무변).
- **렌더**: `ViewerCanvas`·`EditorCanvas`의 `directionalLight`/`ambientLight`에 `color={... ?? '#ffffff'}` 배선(뷰어·에디터 동일 룩). `hemisphereLight`는 fill용이라 무변.
- **에디터 UI**: Environment→Lights 섹션 Sun Position 아래 **Sun Color / Ambient Color** 2컬럼 컬러픽커(fog color와 동일 패턴 — swatch+hex, `onBlur`=pushHistory 1회 undo).
- **무드 프리셋 색조화**: `MOOD_PRESETS`에 색 주입 — 노을=따뜻한 주황(`#ff9d5c`), 밤=차가운 블루(`#9db4e8`+ambient `#4a5a80`), 아침=옅은 웜, 한낮/스튜디오/기본=흰색(리셋 시 색 해제). "진짜 색감 무드" 완성.
- **검증**: tsc 클린 + dev 컴파일(editor·space 200, 인증 세션). **실동작 브라우저 확인 필요**(무드 프리셋 색감·컬러픽커·리셋).

## 최근 완료 (2026-07-10) — 제작 도구 확장 (Export / Cloner / 펜 툴)

인앱 모델링 스코프 완료 후 사용자 신뢰 하에 우선순위대로 4종 추가 구현. **신규 lib 2개**(`exportGlb.ts`·`cloner.ts`), 신규 패널(`PenToolModal.tsx`).

- **①.glb Export**: `src/lib/exportGlb.ts` `exportObjectsToGlb(objects3d, fileName)` — 라이브 Three 객체를 그룹으로 복제 → `GLTFExporter`(binary) → 브라우저 다운로드. 스토어 `requestExport`/`exportRequest`(요청-틱 패턴)로 `EditorCanvas` useEffect 핸들러가 현재 선택/전체를 굽는다. 만든 씬을 .glb로 반출.
- **②Radial cloner / ③Live parametric cloner (`src/lib/cloner.ts`)**: `DEFAULT_CLONER`·`clonerPlacement(cfg, i)`(linear/radial)·`regenerateCloner(objects, clonerGroupId, cfg)`(clonerClone 자식 제거→소스를 placement(0)로→i=1..count-1 클론 재생성, 그룹은 idMap 서브트리 복제). 스토어 `makeCloner(config?)`·`updateCloner`(파라미터 바꾸면 라이브 재생성)·`arraySelected(count, offset, radial?)`. **Array(1회 복제) vs 라이브 클로너(파라미터 유지·재생성) 구분** — 버튼 라벨 '한 번 복제'/'라이브 클로너'. `ObjectNodeSchema.clonerConfig`/`clonerClone` 태그.
- **④Extrude/Lathe 펜 툴 (`PenToolModal.tsx` + `primitiveGeometry.ts`)**: 2D로 그려 3D 생성. **돌출(Extrude)**=단면 폐곡선을 두께로 밀어 기둥, **회전체(Lathe)**=축 오른쪽 반쪽 프로파일을 360° 회전(도자기/컵). 스토어 `addProfileObject(shape, profile, extrudeDepth, closed)` → `PrimitiveShape 'extrude'|'lathe'` + `PrimitiveGeom.profile/profileClosed/extrudeDepth`. 팩토리 `makeExtrude`/`makeLathe`. 기능: 첫 점 클릭으로 닫기(포토샵식)·격자 스냅(중앙축 기준)·Catmull-Rom 스무딩·다중 점 드래그 이동·Ctrl+Z 점 취소·Delete 선택점 삭제. 툴바 ✏ + 커맨드팔레트 '펜 툴'로 오픈(`setPenToolOpen`).
  - **펜 툴 팝업 UX (2026-07-10)**: **헤더 드래그로 이동 + 뒤 overlay 제거**(씬 보며 작업 — 에디터 작업 팝업만 해당, 확인/공유 모달은 overlay 유지). 드래그 중에만 뜨는 투명 캡처 레이어로 마우스 추적, ✕/Esc로만 닫힘(바깥 클릭 닫기 없음). **돌출↔회전체 탭 전환 시 전체 지우기**(`switchMode` — 두 모드 그리기 방식이 달라 이전 점 이어그리기 방지).
- **검증**: tsc 클린. **브라우저 실동작 확인 완료(사용자 — 펜 툴 그리기·닫기·탭전환·스냅·다중드래그·팝업 드래그 이동 정상)**. Export/Cloner 실동작은 사용자 확인 완료 표기.

## 최근 완료 (2026-07-10) — 카메라 초기 뷰 + Inspector 수치 실시간 반영

- **초기 진입 시 자동 전체 맞춤 (에디터 + 탐색 뷰어)**: 넓은 공간을 저장 후 대시보드로 재진입하면 초기 뷰가 너무 가깝던 문제 → **들어오자마자 Shift+F(전체 맞춤) 뷰로 시작**. Shift+F(=`requestFocusAll`, 전체 맞춤)는 무변경.
  - **에디터**(`EditorCanvas`의 신규 in-Canvas `InitialFit`): `useFrame` 1회, `orbitRef` 준비될 때까지 대기 후 fit. **`sceneStore.sceneLoadTick`(loadScene마다 증가)에 묶어 '로드 시점'에만** 실행 → 새 빈 씬에서 첫 오브젝트 추가 시 카메라 튐 방지, 씬 전환 시 재-fit, 편집·저장 중엔 재-fit 안 함. **주의**: 처음엔 EditorCanvas '바깥' useEffect로 넣었더니 `orbitRef`가 `<Canvas>` 내부(R3F 별도 렌더러)에서 붙어 마운트 시 null → 안 걸림. **fit은 반드시 Canvas 내부 컴포넌트에서** 할 것.
  - **탐색 뷰어**(`ViewerCanvas`의 신규 `InitialFit`): 동일하게 `useFrame` 1회 one-shot(탐색 모드만). 기준은 에디터와 동일(루트 오브젝트 position bbox 중심 + 3/4 각도).
  - 한계: **position 기반 프레이밍**(Shift+F와 동일) — 원점에 큰 GLB 하나만 있는 씬은 다소 가까울 수 있음(focus-all을 실제 bbox 크기 기준으로 바꾸면 둘 다 개선, 후속).
- **Inspector 트랜스폼 수치 실시간 반영 (기즈모 드래그 중)**: 기존엔 기즈모가 드래그 중 Three 객체 ref만 조작하고 마우스업에 `commitTransforms` 1회만 커밋 → Inspector 수치가 놓을 때만 갱신되던 것 → **드래그 중 실시간 갱신**. **성능 격리가 핵심**: 매 프레임 `objects[]`를 갱신하면 전체 캔버스가 리렌더되므로(알려진 이슈), **메인 스토어와 분리된 라이브 채널**을 둠.
  - **`src/store/liveTransformStore.ts`(신규)**: `live: {id, position, rotation(deg), scale} | null` + `setLive`. 기즈모는 **구독 없이** `getState().setLive(...)`로 게시(기즈모 리렌더 X), Inspector의 Transform 입력부만 구독(그 서브트리만 리렌더). transient(저장 무관).
  - **`GizmoController`(SingleGizmo)**: `onChange`에서 매 프레임 게시(회전 deg 변환·y바닥 클램프 반영), `onMouseUp`에서 `setLive(null)` + 기존 `commitTransforms` 확정.
  - **`InspectorPanel`의 `LiveTransformRows`(신규 내부 컴포넌트)**: 라이브 채널 구독(`live.id===obj.id`면 라이브 값, 아니면 `obj` 값). `NumInput`이 focus 아닐 때 prop 변화를 반영하므로 그대로 동작. 다중 선택 패널엔 트랜스폼 수치가 없어 SingleGizmo만 대상(완전).
  - **재사용 규칙**: `liveTransformStore`가 표준 채널 — 앞으로 새 '직접 조작' 도구는 `setLive` 게시만 하면 관련 수치 표시부가 자동 실시간 반영. (사용자 지시: 수치 입력부는 이 패턴 적용)
  - 제약: 캐릭터 스폰 포인트 기즈모는 라이브 미게시(별도 `env` 값) → 스폰 좌표는 여전히 마우스업에 갱신(필요 시 동일 패턴 확장).
- **검증**: tsc 클린 + dev 컴파일 정상. **초기 진입 뷰(에디터/탐색)·실시간 Inspector 모두 브라우저 실동작 확인 완료(사용자).**

## 최근 완료 (2026-07-10) — 텍스처 매핑 (프리미티브 표면 이미지) + Textures 에셋

사용자 아이디어 목록 대조 결과 미구현이던 "텍스처 업로드 & 이미지 매핑" 구현(복셀은 미착수로 남김). 프리미티브 표면에 이미지(포스터/사진/로고)를 입힌다.

- **스키마(`scene.ts`)**: `MaterialOverride`에 `textureUrl?`·`textureRepeat?: {x,y}` 추가. `AssetRefSchema.type`에 `'texture'` 추가.
- **공용 렌더 `src/components/three/PrimitiveMaterial.tsx`(신규)**: 색상+선택적 `map`. `TextureLoader` **비동기 로드(비-Suspense)** → 인라인 mesh에 Suspense 경계 없이 안전. `wrapS/wrapT=RepeatWrapping`+`repeat(x,y)`, `SRGBColorSpace`. **텍스처 있으면 베이스 색을 흰색으로**(재질 색에 안 물들고 이미지 원본대로). key로 텍스처 유무 전환 시 재질 remount(셰이더 재컴파일 이슈 회피). 에디터(`EditorObjectInstance`)·뷰어(`ViewerObject`) 둘 다 이걸로 교체.
- **인스턴싱 제외**: 텍스처 있는 프리미티브는 단일 재질 배칭 불가라 `getInstancedIds`·`InstancedPrimitives` 두 곳에서 제외 → 개별 렌더(텍스처 유지).
- **에셋 DB 등록 승격 `uploadImageTexture(file, projectId)`(`uploadAsset.ts`)**: GLB·오디오와 동일 패턴 — Storage(`textures/{pid}/`) + `assets` DB행(type `'texture'`, 썸네일=이미지 자체). 기존 ground/boundary처럼 "URL만 쓰고 버리는" 방식이 아니라 **라이브러리에서 재사용 가능 + 삭제로 정리 대상 추적**.
- **AssetBrowser Textures 탭**(WIP 해제): 썸네일 그리드(`TextureCard`) + 업로드 + **클릭→선택한 프리미티브(들)에 적용**(`applyTextureToSelection`) + 삭제. `modelAssets` 필터에서 texture 제외.
- **Inspector Material 텍스처 UI**: "Texture (이미지)" 라벨 옆 **Toggle 스위치**(켜면 영역 표시, 텍스처 있으면 자동 ON, 끄면 해제) + **`TexturePicker`(신규 `src/components/ui/TexturePicker.tsx`)** — SelectBox 형태(트리거+`useDropdown`)이되 드롭다운이 **3열 썸네일 그리드 + 맨 아래 넓은 업로드 버튼**. 적용 시 미리보기 + 타일 반복(가로/세로) 컨트롤. 공용 `SelectBox`는 텍스트 전용/앱 전역 사용이라 텍스처 전용으로 분리(위치·닫기 로직은 useDropdown 공유).
  - 텍스처 넣는 경로 3가지: ①Material 스위치→픽커 ②픽커 하단 업로드 ③Textures 탭 선택→적용. 업로드는 전부 `uploadImageTexture`로 assets>texture 등록.
- **검증**: tsc 클린 + dev 컴파일 정상. **브라우저 실동작 확인 완료(사용자 — 매핑·타일반복·Textures 탭·스위치·썸네일 픽커 정상).**
- **알려진 제약**: 프리미티브만(GLB 자체 재질·텍스트 콘텐츠 제외) · 면별 텍스처 아님(도형 전체 UV) · 라이브러리에서 텍스처 삭제해도 적용된 오브젝트의 `material.textureUrl`은 자동 정리 안 됨(로드 실패 시 색상으로 graceful 폴백, 참조 GC는 후속) · 에셋은 씬 단위(scene_data.assets[], 다른 씬과 공유 X — 모델·오디오와 동일).

## 최근 완료 (2026-07-10) — 복셀(Voxel) 방식 (마인크래프트식 큐브 쌓기)

사용자 아이디어 목록 중 마지막 미구현이던 복셀 구현. 펜 툴/Merge와 **동일 파이프라인**(모달 → GLB로 bake → 에셋 등록 → 배치)이라 뷰어/임베드/물리/인스턴싱 코드 무변경으로 렌더된다. **인앱 모델링(프리미티브·펜·클로너·익스포트·텍스처·복셀) 스코프 전부 완료.**

- **스토어**: `voxelToolOpen`/`setVoxelToolOpen`(penToolOpen 미러).
- **bake 로직 `src/lib/voxelModel.ts`(신규)**: `buildVoxelGlb(voxels)` — 각 복셀=1×1×1 BoxGeometry, **정점 색(vertex color)으로 단일 메쉬에 병합**(`mergeGeometries`)해 드로우콜/파일 최소화. sRGB→linear 변환(정점색은 선형). X/Z 중심 정렬 + 바닥(min.y) 0에 앉힘 → GLTFExporter binary. `MeshStandardMaterial{vertexColors:true}`.
- **에디터 `src/app/editor/[projectId]/panels/VoxelToolModal.tsx`(신규)**: 펜 툴과 동일한 **드래그 이동 + no-overlay** 작업 팝업.
  - **2D 그리드 페인터**(SVG) — **좌클릭 칠하기 / 우클릭 지우기**(드래그 지원, `paintMode` ref로 드래그 중 일관), 컨텍스트메뉴 차단.
  - **색상**: 컬러픽커 + **프리셋 SelectBox**(각 옵션에 색 스와치 아이콘). **그리드 크기 SelectBox**(8/16/24/32, 픽셀 고정 340이라 칸수↑=칸작아짐, 줄이면 범위 밖 복셀 제거).
  - **높이(Y) 레이어** ±로 쌓기. **쌓기 도우미**: 바로 아래층=보라 점선 외곽선, 더 아래층=옅은 발자국, **「아래 복사」**(아래층을 현재층에 복사=기둥·벽), 3D에 **현재 편집 층 반투명 판**.
  - **실시간 3D 미리보기**(R3F Canvas + OrbitControls, **무한 그리드**, 그리드 중심 고정) — 쌓이는 모습 즉시 확인.
  - **전체 지우기 = 완전 초기화**(복셀 + 높이 0). 그리드 선은 배경 대비 `currentColor`(전경색) 기반.
  - **만들기** → `buildVoxelGlb` → `uploadGlbBlob`(model) → `addAsset`+`addAssetObject`(바닥 스냅 배치) → persist.
- **진입점**: 툴바 🧊(펜툴 ✏ 옆) + 커맨드팔레트 '복셀 (큐브 쌓아 만들기)'.
- **검증**: tsc 클린 + dev 컴파일 정상. **브라우저 실동작 확인 완료(사용자 — 칠/지우기·색·크기·쌓기 도우미·미리보기 정상).**
- **알려진 제약/후속**: ~~레이어별 2D 페인팅(3D 면 클릭 아님)~~ **[3D 클릭 빌드 완료 2026-07-16]** · 내부 면 컬링 없음(단일 메쉬라 실사용 크기엔 무난) · ~~색만(텍스처 스킨)~~ **[단일 스킨+색별 텍스처 완료 2026-07-16 — 위 참고]** · 그리드 크기 변경 시 3D 카메라는 마운트 시점 값 유지(재프레이밍은 orbit으로).

## ✅ 브라우저 실동작 확인 완료 (2026-07-10, 사용자 일괄 검증)

아래 항목 전부 브라우저 실동작 확인됨 — 개별 항목 본문의 "브라우저 확인 필요" 표기는 이 확인으로 해소:
- **Prefab MVP** (만들기·배치·override·Apply·Revert·삭제)
- **인앱 모델링** (각뿔대·둥근 박스·Merge·Boolean·Loft)
- **경계 벽**(Boundary Walls) · **프로젝트 복제** · **임베드 E2E**
- (앞서 확인된) 그룹/변환/undo 버그 4종 · 그룹 스코프 · 기즈모 피벗 통일 · 모션 spin wobble(피벗 보정)

## 최근 완료 (2026-07-09) — Prefab MVP (원본↔인스턴스 동기화)

- **설계 합의**: (사용자 결정) **씬 단위 저장**(scene_data.prefabs[], DB 마이그레이션 없음·후속에 프로젝트 단위 승격 가능) + **필드그룹 단위 override**(material/events/motion/physics/transform/… 그룹별 override·revert).
- **핵심 아키텍처 — "인스턴스는 진짜 오브젝트로 굽는다(bake)"**: 인스턴스는 실제 `ObjectNodeSchema` 오브젝트들로 `objects[]`에 존재하고 프리팹 링크 태그(`prefabId`/`prefabInstanceId`/`prefabNodeKey`/`prefabOverrides`)만 붙는다 → **뷰어/임베드/물리 코드 무변경**(평범한 오브젝트로 렌더). 동기화·override는 전부 **에디터 전용 연산**. 그룹(Group)과의 차이 = 원본-사본 연결(동기화)+재사용 레이어.
- **스키마(`src/types/scene.ts`)**: `PrefabSchema`(id/name/rootKey/nodes[])·`PrefabNode`(nodeKey/parentKey/data — 절대 id/parentId 대신 안정적 key로 트리)·`PrefabNodeData`(Omit)·`PrefabOverrideGroup`(11종). `ObjectNodeSchema`에 프리팹 태그 4종(전부 옵셔널=하위호환). `ProjectSceneSchema.prefabs?[]` + `normalizeSceneData` 처리. `saveScene.ts`도 prefabs 직렬화.
- **순수 로직(`src/lib/prefab.ts`)**: `buildPrefab`(선택 루트+자손→정의+태그)·`instantiate`(정의→bake 오브젝트, id 리맵)·`mergeDefIntoNode`(override·루트 transform 존중 병합)·`syncInstances`(전 인스턴스 재동기화 — 구조 add/remove 포함)·`rebuildPrefabFromInstance`(Apply — 루트 배치 transform은 def에 안 밀어넣음)·`overrideGroupsFromPatch`(필드→그룹).
- **스토어(`sceneStore.ts`)**: state `prefabs[]` + 액션 `createPrefab`/`instantiatePrefab`/`applyInstanceToPrefab`/`revertInstance(group?)`/`deletePrefab`/`renamePrefab`. **override 자동 기록**: `updateObject`가 인스턴스 노드 편집 시 바뀐 필드의 그룹을 `prefabOverrides`에 누적(루트 transform은 항상 인스턴스 소유라 제외). **undo/redo에 prefabs 스냅샷**(HistoryEntry.prefabs? — 프리팹 액션만 채움, 비프리팹 액션은 미변경 유지).
- **override/동기화 규칙**: 루트 position/rotation/scale = **항상 인스턴스 소유(동기화 안 함)**. 그 외(자식 transform·material·events·motion·physics·content·light·particle·name·visibility·dialogue) = 원본 따름, **인스턴스에서 건드린 필드그룹만 원본 이탈**. 구조(자식 추가/삭제)는 원본이 소유(sync가 인스턴스에 맞춤). **Apply**=인스턴스 상태→정의(루트 배치 제외)→다른 인스턴스 재동기화(각자 override 보존)+소스 override 클리어. **Revert**=override 버리고 원본 재당김(그룹 지정 시 그 그룹만). **Delete**=정의만 삭제, 인스턴스는 태그 벗고 독립 오브젝트로 유지.
- **UI(`InspectorPanel.tsx`)**: (1) 단일 오브젝트 Inspector 상단 **Prefab 섹션** — 비인스턴스 루트엔 '프리팹으로 만들기', 인스턴스엔 원본명·인스턴스 수·override 배지(클릭=그 그룹만 revert)·'원본에 반영(Apply)'·'원본으로 되돌리기(Revert all)'. (2) 빈 선택(Environment) 패널에 **Prefab 라이브러리** — 정의 목록·인스턴스 수·'배치(instantiate)'·삭제.
- **검증**: **tsc 클린** + **순수 로직 시나리오 테스트 15/15 통과**(build→instantiate→자식 override→def 수정 sync[override 인스턴스는 값 유지·나머지는 따라감]→루트 배치 유지→Apply→구조 노드 추가 전파, `tsx` 임시 스크립트) + **에디터 라우트 200(라이브 인증 세션 컴파일 정상)**. **에디터 실클릭(만들기→배치→override→Apply/Revert) 브라우저 확인 필요**.
- **MVP 범위/제약(후속)**: 씬 단위(다른 씬 재사용 X — 프로젝트 단위 승격은 후속) · 프리팹 썸네일 미생성 · 인스턴스에서의 **구조 편집(자식 추가/삭제)은 미보존**(sync가 정의 구조로 맞춤) · 라이브러리 배치는 원점(드래그 배치·바닥 스냅 연동 후속) · Apply는 선택 인스턴스 1개 기준 · 중첩 프리팹(프리팹 안 프리팹) 미검증.

## 최근 완료 (2026-07-08~09) — 에디터 카메라 손질 (모두 `EditorCanvas` `OrbitControls`/Canvas)
- **초기 카메라 더 멀리**: Canvas `camera.position` `[5,4,8]`(원점 거리 ~10) → `[9,7,13]`(~17.3)로 뒤로 빼 씬 전체가 보이게.
- **휠 줌: 스텝↑ + '확대 안 먹던' 버그 수정**: (1) `zoomSpeed={2}` 추가(기본 1이라 많이 굴려야 했음). (2) **진짜 원인** — `onChange`가 `ctrl.object.position.y < 0.3`을 직접 클램프해, 카메라를 낮은 각도로 내리면 휠 dolly가 대상 쪽으로 당길 때 이 클램프가 카메라를 도로 위로 밀어 **줌을 상쇄**(카메라 움직인 뒤 휠 막 굴려도 확대 안 되던 증상)했음 → position.y 직접 클램프 **제거**(target.y≥0 + `maxPolarAngle`<90°(0.02→0.08) 조합이면 카메라는 항상 바닥 위라 불필요).
- **관성(damping) 제거**: `enableDamping={false}` — drei 기본값이 켜져 있어 드래그 놓아도 스르륵 미끄러지던 것 → 손 떼면 즉시 멈춤.
  - **플레이 모드 카메라도 관성 제거 (2026-07-09)**: `PlayModeController` 팔로우 카메라가 `camera.position.lerp(_camPos, 0.1)`이라 드래그로 방위(azimuth)는 즉시 바뀌는데 카메라 위치는 프레임당 10%씩만 따라가 **회전 시 미끄러지고 손 떼도 스르륵 이동**하던 것 → `camera.position.copy(_camPos)`로 궤도 지점에 즉시 스냅. **캐릭터 추적의 부드러움은 `camTarget.lerp(_targetPos, 0.12)`가 담당**하므로 팔로우 자체는 여전히 부드러움(회전 관성만 제거). 포커스(줌) 분기의 lerp는 의도된 애니메이션이라 무변경. 검증: 1줄 수정. **실동작 브라우저 확인 필요**.
- **우클릭 패닝이 각도를 바꾸던 버그 수정**: `screenSpacePanning={false}` — 기본(화면평면 패닝)일 땐 비스듬한 각도에서 세로 드래그에 월드 Y성분이 섞이고, `onChange`의 `target.y<0` 클램프가 **타겟만 붙잡고 카메라는 안 붙잡아** 각도가 정면으로 눕던 문제 → 바닥평면(XZ) 패닝으로 바꿔 타겟 y 불변 → 각도 안 바뀜(사용자 기대 "우클릭=바닥 이동"과도 일치).
- 검증: 모두 tsc 클린. **에디터 인증 필요 → 브라우저 실동작 확인 대기**.
- **참고(현 마우스 스킴)**: 회전=**Ctrl+좌클릭**, 패닝=우클릭, 선택박스=좌클릭, 줌=휠. (사용자는 ctrl+우클릭=회전으로 기대했음 — 원하면 `mouseButtons`로 추가 가능.)
- **미해결/후속 (2026-07-09 중단, 다음에)**:
  - **확대 시 패닝/줌이 거리비례라 찔끔찔끔** — 근본 해법은 **"선택 오브젝트로 포커스"**(F키/더블클릭 → orbit pivot을 선택물로 이동+프레이밍). 현재 없음. 사용자에게 추가 제안했고 **보류(오늘은 여기까지)**. `cameraViewRequest`(시점 프리셋)·`cameraBookmarks`는 이미 있음 → 이걸 참고해 `focusSelected` 스토어 액션+`EditorCanvas` 핸들러로 구현 예정.
  - 옵션 후보: `zoomToCursor`(커서 쪽으로 줌 — 사용자 설명은 했으나 미적용), ctrl+우클릭 회전 매핑.

## 최근 완료 (2026-07-08) — UX 수정 3건
- **잠긴 오브젝트 클릭 시 선택 해제**: 오브젝트 선택 후 잠긴 오브젝트를 클릭하면 선택이 안 풀리던 문제(잠긴 것은 R3F가 hit 처리 → `onPointerMissed` 미발동, `handleClick`은 `if(locked) return`이라 아무 것도 안 함) → 세 `handleClick`(라이트/프리미티브·콘텐츠/GLB)의 잠금 분기를 `if(object.locked){ if(!shiftKey) selectObject(null); return; }`로 변경 → 잠긴 것 클릭 = 빈 공간 클릭처럼 선택 해제(shift+클릭은 다중선택 유지 위해 무변경). 검증: tsc 클린.
- **Mood '기본' 복귀 버튼**: Mood 프리셋을 한 번 누르면 되돌릴 수 없던 문제 → `MOOD_PRESETS` 맨 앞에 **'기본(↺)'** 추가 — `hdrPreset:'none'`(DefaultEnvironment IBL)·`toneMappingExposure:1`·라이트를 `DEFAULT_ENVIRONMENT` 값으로 되돌림(무드 해제). 기존 프리셋 적용 경로(`updateEnvironment`) 그대로 재사용. 검증: tsc 클린.
- **E 포커스 카메라 정면(수평)화**: 플레이 모드 E 포커스(`focus_object`) 시 카메라가 캐릭터가 보던 상하 틸트를 그대로 유지해 위/아래에서 비스듬히 보이던 문제 → `PlayModeController` 포커스 분기에서 카메라 방향의 **Y성분 제거(수평화)** + 대상 중심과 같은 높이 배치 → 정면·수평 시선. 수평 방위(azimuth·좌우 방향)는 유지(현재 서 있는 쪽에서 정면으로). 탐색 모드 focus(`CameraFocus`)는 무변경. 검증: tsc 클린 + dev `/test/move-object` 200. **실동작 브라우저 확인 필요**(특히 포커스 정면 앵글 느낌).

## 최근 완료 (2026-07-08)

- **상호작용 근접 범위(interactRange) 설정 — 씬 기본값 + 오브젝트별 오버라이드**: 기존 3m 고정(`PlayModeController` 상수)이던 것을 설정 가능하게. **우선순위: 오브젝트값 > 씬 기본값 > 3**. interact(E)·approach·E 프롬프트·하이라이트가 이 범위를 공유. 스키마: `EnvSchema.interactRange?`(씬 기본) + `ObjectNodeSchema.interactRange?`(오브젝트 오버라이드). 배선: `PlayCanvas`가 `effRange(o)=o.interactRange ?? scene.environment.interactRange ?? 3`를 **interactables/approachables 각 항목의 `range`**로 실어 보냄 → `PlayModeController` 근접 루프가 단일 `interactRange` 대신 **항목별 `it.range`**로 판정(interact=자기 범위 내 최근접, approach=자기 범위 경계). 에디터: Environment '**Interaction**' 섹션에 '상호작용 범위 기본값(m)' LabeledNum + Inspector '**Events**' 섹션 상단에 오브젝트별 '상호작용 범위(m)' 입력(비우면 씬 기본, placeholder로 기본값 표시, '기본값' 버튼으로 해제). 검증: tsc 클린. **실동작 브라우저 확인 필요**(범위 줄이면 더 가까이서 E 뜨는지, 오브젝트값이 씬값 오버라이드하는지).
- **플레이 모드 카메라 포커스(줌) + 상호작용 중 이동 잠금**: `focus_object`가 탐색 전용이라 플레이에서 무시되던 것 → **플레이 모드에서도 대상 오브젝트로 카메라 줌**(팔로우 카메라 오버라이드). 용도: E로 작품/NPC에 다가가 **줌 + 팝업/컨텐츠** 표시("살펴보기"). **복귀=팝업 닫기(A안)**: 팝업 닫으면 카메라가 캐릭터 팔로우로 복귀. 배선: `ViewerClient`에 `playFocus`(대상 id) state + `focus_object`가 playMode면 `setPlayFocus`(아니면 기존 `setFocusRequest` 탐색). `ViewerCanvas`가 `objWorldPos`/`objFocusRadius`로 월드좌표+반경 계산해 `focusPoint`를 `PlayCanvas`→`PlayModeController`로 전달 → useFrame이 팔로우 대신 대상 프레이밍(현재 방향 유지·fov 기반 거리, lerp). **이동 잠금(확장형)**: 중앙 상수 `MOVEMENT_LOCKING_ACTIONS`(현재 show_popup·focus_object) — 플레이에서 이 액션 발동 시 `interactionLock` on → `PlayModeController`가 WASD/모바일/점프 입력 무시(중력·낙사는 유지). **`endInteraction()`**(팝업 닫기 버튼·Esc·모드 전환)이 팝업 닫기+포커스 복귀+잠금 해제를 한 번에. 새로 "발동 중 이동 막을 액션"은 상수에 추가만 하면 적용. 제약: 포커스 단독(팝업 없이)일 땐 Esc로만 빠져나옴(온스크린 힌트 미표시 — 후속). area 팝업도 잠금 대상(walk 중 멈춤) — 원치 않으면 상수에서 show_popup 제거. 검증: tsc 클린. **실동작 브라우저 확인 필요**(E→줌+팝업→이동 잠김→닫기→복귀+잠금해제, 탐색 focus 회귀 없음).
  - **포커스 프레이밍 수정(2026-07-08)**: 범위 좁혀(예 1m) 가까이서 포커스 시 카메라가 대상을 벗어나 넘어가던 문제 → 포커스 지점을 오브젝트 **원점(objWorldPos)이 아니라 월드 bbox '중심'**으로(`worldBBox` 사용) + 반경도 실제 bbox 크기 기준. GLB 원점이 발밑/비대칭이라 원점을 프레이밍하면 형상이 프레임 밖으로 밀리던 게 원인. bbox 미로딩 시 기존 원점+근사 반경 폴백. (탐색 모드 focus_object는 아직 원점 기준 — 필요 시 동일 적용)
  - **보완(2026-07-08)**: (1) 잠금 중 **드래그/터치 카메라 회전도 차단**(`PlayModeController` 드래그 핸들러를 `lockedRef`로 게이트) → 팝업/포커스 중 화면 안 돎. (2) 팝업 backdrop이 뒤 캔버스 클릭을 가리고 회전도 막혀 **팝업 안만 상호작용**. (3) **팝업 overlay(배경) 클릭 닫기 제거** → 오직 '닫기' 버튼으로만 닫힘. (4) 포커스 **줌 거리 계수 1.6→2.2**(덜 당김).
- **Events — `approach_enter`/`approach_exit` 트리거(근접 자동 발동)**: 목적 — NPC에 **다가가면 키 없이 자동으로** 모션/사운드 등이 발동(다가감→말풍선(기존 dialogue show=approach)+모션(신규 approach)→E로 선택(기존)의 풀 NPC 흐름 완성). **area와의 차이**: area=센서 콜라이더 **볼륨 진입**(오브젝트 관통 필요·임의 구역), approach=오브젝트 중심 **반경 근접**(interact와 동일 3m·**솔리드 유지 가능**·하이라이트/말풍선과 범위 일치). 둘은 역할 분담(구역 트리거 vs 물체 근접)이라 area는 유지. 배선: 스키마 `EventSchema.trigger`에 2종 추가 → `PlayModeController`에 `approachables`(위치 목록)+`onApproachEnter/Exit` prop + useFrame가 `approachingRef`(Set)로 오브젝트별 반경(interactRange) 경계 교차 감지해 enter/exit 1회씩 콜백 → `PlayCanvas`가 approach_enter/exit 이벤트 가진 루트 오브젝트로 목록 구성·`onObjectClick(obj, trigger)`로 디스패치 → `ViewerClient.handleObjectEvent`가 기존 액션 파이프라인 재사용(모든 액션 지원: play_animation·popup·sound·move·... 자동). 에디터: 트리거 드롭다운 2종 + `TRIGGER_LABELS` + 근접 안내 힌트(솔리드 유지·구역은 area 안내). **플레이 모드 전용·루트 오브젝트만**(interact와 동일 제약). 검증: tsc 클린 + **브라우저 실동작 확인 완료(2026-07-08 — 다가가면 자동 모션 정상)**.
- **interact(E) 트리거에서 자기 `play_animation` 재생 지원**: 문제 — interact 하이라이트는 **3m 근접**(`PlayModeController` interactRange)에서 뜨는데, 애니메이션은 area_enter(**센서 콜라이더 접촉**) 경로로만 걸 수 있어 "E 하이라이트는 뜨는데 애니는 안 돎"는 범위 불일치. 근본 원인: `play_animation`(자기 자신)이 click/hover(`ViewerObject` internalClip)·area(`PhysicsObject` activeClip)에서만 재생되고 **interact 트리거엔 배선이 없었음**(interact는 `handleObjectEvent`로 가는데 거기선 `animate_object`만 클립 처리). → `ViewerClient.handleObjectEvent`에 `play_animation` 분기 추가: `setClipRequests[obj.id]`(→ `ViewerObject` externalClip)로 라우팅해 **모든 트리거(특히 interact/E)에서 자기 클립 재생**. 이제 **interact + play_animation** 하나로 "근접 하이라이트+E프롬프트 → E 누르면 애니메이션"이 같은 상호작용에 묶임(area_enter 우회 불필요). click/hover/area는 기존 경로와 중복되나 같은 클립+React 배치라 무해(단일 재생). 에디터는 트리거 무관하게 play_animation 클립 입력(GlbClipPicker) 노출돼 수정 불필요. 검증: tsc 클린. **실동작 브라우저 확인 필요**(interact+play_animation 걸고 근접→E→재생, area 없이).
- **말풍선 벽 뒤 오클루전**: `SpeechBubble`(drei `Html`)에 `occlude` prop 누락으로 벽 뒤 오브젝트의 말풍선이 depth 무시하고 화면 최상단에 그려지던 것 → `occlude` 추가(씬 전체 레이캐스트). 매 프레임 카메라→말풍선 앵커 레이캐스트해 사이에 메쉬 있으면 `display:none`. GLB·프리미티브·콘텐츠 말풍선 공용 컴포넌트라 한 번에 적용. 방식: 부분 가림 아니라 앵커점 온/오프(딱 끊김). 유의: 낮은 카메라 각도서 자기 몸통에 순간 가려 깜빡일 수 있음(앵커=bbox.max.y+0.25). 검증: tsc 클린 + **브라우저 실동작 확인 완료(2026-07-08)**.
- **GLB 기본 애니메이션 클립(`defaultClip`) — 트리거 없이 자동 재생 (MVP-A)**: 지금까지 GLB 내장 클립은 **이벤트 트리거로만**(click/hover=`play_animation`, area=센서, `animate_object`) 돌았음 → 트리거 없이 **씬 로드 시 자동 루프 재생**할 기본 클립을 오브젝트별로 선택 가능하게. 용도: 돌아가는 선풍기·펄럭이는 깃발·idle 캐릭터. `motion`(트랜스폼 앰비언트)과 별개(GLB 내장 클립). 스키마 `ObjectNodeSchema.defaultClip?: string`. 뷰어 `GlbViewer`에 `defaultClip` prop + 마운트 시 `action.setLoop(LoopRepeat, ∞).fadeIn(0.3).play()` effect(기존 `playClip` effect보다 먼저 — 초기 playClip=null이라 안 끊김). **트리거 클립이 오면** 기존 `playClip` effect가 전 액션 fadeOut 후 트리거 클립 재생 → default가 자연스럽게 덮임. **MVP-A 결정**: 트리거(1회성) 클립 종료 후 idle 복귀는 **없음**(playClip이 null로 리셋 안 되므로). 에디터: Inspector에 **Animation 섹션**(Motion 아래·Events 위, GLB 전용 `!isGroup && assetId`) — 기존 `GlbClipPicker` 재사용(클립 목록 자동 파싱) + '기본 애니메이션 해제' 버튼. 에디터 정적·**뷰어 전용**. 검증: tsc 클린. **실동작 브라우저 확인 필요**(default clip 지정→로드 시 자동 재생, 클릭 트리거로 override).
- **잠긴(locked) 오브젝트 하이라이트/선택 차단**: (1) **호버 하이라이트 차단** — `EditorObjectInstance`의 `hovered` state가 lock을 무시해 잠긴 오브젝트도 마우스 올리면 emissive/와이어박스/box3Helper가 뜨던 것 → `handlePointerOver`에서 `object.locked`면 `setHovered(true)` 무시 + GLB `onHoverChange`도 `h && !object.locked`로 게이트(이 `hovered` state 하나가 프리미티브·콘텐츠·GLB 세 경로 하이라이트를 전부 구동). (2) **잠글 때 선택 해제** — 스토어에 `setObjectLocked(id, locked)` 신설(`updateObject`의 `_prevSnapshot` 패턴 → `pushHistory` 1회 undo), 잠금 시 해당 id를 `selectedIds`/`selectedId`에서 제거 → 선택 하이라이트·기즈모 즉시 분리(`GizmoController`는 이미 `!locked` 게이트라 이중 안전). `HierarchyPanel` 🔒 토글이 이 액션 사용. 클릭 선택은 기존에 `if (object.locked) return`으로 막혀 있었음. 검증: tsc 클린 + **브라우저 실동작 확인 완료(2026-07-08 — 잠긴 것 호버 무반응·잠글 때 선택 즉시 해제 정상)**.
- **Events E3-B — 문/콜라이더 토글(`set_passable`/`set_solid`/`toggle_collision`)**: 플레이 모드에서 대상 오브젝트의 **콜라이더만 런타임 on/off**(시각은 유지) → "E키→문 열림 애니→통과 가능" 시나리오. 스키마 `EventSchema.action`에 3종 추가(value=대상 objectId). 배선: `ViewerClient`에 `passOverride`(objectId→passable) state + 핸들러(set_passable=true / set_solid=false / toggle_collision=반전) → `passableIds` Set을 `ViewerCanvas`→`PlayCanvas`로 전달. `PlayCanvas`가 통과 대상을 **모든 콜라이더 버킷(auto/physics/movingCollider/그룹)에서 제외하고 시각 전용(`passableVisualObjects`/`movingGroups`)으로만 렌더**. **덤으로 hide_object 콜라이더 누수 수정**: `autoObjects`/`physicsObjects`가 `o.visible`을 무시해 숨긴 오브젝트에 '보이지 않는 벽'이 남던 것 → `o.visible` 필터 추가. 그룹 라우팅은 **여집합(`movingGroups = allGroups − movingGroupColliders − groupObjects`)**으로 재작성해 통과+모션+콜라이더 조합에서 렌더 누락 방지. 에디터: 이벤트 Action 드롭다운에 3종 추가(대상 오브젝트 SelectBox + 플레이 전용/콜라이더만 토글 안내). 임베드도 ViewerClient 공유라 자동 지원. 검증: tsc 클린 + **브라우저 실동작 확인 완료(2026-07-08 — E/클릭→콜라이더 제거→통과, toggle 반복 정상)**.
- **배열/반복 툴(Array)**: 선택 오브젝트를 일정 간격으로 N개(원본 포함)까지 복제 — 울타리·기둥·계단 등 반복 배치. `sceneStore.arraySelected(count, offset)`(duplicateSelected의 그룹 재귀 복제 패턴 재사용, `withHistory`로 단일 undo) → 복제 i개(i=1..count-1)를 `position + offset*i`에 추가, 그룹이면 하위 계층 idMap 재매핑. 에디터: Inspector **Array 섹션**(Transform 아래, **기본 접힘**) — 개수(2~100)·간격 XYZ(m)·'배열 생성' 버튼 + 토스트. 모든 오브젝트 타입 지원(그룹 포함). 검증: tsc 클린 + **브라우저 실동작 확인 완료(2026-07-08 — 간격 두고 N개 복제 정상)**.
- **Inspector 단일/그룹 패널 통합**: 그룹이 `if (obj.isGroup) return (...)` **별도 축소 패널**이라 새 기능이 그룹에 자동으로 안 따라오던 **드리프트 문제**(모션이 그룹에 안 뜸/안 돎이 전부 이 뿌리) → **early-return 삭제하고 메인 Inspector 하나로 통합**, 섹션을 오브젝트 타입별 조건부 노출로 처리. 그룹은 `obj.isGroup`로 게이트: 헤더 `Inspector — 그룹`, Transform/Visibility/Motion 노출, **Physics·Events 숨김**(그룹 자체는 충돌/클릭 타깃 아님 — 자식 개별 처리), 하단 '그룹 해제(Ctrl+Shift+G)' 안내. Content/Material/Particle/Light는 기존 조건부(그룹은 자동 숨김). Motion 콜라이더 토글도 그룹 노출(라벨만 그룹용). → 앞으로 새 섹션은 자동으로 그룹에도 일관 적용. 검증: tsc 클린.
- **그룹 자식 콜라이더 개별 라우팅**: `GroupWithCollision`이 그룹 자식을 **무조건 fixed 콜라이더**로만 그려 자식 개별 `motion`/`collider` 설정을 무시하던 버그(정적 그룹인데 이동 장애물로 설정한 자식도 정적 벽이 됨) → 자식도 **루트와 동일 라우팅**: 판정 함수(`isMovingColliderObj`/`isVisualOnlyMotionObj`)를 모듈로 승격해 공유. (1) `MovingCollider`를 **월드 베이스(`worldMatrix` 부모체인 합성) + 스케일 그룹**으로 재작성 → kinematic이 월드 좌표로 구동돼 **정적 그룹의 자식도 이동 장애물**로 동작(루트면 로컬=월드). 라우팅을 루트→`movingColliderObjects`(전 depth, 숨은/움직이는 그룹 조상 제외)로 확장. (2) 정적 그룹 자식 중 **모션+콜라이더OFF → 콜라이더 없이 시각만(통과)**, **이동콜라이더 자식은 상위서 월드 kinematic으로 → GroupWithCollision에선 스킵**(이중 렌더 방지), **중첩 모션 그룹 자식 → 시각 전용 애니**(중첩 그룹 kinematic은 v1 미지원). 검증: tsc 클린 + `/space` 200. **실동작 브라우저 확인 필요**(정적 그룹 안에서 이동콜라이더 자식만 움직이고 정적 자식은 벽, OFF 자식은 통과).

## 최근 완료 (2026-07-07)

- **Events E3-A — `interact` 트리거(다가가 E키)**: 플레이 모드에서 캐릭터가 interact 이벤트를 가진 오브젝트에 **근접(기본 3m)**하면 화면 하단에 **`E` 키캡만** 뜨고(이름 미표시 — 대상은 3D 하이라이트로 구분), **동시에 근접 대상 오브젝트가 하이라이트**(emissive 글로우만 — 플레이 모드는 무-외곽선 규칙 유지라 아웃라인/박스는 안 씀)돼 어디에 E를 눌러야 할지 보임. **E키(모바일=우하단 원형 E 버튼)**로 그 오브젝트의 이벤트 발동(팝업/씬이동/애니메이션 등 기존 액션 파이프라인 재사용). 하이라이트 배선: `InteractHighlightContext`(근접 대상 id)를 R3F 트리에 내려 `ViewerObject`가 자기 자신이면 emissive/아웃라인 on — 호버 하이라이트와 통합(`emissiveOn`/`outlineOn`, 아웃라인은 탐색 모드 호버 전용 — 플레이 모드는 호버·interact 모두 글로우만, 무-외곽선). NPC 대화·간판·아이템·"눌러서 열기"용. **센서 통과는 버그가 아니라 트리거 영역의 정의**임을 확인한 뒤 나온 후속 기능(플랫폼이 "게임적 상호작용"으로 한 걸음). 배선: `PlayModeController` useFrame이 플레이어↔interactable 최근접 산출(대상 변할 때만 콜백) + `KeyE` keydown 발동 → `PlayCanvas`가 interact 이벤트 있는 **루트** 오브젝트 목록 전달·id→obj 매핑 → `ViewerCanvas` 통과 → `ViewerClient`가 프롬프트 HTML·모바일 버튼·`interact` 디스패치·애널리틱스(`interact`) 담당. 에디터는 트리거 드롭다운에 `Interact (E)` + 안내문. **탐색 모드에선 발동 안 함**(캐릭터 없음 — 클릭으로 대체). 검증: tsc 클린 + 인증 세션 `/space`·`/editor` 200 + **브라우저 실동작 확인 완료(2026-07-07 — 근접·E키·하이라이트 정상)**.
  - **E3-A 추가 — 대화 말풍선 시스템(`dialogue`)**: 오브젝트 위에 뜨는 순차 문장. `ObjectNodeSchema.dialogue = { lines[], show:'always'|'approach'|'interact', advance:'auto'|'manual', autoSec?, speaker?, typing? }`. (레거시 `interactLabel`은 `effectiveDialogue`가 `lines:[label]·approach·auto`로 자동 변환.) **표시 시점** 항상/다가가면(3m)/E키로 열기, **넘기기** 자동(타이머 autoSec)/E키, **타이핑(타자기) 효과**, **화자 이름**(말풍선 상단). 상태 머신은 `useObjectDialogue` 훅(오브젝트별 idx/opened/typed) — early return 전에 호출. E키 advance는 `DialogueAdvanceContext`(nonce)로 3D 트리에 전달, **가장 가까운 대상만**(interactActive) 반응. nonce는 `ViewerClient.handleObjectEvent`가 trigger==='interact'일 때 bump(추가 배선 없음 — E는 항상 이 경로). 렌더: GLB는 `GlbViewer`가 bbox.max.y, 프리미티브/콘텐츠(텍스트·이미지)는 `ViewerObject`가 0.5·scale.y 오프셋. 근접 감지 대상(`interactables`)=interact 이벤트 OR 근접 필요 대화(항상+자동 앰비언트는 근접 불필요라 제외). E 프롬프트=interact 이벤트 OR dialogue.show==='interact'. 동시 말풍선은 근접 1개(+항상 표시 오브젝트들). 에디터: Events 섹션 상단 '대화 말풍선'(textarea 한 줄=한 문장 + 표시/넘기기 SelectBox + 간격/화자/타이핑). 검증: tsc 클린 + dev 컴파일/렌더 200 + **브라우저 실동작 확인 완료(2026-07-07 — 표시시점 3종·넘기기 2종·타이핑·화자·E 열기/넘기기 정상)**. (한글 말풍선이 세로로 나오던 버그 = drei Html shrink-to-fit + CJK 줄바꿈 → `width:max-content`+`wordBreak:keep-all`로 수정.) 제약: 루트 오브젝트만·플레이 전용·영상/빈 콘텐츠 미지원·선택지/조건부는 미구현(후속). 고도화 후보(미착수): 대사 종료 시 액션 연결, 선택지(분기), 하단 대화창 모드, 거리 LOD, 1회성 플래그.
  - ~~**남은 E3-B(추후)**: 문(door) = 런타임 콜라이더 on/off 토글~~ **[완료 2026-07-08 — 위 '최근 완료' 참고]**. hide_object 콜라이더 누수도 함께 수정.

- **뷰어 통합(임베드/배포 컨텍스트) 리팩터 (2026-07-07)**: 임베드가 `ViewerClient`의 축소 복제본(`EmbedClient`)이라 E2/E3/대화/interact가 다 빠져있던 문제 → **`ViewerClient`를 컨텍스트 인지형으로 파라미터화**(`variant: 'standalone'|'embed'`, `onBridge`). `EmbedClient`는 이제 `<ViewerClient variant="embed" onBridge={postMessage}/>` **얇은 래퍼**로 축소 → 임베드가 **전체 액션(open_url/popup/go_to_scene/show·hide·toggle/focus/reset_camera/animate/move/sound/play_animation)·대화 말풍선·interact·카메라 포커스 자동 지원**. 컨텍스트 분기: `show_popup`=iframe 안이면 부모 postMessage, 아니면 실제 팝업 렌더 / `emit_event`=iframe일 때만 브릿지(ViewerClient에도 이제 구현) / `go_to_scene`=경로 id 치환(위 참고). chrome=독립은 상단 풀 UI+배지, 임베드는 우상단 미니 토글+워터마크. **중요**: ShareModal이 주는 임베드 코드가 `<iframe src="{origin}/embed/{id}">`라 **third-party 사이트도 이 Next `/embed` 라우트를 씀** → 이 통합으로 실제 임베드 시나리오 해결. 검증: tsc 클린 + `/space` 200(회귀 없음)·`/embed` 정상 컴파일/실행(404는 씬 미게시). **실제 임베드 액션 E2E는 게시된 씬 + `/test/event-bridge`로 사용자 확인 필요**. 커스텀 도메인 서빙 라우팅 실존 여부 점검(→ `proxy.ts:14-24`에 있음. host→`projects.custom_domain` 조회 후 `/space/{default_scene_id}`로 rewrite. **단 경로 무시하고 기본 씬만 서빙** → 커스텀 도메인에서 다중 씬 이동은 별도 개선 필요. localhost는 이 로직 건너뜀 → 실도메인+DNS+배포 필요, 로컬 테스트 불가).
  - **embed.js → iframe 주입기로 전환 (2026-07-07)**: 기존 in-page mount(vite 번들 `EmbedApp`, 3.88MB, 호스트 origin에서 실행 → CSS/JS 충돌·3액션 제한)를 **폐기**하고, `public/embed.js`를 **~3.2KB 바닐라 iframe 주입기**로 교체(YouTube IFrame API 패턴). `<script src=".../embed.js" data-scene data-target?/data-width?/data-height?/data-radius?>` → 격리된 `/embed/{id}?parentOrigin=` iframe을 꽂음 → **통합된 `/embed`(전체 기능) 재사용, 드리프트/격리문제/번들 소멸**. `park3d:event`/`park3d:popup` postMessage를 호스트 `window`의 **CustomEvent로 재전달**(`window.addEventListener('park3d:event', e=>e.detail)`). 삭제: `embed/`(main.tsx·EmbedApp.tsx·vite.config.ts), `package.json`의 `build:embed`. `/embed`는 X-Frame-Options 없음(next.config) → cross-origin iframe 허용 확인. ShareModal 임베드 탭에 **스크립트(권장)/iframe 방식 토글** 추가. 검증: embed.js 3.2KB·CORS·문법 유효, /embed 200. **호스트 페이지 실삽입 E2E는 게시된 씬 필요(사용자)**.

- **프로젝트 복제 (2026-07-07)**: 대시보드 카드 `···` 메뉴 → "📄 복제". `duplicateProject`(dashboard/actions.ts) **완전 독립 복사** — 새 프로젝트(비공개·도메인/slug 없음, 이름 "{원본} (복사본)") + 플랜 한도 검증(초과 시 롤백) + **에셋 스토리지 파일(+\_thumb.png) 새 경로로 `storage.copy` + assets DB행 생성** + **모든 씬 복사**하며 `remapSceneData`로 scene_data의 `projectId`·`sceneId`·`assets[].id/dracoUrl/thumbnailUrl`·`objects[].assetId`·`go_to_scene` 값(씬 id)을 **새 id로 리맵** → 원본 삭제해도 복사본 독립. default_scene_id·thumbnail_url·description·meta 승계. UI: 복제 중 카드 오버레이("복제 중…"). 검증: tsc + dashboard 컴파일 200. **실제 복제 동작(스토리지 copy·리맵)은 사용자 브라우저 확인 필요**.

- **정렬·회전 피벗 bbox화 (2026-07-07)**: 원점(=`position`)이 GLB의 임의 원점(대개 바닥/비대칭)이라 ①정렬이 원점 기준이라 회전 시 어긋나고 ②회전이 원점(바닥) 축이라 휘둘리던 버그. **원점 의미는 유지(마이그레이션 0)** 하고 bbox로 거동만 교정. **공용 유틸 `src/lib/objectBBox.ts`**: `localBBox`(GLB=캐시·프리미티브=단위·**그룹=자식 재귀 union**)/`worldBBox`(월드 AABB)/`localCenter`. **Phase1 정렬**: `sceneStore.alignSelected`를 원점→**월드 bbox 모서리(min/max)·중심(center)** 기준으로. **Phase2→프록시 재작성**: (보정 hack은 폐기) `SingleGizmo`를 **프록시 방식**으로 재작성 — `TransformControls`를 오브젝트가 아니라 **형상 중심에 놓인 프록시 Object3D**(`<primitive>`로 씬 루트에 마운트)에 붙임 → **기즈모 위젯이 원점(하단)이 아니라 중심에 뜨고**, 회전이 중심축, 이동/스케일도 중심 기준. 드래그 아닐 때 useFrame이 프록시←오브젝트(matrixWorld·cLocal) 동기화, 드래그 중 onChange가 프록시→오브젝트 로컬 TRS 역매핑(부모 matrixWorld 역행렬). **부수효과**: 프록시가 안 움직여 예전 재부모화 scene-graph 에러 회피 목적의 attachedKey 로직 제거. 캐릭터 프리뷰/프리미티브는 cLocal=0이라 기존과 동일. 회전 시 y바닥 클램프는 미적용(translate 전용)으로 변경(중심 회전은 원점 y가 내려갈 수 있음). 그룹은 재귀 union bbox로 개별과 동일 처리. 프리미티브는 중심=원점이라 무변화. **Phase3 바닥 클램프 bbox화**: 이동(translate) 시 원점 y≥0 대신 **bbox 밑면이 바닥(0)에 닿게** 클램프(`GizmoController` 잡는 순간 `minOriginY = position.y − worldBBox.min.y` 계산·이동 중 불변). 기존 primitive-only `getGroupMinY` 제거 → 그룹·GLB 포함 **worldBBox 기준으로 통일**. 회전/스케일은 클램프 안 함(중심 피벗 회전은 원점 y가 내려갈 수 있음). 검증: tsc + 에디터 컴파일 200. **실제 정렬·회전·바닥클램프 거동은 브라우저 확인 필요**. 남은 근사: 미로딩 GLB·회전된 자식은 AABB 근사 bbox, 중첩(부모 있는) 오브젝트 이동은 여전히 y클램프 skip(기존과 동일).

- **경계 벽(Boundary Walls) MVP (2026-07-07)**: 기존 `boundary`(크기 숫자, 충돌만)에 **시각 벽** 추가. 스키마 `EnvSchema.boundaryWall = { style:'none'|'color'|'texture', color?, textureUrl?, height?, opacity?, ceiling? }`(기존 숫자 boundary는 그대로 하위호환). 공용 컴포넌트 `src/components/three/BoundaryWalls.tsx` — 4면 벽(+선택 천장) `DoubleSide` 렌더, 텍스처는 `useTexture`+RepeatWrapping(월드 4유닛/타일), `editor` prop이면 불투명도 ×0.5로 편집 덜 가림. 뷰어(`ViewerCanvas`)는 기존 주황 `BoundaryGizmo`를 **BoundaryWalls로 교체**(none이면 안 보임 → 방문자에게 주황 가이드 안 뜸, 탐색·플레이 공통 렌더), 에디터(`EditorCanvas`)는 **주황 가이드(범위) 유지 + 벽 반투명 미리보기**. 충돌 콜라이더(PlayCanvas)는 무변경. 에디터 UI: Environment→Boundary 섹션에 스타일 드롭다운/색/**텍스처 업로드(등록, ground와 동일 패턴 — `boundary/{pid}/tex_*` 저장·미리보기·교체/제거)**/높이/불투명도/천장 토글. **직사각 지원**: `boundary`(X 반경)+`boundaryZ`(Z 반경, 미설정=정사각) → 벽·콜라이더·주황가이드·에디터 UI(가로/세로 2입력) 전부 직사각화. 검증: tsc + 에디터·뷰어 컴파일 200. **실제 벽 렌더·텍스처는 브라우저 확인 필요**. 2차 후보(미착수): 그라데이션 페이드 벽, 안쪽만 보이기(one-sided), 면별 텍스처, 스카이박스 대안, 원형/커스텀 모양.

- **자동 바닥 스냅 + Shift 15° 회전 (2026-07-07)**: (1) GLB 추가 시 **밑면을 바닥(y=0)에 자동 정렬** — `sceneStore.floorSnapObject(id)` + 모듈 `pendingFloorSnap` Set. `addAssetObject`가 추가 후 즉시 시도(bbox 캐시돼 있으면 성공), 미로딩이면 pending → `GlbObject`가 bbox 캐시하는 useEffect에서 `floorSnapObject` 재시도(objectId prop 전달). 루트 GLB만, 히스토리 없이 위치만 보정(추가 액션에 묻어감). 기존 오브젝트는 pending 아니라 무영향(로드 시 재스냅 안 됨). → "오브젝트가 바닥에 파묻혀 일일이 올리던" 문제 근본 해결. (2) **Shift 누른 채 회전 = 15° 스냅**(GizmoController, Figma식). 검증: tsc + 에디터 컴파일 200. **실동작 브라우저 확인 필요**.
- **에셋 연쇄 삭제 (2026-07-07)**: 사용 중 에셋 삭제를 차단하던 걸 → **확인 후 참조 오브젝트(+자손) 함께 삭제**로. `sceneStore.removeObjectsByAsset(assetId)` 추가, `AssetBrowser`는 `confirm`(N개 오브젝트/플레이어캐릭터 해제 안내) → DB 삭제 성공 후에만 씬 반영(원자성). 유령 참조 방지는 유지.
- **기타 UI/UX 수정 (2026-07-07)**: 대시보드 정렬 `updated_at→created_at`(공개토글 시 카드 점프 버그 수정) + **등록일 상대시간 표시**(`timeAgo`) / 임베드 **클릭→팝업** 안 뜨던 것(iframe 내부 렌더+부모 브릿지 병행) / 팝업 배경 **흰색 고정**(테마 무관, `RichContent onLight`) / 방문자 뷰어 **호버 외곽선 제거**(글로우+커서+링만) / **힌트 링 occlusion**(depthTest 켜고 bbox 상단 정확 배치) / 임베드 **모드 토글 버튼 제거**(defaultMode 고정) / 카메라 프리셋 7/1/3 **씬 크기 맞춤**(고정거리20→spread×1.4) / **에디터 ContactShadows 제거**(오브젝트 이동 시 바닥 잔상 → preserveDrawingBuffer+접지그림자). / `.next` 캐시 크래시 대응([[troubleshoot-next-worker-crash]]).

## 남은 작업 / 로드맵 (2026-07-07 갱신)

### ⚠️ 브라우저 실검증 대기 (이번 세션 산출물 — tsc·컴파일은 통과, 실동작 미확인)

- **정렬·회전·바닥클램프·기즈모(프록시 방식)** — 특히 그룹 재부모화(예전 취약점) 회귀 확인
- **경계 벽** — 색/텍스처(업로드)/직사각(가로≠세로)/천장/투명, 플레이 이동제한
- **프로젝트 복제** — 스토리지 copy·리맵, 원본 삭제 후 독립성
- **임베드 E2E** — 게시된 씬 + `/test/event-bridge` 또는 `<script>` 삽입, emit_event/팝업

### 기능 로드맵 (미착수/후속)

- ~~**오브젝트 앰비언트 애니메이션(`motion`)**~~ **[완료 2026-07-08 — MVP + 후속]**: `MotionConfig`(type=float/spin/pulse/orbit/wander, speed/amplitude/radius/**axis**/**collider**). 모션 수식은 **공용 `src/lib/motion.ts`**(`computeMotion` — 시각과 콜라이더가 동일 로직 공유). **시각**: `ViewerObject`의 `MotionGroup`(베이스 pos/rot/scl + 타입별 델타를 useFrame로, 콘텐츠는 로컬 원점이라 spin/pulse가 오브젝트 중심 피벗) + `Xform` 래퍼로 **GLB·프리미티브·콘텐츠(text/image/video)·그룹 전부** 배선(YouTube만 정적). 에디터 정적·**뷰어 전용**. **후속 완료**: (1) **spin 축 선택**(x/y/z, 기본 y), (2) **콘텐츠/그룹 지원**, (3) **콜라이더 동반**(`collider:true` → `PlayCanvas`의 `MovingCollider` = kinematicPosition RigidBody가 computeMotion으로 매 프레임 `setNextKinematicTranslation/Rotation` → **플레이 모드에서 진짜 이동 장애물**. auto/physics 필터에서 제외, pulse는 런타임 콜라이더 스케일 불가라 제외). 에디터 UI: 일반 오브젝트 Motion 섹션 게이트를 `!obj.light`로 열어 **GLB·프리미티브·콘텐츠 모두 노출**, **그룹은 전용 Inspector(별도 early-return 패널)에 Motion 블록 추가**. 라이트만 제외. **그룹 모션은 플레이 모드도 지원**: 플레이 렌더가 모드별로 갈라져 있어(`GroupWithCollision`은 정적) 그룹 모션이 안 돌던 것 → PlayCanvas에서 그룹을 3분기(모션없음=`GroupWithCollision` / 모션+콜라이더OFF=`ViewerObject` 시각전용 / 모션+콜라이더ON=**`MovingGroupCollider`** = 그룹 전체를 하나의 kinematicPosition 강체로 묶어 `colliders="hull"` 자식 복합 콜라이더가 함께 이동하는 **진짜 이동 장애물**). 그룹도 콜라이더 토글 노출(pulse 제외). 한계: 자식 형상이 볼록 껍질(hull)로 근사(오목 형상 두꺼워짐)·비균일 스케일 그룹은 콜라이더 왜곡 가능·캐릭터 라이딩 미구현. **콜라이더 OFF = 통과(장식) 규칙 통일**: 위치가 움직이는 모션(float/spin/orbit/wander)+콜라이더OFF 오브젝트는 **콜라이더 미부여(통과)** — 예전엔 autoObjects로 가서 시각은 떠다니는데 벽만 원래 자리에 남는 '유령 콜라이더' 버그였음. 단일=`visualMotionObjects`(ViewerObject 시각전용), 그룹=`movingGroups`. pulse는 제자리라 정적 콜라이더 유지(autoObjects). 한계: 콜라이더 동반 시 캐릭터가 **위에 올라타 실려가진 않음**(rapier kinematic 라이딩 미구현). wander=랜덤 목표점 easing 로밍. 검증: tsc 클린 + 에디터·뷰어 200 + **"잘움직이네" 사용자 확인(MVP)**. **콜라이더 동반·콘텐츠/그룹·spin축 실동작 브라우저 확인 필요**.
- **맵 제작 도구**: ~~(a) 추가 시 자동 바닥 스냅~~ **[완료 2026-07-07]** ~~(b) 배열/반복 툴~~ **[완료 2026-07-08]** ~~그리드(2D)/원형 배열, 회전 증분~~ **[완료 2026-07-16 — Grid·회전 증분·나선 계단·프리뷰·LinkToggle, 위 참고]**. ※Ctrl+D 복제는 크기 정확 복사됨.
- ~~**Inspector 툴팁**~~ **[완료 2026-07-07]**: `InfoHint`(ⓘ, lucide `Info`) 공통 컴포넌트 + `Tooltip`에 `wide` 옵션(줄바꿈/최대폭) 추가. `SectionHeader`에 `hint` prop → Transform/Visibility/Physics/Events/Content/Light/Particle/Boundary/Interaction/Ground/Player/Lights 등에 안내문. (필요 시 필드 단위 툴팁·나머지 섹션 추가 가능)
- ~~**Events E3-B(문/콜라이더 토글)**: `set_passable`/`toggle_collision` + hide_object 시 루트 콜라이더 제거~~ **[완료 2026-07-08]**.
- **팝업 고도화 — 웹사이트/HTML 임베드 + 커스터마이징**: **[Phase 1 완료 2026-07-08]**. 현재 `show_popup`은 `RichContent`로 이미지/영상/YouTube/Vimeo 자동 인식은 되나 **일반 웹사이트 URL은 링크로만** 뜨고 커스텀 HTML/스타일 불가 → "웹사이트도 품는다"는 취지에 부족. **방향(합의): iframe으로 통일** — URL 모드=`<iframe src>`, HTML 모드=`<iframe srcdoc sandbox>`(XSS·스타일오염을 샌드박스로 회피), auto=기존 RichContent.
  - **Phase 1 구현 내역(2026-07-08)**: 스키마 `EventSchema.popup?: PopupConfig { mode:'auto'|'url'|'html'; width?; height?; bg?; title? }` 추가(`src/types/scene.ts`, **하위호환 — popup 없으면 기존 auto 동작 100% 유지**). 새 컴포넌트 **`src/components/ui/PopupFrame.tsx`**: auto→`RichContent`, url→`<iframe src>`(sandbox 미부여), html→`<iframe srcdoc sandbox="allow-scripts allow-forms allow-popups allow-modals">`(**allow-same-origin 제외 → 스크립트가 불투명 origin에서 실행돼 부모 DOM/쿠키 접근 차단, XSS 격리**). **차단 폴백**: cross-origin iframe은 로드 성공/실패를 JS로 확신 불가 → 로딩 스피너 + 4초 후 "차단 가능성" 안내 + **url 모드엔 항상 '새 탭에서 열기' 버튼**(확실한 탈출구). `ViewerClient` 팝업 state에 `config` 추가, iframe 모드는 카드에 width/height/bg 인라인 스타일(기본 `min(90vw,860px)`×`min(82vh,620px)`) + PopupFrame, auto는 기존 RichContent 경로 그대로. **임베드(`/embed`)도 ViewerClient 공유라 자동 지원**. 에디터: Events 폼 `show_popup`일 때 모드 드롭다운 + 모드별 입력(html=textarea) + 너비/높이/제목 + 안내문(`InspectorPanel`, `newPopup` state·`cleanPopup`으로 auto+무스타일은 undefined로 정리). 검증: **tsc 클린**. **실동작 브라우저 확인 필요**(url 임베드 가능 사이트·차단 사이트 폴백·html 샌드박스·크기 조절, 에디터 프리뷰는 auto 기준이라 실렌더는 뷰어에서 확인). 제약: 에디터 이벤트 목록의 미리보기(👁)는 여전히 RichContent 기준(모드 무시).
  - **Phase 2 완료(2026-07-08)**: (1) **위치 프리셋** `PopupConfig.position: 'center'|'left'|'right'|'bottom'` — center=중앙 모달(기존), bottom=바텀시트, left/right=풀하이트 사이드 패널. `ViewerClient` 팝업 렌더를 위치별 오버레이 정렬/카드 기본크기/모서리(bottom=rounded-t, side=rounded-r/l)로 분기. (2) **등장 애니메이션** — `globals.css`에 keyframes(popupScale/SlideUp/SlideInLeft/SlideInRight/Backdrop) + 위치별 `animate-[...]` 클래스, `prefers-reduced-motion`이면 비활성. (3) **씬 전역 기본 팝업 스타일** `EnvSchema.defaultPopup?: Pick<PopupConfig,'position'|'width'|'height'|'bg'>` — 에디터 Environment '팝업 기본값' 섹션. 뷰어가 **이벤트 config > 씬 defaultPopup > 하드 기본값** 순으로 병합(interactRange 패턴). (4) 에디터 이벤트 폼: 모드 무관 **위치 드롭다운 + 너비/높이/제목/배경색(color picker)** 상시 노출(Phase 1은 url/html만). **하위호환 철저**: center+auto+크기미지정 = 기존 컴팩트 모달 경로 그대로(`legacyCompact`), 그 외만 flex-col 구조 카드. `cleanPopup`이 position도 보존. 검증: **tsc 클린 + dev 서버 `/test/move-object` 200(ViewerClient+PopupFrame 컴파일/임포트 정상)**. **실동작 브라우저 확인 필요**(4개 위치·애니메이션·씬 기본값 병합·배경색·모바일 클램프).
  - **Phase 3 완료(2026-07-08)**: (1) **등장 애니메이션 종류 선택** `PopupConfig.anim: 'auto'|'none'|'fade'|'scale'|'slide'` — auto=위치별 기본(기존), slide는 위치에 맞는 방향 자동. `globals.css`에 `popupFade` 추가, `ViewerClient`가 anim→animClass 매핑. 씬 기본값(`defaultPopup`)에도 anim 포함. (2) **chrome/padding 옵션** `PopupConfig.chrome?`(미설정/true=제목바+하단 닫기, **false=몰입형: 제목·닫기 숨김 + 우상단 플로팅 ✕ + 여백 0** → edge-to-edge iframe용), `padding?`(카드 내부 여백 override, 예 '0'|'24px'). chrome=false는 legacyCompact 제외라 구조 카드로 렌더. (3) **에디터 ▶ 미리보기를 PopupFrame로** — `previewPopup` state를 `{content, config}`로 바꿔 뷰어와 동일 병합(이벤트>씬기본)으로 **모드(iframe/html) 실제 렌더 + 크기/배경 반영**. 위치 프리셋은 에디터 미리보기에선 중앙 고정 + "뷰어에선 ○○ 배치" 주석(실제 위치는 뷰어). 에디터 이벤트 폼에 애니메이션 드롭다운·chrome 토글·여백 입력 추가, `cleanPopup`이 anim/chrome/padding 보존. 검증: **tsc 클린 + dev `/test/move-object` 200**. **실동작 브라우저 확인 필요**(anim 5종·몰입형 chrome=false 플로팅닫기·여백0 iframe·▶ 미리보기 iframe 렌더).
  - **팝업 Phase 완료** — 후속 후보(미착수): 팝업 안 여러 액션 버튼(CTA), 등장/퇴장 분리 애니메이션, 팝업 열림 시 이벤트 트리거 체이닝.
- **대화 시스템 고도화 — 대사 종료 액션(버튼)·거리 LOD·1회성 [완료 2026-07-08]**: (1) **대사 종료 시 액션 = 말풍선 안 버튼** — `EventSchema.trigger`에 `dialogue_end` 추가. **자동발동이 아니라**(사용자 피드백: always+이벤트 문제·끝나자마자 넘어가면 당황) 대화 **마지막 문장에 액션 버튼**을 띄우고 **방문자가 누르면** 발동. `DialogueConfig.endButtonLabel`(기본 '확인'). `SpeechBubble` 안 3D Html 버튼(pointerEvents auto + onMouseDown/onTouchStart stopPropagation으로 카메라 드래그 차단 — 플레이 모드는 포인터락 없어 클릭 가능) → `dv.confirm()` → `onEvent(obj,'dialogue_end')` → 기존 `handleObjectEvent` 파이프라인(팝업·씬이동·문열기 등 전 액션). 데스크톱은 E키(근접+끝)로도 확정. auto 대화는 종료 이벤트 있으면 **마지막 문장에서 순환 멈춰 버튼 유지**. (2) **거리 LOD** — `SpeechBubble`을 `<group ref>`로 감싸 useFrame에서 카메라 거리 계산, 12m부터 페이드→20m 넘으면 사실상 숨김(직접 style.opacity, setState 없음, drei `distanceFactor` 원근축소와 병행). (3) **1회성** — `DialogueConfig.once`. `active = wantActive && !dismissed && !(once && seen)`. seen 시점: 버튼 확정(confirm) 또는 (버튼 없는 대화는) 끝까지 보고 근접 해제 시. `dismissed`=버튼 눌러 이번 세션 닫음(근접 풀리면 리셋). 미묘한 자동발동 로직(firedRef 등)은 버튼 방식으로 대체돼 단순화됨. **미완료(대화 남은 것)**: 선택지(분기), 하단 대화창 모드. 에디터: 트리거 '대사 종료 시'(버튼 안내), 대화 섹션 '1회성' 토글 + (종료 이벤트 있을 때) '종료 버튼' 이름 입력. 검증: **tsc 클린 + dev `/test/move-object` 200**. **실동작 브라우저 확인 필요**(근접→대사 끝 버튼 등장→클릭→액션, 멀어지면 페이드, once 재방문 안 뜸 — [[project_e2e_play_mode_testing]] 방식 권장).
- **경계 벽 2차**: ~~그라데이션 페이드/one-sided/면별 텍스처/스카이박스 대안~~ **[완료 2026-07-10]** / ~~원형 모양~~ / ~~커스텀(자유 다각형)~~ **[전부 완료 2026-07-16 — 위 참고]**. 경계 모양 로드맵 종료(사각·원·다각형).
- ~~**조명 L2 (c)**: 라이트 색(warm/cool) 스키마~~ **[완료 2026-07-10 — 아래 '최근 완료' 참고]**. L2 전체 완료.
- ~~**Prefab**: 미착수. 착수 전 override/동기화 규칙 설계 필요.~~ **[MVP 완료 2026-07-09 — 아래 참고]**
- ~~**AssetBrowser 탭**: Materials/HDR (WIP)~~ **[완료 2026-07-10]**. **4개 탭(Materials/Textures/HDR/Audio) 전부 완료.** ~~ground·boundary 텍스처 개별 업로드~~ **[에셋 통합 완료 2026-07-16 — 위 참고: uploadImageTexture+addAsset, TexturePicker 픽커]**.

### 🗺️ 대형 로드맵 (원본 `ROADMAP.md`/`FEATURE_LIST.md` — 이 핸드오프 요약에 누락됐던 것들)

> 이 노트가 최근 작업 위주라 아래 기획들이 빠져있었음(2026-07-07 재편입). 상세 AC는 `FEATURE_LIST.md`/`ROADMAP.md` 참조.

- **3D 에셋 마켓플레이스** (FEAT-MARKET-01 / P5-03): 에셋 브라우저 "마켓플레이스" 탭 — 카테고리·검색, 무료/유료 구분, **Business 플랜은 자기 에셋 등록·판매**. 별도 스프린트(마켓 DB/결제 구조 설계 필요).
- ~~**씬 템플릿 라이브러리** (FEAT-TEMPLATE-01 / P3-08)~~ **[완료]**: 새 씬 생성 시 빈씬/쇼룸/갤러리/광장/카페 5종 템플릿 선택 모달. `SceneSwitcher`의 `TemplatePickerModal` + `src/lib/sceneTemplates.ts`(SCENE_TEMPLATES). `createFromTemplate`로 생성.
- **실시간 협업** (FEAT-COLLAB-01 / P5-01): 다중 유저 동시 편집(커서·선택 공유, CRDT).
- **AI 자동 배치** (P5-02).
- **Material 커스텀 에디터** (P4-03) — 현재 Inspector Material 섹션 주석처리 상태.
- **뷰포트 분할**(P4-06) · **단축키 커스터마이징**(P4-08) · **에셋 폴더/태그**(P3-11) · **Event Bridge 프리셋**(P4-10) · **댓글/피드백 모드**(P4-09).
- **성능/최적화**: InstancedMesh 자동 전환(P4-01) · KTX2/Draco 파이프라인(P4-02, ※현재 draco 실압축 안 함) · 스토어 selector 리팩터(NumInput 스크럽 시 캔버스 전체 리렌더, WORKLOG).

### 정리/결정 필요

- **오토세이브** 되살리기/제거 결정 (현재 수동 Ctrl+S만, `setAutoSaveAt` lint 경고 원인).
- ~~**Layers 데드 코드**~~ **[정리 완료 2026-07-10]**: 스토어의 죽은 machinery(`layers` 상태·`LayerState`·`addLayer`/`toggleLayerVisible`/`toggleLayerLocked`/`setObjectLayer`) 제거 — 어떤 컴포넌트도 안 쓰던 완전 데드코드. `ObjectNodeSchema.layer` 필드는 하위호환 위해 유지(제거 시 마이그레이션·팩토리 대량 수정 필요, 무해).

### 인프라/비즈니스

- **결제/플랜 업그레이드 (Stripe)** — 미착수.
- **커스텀 도메인 다중 씬 이동** — `proxy.ts`가 기본 씬만 서빙(경로 무시). 다중 씬은 별도 개선.
- **emit_event(Event Bridge)** — 구현 완료, 실 iframe E2E는 게시 씬으로 확인만 남음(Pro 게이팅은 코드표시 UI에만).
  - **핵심 시나리오 명확화 (2026-07-08) — 임베드 호스트가 '자기 페이지'를 3D 위에 띄우기**: 사용자 의도 = park3d 씬을 **A사이트(고객사)에 임베드**하고, 3D 안의 건물 클릭 시 **A사이트의 회사소개/연혁 등 자기 페이지**를 3D 위에 표시. **이건 `emit_event`(Event Bridge)로 이미 가능**하며 **X-Frame-Options 무관** — A사이트가 자기 same-origin 콘텐츠를 자기가 렌더하고, park3d는 "건물 클릭됨(value)" 신호만 전달하기 때문. 방식: 건물에 `Trigger=Click · Action=emit_event · value='about'/'history'` → 임베드가 부모로 `park3d:event` postMessage → `embed.js`가 호스트 `window`의 CustomEvent로 재전달 → **호스트가 `window.addEventListener('park3d:event', e => e.detail)`로 받아 자기 모달/라우팅으로 표시**. (`show_popup`은 우리 뷰어 내부 팝업 렌더 + 부모 통지 겸용 — 호스트가 직접 띄울 땐 `emit_event`가 정석, 중복 팝업 없음.) **아까 팝업 iframe/커스터마이징 로드맵은 이것과 별개** — 그건 _독립 URL/커스텀도메인 배포에서 우리 뷰어가 직접 콘텐츠를 보여줄 때_ 유용(상호보완). **참조 데모 페이지 추가**: `/test/host-demo?url=/embed/<sceneId>` — "A사이트 목업"(상단 내비 + 3D 임베드 + park3d:event 수신 시 회사소개/연혁 사이드 패널을 3D 위에 오버레이). raw postMessage 구독으로 self-app에서도 동작(실배포는 embed.js CustomEvent). 기존 `/test/event-bridge`는 raw 이벤트 로거로 유지. 실 게시 씬 + 건물에 emit_event 걸어 최종 확인만 남음.

## 조명 L2 — L1 피드백 취합 결과 & 계획 (2026-07-06)

사용자가 L1 기본값으로 실제 씬을 보고 준 피드백 3건 + 코드 진단:

1. **GLB가 바닥에 파묻힘** — `addAssetObject`(sceneStore)가 GLB 원점을 무조건 y=0에 놓음. GLB는 원점이 발밑이 아닌 기하 중심인 경우가 많아 밑면이 바닥(`y=-0.002` 텍스처 평면) 아래로 내려감. 인스펙터 y 클램프 `Math.max(0,v)`는 **원점**만 0 이상으로 막고 **실제 밑면(bbox.min.y)**은 안 맞춤. 프리미티브는 생성 시 y=0.5+스케일1이라 정상. **[완료 — "바닥에 놓기" 버튼]** `GlbObject`가 계산한 로컬 bbox를 `glbLocalBboxCache`(url→Box3)에 저장 → 인스펙터 버튼이 오브젝트의 **회전+스케일 행렬을 로컬 bbox에 적용해 실제 min.y**를 구하고 `position.y = -min.y`로 밑면을 바닥(0)에 정렬. 루트(parentId=null) GLB만. 자동 스냅 대신 버튼(공중 배치 통제권 유지). 검증: three 수치(회전/스케일 5케이스 worldBase=0) + `/test/snap` 렌더(25°+비균일 스케일에서도 밑면이 바닥에 정확히 앉음).
2. **색이 밝게/파스텔로 뜸**(예: 저장 #226155 → 화면 #39706a) — 에디터·뷰어 Canvas 어디에도 톤매핑 미지정 → R3F 기본 **ACESFilmicToneMapping**이 채도 낮추고 중간톤 들어올림. **[완료 — Linear 채택]** `/test/tonemap` A/B 픽셀 측정(실제 조명 리그) 결과 저장색 대비 Δ: **none≈linear(Δ~10) < aces(Δ~20) < neutral(Δ~28)**. 처음엔 Neutral 추천했으나 측정상 Neutral이 오히려 색을 더 밀어냄. NoToneMapping은 exposure가 무효라, **`THREE.LinearToneMapping` 채택**(none과 동일 정확도 + 노출 조절 유효). 트레이드오프: 값>1 하드클립(부드러운 롤오프 없음) — 기본 조명은 안 넘겨 안전, 밝은 HDR/강광은 노출 슬라이더로 억제. `SceneToneMapping` 컴포넌트 + Canvas gl prop, 에디터·뷰어 동일.
3. **씬별 분위기 원함**(가벼우면) — 이미 `environment.lights`·HDR·sky·fog가 씬 단위 저장이라 대부분 가능. 가벼운 추가: **씬별 노출(toneMappingExposure) 슬라이더** + 선택적 분위기 프리셋(아침/한낮/노을/밤 env 묶음).

**L2 진행 상황**: ①(톤매핑 Linear+노출)·②(바닥 스냅 버튼)·③(분위기 프리셋 + ContactShadows) **완료**.

- **③-a 분위기 프리셋**: 에디터 Environment 패널 'Mood' 섹션 — 아침/한낮/노을/밤/스튜디오 5개 버튼(`MOOD_PRESETS`). 클릭 시 `updateEnvironment`로 **HDR 프리셋 + 라이트(강도/태양위치) + 노출** 묶음 적용(기존 검증된 경로 재사용). **브라우저 확인 완료(2026-07-07)**.
- **③-b ContactShadows**: 스키마 `contactShadows`, 에디터·뷰어 렌더, Lights 패널 토글. **기본 꺼짐(opt-in)**. **실제 GPU 브라우저에서 렌더 확인 완료(2026-07-07)** — 헤드리스 SwiftShader에선 안 그려졌던 것뿐. opt-in 유지.
- **(c) 라이트 색(warm/cool)** **[완료 2026-07-10]**: 아래 '최근 완료' 참고. → **L2 전 항목 완료.**

### L2 후속 수정 (2026-07-06, 사용자 피드백)

- **기본(방향광) 그림자 더 진하게**: fill 광이 그림자를 씻어내던 걸 줄임 — `ViewerCanvas`·`EditorCanvas`의 ambient 배수 0.5→**0.2**, hemisphere 0.08→**0.02**, `DefaultEnvironment` IBL 기본값 0.35→**0.25**. 측정(`/test/shadow`): 그림자/바닥 밝기 140/165 → **119/149**로 심도↑. 트레이드오프: fill이 줄어 씬 전체가 약간 어두워짐(특히 그림자 밖 어두운 구석)·PBR 재질 IBL 반사 살짝 감소. 더 진하게 원하면 fill을 더 낮추거나 per-scene 그림자 강도 슬라이더 추가 고려.
- **ContactShadows 플레이 모드 트레일 버그 수정**: 접지 그림자 켠 채 플레이하면 캐릭터 이동 경로에 검은 그림자가 칠해지던 문제 → **플레이 모드에선 ContactShadows 미렌더**(`!playMode` 게이트, `ViewerCanvas`). 접지 그림자는 정적 씬(탐색/에디터)용. 헤드리스에선 ContactShadows 자체가 안 그려져 트레일 재현·확인 불가지만, 컴포넌트를 트리에서 빼므로 구조적으로 트레일 불가능.

### 💡 조명 UX 개선 (2026-07-20) — 태양 드래그 + 다이얼 + on/off 토글 — 브라우저 확인 대기
> 사용자: 오렌지 화살표(읽기전용)만 있고 XYZ 패널로만 조절 → 어디서 빛 오는지 모름·허술. 확정 A+B+원뿔+토글. tsc 클린 + dev 컴파일. **브라우저 확인 대기.**
- **A. 드래그 태양 기즈모(`EditorCanvas` SunDirectionGizmo 재작성)**: 읽기전용 노랑 구 → **와이어프레임 가이드 구(드래그 핸들)**. 잡아 하늘 돔(반경=현재 크기)에 끌면 ray-sphere 교차로 방향 산출(지평선 위 클램프)→`directionalPosition` 실시간 갱신→그림자 즉시 따라옴. 놓을 때 pushHistory. orbit는 드래그 중 비활성.
- **빛 방향 = 반투명 원뿔(부채꼴)**: 태양 apex→원점 쪽으로 벌어지는 오렌지 원뿔(openEnded)로 "빛이 이쪽으로" 표현.
- **B. 방위/고도 다이얼(신규 `SunDial.tsx`, 패널)**: 원형 패드 = 중심(머리 위/정오)·가장자리(지평선)·각도(방위 N/E). dot 드래그로 `directionalPosition` 상호 변환(크기 보존). XYZRow(Sun Position) 대체.
- **라이트 on/off 토글(패널)**: Lights 섹션을 **화살표(접기) → 헤더 스위치(sunEnabled, Fog 패턴)**. 끄면 **directionalLight·그림자·태양 기즈모·태양 관련 컨트롤(다이얼/Sun 강도/Sun Color/Shadow) 숨김**, ambient/IBL만 유지. `EnvSchema.lights.sunEnabled?`(옵셔널·기본 true). 에디터+뷰어 directionalLight 게이트(게시 씬 일관).
- ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "이정도면 좋아"). 오브젝트 라이트 표식도 와이어프레임 구+코어로 통일(사용자 요청). 세부 다듬기는 테스트 후 추가 요청 예정.**

### 🎥 카메라 개선 로드맵 (2026-07-20) — 사용자 요청(사무실 씬: 걷기·대화·웹). 우선순위대로 4단계
> 사용자: 3인칭 카메라가 벽 뚫고 외부 보임 + 1인칭/구역별/새 모드 원함. **모두 구현, 우선순위 순.** 기준 `doc/CAMERA.md`.
- **① 카메라 벽 뚫기 수정(camera collision) — ✅ 확인 완료(2026-07-20, 사용자 "잘된다")**: `PlayModeController` 팔로우 카메라에 **Rapier 레이캐스트**(camTarget→카메라 방향, `world.castRay`, EXCLUDE_SENSORS·플레이어 제외) 추가 → 사이에 벽(콜라이더) 있으면 `timeOfImpact-0.3`(최소 0.4)까지 **카메라 당김** → 벽 안 뚫고 방 안에 머묾.
- **② 1인칭 토글 — ✅ 구현, 브라우저 확인 대기**: `PlayModeController`에 `firstPerson` prop + 분기 — 카메라를 캐릭터 눈높이(y+1.5)에 두고 방위(az)+고도(el) 방향 바라봄(시선=3인칭 오프셋의 반대), **캐릭터 모델 숨김**. prop 체인(ViewerClient→ViewerCanvas→PlayCanvas→PlayModeController). ViewerClient에 `firstPerson` state + **상단 중앙 "👁 1인칭/🎥 3인칭" 토글 버튼**(플레이 모드), 모드 이탈 시 리셋. tsc·컴파일 클린.
  - **확인 필요(브라우저)**: 버튼으로 1인칭↔3인칭 전환 · 1인칭서 캐릭터 안 보이고 눈높이 시점 · 마우스로 시선 회전 · 크로스헤어 조준 정상 · 3인칭 복귀 정상.
- **③+④ 카메라 모드 + 구역별 전환 — ✅ 확인 완료(2026-07-20, 사용자 "전환 잘된다")**: 4모드(third/first/topdown/fixed)를 `PlayModeController`에 통합(기존 firstPerson → `cameraMode`+`fixedTarget`). **topdown**=캐릭터 위 H14·back5서 내려다봄(심즈/쿼터뷰, az 회전). **fixed**=지정 오브젝트 월드위치에 카메라 두고 캐릭터 바라봄(방 전체 앵글, 전환 시 lerp). **구역별 전환** = 신규 이벤트 액션 **`set_camera_mode`**(value=`third`|`first`|`topdown`|`fixed|<objId>`) → 방 입구 센서에 `area_enter`로 걸면 방마다 시점 바뀜.
  - **배선**: prop 체인 firstPerson→cameraMode/cameraFixedId(ViewerClient→ViewerCanvas→PlayCanvas→PlayModeController). PlayCanvas가 `cameraFixedId`→월드위치(worldMatrix) 계산해 fixedTarget 전달. ViewerClient에 `set_camera_mode` 핸들러 + 좌하단 토글 버튼(3인칭↔1인칭, 라벨은 4모드 표시) + 모드 이탈 리셋. EventsSection에 액션 UI(모드 드롭다운 + fixed 대상 선택 + 안내).
  - ~~**확인 필요(브라우저)**~~ **✅ 확인 완료(2026-07-20, 사용자 "전환 잘된다") — 구역별 카메라 전환 동작.** (팁: 센서를 문간이 아니라 "방 전체"로 덮어야 진입/이탈이 순식간에 안 겹침 — 사용자와 확인.)
  - **🎉 카메라 로드맵 4단계(①벽뚫기 ②1인칭 ③구역전환 ④탑다운/고정) 전부 완료·검증.**
- **C1 게시 시작 뷰(startView) — ✅ 구현, 브라우저 확인 대기**: CAMERA.md 1순위(★최대). 다른 3D 서비스의 "기본 카메라 패널 = 시작 위치" 부재를 사용자가 지적 → 구현. `EnvSchema.startView?{position,target,fov?}`(옵셔널·미설정=자동fit 기존). **저장**: 에디터 `requestSaveStartView()`(요청-틱)→EditorCanvas가 현재 orbit 카메라(pos/target/fov) 읽어 `updateEnvironment({startView})`. **적용**: 뷰어 `InitialFit`이 startView 있으면 자동fit 대신 그 위치·시선·fov에서 시작(둘러보기 모드만·플레이는 팔로우라 무관). **UI**: Environment 패널 신규 **Start View 섹션**(기본 접힘) — "📷 현재 시점으로 저장" + "초기화" + 상태 안내. saveScene은 environment 통째 저장이라 자동 보존.
  - **확인 필요(브라우저)**: 에디터서 카메라 각도 맞춤→"현재 시점으로 저장"→게시/둘러보기 뷰어가 그 위치·방향에서 시작(자동fit 대신) · 초기화→자동fit 복귀 · 저장 후 새로고침 유지.
- **❌ C2 카메라 설정 — 기능 삭제(2026-07-20, 사용자 결정)**: **"현재 시점 저장(startView)이 있으니 중복이고 별 효용이 없다"** + **"내가 아는 3D는 에디터에 카메라 오브젝트가 있고 그걸 움직이고 설정하는 것"**(사용자). 정당한 지적 — `CAMERA.md §2`가 이미 "카메라 = 오브젝트"라고 명시하고 §8도 **C3=카메라 오브젝트**를 두고 있는데, 문서의 C1→C2→C3 순서를 기계적으로 따르며 **"C2가 필요한가"를 되묻지 않은 것이 판단 착오**였다. 패널 숫자로 보이지 않는 카메라를 제한하는 방식은 일반적인 3D 툴의 방식이 아니다.
  - **삭제 내역**: `EnvSchema.exploreCamera` 필드 · EnvironmentPanel **Camera 섹션 전체** · 파일 3개 삭제(`canvas/CameraLimitGizmo.tsx`·`panels/inspector/CameraAngleDial.tsx`·`store/cameraGuideStore.ts`) · EditorCanvas 가이드 배선 · ViewerCanvas의 `autoRotate`/`exploreFov` 배선.
  - **남긴 것 = `lib/cameraLimits.ts`(축소)**: 설정 UI는 없어졌지만 **"저장한 시작 뷰가 OrbitControls 기본 제한에 잘리는" 버그 클래스**는 실재하므로 보호 로직만 유지(기본 제한 + startView 포함 확장). 테스트도 그 관심사만 남겨 **16/16 통과**(`npx tsx src/lib/cameraLimits.test.ts`).
  - **하위호환**: 기존 씬 `scene_data`에 남은 `exploreCamera` 값은 **읽지 않고 무시**(normalize가 environment를 통째로 통과시키므로 데이터는 남지만 무해).
  - **카메라 제어의 정방향 = CAMERA.md C3(카메라 오브젝트)** — **⏸ 보류(2026-07-20, 사용자 결정: "일단 보류하고 나중에 필요할 시 다시 진행")**. 착수 시 범위 = 씬에 카메라 오브젝트 배치·트리 노출·기즈모 이동/회전 · 선택 시 프러스텀 표시 · 인스펙터 FOV/near/far · 카메라 프리뷰(작은 창) · 이벤트 뷰 전환(다중 카메라) → 이후 C4 플라이스루. 재사용 자산 = 모터 오브젝트(`isActuator`) 생성/연결 패턴 · `ActuatorGizmo` 부채꼴·핸들 · 앵커 조작 근간.
  - tsc 클린 + 테스트 16/16 + dev 편집 라우트 200.
- ~~**C2 카메라 설정(둘러보기 제한)**~~ **(위 삭제됨 — 이하 이력)**: CAMERA.md 2순위. `EnvSchema.exploreCamera?{fov, minDistance, maxDistance, maxPolarDeg, autoRotate, autoRotateSpeed}`(옵셔널·미설정=기존 기본값). **방문자가 카메라를 이상한 각도/거리로 못 가게 제한**.
  - **뷰어 배선(`ViewerCanvas`)**: 탐색 OrbitControls에 `maxPolarAngle`(maxPolarDeg°→rad, 기본 90−0.02rad)·`minDistance`(기본 1)·`maxDistance`(기본 200)·`autoRotate`/`autoRotateSpeed`(기본 off/1). `InitialFit`에 `exploreFov` prop — **fov 우선순위 = `startView.fov` > `exploreCamera.fov`**(둘 다 없으면 카메라 기본 유지). 플레이(걷기)는 캐릭터 팔로우 카메라라 **무관**.
  - **에디터 UI(`EnvironmentPanel`)**: 신규 **Camera 섹션**(기본 접힘) — Field of view 슬라이더(20~90°)·가까이/멀리 한도(m)·내려다보기 최대 각도(10~90°)·자동 회전(턴테이블) 토글+속도. "에디터엔 미반영 — 게시/둘러보기 뷰어에 적용" 안내. `environment` 통째 저장이라 persist 자동.
  - **⚠️ 중단 지점이었음 (2026-07-20 재개 시 발견)**: 이 블록이 PROGRESS에 기록되지 않은 채 **tsc 에러 2건**(`EnvironmentPanel` 가까이/멀리 한도의 `LabeledNum`에 필수 prop `label` 누락 — 수동 `<span>`으로 라벨을 그리고 있었음)으로 멈춰 있었음. → **수동 span 제거 + `label` prop 전달**로 수정(LabeledNum이 동일 스팬 마크업을 자체 렌더 → 시각 결과 동일, 파일 내 Fog Near/Far 패턴과 일치). **tsc 클린 + dev 편집 라우트 200 확인.**
  - **확인 필요(브라우저)**: Environment▸Camera에서 FOV/줌 범위/각도 제한 설정 → **게시(둘러보기) 뷰어**에서 그 범위 밖으로 줌·회전 안 됨 · 자동 회전 턴테이블 · startView 저장 시 그 fov가 우선.
  - **🔴 C2 치명 버그픽스 (2026-07-20, 사용자 보고 "카메라가 단단히 잘못됐다")**: 정면에서 startView 저장 + 카메라 제한 설정 후 게시 뷰어에 들어가니 **거의 탑다운에서 시작 + 상하 회전 불가**. 원인 3종:
    - **① `maxPolarDeg` 의미가 직관과 반대인데 설명까지 틀렸음(주원인)**: polar angle은 **수직(머리 위) 기준** — `0°=탑다운·90°=지평선(눈높이)`. `minPolarAngle`이 0.1rad(≈5.7°)로 고정이라 **maxPolarDeg=10을 주면 허용 범위가 [5.7°, 10°] = 머리 위에 고정**됨. 그런데 InfoHint가 "낮추면 위에서 내려다보는 각도를 제한"이라고 **정반대로** 써 있어 사용자가 낮은 값을 넣도록 유도했음. → 라벨 **"카메라가 내려갈 수 있는 높이"**, 설명을 사실대로(90°=눈높이까지·낮출수록 위에 묶임·30° 미만은 탑다운 고정) 수정 + **45° 미만이면 인라인 경고** 표시.
    - **② startView가 제한에 조용히 잘림**: `OrbitControls.update()`가 polar/거리를 제한으로 clamp → `InitialFit`이 정면 startView를 세팅해도 **제한이 좁으면 탑다운으로 튕겨나감**(저장한 뷰가 무시되는 것처럼 보임). → 신규 **`exploreLimits(env)`**(`ViewerCanvas`)가 **제한을 항상 startView를 포함하도록 넓힘**(maxPolar=max(설정, startView polar+여유), 거리도 startView 반경 포함). **규칙: 저장한 시작 뷰가 제한보다 우선.**
    - **③ min/max 거리 검증 없음**: 가까이 한도 > 멀리 한도로 뒤집어 넣을 수 있었고 그러면 뷰어 카메라가 잠김. → 패널에서 상호 clamp(Fog Near/Far 패턴) + `exploreLimits`에서도 방어(기존 씬 대비).
    - tsc 클린. **확인 필요(브라우저)**: 정면 startView 저장 → 둘러보기 뷰어가 **정면에서 시작** · 상하 회전 정상 · 각도 45° 미만 시 경고 문구.
  - **🎥 C2 UX 재설계 (2026-07-20) — 카메라 제한 3D 가이드 + 측면 다이얼 — 브라우저 확인 대기**: 위 버그의 **근본 원인 = "에디터에 보이지도 않는 것을 숫자로 조절"**(사용자 지적). 사용자 선택 = **3D 가이드 시각화(3+5안)**. tsc 클린 + dev 편집/뷰어 라우트 200.
    - **신규 `store/cameraGuideStore.ts`**(transient·저장 안 함, liveTransformStore 패턴): `show`(Camera 섹션 펼침)·`active`(다이얼 드래그 중). 패널(DOM)↔캔버스(R3F) 트리가 분리돼 있어 이 채널로 연결.
    - **신규 `canvas/CameraLimitGizmo.tsx`**(EditorCanvas): **"방문자 카메라가 있을 수 있는 영역"을 수직 단면 부채꼴 띠**로 렌더 — 안쪽=가까이 한도·바깥=멀리 한도·위=바로 위·아래=눈높이. Y축 빌보드라 어느 각도서도 읽힘, 좌우 대칭 2장 + **바닥 링 2개**(방위 360° 자유 암시) + 눈높이 기준선 + `Html` 라벨(`${deg}° 까지 내려감`). **45° 미만이면 주황+"⚠️ 거의 탑다운"** 경고색. 중심 = startView.target(있으면) 또는 씬 자동맞춤 중심 — **뷰어 `exploreLimits()`와 동일 규칙**(startView 우선)이라 가이드가 실제 동작과 일치. 읽기 전용(raycast 제외)·`Environment ▸ Camera` 펼침 시에만 표시(기본 접힘으로 변경).
    - **신규 `panels/inspector/CameraAngleDial.tsx`**: 각도 **숫자 슬라이더를 측면 단면 다이얼로 대체**(SunDial 조작감) — 세로축=바로 위·가로축=눈높이, 파란 부채꼴=허용 범위, 카메라 아이콘+핸들 드래그. 낮은 값이면 주황+경고 문구. 드래그 중 `onActive`로 **3D 가이드도 동시 강조**(패널↔뷰포트 연동).
    - **효과**: "polar 10°"가 무슨 뜻인지 몰라도 **그림에서 카메라가 머리 위에 갇힌 게 즉시 보임** → 이번 사고가 구조적으로 재발 불가.
    - **확인 필요(브라우저)**: Environment▸Camera 펼치기 → 뷰포트에 하늘색 부채꼴 띠+바닥 링 표시 · 다이얼 핸들 드래그 시 띠가 실시간으로 벌어짐/좁아짐 · 45° 미만에서 주황 경고(패널+3D 둘 다) · 가까이/멀리 한도 바꾸면 띠 두께 변화 · 섹션 접으면 가이드 사라짐 · 오브젝트 선택 시에도 사라짐.
  - **🧪 C2 검증 가능화 (2026-07-20) — 공용 lib 추출 + 결정론 테스트 21/21 + 가이드 무반응 버그 2종 — 브라우저 확인 대기**: 사용자 지적 "동작은 되지만 **그게 맞는 동작인지 알 수가 없다**" + "패널 핸들을 드래그해도 가이드가 반응 없다".
    - **신규 `lib/cameraLimits.ts`(단일 소스)**: 제한 계산이 **뷰어(ViewerCanvas)·에디터 가이드에 복붙**돼 있어 어긋날 위험이 있었음 → `cameraLimits(env)`로 추출. **`authored`(설정값) / `effective`(실제 적용값) / `startView`(극좌표) / `widened`(제한이 안 먹는 중)** 를 함께 반환. 뷰어·가이드·패널 3곳이 전부 이걸 사용.
    - **신규 `lib/cameraLimits.test.ts`** — `npx tsx src/lib/cameraLimits.test.ts`, **21/21 통과**. 케이스: ①기본값 ②제한만 ③**★정면 startView+10° 제한(시작 뷰 우선·widened)** ④탑다운 startView+넓은 제한(넓히지 않음) ⑤거리 넓힘 ⑥가까이>멀리 뒤집힘 교정 ⑦지평선 아래 방지. **"startView와 제한을 둘 다 설정하면 어떻게 되나"의 답을 표로 고정.**
    - **🐛 버그 A — 패널 조절해도 가이드 무반응(각도)**: 앞선 버그픽스로 넣은 "startView 우선" 보정이 **조용히** 동작해서, startView가 저장돼 있으면 각도 다이얼을 아무리 움직여도 effective가 안 변함(=가이드 정지). 규칙 자체는 맞지만 **보이지 않는 게 문제**(고치려던 병을 되풀이) → 가이드가 **effective(채운 띠) + authored(흰 윤곽선)를 둘 다** 그리도록 수정. 이제 드래그하면 **흰 선이 실시간으로 움직인다**. 패널에도 **경고 박스 + "시작 뷰 지우고 이 제한 적용하기" 버튼** 추가.
    - **🐛 버그 B — 거리 조절 무반응**: 표시 반경을 **60m 하드캡**으로 잘라서, 기본 멀리 한도 200m→100m로 줄여도 화면상 60m 그대로 = 변화 없음. → **씬 크기/시작 뷰 거리에 맞춘 적응형 표시 반경**으로 바꾸고, 잘렸을 땐 라벨에 `(표시는 N m까지 축약)` + **실제 수치를 항상 라벨에 표기**(숫자가 거짓말하지 않게).
    - **가이드 추가 표시**: 시작 뷰 카메라의 **실제 월드 위치(보라 구 + 시선)** — 방문자가 어디서 시작하는지 눈으로 확인.
    - tsc 클린 + 테스트 21/21 + dev 편집/뷰어 200. **확인 필요(브라우저)**: 아래 브라우저 테스트 케이스 TC-A~D.
      - **TC-A(시작 뷰 없음)**: Start View 초기화 → Camera 다이얼 드래그 → 띠가 실시간으로 벌어짐/좁아짐(흰 선 없음).
      - **TC-B(둘 다 설정)**: 정면 startView 저장 + 각도 10° → 패널에 주황 경고, 3D에 **흰 윤곽선(=설정 10°)과 채운 띠(=실제 ~82°)가 따로** 보임. 다이얼 드래그 시 **흰 선만** 움직임.
      - **TC-C(충돌 해소)**: 경고 박스의 "시작 뷰 지우고 이 제한 적용하기" → 흰 선과 띠가 일치.
      - **TC-D(거리)**: 가까이/멀리 한도 변경 → 바닥 링 2개와 띠 두께가 변함 + 라벨 수치 갱신.
  - **C2 남은 범위(CAMERA.md §8 기준)**: **투영 전환(원근/직교)** · **near/far 클리핑** · **follow(3인칭) 세부**(거리·높이·어깨오프셋). ※노출은 기존 `toneMappingExposure`로 이미 있음. ※에디터 T/F/S near-ortho는 에디터 전용이라 뷰어 투영 설정과 별개.

### 🛠️ 에디터 조작 버그 3종 + 좌패널 UX (2026-07-23) — ✅ 사용자 확인 완료
> 사용자 보고 3건을 근본원인까지 파고들어 수정. tsc 클린 + dev 편집 라우트 200. **✅ 셋 다 브라우저 확인 완료(사용자: "스냅도 된다"·"추가시 기즈모 잘된다"·호버 정상).**
- **🔴 스냅 "카메라 휙~" — 진짜 원인은 snapDist 아님(오진 정정)**: 큰 오브젝트를 다른 오브젝트에 스냅시키며 지나칠 때 카메라가 휙 돌던 버그. **1차 오진**=카메라 거리 비례 `snapDist`(당시 실험코드)라 보고 고정 0.2m로 되돌렸으나 **증상 그대로**였음 → snapDist 무관 확정. **진짜 원인**=`ManipulationHandles`의 코너/면 핸들(스케일용, **항상 표시**)의 `onPointerOut`이 **자기 핸들 드래그(`draggingRef`)만 확인하고 기즈모 드래그는 무시** → 기즈모로 오브젝트를 옮기다 포인터가 (화면에 퍼진) 핸들을 스쳐 벗어나면 `orbit.enabled=true`로 **카메라가 다시 켜져 회전**. 큰 오브젝트만인 이유=핸들이 화면에 넓게 퍼져 포인터가 지날 확률↑. **수정**=핸들 `onPointerOver/Out`을 `useLiveTransformStore.getState().dragging`로 가드(어떤 드래그든 진행 중이면 orbit 안 건드림). snapDist는 고정 0.2m 유지(예측 가능·점프 상한).
- **드래그 중 호버 가이드라인 억제**: 기즈모/핸들 드래그 중 다른 오브젝트에 마우스가 가면 호버 가이드가 뜨던 것 → `liveTransformStore`에 **`dragging` 플래그** 신설(SingleGizmo·MultiGizmo·ManipulationHandles 드래그 시작/종료에서 on/off), `EditorObjectInstance`의 호버 핸들러 2곳(프리미티브·GLB `onHoverChange`)이 드래그 중이면 `setHovered` 스킵. (이 플래그를 스냅 "휙" 가드도 공유.)
- **오브젝트 추가 시 기즈모 즉시 표시**: 추가하면 자동 선택은 되나 기즈모가 안 뜨고 **한 번 더 클릭해야** 뜨던 버그. 원인=새 오브젝트의 3D ref는 인스턴스 마운트 **다음 프레임**에 `refsMap`(순수 Map)에 등록되는데 Map은 리렌더를 안 유발 → render 시점 `target=undefined`라 기즈모 null. **수정**=`SingleGizmo`의 useFrame이 **ref 유무 변화를 감지해 등록 프레임에 딱 한 번 강제 리렌더**(`useReducer` bump). 등록=즉시 표시·제거=즉시 숨김, steady state선 bump 안 함(무한루프 없음).
- **좌패널 UX 다듬기**: 좌/우 패널 그림자 `shadow-[0_1px_5px_rgba(0,0,0,0.15)]`(좁고 옅게) · 활성 색 통일 `bg-muted/5 dark:bg-muted/10`(Objects/Assets **탭 버튼**·Scenes 활성 씬·검색박스 — 단 **objects 트리 선택 항목은 강조색 `bg-primary/10` 유지**, 사용자 요청) · Objects 탭 우측 객수 숫자 제거 · objects/assets 검색박스 높이 `h-7`.

## 알려진 제약/한계

- **액추에이터/무빙 콜라이더 "미는" 미지원 (2026-07-20 확인, 보류)**: 움직이는 콜라이더(actuator/moving = kinematicPosition)가 **가만히 선 캐릭터를 밀지 못하고 관통**한다. 원인 = Rapier `KinematicCharacterController.computeColliderMovement`가 **캐릭터 자신의 `desired` 이동에 대해서만** 충돌 해결(움직이는 콜라이더가 나를 미는 건 미계산). 증상: W로 밀 땐 캐릭터 전진이 막혀 밀리는 듯 보이나, **밀리는 중 W를 놓으면 물체가 통과**. 해결하려면 무빙 플랫폼 "pusher" 로직(접촉 시 콜라이더 변위를 캐릭터 `desired`에 합산) 필요 — 회귀 위험으로 **보류**. 다시 문제되면 그때 구현. (`PlayModeController.tsx:359`, `PlayCanvas.tsx` ActuatorCollider/MovingCollider)
- `go_to_scene`: **경로의 현재 씬 id를 대상 id로 치환**해 이동 → `/space`·`/embed`·커스텀도메인(경로에 id 포함 시) 모두 대응. 경로에 id 없으면 `/space/{id}` 폴백. (뷰어 통합 리팩터 2026-07-07)
- `focus_object`: 탐색=OrbitControls 이동, **플레이=팔로우 대신 대상 줌**(2026-07-08, 팝업 닫기/Esc로 복귀+이동 잠금 해제). `reset_camera`: 탐색(orbit) 모드 전용 — 플레이는 캐릭터 팔로우 카메라라 무시됨.
- ~~솔리드는 area 트리거로 애니메이션 재생 안 됨~~ **[해소 — 2026-07-10]**: `ViewerClient.handleObjectEvent`가 **모든 트리거에서 `play_animation` 처리**(→ clipRequests→externalClip)하고, 솔리드는 `PlayModeController`의 물리 접촉 콜백 `onObstacleEnter`가 area_enter를 발동하므로 → **솔리드+area+애니메이션 동작**. (센서는 PhysicsObject activeClip 경로와 중복이나 같은 클립이라 무해.)
- **트리거 확장(Distance/Collision) 이미 커버**: Distance ≈ `approach_enter/exit`(오브젝트 중심 반경 자동 트리거), Collision ≈ **솔리드 오브젝트의 area_enter/exit**(`onObstacleEnter`가 캐릭터 물리 접촉 시 발동 — 센서 불필요). 별도 트리거 추가는 중복이라 미도입.
- `interact` 트리거: **플레이 모드 전용 + 루트 오브젝트 전용**(중첩 그룹 자식은 로컬 좌표라 근접 판정 제외). 범위 고정 3m·정면 조건 없음(최근접). 키는 E 고정. ~~**임베드는 프롬프트 UI 미표시**~~ **[해소 — ViewerClient 통합]**: E 프롬프트(데스크톱 키캡/모바일 버튼)는 variant 게이팅이 아니라 `playMode`만 체크 → **`defaultMode='play'` 임베드에서 정상 표시**(임베드는 모드 토글이 없어 defaultMode 고정이므로 interact 쓰려면 play로 설정). `Is Sensor` 통과는 버그가 아니라 트리거 영역의 정의 — 막고 싶으면 센서 끄기(기본 솔리드).
- `move_object`: ~~**그룹 대상은 탐색 모드 전용**~~ **[완료 2026-07-10 — 그룹도 플레이 모드 이동, 아래 '최근 완료' 참고]**. 방식: `movedIds`(posOverride 대상) 배선 → 옮겨지는 그룹을 `MovedGroupCollider`(kinematicPosition hull 강체)로 라우팅해 콜라이더가 함께 이동. **제약(남음)**: 그룹 자식은 볼록 껍질(hull) 근사(오목 형상 두꺼워짐)·한번 옮긴 그룹은 이후 hull 콜라이더 유지(자식별 정밀 콜라이더→hull). 이동한 솔리드 위에 선 캐릭터는 같이 안 실려감(텔레포트라 이동 플랫폼은 아님·rapier 라이딩 미구현). 임베드도 ViewerClient 공유라 자동 지원.
- `play_sound`: 오디오 URL 직접 입력만(AssetBrowser audio 탭 WIP). area 트리거는 브라우저 자동재생 정책에 막히면 무음(조용히 무시).
- 인터랙션 힌트 링(2026-07-07 개선): **occlusion 적용** — `depthTest` 기본값(true)으로 앞 오브젝트가 뒤 오브젝트 링을 가림(엑스레이·겹침 문제 해결). 위치는 **GLB bbox 캐시(`glbLocalBboxCache`) 기반 실제 상단**(뷰어의 `GlbViewer`도 캐시 저장)으로 정확해짐, 캐시 없으면 스케일 근사. `InteractionHints`가 매 프레임 높이 갱신(GLB 늦은 로드 대응). 회전 미반영(근사). 그룹 자체엔 링 없음(자식 기준). 에디터 뷰포트엔 안 뜸(뷰어 전용).
- 톤매핑 **Linear 전역 적용**: 저장 색을 정확히 렌더하지만 값>1 밝은 영역은 하드클립(부드러운 롤오프 없음). 밝은 HDR/강광 씬은 노출 슬라이더로 낮출 것. 기존 published 씬도 룩이 바뀜(더 진한 색).
- **ContactShadows 실렌더 미검증**: 헤드리스에서 안 그려져 opt-in 기본 꺼짐으로 뒀다. 실제 브라우저에서 켜 확인 후, 정상이면 기본값·프리셋 포함 여부 재검토.
- **바닥 스냅**: 루트 GLB만(그룹/프리미티브/content 제외). `glbLocalBboxCache`에 값이 있어야(=한 번 렌더된 GLB) 버튼 활성화 — 미로딩 시 비활성.
- **테스트 페이지**: `/test/tonemap`(톤매핑 A/B 픽셀), `/test/snap`(바닥 스냅 렌더), `/test/contact`(ContactShadows on/off) 추가 — 기존 `/test/*` 규칙과 동일.
- 오토세이브: `ViewportToolbar`에 60초 자동저장 로직이 주석 처리된 채 방치(수동 Ctrl+S만 동작). `setAutoSaveAt` lint 경고 원인.
- 코드베이스 전반에 React Compiler eslint 규칙(immutability/set-state-in-effect/modify-local) 에러가 다수 존재 — 기존 코드, dev/build엔 영향 없음.

## Supabase 마이그레이션

`supabase/migrations/` — 0001_init ~ 0006_assets_public 까지. 새 환경에선 순서대로 실행 필요.
