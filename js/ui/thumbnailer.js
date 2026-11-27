/**
 * ui/thumbnailer.js — "썸네일 만들기" 탭
 *
 * 흐름:
 *   이미지 넣기 → 크기마다 가운데 기준으로 자동으로 잘라 미리보기
 *   → (긴 이미지라면) [부분 선택]으로 썸네일에 쓸 부분만 고르기 (region-picker.js)
 *   → (필요하면) 미리보기를 눌러 영역 조정 창(cropper.js)에서 위치·크기 조정
 *   → 전체 ZIP 다운로드
 *
 * ── 두 단계로 자르는 이유 ──
 *   ① 사용할 부분(region): 850×6000 상세페이지에서 배너 부분 850×700만 고르기 (비율 자유)
 *   ② 썸네일 영역(crop)  : 그 850×700 안에서 233×158 비율로 가져올 영역 (비율 고정)
 * ①을 고르면 그 부분을 잘라 "작업용 이미지"를 새로 만들고, ②는 작업용 이미지만 보고 동작해요.
 * 그래서 cropper.js·crop.js는 ①이 있는지 전혀 몰라도 돼요.
 *
 * 압축 탭처럼 "넣으면 알아서 처리"하는 부분과, 자르기 탭처럼 "사람이 직접 조정"하는 부분이
 * 섞여 있어서 workspace.js를 쓰지 않고 따로 만들었어요. 대신 같은 규칙은 그대로 지켜요.
 *   · 영역 데이터 규칙  → crop.js            (화면·이미지 처리 모두 모름)
 *   · 실제로 자르기     → image/thumbnail.js (화면 모름)
 *   · 크기 목록 편집    → ui/sizes.js
 *   · 영역 조정 창      → ui/cropper.js
 *   · 사용할 부분 선택  → ui/region-picker.js + region.js
 *   · 형식·품질 설정, 드롭 영역, ZIP은 다른 탭과 같은 코드를 재사용
 *
 * ── 이미지 한 장(item)의 데이터 ──
 *   {
 *     id, file,
 *     orig:   { source, url, width, height }  원본 그대로 (부분 선택 창에서 씀)
 *     region: null | { x, y, w, h }           고른 부분 (null = 원본 전체)
 *     ── 작업용 이미지: 부분을 골랐으면 그 부분, 아니면 원본과 같아요 ──
 *     source, 디코딩해 둔 픽셀(ImageBitmap 또는 canvas). 미리보기마다 다시 풀지 않으려고 갖고 있어요
 *     url,    <img>에 쓸 임시 주소 (영역 조정 창에서 보여줄 때)
 *     width, height,
 *     crops,  Map<'233x158', crop.js 객체>  크기마다 따로 영역을 기억해요
 *   }
 *
 * @param {HTMLElement} root 탭 패널 요소
 * @returns {{addFiles: (files: FileList|File[]) => void}} 다른 탭과 같은 모양 (main.js의 덕 타이핑)
 */
import { initDropzone } from './dropzone.js';
import { createSettings } from './settings.js';
import { createSizeEditor, sizeKey, sizeLabel } from './sizes.js';
import { createCropper } from './cropper.js';
import { createRegionPicker } from './region-picker.js';
import { createCrop } from '../crop.js';
import { loadBitmap, toBlob } from '../image/canvas.js';
import { cropRegion, drawThumbInto, makeThumbnails } from '../image/thumbnail.js';
import { makeZip } from '../zip.js';
import { formatBytes, triggerDownload } from '../utils.js';

/**
 * 저장 품질 (0~1). 썸네일 탭에는 품질 선택이 없고 항상 이 값으로 저장해요.
 * 233×158처럼 작은 이미지는 고화질로 저장해도 한 장에 10~20KB 정도라 품질을 낮춰 아낄 게 거의 없고,
 * 작게 줄인 글자는 압축 얼룩이 특히 잘 보여서 높게 잡았어요. (PNG는 무손실이라 이 값을 안 써요)
 */
const QUALITY = 0.95;

