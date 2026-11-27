/**
 * ui/preview.js — 미리보기 창 (원본 ↔ 압축본 비교 슬라이더)
 *
 * ── <dialog> 요소 ──
 * HTML 기본 기능으로 팝업 창을 만들어요. showModal()로 열면
 * 뒤 화면이 어두워지고, Esc 키로 닫히고, 포커스가 창 안에 갇히는 게 자동이에요.
 *
 * ── 비교 슬라이더 원리 ──
 * 원본(아래)과 결과(위) 두 이미지를 같은 자리에 겹쳐 놓고,
 * 위 이미지를 CSS clip-path로 왼쪽부터 잘라내요.
 *   clip-path: inset(0 0 0 30%)  → 왼쪽 30%를 숨김
 * 그러면 왼쪽 30%는 아래의 원본이, 나머지 70%는 결과가 보여요.
 * 마우스 위치에 따라 이 %만 바꾸면 슬라이더가 돼요.
 */
import { LABEL } from '../formats.js';
import { formatBytes, savingPct, savingLabel } from '../utils.js';

const $ = (id) => document.getElementById(id);
const pv = {
  dialog: $('preview'),
  title: $('pvTitle'),
  formats: $('pvFormats'),
  modes: [...document.querySelectorAll('input[name="pvMode"]')],
  actual: $('pvActual'),
  close: $('pvClose'),
  stage: $('pvStage'),
  frame: $('pvFrame'),
  base: $('pvBase'), // 아래 이미지
  top: $('pvTop'), // 위 이미지 (잘라내는 쪽)
  handle: $('pvHandle'),
  tagL: $('pvTagL'),
  tagR: $('pvTagR'),
  info: $('pvInfo'),
  download: $('pvDownload'),
};

/**
 * 미리보기 창의 상태. 창이 닫혀 있으면 null.
 * @type {{item: import('../store.js').Item, idx: number, pos: number, origLabel: string} | null}
 *   idx: 결과 중 몇 번째 형식을 보는지 (WebP + JPG일 때 0 또는 1)
 *   pos: 슬라이더 위치 (0~100%)
 *   origLabel: 비교할 때 왼쪽(원본)에 붙는 이름표
 */
let state = null;

/**
 * 미리보기 열기 (두 탭이 같은 창을 함께 써요)
 * @param {import('../store.js').Item} item
 * @param {{origLabel?: string}} [opts]
 *   업스케일 탭에서는 원본이 결과 크기로 "그냥 늘어나 보이는" 거라 이름표를 다르게 붙여요
 */
export function openPreview(item, { origLabel = '원본' } = {}) {
  if (!item.results) return;
  state = { item, idx: 0, pos: 50, origLabel };
  if (!pv.dialog.open) pv.dialog.showModal();
  render();
}

/** 해당 항목을 보고 있다면 창 닫기 (항목이 삭제될 때 사용) */
export function closePreviewFor(item) {
  if (state?.item === item) pv.dialog.close();
}

/** 지금 보기 방식: 'compare' | 'result' | 'original' */
function currentMode() {
  const m = pv.modes.find((r) => r.checked).value;
  // 원본을 표시할 수 없으면 무조건 압축본만
  return state.item.origBroken && m !== 'result' ? 'result' : m;
}

/**
 * 상태(state)를 보고 창 전체를 다시 그려요.
 * "상태가 바뀌면 → render()로 전부 다시 그리기" 패턴이라
 * 어떤 순서로 버튼을 눌러도 화면이 항상 상태와 일치해요. (React 같은 라이브러리의 기본 아이디어)
 */
function render() {
  const { item, idx } = state;
  const r = item.results[idx];
  const mode = currentMode();
  const compare = mode === 'compare';

  pv.title.textContent = r.name;
  renderFormatButtons(item, idx);

  // 원본 표시가 불가능하면 '비교', '원본' 버튼 비활성화
  pv.modes.forEach((m) => { m.disabled = item.origBroken && m.value !== 'result'; });
  if (item.origBroken) pv.modes.find((m) => m.value === 'result').checked = true;

  // 원본 이미지를 못 읽으면(예: Chrome에서 HEIC) 표시하고 다시 그림
  pv.base.onerror = () => {
    if (pv.base.src !== item.origUrl) return;
    item.origBroken = true;
    render();
  };
  pv.base.src = mode === 'result' ? r.url : item.origUrl;
  pv.top.src = r.url;
  pv.top.hidden = pv.handle.hidden = pv.tagL.hidden = pv.tagR.hidden = !compare;
  pv.tagL.textContent = state.origLabel;
  pv.tagR.textContent = LABEL[r.type];
  pv.frame.classList.toggle('compare', compare);
  pv.frame.classList.toggle('actual', pv.actual.checked);
  applySliderPos();
  layoutFrame();

  pv.info.textContent = mode === 'original'
    ? `원본 · ${formatBytes(item.file.size)}`
    : `${LABEL[r.type]} · ${r.width}×${r.height} · ${formatBytes(r.blob.size)} (원본 ${formatBytes(item.file.size)} 대비 ${savingLabel(savingPct(item.file.size, r.blob.size))})`;
  if (item.origBroken) pv.info.textContent += ' · 이 브라우저에서는 원본을 표시할 수 없어 비교가 꺼졌어요';

  pv.download.href = r.url;
  pv.download.download = r.name;
  pv.download.textContent = `${LABEL[r.type]} 다운로드`;
}

