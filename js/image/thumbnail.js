/**
 * image/thumbnail.js — 원본의 일부분을 잘라 정해진 크기의 썸네일로 만들기
 *
 * 화면은 전혀 모르고, "원본 픽셀 + 가져올 영역 + 썸네일 크기"를 받아 그림(canvas)이나 파일을 돌려줘요.
 *
 * 만드는 순서는 canvas.js의 3단계에 "자르기"가 하나 끼어든 거예요:
 *   ① 디코딩: 원본을 픽셀로 풀기 (화면 쪽에서 이미 한 번 풀어 둔 걸 재사용해요)
 *   ② 자르기: 원본에서 영역만 원래 해상도 그대로 떼어내기       cropRegion()
 *      줄이기: 떼어낸 걸 썸네일 크기로 고품질 축소               resize()  (canvas.js)
 *   ③ 인코딩: 파일로 저장                                       encode()
 *
 * ── 왜 자르기와 줄이기를 따로 하나요? ──
 * drawImage 한 번으로 "잘라서 바로 작게 그리기"도 할 수 있지만,
 * 583px → 233px처럼 크게 줄이면 글자가 자글자글해져요(앨리어싱).
 * 먼저 원래 해상도로 잘라 두고, canvas.js의 resize()로 "절반씩 여러 번" 줄여야 깨끗해요.
 */
import { draw, resize, toBlob } from './canvas.js';
import { renameFile } from '../formats.js';

/**
 * @typedef {{x:number, y:number, w:number, h:number}} Rect  원본 px 기준 영역 (crop.js의 rect())
 */

/**
 * 원본에서 rect 영역만 떼어내 새 canvas에 담아요. (크기는 그대로)
 * 영역은 소수점일 수 있어서 여기서 반올림해요. (1px 이하 차이라 눈에 보이지 않아요)
 *
 * @param {CanvasImageSource & {width:number, height:number}} source
 * @param {Rect} rect
 */
export function cropRegion(source, rect) {
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const x = clamp(Math.round(rect.x), 0, source.width - 1);
  const y = clamp(Math.round(rect.y), 0, source.height - 1);
  const w = clamp(Math.round(rect.w), 1, source.width - x);
  const h = clamp(Math.round(rect.h), 1, source.height - y);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // drawImage 9개 인자: (원본, 원본x, 원본y, 원본w, 원본h,  도화지x, 도화지y, 도화지w, 도화지h)
  c.getContext('2d').drawImage(source, x, y, w, h, 0, 0, w, h);
  return c;
}

/**
 * 영역을 잘라 w×h 썸네일 canvas로 만들어요.
 * @returns {HTMLCanvasElement}
 */
export function renderThumb(source, rect, w, h) {
  const region = cropRegion(source, rect);
  const out = resize(region, w, h); // resize는 항상 새 canvas를 돌려줘요
  region.width = 0; // 다 쓴 중간 canvas의 픽셀 메모리 바로 반납
  return out;
}

/**
 * 화면에 이미 있는 canvas(미리보기)에 썸네일을 그려 넣어요.
 * 미리보기는 끌 때마다 다시 그려야 해서, 요소를 새로 만들지 않고 내용만 바꿔요.
 *
 * @param {HTMLCanvasElement} target
 */
export function drawThumbInto(target, source, rect, w, h) {
  const out = renderThumb(source, rect, w, h);
  // width/height를 다시 넣으면 같은 값이어도 canvas가 지워지고 초기화돼서, 다를 때만 바꿔요
  if (target.width !== w) target.width = w;
  if (target.height !== h) target.height = h;
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, w, h); // 투명 PNG면 이전 그림이 비쳐 보이지 않게
  ctx.drawImage(out, 0, 0);
  out.width = 0;
}

/**
 * 썸네일 파일 이름: 'event.png' + 233×158 + JPG → 'event_233x158.jpg'
 * @param {string} fileName 원본 파일 이름
 * @param {{w:number, h:number}} size
 * @param {string} type 저장할 MIME 타입
 */
export function thumbName(fileName, { w, h }, type) {
  const base = fileName.replace(/\.[^.]+$/, '') || 'image';
  // renameFile은 마지막 '.확장자'를 떼고 새 확장자를 붙이므로 임시로 '.x'를 붙여 넘겨요 (slice.js와 같은 방법)
  return renameFile(`${base}_${w}x${h}.x`, type);
}

/**
 * ③ canvas를 원하는 형식의 파일로 저장해요.
 * 브라우저가 그 형식을 못 만들면(예: 옛날 Safari의 WebP) 조용히 PNG를 돌려주기 때문에,
 * 결과 형식을 확인해서 다르면 JPG로 대체해요. (compress.js와 같은 규칙)
 *
 * @returns {Promise<{type:string, blob:Blob}>} 실제로 저장된 형식과 파일
 */
async function encode(canvas, type, quality) {
  if (type !== 'image/jpeg') {
    const blob = await toBlob(canvas, type, quality);
    if (blob.type === type) return { type, blob };
    type = 'image/jpeg';
  }
  // JPG는 투명을 못 담아서 흰 배경을 깐 버전으로 저장해요
  const flat = draw(canvas, canvas.width, canvas.height, true);
  try {
    return { type, blob: await toBlob(flat, type, quality) };
  } finally {
    flat.width = 0;
  }
}

/**
 * 이미지 한 장으로 여러 크기의 썸네일 파일을 만들어요.
 *
 * @param {string} fileName 원본 파일 이름 (결과 이름을 짓는 데 씀)
 * @param {CanvasImageSource & {width:number, height:number}} source 디코딩된 원본
 * @param {{w:number, h:number, rect:Rect}[]} jobs 만들 크기와 각각의 영역
 * @param {{types:string[], quality:number}} settings ui/settings.js의 read() 결과
 * @param {() => void} [onEach] 파일 하나를 만들 때마다 호출 (진행 표시용)
 * @returns {Promise<{name:string, blob:Blob, fellBack:boolean}[]>}
 *   zip.js의 makeZip()에 바로 넘길 수 있는 모양. fellBack: 원하는 형식 대신 JPG로 저장됐는지
 */
export async function makeThumbnails(fileName, source, jobs, { types, quality }, onEach) {
  const outputs = [];
  for (const { w, h, rect } of jobs) {
    // 자르기·줄이기는 크기마다 한 번만 하고, 형식별로 인코딩만 따로 해요
    const canvas = renderThumb(source, rect, w, h);
    try {
      for (const wanted of types) {
        const { type, blob } = await encode(canvas, wanted, quality);
        outputs.push({ name: thumbName(fileName, { w, h }, type), blob, fellBack: type !== wanted });
        onEach?.();
      }
    } finally {
      canvas.width = 0;
    }
  }
  return outputs;
}