export function createThumbnailer(root) {
  const $ = (sel) => root.querySelector(sel);
  const settings = createSettings(root, 'image-tools:thumb:format');
  const sizes = createSizeEditor($('[data-setting="sizes"]'), 'image-tools:thumb:sizes', renderAll);
  const cropper = createCropper(document.getElementById('cropper'));
  const regionPicker = createRegionPicker(document.getElementById('regionPicker'));
  const listEl = $('.th-list');
  const barEl = $('.th-bar');
  const countEl = $('.th-count');
  const statusEl = $('.th-status');
  const zipBtn = $('[data-action="zip"]');
  const clearBtn = $('[data-action="clear"]');

  /** 넣은 순서대로 */
  const items = [];
  let nextId = 1;
  /** ZIP을 만드는 중이면 true (그동안 삭제를 막아요) */
  let busy = false;

  initDropzone(root, addFiles);

  // ─────────────────────────────────────────────
  // 추가 · 삭제
  // ─────────────────────────────────────────────

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    let failed = 0;
    for (const file of files) {
      let bitmap;
      try {
        bitmap = await loadBitmap(file);
      } catch (_) {
        failed++;
        continue;
      }
      const orig = { source: bitmap, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
      // 처음엔 작업용 이미지 = 원본 (같은 픽셀·주소를 함께 써요)
      const item = { id: nextId++, file, orig, region: null, ...orig, crops: new Map() };
      item.el = createCard(item);
      items.push(item);
      listEl.append(item.el);
      renderItem(item);
    }
    if (failed) setStatus(`${failed}개 파일은 열 수 없어서 건너뛰었어요.`, true);
    else if (!busy) setStatus(''); // 저장 중이면 진행 상황 문구를 지우지 않아요
    refreshBar();
  }

  function removeItem(item) {
    items.splice(items.indexOf(item), 1);
    item.el.remove();
    freeWork(item);
    URL.revokeObjectURL(item.orig.url); // 다 쓴 임시 주소 해제
    item.orig.source.close?.();         // ImageBitmap이면 픽셀 메모리 해제 (<img>면 close가 없어서 건너뜀)
  }

  // ─────────────────────────────────────────────
  // 사용할 부분 (긴 이미지용)
  // ─────────────────────────────────────────────

  /** 세로로 긴 이미지인지 (세로가 가로의 1.5배 넘으면). 상세페이지 같은 이미지를 알아보려고 */
  const isLong = ({ width, height }) => height > width * 1.5;

  /**
   * 부분 선택 창에서 [이 부분 사용]을 누르면 불려요.
   * 고른 부분을 잘라 작업용 이미지를 새로 만들고, 썸네일 영역은 그 안에서 처음부터 다시 맞춰요.
   */
  async function applyRegion(item, rect) {
    const { orig } = item;
    const full = rect.x === 0 && rect.y === 0 && rect.w === orig.width && rect.h === orig.height;
    freeWork(item);

    if (full) {
      // 전체를 골랐으면 원본을 그대로 작업용으로
      Object.assign(item, { region: null, source: orig.source, url: orig.url, width: orig.width, height: orig.height });
    } else {
      // 원래 해상도 그대로 잘라 둬요 (썸네일로 줄이는 건 나중에 한 번만 — 화질 손해 없음)
      const canvas = cropRegion(orig.source, rect);
      Object.assign(item, { region: rect, source: canvas, url: null, width: canvas.width, height: canvas.height });
    }
    item.crops.clear(); // 이미지가 바뀌었으니 크기별 영역도 새로
    renderMeta(item);
    renderItem(item);

    if (!full) {
      // 영역 조정 창의 <img>에 보여줄 주소. PNG(무손실)로 만들어요.
      // 그 사이 다른 부분을 또 골랐거나 삭제됐으면 이 주소는 버려요.
      const source = item.source;
      const blob = await toBlob(source, 'image/png');
      if (item.source === source && items.includes(item)) item.url = URL.createObjectURL(blob);
    }
  }

  /** 원본과 다른 작업용 이미지(잘라 둔 부분)를 갖고 있으면 메모리를 돌려줘요 */
  function freeWork(item) {
    if (item.source !== item.orig.source) item.source.width = 0; // canvas 픽셀 메모리 해제
    if (item.url && item.url !== item.orig.url) URL.revokeObjectURL(item.url);
  }
  // ─────────────────────────────────────────────
  // 크기별 영역 데이터
  // ─────────────────────────────────────────────

  /**
   * item의 size 크기용 영역을 꺼내요. 처음이면 가운데 기준으로 새로 만들어요.
   * (세로로 긴 이미지는 대표 배너가 보통 맨 위에 있어서 맨 위 기준)
   * 크기 목록에서 지운 크기의 영역도 지우지 않고 남겨 둬서, 다시 추가하면 조정한 위치가 돌아와요.
   */
  function cropFor(item, size) {
    const key = sizeKey(size);
    if (!item.crops.has(key)) {
      const align = isLong(item) ? 'top' : 'center';
      item.crops.set(key, createCrop(item.width, item.height, size.w, size.h, { align }));
    }
    return item.crops.get(key);
  }

  // ─────────────────────────────────────────────
  // 그리기
  // ─────────────────────────────────────────────

  /** 이미지 한 장의 카드 뼈대: [파일 이름 · 크기  부분 선택 · 삭제] + 안내 + 썸네일 칸들(.th-outs) */
  function createCard(item) {
    const li = document.createElement('li');
    li.className = 'th-item';
    li.dataset.id = String(item.id);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.append(text('div', 'name', item.file.name), text('div', 'detail', ''));

    const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: '부분 선택' });
    pick.dataset.action = 'region';
    pick.setAttribute('aria-label', `${item.file.name}에서 썸네일로 쓸 부분 선택`);
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost', textContent: '삭제' });
    del.dataset.action = 'remove';
    del.setAttribute('aria-label', `${item.file.name} 삭제`);

    const head = document.createElement('div');
    head.className = 'th-head';
    head.append(meta, pick, del);

    const hint = text('p', 'th-hint', '');
    const outs = document.createElement('div');
    outs.className = 'th-outs';

    li.append(head, hint, outs);
    renderMeta(item, li);
    return li;
  }

  /**
   * 카드 위쪽 설명: 원본 크기 · 용량 (+ 고른 부분), 긴 이미지 안내
   * @param {HTMLElement} [el] 카드 요소 (처음 만들 때는 아직 item.el이 없어서 따로 받아요)
   */
  function renderMeta(item, el = item.el) {
    const { orig, region } = item;
    let detail = `${orig.width} × ${orig.height}px · ${formatBytes(item.file.size)}`;
    if (region) detail += ` · 사용할 부분 ${region.w} × ${region.h}px (위 ${region.y}부터)`;
    el.querySelector('.detail').textContent = detail;

    // 긴 이미지인데 아직 부분을 안 골랐으면 안내하고, [부분 선택] 버튼을 강조해요
    const needsPick = isLong(orig) && !region;
    const hint = el.querySelector('.th-hint');
    hint.textContent = needsPick
      ? '세로로 긴 이미지예요. 지금은 맨 위 부분으로 만들었어요. [부분 선택]을 눌러 썸네일로 쓸 부분을 골라 주세요.'
      : '';
    hint.hidden = !needsPick;
    el.querySelector('[data-action="region"]').classList.toggle('ghost', !needsPick);
  }

  /** 카드의 썸네일 칸을 지금 크기 목록에 맞게 새로 만들어요 */
  function renderItem(item) {
    const list = sizes.list();
    item.el.querySelector('.th-outs').replaceChildren(...list.map((size) => {
      const fig = document.createElement('figure');
      fig.className = 'th-out';
      fig.dataset.key = sizeKey(size);

      // 미리보기 자체가 버튼: 누르면 영역 조정 창이 열려요
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-edit';
      btn.dataset.action = 'edit';
      btn.dataset.key = sizeKey(size);
      btn.title = '눌러서 영역 조정';
      btn.setAttribute('aria-label', `${sizeLabel(size)} 썸네일 영역 조정`);
      btn.append(document.createElement('canvas'));

      const cap = document.createElement('figcaption');
      cap.className = 'th-cap';
      fig.append(btn, cap);
      return fig;
    }));
    for (const size of list) updateOut(item, size);
  }

  /**
   * 썸네일 칸 하나만 다시 그려요. (영역 조정 창에서 끄는 동안 계속 불려요)
   * 칸을 새로 만들지 않고 canvas 내용과 설명 글자만 바꿔요.
   */
  function updateOut(item, size) {
    const fig = item.el.querySelector(`.th-out[data-key="${sizeKey(size)}"]`);
    if (!fig) return;
    const crop = cropFor(item, size);
    drawThumbInto(fig.querySelector('canvas'), item.source, crop.rect(), size.w, size.h);

    const cap = fig.querySelector('.th-cap');
    cap.replaceChildren(sizeLabel(size));
    if (crop.isEdited()) cap.append(' ', text('span', 'th-badge', '조정됨'));
    if (crop.tooSmall) cap.append(' ', text('span', 'th-warn', '원본이 작아 흐릴 수 있어요'));
  }

  /** 크기 목록이 바뀌면 모든 카드를 다시 그려요 (sizes.js의 onChange) */
  function renderAll() {
    items.forEach(renderItem);
    refreshBar();
  }

  function refreshBar() {
    barEl.hidden = items.length === 0;
    const n = items.length * sizes.list().length;
    countEl.textContent = `이미지 ${items.length}장 · 썸네일 ${n}개`;
    zipBtn.disabled = busy || items.length === 0;
    clearBtn.disabled = busy;
    listEl.classList.toggle('busy', busy);
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  // ─────────────────────────────────────────────
  // 조작 (이벤트 위임: 카드가 계속 생기고 지워지니 목록 전체에 한 번만 등록)
  // ─────────────────────────────────────────────

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || busy) return;
    const item = items.find((it) => String(it.id) === btn.closest('.th-item').dataset.id);
    if (!item) return;

    if (btn.dataset.action === 'region') {
      regionPicker.open(item, (rect) => applyRegion(item, rect));
    } else if (btn.dataset.action === 'edit') {
      if (!item.url) return; // 방금 고른 부분의 주소를 만드는 중 (아주 잠깐)
      cropper.open(item, sizes.list(), btn.dataset.key, {
        getCrop: (size) => cropFor(item, size),
        onChange: (size) => updateOut(item, size),
      });
    } else if (btn.dataset.action === 'remove') {
      removeItem(item);
      refreshBar();
    }
  });

  clearBtn.addEventListener('click', () => {
    if (busy || !items.length) return;
    // 직접 조정한 영역이 있을 때만 한 번 물어봐요
    const edited = items.some((it) => [...it.crops.values()].some((c) => c.isEdited()));
    if (edited && !confirm('조정한 영역이 있어요. 모두 지울까요?')) return;
    [...items].forEach(removeItem); // 복사본으로 돌아야 지우는 중에 순서가 꼬이지 않아요
    setStatus('');
    refreshBar();
  });

  zipBtn.addEventListener('click', save);

  // ─────────────────────────────────────────────
  // 저장: 썸네일 파일 만들기 → ZIP → 다운로드
  // ─────────────────────────────────────────────

  async function save() {
    if (busy || !items.length) return;
    busy = true;
    refreshBar();
    try {
      const list = sizes.list();
      // 만드는 도중에 새 이미지가 들어와도 섞이지 않게, 시작할 때의 목록을 복사해서 써요
      const snapshot = items.slice();
      const outputs = [];
      // 진행 표시용 전체 개수: 이미지마다 형식 수가 다를 수 있어서('원본 형식') 미리 세요
      const total = snapshot.reduce((sum, it) => sum + settings.read(it.file).types.length * list.length, 0);
      const options = (file) => ({ ...settings.read(file), quality: QUALITY });

      for (const item of snapshot) {
        const jobs = list.map((size) => ({ ...size, rect: cropFor(item, size).rect() }));
        const outs = await makeThumbnails(item.file.name, item.source, jobs, options(item.file), () => {
          setStatus(`만드는 중… ${outputs.length + 1} / ${total}`);
        });
        outputs.push(...outs);
      }

      setStatus('ZIP으로 묶는 중…');
      const zip = await makeZip(outputs);
      const url = URL.createObjectURL(zip);
      const zipName = snapshot.length === 1
        ? `${snapshot[0].file.name.replace(/\.[^.]+$/, '') || 'image'}_thumbnails.zip`
        : 'thumbnails.zip';
      triggerDownload(url, zipName);
      setTimeout(() => URL.revokeObjectURL(url), 10_000); // 다운로드가 시작될 시간을 준 뒤 해제

      const fellBack = outputs.some((o) => o.fellBack)
        ? ' 이 브라우저는 WebP 저장을 지원하지 않아 JPG로 저장했어요.'
        : '';
      setStatus(`썸네일 ${outputs.length}개를 ZIP으로 저장했어요 (${formatBytes(zip.size)}).${fellBack}`);
    } catch (err) {
      console.error(err);
      setStatus(err.userMessage || '저장하지 못했어요. 다시 시도해 주세요.', true);
    } finally {
      busy = false;
      refreshBar();
    }
  }

  return { addFiles };
}

/** 글자만 든 요소 만들기 (파일 이름 같은 사용자 입력은 textContent로 — 보안) */
function text(tag, className, content) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
