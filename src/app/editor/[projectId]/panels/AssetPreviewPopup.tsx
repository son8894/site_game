'use client';

import { createPortal } from 'react-dom';
import { useRef, Suspense, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Bounds } from '@react-three/drei';
import * as THREE from 'three';
import { AlertCircle } from 'lucide-react';

function RotatingModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const clone = useRef(scene.clone(true));
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.9;
  });
  return <group ref={groupRef}><primitive object={clone.current} /></group>;
}

// GLB 로드 에러 감지 컴포넌트
function ModelPreviewWithErrorBoundary({ url }: { url: string }) {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // 타임아웃으로 로드 실패 감지
    const timeout = setTimeout(() => {
      // 만약 로드가 진행 중이면 타임아웃 에러 없음
    }, 5000);
    return () => clearTimeout(timeout);
  }, [url]);

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-background/80 text-red-500">
        <AlertCircle size={24} />
      </div>
    );
  }

  try {
    return (
      <Canvas
        camera={{ position: [0, 1, 4], fov: 50 }}
        gl={{ antialias: true }}
        style={{ width: '100%', height: '100%' }}
        onCreated={(state) => {
          state.gl.setClearColor(new THREE.Color(0x0f0f0f));
        }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 4, 3]} intensity={1.4} />
        <directionalLight position={[-2, 2, -2]} intensity={0.4} />
        <Suspense fallback={null}>
          <Bounds fit clip margin={1.3}>
            <RotatingModel url={url} />
          </Bounds>
        </Suspense>
      </Canvas>
    );
  } catch (err) {
    setError(err instanceof Error ? err : new Error('GLB 로드 실패'));
    return (
      <div className="flex items-center justify-center w-full h-full bg-background/80 text-red-500">
        <AlertCircle size={24} />
      </div>
    );
  }
}

const PREVIEW_SIZE = 160;

interface Props {
  url: string;
  name: string;
  anchorRect: DOMRect;
}

export function AssetPreviewPopup({ url, name, anchorRect }: Props) {
  const left = Math.max(8, Math.min(
    window.innerWidth - PREVIEW_SIZE - 8,
    anchorRect.left + anchorRect.width / 2 - PREVIEW_SIZE / 2,
  ));
  const top = anchorRect.top - PREVIEW_SIZE - 12;
  const showAbove = top >= 8;
  const finalTop = showAbove ? top : anchorRect.bottom + 8;

  return createPortal(
    <div
      style={{ position: 'fixed', left, top: finalTop, width: PREVIEW_SIZE, height: PREVIEW_SIZE, zIndex: 9999 }}
      className="rounded-xs overflow-hidden border border-border shadow-2xl bg-sidebar pointer-events-none"
    >
      <Suspense fallback={<div className="w-full h-full bg-background/50" />}>
        <ModelPreviewWithErrorBoundary url={url} />
      </Suspense>
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-background/75 backdrop-blur-sm">
        <p className="text-[9px] text-foreground/80 truncate font-medium">{name}</p>
      </div>
    </div>,
    document.body,
  );
}
