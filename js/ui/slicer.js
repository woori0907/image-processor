/**
 * ui/slicer.js — "이미지 자르기" 탭의 편집 화면
 *
 * 압축 탭은 "여러 장을 넣으면 알아서 처리"하는 방식이라 workspace.js를 쓰지만,
 * 자르기는 "한 장을 열어 사람이 선을 긋는" 편집 방식이라 흐름이 달라서 따로 만들었어요.
 *
 * ── 화면 구성 ──
 *   왼쪽: 이미지 + 그 위에 겹친 레이어 3개
 *         · .sl-pieces-layer  조각 번호·버튼 표시 (클릭을 통과시킴)
 *         · .sl-lines         자르는 선 (끌기·키보드 조작)
 *         · .sl-guide         마우스 위치를 따라다니는 점선 (여기를 누르면 선이 생긴다는 안내)
 *   오른쪽: 조각 목록(버튼 표시 체크, 선 위치 숫자 입력) + 저장 버튼
 *
 * ── 좌표 계산의 핵심 ──
 * 화면에는 이미지가 줄어들어 보이지만, 선 위치는 항상 "원본 px"로 저장해요.
 *   · 화면 → 원본:  (클릭한 y - 이미지 윗변) / 화면에 보이는 높이 × 원본 높이
 *   · 원본 → 화면:  CSS top을 %로 (y / 원본 높이 × 100%)
 * %를 쓰면 창 크기가 바뀌어도 다시 계산할 필요가 없어요.
 *
 * ── 끌기: 시작점 + 이동량 ──
 * 선을 끌 때 "포인터 위치 = 선 위치"로 두면, 선의 잡는 영역(위아래 8px)을 살짝 비껴 잡았을 때
 * 선이 포인터 쪽으로 툭 튀어요. 그래서 "잡았을 때의 선 위치 + 포인터가 움직인 거리"로 계산해요.
 * Shift를 누르고 있으면 움직인 거리를 10px 단위로 반올림해요. (키보드 Shift+↑↓와 같은 10px 이동)
 *
 * ── 확대 보기 ──
 * 기본은 "맞춤"(가로 폭에 맞춰 축소, 페이지가 스크롤). 확대하면 이미지 틀(.sl-frame)의 가로를
 * "원본 px × 배율"로 키우고, 이미지 영역(.sl-stage)이 화면 높이만큼의 스크롤 상자가 돼요.
 * 선·조각 위치는 원래 %로 그리기 때문에 확대해도 다시 계산할 게 없어요.
 *
 * ── 상태 → render() ──
 * 선을 추가·이동·삭제하면 데이터(cuts.js)만 고치고 render()를 불러 화면 전체를 다시 그려요.
 * (preview.js와 같은 패턴)
 *
 * @param {HTMLElement} root 탭 패널 요소
 * @returns {{addFiles: (files: FileList|File[]) => void}}
 *   workspace.js와 같은 이름의 addFiles를 돌려줘서, main.js가 탭 종류를 몰라도
 *   "아무 데나 놓기·붙여넣기"를 똑같이 연결할 수 있어요.
 */
import { initDropzone } from './dropzone.js';
import { createSettings } from './settings.js';
import { createCuts } from '../cuts.js';
import { loadBitmap } from '../image/canvas.js';
import { slicePieces } from '../image/slice.js';
import { makeZip } from '../zip.js';
import { formatBytes, triggerDownload } from '../utils.js';

