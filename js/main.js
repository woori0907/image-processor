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
 *             ├── image/compress.js     실제 이미지 처리 (화면을 전혀 모름)
 *             ├── ui/slicer.js  자르기 탭 (한 장 편집 방식이라 workspace를 안 씀)
 *             │      ├── cuts.js            자르는 선 데이터
 *             │      └── image/slice.js     실제로 자르기
 *             ├── ui/thumbnailer.js  썸네일 탭 (영역을 사람이 조정할 수 있어서 workspace를 안 씀)
 *             │      ├── ui/sizes.js        크기 목록 편집
 *             │      ├── ui/cropper.js      영역 조정 창
 *             │      ├── crop.js            가져올 영역 데이터
 *             │      └── image/thumbnail.js 실제로 잘라서 줄이기
 *             └── ui/tabs.js · preview.js
 *
 * 처음 공부할 때는 아래 파이프라인(compressPipeline)을 먼저 읽고,
 * 그다음 workspace.js의 processItem()에서 이 함수들이 어떻게 불리는지 따라가 보세요.
 */
import { createWorkspace } from './workspace.js';
import { initTabs } from './ui/tabs.js';
import { initPreview } from './ui/preview.js';
import { compress } from './image/compress.js';
import { createSlicer } from './ui/slicer.js';
import { createThumbnailer } from './ui/thumbnailer.js';

// ─────────────────────────────────────────────
// 1. 파이프라인: 탭마다 이미지 한 장을 처리하는 방법
//    (모양은 workspace.js의 ProcessFn 설명 참고)
// ─────────────────────────────────────────────

/** 압축 탭: 원본 → 줄이기 + 형식 변환 */
async function compressPipeline(item, settings, { report }) {
  report('압축 중…');
  const outputs = await compress(item.file, settings);
  return { outputs };
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
  // 자르기·썸네일 탭은 workspace가 아니지만 addFiles()라는 같은 이름의 기능을 갖고 있어서
  // 아래 "아무 데나 놓기 · 붙여넣기" 코드가 탭 종류를 몰라도 똑같이 동작해요.
  // (이렇게 "모양(쓰는 법)만 같으면 같은 자리에 끼울 수 있다"는 걸 덕 타이핑이라고 해요)
  slice: createSlicer(document.getElementById('panel-slice')),
  thumb: createThumbnailer(document.getElementById('panel-thumb')),
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
