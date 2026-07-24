export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type HdrPreset = 'none' | 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'apartment' | 'studio' | 'city' | 'park' | 'lobby';
// 'color'=단색 / 'texture'=업로드 이미지. 'custom'은 레거시(=textureUrl 있으면 texture, 없으면 color로 취급).
export type GroundPreset = 'custom' | 'color' | 'texture' | 'grass' | 'dirt' | 'sand' | 'stone' | 'water';

export interface EnvSchema {
  // 배경 하늘. type=color(단색) · gradient(위→수평선 2단, 요즘 3D 툴 룩) · sky(대기 시뮬) · hdr(레거시).
  //   value = 단색/그라데이션 위쪽 색, value2 = 그라데이션 수평선 색(미설정 시 value와 동일).
  //   ※ hdrPreset은 이제 **조명/반사(IBL) 전용**이며 배경을 덮지 않는다(2026-07-20).
  //      예전엔 <Environment background />로 HDRI 사진을 배경에 깔아 "사진 붙인 느낌 + 지평선 하드컷"이 났다.
  sky: { type: 'color' | 'hdr' | 'sky' | 'gradient'; value: string; value2?: string };
  hdrPreset?: HdrPreset;
  ground?: { enabled: boolean; color: string; preset?: GroundPreset; textureUrl?: string; infinite?: boolean };
  boundary?: number;  // 경계 X 반경(중심→벽). >0이면 이동 제한(콜라이더) 항상 존재. 원형이면 이 값이 반지름.
  boundaryZ?: number; // 경계 Z 반경. 미설정 시 boundary와 같음(정사각) — 직사각 지원. 원형에선 무시.
  boundaryShape?: 'rect' | 'circle' | 'polygon'; // 경계 모양. rect=사각·circle=원형·polygon=자유 다각형.
  boundaryPolygon?: { x: number; z: number }[];  // polygon 모양의 꼭짓점(월드 XZ, 닫힌 경로). boundary는 경계반경(게이트/스카이박스용)으로 자동 세팅.
  // 경계 벽 시각 — 미설정/none = 안 보임(투명, 영역만). color=단색 벽, texture=이미지 매핑 벽,
  //   skybox=4면 벽 대신 360° 파노라마 구(球)로 씬을 감쌈.
  boundaryWall?: {
    style?: 'none' | 'color' | 'texture' | 'skybox';
    color?: string;
    textureUrl?: string;
    height?: number;   // 벽 높이 (기본 8)
    opacity?: number;  // 0~1 (기본 1)
    ceiling?: boolean; // 천장 포함(완전한 방)
    // Phase 2 —
    gradient?: boolean;   // 위로 갈수록 투명하게 페이드(딱딱한 벽 대신 지평선 느낌)
    oneSided?: boolean;   // 안쪽에서만 보이기(밖에선 투명) — 뷰어 전용, 에디터는 항상 양면
    // 면별 텍스처(texture 스타일 전용) — 지정한 면은 이 이미지, 나머지는 textureUrl 폴백.
    faceTextures?: { front?: string; back?: string; left?: string; right?: string };
    // skybox 스타일일 때 감쌀 360° 파노라마(equirectangular) 이미지 URL.
    skyboxUrl?: string;
  };
  // fog: near/far = linear 안개(기본). mode:'exp'면 지수 안개(FogExp2, density 사용) — 균일한 깊이감.
  fog: { enabled: boolean; color: string; near: number; far: number; mode?: 'linear' | 'exp'; density?: number };
  // 개별 포스트 이펙트(프리셋과 별개). 하나라도 0이 아니면 프리셋 대신 이 조합으로 렌더.
  //   ssao=화면공간 앰비언트 오클루전(N8AO). 값 0/미설정 = 그 효과 끔.
  effects?: {
    ssao?: number;       // 0~1 AO 강도
    bloom?: number;      // 0~ 빛번짐
    vignette?: number;   // 0~1 가장자리 어둡게
    brightness?: number; // -0.5~0.5
    contrast?: number;   // -0.5~0.5
    saturation?: number; // -1~1 (0=원본)
    dof?: number;        // 0~1 피사계심도(초점 흐림)
  };
  lights: {
    ambientIntensity: number;
    // 환경광(ambient) 색. 미설정 = 흰색('#ffffff', 기존 동작). 차가운 그림자 톤 등에 사용.
    ambientColor?: string;
    directionalPosition: Vector3;
    directionalIntensity: number;
    // 방향광(태양) 색. 미설정 = 흰색('#ffffff', 기존 동작). warm/cool 무드의 핵심.
    directionalColor?: string;
    // 그림자 농도(directionalLight.shadow.intensity, 0~1). 1=진함, 0.5=옅음, 0=그림자 없음. 미설정=1(기존 동작).
    shadowIntensity?: number;
    // 태양(방향광) 사용 여부. 미설정=true(기존 동작). false면 directionalLight·그림자·태양 기즈모 끔(ambient/IBL만).
    sunEnabled?: boolean;
  };
  playerCharacterId?: string;
  playerCharacterScale?: number;
  playerSpeed?: number;
  playerJumpForce?: number;
  playerStartPosition?: Vector3;
  // 뷰어 진입 시 기본 모드. 미설정 = 'explore'(기존 동작). 'play'면 접속하자마자 플레이 모드로 시작.
  defaultMode?: 'explore' | 'play';
  // true면 이 씬은 '둘러보기 전용' — 걷기(플레이) 모드·캐릭터 없음, 뷰어에서 플레이 토글 숨김. (포트폴리오/제품 뷰어)
  disableWalk?: boolean;
  // 마지막으로 적용한 Mood 프리셋 id(에디터 스위치 상태 유지용). 미설정/'default'=무드 미적용.
  //   실제 조명·HDR·노출은 프리셋이 lights/hdrPreset/toneMappingExposure에 이미 적용됨(이 값은 표시/토글용).
  mood?: string;
  // 상호작용(클릭/호버 이벤트) 오브젝트 위에 떠다니는 힌트 링 표시. 미설정 = 켜짐(true).
  // 탐색 모드 뷰어/임베드에서만 렌더(플레이 모드·에디터는 미표시). 포트폴리오 등 깔끔한 씬은 끌 수 있음.
  showInteractionHints?: boolean;
  // 상호작용 근접 범위(m) 씬 기본값 — interact(E)/approach 트리거·E 프롬프트·하이라이트가 공유.
  //   미설정 = 3. 오브젝트가 자체 interactRange를 가지면 그 값이 우선한다.
  interactRange?: number;
  // 손전등 — 캐릭터에 붙어 시선 방향을 비추는 스팟라이트. 미설정/enabled false = 기존 동작(무변화).
  //   꺼져 있으면 짙은 안개(offFogDensity)로 눈앞만 보이고, 켜면 안개가 옅어지며(onFogDensity) 빛이 켜진다.
  //   플레이 모드 전용(PlayModeController가 렌더). 토글 키는 T 고정. exp 모드 안개에서만 시야 효과가 동작한다
  //   (linear 모드거나 fog.enabled=false면 빛만 켜지고 시야 반경 연출은 없음).
  flashlight?: {
    enabled: boolean;
    color?: string;             // 빛 색. 기본 '#fff4e0'(따뜻한 백색)
    intensity?: number;         // 켰을 때 세기. 기본 22
    angle?: number;             // 원뿔 각(라디안). 기본 0.45
    distance?: number;          // 비추는 거리(m). 기본 14
    offFogDensity?: number;     // 꺼졌을 때 안개 밀도(짙게=시야 제한). 기본 0.35
    onFogDensity?: number;      // 켰을 때 안개 밀도(옅게=멀리 보임). 미설정=씬 기본 fog.density
    batteryVariable?: string;   // 배터리로 쓸 GameVariable(number) 이름. 미설정=무한 사용
    drainPerSec?: number;       // 켜진 동안 배터리 초당 소모량. 기본 1/6(6초당 1)
  };
  notes?: string;
  // 게시 뷰어의 고정 화면 비율(width/height). 미설정/0 = 자유(브라우저 채움). 예: 16/9≈1.778, 1(정사각), 9/16≈0.5625.
  //   설정 시 뷰어가 이 비율의 프레임으로 레터박스(가운데 정렬 + 배경 여백)한다.
  frameAspect?: number;
  // 게시 시작 뷰(둘러보기 모드 초기 카메라). 미설정 = 자동 전체맞춤(기존). 설정 시 방문자가 이 위치·시선에서 시작.
  //   position=카메라 위치, target=바라보는 지점, fov=시야각(옵션).
  startView?: { position: Vector3; target: Vector3; fov?: number };
  // ※ exploreCamera(둘러보기 카메라 제한 패널)는 2026-07-20 제거됨 — startView와 역할이 겹치고,
  //    "에디터에 보이지 않는 값을 숫자로 조절"하는 방식 자체가 3D 툴의 상식(카메라 오브젝트)과 어긋나 효용이 없었다.
  //    카메라 제어는 CAMERA.md C3(씬에 놓는 카메라 오브젝트)로 간다. 기존 씬에 남은 값은 무시된다(무해).
  postProcessing?: { preset: PostProcessPreset };
  // 렌더러 노출(밝기) — LinearToneMapping의 toneMappingExposure. 미설정 = 1(기본).
  // 톤매핑은 코드에서 Linear로 고정 — 저장 색을 최대한 그대로 렌더(측정상 none과 동일 정확도).
  toneMappingExposure?: number;
  // 오브젝트 아래 부드러운 접지 그림자(drei ContactShadows). 미설정/false = 꺼짐(opt-in).
  // 바닥에 '붙은 느낌'을 강화하지만 매 프레임 렌더라 비용이 있어 기본은 꺼둔다.
  contactShadows?: boolean;
  // 씬 전역 기본 팝업 스타일 (Phase 2). 개별 이벤트의 popup이 설정한 필드가 우선하고,
  //   비운 필드는 이 기본값 → 하드 기본값 순으로 폴백한다(interactRange 패턴). 스타일 전용(mode/제목은 이벤트별).
  defaultPopup?: Pick<PopupConfig, 'position' | 'width' | 'height' | 'bg' | 'anim'>;
}