export function createSlicer(root) {
  const $ = (sel) => root.querySelector(sel);
  const settings = createSettings(root, 'slice-format'); // 형식·품질 패널은 다른 탭과 같은 코드
  const drop = $('.drop');
  const editor = $('.slicer');
  const stage = $('.sl-stage');
  const frame = $('.sl-frame');
  const img = $('.sl-img');
  const piecesLayer = $('.sl-pieces-layer');
  const linesLayer = $('.sl-lines');
  const guide = $('.sl-guide');
  const guideLabel = guide.querySelector('span');
  const nameEl = $('.sl-name');
  const sizeEl = $('.sl-size');
  const listEl = $('.sl-list');
  const statusEl = $('.sl-status');
  const saveBtn = $('[data-action="save"]');
  const resetBtn = $('[data-action="reset"]');
  const closeBtn = $('[data-action="close"]');
  const zoomValue = $('.sl-zoom-value');
  const zoomInBtn = $('[data-action="zoom-in"]');
  const zoomOutBtn = $('[data-action="zoom-out"]');
  const zoomFitBtn = $('[data-action="zoom-fit"]');
  const zoom100Btn = $('[data-action="zoom-100"]');

  /** 지금 열린 이미지 { file, url, width, height, cuts }. 없으면 null */
  let doc = null;
  /** 저장 중이면 true (그동안 다른 조작을 막아요) */
  let busy = false;
  /**
   * 끄는 중인 선 정보. 안 끌면 null
   *   { index, fromY: 잡았을 때 선 위치, startY: 잡았을 때 포인터의 원본 y,
   *     clientY: 마지막 포인터 화면 y, shift: Shift를 누르고 있는지, raf: 자동 스크롤 번호 }
   */
  let drag = null;
  /** 확대 배율 (원본 px 대비). 0이면 "맞춤" */
  let zoom = 0;
  /** 화면에 있는 선 요소들. 매번 새로 만들지 않고 재사용해요 (아래 renderLines 설명 참고) */
  const lineEls = [];

  initDropzone(root, addFiles);

  // ─────────────────────────────────────────────
  // 열기 · 닫기
  // ─────────────────────────────────────────────

  async function addFiles(files) {
    const file = [...files].find((f) => f.type.startsWith('image/')); // 한 번에 한 장만
    if (!file || busy) return;
    if (doc && doc.cuts.list().length && !confirm('지금 자르던 이미지를 닫고 새 이미지를 열까요?')) return;

    // 원본 크기(px)를 정확히 알기 위해 한 번 풀어 봐요.
    // (휴대폰 사진은 EXIF 회전 때문에 파일 속 크기와 실제 보이는 크기가 다를 수 있어요)
    let width, height;
    try {
      const bmp = await loadBitmap(file);
      ({ width, height } = bmp);
      bmp.close?.();
    } catch (_) {
      alert('이미지를 열 수 없어요. JPG · PNG · WebP 파일인지 확인해 주세요.');
      return;
    }

    close();
    doc = { file, url: URL.createObjectURL(file), width, height, cuts: createCuts(height) };
    img.src = doc.url;
    // 작은 이미지를 억지로 늘려 보여주지 않게, 원본 가로보다 넓어지지 않도록
    frame.style.maxWidth = `${width}px`;
    nameEl.textContent = file.name;
    sizeEl.textContent = `${width} × ${height}px · ${formatBytes(file.size)}`;
    drop.hidden = true;
    editor.hidden = false;
    setStatus('');
    zoom = 0; // 새 이미지는 항상 "맞춤"으로 시작
    applyZoomLayout();
    render();
  }

  function close() {
    if (doc) URL.revokeObjectURL(doc.url); // 다 쓴 임시 주소 해제 (store.js와 같은 이유)
    doc = null;
    stopDrag();
    zoom = 0;
    applyZoomLayout();
    img.removeAttribute('src');
    lineEls.splice(0).forEach((el) => el.remove());
    piecesLayer.replaceChildren();
    listEl.replaceChildren();
    editor.hidden = true;
    drop.hidden = false;
  }

  // ─────────────────────────────────────────────
  // 좌표 도우미
  // ─────────────────────────────────────────────

  /** 마우스/터치 이벤트 → 원본 이미지 기준 y(px) */
  function yFromEvent(e) {
    const r = frame.getBoundingClientRect();
    const y = Math.round(((e.clientY - r.top) / r.height) * doc.height);
    return Math.min(doc.height, Math.max(0, y));
  }

  /** 화면 y → 원본 y (반올림·범위 제한 없이. 끌기에서 "움직인 거리"를 잴 때 씀) */
  function rawY(clientY) {
    const r = frame.getBoundingClientRect();
    return ((clientY - r.top) / r.height) * doc.height;
  }

  /** 원본 y(px) → CSS top 값(%) */
  const pct = (y) => `${(y / doc.height) * 100}%`;

  // ─────────────────────────────────────────────
  // 이미지 위 조작: 클릭하면 선 추가, 마우스를 따라 안내선 표시
  // ─────────────────────────────────────────────

  frame.addEventListener('click', (e) => {
    if (!doc || busy || e.target.closest('.sl-cut')) return; // 선 자체를 누른 건 무시
    const k = doc.cuts.add(yFromEvent(e));
    if (k < 0) return;
    render();
    // 방금 만든 선에 포커스 → 바로 ↑↓ 키로 미세 조정 가능
    lineEls[k].focus({ preventScroll: true });
  });

  frame.addEventListener('pointermove', (e) => {
    if (!doc || drag || e.target.closest('.sl-cut')) {
      guide.hidden = true;
      return;
    }
    const y = yFromEvent(e);
    guide.style.top = pct(y);
    guideLabel.textContent = `${y}px`;
    guide.hidden = false;
  });
  frame.addEventListener('pointerleave', () => { guide.hidden = true; });

  // ─────────────────────────────────────────────
  // 자르는 선 하나 만들기 (끌기 · 키보드 · 삭제)
  // ─────────────────────────────────────────────

  function makeLine() {
    const el = document.createElement('div');
    el.className = 'sl-cut';
    el.tabIndex = 0; // Tab 키로 선택할 수 있게
    // 스크린 리더에게 "위아래로 움직이는 조절기"라고 알려줘요 (aria-valuenow는 renderLines에서)
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-orientation', 'vertical');
    el.innerHTML = '<span class="sl-cut-tag"><output></output><button type="button" class="sl-del" aria-label="이 선 삭제">×</button></span>';

    const index = () => Number(el.dataset.index);

    // 끌기: setPointerCapture를 하면 마우스가 선 밖으로 빠르게 벗어나도 계속 이 선이 이벤트를 받아요
    el.addEventListener('pointerdown', (e) => {
      if (busy || e.target.closest('.sl-del')) return;
      e.preventDefault(); // 글자 선택·이미지 끌기 같은 브라우저 기본 동작 막기
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      const k = index();
      drag = {
        index: k,
        fromY: doc.cuts.list()[k],
        startY: rawY(e.clientY),
        clientY: e.clientY,
        shift: e.shiftKey,
        raf: requestAnimationFrame(autoScroll),
      };
      el.classList.add('dragging');
      guide.hidden = true;
      render();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.clientY = e.clientY;
      drag.shift = e.shiftKey;
      applyDrag();
    });
    const endDrag = () => {
      stopDrag();
      el.classList.remove('dragging');
      render(); // 끄는 동안만 보이던 이동량(+30) 표시 지우기
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    // 끌기를 마친 뒤 생기는 click이 이미지(frame)까지 올라가 선을 또 만들지 않게
    el.addEventListener('click', (e) => e.stopPropagation());

    // 키보드: ↑↓ 1px, Shift+↑↓ 10px, Delete/Backspace 삭제
    el.addEventListener('keydown', (e) => {
      if (busy) return;
      const step = e.shiftKey ? 10 : 1;
      const k = index();
      const y = doc.cuts.list()[k];
      if (e.key === 'ArrowUp') doc.cuts.move(k, y - step);
      else if (e.key === 'ArrowDown') doc.cuts.move(k, y + step);
      else if (e.key === 'Delete' || e.key === 'Backspace') doc.cuts.remove(k);
      else return;
      e.preventDefault(); // 화살표로 페이지가 스크롤되지 않게
      render();
    });

    el.querySelector('.sl-del').addEventListener('click', () => {
      if (busy) return;
      doc.cuts.remove(index());
      render();
    });

    linesLayer.append(el);
    return el;
  }

  /** 끄는 중인 선을 마지막 포인터 위치에 맞춰 옮겨요 (포인터가 멈춰도 스크롤되면 다시 불려요) */
  function applyDrag() {
    const dy = rawY(drag.clientY) - drag.startY; // 잡은 뒤로 움직인 거리 (원본 px)
    // Shift: 10px 단위로 반올림 → 30, 40, 50 … 만큼만 움직여요
    const step = drag.shift ? Math.round(dy / 10) * 10 : Math.round(dy);
    doc.cuts.move(drag.index, drag.fromY + step); // 이웃 선·이미지 끝을 넘으면 cuts.js가 막아줘요
    render();
  }

  function stopDrag() {
    if (drag) cancelAnimationFrame(drag.raf);
    drag = null;
  }

  // 끄는 도중에 Shift만 누르거나 떼도 바로 반영 (포인터를 안 움직여도)
  ['keydown', 'keyup'].forEach((type) => window.addEventListener(type, (e) => {
    if (!drag || e.key !== 'Shift' || drag.shift === e.shiftKey) return;
    drag.shift = e.shiftKey;
    applyDrag();
  }));

  /**
   * 저절로 스크롤: 끄는 동안 포인터가 보이는 영역의 위·아래 끝 근처면 그쪽으로 스크롤해요.
   * 확대 중이면 이미지 영역(stage)을, 맞춤이면 페이지(window)를 스크롤해요.
   * pointermove는 포인터가 "움직일 때만" 와서, 가만히 대고 있어도 계속 스크롤되려면
   * requestAnimationFrame으로 매 화면 갱신마다 직접 확인해야 해요. (region-picker.js와 같은 방법)
   */
  function autoScroll() {
    if (!drag) return;
    const EDGE = 40;
    const box = zoom ? stage.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    let dy = 0;
    if (drag.clientY < box.top + EDGE) dy = drag.clientY - (box.top + EDGE);
    else if (drag.clientY > box.bottom - EDGE) dy = drag.clientY - (box.bottom - EDGE);
    if (dy) {
      dy = Math.max(-24, Math.min(24, dy / 2)); // 끝에 가까울수록 빠르게, 최대 24px씩
      const before = zoom ? stage.scrollTop : window.scrollY;
      if (zoom) stage.scrollTop += dy;
      else window.scrollBy(0, dy);
      if ((zoom ? stage.scrollTop : window.scrollY) !== before) applyDrag();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  // ─────────────────────────────────────────────
  // 확대 보기
  // ─────────────────────────────────────────────

  /** 버튼으로 오갈 배율들 (원본 px 대비) */
  const ZOOM_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8];
  const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

  /** "맞춤"일 때의 배율: 이미지 영역 가로에 맞추되, 원본보다 크게 늘리지는 않아요 */
  function fitScale() {
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.min(1, availW / doc.width);
  }

  const currentScale = () => zoom || fitScale();

  /** zoom 값에 맞게 틀 크기·클래스만 바꿔요 (스크롤 위치는 setZoom이 맞춰요) */
  function applyZoomLayout() {
    editor.classList.toggle('zoomed', zoom > 0);
    // 200% 이상이면 픽셀을 흐리게 섞지 않고 네모난 그대로 → 어디가 경계인지 또렷해요
    editor.classList.toggle('pixelated', zoom >= 2);
    if (!doc) {
      frame.style.width = '';
      return;
    }
    frame.style.width = zoom ? `${Math.round(doc.width * zoom)}px` : '';
    frame.style.maxWidth = zoom ? 'none' : `${doc.width}px`;
  }

  /**
   * 배율을 바꿔요. 바꾼 뒤에도 (clientX, clientY) 아래에 있던 이미지 지점이 그 자리에 머물도록
   * 스크롤을 맞춰요. 위치를 안 주면 지금 보이는 영역의 가운데를 기준으로 해요.
   * @param {number} z 원하는 배율. 맞춤 배율 이하면 "맞춤"(0)이 돼요
   */
  function setZoom(z, clientX, clientY) {
    if (!doc) return;
    const wasZoomed = zoom > 0;

    // ① 기준점: 화면 위치 → 원본 좌표 (바꾸기 전 배치로 계산)
    if (clientX === undefined) {
      const sr = stage.getBoundingClientRect();
      clientX = sr.left + stage.clientWidth / 2;
      // 맞춤일 때는 이미지 영역이 화면보다 길 수 있어서, 화면에 실제로 보이는 부분의 가운데로
      clientY = (Math.max(sr.top, 0) + Math.min(sr.bottom, window.innerHeight)) / 2;
    }
    const fr = frame.getBoundingClientRect();
    const sx = ((clientX - fr.left) / fr.width) * doc.width;
    const sy = ((clientY - fr.top) / fr.height) * doc.height;

    // ② 배율 적용
    zoom = z > fitScale() + 1e-6 ? Math.min(z, MAX_ZOOM) : 0;
    applyZoomLayout();

    // ③ 기준점이 다시 그 화면 위치에 오도록 스크롤
    if (zoom) {
      if (!wasZoomed) {
        // 맞춤 → 확대: 이미지 영역이 화면 높이만큼의 스크롤 상자로 바뀌니, 페이지를 편집 화면 맨 위로
        window.scrollBy(0, editor.getBoundingClientRect().top - 16);
      }
      // 기준점이 스크롤 상자 밖이면 상자 안쪽으로 끌어와요
      const sr = stage.getBoundingClientRect();
      clientX = Math.min(Math.max(clientX, sr.left), sr.left + stage.clientWidth);
      clientY = Math.min(Math.max(clientY, sr.top), sr.top + stage.clientHeight);
      const nr = frame.getBoundingClientRect();
      stage.scrollLeft += nr.left + (sx / doc.width) * nr.width - clientX;
      stage.scrollTop += nr.top + (sy / doc.height) * nr.height - clientY;
    } else {
      const nr = frame.getBoundingClientRect();
      window.scrollBy(0, nr.top + (sy / doc.height) * nr.height - clientY);
    }
    updateZoomUI();
    updateViewOffsets();
  }

  /** 지금 배율보다 한 단계 크게/작게 */
  function stepZoom(dir) {
    const s = currentScale();
    const next = dir > 0
      ? ZOOM_STEPS.find((z) => z > s * 1.01)
      : [...ZOOM_STEPS].reverse().find((z) => z < s * 0.99);
    setZoom(next ?? (dir > 0 ? MAX_ZOOM : 0));
  }

  function updateZoomUI() {
    if (!doc) return;
    const s = currentScale();
    zoomValue.textContent = zoom ? `${Math.round(zoom * 100)}%` : `맞춤 ${Math.round(s * 100)}%`;
    zoomOutBtn.disabled = !zoom;
    zoomInBtn.disabled = zoom >= MAX_ZOOM;
    zoomFitBtn.disabled = !zoom;
    zoom100Btn.disabled = Math.abs(s - 1) < 1e-6;
  }

  /**
   * 선 옆 숫자표(오른쪽)와 조각 번호(왼쪽)는 원래 이미지 끝에 붙어 있어요.
   * 확대해서 가로로 스크롤하면 화면 밖으로 나가 버리니, 보이는 영역 끝에 붙어 있도록
   * "틀이 보이는 영역 밖으로 얼마나 삐져나갔는지"를 CSS 변수로 알려줘요. (style.css에서 사용)
   */
  function updateViewOffsets() {
    const sr = stage.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const visibleRight = sr.left + stage.clientLeft + stage.clientWidth; // 세로 스크롤바 제외
    frame.style.setProperty('--view-left', `${Math.max(0, sr.left - fr.left)}px`);
    frame.style.setProperty('--view-right', `${Math.max(0, fr.right - visibleRight)}px`);
  }

  zoomInBtn.addEventListener('click', () => stepZoom(1));
  zoomOutBtn.addEventListener('click', () => stepZoom(-1));
  zoomFitBtn.addEventListener('click', () => setZoom(0));
  zoom100Btn.addEventListener('click', () => setZoom(1));
  stage.addEventListener('scroll', updateViewOffsets);
  // 창 크기가 바뀌면 "맞춤" 배율도 달라져요
  new ResizeObserver(() => {
    if (!doc) return;
    if (zoom && zoom <= fitScale()) setZoom(0); // 창이 넓어져서 확대가 의미 없어졌으면 맞춤으로
    updateZoomUI();
    updateViewOffsets();
  }).observe(stage);

  // ⌘(또는 Ctrl) + 휠 / 트랙패드 핀치: 커서 위치를 중심으로 확대·축소
  // (핀치는 브라우저가 ctrlKey가 붙은 wheel 이벤트로 보내줘요)
  // passive: false → preventDefault()로 브라우저 자체 화면 확대를 막겠다고 미리 알려요
  stage.addEventListener('wheel', (e) => {
    if (!doc || !(e.ctrlKey || e.metaKey)) return; // 그냥 휠은 평소처럼 스크롤
    e.preventDefault();
    setZoom(currentScale() * Math.exp(-e.deltaY * 0.003), e.clientX, e.clientY);
  }, { passive: false });

  // ─────────────────────────────────────────────
  // 오른쪽 목록 조작 (이벤트 위임: 목록 전체에 한 번만 등록)
  // 목록은 render() 때마다 새로 만들어져서, 줄마다 이벤트를 다는 대신
  // 부모(listEl)에서 "어떤 요소에서 일어났는지(data-action)"를 보고 처리해요.
  // ─────────────────────────────────────────────

  listEl.addEventListener('change', (e) => {
    const t = e.target;
    const i = Number(t.dataset.index);
    if (t.dataset.action === 'button') doc.cuts.setButton(i, t.checked);
    if (t.dataset.action === 'cut-y') {
      const y = Number(t.value);
      if (Number.isFinite(y)) doc.cuts.move(i, y); // 범위를 벗어나면 move가 알아서 맞춰줘요
    }
    render();
  });

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="cut-del"]');
    if (!btn || busy) return;
    doc.cuts.remove(Number(btn.dataset.index));
    render();
  });

  resetBtn.addEventListener('click', () => {
    if (!doc || !doc.cuts.list().length) return;
    if (!confirm('자르는 선을 모두 지울까요?')) return;
    doc.cuts.clear();
    render();
  });

  closeBtn.addEventListener('click', () => {
    if (doc?.cuts.list().length && !confirm('지금 자르던 이미지를 닫을까요?')) return;
    close();
  });

  saveBtn.addEventListener('click', save);

  // ─────────────────────────────────────────────
  // 저장: 조각 만들기 → ZIP → 다운로드
  // ─────────────────────────────────────────────

  async function save() {
    if (!doc || busy) return;
    busy = true;
    render();
    try {
      const s = settings.read(doc.file);
      const outputs = await slicePieces(doc.file, doc.cuts.pieces(), s, (done, total) => {
        setStatus(`자르는 중… ${done} / ${total}`);
      });
      setStatus('ZIP으로 묶는 중…');
      const zip = await makeZip(outputs);
      const url = URL.createObjectURL(zip);
      const base = doc.file.name.replace(/\.[^.]+$/, '') || 'image';
      triggerDownload(url, `${base}_slices.zip`);
      // 다운로드가 시작될 시간을 준 뒤 임시 주소 해제
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(`파일 ${outputs.length}개를 ZIP으로 저장했어요 (${formatBytes(zip.size)})`);
    } catch (err) {
      console.error(err);
      setStatus(err.userMessage || '저장하지 못했어요. 다시 시도해 주세요.', true);
    } finally {
      busy = false;
      render();
    }
  }

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  // ─────────────────────────────────────────────
  // 그리기
  // ─────────────────────────────────────────────

  function render() {
    if (!doc) return;
    const cuts = doc.cuts.list();
    const pieces = doc.cuts.pieces();
    renderLines(cuts);
    renderPieceLayer(pieces);
    renderList(cuts, pieces);
    updateZoomUI();
    saveBtn.disabled = busy || cuts.length === 0;
    resetBtn.disabled = busy || cuts.length === 0;
    closeBtn.disabled = busy;
    editor.classList.toggle('busy', busy);
  }

  /**
   * 선 요소는 지웠다 새로 만들지 않고 "개수만 맞춘 뒤 위치를 고쳐" 재사용해요.
   * 끄는 도중에 요소를 새로 만들면 setPointerCapture와 포커스가 사라져서
   * 끌기가 끊기거든요. 선 순서는 절대 바뀌지 않으니(cuts.js의 move) 순번으로 짝지어도 안전해요.
   */
  function renderLines(cuts) {
    while (lineEls.length < cuts.length) lineEls.push(makeLine());
    while (lineEls.length > cuts.length) lineEls.pop().remove();
    cuts.forEach((y, k) => {
      const el = lineEls[k];
      el.dataset.index = String(k);
      el.style.top = pct(y);
      // 끄는 중이면 잡은 뒤로 얼마나 움직였는지도 보여줘요: "1230px (+30)"
      let label = `${y}px`;
      if (drag?.index === k && y !== drag.fromY) label += ` (${y > drag.fromY ? '+' : ''}${y - drag.fromY})`;
      el.querySelector('output').textContent = label;
      el.setAttribute('aria-label', `자르는 선 ${k + 1}`);
      el.setAttribute('aria-valuenow', String(y));
      el.setAttribute('aria-valuemin', '1');
      el.setAttribute('aria-valuemax', String(doc.height - 1));
    });
  }

  /** 이미지 위에 조각 번호와 버튼 영역 표시 (클릭은 통과 — CSS의 pointer-events: none) */
  function renderPieceLayer(pieces) {
    piecesLayer.replaceChildren(...pieces.map((p) => {
      const box = document.createElement('div');
      box.className = `sl-piece${p.isButton ? ' is-btn' : ''}`;
      box.style.top = pct(p.top);
      box.style.height = pct(p.height);
      const no = document.createElement('span');
      no.className = 'sl-piece-no';
      no.textContent = `${pad(p.index + 1, pieces.length)}${p.isButton ? ' · 버튼' : ''}`;
      box.append(no);
      return box;
    }));
  }

  /**
   * 오른쪽 목록: 조각 → 선 → 조각 → 선 … 순서로 번갈아 보여줘요.
   * 목록을 통째로 다시 만들면 입력 중이던 칸의 포커스가 사라지니,
   * data-key로 "어느 칸이었는지" 기억했다가 다시 포커스를 돌려줘요.
   */
  function renderList(cuts, pieces) {
    const active = listEl.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const rows = [];

    pieces.forEach((p, i) => {
      // 조각 줄
      const li = document.createElement('li');
      li.className = `sl-row${p.isButton ? ' is-btn' : ''}`;
      li.append(
        text('span', 'sl-no', pad(i + 1, pieces.length)),
        text('span', 'sl-range', `${p.top} – ${p.bottom}px · 높이 ${p.height}`),
      );
      const label = document.createElement('label');
      label.className = 'pv-check';
      const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: p.isButton, disabled: busy });
      Object.assign(check.dataset, { action: 'button', index: String(i), key: `btn-${i}` });
      label.append(check, ' 버튼');
      li.append(label);
      rows.push(li);

      // 선 줄 (마지막 조각 뒤에는 선이 없음)
      if (i < cuts.length) {
        const cut = document.createElement('li');
        cut.className = 'sl-row sl-cut-row';
        const input = Object.assign(document.createElement('input'), {
          type: 'number', min: 1, max: doc.height - 1, value: cuts[i], disabled: busy,
        });
        input.setAttribute('aria-label', `자르는 선 ${i + 1} 위치(px)`);
        Object.assign(input.dataset, { action: 'cut-y', index: String(i), key: `cut-${i}` });
        const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost sl-row-del', textContent: '삭제', disabled: busy });
        del.setAttribute('aria-label', `자르는 선 ${i + 1} 삭제`);
        Object.assign(del.dataset, { action: 'cut-del', index: String(i) });
        cut.append(text('span', 'sl-cut-icon', '✂'), input, text('span', 'sl-unit', 'px'), del);
        rows.push(cut);
      }
    });

    listEl.replaceChildren(...rows);
    if (active) listEl.querySelector(`[data-key="${active}"]`)?.focus();
  }

  return { addFiles };
}

// ─────────────────────────────────────────────
// 작은 도우미 (이 파일에서만 씀)
// ─────────────────────────────────────────────

/** 번호 앞에 0 채우기: pad(3, 12) → '03'. 파일 이름(slice.js)과 같은 규칙 */
function pad(n, total) {
  return String(n).padStart(Math.max(2, String(total).length), '0');
}

/** 글자만 든 요소 만들기 (textContent를 써서 안전하게) */
function text(tag, className, content) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
