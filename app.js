/*
 * 현재는 화면 뼈대만 제공합니다.
 * 이후 관리자 화면 또는 백엔드에서 quizState 값을 받아
 * waiting | live | finished 상태로 바꾸면 됩니다.
 */
const quizState = "waiting";

const states = {
  waiting: {
    status: "퀴즈 시작을 기다리고 있어요",
    guide: "잠시만 기다려 주세요. 시작되면 버튼이 활성화됩니다.",
    enabled: false,
  },
  live: {
    status: "퀴즈가 진행 중이에요!",
    guide: "입장 버튼을 눌러 퀴즈에 참여해 주세요.",
    enabled: true,
  },
  finished: {
    status: "이번 퀴즈는 종료되었어요",
    guide: "참여해 주셔서 고마워요.",
    enabled: false,
  },
};

const currentState = states[quizState] || states.waiting;
const status = document.querySelector("#quiz-status");
const guide = document.querySelector("#guide-message");
const enterButton = document.querySelector("#enter-quiz");

status.textContent = currentState.status;
guide.textContent = currentState.guide;
enterButton.disabled = !currentState.enabled;

enterButton.addEventListener("click", () => {
  // 퀴즈 문제 페이지가 생기면 이 주소를 /quiz/ 로 연결합니다.
  window.location.href = "./quiz/";
});
