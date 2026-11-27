/**
 * workspace.js — 탭 하나의 "작업 공간"
 *
 * "여러 장을 넣으면 알아서 처리하는" 탭은 하는 일(처리 방법)만 다르고 나머지는 똑같아요:
 *   파일 받기 → 목록에 추가 → 한 장씩 처리 → 결과 표시 → 선택·삭제·ZIP
 *
 * 그래서 공통 부분을 이 파일에 한 번만 만들고,
 * "실제로 어떻게 처리할지(process)"만 바깥(main.js)에서 넘겨받아요.
 * 이렇게 바뀌는 부분만 함수로 받는 방식을 "전략(strategy) 패턴"이라고 불러요.
 * 나중에 세 번째 탭(예: 형식 변환)을 만들 때도 process 함수만 새로 쓰면 돼요.
 */
import { createStore } from './store.js';
import { createSettings } from './ui/settings.js';
import { initDropzone } from './ui/dropzone.js';
import { createRow, showStatus, showResult, setRowSelected, createSummaryBar } from './ui/list.js';
import { openPreview, closePreviewFor } from './ui/preview.js';
import { makeZip } from './zip.js';
import { triggerDownload } from './utils.js';

/**
 * 처리 함수의 모양 (main.js에서 탭마다 하나씩 만들어 넘겨요)
 * @callback ProcessFn
 * @param {import('./store.js').Item} item
 * @param {import('./ui/settings.js').Settings} settings
 * @param {{signal: AbortSignal, report: (msg: string) => void}} ctx
 *   signal: 삭제되면 중단됨을 알리는 신호 / report: 진행 상황 문구 표시
 * @returns {Promise<{outputs: Omit<import('./store.js').Output,'url'>[]}>}
 */

/**
 * @param {HTMLElement} root 탭 패널 요소 (#panel-compress 등)
 * @param {Object} config
 * @param {string} config.mode               탭 이름 (설정을 기억할 때 이름표로 씀)
 * @param {ProcessFn} config.process          이미지 한 장을 처리하는 방법
 * @param {string} config.zipName             ZIP 파일 이름
 * @returns {{addFiles: (files: FileList|File[]) => void}}
 */
export function createWorkspace(root, { mode, process, zipName }) {
  const store = createStore(); // 이 탭만의 목록
  const settings = createSettings(root, `image-tools:${mode}:format`);
  const bar = createSummaryBar(root);
  const listEl = root.querySelector('.list');

  const preview = (item) => openPreview(item);
  const rowHandlers = { onPreview: preview, onToggle: setSelected };

  // ─────────────────────────────────────────────
  // 1. 파일 추가
  // ─────────────────────────────────────────────
  function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    for (const file of files) {
      const item = store.create(file);
      item.el = createRow(item, rowHandlers);
      listEl.prepend(item.el); // 최근 것이 위로
      enqueue(item);
    }
    refreshBar();
  }

  // ─────────────────────────────────────────────
  // 2. 처리 대기열 (탭마다 따로)
  // ─────────────────────────────────────────────
  /**
   * 큰 이미지 여러 장을 동시에 처리하면 메모리가 부족해져요.
   * 그래서 Promise를 사슬처럼 이어서 "앞 작업이 끝나야 다음 작업 시작"하게 했어요.
   *
   *   queue = 작업1
   *   queue = 작업1.then(작업2)
   *   queue = 작업1.then(작업2).then(작업3) ...
   *
   * .catch를 붙여서 하나가 실패해도 뒤 작업은 계속 진행돼요.
   * 탭마다 대기열이 따로라서, 한 탭의 작업이 오래 걸려도 다른 탭은 기다리지 않아요.
   */
  let queue = Promise.resolve();
  function enqueue(item) {
    queue = queue.then(() => processItem(item)).catch(console.error);
  }

  // ─────────────────────────────────────────────
  // 3. 이미지 한 장 처리
  // ─────────────────────────────────────────────
  async function processItem(item) {
    if (!store.has(item)) return; // 차례를 기다리는 동안 삭제됨

    // AbortController: 작업을 중간에 멈추게 하는 표준 도구.
    // 사용자가 삭제하면 store.remove()가 abort()를 불러서 처리가 멈춰요.
    item.abort = new AbortController();
    try {
      const { outputs } = await process(item, settings.read(item.file), {
        signal: item.abort.signal,
        report: (msg) => showStatus(item, msg),
      });
      // await 하는 동안 시간이 흘렀으니, 그 사이 삭제됐는지 다시 확인
      if (!store.has(item)) return;

      store.setResults(item, outputs);
      showResult(item, preview);
    } catch (err) {
      if (!store.has(item)) return; // 삭제 때문에 중단된 거라 에러 아님
      // userMessage가 있으면 예상한 상황(너무 큰 이미지 등) → 경고만, 없으면 진짜 버그 → 에러
      if (err.userMessage) console.warn(err.message);
      else console.error(err);
      showStatus(item, err.userMessage || '이 이미지는 처리할 수 없어요 (지원하지 않는 형식일 수 있어요)');
    } finally {
      item.abort = null; // finally: 성공하든 실패하든 항상 실행
    }
    bar.update(store.all());
  }

  // ─────────────────────────────────────────────
  // 4. 선택 · 삭제
  // ─────────────────────────────────────────────
  function setSelected(item, on) {
    item.selected = on;
    setRowSelected(item, on);
    bar.updateSelection(store.all());
  }

  function removeItems(targets) {
    if (!targets.length) return;
    for (const it of targets) {
      closePreviewFor(it);
      it.el.remove(); // 화면에서 제거
    }
    store.remove(targets); // 데이터·메모리 정리
    refreshBar();
  }

  function refreshBar() {
    bar.update(store.all());
    bar.updateSelection(store.all());
  }

  // ─────────────────────────────────────────────
  // 5. 요약 영역 버튼들
  // ─────────────────────────────────────────────
  // data-action 속성으로 버튼을 찾아요 (탭마다 같은 버튼이 있어서 id를 못 씀)
  const action = (name) => root.querySelector(`[data-action="${name}"]`);

  action('select-all').addEventListener('change', (e) => {
    store.all().forEach((i) => { i.selected = e.target.checked; setRowSelected(i, i.selected); });
    bar.updateSelection(store.all());
  });
  action('delete-selected').addEventListener('click', () => removeItems(store.selected()));
  action('clear').addEventListener('click', () => removeItems([...store.all()]));
  // 현재 설정으로 전부 다시 대기열에 넣기
  action('reprocess').addEventListener('click', () => store.all().forEach(enqueue));

  const zipBtn = action('zip');
  const zipLabel = zipBtn.textContent;
  zipBtn.addEventListener('click', async () => {
    const outputs = store.all().filter((i) => i.results).flatMap((i) => i.results);
    if (!outputs.length) return;
    if (outputs.length === 1) return triggerDownload(outputs[0].url, outputs[0].name);

    zipBtn.disabled = true;
    zipBtn.textContent = 'ZIP 만드는 중…';
    try {
      const blob = await makeZip(outputs);
      const url = URL.createObjectURL(blob);
      triggerDownload(url, zipName);
      // 다운로드가 시작될 시간을 준 뒤 해제
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error(err);
      alert('ZIP을 만들지 못했어요. 개별 다운로드를 이용해주세요.');
    } finally {
      zipBtn.disabled = false;
      zipBtn.textContent = zipLabel;
    }
  });

  initDropzone(root, addFiles);

  // 바깥(main.js)에는 "파일 넣기"만 공개해요. 나머지는 이 탭 안의 비밀.
  return { addFiles };
}
