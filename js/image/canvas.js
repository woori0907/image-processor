/**
 * image/canvas.js — 이미지 처리의 기본 도구 상자
 *
 * 브라우저에서 이미지를 가공하는 흐름은 항상 이 3단계예요:
 *
 *   ① 디코딩: 파일(압축된 바이트) → 픽셀 데이터       loadBitmap()
 *   ② 그리기: <canvas>에 원하는 크기로 그림            draw(), resize()
 *   ③ 인코딩: canvas 픽셀 → 원하는 형식의 파일(Blob)  toBlob()
 *
 * <canvas>는 "코드로 그림을 그릴 수 있는 도화지"라고 생각하면 돼요.
 * 다른 크기로 그리면 리사이즈, 다른 형식으로 저장하면 형식 변환이 되는 거예요.
 */

/**
 * ① 파일을 픽셀로 풀기(디코딩)
 *
 * createImageBitmap이 빠르고, 휴대폰 사진의 EXIF 회전 정보도 반영해줘요.
 * (EXIF: 사진 안에 숨어 있는 "이 사진은 90도 돌려서 봐야 함" 같은 정보)
 * 지원하지 않는 브라우저를 위해 <img> 태그 방식으로도 시도해요.
 *
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap|HTMLImageElement>} 둘 다 canvas에 그릴 수 있어요
 */
export async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (_) { /* 아래 <img> 방식으로 재시도 */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // 이미지가 다 읽힐 때까지 기다림
    return img;
  } finally {
    URL.revokeObjectURL(url); // 다 읽었으면 주소는 바로 해제
  }
}

/**
 * ② 새 canvas를 만들고 source를 w×h 크기로 그려요.
 *
 * @param {CanvasImageSource} source  이미지, 비트맵, 다른 canvas 등
 * @param {boolean} opaque  true면 흰 배경을 먼저 깔아요.
 *   JPEG는 투명도를 저장 못 해서, 그냥 저장하면 투명한 곳이 검게 나오거든요.
 * @returns {HTMLCanvasElement}
 */
export function draw(source, w, h, opaque = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // 확대·축소할 때 부드럽게
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

/**
 * ② 고품질 축소: 절반씩 여러 번 나눠서 줄이기
 *
 * 4000px → 500px처럼 한 번에 크게 줄이면, 브라우저가 픽셀을 듬성듬성 건너뛰며
 * 계산해서 선이 계단처럼 깨지거나 자글자글해져요(앨리어싱).
 * 4000 → 2000 → 1000 → 500처럼 절반씩 줄이면 매 단계에서 주변 픽셀이 골고루
 * 섞여서 훨씬 깨끗해져요. 사진 편집 프로그램들도 비슷한 방법을 써요.
 */
export function resize(source, w, h) {
  let cur = source;
  let cw = source.width;
  let ch = source.height;
  while (cw / 2 >= w && ch / 2 >= h) {
    cw = Math.round(cw / 2);
    ch = Math.round(ch / 2);
    cur = draw(cur, cw, ch);
  }
  return draw(cur, w, h); // 마지막으로 정확한 목표 크기에 맞춤
}

/**
 * ③ canvas를 파일(Blob)로 저장(인코딩)
 *
 * canvas.toBlob은 옛날 방식(콜백)이라, 쓰기 편하게 Promise로 감쌌어요.
 * 그러면 `await toBlob(...)`처럼 쓸 수 있어요.
 *
 * @param {string} type     'image/webp' | 'image/jpeg' | 'image/png'
 * @param {number} quality  0~1, 클수록 고화질·큰 용량 (PNG는 무시됨)
 */
export function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
  });
}