// 이벤트 트리거·액션 — elseAction 등에서 재사용하려고 명명 타입으로 추출.
export type EventTrigger = 'click' | 'hover_enter' | 'hover_exit' | 'area_enter' | 'area_exit' | 'interact' | 'approach_enter' | 'approach_exit' | 'dialogue_end' | 'variable_changed' | 'scene_start' | 'on_timer';
export type EventAction =
  | 'open_url'
  | 'show_popup'
  | 'emit_event'
  | 'play_animation'
  | 'go_to_scene'
  | 'show_object'
  | 'hide_object'
  | 'toggle_object'
  | 'focus_object'
  | 'reset_camera'
  | 'animate_object'
  | 'move_object'
  | 'set_passable'
  | 'set_solid'
  | 'toggle_collision'
  | 'play_sound'
  | 'set_variable'
  | 'spawn_object'
  | 'despawn_object'
  | 'game_win'
  | 'game_lose'
  | 'swap_model'
  | 'play_clip'
  | 'set_actuator'
  | 'set_camera_mode'
  | 'run_script';

export interface EventSchema {
  id: string;
  // interact: 플레이 모드에서 캐릭터가 근접(기본 3m)했을 때 E키(모바일=액션 버튼)로 발동.
  //   NPC 대화·문 열기·아이템 줍기 등 "다가가 상호작용" 문법. 탐색 모드에선 발동 안 함(클릭 이벤트로 대체).
  // approach_enter/exit: 플레이 모드에서 캐릭터가 오브젝트 근접 범위(interact와 동일 반경, 기본 3m)에
  //   들어오거나 벗어날 때 키 없이 자동 발동. 오브젝트는 솔리드 유지 가능(area와 달리 센서 불필요).
  //   "다가가면 NPC가 손 흔들기/사운드" 같은 근접 자동 연출. area(임의 볼륨 진입)와 달리 오브젝트 중심 반경.
  // dialogue_end: 이 오브젝트의 대화(말풍선)가 마지막 문장까지 재생되면 자동 발동(플레이 모드 전용).
  //   "대사 끝나면 팝업/문 열기/씬 이동" 같은 대화→액션 연결. 세션당 1회(대화 세션 리셋 시 재발동 가능).
  // variable_changed: 게임 변수가 바뀔 때마다 재평가돼, condition(조건)이 false→true로 전환되는 순간 1회 발동.
  //   "점수>=10이 되면 문 열림" 같은 반응형 규칙. 오브젝트 위치/근접 무관(순수 상태 규칙). GAME_LOGIC.md 참조.
  // scene_start: 뷰어(플레이/탐색) 로드 시 1회 발동. 초기화·인트로 팝업·타이머/사운드 시작에 사용(Phase 2).
  // on_timer: timer.everySec 간격으로 반복 발동(once면 그 시간 뒤 1회). 카운트다운·주기적 스폰에 사용(Phase 2).
  trigger: EventTrigger;
  // 액션 종류. value 의미: open_url=URL / show_object 등=objectId / animate_object="objectId|clip" /
  //   move_object="objectId|dx,dy,dz|초" / play_sound=오디오URL / set_variable="변수명|연산|값"(연산 set/add/sub/mul/toggle/random) /
  //   spawn_object="템플릿id|dx,dy,dz" / despawn_object=objectId(빈값=자기) / game_win·game_lose=메시지(선택) / run_script=JS코드.
  action: EventAction;
  // go_to_scene: 이동할 대상 sceneId. show/hide/toggle/focus_object: 대상 objectId.
  // reset_camera: value 없음. animate_object: "objectId|clipName".
  // move_object: "objectId|dx,dy,dz|durationSec" — 오프셋은 누적이 아니라 항상 원래 위치 기준.
  //   (0,0,0) 오프셋 이벤트를 만들면 제자리로 돌아온다. play_sound: 오디오 URL.
  // 그 외: 기존 의미(URL/텍스트/이벤트명/클립명).
  value: string;
  eventPayload?: Record<string, unknown>;
  // show_popup 전용 표시 설정(옵셔널·하위호환). 없으면 기존 RichContent 자동판별 팝업.
  popup?: PopupConfig;
  // 조건 게이트(옵셔널) — 있으면 참일 때만 액션 실행(GAME_LOGIC.md).
  //   (레거시) 단일 조건. 신규는 conditions[]+conditionLogic 사용. 런타임은 둘 다 지원(conditions 우선).
  condition?: EventCondition;
  // 다중 조건(Phase 2 후속). AND=전부 참, OR=하나라도 참. 비면 condition(단일)로 폴백.
  conditions?: EventCondition[];
  conditionLogic?: 'and' | 'or';
  // if/else 분기(Phase 2 후속) — 조건이 '거짓'일 때 대신 실행할 액션. 조건 없으면 무의미.
  //   variable_changed: 조건 true→false 전환에서 elseAction 발동(then은 false→true).
  elseAction?: EventAction;
  elseValue?: string;
  // on_timer 트리거 설정(Phase 2). everySec 간격 반복, once면 그 시간 뒤 1회만.
  timer?: { everySec: number; once?: boolean };
}

