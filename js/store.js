/**
 * store.js — 이미지 목록 데이터 보관소
 *
 * "사용자가 넣은 이미지 목록"이라는 데이터를 관리해요.
 * 다른 파일은 목록을 직접 고치지 않고, 여기서 돌려주는 함수를 통해서만 바꿔요.
 * 이렇게 하면 "목록이 언제, 어디서 바뀌었지?"를 추적하기 쉬워져요.
 *
 * ── 왜 createStore() 함수로 만들까요? (팩토리 패턴) ──
 * workspace를 쓰는 탭은 저마다 목록을 따로 가져야 해요.
 * createStore()를 부를 때마다 새로운 items 배열이 생겨서,
 * 탭끼리 서로의 목록을 건드리지 않아요.
 * (함수 안의 변수를 안쪽 함수들이 기억하는 것을 "클로저(closure)"라고 해요)
 *
 * ── Object URL 이야기 ──
 * 브라우저 메모리에 있는 파일(Blob)을 <img src>나 다운로드 링크에 쓰려면
 * URL.createObjectURL(blob)로 'blob:...' 주소를 만들어야 해요.
 * 이 주소는 직접 URL.revokeObjectURL()로 해제하기 전까지 메모리를 계속 차지해요.
 * 그래서 만들기와 해제를 이 파일에 모아서 빠뜨리지 않게 했어요.
 */

/**
 * 결과물 하나 (예: photo.webp)
 * @typedef {Object} Output
 * @property {string}  type      MIME 타입 ('image/webp' 등)
 * @property {Blob}    blob      실제 파일 데이터
 * @property {string}  name      저장될 파일 이름
 * @property {number}  width
 * @property {number}  height
 * @property {boolean} fellBack  WebP를 못 만들어 JPG로 대체했는지
 * @property {string}  url       미리보기·다운로드용 blob: 주소
 */

/**
 * 목록의 항목 하나 = 사용자가 넣은 이미지 한 장
 * @typedef {Object} Item
 * @property {number}  id
 * @property {File}    file       사용자가 넣은 원본 파일
 * @property {string}  origUrl    원본 미리보기용 blob: 주소
 * @property {HTMLLIElement} el   화면에 그려진 줄 (ui/list.js가 만듦)
 * @property {Output[]} [results] 처리 결과 (끝나면 생김)
 * @property {AbortController|null} [abort] 처리 중단용 (삭제 시 사용)
 * @property {boolean} [selected]   체크박스 선택 여부
 * @property {boolean} [origBroken] 브라우저가 원본을 표시하지 못하는지 (예: Chrome의 HEIC)
 */

export function createStore() {
  /** @type {Item[]} */
  const items = [];
  let nextId = 1;

  function releaseResults(item) {
    item.results?.forEach((r) => URL.revokeObjectURL(r.url));
  }

  return {
    /** 현재 목록 (읽기용. 바꿀 땐 아래 함수 사용) */
    all: () => items,

    /** 아직 목록에 있는지 (처리 도중 삭제됐는지 확인할 때 사용) */
    has: (item) => items.includes(item),

    selected: () => items.filter((i) => i.selected),

    /** 파일 하나로 새 항목을 만들어 목록에 추가 */
    create(file) {
      /** @type {Item} */
      const item = { id: nextId++, file, origUrl: URL.createObjectURL(file), el: null };
      items.push(item);
      return item;
    },

    /** 처리 결과를 저장 (이전 결과의 blob: 주소는 해제) */
    setResults(item, outputs) {
      releaseResults(item);
      item.results = outputs.map((o) => ({ ...o, url: URL.createObjectURL(o.blob) }));
    },

    /** 여러 항목을 목록에서 빼고 메모리도 정리 */
    remove(targets) {
      for (const it of targets) {
        it.abort?.abort(); // 처리 중이면 중단 신호 보내기
        releaseResults(it);
        URL.revokeObjectURL(it.origUrl);
        const idx = items.indexOf(it);
        if (idx !== -1) items.splice(idx, 1);
      }
    },
  };
}
