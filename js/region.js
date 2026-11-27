/**
 * region.js — "원본에서 사용할 부분" 데이터 관리 (화면도, 이미지 처리도 모르는 순수 로직)
 *
 * 세로로 긴 상세페이지(예: 850×6000)를 그대로 썸네일로 만들면 엉뚱한 부분이 나와요.
 * 그래서 먼저 "이 부분만 쓸래요"를 고르고, 썸네일은 그 부분 안에서 만들어요.
 *
 *   원본 850×6000
 *   ┌──────────┐
 *   │          │
 *   ├──────────┤ ← y = 1200
 *   │ 사용할 부분│    { x: 0, y: 1200, w: 850, h: 700 }
 *   ├──────────┤ ← y = 1900
 *   │   …      │
 *   └──────────┘
 *
 * crop.js(썸네일 영역)와 비슷하지만 다른 점이 있어요:
 *   · crop.js   : 비율이 썸네일과 같게 "고정"
 *   · region.js : 비율이 "자유". 가로·세로를 따로 늘이고 줄일 수 있어요
 *
 * 지키는 규칙:
 *   1. 원본 밖으로 나가지 않아요
 *   2. 너무 작아지지 않아요 (가로·세로 최소 MIN px)
 *
 * @param {number} srcW 원본 가로(px)
 * @param {number} srcH 원본 세로(px)
 * @param {{x:number,y:number,w:number,h:number}|null} [initial] 처음 영역 (없으면 전체)
 */
const MIN = 16;

export function createRegion(srcW, srcH, initial = null) {
  const full = { x: 0, y: 0, w: srcW, h: srcH };
  let rect = { ...(initial ?? full) };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const minW = Math.min(MIN, srcW);
  const minH = Math.min(MIN, srcH);

  /**
   * 왼쪽·위·오른쪽·아래 네 변의 위치로 영역을 정해요. 모든 변경이 이 함수를 거쳐요.
   * 좌표는 정수 px로 맞춰요. (사용할 부분은 실제로 잘라서 새 이미지를 만들기 때문)
   */
  function setEdges(left, top, right, bottom) {
    left = Math.round(clamp(left, 0, srcW - minW));
    top = Math.round(clamp(top, 0, srcH - minH));
    right = Math.round(clamp(right, left + minW, srcW));
    bottom = Math.round(clamp(bottom, top + minH, srcH));
    rect = { x: left, y: top, w: right - left, h: bottom - top };
  }

  return {
    /** 지금 영역 (복사본) */
    rect: () => ({ ...rect }),

    /** 원본 전체를 고른 상태인지 */
    isFull: () => rect.x === 0 && rect.y === 0 && rect.w === srcW && rect.h === srcH,

    /** 영역을 통째로 바꾸기 (끌기를 취소하고 원래대로 돌릴 때) */
    set(r) {
      setEdges(r.x, r.y, r.x + r.w, r.y + r.h);
    },

    /** 크기는 그대로, 왼쪽 위를 (x, y)로 옮기기. 원본 끝에 닿으면 멈춰요. */
    moveTo(x, y) {
      x = clamp(x, 0, srcW - rect.w);
      y = clamp(y, 0, srcH - rect.h);
      setEdges(x, y, x + rect.w, y + rect.h);
    },

    /**
     * 두 점(시작점 a, 지금 포인터 p)을 대각선으로 하는 새 영역 그리기.
     * 위로 끌든 아래로 끌든 작은 쪽이 왼쪽·위가 되도록 min/max로 정리해요.
     */
    drawFrom(ax, ay, px, py) {
      setEdges(Math.min(ax, px), Math.min(ay, py), Math.max(ax, px), Math.max(ay, py));
    },

    /**
     * 변이나 모서리를 (px, py)로 끌어 크기 바꾸기. 끌지 않는 변은 그대로예요.
     * @param {string} edges 끄는 변들: 'n'(위) 's'(아래) 'w'(왼쪽) 'e'(오른쪽), 모서리는 'nw'처럼 두 글자
     */
    resizeEdges(edges, px, py) {
      let left = rect.x;
      let top = rect.y;
      let right = rect.x + rect.w;
      let bottom = rect.y + rect.h;
      // 반대쪽 변을 넘어가지 않게 (최소 크기만큼 떨어져 있게) 막아요
      if (edges.includes('w')) left = Math.min(px, right - minW);
      if (edges.includes('e')) right = Math.max(px, left + minW);
      if (edges.includes('n')) top = Math.min(py, bottom - minH);
      if (edges.includes('s')) bottom = Math.max(py, top + minH);
      setEdges(left, top, right, bottom);
    },

    /** 원본 전체로 */
    reset() {
      rect = { ...full };
    },
  };
}
