/**
 * crop.js — "썸네일로 가져올 영역" 데이터 관리 (화면도, 이미지 처리도 모르는 순수 로직)
 *
 * 850×395 원본에서 233×158 썸네일을 만든다면, 원본의 어느 부분을 가져올지 정해야 해요.
 * 이 "가져올 영역(rect)"은 항상 썸네일과 같은 비율이어야 찌그러지지 않아요.
 *
 *   원본 850×395 (비율 2.15)
 *   ┌───────┬──────────────────┬───────┐
 *   │ 잘림   │   가져올 영역      │ 잘림   │   영역 = 583×395 (비율 1.47 = 233÷158)
 *   │       │  → 233×158로 축소  │       │   처음엔 가운데에 놓여요
 *   └───────┴──────────────────┴───────┘
 *
 * 이 파일이 지키는 규칙:
 *   1. 비율은 절대 바뀌지 않아요 (가로를 정하면 세로는 자동: h = w ÷ 비율)
 *   2. 영역은 원본 밖으로 나가지 않아요
 *   3. 영역은 "전체(가장 크게)"보다 커지지 않고, 썸네일 크기보다 작아지지 않아요
 *      (썸네일보다 작은 영역을 가져오면 확대돼서 흐릿해지니까요)
 *
 * 화면(ui/cropper.js)은 이 규칙을 몰라도 돼요. 그냥 moveTo / zoomTo 등을 부르고 다시 그리면 끝!
 * (cuts.js와 같은 방식)
 *
 * 좌표는 모두 "원본 px" 기준이고, 끌기를 부드럽게 하려고 소수점도 그대로 둬요.
 * 실제로 자를 때(image/thumbnail.js) 반올림해요.
 *
 * @param {number} srcW 원본 가로(px)
 * @param {number} srcH 원본 세로(px)
 * @param {number} outW 썸네일 가로(px)
 * @param {number} outH 썸네일 세로(px)
 * @param {Object} [options]
 * @param {'center'|'top'} [options.align] 처음(그리고 되돌리기) 위치.
 *   세로로 긴 상세페이지는 대표 배너가 보통 맨 위에 있어서 'top'을 써요.
 */
export function createCrop(srcW, srcH, outW, outH, { align = 'center' } = {}) {
  const ratio = outW / outH;

  // "전체" 영역의 가로 = 원본 안에 들어가는 가장 큰 영역
  // 원본이 썸네일보다 가로로 길면 세로를 꽉 채우고(좌우가 잘림), 아니면 가로를 꽉 채워요(위아래가 잘림)
  const maxW = srcW / srcH > ratio ? srcH * ratio : srcW;
  // 가장 작게 줄일 수 있는 크기 = 썸네일 크기 (원본이 더 작으면 어쩔 수 없이 전체)
  const minW = Math.min(outW, maxW);

  /** 지금 영역 { x, y, w, h } */
  let rect;
  /** 사람이 한 번이라도 조정했는지 (화면에 "조정됨" 표시용) */
  let edited = false;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /**
   * 모든 변경은 이 함수 하나를 거쳐요. 그래서 위의 규칙 1~3이 항상 지켜져요.
   * 크기를 먼저 맞추고 → 그 크기로 원본 밖에 나가지 않게 위치를 맞춰요.
   */
  function set(x, y, w) {
    w = clamp(w, minW, maxW);
    const h = w / ratio;
    rect = { x: clamp(x, 0, srcW - w), y: clamp(y, 0, srcH - h), w, h };
  }

  /** 전체 크기로, 가운데(또는 맨 위)에 */
  function reset() {
    const y = align === 'top' ? 0 : (srcH - maxW / ratio) / 2;
    set((srcW - maxW) / 2, y, maxW);
    edited = false;
  }
  reset();

  return {
    /** 지금 영역 (복사본을 줘서 밖에서 실수로 고치지 못하게) */
    rect: () => ({ ...rect }),

    /** 사람이 조정했는지 */
    isEdited: () => edited,

    /** 확대 배율: 1 = 전체, 2 = 가로세로 절반 영역만 가져옴 */
    zoom: () => maxW / rect.w,

    /** 최대 확대 배율 (1이면 확대할 수 없음) */
    maxZoom: maxW / minW,

    /** 원본이 썸네일보다 작아서 늘려야 하는지 (흐릿해질 수 있다는 경고용) */
    tooSmall: maxW < outW,

    /** 영역의 왼쪽 위를 (x, y)로 옮겨요. 원본 밖으로 나가면 끝에 붙어요. */
    moveTo(x, y) {
      set(x, y, rect.w);
      edited = true;
    },

    /** 영역의 가운데가 (cx, cy)에 오도록 옮겨요 */
    centerAt(cx, cy) {
      set(cx - rect.w / 2, cy - rect.h / 2, rect.w);
      edited = true;
    },

    /**
     * 배율을 z로 바꿔요.
     *
     * (fx, fy)는 "초점": 확대·축소해도 화면에서 그 점이 제자리에 머물러요.
     * 마우스 휠로 확대할 때 커서 아래가 그대로 있어야 자연스럽거든요. (지도 앱처럼)
     *
     *   초점이 영역 왼쪽에서 30% 위치에 있었다면 → 새 영역에서도 30% 위치에 오도록
     *   새 x = fx - (fx - 예전 x) × (새 가로 ÷ 예전 가로)
     *
     * 초점을 안 주면 영역의 가운데를 기준으로 해요.
     */
    zoomTo(z, fx = rect.x + rect.w / 2, fy = rect.y + rect.h / 2) {
      const w = clamp(maxW / z, minW, maxW);
      const k = w / rect.w;
      set(fx - (fx - rect.x) * k, fy - (fy - rect.y) * k, w);
      edited = true;
    },

    /**
     * 모서리를 (px, py)로 끌어서 크기를 바꿔요. 반대쪽 모서리는 고정돼요.
     *
     * 비율이 고정이라 가로·세로 중 하나만 정하면 되는데,
     * 포인터까지의 가로 거리와 (세로 거리 × 비율) 중 큰 쪽을 써요.
     * 그래야 대각선이 아닌 방향으로 끌어도 자연스럽게 따라와요.
     *
     * @param {'nw'|'ne'|'sw'|'se'} corner 끄는 모서리 (n=위, s=아래, w=왼쪽, e=오른쪽)
     */
    resizeCorner(corner, px, py) {
      const east = corner.includes('e');
      const south = corner.includes('s');
      // 고정점(anchor) = 끄는 모서리의 반대편 모서리
      const ax = east ? rect.x : rect.x + rect.w;
      const ay = south ? rect.y : rect.y + rect.h;

      let w = Math.max(east ? px - ax : ax - px, (south ? py - ay : ay - py) * ratio);
      // 고정점에서 원본 끝까지 남은 공간보다 커지면 고정점이 밀려나니 막아요
      const room = Math.min(east ? srcW - ax : ax, (south ? srcH - ay : ay) * ratio);
      w = clamp(w, minW, Math.min(maxW, room));

      set(east ? ax : ax - w, south ? ay : ay - w / ratio, w);
      edited = true;
    },

    reset,
  };
}
