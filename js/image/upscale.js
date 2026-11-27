/**
 * image/upscale.js — AI 업스케일 (브라우저에서 실행)
 *
 * ── 어떻게 동작하나요? ──
 * 일반 확대는 픽셀 사이를 "평균값"으로 채워서 흐릿해져요.
 * AI 업스케일(ESRGAN 계열 모델)은 수많은 사진으로 학습해서
 * "이런 모양 주변엔 보통 이런 디테일이 있다"를 추측해 픽셀을 새로 그려요.
 *
 * ── 사용하는 라이브러리 ──
 * - TensorFlow.js: 브라우저에서 AI 모델을 돌리는 엔진. GPU(WebGL)를 써서 빠르게 계산해요.
 * - UpscalerJS: TensorFlow.js 위에서 업스케일을 쉽게 쓰게 해주는 라이브러리
 * - esrgan-medium 모델: 실제로 학습된 AI (2배용, 4배용 각각 약 3MB)
 *
 * ── 지연 로딩(lazy loading) ──
 * 이 파일들은 수 MB라서, 업스케일 탭에서 처음 이미지를 처리할 때만 <script>로 불러와요.
 * 압축 탭만 쓰는 사람은 이 용량을 내려받지 않아도 돼요.
 */
import { loadBitmap, draw, toBlob } from './canvas.js';

const CDN = 'https://cdn.jsdelivr.net/npm';
const AI = {
  tf: `${CDN}/@tensorflow/tfjs@4.11.0/dist/tf.min.js`,
  upscaler: `${CDN}/upscaler@1.0.0/dist/browser/umd/upscaler.min.js`,
  models: {
    // global: 스크립트를 불러오면 window에 생기는 변수 이름
    2: { src: `${CDN}/@upscalerjs/esrgan-medium@1.0.0/dist/umd/models/esrgan-medium/src/x2/index.min.js`, global: 'ESRGANMedium2x' },
    4: { src: `${CDN}/@upscalerjs/esrgan-medium@1.0.0/dist/umd/models/esrgan-medium/src/x4/index.min.js`, global: 'ESRGANMedium4x' },
  },
};

/** 결과의 긴 변 최대 크기. 더 크면 메모리가 부족해 탭이 꺼질 수 있어요. */
export const MAX_OUTPUT = 4096;

/**
 * 업스케일을 할지, 몇 배로 할지 결정해요. (계산만 하고 실제 처리는 안 하는 순수 함수)
 * 결정과 실행을 나누면 규칙을 읽고 고치기 쉬워져요.
 *
 * @param {number} w 원본 가로
 * @param {number} h 원본 세로
 * @param {number} requested 사용자가 고른 배율 (2 또는 4)
 * @param {number} maxWidth  최대 가로 크기 설정 (0 = 제한 없음)
 * @returns {{factor:number, note:string}} factor가 0이면 업스케일 안 함
 */
export function planUpscale(w, h, requested, maxWidth) {
  // 어차피 최대 크기로 줄일 거라면 키울 이유가 없어요
  if (maxWidth && w >= maxWidth) {
    return { factor: 0, note: '이미 최대 가로 크기 이상이라 업스케일은 건너뛰었어요' };
  }
  let factor = requested;
  // 2배만으로도 최대 크기를 넘으면, 4배는 시간만 더 들고 결과는 같아요
  if (factor === 4 && maxWidth && w * 2 >= maxWidth) factor = 2;
  // 결과가 너무 커지면 배율을 반씩 낮춰요 (4 → 2 → 1)
  while (factor > 1 && Math.max(w, h) * factor > MAX_OUTPUT) factor /= 2;
  if (factor < 2) {
    return { factor: 0, note: `이미지가 커서 업스케일은 건너뛰었어요 (결과 최대 ${MAX_OUTPUT}px)` };
  }
  return { factor, note: factor !== requested ? `최대 크기에 맞춰 ${factor}배로 조정했어요` : '' };
}

/**
 * 파일을 받아 (필요하면) AI로 키운 결과를 돌려줘요.
 *
 * @param {File} file
 * @param {{upscale:number, maxWidth:number}} settings
 * @param {Object} opts
 * @param {{blob:Blob, factor:number, note:string}} [opts.cache] 이전에 키운 결과 (같은 배율이면 재사용)
 * @param {AbortSignal} [opts.signal]  중단 신호 (사용자가 삭제하면 멈춤)
 * @param {(msg:string) => void} opts.report  진행 상황을 화면에 알리는 함수
 * @returns {Promise<{blob:Blob, factor:number, note:string}>} factor 0 = 원본 그대로
 */
