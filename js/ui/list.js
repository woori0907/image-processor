/**
 * ui/list.js — 이미지 목록과 요약 영역 그리기
 *
 * 데이터(store.js의 item)를 받아서 화면(HTML)으로 보여주는 일만 해요.
 * 버튼을 눌렀을 때 "무엇을 할지"는 직접 정하지 않고, 넘겨받은
 * 콜백 함수(handlers)를 호출해요. 그래서 이 파일은 압축·업스케일 로직을 전혀 몰라요.
 *
 * mode('compress' | 'upscale')에 따라 보여주는 정보만 조금 달라요:
 *   - 압축:     "WebP 230 KB · 85% 절감"   ← 얼마나 줄었는지가 중요
 *   - 업스케일: "200×150 → 400×300"       ← 얼마나 커졌는지가 중요
 *
 * ── 보안 팁: textContent vs innerHTML ──
 * 파일 이름처럼 사용자가 정한 글자는 항상 textContent로 넣어요.
 * innerHTML로 넣으면 파일 이름에 <script> 같은 코드가 있을 때 실행될 수 있어요(XSS).
 * innerHTML은 우리가 직접 쓴 고정 HTML 틀에만 써요.
 */
import { LABEL } from '../formats.js';
import { formatBytes, savingPct, savingLabel } from '../utils.js';

/**
 * 목록에 들어갈 한 줄(<li>)을 만들어요.
 * @param {import('../store.js').Item} item
 * @param {{onPreview:(item)=>void, onToggle:(item, on:boolean)=>void}} handlers
 */
