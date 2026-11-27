/**
 * ui/cropper.js — 썸네일 영역 조정 창 (<dialog id="cropper">)
 *
 * 원본 이미지 위에 "가져올 영역" 상자를 띄우고, 사람이 그 상자를 옮기거나 키워요.
 * 영역의 규칙(비율 고정, 원본 밖으로 안 나가기 등)은 crop.js가 지키고,
 * 실제로 잘라 그리는 건 image/thumbnail.js가 해요. 이 파일은 "조작 → 다시 그리기"만 해요.
 *
 * ── 조작 방법 ──
 *   · 상자 끌기          → 옮기기
 *   · 상자 밖 누르기      → 그 자리로 상자를 옮기고 바로 끌기 시작
 *   · 모서리 끌기        → 크기 조절 (반대쪽 모서리 고정)
 *   · 마우스 휠 / 핀치    → 커서 위치를 중심으로 확대·축소
 *   · 확대 슬라이더       → 상자 가운데를 중심으로 확대·축소
 *   · 키보드 (상자 선택)  → ←↑↓→ 1px, Shift와 함께 10px, + − 확대·축소
 *
 * ── 좌표 계산 (slicer.js와 같은 원리) ──
 * 화면에는 원본이 줄어들어 보이지만 영역은 항상 "원본 px"로 다뤄요.
 *   · 화면 → 원본: (포인터 x - 이미지 왼쪽) ÷ 화면에 보이는 가로 × 원본 가로
 *   · 원본 → 화면: CSS left/top/width/height를 %로
 *
 * ── 상자 바깥이 어둡게 보이는 원리 ──
 * 상자와 같은 위치에 "구멍"(.cr-hole)을 하나 더 두고, 아주 큰 그림자(box-shadow: 0 0 0 9999px 반투명 검정)를 줘요.
 * 구멍을 감싼 층(.cr-shade)에 overflow: hidden을 줘서 이미지 밖으로 나간 그림자는 잘라요. (style.css)
 * 상자 자체에 그림자를 주면 상자의 손잡이까지 같이 잘려서, 이미지 끝에 붙었을 때 모서리를 잡을 수 없거든요.
 *
 * @param {HTMLDialogElement} dialog
 * @returns {{open: Function}}
 */
import { sizeKey, sizeLabel } from './sizes.js';
import { drawThumbInto } from '../image/thumbnail.js';

