# 현장 퀴즈

QR 코드로 참가자가 접속하는 퀴즈 사이트입니다. 현재는 참가자가 대기하는 첫 화면을 제공합니다.

## GitHub Pages로 공개하기

1. GitHub 저장소에서 **Settings → Pages**를 엽니다.
2. **Build and deployment**의 Source를 **Deploy from a branch**로 선택합니다.
3. Branch는 `main`, 폴더는 `/(root)`로 선택한 뒤 저장합니다.
4. 잠시 후 아래 주소에서 사이트가 열립니다.

   `https://jinkangleekr.github.io/matteluyong_quiz/`

5. 이 주소로 QR 코드를 만들면 참가자는 QR 촬영만으로 대기 화면에 들어올 수 있습니다.

## 다음 구현 항목

- 관리자 로그인 및 관리자 화면
- 퀴즈 시작·종료 상태의 실시간 반영
- 문제, 답안 제출, 결과 집계

`app.js`의 `quizState`는 임시 화면 상태입니다. 실제 관리자 기능을 만들 때 데이터베이스와 연결해 상태를 제어합니다.
