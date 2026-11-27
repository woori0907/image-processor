/**
 * main.js — 앱의 시작점이자 "지휘자"
 *
 * 이 파일이 하는 일은 딱 세 가지예요:
 *   1. 탭마다 "이미지를 어떻게 처리할지(파이프라인)" 정하기
 *   2. 탭마다 작업 공간(workspace) 만들기
 *   3. 페이지 전체에 하나뿐인 기능 연결 (탭 전환, 아무 데나 놓기, 붙여넣기, 미리보기)
 *
 * 파일들의 관계:
 *
 *   main.js ──┬── workspace.js (탭마다 하나씩)
 *             │      ├── store.js          목록 데이터
 *             │      └── ui/settings · dropzone · list
 *             ├── image/compress.js     ┐ 실제 이미지 처리
 *             ├── image/upscale.js      ┘ (화면을 전혀 모름)
 *             ├── ui/slicer.js  자르기 탭 (한 장 편집 방식이라 workspace를 안 씀)
 *             │      ├── cuts.js            자르는 선 데이터
 *             │      └── image/slice.js     실제로 자르기
 *             └── ui/tabs.js · preview.js
 *
 * 처음 공부할 때는 아래 두 파이프라인(compressPipeline, upscalePipeline)을 먼저 읽고,
 * 그다음 workspace.js의 processItem()에서 이 함수들이 어떻게 불리는지 따라가 보세요.
 */
import { createWorkspace } from './workspace.js';
import { initTabs } from './ui/tabs.js';
import { initPreview } from './ui/preview.js';
import { compress } from './image/compress.js';
import { upscaleImage, MAX_OUTPUT } from './image/upscale.js';
import { createSlicer } from './ui/slicer.js';

// ─────────────────────────────────────────────
// 1. 파이프라인: 탭마다 이미지 한 장을 처리하는 방법
//    (모양은 workspace.js의 ProcessFn 설명 참고)
// ─────────────────────────────────────────────

/** 압축 탭: 원본 → 줄이기 + 형식 변환 */
async function compressPipeline(item, settings, { report }) {
  report('압축 중…');
  const outputs = await compress(item.file, item.file, settings, false);
  return { outputs };
}

/** 업스케일 탭: 원본 → AI로 키우기 → 선택한 형식으로 저장 (크기는 줄이지 않음) */
async function upscalePipeline(item, settings, { signal, report }) {
  const up = await upscaleImage(
    item.file,
    { upscale: settings.upscale, maxWidth: 0 }, // 업스케일 탭에는 최대 크기 제한이 없어요
    { cache: item.upCache, signal, report },
  );
  if (!up.factor) {
    // 너무 큰 이미지 → 이 탭에서는 처리할 게 없으니 실패로 알려줘요
    const err = new Error('image too large');
    err.userMessage = `이미지가 너무 커요. 긴 변 ${MAX_OUTPUT / 2}px 이하인 이미지만 키울 수 있어요.`;
    throw err;
  }
  item.upCache = up; // 형식·품질만 바꿔 "다시 처리"하면 AI를 또 돌리지 않음

  signal.throwIfAborted(); // 그 사이 삭제됐으면 여기서 멈춤
  report('저장 중…');
  const outputs = await compress(item.file, up.blob, { ...settings, maxWidth: 0 }, true);
  return { outputs, upInfo: up };
}

// ─────────────────────────────────────────────
// 2. 작업 공간 만들기
// ─────────────────────────────────────────────

const workspaces = {
  compress: createWorkspace(document.getElementById('panel-compress'), {
    mode: 'compress',
    process: compressPipeline,
    zipName: 'compressed-images.zip',
  }),
  upscale: createWorkspace(document.getElementById('panel-upscale'), {
    mode: 'upscale',
    process: upscalePipeline,
    zipName: 'upscaled-images.zip',
    origLabel: '원본 (단순 확대)',
  }),
  // 자르기 탭은 workspace가 아니지만 addFiles()라는 같은 이름의 기능을 갖고 있어서
  // 아래 "아무 데나 놓기 · 붙여넣기" 코드가 탭 종류를 몰라도 똑같이 동작해요.
  // (이렇게 "모양(쓰는 법)만 같으면 같은 자리에 끼울 수 있다"는 걸 덕 타이핑이라고 해요)
  slice: createSlicer(document.getElementById('panel-slice')),
};

// ─────────────────────────────────────────────
// 3. 페이지 전체 기능
// ─────────────────────────────────────────────

const tabs = initTabs();
initPreview();

/** 지금 열려 있는 탭의 작업 공간 */
const activeWorkspace = () => workspaces[tabs.active()];

// 드롭 영역 밖에 떨어뜨려도 지금 탭으로 받아요.
// (막지 않으면 브라우저가 이미지를 새 탭에서 열어버려요)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) activeWorkspace().addFiles(e.dataTransfer.files);
});

// 붙여넣기(⌘V / Ctrl+V)도 지금 탭으로
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) activeWorkspace().addFiles(files);
});

// 여기까지 왔으면 앱 준비 완료! index.html의 안전장치 스크립트가 이 표시를 확인해요.
document.documentElement.dataset.ready = 'true';
