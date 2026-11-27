/**
 * utils.js — 여러 곳에서 쓰는 작은 도우미 함수들
 *
 * 특정 기능에 속하지 않고 "어디서나 쓸 법한" 함수만 모아요.
 * 여기 있는 함수들은 입력이 같으면 결과도 항상 같아서(순수 함수) 이해하기 쉬워요.
 */

/** 바이트 수를 사람이 읽기 쉬운 문자열로: 1536 → '1.5 KB' */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

/** 원본 대비 몇 % 줄었는지 (음수면 오히려 커진 것) */
export function savingPct(before, after) {
  return Math.round((1 - after / before) * 100);
}

/** savingPct 결과를 문장으로: 85 → '85% 절감', -3 → '3% 증가' */
export function savingLabel(pct) {
  if (pct > 0) return `${pct}% 절감`;
  if (pct === 0) return '변화 없음';
  return `${-pct}% 증가`;
}

/**
 * ZIP 안에 같은 이름 파일이 두 개 들어가면 하나가 덮어써지므로,
 * 이미 쓴 이름이면 'photo-1.webp', 'photo-2.webp'처럼 번호를 붙여요.
 * @param {string} name
 * @param {Set<string>} used 지금까지 쓴 이름들 (함수가 직접 추가함)
 */
export function uniqueName(name, used) {
  let n = name;
  let k = 1;
  while (used.has(n)) n = name.replace(/(\.[^.]+)$/, `-${k++}$1`);
  used.add(n);
  return n;
}

/**
 * 코드로 파일 다운로드 시키기.
 * 화면에 없는 <a download> 링크를 만들어 클릭하는 게 브라우저에서 가장 흔한 방법이에요.
 */
export function triggerDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}