// 이벤트 조건 게이트 — 게임 변수 하나와 비교. (다중 조건 AND/OR는 후속)
export interface EventCondition {
  variable: string; // GameVariable.name
  op: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains'; // contains=문자열 포함
  value: number | boolean | string;
  // 이 조건을 '직전 조건'과 잇는 연결어(2번째 조건부터 의미). 미설정 = 레거시 conditionLogic(전역) 폴백 → 'and'.
  //   혼합 지원: 왼쪽→오른쪽 순서 평가 (A logic B logic C ...). 첫 조건의 logic은 무시.
  logic?: 'and' | 'or';
}

// show_popup 팝업의 표시 방식/스타일 (Phase 1).
export interface PopupConfig {
  //  auto  = value를 RichContent가 자동판별(이미지/영상/YouTube/URL링크/텍스트) — 기존 동작
  //  url   = value(웹사이트 URL)를 <iframe src>로 팝업 안에 삽입
  //  html  = value(HTML 문자열)를 <iframe srcdoc sandbox>로 격리 렌더
  mode?: 'auto' | 'url' | 'html';
  width?: string;   // 예: '800px' | '90vw' — iframe 모드 팝업 카드 너비(미설정=기본값)
  height?: string;  // 예: '600px' | '80vh'
  bg?: string;      // 카드 배경색(미설정=흰색)
  title?: string;   // 팝업 제목(미설정=오브젝트 이름)
  // 팝업 위치 프리셋 (Phase 2). center=중앙 모달(기본), left/right=사이드 패널, bottom=바텀시트.
  position?: 'center' | 'left' | 'right' | 'bottom';
  // 등장 애니메이션 (Phase 3). auto=위치에 맞게 자동(기본), none/fade/scale/slide.
  anim?: 'auto' | 'none' | 'fade' | 'scale' | 'slide';
  // 몰입형(chrome=false)이면 제목바·하단 닫기버튼을 숨기고 플로팅 ✕만 + 여백 0(edge-to-edge iframe용). 미설정=true.
  chrome?: boolean;
  // 카드 내부 여백 override. 예: '0' | '24px'. 미설정이면 기본 여백.
  padding?: string;
}

export type ColliderType = 'box' | 'sphere' | 'capsule' | 'hull' | 'trimesh';

export interface PhysicsSchema {
  enabled: boolean;
  colliderType: ColliderType;
  isSensor: boolean;
  mass: number;
  friction: number;
  restitution: number;
}

export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'frustum' | 'loft' | 'extrude' | 'lathe' | 'voxel' | 'torus';

