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

interface AiPrefsStore {
  provider: AiProvider;
  keys: Record<'claude' | 'gemini', string>;
  setProvider: (p: AiProvider) => void;
  setKey: (p: 'claude' | 'gemini', key: string) => void;
}

export const useAiPrefsStore = create<AiPrefsStore>()(
  persist(
    (set) => ({
      provider: 'session',
      keys: { claude: '', gemini: '' },
      setProvider: (p) => set({ provider: p }),
      setKey: (p, key) => set((s) => ({ keys: { ...s.keys, [p]: key.trim() } })),
    }),
    { name: 'park3d-ai-prefs' },
  ),
);