export function createCropper(dialog) {
  const $ = (sel) => dialog.querySelector(sel);
  const titleEl = $('.cr-title');
  const sizesEl = $('.cr-sizes');
  const stage = $('.cr-stage');
  const frame = $('.cr-frame');
  const img = $('.cr-img');
  const box = $('.cr-box');
  const hole = $('.cr-hole');
  const previewEl = $('.cr-preview');
  const previewCap = $('.cr-preview-cap');
  const zoomInput = $('.cr-zoom input');
  const zoomOut = $('.cr-zoom output');
  const infoEl = $('.cr-info');
  const warnEl = $('.cr-warn');
  const resetBtn = $('[data-action="reset"]');
  const doneBtn = $('[data-action="done"]');

  /**
   * 지금 열린 내용. 닫혀 있으면 null
   * @type {null | {item: Object, sizes: {w:number,h:number}[], size: {w:number,h:number},
   *                getCrop: (size: Object) => ReturnType<import('../crop.js').createCrop>,
   *                onChange: (size: Object) => void}}
   */
  let cur = null;
  /** 끄는 중이면 { corner, start, rect }. corner가 없으면 옮기기 */
  let drag = null;
  /** requestAnimationFrame 번호 (0이면 예약된 그리기 없음) */
  let pending = 0;

  const crop = () => cur.getCrop(cur.size);

  // ─────────────────────────────────────────────
  // 열기 · 닫기
  // ─────────────────────────────────────────────

  /**
   * @param {Object} item       thumbnailer.js의 이미지 항목 ({ file, url, source, width, height })
   * @param {{w:number,h:number}[]} sizes 위쪽에서 고를 수 있는 크기들
   * @param {string} key        처음에 열 크기 (sizeKey)
   * @param {Object} hooks
   * @param {(size: Object) => Object} hooks.getCrop  크기별 영역 데이터(crop.js) 꺼내기
   * @param {(size: Object) => void} hooks.onChange   영역이 바뀔 때마다 호출 (목록의 미리보기 갱신용)
   */
  function open(item, sizes, key, { getCrop, onChange }) {
    cur = { item, sizes, getCrop, onChange, size: sizes.find((s) => sizeKey(s) === key) ?? sizes[0] };
    titleEl.textContent = `영역 조정 · ${item.file.name}`;
    img.src = item.url;
    renderSizeSwitch();
    dialog.showModal();
    fitFrame();
    render();
    box.focus({ preventScroll: true }); // 열자마자 방향키로 조정할 수 있게
  }

  dialog.addEventListener('close', () => {
    cancelAnimationFrame(pending);
    pending = 0;
    cur = null;
    drag = null;
    img.removeAttribute('src');
  });
  doneBtn.addEventListener('click', () => dialog.close());
  // 바깥 어두운 영역(backdrop)을 누르면 닫기. backdrop 클릭은 dialog 자신이 받아요.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /** 위쪽 크기 선택 버튼 (233 × 158 | 216 × 158 …) */
  function renderSizeSwitch() {
    sizesEl.replaceChildren(...cur.sizes.map((s) => {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), {
        type: 'radio', name: 'cr-size', value: sizeKey(s), checked: s === cur.size,
      });
      const span = document.createElement('span');
      span.textContent = sizeLabel(s);
      label.append(input, span);
      return label;
    }));
    sizesEl.hidden = cur.sizes.length < 2; // 크기가 하나뿐이면 고를 필요가 없어요
  }

  sizesEl.addEventListener('change', (e) => {
    cur.size = cur.sizes.find((s) => sizeKey(s) === e.target.value);
    render();
  });

  // ─────────────────────────────────────────────
  // 이미지 틀 크기 맞추기
  // CSS만으로 "가로·세로 둘 다 넘치지 않게"를 맞추기는 까다로워서, 직접 계산해요.
  // ResizeObserver: 창 크기가 바뀌어 무대(stage) 크기가 달라질 때마다 알려줘요.
  // ─────────────────────────────────────────────

  function fitFrame() {
    if (!cur) return;
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // 작은 이미지는 조작하기 쉽게 최대 2배까지 키워서 보여줘요 (결과물과는 상관없어요)
    const scale = Math.min(availW / cur.item.width, availH / cur.item.height, 2);
    frame.style.width = `${Math.floor(cur.item.width * scale)}px`;
    frame.style.height = `${Math.floor(cur.item.height * scale)}px`;
  }
  new ResizeObserver(fitFrame).observe(stage);

  // ─────────────────────────────────────────────
  // 포인터 조작 (마우스·터치·펜을 한 코드로)
  // ─────────────────────────────────────────────

  /** 포인터 이벤트 → 원본 이미지 기준 좌표(px) */
  function toSource(e) {
    const r = frame.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * cur.item.width,
      y: ((e.clientY - r.top) / r.height) * cur.item.height,
    };
  }

  frame.addEventListener('pointerdown', (e) => {
    if (!cur || e.button !== 0) return; // 왼쪽 버튼(터치 포함)만
    e.preventDefault(); // 글자 선택·이미지 끌기 같은 브라우저 기본 동작 막기
    const p = toSource(e);
    const c = crop();
    const corner = e.target.closest('.cr-handle')?.dataset.corner;
    // 상자 바깥을 눌렀으면 상자를 그 자리로 먼저 옮겨요
    if (!corner && !box.contains(e.target)) c.centerAt(p.x, p.y);
    // 끌기 시작 시점의 포인터·영역을 기억해 두고, 움직일 때마다 "시작점 + 이동량"으로 계산해요.
    // (매번 조금씩 더하면 원본 끝에 막혔을 때 포인터와 상자가 어긋나요)
    drag = { corner, start: p, rect: c.rect() };
    // setPointerCapture: 포인터가 이미지 밖으로 나가도 계속 이 틀이 이벤트를 받아요
    frame.setPointerCapture(e.pointerId);
    frame.classList.add('dragging');
    box.focus({ preventScroll: true });
    requestRender();
  });

  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSource(e);
    const c = crop();
    if (drag.corner) c.resizeCorner(drag.corner, p.x, p.y);
    else c.moveTo(drag.rect.x + (p.x - drag.start.x), drag.rect.y + (p.y - drag.start.y));
    requestRender();
  });

  const endDrag = () => {
    drag = null;
    frame.classList.remove('dragging');
  };
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);

  // 휠: 커서 위치를 중심으로 확대·축소
  // passive: false → preventDefault()로 페이지 스크롤을 막겠다고 브라우저에 미리 알려요
  // (맥 트랙패드의 두 손가락 핀치도 ctrlKey가 붙은 wheel 이벤트로 들어와서 같이 처리돼요)
  frame.addEventListener('wheel', (e) => {
    if (!cur) return;
    e.preventDefault();
    const p = toSource(e);
    const c = crop();
    // 지수 함수를 쓰면 휠을 올렸다 내렸다 해도 같은 배율로 정확히 돌아와요
    c.zoomTo(c.zoom() * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    requestRender();
  }, { passive: false });

  // ─────────────────────────────────────────────
  // 키보드 · 슬라이더 · 버튼
  // ─────────────────────────────────────────────

  box.addEventListener('keydown', (e) => {
    if (!cur) return;
    const c = crop();
    const r = c.rect();
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft': c.moveTo(r.x - step, r.y); break;
      case 'ArrowRight': c.moveTo(r.x + step, r.y); break;
      case 'ArrowUp': c.moveTo(r.x, r.y - step); break;
      case 'ArrowDown': c.moveTo(r.x, r.y + step); break;
      case '+': case '=': c.zoomTo(c.zoom() * 1.1); break;
      case '-': case '_': c.zoomTo(c.zoom() / 1.1); break;
      default: return; // 그 밖의 키(Esc 등)는 브라우저 기본 동작 그대로
    }
    e.preventDefault(); // 화살표로 페이지가 스크롤되지 않게
    render();
  });

  zoomInput.addEventListener('input', () => {
    crop().zoomTo(Number(zoomInput.value));
    requestRender();
  });

  resetBtn.addEventListener('click', () => {
    crop().reset();
    render();
  });

  // ─────────────────────────────────────────────
  // 그리기
  // ─────────────────────────────────────────────

  /**
   * 끄는 동안 pointermove는 1초에 수십~수백 번 올 수 있어요.
   * requestAnimationFrame으로 "다음 화면 갱신 때 한 번만" 그리게 모아서 낭비를 줄여요.
   */
  function requestRender() {
    pending ||= requestAnimationFrame(render); // ||= : 이미 예약돼 있으면 또 예약하지 않음
  }

  function render() {
    pending = 0;
    if (!cur) return;
    const { item, size } = cur;
    const c = crop();
    const r = c.rect();

    // 상자 위치·크기 (원본 대비 %)
    const pct = (v, total) => `${(v / total) * 100}%`;
    const pos = {
      left: pct(r.x, item.width),
      top: pct(r.y, item.height),
      width: pct(r.w, item.width),
      height: pct(r.h, item.height),
    };
    Object.assign(box.style, pos);
    Object.assign(hole.style, pos); // 어둡게 하는 층의 구멍도 같은 자리에

    // 결과 미리보기 (실제로 저장될 크기 그대로)
    drawThumbInto(previewEl, item.source, r, size.w, size.h);
    previewCap.textContent = `결과 미리보기 · ${sizeLabel(size)}px`;

    // 확대 슬라이더: 1(전체) ~ maxZoom. max를 먼저 바꿔야 value가 잘리지 않아요
    zoomInput.max = String(c.maxZoom);
    zoomInput.value = String(c.zoom());
    zoomInput.disabled = c.maxZoom < 1.01;
    zoomOut.textContent = `${Math.round(c.zoom() * 100)}%`;

    infoEl.textContent = `원본에서 가져오는 영역: ${Math.round(r.w)} × ${Math.round(r.h)}px `
      + `(왼쪽 ${Math.round(r.x)}, 위 ${Math.round(r.y)})`;
    warnEl.hidden = !c.tooSmall;
    resetBtn.disabled = !c.isEdited();

    cur.onChange(size); // 목록의 작은 미리보기도 같이 갱신
  }

  return { open };
}