// 프리미티브 확장 지오메트리 파라미터(옵셔널=하위호환). 미설정이면 각진 기본 형태.
export interface PrimitiveGeom {
  // box: 모서리 둥글기(0=각짐). 반변(0.5) 기준 0~0.5.
  cornerRadius?: number;
  // box 둥근 모서리 부드러움(세그먼트). 기본 4.
  cornerSegments?: number;
  // frustum: 윗면 크기 배율(아랫면=1 기준). 0=뾰족(각뿔), 1=박스. 0~1.
  topScale?: number;
  // torus: 튜브(도넛 관) 굵기 — 전체 반지름 대비 비율. 기본 0.28. 0.05~0.5.
  tubeRatio?: number;
  // loft: 아래→위 각 단면의 크기 배율(0~1). 2개 이상. 각뿔대(frustum)를 N단면으로 일반화.
  sections?: number[];
  // extrude/lathe: 펜 툴로 그린 2D 프로파일 점들. extrude=닫힌 단면(돌출), lathe=반쪽 단면(회전체).
  profile?: { x: number; y: number }[];
  // 프로파일이 닫힌 폐곡선인지. lathe에서 true면 닫힌 단면을 축에서 떨어뜨려 회전(도넛·링).
  profileClosed?: boolean;
  // extrude: 돌출 두께(정규화 전 로컬 단위). 기본 0.5.
  extrudeDepth?: number;
  // 펜툴 재편집용 — 스무딩 전 원본 컨트롤 점(있으면 재편집 시 이걸 로드). profile은 지오메트리용(스무딩 반영).
  profileRaw?: { x: number; y: number }[];
  // 펜툴 재편집용 — 스무딩(곡선) 여부.
  profileSmooth?: boolean;
  // voxel: 복셀 셀 목록(정수 그리드 큐브). live 렌더(정점색) + 모달 재편집. primitiveShape==='voxel'과 짝.
  voxels?: { x: number; y: number; z: number; color: string }[];
  // voxel: 한 칸의 로컬 크기(미터). 미설정=1. 0.5/0.25면 같은 발판에서 더 촘촘한(고해상도) 복셀.
  cellSize?: number;
  // voxel: 색별 텍스처(블록 스킨). 지정된 색의 칸은 그 이미지로 렌더(면별 UV). 있으면 지오메트리를 색별 그룹+재질배열로.
  voxelSkins?: { color: string; texUrl: string }[];
  // 표면 세분화(Loop Subdivision) 레벨 — 0=원본, 1~3=면을 쪼개 부드러운 유기적 곡면으로. 성능상 3까지.
  subdivisions?: number;
}

export type ContentType = 'text' | 'image' | 'video';

export interface ContentConfig {
  type: ContentType;
  text?: string;
  fontSize?: number;
  color?: string;
  depth?: number;
  url?: string;
}

export type ParticlePreset = 'fire' | 'dust' | 'light' | 'snow';

export type PostProcessPreset = 'none' | 'cinematic' | 'dreamy' | 'vintage' | 'sharp';

export type LightType = 'point' | 'spot' | 'directional';
export interface LightConfig {
  type: LightType;
  color: string;
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  castShadow?: boolean;
}

export interface ParticleConfig {
  preset: ParticlePreset;
  count?: number;
  color?: string;
  speed?: number;
  spread?: number;
  size?: number;
}

// 그라데이션 fill — 프리미티브(복셀·돌출·회전체 포함) 표면 색을 정지점 램프로 렌더. 있으면 color 대신 사용.
export interface GradientStop {
  color: string;  // hex
  pos: number;    // 0..1
}
export interface GradientFill {
  type: 'linear' | 'radial';
  angle?: number;          // linear: 방향 degrees(0=좌→우). radial: 중심을 미는 방향. 미설정=0.
  scale?: number;          // radial 전용, 퍼지는 정도(기본 1, 클수록 넓게 퍼짐).
  offset?: number;         // radial 전용, 중심 이동 거리(0=가운데 ~ 1=가장자리, angle 방향). 미설정=0.
  // radial 투영 방식: 'facing'=카메라 바라보는 쪽 원형(기본·구에 자연스러움)·'surface'=면마다 중앙 원형(패널·벽)·'axis'=로컬 XY 고정.
  radialMode?: 'facing' | 'surface' | 'axis';
  stops: GradientStop[];   // 2개+ (오름차순 권장, 렌더 시 정렬)
}

