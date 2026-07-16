// AI 생성 — 로컬 Claude 세션(구독 플랜) 경로.
// Claude Agent SDK가 이 머신의 Claude Code 로그인(OAuth)을 그대로 사용한다 → API 키 불필요, 구독으로 과금.
// 제약: dev 서버가 도는 머신에 Claude Code 로그인이 있어야 동작(배포 서버에선 실패 → 클라이언트는 BYOK 폴백).
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@anthropic-ai/claude-agent-sdk';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { system?: string; prompt?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }
  const { system, prompt, model } = body;
  if (!system || !prompt) {
    return NextResponse.json({ error: 'system/prompt가 필요합니다.' }, { status: 400 });
  }

  try {
    let text = '';
    // 도구 없이 1턴 순수 텍스트 생성 — 시스템 프롬프트(스키마 문서)에 따라 JSON만 출력.
    // model 미지정 시 CLI의 현재 활성 모델(/model로 설정한 값)을 그대로 상속.
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt: system,
        maxTurns: 3,
        allowedTools: [],
        ...(model ? { model } : {}),
      },
    })) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          text = msg.result;
        } else {
          return NextResponse.json({ error: `생성 실패 (${msg.subtype})` }, { status: 502 });
        }
      }
    }
    if (!text) {
      return NextResponse.json({ error: 'Claude 세션 응답이 비어있습니다.' }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류';
    // Claude Code 미로그인/미설치 등 — 클라이언트가 안내 문구를 보여준다.
    return NextResponse.json({ error: `Claude 세션을 사용할 수 없습니다: ${msg}` }, { status: 500 });
  }
}
