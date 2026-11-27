/**
 * ui/region-picker.js — "사용할 부분 선택" 창 (<dialog id="regionPicker">)
 *
 * 세로로 긴 이미지에서 썸네일로 쓸 부분만 골라요.
 * 영역의 규칙(원본 밖으로 안 나가기, 최소 크기)은 region.js가 지키고,
 * 이 파일은 "조작 → 다시 그리기"와 "스크롤"만 해요.
 *
 * ── 조작 방법 ──
 *   · 빈 곳(영역 밖)에서 끌기 → 새 영역 그리기
 *     (전체가 선택된 상태라면 어디서 끌든 새로 그려요)
 *   · 영역 안에서 끌기       → 옮기기
 *   · 변·모서리 끌기         → 크기 바꾸기 (비율 자유)
 *   · 키보드 (영역 선택)      → ←↑↓→ 1px, Shift와 함께 10px
 *   · 창 위·아래 끝으로 끌기  → 저절로 스크롤 (긴 영역을 한 번에 그릴 수 있게)
 *
 * ── 크롭 창(cropper.js)과 다른 점 ──
 *   · 비율이 자유예요 (crop.js 대신 region.js)
 *   · 긴 이미지를 크게 보려고 "가로 폭에 맞춰" 보여주고, 세로는 스크롤해요
 *   · 바로 반영하지 않고 [이 부분 사용]을 눌러야 적용돼요. 취소하면 원래대로.
 *     (사용할 부분이 바뀌면 썸네일 영역 조정을 처음부터 다시 해야 해서, 실수로 바뀌지 않게)
 *
 * @param {HTMLDialogElement} dialog
 * @returns {{open: Function}}
 */
import { createRegion } from '../region.js';

/** 위·아래 끝에서 몇 px 안쪽부터 저절로 스크롤할지 */
const EDGE = 48;
/** 한 화면 갱신(약 1/60초)마다 최대 몇 px 스크롤할지 */
const MAX_SCROLL = 24;

