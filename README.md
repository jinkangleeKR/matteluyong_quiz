# 현장 퀴즈

QR 코드로 참가자가 접속하는 실시간 현장 퀴즈 사이트입니다.

## 참가자 QR 코드

아래 QR 코드를 스캔하면 참가자 대기 화면으로 이동합니다. 인쇄하거나 화면에 띄울 때는
SVG 원본을 사용하세요.

[QR 코드 원본 열기 / 내려받기](qr-code.svg)

![퀴즈 참가 QR 코드](qr-code.svg)

## 공개 주소

GitHub Pages를 통해 아래 주소로 공개됩니다.

`https://jinkangleekr.github.io/matteluyong_quiz/`

관리자 화면은 아래 주소입니다.

`https://jinkangleekr.github.io/matteluyong_quiz/admin.html`

## 현재 퀴즈 동작

- 퀴즈 버전마다 4문항과 각 문항의 정답 하나를 정의합니다.
- 관리자는 문제당 시간, 정답 점수, 최대 시간 점수를 정하고 5초 뒤 퀴즈를 시작합니다.
- `문제당 시간`이 끝나는 즉시 모든 참가자의 화면이 다음 문항으로 자동 전환됩니다.
- 정답 점수는 `정답 점수 + ceil(최대 시간 점수 × 남은 시간 비율)`입니다. 오답·미응답은 0점입니다.
- 참가자 화면에는 실시간 남은 시간 바가 표시됩니다.

## 퀴즈 버전 추가하기

[quiz-data.js](quiz-data.js)의 `quizVersions` 배열에 새 객체를 추가하면 관리자 화면의
퀴즈 버전 목록에 자동으로 나타납니다. 이미 진행한 버전의 문항을 수정하지 않고 새 `id`로
버전을 추가하면 과거 답안과 점수 계산이 안전하게 유지됩니다.

## 실시간 운영 설정 (Firebase)

GitHub Pages는 정적 웹 호스팅이므로, 서로 다른 휴대폰의 참가자와 관리자 화면을 실시간으로
연결하려면 Firebase 설정을 한 번 추가해야 합니다. 설정 전에도 관리자와 참가자 화면은 같은
브라우저의 탭에서 동작을 확인할 수 있는 **데모 모드**로 열립니다.

1. Firebase에서 프로젝트와 웹 앱을 만들고 **Realtime Database**를 생성합니다.
2. Authentication에서 **익명 로그인**과 **이메일/비밀번호 로그인**을 켭니다.
3. 웹 앱 설정값을 [firebase-config.js](firebase-config.js)에 넣고, 이메일/비밀번호로 만든
   관리자 계정의 UID를 `firebaseAdminUid`에 넣습니다.
4. [database.rules.json](database.rules.json)의 `REPLACE_WITH_ADMIN_UID`를 같은 UID로 바꾼 뒤,
   Firebase Realtime Database의 Rules 화면에 붙여 넣어 배포합니다.
5. 변경한 파일을 GitHub에 푸시하면 모든 기기에서 같은 시작 시각, 문제 순서, 타이머를 공유합니다.

`firebase-config.js`의 웹 설정값은 브라우저에 공개되어도 되는 식별 정보입니다. 대신 관리자 UID와
Database Rules가 관리자 제어 및 각 참가자의 단일 답안 제출을 보호합니다.

## 파일 구성

- `index.html`, `app.js`: 참가자 대기·문제·결과 화면
- `admin.html`, `admin.js`: 관리자 로그인, 시작·종료, 점수·시간 설정, 진행 모니터
- `quiz-data.js`: 여러 퀴즈 버전과 4문항 정의
- `realtime-store.js`: Firebase 실시간 저장소 및 같은 브라우저용 데모 저장소
- `database.rules.json`: Firebase Realtime Database 보안 규칙 템플릿