export interface MaterialOverride {
  color?: string;
  // 그라데이션 fill(옵셔널). 있으면 프리미티브 표면을 정지점 램프로 렌더(color 대신). GradientFill 참조.
  gradient?: GradientFill;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  // 표면에 입히는 이미지 텍스처(포스터/사진/로고 등). 있으면 색 대신 이미지로 렌더(map).
  textureUrl?: string;
  // 타일 반복 횟수(RepeatWrapping). 미설정=1×1(단일). x/y로 가로·세로 반복.
  textureRepeat?: { x: number; y: number };
  // 텍스처 투영 방식. 'face'(미설정)=면마다 이미지 한 장(기존).
  // 'wrap'=구면 투영 — 구에 텍스처 넣듯 한 장을 사방에 덮음(앞=중앙, 옆=당겨짐, 위/아래=극점).
  // 'pattern'=무늬가 표면 전체에 이음새 없이 반복(triplanar 타일). 셰이더 onBeforeCompile 투영.
  textureMapping?: 'face' | 'wrap' | 'pattern';
  // pattern 모드 스케일 — 로컬 유닛당 반복 수. 미설정=1. 클수록 무늬가 작아지고 촘촘해짐.
  triplanarScale?: number;
  // 법선 맵(Normal map) — 표면 요철(벽돌·천·금속 결)을 빛으로 표현. 이미지는 파란 톤의 노멀맵. textureRepeat 공유.
  normalUrl?: string;
  normalScale?: number;        // 요철 강도(기본 1, 0~2). 0=평평, 2=강함.
  // PBR 맵(흑백 데이터). roughness/metalness 스칼라에 곱해짐. textureRepeat 공유. standard·physical만.
  roughnessUrl?: string;       // 거칠기 맵(밝음=거침)
  metalnessUrl?: string;       // 금속 맵(밝음=금속)
  aoUrl?: string;              // AO(앰비언트 오클루전) 맵 — 틈새 그늘. standard·physical·toon.
  aoIntensity?: number;        // AO 강도(기본 1)
  displacementUrl?: string;    // 변위 맵 — 정점을 밀어 실제 요철(지오 세분 필요). standard·physical·toon.
  displacementScale?: number;  // 변위 강도(기본 0.1)
  // 표준 재질 공통 추가 파라미터(전부 옵셔널·미설정=현재 동작). standard·physical 양쪽 적용.
  opacity?: number;            // 0~1 (기본 1). <1이면 반투명(transparent) 렌더.
  emissiveIntensity?: number;  // 발광 세기(미설정=발광색 있으면 1, 없으면 0).
  envMapIntensity?: number;    // 환경(IBL) 반사 강도(기본 1). 낮추면 매트, 높이면 반짝임.
  // 물리 재질(MeshPhysicalMaterial) — 하나라도 유효하면 프리미티브가 physical 재질로 렌더. 전부 0/미설정이면 standard.
  clearcoat?: number;          // 0~1 투명 코팅 광택(자동차 도장·니스)
  clearcoatRoughness?: number; // 코팅 거칠기(기본 0.1)
  sheen?: number;              // 0~1 천/벨벳 가장자리 광택
  sheenColor?: string;         // 광택 색(미설정=베이스 색)
  sheenRoughness?: number;     // 광택 거칠기(기본 1)
  iridescence?: number;        // 0~1 무지개빛(비눗방울·기름막)
  iridescenceIOR?: number;     // 무지개빛 굴절률(기본 1.3)
  anisotropy?: number;         // 0~1 이방성 반사(브러시 금속·헤어라인)
  transmission?: number;       // 0~1 투과(유리·물). 투명해짐
  ior?: number;                // 굴절률(transmission용, 기본 1.5)
  thickness?: number;          // 투과 두께(기본 1, transmission용). 두꺼울수록 굴절·감쇠 강함
  attenuationColor?: string;   // 투과 감쇠 색(유리 틴트 — 두께 지날수록 이 색으로)
  attenuationDistance?: number;// 투과 감쇠 거리(작을수록 색이 진해짐)
  // 스타일라이즈드 — 가장자리 발광(Fresnel/Rim). intensity>0이면 셰이더 주입(standard·physical·toon 공통·additive). 안 켜면 비용 0.
  fresnelColor?: string;       // 가장자리 발광 색(기본 흰색)
  fresnelIntensity?: number;   // 0~ (기본 0=끔). 발광처럼 더해짐(라이팅 무관)
  fresnelPower?: number;       // 가장자리 집중도(기본 3, 클수록 얇은 테두리)
  // 외곽선(2D/만화 느낌) — 오브젝트 둘레에 라인. Toon 셰이딩과 함께 쓰면 셀셰이딩(애니) 룩. 프리미티브 전용.
  outline?: boolean;
  outlineColor?: string;       // 기본 검정
  outlineWidth?: number;       // 화면 픽셀 두께(기본 4)
  outlineMode?: 'silhouette' | 'full'; // 외곽(실루엣만) / 전체(+보이는 안쪽 하드 모서리). 미설정=실루엣.
  outlineThreshold?: number;   // 전체 모드 각도 임계값(°). 낮을수록 모서리가 많이 보임(기본 1). 높이면 날카로운 모서리만(매끈한 면은 실루엣만).
  // 엣지(폴리곤) 라인 오버레이 — 표면 위에 폴리곤 모서리를 라인으로. 프리미티브 전용.
  edges?: boolean;
  edgesColor?: string;         // 기본 검정
  edgesWidth?: number;         // 화면 픽셀 두께(기본 1.5)
  edgesThreshold?: number;     // 각도 임계값(°). 낮을수록 폴리곤이 더 많이 보임(기본 1). 높이면 날카로운 모서리만.
  // 셰이딩 종류 — 미설정/‘standard’=기존 PBR. ‘toon’=카툰(MeshToonMaterial). ‘matcap’=매트캡(라이팅 무관 스타일, MeshMatcapMaterial). shading!=standard일 때만 분기.
  shading?: 'standard' | 'toon' | 'matcap';
  toonSteps?: number;          // toon 음영 단계 수(기본 3, 2~6)
  matcapPreset?: 'studio' | 'chrome' | 'gold' | 'clay' | 'pearl'; // matcap 내장 프리셋(절차적 생성, lib/matcap.ts)
  matcapUrl?: string;          // 커스텀 matcap 이미지(있으면 프리셋 무시)
}

export interface ObjectNodeSchema {
  id: string;
  name: string;
  assetId: string | null;
  primitiveShape?: PrimitiveShape;
  // 프리미티브 확장 지오메트리 파라미터(둥근 박스 cornerRadius·각뿔대 topScale 등).
  geom?: PrimitiveGeom;
  // 복셀로 만든 오브젝트의 원본 복셀 데이터(레시피). 현재는 GLB로 구워 렌더하되 재편집·아이콘 식별용으로 보존.
  // (복셀 B안 재편집의 기반 — 있으면 계층 트리에서 복셀 아이콘 표시.)
  voxels?: { x: number; y: number; z: number; color: string }[];
  // 재질: materialId가 있으면 씬 materialAssets에서 참조(공유), 없으면 아래 인라인 material 사용(공존).
  materialId?: string;
  material?: MaterialOverride;
  // 시각 렌더 옵션(프리미티브/콘텐츠). 미설정 = 스무스 셰이딩·앞면만·그림자 생성+수신(기존 동작).
  render?: {
    flatShading?: boolean;   // true=각진 폴리곤(Flat), 미설정=부드러운(Smooth)
    doubleSided?: boolean;   // true=양면(DoubleSide), 미설정=앞면만(FrontSide)
    castShadow?: boolean;    // 미설정=true (그림자 생성)
    receiveShadow?: boolean; // 미설정=true (그림자 수신)
  };
  parentId: string | null;
  layer: string;
  position: Vector3;
  rotation: Vector3; // Euler degrees
  scale: Vector3;
  // 변형 기준점(앵커) — 각 축 정규화 0..1(0=min면·0.5=중심·1=max면). 미설정=중심(현재 동작, 하위호환).
  //   실제 로컬 점 = lerp(localBBox.min, localBBox.max, pivot). 스케일이 이 점을 고정한 채 일어난다
  //   (하단 앵커 = 바닥 고정 + 위로만 성장). doc/PIVOT_MANIPULATION.md.
  pivot?: Vector3;
  visible: boolean;
  locked: boolean;
  physics: PhysicsSchema;
  events: EventSchema[];
  content?: ContentConfig;
  particle?: ParticleConfig;
  light?: LightConfig;
  isGroup?: boolean;
  // 앰비언트 애니메이션 — 뷰어에서 항상 실행되는 트랜스폼 애니(GLB 자체 클립과 별개). 현재 GLB·프리미티브만.
  motion?: MotionConfig;
  // 관절(액추에이터) — 경첩 기준 축 회전/직선 이동. motion과 배타(있으면 motion 무시). doc/PIVOT_MANIPULATION.md §6.
  actuator?: ActuatorConfig;
  // 모터형 액추에이터 — 이 오브젝트 자체가 "모터 부품"(메쉬 없는 그룹, 에디터에 dot 표식).
  //   연결된 자식들을 자기 원점(=경첩)·축 기준으로 구동. isGroup:true와 함께 씀. hinge는 원점 고정(피커 없음).
  //   (속성형: 일반 오브젝트에 actuator만 얹어 그 오브젝트가 직접 움직임 — 하위호환 공존.)
  isActuator?: boolean;
  // 기본 애니메이션 클립 — GLB 내장 클립 중 트리거 없이 씬 로드 시 자동 루프 재생할 클립 이름.
  // 이벤트(click/hover/area/animate_object) 트리거 클립이 오면 fadeOut되며 덮인다(복귀 없음 — MVP).
  defaultClip?: string;
  // (레거시) 단문 근접 말풍선 — dialogue 미설정 시 lines:[interactLabel]·approach·auto로 해석.
  interactLabel?: string;
  // 대화(말풍선) — 오브젝트 위에 뜨는 순차 문장. 플레이 모드 전용.
  dialogue?: DialogueConfig;
  // 이 오브젝트의 상호작용 근접 범위(m) 오버라이드 — 미설정이면 씬 기본값(EnvSchema.interactRange ?? 3).
  //   interact(E)/approach 트리거·E 프롬프트·하이라이트에 적용.
  interactRange?: number;