export function createRegionPicker(dialog) {
  const $ = (sel) => dialog.querySelector(sel);
  const titleEl = $('.rp-title');
  const stage = $('.rp-stage');
  const frame = $('.rp-frame');
  const img = $('.rp-img');
  const hole = $('.rp-hole');
  const box = $('.rp-box');
  const infoEl = $('.rp-info');
  const fullBtn = $('[data-action="full"]');
  const applyBtn = $('[data-action="apply"]');
  const cancelBtn = $('[data-action="cancel"]');

  /** 지금 열린 내용 { item, region, onApply }. 닫혀 있으면 null */
  let cur = null;
  /**
   * 끄는 중이면 { mode, edges, start, startRect, clientX, clientY, moved, raf }
   *   mode: 'draw'(새로 그리기) | 'move'(옮기기) | 'resize'(크기 바꾸기)
   */
  let drag = null;

  // ─────────────────────────────────────────────
  // 열기 · 닫기
  // ─────────────────────────────────────────────

  /**
   * @param {Object} item thumbnailer.js의 이미지 항목. 원본 정보는 item.orig에 있어요
   * @param {(rect: {x:number,y:number,w:number,h:number}) => void} onApply [이 부분 사용]을 누르면 호출
   */
  function open(item, onApply) {
    const { width, height, url } = item.orig;
    cur = { item, onApply, region: createRegion(width, height, item.region) };
    titleEl.textContent = `사용할 부분 선택 · ${item.file.name}`;
    img.src = url;
    dialog.showModal();
    fitFrame();
    render();
    // 이미 고른 부분이 있으면 그 부분이 보이게 스크롤
    const r = cur.region.rect();
    stage.scrollTop = (r.y / height) * frame.offsetHeight;
    box.focus({ preventScroll: true });
  }

  function close() {
    stopAutoScroll();
    drag = null;
    cur = null;
    img.removeAttribute('src');
    if (dialog.open) dialog.close();
  }

  applyBtn.addEventListener('click', () => {
    const { region, onApply } = cur;
    close();
    onApply(region.rect());
  });
  cancelBtn.addEventListener('click', close);
  // Esc를 누르면 dialog가 스스로 닫히는데, 그때도 정리가 되도록 'close' 이벤트에서 한 번 더
  dialog.addEventListener('close', () => { if (cur) close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); }); // 바깥 클릭 = 취소

  fullBtn.addEventListener('click', () => {
    cur.region.reset();
    render();
  });

  // ─────────────────────────────────────────────
  // 이미지 틀 크기: 가로 폭에 맞추고 세로는 스크롤
  // (작은 이미지는 다루기 쉽게 최대 2배까지 키워 보여줘요 — 결과물과는 상관없어요)
  // ─────────────────────────────────────────────

  function fitFrame() {
    if (!cur) return;
    const { width, height } = cur.item.orig;
    const cs = getComputedStyle(stage);
    // 세로 스크롤바가 생기면 그만큼 가로가 줄어드니, clientWidth(스크롤바 제외)를 기준으로 해요
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const scale = Math.min(availW / width, 2);
    frame.style.width = `${Math.floor(width * scale)}px`;
    frame.style.height = `${Math.floor(height * scale)}px`;
  }
  new ResizeObserver(fitFrame).observe(stage);

  // ─────────────────────────────────────────────
  // 포인터 조작
  // ─────────────────────────────────────────────

  /** 화면 좌표 → 원본 좌표(px). 스크롤하면 틀의 위치가 바뀌니 매번 새로 재요 */
  function toSource(clientX, clientY) {
    const r = frame.getBoundingClientRect();
    const { width, height } = cur.item.orig;
    return {
      x: Math.min(width, Math.max(0, ((clientX - r.left) / r.width) * width)),
      y: Math.min(height, Math.max(0, ((clientY - r.top) / r.height) * height)),
    };
  }

  frame.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return;
    e.preventDefault();
    const region = cur.region;
    const edges = e.target.closest('.rp-handle')?.dataset.edge;
    let mode = 'draw';
    if (edges) mode = 'resize';
    else if (box.contains(e.target) && !region.isFull()) mode = 'move';

    drag = {
      mode,
      edges,
      start: toSource(e.clientX, e.clientY),
      startRect: region.rect(),
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
      raf: 0,
    };
    frame.setPointerCapture(e.pointerId);
    frame.classList.add('dragging');
    box.focus({ preventScroll: true });
    drag.raf = requestAnimationFrame(autoScroll);
  });

  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // 손떨림 정도(3px)는 "끈 것"으로 치지 않아요 → 그냥 클릭이면 영역이 사라지지 않게
    if (Math.abs(e.clientX - drag.clientX) + Math.abs(e.clientY - drag.clientY) > 3) drag.moved = true;
    drag.clientX = e.clientX;
    drag.clientY = e.clientY;
    applyDrag();
  });

  /** 마지막 포인터 위치로 영역 고치기 (포인터가 멈춰도 스크롤되면 다시 불려요) */
  function applyDrag() {
    if (!drag.moved) return;
    const p = toSource(drag.clientX, drag.clientY);
    const region = cur.region;
    if (drag.mode === 'draw') region.drawFrom(drag.start.x, drag.start.y, p.x, p.y);
    else if (drag.mode === 'resize') region.resizeEdges(drag.edges, p.x, p.y);
    else region.moveTo(drag.startRect.x + (p.x - drag.start.x), drag.startRect.y + (p.y - drag.start.y));
    render();
  }

  function endDrag() {
    if (!drag) return;
    // 그리기 모드에서 끌지 않고 클릭만 했다면 원래 영역 그대로
    if (drag.mode === 'draw' && !drag.moved) cur.region.set(drag.startRect);
    stopAutoScroll();
    drag = null;
    frame.classList.remove('dragging');
    render();
  }
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);

  /**
   * 저절로 스크롤: 끄는 동안 매 화면 갱신마다 포인터가 창 위·아래 끝 근처인지 확인해요.
   * 끝에 가까울수록(또는 창 밖으로 나갈수록) 빨리 스크롤하고, 스크롤한 만큼 영역도 따라가요.
   * pointermove는 포인터가 "움직일 때만" 오기 때문에, 가만히 대고 있어도 계속 스크롤되려면
   * 이렇게 requestAnimationFrame으로 직접 돌아야 해요.
   */
  function autoScroll() {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    let dy = 0;
    if (drag.clientY < r.top + EDGE) dy = drag.clientY - (r.top + EDGE);         // 음수 = 위로
    else if (drag.clientY > r.bottom - EDGE) dy = drag.clientY - (r.bottom - EDGE); // 양수 = 아래로
    if (dy) {
      const before = stage.scrollTop;
      stage.scrollTop += Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, dy / 2));
      if (stage.scrollTop !== before) applyDrag();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function stopAutoScroll() {
    if (drag?.raf) cancelAnimationFrame(drag.raf);
  }

  // 키보드: 영역 옮기기
  box.addEventListener('keydown', (e) => {
    if (!cur) return;
    const region = cur.region;
    const r = region.rect();
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft': region.moveTo(r.x - step, r.y); break;
      case 'ArrowRight': region.moveTo(r.x + step, r.y); break;
      case 'ArrowUp': region.moveTo(r.x, r.y - step); break;
      case 'ArrowDown': region.moveTo(r.x, r.y + step); break;
      default: return;
    }
    e.preventDefault();
    render();
  });

  // ─────────────────────────────────────────────
  // 그리기
  // ─────────────────────────────────────────────

  function render() {
    if (!cur) return;
    const { width, height } = cur.item.orig;
    const r = cur.region.rect();
    const pct = (v, total) => `${(v / total) * 100}%`;
    const pos = {
      left: pct(r.x, width),
      top: pct(r.y, height),
      width: pct(r.w, width),
      height: pct(r.h, height),
    };
    Object.assign(box.style, pos);
    Object.assign(hole.style, pos);

    const full = cur.region.isFull();
    // 전체가 선택된 상태에서는 "어디서 끌든 새로 그리기"라서 옮기기 커서를 보여주지 않아요
    box.classList.toggle('is-full', full);
    infoEl.textContent = full
      ? `원본 전체 (${width} × ${height}px). 이미지 위를 끌어서 사용할 부분을 그려 주세요.`
      : `선택한 부분: ${r.w} × ${r.h}px (왼쪽 ${r.x}, 위 ${r.y})`;
    fullBtn.disabled = full;
  }

  return { open };
}
