// AI 생성(Generate 탭) — 프롬프트 → 우리 씬/재질 JSON.
// BYOK: 사용자 API 키로 브라우저에서 공급자 API를 직접 호출한다(서버 경유·키 저장 없음).
// 출력은 기존 import 파이프라인(parseMaterialJson/parseSceneJson)으로 검증 후 씬에 병합.
import type { AiProvider, SessionModel } from '@/store/aiPrefsStore';

const CLAUDE_MODEL = 'claude-opus-4-8';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function callClaude(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic API는 이 헤더가 있어야 브라우저(CORS) 직접 호출을 허용한다.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Claude API 오류: ${msg}`);
  }
  const text = (json?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  if (!text) throw new Error('Claude 응답이 비어있습니다.');
  return text;
}

async function callGemini(apiKey: string, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Gemini API 오류: ${msg}`);
  }
  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('');
  if (!text) throw new Error('Gemini 응답이 비어있습니다.');
  return text;
}

// 로컬 Claude 세션(구독) — /api/generate 라우트가 이 머신의 Claude Code 로그인으로 생성한다.
// model 미지정 시 서버가 CLI의 현재 활성 모델(/model)을 그대로 상속.
async function callSession(system: string, user: string, model?: SessionModel): Promise<string> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, prompt: user, model }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `세션 생성 실패 (HTTP ${res.status})`);
  if (!json?.text) throw new Error('세션 응답이 비어있습니다.');
  return json.text;
}

export async function callAi(provider: AiProvider, apiKey: string, system: string, user: string, sessionModel?: SessionModel): Promise<string> {
  if (provider === 'session') return callSession(system, user, sessionModel);
  if (!apiKey) throw new Error('API 키를 먼저 입력해주세요.');
  return provider === 'claude' ? callClaude(apiKey, system, user) : callGemini(apiKey, system, user);
}

// LLM 응답에서 JSON을 관대하게 추출 — 코드펜스/설명문이 섞여도 첫 {…} 또는 […] 블록을 파싱.
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch { /* fall through */ }
  }
  const start = Math.min(...['{', '['].map((c) => { const i = trimmed.indexOf(c); return i === -1 ? Infinity : i; }));
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (Number.isFinite(start) && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('응답에서 JSON을 찾을 수 없습니다.');
}

// ── 시스템 프롬프트 ──
// 스키마 설명은 영어(토큰 효율·정확도), 값 규약은 이 프로젝트의 렌더 규칙과 일치해야 한다.

export const MATERIAL_SYSTEM_PROMPT = `You generate PBR material definitions for a 3D editor.
Output ONLY a JSON array, no prose, no markdown fences. Each item:
{"name": "<korean display name>", "material": {<fields>}}
Material fields (all optional):
- color: "#rrggbb" base color
- roughness: 0..1 (0=mirror gloss, 1=fully matte)
- metalness: 0..1 (1=metal)
- emissive: "#rrggbb" self-glow color (omit or "#000000" for none)
- clearcoat: 0..1 (car paint / lacquer top coat)
- sheen: 0..1 (fabric/velvet edge glow)
- transmission: 0..1 (glass/water transparency; pair with ior)
- ior: refraction index, typically 1.3~1.8 (only with transmission>0)
Generate 1~6 materials that best match the user's request. Korean names.`;

const SCENE_SCHEMA_DOC = `You generate scenes for a 3D no-code editor that assembles primitive shapes.
Output ONLY JSON, no prose, no markdown fences, in this shape:
{"objects": [<ObjectNode>, ...]}

ObjectNode fields:
- id: unique short string ("o1","o2",...) — required
- name: short korean label — required
- parentId: id of a group node, or null (default null)
- isGroup: true only for group nodes (a group has no shape itself; children reference it via parentId; child position/rotation/scale are LOCAL to the group)
- primitiveShape: "box" | "sphere" | "cylinder" | "frustum" | "loft" (non-group visual nodes need this)
- geom (optional):
  - box: {"cornerRadius": 0..0.5} rounded corners (radius = fraction of shortest side)
  - frustum: {"topScale": 0..1} tapered box (0=pyramid, 1=box)
  - loft: {"sections": [1,0.7,0.4]} bottom→top width multipliers (vase/rocket/tower profiles, 2~8 values 0..1)
- material: {"color": "#rrggbb", "roughness": 0..1, "metalness": 0..1, "emissive": "#rrggbb"} (emissive only for glowing parts)
- position: {"x","y","z"} in meters. Y is up. Ground plane is y=0.
- rotation: {"x","y","z"} Euler degrees
- scale: {"x","y","z"} — primitives are unit-sized (1m), so scale IS the size in meters. sphere: diameter 1. cylinder: diameter 1, height 1 (axis = Y).
- light (optional, with primitiveShape omitted and assetId null): {"type": "point"|"spot", "color": "#rrggbb", "intensity": 1..5}

Placement rules (critical):
- box/cylinder/sphere/frustum/loft origins are at their CENTER → to rest on the ground set position.y = scale.y / 2.
- Use thin boxes (scale.y 0.05~0.2) for floors, roads and flat panels. Do NOT use "plane".
- Objects must not interpenetrate except intentional joins. Keep everything within a 40m×40m area centered at origin.
- Stylized low-poly look: flat colors, no textures. Vary colors deliberately (pastel/vivid palette).
- Trees: cylinder trunk + sphere or frustum foliage. Windows/doors: thin boxes slightly in front of walls (offset 0.02).`;

export const SCENE_SYSTEM_PROMPT = `${SCENE_SCHEMA_DOC}

Task: build a complete SCENE (environment) from the user's description — buildings/props/nature arranged coherently. Use 20~60 objects. Group related parts (e.g. one building = group with wall/roof/window children).`;

export const OBJECT_SYSTEM_PROMPT = `${SCENE_SCHEMA_DOC}

Task: build ONE object/prop from the user's description as an assembly of 3~20 primitives, centered near the origin, resting on the ground (y=0). Group all parts under a single root group node named after the object.`;
