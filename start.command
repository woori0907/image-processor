#!/bin/zsh
# 더블클릭하면 로컬 서버를 켜고 브라우저로 사이트를 열어요. (macOS)
# 끄려면 열린 터미널 창에서 Ctrl + C 를 누르거나 창을 닫으면 돼요.

cd "$(dirname "$0")" || exit 1

# 8000번부터 비어 있는 포트 찾기
PORT=8000
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo "이미지 도구 실행 중 → http://localhost:$PORT"
echo "끄려면 Ctrl + C"
(sleep 1 && open "http://localhost:$PORT/") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