export async function upscaleImage(file, { upscale, maxWidth }, { cache, signal, report }) {
  const bmp = await loadBitmap(file);
  try {
    const { factor, note } = planUpscale(bmp.width, bmp.height, upscale, maxWidth);
    if (!factor) return { blob: file, factor: 0, note };
    if (cache?.factor === factor) return cache; // "다시 압축"할 때 AI를 또 돌리지 않음

    report('AI 준비 중… (처음엔 파일을 내려받느라 조금 걸려요)');
    const upscaler = await getUpscaler(factor);
    report(`AI ${factor}배 업스케일 중… 0%`);
    const canvas = await runModel(upscaler, bmp, signal,
      (p) => report(`AI ${factor}배 업스케일 중… ${Math.round(p * 100)}%`));
    // PNG(무손실)로 저장해 두면, 이후 압축 설정을 바꿔도 화질 손실 없이 재사용 가능
    const blob = await toBlob(canvas, 'image/png');
    return { blob, factor, note };
  } finally {
    bmp.close?.();
  }
}

// ─────────────────────────────────────────────
// 아래는 내부에서만 쓰는 함수들 (export 안 함)
// ─────────────────────────────────────────────

/**
 * <script> 태그를 코드로 추가해서 외부 JS를 불러와요.
 * 같은 주소를 여러 번 요청해도 한 번만 불러오도록 Promise를 저장(캐시)해요.
 */
const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => {
        scriptCache.delete(src); // 실패했으면 다음에 다시 시도할 수 있게 캐시에서 제거
        s.remove();
        reject(new Error(`load failed: ${src}`));
      };
      document.head.append(s);
    }));
  }
  return scriptCache.get(src);
}

/**
 * 배율별 Upscaler 객체를 준비해요. (모델 로딩은 오래 걸리니 한 번 만들면 계속 재사용)
 * Map에 "완성된 객체"가 아니라 "Promise"를 저장하는 게 포인트예요.
 * 그러면 로딩 중에 또 요청이 와도 같은 Promise를 기다리게 돼서 중복 로딩이 없어요.
 */
const upscalers = new Map();
function getUpscaler(scale) {
  if (!upscalers.has(scale)) {
    upscalers.set(scale, (async () => {
      // 순서 중요: upscaler는 tf에, 모델은 upscaler에 의존해요
      await loadScript(AI.tf);
      await loadScript(AI.upscaler);
      await loadScript(AI.models[scale].src);
      await window.tf.ready(); // GPU(WebGL) 준비 대기
      const u = new window.Upscaler({ model: window[AI.models[scale].global] });
      await u.ready; // 모델 파일 다운로드 + 초기화 대기
      return u;
    })().catch((e) => {
      upscalers.delete(scale);
      e.userMessage = 'AI 파일을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.';
      throw e;
    }));
  }
  return upscalers.get(scale);
}

/**
 * 실제로 AI 모델을 돌려요.
 *
 * "텐서(tensor)"는 AI가 다루는 숫자 배열이에요.
 * 이미지는 [세로, 가로, 3(RGB)] 모양의 텐서로 바뀌어서 모델에 들어가요.
 * 텐서는 GPU 메모리에 있어서 다 쓰면 dispose()로 직접 지워줘야 해요.
 */
async function runModel(upscaler, source, signal, onProgress) {
  const tf = window.tf;
  const input = draw(source, source.width, source.height);
  const tensor = await upscaler.execute(input, {
    output: 'tensor',
    patchSize: 64, // 이미지를 64px 조각으로 나눠 처리 → 메모리 절약 + 진행률 표시 가능
    padding: 6, // 조각끼리 살짝 겹치게 해서 이음매 자국 방지
    awaitNextFrame: true, // 조각마다 잠깐 쉬어서 화면이 멈추지 않게
    signal,
    progress: onProgress,
  });

  // 텐서 → canvas 픽셀. 값이 0~255를 살짝 벗어날 수 있어서 잘라내고 정수로 바꿔요.
  const out = document.createElement('canvas');
  out.width = tensor.shape[1];
  out.height = tensor.shape[0];
  const px = tf.tidy(() => tensor.clipByValue(0, 255).cast('int32')); // tidy: 중간 텐서 자동 정리
  tensor.dispose();
  await tf.browser.toPixels(px, out);
  px.dispose();

  restoreAlpha(input, out);
  return out;
}

/**
 * AI 모델은 색(RGB)만 다루고 투명도(Alpha)는 버려요.
 * 투명 배경 PNG라면, 투명도만 따로 일반 확대해서 결과에 다시 입혀요.
 *
 * getImageData().data는 [R,G,B,A, R,G,B,A, ...] 순서의 숫자 배열이에요.
 * 그래서 i = 3부터 4칸씩 건너뛰면 A(투명도) 값만 볼 수 있어요.
 */
function restoreAlpha(src, out) {
  const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
  let hasAlpha = false;
  for (let i = 3; i < sd.length; i += 4) {
    if (sd[i] < 255) { hasAlpha = true; break; }
  }
  if (!hasAlpha) return; // 불투명한 사진이면 할 일 없음

  const alpha = draw(src, out.width, out.height).getContext('2d').getImageData(0, 0, out.width, out.height).data;
  const ctx = out.getContext('2d');
  const img = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = alpha[i];
  ctx.putImageData(img, 0, 0);
}