export function createRow(item, { onPreview, onToggle }) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <input class="pick" type="checkbox" />
    <button class="thumb-btn" type="button" disabled aria-label="미리보기"><img class="thumb" alt="" /></button>
    <div class="meta">
      <div class="name"></div>
      <div class="detail">대기 중…</div>
    </div>
    <div class="actions"></div>`;
  li.querySelector('.name').textContent = item.file.name;
  li.querySelector('.thumb-btn').addEventListener('click', () => onPreview(item));
  const pick = li.querySelector('.pick');
  pick.setAttribute('aria-label', `${item.file.name} 선택`);
  pick.addEventListener('change', () => onToggle(item, pick.checked));
  return li;
}

/** 처리 중 상태 문구 표시 ('압축 중…', 'AI 업스케일 중… 42%' 등) */
export function showStatus(item, text) {
  const meta = item.el.querySelector('.meta');
  meta.querySelectorAll('.detail').forEach((d, i) => { if (i) d.remove(); }); // 첫 줄만 남김
  meta.querySelector('.detail').textContent = text;
  item.el.querySelector('.actions').innerHTML = '';
  item.el.querySelector('.thumb-btn').disabled = true;
}

/**
 * 처리 결과 표시: 썸네일, 크기·용량 정보, 미리보기·다운로드 버튼
 * @param {import('../store.js').Item} item
 * @param {'compress'|'upscale'} mode
 * @param {(item)=>void} onPreview
 */
export function showResult(item, mode, onPreview) {
  const { file, results, upInfo } = item;
  const meta = item.el.querySelector('.meta');
  const actions = item.el.querySelector('.actions');
  meta.querySelectorAll('.detail').forEach((d) => d.remove());
  actions.innerHTML = '';

  const first = results[0];
  item.el.querySelector('.thumb').src = first.url;
  item.el.querySelector('.thumb-btn').disabled = false;
  // 결과가 여러 형식이면 확장자 없는 이름, 하나면 결과 파일 이름
  item.el.querySelector('.name').textContent =
    results.length > 1 ? file.name.replace(/\.[^.]+$/, '') : first.name;

  // 첫 줄: 크기 정보
  const info = el('div', 'detail');
  if (mode === 'upscale' && upInfo?.factor) {
    // 결과 크기 ÷ 배율 = 원본 크기
    const ow = Math.round(first.width / upInfo.factor);
    const oh = Math.round(first.height / upInfo.factor);
    info.append(`${ow}×${oh} → ${first.width}×${first.height} · `, el('span', 'tag-ai', `AI ${upInfo.factor}배`));
    if (upInfo.note) info.append(` · ${upInfo.note}`);
  } else {
    info.textContent = `${first.width}×${first.height} · 원본 ${formatBytes(file.size)}`;
  }
  meta.append(info);

  actions.append(button('미리보기', 'btn ghost', () => onPreview(item)));

  // 형식별 한 줄씩
  for (const r of results) {
    const line = el('div', 'detail');
    line.append(el('span', 'fmt', LABEL[r.type]), formatBytes(r.blob.size));
    if (mode === 'compress') {
      const pct = savingPct(file.size, r.blob.size);
      line.append(' · ', el('span', `saving ${pct > 0 ? 'good' : 'bad'}`, savingLabel(pct)));
    }
    if (r.fellBack) line.append(' · 이 브라우저는 WebP를 만들 수 없어 JPG로 저장했어요');
    meta.append(line);

    const a = el('a', 'btn', results.length > 1 ? `${LABEL[r.type]} 받기` : '다운로드');
    a.href = r.url;
    a.download = r.name; // download 속성이 있으면 링크 클릭 시 페이지 이동 대신 저장
    actions.append(a);
  }
}

/** 체크박스 선택 상태를 화면에 반영 */
export function setRowSelected(item, on) {
  item.el.querySelector('.pick').checked = on;
  item.el.classList.toggle('selected', on);
}

/**
 * 탭 하나의 요약 영역(목록 위 막대)을 담당해요.
 * @param {HTMLElement} root 탭 패널 요소
 * @param {'compress'|'upscale'} mode
 */
export function createSummaryBar(root, mode) {
  const els = {
    summary: root.querySelector('.summary'),
    text: root.querySelector('.summary-text'),
    zip: root.querySelector('[data-action="zip"]'),
    selectAll: root.querySelector('[data-action="select-all"]'),
    deleteSelected: root.querySelector('[data-action="delete-selected"]'),
  };

  return {
    /** "3장 · 12 MB → 1.2 MB (90% 절감)" 같은 요약 */
    update(items) {
      const done = items.filter((i) => i.results);
      els.summary.hidden = items.length === 0;
      els.zip.disabled = done.length === 0;
      els.text.innerHTML = '';
      if (!done.length) {
        els.text.textContent = `${items.length}장 처리 중…`;
        return;
      }

      // 형식별로 원본 합계·결과 합계를 모아요 (WebP + JPG일 때 따로 보여주려고)
      const byType = new Map(); // 'image/webp' → { before, after }
      for (const i of done) {
        for (const r of i.results) {
          const t = byType.get(r.type) || { before: 0, after: 0 };
          t.before += i.file.size;
          t.after += r.blob.size;
          byType.set(r.type, t);
        }
      }
      const parts = [...byType].map(([type, { before, after }]) => {
        const prefix = byType.size > 1 ? `${LABEL[type]} ` : '';
        return mode === 'compress'
          ? `${prefix}${formatBytes(before)} → ${formatBytes(after)} (${savingPct(before, after)}% 절감)`
          : `${prefix}합계 ${formatBytes(after)}`;
      });
      els.text.append(el('strong', '', `${done.length}장 완료 · ${parts.join(' / ')}`));
      const pending = items.length - done.length;
      if (pending) els.text.append(` · ${pending}장 처리 중…`);
    },

    /** '전체 선택' 체크박스와 '선택 삭제' 버튼 상태 갱신 */
    updateSelection(items) {
      const n = items.filter((i) => i.selected).length;
      els.deleteSelected.disabled = n === 0;
      els.deleteSelected.textContent = n ? `선택 삭제 (${n})` : '선택 삭제';
      els.selectAll.checked = n > 0 && n === items.length;
      // indeterminate: 일부만 선택됐을 때 보이는 '–' 모양
      els.selectAll.indeterminate = n > 0 && n < items.length;
    },
  };
}

// ── 작은 DOM 도우미 ──
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(text, className, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
