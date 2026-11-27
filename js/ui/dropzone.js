/**
 * ui/dropzone.js — 파일을 받는 입구
 *
 * 탭 하나(root) 안의 드롭 영역을 담당해요:
 *   1. 클릭해서 파일 선택    (<input type="file">)
 *   2. 드롭 영역에 끌어다 놓기 (drag & drop)
 *
 * "페이지 아무 데나 놓기"와 "붙여넣기(⌘V)"는 페이지 전체에 하나뿐인 기능이라,
 * 지금 열린 탭을 아는 main.js가 따로 처리해요.
 *
 * 이 파일은 "파일을 받는 것"까지만 하고, 받은 파일로 뭘 할지는 몰라요.
 * 받은 파일은 onFiles(파일목록)로 넘겨요.
 *
 * @param {HTMLElement} root 탭 패널 요소
 * @param {(files: FileList|File[]) => void} onFiles
 */
export function initDropzone(root, onFiles) {
  const drop = root.querySelector('.drop');
  const input = drop.querySelector('input[type="file"]');

  input.addEventListener('change', () => {
    onFiles(input.files);
    input.value = ''; // 비워야 같은 파일을 다시 골라도 change 이벤트가 발생해요
  });

  // 키보드 사용자도 Enter/Space로 파일 선택 창을 열 수 있게 (접근성)
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  // 끌어다 놓는 중에는 테두리를 강조
  // preventDefault()를 해야 브라우저가 "여기에 놓을 수 있음"으로 인식해요
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => {
    e.preventDefault();
    drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    e.stopPropagation(); // 페이지 전체용 drop 처리(main.js)로 또 전달되지 않게
    onFiles(e.dataTransfer.files);
  });
}
