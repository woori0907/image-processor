/**
 * zip.js — 여러 결과 파일을 ZIP 하나로 묶기
 *
 * JSZip 라이브러리는 index.html에서 일반 <script>로 불러와서 window.JSZip에 있어요.
 */
import { uniqueName } from './utils.js';

/**
 * @param {{name:string, blob:Blob}[]} outputs
 * @returns {Promise<Blob>} ZIP 파일
 */
export async function makeZip(outputs) {
  if (!window.JSZip) throw new Error('JSZip not loaded');
  const zip = new window.JSZip();
  const used = new Set();
  for (const r of outputs) zip.file(uniqueName(r.name, used), r.blob);
  // 이미지는 이미 압축돼 있어서 ZIP으로 또 압축해봐야 거의 안 줄어요.
  // 'STORE'(압축 없이 담기만)로 하면 훨씬 빨라요.
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
