/**
 * image/compress.js — 압축의 핵심 로직
 *
 * "용량이 줄어드는" 이유는 두 가지예요:
 *   1. 크기 줄이기: 6000px 사진을 1920px로 줄이면 픽셀 수가 약 1/10이 돼요.
 *      웹 화면에선 1920px 이상은 거의 티가 안 나요.
 *   2. 손실 압축: WebP/JPEG는 사람 눈이 잘 못 알아채는 정보를 버려서 용량을 줄여요.
 *      quality(품질) 값이 낮을수록 더 많이 버려요. 0.8 정도가 보통 최적점이에요.
 */
import { loadBitmap, draw, resize, toBlob } from './canvas.js';
import { renameFile } from '../formats.js';

/**
 * @param {File} file   원본 파일 (이름·형식·용량 비교용)
 * @param {Blob} source 실제로 처리할 이미지 (업스케일했으면 그 결과, 아니면 원본)
 * @param {{types:string[], maxWidth:number, quality:number}} settings
 * @param {boolean} upscaled  업스케일한 이미지인지
 * @returns {Promise<Omit<import('../store.js').Output, 'url'>[]>}
 */
export async function compress(file, source, { types, maxWidth, quality }, upscaled) {
  // ① 디코딩
  const bitmap = await loadBitmap(source);

  // ② 목표 크기 계산 (가로 기준, 비율 유지). 0이면 '원본 크기'
  const scale = maxWidth && bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  // 디코딩·리사이즈는 비싼 작업이라 한 번만 하고, 형식별로 인코딩만 따로 해요
  const canvas = resize(bitmap, w, h);
  bitmap.close?.(); // ImageBitmap은 다 쓰면 직접 메모리 해제
  let flat = null; // JPEG용 흰 배경 버전 (필요할 때만 만듦)

  const outputs = [];
  for (const wanted of types) {
    let type = wanted;
    let blob = null;

    // ③ 인코딩
    if (type !== 'image/jpeg') {
      blob = await toBlob(canvas, type, quality);
      // 브라우저가 그 형식을 못 만들면 조용히 PNG로 돌려줘요. (예: 옛날 Safari의 WebP)
      // 결과 형식을 확인해서 다르면 JPG로 대체해요.
      if (blob.type !== type) type = 'image/jpeg';
    }
    if (type === 'image/jpeg') {
      // 'WebP + JPG'인데 WebP가 JPG로 대체됐다면 JPG가 두 개 생기니 하나는 건너뜀
      if (outputs.some((o) => o.type === type)) continue;
      flat ??= draw(canvas, w, h, true); // ??= : 비어 있을 때만 만들기
      blob = await toBlob(flat, type, quality);
    }

    // 이미 잘 압축된 파일은 다시 압축하면 오히려 커질 수 있어요.
    // 크기·형식이 그대로인데 커졌다면 원본을 그대로 쓰는 게 이득이에요.
    if (!upscaled && scale === 1 && type === file.type && blob.size >= file.size) blob = file;

    outputs.push({
      type, blob, width: w, height: h,
      name: renameFile(file.name, type),
      fellBack: type !== wanted,
    });
  }
  return outputs;
}
