/**
 * cuts.js — "자르는 선" 데이터 관리 (화면도, 이미지 처리도 모르는 순수 로직)
 *
 * 이미지 높이가 1000px이고 선이 [300, 900]에 있으면 조각은 이렇게 나뉘어요:
 *
 *     0 ┬──────────┐
 *       │ 조각 0    │  0 ~ 300
 *   300 ├── 선 0 ──┤
 *       │ 조각 1    │  300 ~ 900   ← 버튼이라면 buttons[1] = true
 *   900 ├── 선 1 ──┤
 *       │ 조각 2    │  900 ~ 1000
 *  1000 ┴──────────┘
 *
 * 그래서 항상 "조각 개수 = 선 개수 + 1"이에요.
 * 선 목록(cuts)과 조각별 버튼 표시(buttons)를 이 규칙에 맞게 함께 고치는 게 이 파일의 일이에요.
 *
 * ── 왜 따로 파일을 만들었나요? ──
 * 선을 추가·이동·삭제할 때 지켜야 할 규칙(순서 유지, 겹치지 않기, 범위 안에 있기)이
 * 화면 코드 사이에 섞여 있으면 헷갈려요. 여기 모아두면 화면(ui/slicer.js)은
 * "add / move / remove를 부르고 다시 그리기"만 하면 돼요.
 *
 * @param {number} height 원본 이미지 높이(px)
 */
export function createCuts(height) {
  /** 자르는 선의 y 위치들 (항상 작은 값부터 정렬된 상태를 유지) */
  let cuts = [];
  /** 조각마다 "버튼인지" 표시. 길이는 항상 cuts.length + 1 */
  let buttons = [false];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  return {
    /** 선 위치 목록 (복사본을 줘서 밖에서 실수로 고치지 못하게) */
    list: () => cuts.slice(),

    /**
     * 선 목록을 조각 목록으로 바꿔요.
     * @returns {{index:number, top:number, bottom:number, height:number, isButton:boolean}[]}
     */
    pieces() {
      const edges = [0, ...cuts, height]; // 경계선: 맨 위, 선들, 맨 아래
      return buttons.map((isButton, i) => ({
        index: i,
        top: edges[i],
        bottom: edges[i + 1],
        height: edges[i + 1] - edges[i],
        isButton,
      }));
    },

    /**
     * y 위치에 선을 추가해요.
     * @returns {number} 추가된 선의 순번. 추가하지 못하면 -1 (맨 끝이거나 같은 위치에 이미 있음)
     */
    add(y) {
      y = Math.round(y);
      if (y <= 0 || y >= height || cuts.includes(y)) return -1;
      // 정렬을 유지하려고, y보다 큰 첫 선의 앞자리에 끼워 넣어요
      let k = cuts.findIndex((c) => c > y);
      if (k === -1) k = cuts.length;
      cuts.splice(k, 0, y);
      // 조각 k가 위(k)·아래(k+1)로 나뉘어요. 위쪽은 원래 표시를 그대로 갖고, 새로 생긴 아래쪽은 false
      buttons.splice(k + 1, 0, false);
      return k;
    },

    /**
     * k번째 선을 y로 옮겨요. 이웃한 선을 넘어가지 못하게 막아서 순서가 절대 바뀌지 않아요.
     * (순서가 안 바뀌니 "몇 번째 선"이라는 번호도 드래그 중에 그대로 유지돼요)
     * @returns {number} 실제로 놓인 위치
     */
    move(k, y) {
      const min = (cuts[k - 1] ?? 0) + 1;       // 위쪽 이웃 선보다 최소 1px 아래
      const max = (cuts[k + 1] ?? height) - 1;  // 아래쪽 이웃 선보다 최소 1px 위
      cuts[k] = clamp(Math.round(y), min, max);
      return cuts[k];
    },

    /** k번째 선을 지워요. 선 위·아래 조각이 하나로 합쳐지고, 위 조각의 버튼 표시를 따라가요. */
    remove(k) {
      cuts.splice(k, 1);
      buttons.splice(k + 1, 1);
    },

    /** i번째 조각의 버튼 표시 켜기/끄기 */
    setButton(i, on) {
      buttons[i] = Boolean(on);
    },

    /** 선 모두 지우기 */
    clear() {
      cuts = [];
      buttons = [false];
    },
  };
}
