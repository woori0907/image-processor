/**
 * ui/tabs.js — 탭 전환 (이미지 압축 ↔ 이미지 자르기 ↔ 썸네일 만들기)
 *
 * ── 접근성(ARIA) 탭 패턴 ──
 * 화면을 못 보는 사용자도 스크린 리더로 "탭 2개 중 1번째, 선택됨"처럼 알 수 있게
 * role="tab", aria-selected, aria-controls 같은 속성을 맞춰 줘요.
 * 키보드로는 ← → 로 탭을 옮길 수 있어요. (Tab 키는 선택된 탭 하나에만 멈춤)
 *
 * ── 주소(#해시) 연동 ──
 * 탭을 바꾸면 주소 끝이 #compress / #slice / #thumb로 바뀌어요.
 * 그래서 "썸네일 탭 바로 열기" 링크를 공유하거나 새로고침해도 그 탭이 유지돼요.
 *
 * @param {(name: string) => void} [onChange] 탭이 바뀔 때 호출
 * @returns {{active: () => string}} 지금 열린 탭 이름
 */
export function initTabs(onChange) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  let current = tabs[0].dataset.tab;

  function select(tab, { focus = false } = {}) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1; // 선택된 탭만 Tab 키로 들어올 수 있게
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    current = tab.dataset.tab;
    // replaceState: 뒤로 가기 기록을 쌓지 않고 주소만 바꿈
    history.replaceState(null, '', `#${current}`);
    onChange?.(current);
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const next = {
        ArrowRight: tabs[(i + 1) % tabs.length],
        ArrowLeft: tabs[(i - 1 + tabs.length) % tabs.length], // 음수가 안 되게 + length
        Home: tabs[0],
        End: tabs[tabs.length - 1],
      }[e.key];
      if (next) { e.preventDefault(); select(next, { focus: true }); }
    });
  });

  // 주소에 #thumb 같은 게 있으면 그 탭으로 시작
  const fromHash = tabs.find((t) => `#${t.dataset.tab}` === location.hash);
  if (fromHash) select(fromHash);

  return { active: () => current };
}
