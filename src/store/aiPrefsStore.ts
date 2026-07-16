import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// AI 생성(Generate 탭) 공급자/키 설정 — 씬 데이터 아님, 이 브라우저(localStorage)에만 저장.
// 'session' = 이 컴퓨터의 Claude Code 로그인(구독 플랜)을 서버 라우트(/api/generate)가 사용 — 키 불필요, 로컬 개발 전용.
// 'claude'/'gemini' = BYOK(Bring Your Own Key): 키는 사용자 소유, 브라우저에서 공급자 API를 직접 호출.
export type AiProvider = 'session' | 'claude' | 'gemini';

export const AI_PROVIDERS: { id: AiProvider; label: string; needsKey: boolean; keyHint: string; keyUrl: string }[] = [
  { id: 'session', label: 'Claude 세션', needsKey: false, keyHint: '', keyUrl: '' },
  { id: 'claude',  label: 'Claude API', needsKey: true, keyHint: 'sk-ant-...', keyUrl: 'https://platform.claude.com/settings/keys' },
  { id: 'gemini',  label: 'Gemini API', needsKey: true, keyHint: 'AIza...', keyUrl: 'https://aistudio.google.com/apikey' },
];

// Claude 세션(구독) 경로 전용 모델 선택 — 토큰(구독 사용량) 소모를 사용자가 직접 조절.
export type SessionModel = 'claude-haiku-4-5' | 'claude-sonnet-5' | 'claude-opus-4-8';

export const SESSION_MODELS: { id: SessionModel; label: string; hint: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: '가장 저렴·빠름 — 재질/단순 오브젝트' },
  { id: 'claude-sonnet-5',  label: 'Sonnet 5',  hint: '균형 (기본값)' },
  { id: 'claude-opus-4-8',  label: 'Opus 4.8',  hint: '최고 품질 — 복잡한 씬, 토큰 많이 씀' },
];

interface AiPrefsStore {
  provider: AiProvider;
  keys: Record<'claude' | 'gemini', string>;
  sessionModel: SessionModel;
  setProvider: (p: AiProvider) => void;
  setKey: (p: 'claude' | 'gemini', key: string) => void;
  setSessionModel: (m: SessionModel) => void;
}

export const useAiPrefsStore = create<AiPrefsStore>()(
  persist(
    (set) => ({
      provider: 'session',
      keys: { claude: '', gemini: '' },
      sessionModel: 'claude-sonnet-5',
      setProvider: (p) => set({ provider: p }),
      setKey: (p, key) => set((s) => ({ keys: { ...s.keys, [p]: key.trim() } })),
      setSessionModel: (m) => set({ sessionModel: m }),
    }),
    { name: 'park3d-ai-prefs' },
  ),
);
