/**
 * ui/settings.js — 설정 패널 (형식 · 최대 크기 · 품질)
 *
 * 역할은 두 가지예요:
 *   1. 설정이 바뀔 때 화면 반응 (안내 문구 바꾸기, 품질 숫자 표시 등)
 *   2. read(): 지금 화면에 선택된 값을 "처리에 쓸 수 있는 객체"로 바꿔 주기
 *
 * ── 탭마다 설정이 다른데 어떻게 한 파일로 처리할까요? ──
 * HTML에 data-setting="format"처럼 "이건 어떤 설정인지" 표시를 해두고,
 * 탭(root) 안에서 그 표시를 찾아요. 자르기 탭에는 maxWidth가 없지만, 없으면 기본값을 쓰면 돼요.
 * (썸네일 탭처럼 품질 칸이 없는 탭도 있어요. 그때 quality는 null이라 쓰는 쪽에서 정해요)
 * 그래서 id 대신 data 속성을 써요. (id는 페이지 전체에서 하나여야 해서 탭마다 쓸 수 없어요)
 */
import { typesFor } from '../formats.js';

const HINTS = {
  format: {
    webp: '가장 가벼워요. 다만 일부 오래된 브라우저·앱·메신저에서는 안 보일 수 있어요.',
    jpeg: 'WebP보다 조금 무겁지만 어디서나 열려요. 투명 배경은 흰색으로 채워져요.',
    both: '같은 이미지를 WebP와 JPG로 둘 다 만들어요. WebP가 안 되는 곳에는 JPG를 쓰면 돼요.',
    png: '무손실이라 화질은 그대로지만 용량이 커요. 로고·아이콘 등 투명 배경이 필요한 이미지에 적합해요.',
    original: '들어온 형식 그대로 압축해요. (GIF·HEIC 등은 JPG로 저장)',
  },
};

/**
 * 탭 하나의 설정 패널을 준비해요.
 * @param {HTMLElement} root 탭 패널 요소
 * @param {string} storageKey 선택한 형식을 기억할 때 쓸 이름 (탭마다 다르게)
 * @returns {{read: (file: File) => Settings}}
 *
 * @typedef {Object} Settings
 * @property {string[]} types    만들 형식들 ('image/webp' 등)
 * @property {number}   maxWidth 최대 가로 크기 (0 = 제한 없음)
 * @property {number|null} quality 0~1 (품질 칸이 없는 탭이면 null)
 */
export function createSettings(root, storageKey) {
  const radios = (name) => [...root.querySelectorAll(`[data-setting="${name}"] input[type="radio"]`)];
  const formatRadios = radios('format');
  const maxWidthSel = root.querySelector('[data-setting="maxWidth"] select'); // 없을 수도 있음
  const qualityInput = root.querySelector('[data-setting="quality"] input'); // 없을 수도 있음
  const qualityOut = root.querySelector('[data-setting="quality"] output');

  const checkedValue = (list) => list.find((r) => r.checked)?.value;

  // 선택한 형식은 브라우저에 기억해요 (localStorage).
  // 시크릿 모드 등에서는 localStorage가 막혀 에러가 날 수 있어서 try/catch로 감쌌어요.
  try {
    const saved = localStorage.getItem(storageKey);
    const r = formatRadios.find((x) => x.value === saved);
    if (r) r.checked = true;
  } catch (_) { /* 저장소를 못 쓰면 기본값 사용 */ }

  // 라디오 그룹 + 안내 문구 연결: 선택이 바뀌면 data-hint-for 요소의 글자를 바꿔요
  function bindHint(name, list, onChange) {
    const hintEl = root.querySelector(`[data-hint-for="${name}"]`);
    const update = () => { if (hintEl) hintEl.textContent = HINTS[name][checkedValue(list)] ?? ''; };
    update();
    list.forEach((r) => r.addEventListener('change', () => { update(); onChange?.(); }));
  }

  bindHint('format', formatRadios, () => {
    try { localStorage.setItem(storageKey, checkedValue(formatRadios)); } catch (_) { /* 무시 */ }
  });

  // 'input' 이벤트는 슬라이더를 끄는 동안 계속 발생해요 ('change'는 손을 뗄 때 한 번)
  qualityInput?.addEventListener('input', () => { qualityOut.textContent = qualityInput.value; });

  return {
    /**
     * 현재 설정값을 처리용 객체로 만들어요.
     * HTML 값은 전부 문자열이라 숫자로 바꾸는 것도 여기서 해요.
     * @param {File} file 'original' 형식일 때 원본 형식을 알아야 해서 받아요
     */
    read(file) {
      return {
        types: typesFor(checkedValue(formatRadios), file.type),
        maxWidth: maxWidthSel ? Number(maxWidthSel.value) : 0,
        quality: qualityInput ? Number(qualityInput.value) / 100 : null, // 슬라이더 40~100 → 0.4~1.0
      };
    },
  };
}
