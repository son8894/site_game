'use client';

/**
 * 공포 게임 템플릿(SCENE_TEMPLATES 'horror')을 **실제 뷰어로** 미리보는 격리 페이지.
 * 로그인·게시 없이 레벨을 확인하려고 둔다 — EditorClient의 ▶ 플레이와 동일하게
 * `ViewerClient`에 씬 데이터를 직접 넘긴다(따라서 안개·조명·게임 규칙·HUD가 전부 실제 동작).
 * ?t=<templateId> 로 다른 템플릿도 볼 수 있다.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { SCENE_TEMPLATES } from '@/lib/sceneTemplates';

const ViewerClient = dynamic(
  () => import('@/app/space/[sceneId]/ViewerClient').then((m) => m.ViewerClient),
  { ssr: false },
);

export default function HorrorTestPage() {
  const id = useSearchParams().get('t') ?? 'horror';
  const scene = useMemo(() => {
    const t = SCENE_TEMPLATES.find((x) => x.id === id) ?? SCENE_TEMPLATES[0];
    return t.build('test-project', 'test-scene');
  }, [id]);

  return (
    <div className="w-screen h-screen">
      <ViewerClient scene={scene} projectName={`TEST · ${id}`} isOwner hideBadge variant="standalone" />
    </div>
  );
}
