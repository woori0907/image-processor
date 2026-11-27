/**
 * formats.js — 이미지 "형식(포맷)"에 관한 규칙 모음
 *
 * 브라우저는 이미지 형식을 'image/webp' 같은 MIME 타입 문자열로 구분해요.
 * 이 파일은 그 문자열과 확장자(.webp), 화면에 보여줄 이름(WebP)을 서로 연결해줘요.
 * 화면(UI)과 상관없는 순수한 규칙이라 어디서든 가져다 쓸 수 있어요.
 */

/** MIME 타입 → 파일 확장자 */
export const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** MIME 타입 → 화면에 보여줄 이름 */
export const LABEL = { 'image/webp': 'WebP', 'image/jpeg': 'JPG', 'image/png': 'PNG' };

/**
 * 설정 화면에서 고른 값('webp', 'both' 등)을 실제로 만들 MIME 타입 목록으로 바꿔요.
 * 'both'처럼 한 번에 여러 형식을 만들 수 있어서 항상 배열을 돌려줘요.
 *
 * @param {string} format   설정 값: 'webp' | 'jpeg' | 'both' | 'png' | 'original'
 * @param {string} fileType 원본 파일의 MIME 타입 ('original'일 때만 사용)
 * @returns {string[]}
 */
export function typesFor(format, fileType) {
  switch (format) {
    case 'webp': return ['image/webp'];
    case 'jpeg': return ['image/jpeg'];
    case 'both': return ['image/webp', 'image/jpeg'];
    case 'png': return ['image/png'];
    default: return [normalizeType(fileType)]; // 'original'
  }
}

/**
 * 브라우저가 "저장"할 수 있는 형식은 WebP·JPEG·PNG 정도라서,
 * GIF·HEIC·BMP 같은 형식은 저장할 때 JPG로 바꿔요.
 * (열 수 있는 형식과 저장할 수 있는 형식은 다르다는 점이 포인트!)
 */
export function normalizeType(type) {
  return EXT[type] ? type : 'image/jpeg';
}

/** 'photo.png' + 'image/webp' → 'photo.webp' */
export function renameFile(name, type) {
  const base = name.replace(/\.[^.]+$/, '') || 'image'; // 마지막 '.확장자' 제거
  return `${base}.${EXT[type]}`;
}