  // ── 프리팹 인스턴스 링크 (전부 옵셔널 = 하위호환) ──
  // 이 오브젝트가 프리팹에서 펼쳐진(bake) 인스턴스 노드면 아래 태그가 붙는다.
  // 뷰어/임베드는 이 태그를 무시하고 평범한 오브젝트로 렌더한다(동기화는 에디터 전용).
  // ── 클로너 ──
  clonerConfig?: ClonerConfig; // 설정되면 이 그룹은 클로너(소스 1개 + 자동 생성 복제본들)
  clonerClone?: boolean;       // 클로너가 생성한 복제본(재생성 시 제거·교체됨). 소스엔 없음.

  prefabId?: string;           // 어느 프리팹 정의(scene.prefabs[].id)에서 나왔나
  prefabInstanceId?: string;   // 한 번 배치한 인스턴스 묶음의 id — 같은 인스턴스의 노드들을 묶는다
  prefabNodeKey?: string;      // 원본 정의의 어느 노드(PrefabNode.nodeKey)에 대응하나
  prefabOverrides?: PrefabOverrideGroup[]; // 이 노드에서 원본을 안 따르는 필드그룹 목록
}

// 인스턴스 override 추적 단위(필드그룹). 이 그룹에 속한 필드를 인스턴스에서 편집하면
// 동기화 시 그 그룹은 원본을 안 따른다. (transform=자식 노드 트랜스폼. 루트 트랜스폼은 항상 인스턴스 소유라 미추적.)
export type PrefabOverrideGroup =
  | 'transform'
  | 'material'
  | 'events'
  | 'motion'
  | 'physics'
  | 'content'
  | 'light'
  | 'particle'
  | 'name'
  | 'visibility'
  | 'dialogue';

// 프리팹 정의의 노드 하나. id/parentId 절대참조 대신 안정적 nodeKey/parentKey로 트리를 표현.
export type PrefabNodeData = Omit<
  ObjectNodeSchema,
  'id' | 'parentId' | 'prefabId' | 'prefabInstanceId' | 'prefabNodeKey' | 'prefabOverrides'
>;

export interface PrefabNode {
  nodeKey: string;             // 프리팹 내에서 안정적인 노드 식별자
  parentKey: string | null;    // null = 프리팹 루트
  data: PrefabNodeData;        // 오브젝트 필드(절대 id/parentId·프리팹 태그 제외)
}

// 프리팹 원본 정의 — 씬 단위 라이브러리(scene_data.prefabs)에 저장(MVP).
export interface PrefabSchema {
  id: string;
  name: string;
  rootKey: string;             // nodes 중 루트 노드의 nodeKey
  nodes: PrefabNode[];
  thumbnailUrl?: string;
  // 원본(master) 인스턴스의 prefabInstanceId. 이 인스턴스를 편집하면 def를 갱신하고 사본에 자동 전파.
  //   미설정 = 원본 미지정(레거시) → 수동 Apply 방식 유지, 사용자가 '원본으로 지정' 가능. (피그마 메인 컴포넌트 개념)
  masterInstanceId?: string;
}

// 클로너(비파괴 배열) 설정 — 이 그룹은 소스 1개를 count개로 실시간 복제 배치한다.
export interface ClonerConfig {
  mode: 'linear' | 'grid' | 'radial';
  count: number;                 // 원본 포함 총 개수(linear/radial). grid는 cols*rows로 결정.
  offset: Vector3;               // linear: 복제 간 간격. grid: x=열 간격·z=행 간격.
  radius?: number;               // radial: 반경
  axis?: 'x' | 'y' | 'z';        // radial: 원이 도는 축
  cols?: number;                 // grid: 열(가로) 개수
  rows?: number;                 // grid: 행(세로) 개수
  rotStep?: number;              // 복제마다 Y축 회전 증분(도) — 나선/트위스트
  rise?: number;                 // radial: 복제마다 Y 상승(m) — 나선 계단(헬릭스)
  turns?: number;                // radial: 전체 회전 바퀴 수(기본 1). >1이면 여러 바퀴 나선.
}

