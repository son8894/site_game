'use client';

import { useRef, useState, Suspense } from 'react';
import { useSceneStore } from '@/store/sceneStore';
import { useToast } from '@/hooks/useToast';
import { createBrowserSupabase } from '@/lib/supabase';
import { persistCurrentScene } from '@/lib/saveScene';
import { tryEmbedTextures } from '@/lib/glbEmbed';
import { uploadGlbBlob, uploadAudioFile, uploadImageTexture } from '@/lib/uploadAsset';
import { validateGLB } from '@/lib/validateGlb';
import { AssetPreviewPopup } from './AssetPreviewPopup';
import { SelectBox } from '@/components/ui/SelectBox';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { InlineEditName } from '@/components/ui/InlineEditName';
import type { AssetRefSchema, ContentType, ParticlePreset, LightType, HdrPreset, MaterialOverride } from '@/types/scene';
import { parseMaterialJson, parseSceneJson, type ParsedSceneImport } from '@/lib/importJson';
import { callAi, extractJson, MATERIAL_SYSTEM_PROMPT, SCENE_SYSTEM_PROMPT, OBJECT_SYSTEM_PROMPT } from '@/lib/aiGenerate';
import { useAiPrefsStore, AI_PROVIDERS, SESSION_MODELS } from '@/store/aiPrefsStore';
import {
  Package, PersonStanding, Music, Play, Square, X, Check, Plus, Type, Image as ImageIcon, Video,
  Flame, Wind, Sparkles, Snowflake, Lightbulb, Flashlight, Sun,
  Ban, Sunset, Sunrise, Moon, TreePine, Trees, Building2, Factory, Sofa, Landmark,
  SlidersHorizontal, Upload, FileJson, Boxes,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = 'generate' | 'models' | 'character' | 'content' | 'particle' | 'lights' | 'materials' | 'textures' | 'hdr' | 'audio';

const TABS: { id: Tab; label: string; wip?: boolean }[] = [
  { id: 'generate',  label: 'Generate' },
  { id: 'models',    label: 'Models' },
  { id: 'character', label: 'Character' },
  { id: 'content',   label: 'Content' },
  { id: 'particle',  label: 'Particle' },
  { id: 'lights',    label: 'Lights' },
  { id: 'materials', label: 'Materials' },
  { id: 'textures',  label: 'Textures' },
  { id: 'hdr',       label: 'HDR' },
  { id: 'audio',     label: 'Audio' },
];

type GenerateSub = 'object' | 'scene' | 'material';
const GENERATE_SUBS: { id: GenerateSub; label: string; icon: LucideIcon }[] = [
  { id: 'object',   label: '오브젝트 생성', icon: Boxes },
  { id: 'scene',    label: '씬 생성',      icon: Building2 },
  { id: 'material', label: '재질 생성',    icon: SlidersHorizontal },
];

// 재질 프리셋 — 선택한 프리미티브의 표면 질감(roughness/metalness/발광)을 한 번에 바꾼다. 색은 유지.
// emissive: '#000000'=발광 없음, 'SELF'=오브젝트 현재 색으로 자체 발광(네온).
const MATERIAL_PRESETS: { id: string; label: string; mat: Pick<MaterialOverride, 'roughness' | 'metalness' | 'emissive'>; swatch: string }[] = [
  { id: 'reset',   label: '기본',       mat: { roughness: 0.5,  metalness: 0.1, emissive: '#000000' }, swatch: 'linear-gradient(135deg,#cbd5e1,#94a3b8)' },
  { id: 'matte',   label: '무광',       mat: { roughness: 0.95, metalness: 0,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#9aa4b2,#6b7280)' },
  { id: 'glossy',  label: '유광',       mat: { roughness: 0.1,  metalness: 0,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#eef4fb 0%,#8b97a8 55%,#dbe3ee 100%)' },
  { id: 'plastic', label: '플라스틱',   mat: { roughness: 0.4,  metalness: 0,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#c7d0dc,#7f8a99)' },
  { id: 'metal',   label: '금속',       mat: { roughness: 0.3,  metalness: 1,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#eef2f6 0%,#9fa9b6 45%,#5c6470 100%)' },
  { id: 'chrome',  label: '크롬',       mat: { roughness: 0.04, metalness: 1,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#ffffff 0%,#8fa0b3 40%,#3f4855 70%,#e6ecf3 100%)' },
  { id: 'rubber',  label: '고무',       mat: { roughness: 1,    metalness: 0,   emissive: '#000000' }, swatch: 'linear-gradient(135deg,#4b5563,#1f2937)' },
  { id: 'glow',    label: '네온(발광)', mat: { roughness: 0.5,  metalness: 0,   emissive: 'SELF'    }, swatch: 'linear-gradient(135deg,#fde68a,#f472b6)' },
];

// 재질 속성(색/거칠기/금속성/발광)을 CSS 그라데이션으로 근사 — 원형 스와치가 실시간으로 재질 룩 반영.
//   낮은 roughness=작고 밝은 하이라이트(반질), 높음=넓고 흐림(무광). 높은 metalness=강한 대비. 발광=중앙 글로우.
function materialSwatchBg(mat: MaterialOverride): string {
  const color = mat.color ?? '#a78bfa';
  const rough = Math.min(1, Math.max(0, mat.roughness ?? 0.5));
  const metal = Math.min(1, Math.max(0, mat.metalness ?? 0.1));
  const emissive = mat.emissive && mat.emissive !== '#000000' && mat.emissive !== 'SELF' ? mat.emissive : null;
  const specA = Math.max(0, Math.min(0.9, (1 - rough) * (0.5 + metal * 0.4) + 0.08));
  const specR = 20 + rough * 38;
  const shadowA = 0.12 + metal * 0.3;
  const layers = [
    `radial-gradient(circle at 33% 27%, rgba(255,255,255,${specA.toFixed(2)}), rgba(255,255,255,0) ${specR.toFixed(0)}%)`,
    `radial-gradient(circle at 72% 80%, rgba(0,0,0,${shadowA.toFixed(2)}), rgba(0,0,0,0) 56%)`,
  ];
  if (emissive) layers.push(`radial-gradient(circle at 50% 48%, ${emissive}dd, ${emissive}00 68%)`);
  layers.push(color);
  return layers.join(', ');
}

// HDR 환경(IBL + 배경) 프리셋 타일 — 씬 전역 hdrPreset을 설정. 'none'=끄기(단색/하늘로 복귀).
const HDR_TILES: { id: HdrPreset; label: string; icon: LucideIcon; swatch: string }[] = [
  { id: 'none',      label: '끄기',    icon: Ban,       swatch: 'linear-gradient(135deg,#e5e7eb,#cbd5e1)' },
  { id: 'sunset',    label: 'Sunset',  icon: Sunset,    swatch: 'linear-gradient(135deg,#ff9d5c,#c2410c)' },
  { id: 'dawn',      label: 'Dawn',    icon: Sunrise,   swatch: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)' },
  { id: 'night',     label: 'Night',   icon: Moon,      swatch: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  { id: 'forest',    label: 'Forest',  icon: TreePine,  swatch: 'linear-gradient(135deg,#4ade80,#166534)' },
  { id: 'park',      label: 'Park',    icon: Trees,     swatch: 'linear-gradient(135deg,#bbf7d0,#60a5fa)' },
  { id: 'city',      label: 'City',    icon: Building2,  swatch: 'linear-gradient(135deg,#94a3b8,#475569)' },
  { id: 'warehouse', label: 'Factory', icon: Factory,   swatch: 'linear-gradient(135deg,#a8a29e,#57534e)' },
  { id: 'apartment', label: 'Indoor',  icon: Sofa,      swatch: 'linear-gradient(135deg,#fde9c8,#c8a97e)' },
  { id: 'lobby',     label: 'Lobby',   icon: Landmark,  swatch: 'linear-gradient(135deg,#f1e4cf,#b0a184)' },
  { id: 'studio',    label: 'Studio',  icon: Lightbulb, swatch: 'linear-gradient(135deg,#f8fafc,#cbd5e1)' },
];

const CONTENT_ITEMS: { type: ContentType; label: string; icon: LucideIcon }[] = [
  { type: 'text',  label: '텍스트', icon: Type },
  { type: 'image', label: '이미지', icon: ImageIcon },
  { type: 'video', label: '동영상', icon: Video },
];

const PARTICLE_ITEMS: { preset: ParticlePreset; label: string; icon: LucideIcon }[] = [
  { preset: 'fire',  label: '불꽃',   icon: Flame },
  { preset: 'dust',  label: '먼지',   icon: Wind },
  { preset: 'light', label: '빛',     icon: Sparkles },
  { preset: 'snow',  label: '눈',     icon: Snowflake },
];

const LIGHT_ITEMS: { type: LightType; label: string; icon: LucideIcon }[] = [
  { type: 'point',       label: '포인트',     icon: Lightbulb },
  { type: 'spot',        label: '스팟',       icon: Flashlight },
  { type: 'directional', label: '방향 라이트', icon: Sun },
];

export function AssetBrowser() {
  const { projectId, assets, environment, addAsset, beginPlacement, removeAsset, removeObjectsByAsset, updateEnvironment, updateObject, pushHistory,
    materialAssets, assignMaterialAsset, updateMaterialAsset, renameMaterialAsset, removeMaterialAsset,
    colorAssets, addColorAsset, removeColorAsset, importMaterialAssets, importSceneJson } = useSceneStore();
  const [expandedMat, setExpandedMat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('models');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { addToast } = useToast();
  const modelInputRef = useRef<HTMLInputElement>(null);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);

  // ── Generate 탭 상태 ──
  const [generateSub, setGenerateSub] = useState<GenerateSub>('object');
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  // 생성 결과 스테이징 — 바로 적용하지 않고 미리보기 카드에서 [적용]을 눌러야 씬에 반영.
  const [pendingGenerated, setPendingGenerated] = useState<
    | { kind: 'material'; items: { name: string; material: MaterialOverride }[] }
    | { kind: 'scene'; data: ParsedSceneImport }
    | null
  >(null);
  const aiProvider = useAiPrefsStore((s) => s.provider);
  const aiKeys = useAiPrefsStore((s) => s.keys);
  const setAiProvider = useAiPrefsStore((s) => s.setProvider);
  const setAiKey = useAiPrefsStore((s) => s.setKey);
  const sessionModel = useAiPrefsStore((s) => s.sessionModel);
  const setSessionModel = useAiPrefsStore((s) => s.setSessionModel);
  const aiProviderInfo = AI_PROVIDERS.find((p) => p.id === aiProvider)!;
  const aiKey = aiProvider === 'session' ? '' : aiKeys[aiProvider];
  const aiReady = !aiProviderInfo.needsKey || !!aiKey;

  const runGenerate = async () => {
    const prompt = generatePrompt.trim();
    if (!prompt || isGenerating) return;
    if (!aiReady) {
      setShowAiSettings(true);
      addToast('먼저 API 키를 입력해주세요.', 'error');
      return;
    }
    setIsGenerating(true);
    setPendingGenerated(null);
    try {
      const system = generateSub === 'material' ? MATERIAL_SYSTEM_PROMPT
        : generateSub === 'scene' ? SCENE_SYSTEM_PROMPT : OBJECT_SYSTEM_PROMPT;
      const text = await callAi(aiProvider, aiKey, system, prompt, sessionModel);
      const raw = extractJson(text);
      if (generateSub === 'material') {
        const items = parseMaterialJson(raw);
        setPendingGenerated({ kind: 'material', items });
      } else {
        const data = parseSceneJson(raw);
        setPendingGenerated({ kind: 'scene', data });
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'AI 생성에 실패했습니다.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const applyGenerated = () => {
    if (!pendingGenerated) return;
    if (pendingGenerated.kind === 'material') {
      const count = importMaterialAssets(pendingGenerated.items);
      addToast(`재질 ${count}개 추가됨 (Materials 탭 "저장된 재질")`, 'success');
    } else {
      const { objectCount } = importSceneJson(pendingGenerated.data);
      addToast(`오브젝트 ${objectCount}개를 씬에 추가했습니다 (Ctrl+Z로 취소 가능)`, 'success');
    }
    setPendingGenerated(null);
  };

  // 라이브러리 텍스처를 현재 선택한 프리미티브 오브젝트(들)에 적용.
  const applyTextureToSelection = (url: string) => {
    const st = useSceneStore.getState();
    const targets = st.selectedIds.filter((id) => {
      const o = st.objects.find((x) => x.id === id);
      return o?.primitiveShape && !o.content;
    });
    if (targets.length === 0) {
      addToast('먼저 프리미티브(박스·구체 등)를 선택하세요.', 'error');
      return;
    }
    for (const id of targets) {
      const cur = st.objects.find((o) => o.id === id)?.material;
      updateObject(id, { material: { ...cur, textureUrl: url } });
    }
    pushHistory();
    addToast(`텍스처 적용 (${targets.length}개)`, 'success');
  };

  // 재질 프리셋을 선택한 프리미티브(들)에 적용. 색·텍스처는 유지하고 질감만 바꾼다.
  const applyMaterialToSelection = (preset: typeof MATERIAL_PRESETS[number]) => {
    const st = useSceneStore.getState();
    const targets = st.selectedIds.filter((id) => {
      const o = st.objects.find((x) => x.id === id);
      return o?.primitiveShape && !o.content;
    });
    if (targets.length === 0) {
      addToast('먼저 프리미티브(박스·구체 등)를 선택하세요.', 'error');
      return;
    }
    for (const id of targets) {
      const cur = st.objects.find((o) => o.id === id)?.material;
      const emissive = preset.mat.emissive === 'SELF' ? (cur?.color ?? '#ffffff') : preset.mat.emissive;
      updateObject(id, { material: { ...cur, roughness: preset.mat.roughness, metalness: preset.mat.metalness, emissive } });
    }
    pushHistory();
    addToast(`${preset.label} 재질 적용 (${targets.length}개)`, 'success');
  };

  // 저장된 공용 재질 에셋을 선택한 프리미티브(들)에 연결(materialId 참조). 원본 수정 시 전부 반영.
  const applyMaterialAssetToSelection = (materialId: string) => {
    const st = useSceneStore.getState();
    const targets = st.selectedIds.filter((id) => {
      const o = st.objects.find((x) => x.id === id);
      return o?.primitiveShape && !o.content;
    });
    if (targets.length === 0) { addToast('먼저 프리미티브를 선택하세요.', 'error'); return; }
    assignMaterialAsset(targets, materialId);
    addToast(`공유 재질 연결 (${targets.length}개)`, 'success');
  };

  // 저장된 색을 선택 프리미티브들의 재질 색에 적용(인라인). 참조 재질이면 무시(연결 끊고 써야).
  const applyColorToSelection = (color: string) => {
    const st = useSceneStore.getState();
    const targets = st.selectedIds.filter((id) => {
      const o = st.objects.find((x) => x.id === id);
      return o?.primitiveShape && !o.content && !o.materialId;
    });
    if (targets.length === 0) { addToast('먼저 프리미티브(공유 재질 아닌)를 선택하세요.', 'error'); return; }
    for (const id of targets) {
      const cur = st.objects.find((o) => o.id === id)?.material;
      updateObject(id, { material: { ...cur, color } });
    }
    pushHistory();
    addToast(`색 적용 (${targets.length}개)`, 'success');
  };
  // 선택 프리미티브의 현재 색을 팔레트에 저장.
  const saveSelectedColor = () => {
    const st = useSceneStore.getState();
    const sel = st.selectedIds.map((id) => st.objects.find((o) => o.id === id)).find((o) => o?.primitiveShape && !o.content);
    const color = sel?.material?.color ?? '#a78bfa';
    addColorAsset(color, color);
    addToast('색 저장됨', 'success');
  };

  // HDR 환경 프리셋 적용(씬 전역). none이면 끄기(단색/하늘 배경으로 복귀).
  const applyHdr = (id: HdrPreset) => {
    updateEnvironment({ hdrPreset: id });
    pushHistory();
  };

  const handleTextureFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(e.target.files ?? [])[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      addToast('이미지 파일(JPG·PNG·WEBP)을 선택해주세요.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) { addToast('이미지가 너무 큽니다. 최대 8MB까지 지원합니다.', 'error'); return; }
    if (!projectId) return;
    setUploading(true);
    try {
      const asset = await uploadImageTexture(file, projectId);
      addAsset(asset);
      const result = await persistCurrentScene();
      if (result.status === 'conflict') addToast('텍스처는 업로드됐지만 다른 탭·기기에서 씬이 먼저 저장돼 반영하지 못했어요. 새로고침 후 다시 시도해 주세요.', 'error');
      else addToast('텍스처 업로드 완료', 'success');
    } catch (err) {
      addToast(`텍스처 업로드 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const deleteAsset = async (asset: AssetRefSchema) => {
    if (deletingId) return;

    // 사용 중이면 연쇄 삭제 확인 — 에셋과 함께 참조 오브젝트도 정리해 유령 참조를 막는다
    // (다른 씬의 사용 여부까지는 확인하지 못하는 한계 있음)
    const cur = useSceneStore.getState();
    const usedCount = cur.objects.filter((o) => o.assetId === asset.id).length;
    const isPlayerChar = cur.environment.playerCharacterId === asset.id;
    if (usedCount > 0 || isPlayerChar) {
      const lines = [`"${asset.name}" 에셋을 삭제하면:`];
      if (usedCount > 0) lines.push(`• 씬에서 이 에셋을 쓰는 오브젝트 ${usedCount}개도 함께 삭제됩니다`);
      if (isPlayerChar) lines.push('• 플레이어 캐릭터 지정이 해제됩니다');
      lines.push('\n계속할까요? (복구할 수 없습니다)');
      if (!confirm(lines.join('\n'))) return;
    }

    setDeletingId(asset.id);
    try {
      const supabase = createBrowserSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Storage 파일 삭제 (실패해도 DB·스토어는 계속 진행)
      // URL은 .../object/public/{bucket}/{path} (신규) 또는
      // .../object/sign/{bucket}/{path}?token=... (구 데이터) 형태 —
      // remove()에는 버킷 이후의 경로만 전달해야 한다
      // external(씬 JSON 가져오기로 등록된 에셋)은 원본 URL을 그대로 참조하는 것이라
      // 스토리지 파일을 지우면 안 됨(다른 프로젝트/계정의 원본을 실수로 삭제할 수 있음).
      const storagePath = asset.external ? null : (() => {
        const m = asset.dracoUrl.match(/\/object\/(?:public|sign)\/assets\/([^?]+)/);
        try { return m ? decodeURIComponent(m[1]) : null; } catch { return m ? m[1] : null; }
      })();
      if (storagePath) {
        const thumbPath = storagePath.replace(/\.glb$/i, '_thumb.png');
        const paths = thumbPath !== storagePath ? [storagePath, thumbPath] : [storagePath];
        await supabase.storage.from('assets').remove(paths).catch(() => {});
      }

      // DB 삭제
      const { error } = await supabase.from('assets').delete().eq('id', asset.id);
      if (error) throw error;

      // DB 삭제 성공 후에만 씬 반영(연쇄) — 중간 실패 시 부분 반영 방지
      if (usedCount > 0) removeObjectsByAsset(asset.id);
      if (isPlayerChar) updateEnvironment({ playerCharacterId: undefined });
      removeAsset(asset.id);

      // scenes.scene_data도 즉시 반영 (새로고침 시 삭제된 에셋이 복원되는 버그 방지).
      // 낙관적 잠금 — 다른 탭/기기가 먼저 저장했으면 conflict로 덮어쓰기 차단.
      const result = await persistCurrentScene();
      if (result.status === 'conflict') {
        addToast('에셋은 삭제됐지만, 다른 탭·기기에서 씬이 먼저 저장되어 반영하지 못했습니다. 새로고침 후 다시 시도해 주세요.', 'error');
        return;
      }

      addToast(`"${asset.name}" 삭제됨`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '삭제 실패';
      addToast(msg, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const uploadGlb = async (file: File, assetType: AssetRefSchema['type'], textureFiles: File[] = []) => {
    if (!projectId) return;
    if (file.size > 50 * 1024 * 1024) {
      addToast('파일이 너무 큽니다. 최대 50MB까지 지원합니다.', 'error');
      return;
    }
    setUploading(true);
    try {
      // GLB 파일 검증 (깨진 파일 업로드 방지)
      await validateGLB(file);
      // glb가 텍스처를 외부 파일로 참조하고 있고, 함께 선택한 파일 중 일치하는 게 있으면
      // 완전히 임베드된 새 glb로 재포장한다. 해당 없음/실패 시 blob은 null → 원본 그대로 업로드.
      const { blob, embeddedNames, missingNames } = await tryEmbedTextures(file, textureFiles);
      if (embeddedNames.length > 0) {
        addToast(`텍스처 ${embeddedNames.length}개를 파일에 포함했습니다: ${embeddedNames.join(', ')}`, 'success');
      }
      if (missingNames.length > 0) {
        addToast(`일부 텍스처를 찾을 수 없어 비어있을 수 있습니다: ${missingNames.join(', ')}`, 'error');
      }
      const uploadBody: File | Blob = blob ?? file;

      const asset = await uploadGlbBlob(uploadBody, file.name.replace(/\.glb$/i, ''), projectId, assetType);
      addAsset(asset);

      // scenes.scene_data 즉시 반영 (새로고침 후 에셋이 사라지는 버그 방지).
      // 낙관적 잠금 — 다른 탭/기기가 먼저 저장했으면 conflict (에셋 파일은 이미 업로드됨).
      const result = await persistCurrentScene();
      if (result.status === 'conflict') {
        addToast('에셋은 업로드됐지만, 다른 탭·기기에서 씬이 먼저 저장되어 반영하지 못했습니다. 새로고침 후 다시 시도해 주세요.', 'error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      addToast(`에셋 업로드 실패: ${msg}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    const modelFile = fileList.find((f) => /\.glb$/i.test(f.name));
    if (!modelFile) {
      if (fileList.length > 0) addToast('.glb 파일을 선택해주세요.', 'error');
      return;
    }
    const textureFiles = fileList.filter((f) => f !== modelFile);
    await uploadGlb(modelFile, 'model', textureFiles);
  };

  const handleCharacterFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    const modelFile = fileList.find((f) => /\.glb$/i.test(f.name));
    if (!modelFile) {
      if (fileList.length > 0) addToast('.glb 파일을 선택해주세요.', 'error');
      return;
    }
    const textureFiles = fileList.filter((f) => f !== modelFile);
    await uploadGlb(modelFile, 'character', textureFiles);
  };

  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(e.target.files ?? [])[0];
    e.target.value = '';
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name)) {
      addToast('오디오 파일(mp3·wav·ogg 등)을 선택해주세요.', 'error');
      return;
    }
    if (file.size > 20 * 1024 * 1024) { addToast('오디오가 너무 큽니다. 최대 20MB까지 지원합니다.', 'error'); return; }
    if (!projectId) return;
    setUploading(true);
    try {
      const asset = await uploadAudioFile(file, projectId);
      addAsset(asset);
      const result = await persistCurrentScene();
      if (result.status === 'conflict') addToast('오디오는 업로드됐지만 다른 탭·기기에서 씬이 먼저 저장돼 반영하지 못했어요. 새로고침 후 다시 시도해 주세요.', 'error');
      else addToast('오디오 업로드 완료', 'success');
    } catch (err) {
      addToast(`오디오 업로드 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Import 탭 — 모델/이미지/재질(JSON)/씬(JSON)을 한 곳에서 드롭·선택으로 가져오기 ──
  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.readAsText(file);
    });

  const modelAssets = assets.filter((a) => a.type !== 'character' && a.type !== 'audio' && a.type !== 'texture');
  const characterAssets = assets.filter((a) => a.type === 'character');
  const audioAssets = assets.filter((a) => a.type === 'audio');
  const textureAssets = assets.filter((a) => a.type === 'texture');
  const filteredModels = search.trim()
    ? modelAssets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()))
    : modelAssets;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 카테고리 선택 */}
      <div className="px-2 pt-2 shrink-0">
        <SelectBox
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={TABS.map((t) => ({
            value: t.id,
            label: t.wip ? `${t.label} (준비 중)` : t.label,
          }))}
        />
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-2 pt-1">
        {tab === 'generate' && (
          <div className="space-y-3">
            {/* AI 공급자/키 설정 (BYOK — 키는 이 브라우저에만 저장) */}
            <div className="rounded-xs border border-border">
              <button
                onClick={() => setShowAiSettings((v) => !v)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-[9px] text-muted hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-1">
                  <SlidersHorizontal size={10} />
                  AI 설정 — {aiProviderInfo.label}
                  {aiReady ? <Check size={10} className="text-green-500" /> : <span className="text-red-400">(키 필요)</span>}
                </span>
                <span>{showAiSettings ? '접기' : '펼치기'}</span>
              </button>
              {showAiSettings && (
                <div className="px-2 pb-2 space-y-2 border-t border-border pt-2">
                  <div className="grid grid-cols-3 gap-1">
                    {AI_PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setAiProvider(p.id)}
                        className={`py-1.5 rounded-xs border text-[9px] transition-colors ${
                          aiProvider === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-border/60'
                        }`}
                      >
                        {p.label}{p.needsKey && aiKeys[p.id as 'claude' | 'gemini'] ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                  {aiProvider === 'session' ? (
                    <>
                      <div className="grid grid-cols-3 gap-1">
                        {SESSION_MODELS.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setSessionModel(m.id)}
                            title={m.hint}
                            className={`py-1.5 rounded-xs border text-[9px] transition-colors ${
                              sessionModel === m.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-border/60'
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[8px] text-muted/70 leading-relaxed">
                        {SESSION_MODELS.find((m) => m.id === sessionModel)?.hint} · 이 컴퓨터에 로그인된 Claude Code 세션(구독 플랜)으로 생성합니다 — API 키 불필요.
                        로컬 개발 환경 전용이며, 배포 서버에서는 API 키 방식을 사용하세요.
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="password"
                        value={aiKey}
                        onChange={(e) => setAiKey(aiProvider as 'claude' | 'gemini', e.target.value)}
                        placeholder={`${aiProviderInfo.label} 키 (${aiProviderInfo.keyHint})`}
                        className="w-full bg-surface border border-border rounded-xs px-2 py-1.5 text-[10px] text-foreground placeholder-muted focus:outline-none focus:border-primary transition-colors"
                      />
                      <p className="text-[8px] text-muted/70 leading-relaxed">
                        키는 이 브라우저(localStorage)에만 저장되며 서버로 전송되지 않습니다. 생성 비용은 키 소유자의 계정으로 청구됩니다.{' '}
                        <a href={aiProviderInfo.keyUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">키 발급 →</a>
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 서브탭: 오브젝트 생성 · 씬 생성 · 재질 생성 */}
            <div className="grid grid-cols-3 gap-1">
              {GENERATE_SUBS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => { setGenerateSub(id); setPendingGenerated(null); }}
                  className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xs border text-[9px] transition-colors ${
                    generateSub === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted hover:border-border/60'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* 프롬프트 입력 */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-medium text-foreground block">
                {generateSub === 'object' ? '만들고 싶은 오브젝트를 설명해 주세요' : generateSub === 'scene' ? '만들고 싶은 씬/환경을 설명해 주세요' : '만들고 싶은 재질을 설명해 주세요'}
              </label>
              <textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder={
                  generateSub === 'object' ? '예: 빨간 지붕의 작은 오두막, 가로등, 나무 벤치' :
                  generateSub === 'scene' ? '예: 파스텔톤 로우폴리 마을 광장, 카페 인테리어' :
                  '예: 유리, 크롬 금속, 네온 발광 플라스틱'
                }
                className="w-full h-16 bg-surface border border-border rounded-xs px-2 py-1.5 text-[10px] text-foreground placeholder-muted focus:outline-none focus:border-primary transition-colors resize-none"
              />
            </div>

            {/* 생성 버튼 */}
            <button
              disabled={isGenerating || !generatePrompt.trim()}
              onClick={runGenerate}
              className="w-full py-2 rounded-xs bg-primary text-white hover:bg-primary/90 text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? '생성 중… (수십 초 걸릴 수 있어요)' : 'AI로 생성'}
            </button>

            {/* 생성 결과 미리보기 — 적용해야 씬/라이브러리에 반영 */}
            {pendingGenerated && (
              <div className="p-2 rounded-xs border border-primary/40 bg-primary/5 space-y-2">
                {pendingGenerated.kind === 'material' ? (
                  <>
                    <p className="text-[10px] text-foreground font-medium">재질 {pendingGenerated.items.length}개 생성됨</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pendingGenerated.items.map((it, i) => (
                        <div key={i} className="flex items-center gap-1 px-1.5 py-1 rounded-xs bg-surface border border-border">
                          <span className="w-3.5 h-3.5 rounded-full border border-border/60" style={{ background: materialSwatchBg(it.material) }} />
                          <span className="text-[9px] text-foreground">{it.name}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-muted">적용하면 Materials 탭 "저장된 재질(공유)"에 추가됩니다.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-foreground font-medium">오브젝트 {pendingGenerated.data.objects.length}개 생성됨</p>
                    <p className="text-[9px] text-muted leading-snug truncate">
                      {pendingGenerated.data.objects.slice(0, 8).map((o) => o.name ?? o.id).join(' · ')}
                      {pendingGenerated.data.objects.length > 8 ? ' …' : ''}
                    </p>
                    <p className="text-[9px] text-muted">적용하면 현재 씬에 병합됩니다 (Ctrl+Z로 되돌리기 가능).</p>
                  </>
                )}
                <div className="flex gap-1.5">
                  <button onClick={applyGenerated}
                    className="flex-1 py-1.5 rounded-xs bg-primary/15 text-primary hover:bg-primary/25 text-[10px] transition-colors">
                    적용
                  </button>
                  <button onClick={runGenerate} disabled={isGenerating}
                    className="flex-1 py-1.5 rounded-xs bg-surface text-muted hover:text-foreground border border-border text-[10px] transition-colors disabled:opacity-40">
                    다시 생성
                  </button>
                  <button onClick={() => setPendingGenerated(null)}
                    className="px-2 py-1.5 rounded-xs bg-surface text-muted hover:text-foreground border border-border text-[10px] transition-colors">
                    <X size={11} />
                  </button>
                </div>
              </div>
            )}

            {/* 안내문 */}
            <div className="text-[9px] text-muted/70 leading-relaxed space-y-1">
              <p>자연어 설명으로 프리미티브 조립 오브젝트·씬·PBR 재질을 생성합니다. 결과물은 전부 편집 가능한 일반 오브젝트입니다.</p>
              <p>스타일라이즈드(로우폴리) 형태에 강하고, 캐릭터 같은 유기적 곡면은 지원하지 않습니다.</p>
            </div>
          </div>
        )}

        {tab === 'models' && (
          <>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="에셋 검색..."
              className="w-full bg-surface border border-border rounded-xs px-2.5 py-1 mb-2 text-[11px] text-foreground placeholder-muted focus:outline-none focus:border-primary transition-colors"
            />
            <input ref={modelInputRef} type="file" accept=".glb,image/*" multiple className="hidden" onChange={handleModelFile} />
            <div className="grid grid-cols-3 gap-2">
              <UploadButton
                uploading={uploading}
                onClick={() => modelInputRef.current?.click()}
                title="glb 선택 시 텍스처 이미지 파일도 함께(Ctrl/Cmd로 다중 선택) 고르면 자동으로 파일에 포함됩니다"
              />
              {filteredModels.map((asset) => (
                <AssetCard key={asset.id} asset={asset} icon={Package}
                  onAdd={() => beginPlacement({ kind: 'asset', asset })}
                  onDelete={() => deleteAsset(asset)}
                  deleting={deletingId === asset.id}
                />
              ))}
            </div>
            {modelAssets.length === 0 && (
              <p className="text-[10px] text-muted text-center py-4 leading-relaxed">
                .glb 파일을 업로드하면<br />씬에 배치할 수 있습니다
              </p>
            )}
          </>
        )}

        {tab === 'character' && (
          <>
            <input ref={characterInputRef} type="file" accept=".glb,image/*" multiple className="hidden" onChange={handleCharacterFile} />
            <div className="grid grid-cols-3 gap-2">
              <UploadButton
                uploading={uploading}
                onClick={() => characterInputRef.current?.click()}
                label="캐릭터"
                title="glb 선택 시 텍스처 이미지 파일도 함께(Ctrl/Cmd로 다중 선택) 고르면 자동으로 파일에 포함됩니다"
              />
              {characterAssets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} icon={PersonStanding}
                  onDelete={() => deleteAsset(asset)}
                  deleting={deletingId === asset.id}
                />
              ))}
            </div>
            {characterAssets.length === 0 && (
              <p className="text-[10px] text-muted text-center py-4 leading-relaxed">
                캐릭터 GLB를 업로드하세요.<br />Inspector → Player에서 씬에 적용합니다
              </p>
            )}
          </>
        )}

        {tab === 'content' && (
          <div className="grid grid-cols-3 gap-2">
            {CONTENT_ITEMS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => beginPlacement({ kind: 'content', contentType: type })}
                className="h-[72px] rounded-xs bg-background border border-border hover:border-border/60 hover:bg-surface transition-all flex flex-col items-center justify-center gap-1.5"
              >
                <Icon size={20} className="text-muted" />
                <span className="text-[9px] text-muted">{label}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'particle' && (
          <div className="grid grid-cols-3 gap-2">
            {PARTICLE_ITEMS.map(({ preset, label, icon: Icon }) => (
              <button
                key={preset}
                onClick={() => beginPlacement({ kind: 'particle', preset })}
                className="h-[72px] rounded-xs bg-background border border-border hover:border-primary/60 hover:bg-surface transition-all flex flex-col items-center justify-center gap-1.5"
              >
                <Icon size={20} className="text-muted" />
                <span className="text-[9px] text-muted">{label}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'lights' && (
          <div className="grid grid-cols-3 gap-2">
            {LIGHT_ITEMS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => beginPlacement({ kind: 'light', lightType: type })}
                className="h-[72px] rounded-xs bg-background border border-border hover:border-yellow-500/40 hover:bg-surface transition-all flex flex-col items-center justify-center gap-1.5"
              >
                <Icon size={20} className="text-muted" />
                <span className="text-[9px] text-muted text-center leading-snug">{label}</span>
              </button>
            ))}
          </div>
        )}

        {tab === 'audio' && (
          <>
            <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac" className="hidden" onChange={handleAudioFile} />
            <button
              onClick={() => audioInputRef.current?.click()}
              disabled={uploading}
              className="w-full h-10 rounded-xs border-2 border-dashed border-border flex items-center justify-center gap-1.5 text-muted hover:border-primary hover:text-primary transition-all text-[11px] disabled:opacity-40 disabled:cursor-not-allowed mb-2"
            >
              {uploading ? <span className="animate-pulse">업로드 중…</span> : <><Plus size={15} /> 오디오 업로드 (mp3·wav·ogg)</>}
            </button>
            <div className="space-y-1.5">
              {audioAssets.map((asset) => (
                <AudioRow key={asset.id} asset={asset} onDelete={() => deleteAsset(asset)} deleting={deletingId === asset.id} />
              ))}
            </div>
            {audioAssets.length === 0 && (
              <p className="text-[10px] text-muted text-center py-4 leading-relaxed">
                오디오를 업로드하면<br />이벤트 <b>소리 재생(play_sound)</b>에서 고를 수 있어요.
              </p>
            )}
          </>
        )}

        {tab === 'textures' && (
          <>
            <input ref={textureInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleTextureFile} />
            <div className="grid grid-cols-3 gap-2">
              <UploadButton uploading={uploading} onClick={() => textureInputRef.current?.click()} label="이미지" title="JPG·PNG·WEBP 이미지를 업로드해 재사용할 수 있습니다" />
              {textureAssets.map((asset) => (
                <TextureCard key={asset.id} asset={asset}
                  onApply={() => applyTextureToSelection(asset.dracoUrl)}
                  onDelete={() => deleteAsset(asset)}
                  deleting={deletingId === asset.id}
                />
              ))}
            </div>
            {textureAssets.length === 0 && (
              <p className="text-[10px] text-muted text-center py-4 leading-relaxed">
                이미지를 업로드하면<br />프리미티브를 선택하고 클릭해 표면에 입힐 수 있어요.
              </p>
            )}
          </>
        )}

        {tab === 'materials' && (
          <>
            {/* 저장된 공용 재질 (materialAssets) — 여러 오브젝트가 공유, 원본 수정 시 일괄 반영 */}
            {materialAssets.length > 0 && (
              <div className="mb-3">
                <span className="text-[10px] font-semibold text-muted/60 tracking-wide block mb-1.5">저장된 재질 (공유)</span>
                <div className="space-y-1.5">
                  {materialAssets.map((m) => {
                    const expanded = expandedMat === m.id;
                    const setM = (patch: Partial<typeof m.material>) => updateMaterialAsset(m.id, { ...m.material, ...patch });
                    return (
                    <div key={m.id} className="bg-background border border-border rounded-xs">
                      <div className="flex items-center gap-1.5 px-1.5 py-1">
                        <label title="색 편집(공유 반영)"
                          className="relative w-3 h-3 shrink-0 rounded-full cursor-pointer border border-muted/60 ring-1 ring-black/10 overflow-hidden"
                          style={{ background: materialSwatchBg(m.material) }}>
                          <input type="color" value={m.material.color ?? '#a78bfa'}
                            onChange={(e) => setM({ color: e.target.value })} onBlur={pushHistory}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        </label>
                        <InlineEditName value={m.name} onCommit={(n) => renameMaterialAsset(m.id, n)}
                          title="이름 변경" placeholder="재질 이름"
                          className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground rounded-sm px-1 -mx-1 border border-transparent hover:border-border/60 focus:border-primary/50 focus:outline-none transition-colors" />
                        <button onClick={() => setExpandedMat(expanded ? null : m.id)}
                          title="속성 편집" className={`shrink-0 w-5 h-5 rounded-sm flex items-center justify-center transition-colors ${expanded ? 'text-primary' : 'text-muted hover:text-foreground'}`}><SlidersHorizontal size={12} /></button>
                        <button onClick={() => applyMaterialAssetToSelection(m.id)}
                          title="선택한 프리미티브에 연결" className="shrink-0 px-1.5 py-0.5 rounded-xs bg-primary/15 text-primary hover:bg-primary/25 text-[10px] transition-colors">적용</button>
                        <button onClick={() => { if (confirm(`'${m.name}' 재질을 삭제할까요?\n이 재질을 쓰던 오브젝트는 독립 재질로 바뀝니다.`)) removeMaterialAsset(m.id); }}
                          title="삭제" className="shrink-0 w-5 h-5 rounded-sm text-muted hover:text-red-500 flex items-center justify-center transition-colors"><X size={12} /></button>
                      </div>
                      {expanded && (
                        <div className="px-2 pb-2 pt-0.5 space-y-1.5 border-t border-border/60">
                          {([
                            { k: 'roughness', label: '거칠기', def: 0.5 },
                            { k: 'metalness', label: '금속성', def: 0.1 },
                            { k: 'clearcoat', label: '코팅광택', def: 0 },
                            { k: 'transmission', label: '투과(유리)', def: 0 },
                          ] as const).map(({ k, label, def }) => (
                            <RangeSlider key={k} label={label} value={m.material[k] ?? def}
                              onChange={(v) => setM({ [k]: v })} onCommit={pushHistory}
                              min={0} max={1} step={0.02} showValue precision={2} />
                          ))}
                          <label className="flex items-center gap-2 text-[10px] text-muted">
                            <span className="w-14 shrink-0">자체발광</span>
                            <input type="color" value={m.material.emissive ?? '#000000'}
                              onChange={(e) => setM({ emissive: e.target.value })} onBlur={pushHistory}
                              className="w-6 h-6 rounded cursor-pointer border border-border" />
                          </label>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                <p className="text-[9px] text-muted/50 mt-1.5 leading-snug">속성을 바꾸면 이 재질을 쓰는 모든 오브젝트에 반영돼요. (오브젝트 인스펙터의 "이 재질을 에셋으로 저장"으로 추가)</p>
              </div>
            )}
            <span className="text-[10px] font-semibold text-muted/60 tracking-wide block mb-1.5">질감 프리셋 (복사 적용)</span>
            <div className="grid grid-cols-3 gap-2">
              {MATERIAL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyMaterialToSelection(preset)}
                  className="group relative h-[72px] rounded-xs bg-background border border-border hover:border-primary/60 transition-all overflow-hidden flex flex-col items-center justify-center gap-1.5"
                  title={`선택한 프리미티브에 '${preset.label}' 재질 적용`}
                >
                  <span className="w-8 h-8 rounded-full border border-border/50 shadow-inner" style={{ background: preset.swatch }} />
                  <span className="text-[9px] text-muted">{preset.label}</span>
                  <span className="absolute inset-0 bg-primary/0 group-hover:bg-primary/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-white text-[11px] font-medium">
                    적용
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted text-center py-3 leading-relaxed">
              프리미티브를 선택하고 재질을 클릭하면 질감이 바뀝니다. <b>색은 유지</b>돼요.
            </p>

            {/* 색 팔레트 (ColorAsset) — 저장한 색을 재사용 */}
            <div className="pt-2 border-t border-border/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-muted/60 tracking-wide">색 팔레트</span>
                <button onClick={saveSelectedColor} title="선택 오브젝트의 현재 색을 저장"
                  className="flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors"><Plus size={11} /> 현재 색 저장</button>
              </div>
              {colorAssets.length === 0 ? (
                <p className="text-[10px] text-muted/50 leading-snug">자주 쓰는 색을 저장해 두고 클릭 한 번으로 적용하세요.</p>
              ) : (
                <div className="grid grid-cols-8 gap-1.5">
                  {colorAssets.map((c) => (
                    <div key={c.id} className="group relative aspect-square">
                      <button onClick={() => applyColorToSelection(c.color)} title={`${c.name} 적용`}
                        className="w-full h-full rounded-xs border border-border/60 hover:ring-2 hover:ring-primary transition-all" style={{ background: c.color }} />
                      <button onClick={() => removeColorAsset(c.id)} title="삭제"
                        className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-background border border-border text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"><X size={9} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'hdr' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {HDR_TILES.map((tile) => {
                const active = (environment.hdrPreset ?? 'none') === tile.id;
                return (
                  <button
                    key={tile.id}
                    onClick={() => applyHdr(tile.id)}
                    className={`relative h-[72px] rounded-xs overflow-hidden border transition-all flex flex-col items-center justify-center gap-1 ${active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-border/60'}`}
                    style={{ background: tile.swatch }}
                    title={`환경(HDR): ${tile.label}`}
                  >
                    <tile.icon size={18} className="text-white drop-shadow" />
                    <span className="text-[9px] text-white font-medium drop-shadow px-1 py-0.5 rounded-sm bg-black/25">{tile.label}</span>
                    {active && <span className="absolute top-1 right-1 text-white bg-primary rounded-full w-4 h-4 flex items-center justify-center"><Check size={10} /></span>}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted text-center py-4 leading-relaxed">
              HDR 환경은 씬 전체의 <b>배경·반사·조명</b>을 바꿉니다.<br />세부 조정은 Environment 패널에서.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UploadButton({ uploading, onClick, label = '.glb', title }: { uploading: boolean; onClick: () => void; label?: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={uploading}
      title={title}
      className="h-[72px] rounded-xs border-2 border-dashed border-border flex flex-col items-center justify-center text-muted hover:border-primary hover:text-primary transition-all gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {uploading ? (
        <span className="text-xs animate-pulse">...</span>
      ) : (
        <>
          <Plus size={18} />
          <span className="text-[9px]">{label}</span>
        </>
      )}
    </button>
  );
}

function AudioRow({ asset, onDelete, deleting }: { asset: AssetRefSchema; onDelete: () => void; deleting?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(asset.dracoUrl);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); audioRef.current.currentTime = 0; setPlaying(false); }
    else { audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };
  return (
    <div className="flex items-center gap-2 bg-background border border-border rounded-xs px-2 py-1.5">
      <button
        onClick={toggle}
        className="w-6 h-6 shrink-0 rounded-full bg-primary/15 text-primary hover:bg-primary/25 flex items-center justify-center transition-colors"
        title={playing ? '정지' : '미리듣기'}
      >
        {playing ? <Square size={11} /> : <Play size={11} />}
      </button>
      <span className="flex-1 text-[11px] text-foreground truncate flex items-center gap-1.5" title={asset.name}><Music size={12} className="shrink-0 text-muted" /> {asset.name}</span>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="w-5 h-5 shrink-0 rounded-sm text-muted hover:text-red-500 flex items-center justify-center transition-colors disabled:opacity-40"
        title="삭제"
      >
        {deleting ? '…' : <X size={12} />}
      </button>
    </div>
  );
}

function TextureCard({ asset, onApply, onDelete, deleting }: {
  asset: AssetRefSchema;
  onApply: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="group relative h-[72px] rounded-xs bg-background border border-border hover:border-border/60 transition-all overflow-hidden">
      <img src={asset.thumbnailUrl ?? asset.dracoUrl} alt={asset.name} className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-background/70 backdrop-blur-sm">
        <span className="text-[9px] text-foreground/80 truncate w-full text-center block" title={asset.name}>{asset.name}</span>
      </div>
      {/* 클릭 = 선택 오브젝트에 적용 */}
      <button
        onClick={onApply}
        className="absolute inset-0 bg-primary/0 group-hover:bg-primary/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-white text-xs font-medium"
        title="선택한 프리미티브에 텍스처 적용"
      >
        적용
      </button>
      {/* 삭제 */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={deleting}
        className="absolute top-1 right-1 w-5 h-5 rounded-sm bg-background/70 text-muted hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all disabled:opacity-40 z-10"
        title="삭제"
      >
        {deleting ? '…' : <X size={12} />}
      </button>
    </div>
  );
}

function AssetCard({ asset, icon: Icon, onAdd, onDelete, deleting }: {
  asset: AssetRefSchema;
  icon: LucideIcon;
  onAdd?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const isModel = !!asset.dracoUrl;

  return (
    <div
      ref={cardRef}
      className="group relative h-[72px] rounded-xs bg-background border border-border hover:border-border/60 transition-all flex flex-col items-center justify-center gap-1 overflow-hidden"
      onMouseEnter={() => {
        if (isModel && cardRef.current) setHoverRect(cardRef.current.getBoundingClientRect());
      }}
      onMouseLeave={() => { setHoverRect(null); setConfirmDelete(false); }}
    >
      {asset.thumbnailUrl ? (
        <>
          <img src={asset.thumbnailUrl} alt={asset.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-background/70 backdrop-blur-sm">
            <span className="text-[9px] text-foreground/80 truncate w-full text-center block">{asset.name}</span>
          </div>
        </>
      ) : (
        <>
          <Icon size={26} className="text-muted" />
          <span className="text-[9px] text-muted truncate w-full text-center px-1">{asset.name}</span>
        </>
      )}

      {/* 호버 오버레이 */}
      {!confirmDelete && onAdd && (
        <button
          onClick={onAdd}
          className="absolute inset-0 bg-primary/0 group-hover:bg-primary/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-white text-xs font-medium"
        >
          + 추가
        </button>
      )}

      {/* 삭제 버튼 (우상단) */}
      {onDelete && !confirmDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          className="absolute top-1 right-1 w-5 h-5 rounded-sm bg-background/80 text-muted hover:bg-danger hover:text-white opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
          title="삭제"
        >
          <X size={11} />
        </button>
      )}

      {/* 삭제 확인 */}
      {confirmDelete && (
        <div className="absolute inset-0 bg-background/95 flex flex-col items-center justify-center gap-1.5 p-1">
          <p className="text-[9px] text-foreground text-center leading-tight">삭제할까요?</p>
          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              disabled={deleting}
              className="px-2 py-0.5 text-[9px] bg-danger text-white rounded-xs disabled:opacity-50"
            >
              {deleting ? '...' : '삭제'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
              className="px-2 py-0.5 text-[9px] bg-surface text-muted rounded-xs border border-border"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {hoverRect && isModel && !confirmDelete && (
        <Suspense fallback={null}>
          <AssetPreviewPopup url={asset.dracoUrl} name={asset.name} anchorRect={hoverRect} />
        </Suspense>
      )}
    </div>
  );
}
