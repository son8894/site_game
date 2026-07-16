/**
 * GLB 파일 검증 함수
 * 깨진 GLB 파일이 업로드되는 것을 방지
 */

export class GLBValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GLBValidationError';
  }
}

/**
 * GLB 파일 기본 검증
 * @throws GLBValidationError 검증 실패 시
 */
export async function validateGLB(file: File): Promise<void> {
  // 크기 확인 (최대 100MB)
  if (file.size === 0) {
    throw new GLBValidationError('파일이 비어있습니다.');
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new GLBValidationError('파일이 너무 큽니다. (최대 100MB)');
  }

  // MIME 타입 확인
  const isGltf = file.type === 'model/gltf-binary' || file.name.endsWith('.glb');
  if (!isGltf) {
    throw new GLBValidationError('.glb 파일이 아닙니다.');
  }

  // 바이너리 헤더 검증
  try {
    const header = await file.slice(0, 12).arrayBuffer();
    if (header.byteLength < 12) {
      throw new GLBValidationError('파일이 손상되었습니다. (헤더 너무 짧음)');
    }

    const view = new Uint8Array(header);

    // 매직 번호 확인 (0x46546c67 = "glTF")
    const magic = String.fromCharCode(view[0], view[1], view[2], view[3]);
    if (magic !== 'glTF') {
      throw new GLBValidationError('유효한 GLB 파일이 아닙니다. (매직 번호 오류)');
    }

    // 버전 확인 (버전 2 필수)
    const dv = new DataView(header);
    const version = dv.getUint32(4, true);
    if (version !== 2) {
      throw new GLBValidationError(`지원하지 않는 GLB 버전입니다. (v${version}, v2 필요)`);
    }

    // 파일 크기 확인 (헤더의 파일 크기 필드)
    const declaredSize = dv.getUint32(8, true);
    if (declaredSize > file.size) {
      throw new GLBValidationError('파일이 손상되었습니다. (크기 불일치)');
    }
    if (declaredSize < 20) {
      throw new GLBValidationError('파일이 손상되었습니다. (최소 크기 미만)');
    }
  } catch (err) {
    if (err instanceof GLBValidationError) {
      throw err;
    }
    throw new GLBValidationError(`파일 검증 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  }
}

/**
 * 파일이 모델/GLB 타입인지 확인 (빠른 체크용)
 */
export function isModelFile(file: File): boolean {
  return (
    file.type === 'model/gltf-binary' ||
    file.type === 'model/gltf+json' ||
    file.name.endsWith('.glb') ||
    file.name.endsWith('.gltf')
  );
}