/** WebP + JPG처럼 결과가 여러 개일 때만 형식 선택 버튼 표시 */
function renderFormatButtons(item, idx) {
  pv.formats.hidden = item.results.length < 2;
  pv.formats.innerHTML = '';
  item.results.forEach((res, i) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'pvFormat';
    input.checked = i === idx;
    input.addEventListener('change', () => { state.idx = i; render(); });
    const span = document.createElement('span');
    span.textContent = LABEL[res.type];
    label.append(input, span);
    pv.formats.append(label);
  });
}

/**
 * 이미지 표시 크기 계산
 * - 화면에 맞추기: 창보다 크면 비율 유지하며 줄이고, 작으면 원래 크기 (확대해서 흐려지지 않게)
 * - 실제 크기: 결과 픽셀 그대로 (창보다 크면 스크롤)
 * 두 이미지를 같은 상자(frame)에 꽉 채우기 때문에 원본과 압축본 크기가 달라도 정확히 겹쳐요.
 */
function layoutFrame() {
  if (!state) return;
  const r = state.item.results[state.idx];
  let s = 1;
  if (!pv.actual.checked) {
    const cs = getComputedStyle(pv.stage);
    const w = pv.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = pv.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    s = Math.min(1, w / r.width, h / r.height);
  }
  pv.frame.style.width = `${Math.round(r.width * s)}px`;
  pv.frame.style.height = `${Math.round(r.height * s)}px`;
}

/** 슬라이더 위치 적용: 왼쪽 = 원본, 오른쪽 = 결과 */
function applySliderPos() {
  pv.top.style.clipPath = `inset(0 0 0 ${state.pos}%)`;
  pv.handle.style.left = `${state.pos}%`;
}

const clamp = (v) => Math.max(0, Math.min(100, v));

/** 마우스/터치 x좌표 → 이미지 안에서 몇 %인지 */
function setPosFromPointer(e) {
  const rect = pv.frame.getBoundingClientRect();
  state.pos = clamp(((e.clientX - rect.left) / rect.width) * 100);
  applySliderPos();
}

/** 페이지가 열릴 때 한 번 호출: 이벤트 연결 */
export function initPreview() {
  // Pointer 이벤트는 마우스·터치·펜을 하나로 처리해요.
  // setPointerCapture: 드래그 중 포인터가 이미지 밖으로 나가도 계속 따라가게 함
  let dragging = false;
  pv.frame.addEventListener('pointerdown', (e) => {
    if (!state || currentMode() !== 'compare') return;
    dragging = true;
    pv.frame.setPointerCapture(e.pointerId);
    setPosFromPointer(e);
  });
  pv.frame.addEventListener('pointermove', (e) => { if (dragging) setPosFromPointer(e); });
  ['pointerup', 'pointercancel'].forEach((t) => pv.frame.addEventListener(t, () => { dragging = false; }));

  // 키보드 ← → 로도 슬라이더 이동
  pv.dialog.addEventListener('keydown', (e) => {
    if (!state || currentMode() !== 'compare') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target.matches('input[type="radio"]')) return; // 라디오 버튼의 화살표 이동은 그대로 둠
    e.preventDefault();
    state.pos = clamp(state.pos + (e.key === 'ArrowLeft' ? -5 : 5));
    applySliderPos();
  });

  pv.modes.forEach((m) => m.addEventListener('change', render));
  pv.actual.addEventListener('change', render);
  pv.close.addEventListener('click', () => pv.dialog.close());
  // 창 바깥(어두운 배경)을 클릭하면 이벤트 대상이 dialog 자신이 돼요
  pv.dialog.addEventListener('click', (e) => { if (e.target === pv.dialog) pv.dialog.close(); });
  pv.dialog.addEventListener('close', () => {
    state = null;
    pv.base.removeAttribute('src'); // 큰 이미지를 메모리에서 내려놓기
    pv.top.removeAttribute('src');
  });
  window.addEventListener('resize', () => { if (pv.dialog.open) layoutFrame(); });
}
