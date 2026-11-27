/**
 * ui/sizes.js — 썸네일 크기 목록 편집 (설정 패널 안의 "233 × 158 px" 칸들)
 *
 * 할 수 있는 것:
 *   · 가로·세로 숫자 고치기
 *   · 크기 추가(+) · 삭제(×)  — 최소 한 개는 남아야 해요
 *   · 기본값(233×158, 216×158)으로 되돌리기
 * 고친 목록은 브라우저에 기억해요(localStorage). 다음에 열어도 그대로예요.
 *
 * 이 파일은 "크기 목록"만 관리하고, 크기가 바뀌면 썸네일을 어떻게 다시 만들지는 몰라요.
 * 바뀔 때마다 onChange(새 목록)로 알려주기만 해요.
 */

/** 처음 쓸 때 기본 크기 */
const DEFAULT_SIZES = [{ w: 233, h: 158 }, { w: 216, h: 158 }];
/** 너무 큰 숫자를 넣어 브라우저가 멈추지 않게 */
const MAX_SIDE = 4000;

/** 크기를 구분하는 이름표: { w: 233, h: 158 } → '233x158' (Map의 키, data 속성에 씀) */
export const sizeKey = (s) => `${s.w}x${s.h}`;

/** 화면에 보여줄 글자: '233 × 158' */
export const sizeLabel = (s) => `${s.w} × ${s.h}`;

/**
 * @param {HTMLElement} field data-setting="sizes" 요소
 * @param {string} storageKey localStorage에 저장할 이름
 * @param {(sizes: {w:number, h:number}[]) => void} onChange 목록이 바뀔 때 호출
 * @returns {{list: () => {w:number, h:number}[]}}
 */
export function createSizeEditor(field, storageKey, onChange) {
  const listEl = field.querySelector('.sz-list');
  let sizes = load();

  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      // 저장된 값이 망가져 있을 수도 있으니 꼼꼼히 확인하고, 이상하면 기본값을 써요
      const ok = Array.isArray(saved) ? saved.filter((s) => valid(s?.w) && valid(s?.h)) : [];
      if (ok.length) return ok.map(({ w, h }) => ({ w, h }));
    } catch (_) { /* 저장소를 못 쓰거나 JSON이 깨졌으면 기본값 */ }
    return DEFAULT_SIZES.map((s) => ({ ...s }));
  }

  function commit() {
    try { localStorage.setItem(storageKey, JSON.stringify(sizes)); } catch (_) { /* 무시 */ }
    onChange(list());
  }

  /**
   * 실제로 쓸 크기 목록. 같은 크기를 두 번 넣었으면 한 번만 넣어요.
   * (같은 이름의 파일이 두 번 생기는 걸 막으려고)
   */
  function list() {
    const seen = new Set();
    return sizes.filter((s) => !seen.has(sizeKey(s)) && seen.add(sizeKey(s)));
  }

  const isDefault = () => sizes.length === DEFAULT_SIZES.length
    && sizes.every((s, i) => sizeKey(s) === sizeKey(DEFAULT_SIZES[i]));

  // ─────────────────────────────────────────────
  // 그리기: 크기마다 [가로] × [세로] px [×] 한 줄씩 + 추가·기본값 버튼
  // ─────────────────────────────────────────────

  function render() {
    const rows = sizes.map((s, i) => {
      const row = document.createElement('div');
      row.className = 'sz-row';
      row.append(
        numberInput(i, 'w', s.w, `${i + 1}번 크기 가로(px)`),
        textNode('span', 'sz-x', '×'),
        numberInput(i, 'h', s.h, `${i + 1}번 크기 세로(px)`),
        textNode('span', 'sz-unit', 'px'),
        button('sz-del', '×', 'size-del', i, `${i + 1}번 크기 삭제`, sizes.length === 1),
      );
      return row;
    });
    const add = button('btn ghost sz-btn', '+ 크기 추가', 'size-add');
    const reset = button('btn ghost sz-btn', '기본값으로', 'size-reset');
    reset.hidden = isDefault();
    listEl.replaceChildren(...rows, add, reset);
  }

  function numberInput(index, dim, value, label) {
    const input = Object.assign(document.createElement('input'), {
      type: 'number', min: 1, max: MAX_SIDE, step: 1, value,
    });
    input.setAttribute('aria-label', label);
    Object.assign(input.dataset, { index: String(index), dim });
    return input;
  }

  function button(className, content, action, index = -1, label = '', disabled = false) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className, textContent: content, disabled });
    b.dataset.action = action;
    b.dataset.index = String(index);
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  // ─────────────────────────────────────────────
  // 조작 (이벤트 위임: 목록 전체에 한 번만 등록 — slicer.js와 같은 방식)
  // ─────────────────────────────────────────────

  // 'change'는 칸에서 나가거나 Enter를 칠 때 한 번 발생해요.
  // ('input'을 쓰면 "233"을 치는 동안 2, 23, 233마다 썸네일을 다시 만들어서 낭비예요)
  listEl.addEventListener('change', (e) => {
    const input = e.target;
    if (!input.dataset.dim) return;
    const s = sizes[Number(input.dataset.index)];
    const n = Math.round(Number(input.value));
    if (!valid(n)) {
      input.value = s[input.dataset.dim]; // 잘못된 값이면 원래 숫자로 되돌려요
      return;
    }
    input.value = n; // 233.7 → 234처럼 정리된 값을 보여줘요
    if (s[input.dataset.dim] === n) return;
    s[input.dataset.dim] = n;
    // 숫자 칸은 그대로 두고(포커스 유지) 기본값 버튼만 갱신해요
    listEl.querySelector('[data-action="size-reset"]').hidden = isDefault();
    commit();
  });

  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    if (b.dataset.action === 'size-del') {
      sizes.splice(Number(b.dataset.index), 1);
    } else if (b.dataset.action === 'size-add') {
      // 마지막 크기를 복사해 두고 바로 고칠 수 있게 가로 칸에 포커스
      sizes.push({ ...sizes[sizes.length - 1] });
    } else if (b.dataset.action === 'size-reset') {
      sizes = DEFAULT_SIZES.map((s) => ({ ...s }));
    }
    render();
    commit();
    if (b.dataset.action === 'size-add') {
      const input = listEl.querySelector(`[data-index="${sizes.length - 1}"][data-dim="w"]`);
      input.focus();
      input.select();
    }
  });

  render();
  return { list };
}

/** 글자만 든 요소 (textContent를 써서 안전하게) */
function textNode(tag, className, content) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