export interface MotionConfig {
  // float=둥실(위아래) / spin=제자리 회전(Y축) / pulse=커졌다작아짐 / orbit=원 궤도 / wander=영역 내 유동(열기구식)
  type: 'float' | 'spin' | 'pulse' | 'orbit' | 'wander';
  speed?: number;     // 속도 배수 (기본 1)
  amplitude?: number; // float=y 진폭 / pulse=스케일 진폭 (기본 float 0.5 · pulse 0.2)
  radius?: number;    // orbit=궤도 반경 / wander=이동 반경 (기본 orbit 2 · wander 3)
  axis?: 'x' | 'y' | 'z'; // spin 회전축 (기본 y)
  collider?: boolean; // 플레이 모드에서 콜라이더도 함께 이동(진짜 이동 장애물). 기본 false=시각 전용
}

// 관절(액추에이터) — 경첩(hinge) 기준으로 한 축을 min~max 범위에서 구동. doc/PIVOT_MANIPULATION.md §6.
export interface ActuatorConfig {
  kind: 'rotate' | 'slide';       // 회전 관절(경첩) / 직선 관절(피스톤)
  axis: 'x' | 'y' | 'z';          // 회전축(rotate) 또는 이동축(slide) — 오브젝트 로컬
  hinge?: Vector3;                // 경첩 위치(정규화 0..1, 미설정=형상 중심). 중(0.5)/엣지 허용. rotate 전용
  min: number;                    // rotate=각도(도) · slide=거리(m) — 닫힘/기준
  max: number;                    // rotate=각도(도) · slide=거리(m) — 열림/최대
  drive: 'manual' | 'oscillate' | 'variable' | 'event';
  value?: number;                 // 현재 위치 0..1 (min=0·max=1). 에디터 미리보기·초기값. 기본 0
  speed?: number;                 // oscillate 속도배수 / event 이동속도(초당 0..1). 기본 1
  loop?: 'pingpong' | 'forward';  // oscillate 방식. 기본 pingpong
  variable?: string;              // drive='variable'일 때 바인딩할 GameVariable.name
  varMin?: number;                // variable 구동 범위 매핑: 이 변수값 → 구동 0. 기본 0
  varMax?: number;                // variable 구동 범위 매핑: 이 변수값 → 구동 1. 기본 1
  ease?: 'smooth' | 'linear' | 'inout'; // variable/event 구동 이징. 기본 smooth(지수 감쇠). doc §6
  collider?: boolean;             // 플레이 모드 콜라이더 동반(진짜 장애물). 기본 false=시각
}

export interface DialogueConfig {
  lines: string[];                          // 순차로 표시할 문장들 (빈 줄은 무시)
  show: 'always' | 'approach' | 'interact'; // 항상 / 근접(기본 3m) / E키로 열기
  advance: 'auto' | 'manual';               // auto=타이머 자동 넘김, manual=E키로 넘김
  autoSec?: number;                         // auto일 때 문장 간 간격(초). 기본 2.5
  speaker?: string;                         // 화자 이름(말풍선 상단). 선택
  typing?: boolean;                         // 타이핑(타자기) 효과. 기본 true
  once?: boolean;                           // 1회성 — 한 번 끝까지 본 대화는 이 세션(페이지) 동안 다시 안 뜸
  endButtonLabel?: string;                  // dialogue_end 이벤트가 있을 때 마지막 문장에 뜨는 액션 버튼 라벨(기본 '확인')
}

export interface AssetRefSchema {
  id: string;
  dracoUrl: string; // 파일 URL (오디오는 오디오 파일, 텍스처는 이미지 파일 URL)
  name: string;
  type?: 'model' | 'character' | 'audio' | 'texture';
  thumbnailUrl?: string;
}

export interface ProjectSceneSchema {
  projectId: string;
  sceneId: string;
  version: number;
  environment: EnvSchema;
  assets: AssetRefSchema[];
  objects: ObjectNodeSchema[];
  // 프리팹 원본 정의 라이브러리(씬 단위·MVP). 미설정 = 프리팹 없음(하위호환).
  prefabs?: PrefabSchema[];
  // 공용 재질 에셋 라이브러리 — 여러 오브젝트가 id로 공유. 미설정 = 없음(하위호환, 기존 인라인 재질 유지).
  materialAssets?: MaterialAsset[];
  // 공용 색 팔레트 — 컬러 픽커에서 재사용할 저장된 색 스와치.
  colorAssets?: ColorAsset[];
  // 게임 변수(상태) 정의 — 뷰어 런타임에서 initial로 초기화. 미설정 = 없음(하위호환). GAME_LOGIC.md 참조.
  variables?: GameVariable[];
  // HUD 위젯 — 변수를 텍스트/체력바/목숨 아이콘으로 화면에 표시(Phase 2). 미설정 = 변수의 showInHud 간단 텍스트만.
  hudElements?: HudElement[];
  // 게임 컨트롤러(전역 로직) — 오브젝트에 매달리지 않은 씬 전역 규칙. scene_start/on_timer/variable_changed 트리거.
  //   EventSchema 재사용. 미설정 = 없음(하위호환). GAME_LOGIC.md '게임 컨트롤러' 참조.
  sceneEvents?: EventSchema[];
  // 사용자 저작 애니메이션 클립(키프레임). 미설정 = 없음(하위호환). ANIMATION.md 참조. 이벤트 액션 play_clip으로 재생.
  animClips?: AnimClip[];
}

// ── 애니메이션 클립(키프레임) — ANIMATION.md. 포즈=키 1개, 상태전환=키 2개, 타임라인=키 N개(같은 데이터). ──
export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'backOut' | 'bounceOut';
export interface AnimKeyframe {
  time: number;        // 초(클립 시작 기준)
  position?: Vector3;
  rotation?: Vector3;  // 도(deg) — 에디터 회전과 동일 단위
  scale?: Vector3;
  easing?: EasingType; // 이 키 → 다음 키 구간의 이징(미설정 시 클립 기본 easing 폴백)
}
export interface AnimTrack {
  objectId: string;        // 대상 오브젝트(그룹 자식 포함)
  keys: AnimKeyframe[];    // time 오름차순
  // 트랙별 회전 피벗(경첩) — 다중 트랙(양문 등)에서 오브젝트마다 다른 경첩용. 미설정 시 클립 레벨(AnimClip.pivot) 폴백.
  pivot?: Vector3;
  pivotBaked?: boolean;
}
export interface AnimClip {
  id: string;
  name: string;
  duration: number;        // 초
  loop?: boolean;
  tracks: AnimTrack[];     // 오브젝트별 트랙(단일=1개)
  rootId?: string | null;  // 스코프(그룹/프리팹 재사용용). 미설정/null=씬 전역
  easing?: EasingType; // 클립 기본 이징(키별 override는 AnimKeyframe.easing)
  // 회전 피벗(경첩) — 오브젝트 스케일드-로컬 오프셋(0.5×scale=모서리). 미설정=중심 회전.
  //   에디터 기즈모가 이 점을 기준으로 회전 → position+rotation이 함께 저장(baked)되어 에디터=재생 일치.
  pivot?: Vector3;
  // pivot 스윙이 키프레임 position에 이미 반영(baked)됐는지. true=런타임 순수 보간(pivotOffset 재적용 안 함).
  //   레거시(pivot만 있고 false)는 로드 시 1회 bake됨(store loadScene). 런타임은 안전상 !pivotBaked면 pivotOffset 폴백.
  pivotBaked?: boolean;
}

