/**
 * image/slice.js — 이미지를 가로로 잘라 여러 조각 파일로 만들기
 *
 * 화면은 전혀 모르고, "원본 파일 + 조각 목록 + 저장 설정"을 받아 "조각 파일들"을 돌려줘요.
 *
 * 자르는 원리는 canvas.js의 3단계와 같아요:
 *   ① 디코딩: 원본을 한 번만 픽셀로 풀어요                    loadBitmap()
 *   ② 그리기: 조각 크기의 canvas에 "원본의 일부분"만 옮겨 그려요  cropCanvas()
 *   ③ 인코딩: 조각 canvas를 파일로 저장                         toBlob()
 */
import { loadBitmap, toBlob } from './canvas.js';
import { renameFile } from '../formats.js';

/**
 * 원본에서 세로 top ~ top+height 구간만 잘라 새 canvas에 담아요.
 *
 * drawImage는 인자를 9개 주면 "원본의 어느 부분을 → 도화지의 어디에" 그릴지 정할 수 있어요:
 *   drawImage(원본, 원본x, 원본y, 원본w, 원본h,  도화지x, 도화지y, 도화지w, 도화지h)
 * 원본과 도화지의 크기를 같게 주면 확대·축소 없이 픽셀 그대로 잘라내는 거예요.
 *
 * @param {CanvasImageSource & {width:number}} source
 * @param {boolean} opaque JPG처럼 투명을 못 담는 형식이면 흰 배경을 먼저 깔아요
 */
export function cropCanvas(source, top, height, opaque) {
  const w = source.width;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = height;
  const ctx = c.getContext('2d');
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, height);
  }
  ctx.drawImage(source, 0, top, w, height, 0, 0, w, height);
  return c;
}

/**
 * 조각 파일 이름: 'event.jpg' → 'event_01.jpg', 버튼 조각이면 'event_02_btn.jpg'
 * 번호 앞에 0을 채워야(01, 02 … 10) 파일 목록에서 순서대로 정렬돼요.
 *
 * @param {string} fileName 원본 파일 이름
 * @param {{index:number, isButton:boolean}} piece
 * @param {number} total 전체 조각 수 (자릿수 계산용)
 * @param {string} type  저장할 MIME 타입
 */
export function pieceName(fileName, piece, total, type) {
  const base = fileName.replace(/\.[^.]+$/, '') || 'image';
  const digits = Math.max(2, String(total).length);
  const no = String(piece.index + 1).padStart(digits, '0');
  // renameFile은 마지막 '.확장자'를 떼고 새 확장자를 붙이므로 임시로 '.x'를 붙여 넘겨요
  return renameFile(`${base}_${no}${piece.isButton ? '_btn' : ''}.x`, type);
}

/**
 * 조각들을 실제 파일로 만들어요.
 *
 * @param {File} file 원본
 * @param {{index:number, top:number, height:number, isButton:boolean}[]} pieces cuts.js의 pieces()
 * @param {{types:string[], quality:number}} settings ui/settings.js의 read() 결과
 * @param {(done:number, total:number) => void} [onProgress]
 * @returns {Promise<{name:string, blob:Blob}[]>} zip.js의 makeZip()에 바로 넘길 수 있는 모양
 */
export async function slicePieces(file, pieces, { types, quality }, onProgress) {
  const bitmap = await loadBitmap(file); // 원본은 한 번만 풀어서 모든 조각에 재사용
  const total = pieces.length * types.length;
  const outputs = [];
  try {
    for (const piece of pieces) {
      for (const type of types) {
        const canvas = cropCanvas(bitmap, piece.top, piece.height, type === 'image/jpeg');
        let blob;
        try {
          blob = await toBlob(canvas, type, quality);
        } catch (err) {
          // 브라우저마다 canvas 최대 크기가 있어서 (보통 한 변 3만 px 안팎) 너무 큰 조각은 실패할 수 있어요
          err.userMessage = `${piece.index + 1}번 조각이 너무 커서 저장하지 못했어요. 선을 더 추가해 조각을 작게 나눠 보세요.`;
          throw err;
        } finally {
          canvas.width = 0; // 다 쓴 canvas의 픽셀 메모리를 바로 돌려줘요
        }
        outputs.push({ name: pieceName(file.name, piece, pieces.length, type), blob });
        onProgress?.(outputs.length, total);
      }
    }
  } finally {
    bitmap.close?.(); // ImageBitmap이면 메모리 해제 (<img>로 열렸으면 close가 없어서 ?.로 건너뜀)
  }
  return outputs;
}