// HUD 위젯 — 게임 변수 하나를 화면에 시각화. (GAME_LOGIC.md Phase 2)
export interface HudElement {
  id: string;
  variable: string;                 // 바인딩할 GameVariable.name
  kind: 'text' | 'bar' | 'lives';   // text=이름+값 / bar=체력바(값/max) / lives=아이콘 N개
  label?: string;                   // 표시 라벨(미설정=변수명)
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  color?: string;                   // bar 채움색 / text·lives 강조색
  max?: number;                     // bar/lives 최대값(기본 100/bar, 3/lives)
  icon?: 'heart' | 'star' | 'circle'; // lives 아이콘 종류(기본 heart)
}

// 게임 변수(상태) 정의 — name이 참조 키(고유). 런타임 값은 뷰어 로컬(저장 안 함), 씬엔 initial만 저장.
//   number=숫자 / boolean=참거짓 / string=텍스트 / enum=고정 선택지(options 중 하나) / color=hex 색 / asset=모델 에셋 id.
//   enum·color·string·asset은 값이 전부 문자열(initial: string). asset은 AssetRefSchema.id를 담아 swap_model/spawn에서 소비.
export interface GameVariable {
  id: string;
  name: string;               // 참조 키 (예: 'score') — 조건/액션에서 이 이름으로 참조
  type: 'number' | 'boolean' | 'string' | 'enum' | 'color' | 'asset' | 'timer';
  initial: number | boolean | string;
  options?: string[];         // enum 전용 — 선택 가능한 상태 목록(예: locked/open)
  // 변수 지속 범위(Phase E). scene(기본)=씬 로드마다 initial / global=씬 이동해도 유지(세션) / persistent=브라우저 저장(최고점수·이어하기).
  scope?: 'scene' | 'global' | 'persistent';
  showInHud?: boolean;        // 뷰어 화면 HUD에 "이름: 값" 표시 여부. timer는 자동 카운트다운(숫자).
}

// 공용 재질 에셋 — 이름 붙인 재질을 라이브러리에 저장, 오브젝트가 materialId로 참조(원본 수정 시 일괄 반영).
export interface MaterialAsset {
  id: string;
  name: string;
  material: MaterialOverride;
}

// 공용 색 스와치 — 저장된 색을 여러 곳에서 재사용.
export interface ColorAsset {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_PHYSICS: PhysicsSchema = {
  enabled: false,
  colliderType: 'hull',
  isSensor: false,
  mass: 0,
  friction: 0.5,
  restitution: 0.0,
};

export const DEFAULT_ENVIRONMENT: EnvSchema = {
  sky: { type: 'color', value: '#f3f1f1' },
  fog: { enabled: false, color: '#ffffff', near: 10, far: 100 },
  lights: {
    ambientIntensity: 0.6,
    directionalPosition: { x: 5, y: 10, z: 5 },
    directionalIntensity: 1.2,
  },
  // 새 씬 기본 = 둘러보기 전용(Player 걷기 모드 off). 켜려면 Environment › Player 스위치.
  disableWalk: true,
  // 팝업 기본 크기 600×600 (미지정이면 뷰어가 큰 기본값을 써서 커 보이므로 명시).
  defaultPopup: { width: '600px', height: '600px' },
};

export const SCENE_VERSION = 1;

export function makeEmptySceneData(projectId: string, sceneId: string): ProjectSceneSchema {
  return {
    projectId,
    sceneId,
    version: SCENE_VERSION,
    environment: DEFAULT_ENVIRONMENT,
    assets: [],
    objects: [],
  };
}

/** Coerce any stored scene_data shape into ProjectSceneSchema */
export function normalizeSceneData(
  raw: Record<string, unknown>,
  projectId: string,
  sceneId: string,
): ProjectSceneSchema {
  if (
    typeof raw.projectId === 'string' &&
    typeof raw.sceneId === 'string' &&
    Array.isArray(raw.objects)
  ) {
    return {
      projectId: raw.projectId,
      sceneId: raw.sceneId,
      version: typeof raw.version === 'number' ? raw.version : SCENE_VERSION,
      environment: (raw.environment as EnvSchema | undefined) ?? DEFAULT_ENVIRONMENT,
      assets: Array.isArray(raw.assets) ? (raw.assets as AssetRefSchema[]) : [],
      objects: raw.objects as ObjectNodeSchema[],
      prefabs: Array.isArray(raw.prefabs) ? (raw.prefabs as PrefabSchema[]) : [],
      materialAssets: Array.isArray(raw.materialAssets) ? (raw.materialAssets as MaterialAsset[]) : undefined,
      colorAssets: Array.isArray(raw.colorAssets) ? (raw.colorAssets as ColorAsset[]) : undefined,
      variables: Array.isArray(raw.variables) ? (raw.variables as GameVariable[]) : undefined,
      hudElements: Array.isArray(raw.hudElements) ? (raw.hudElements as HudElement[]) : undefined,
      sceneEvents: Array.isArray(raw.sceneEvents) ? (raw.sceneEvents as EventSchema[]) : undefined,
      animClips: Array.isArray(raw.animClips) ? (raw.animClips as AnimClip[]) : undefined,
    };
  }
  return makeEmptySceneData(projectId, sceneId);
}
