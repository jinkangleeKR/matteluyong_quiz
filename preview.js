const adminFrame = document.querySelector("#admin-preview");
const participantFrame = document.querySelector("#participant-preview");
const resetButton = document.querySelector("#reset-preview");
const status = document.querySelector("#preview-status");

function isSameOriginQuizLink(value) {
  try {
    const link = new URL(value, window.location.href);
    return link.origin === window.location.origin && link.searchParams.get("room") && link.searchParams.get("demo") === "1";
  } catch (error) {
    return false;
  }
}

window.addEventListener("message", function (event) {
  if (event.origin !== window.location.origin || event.source !== adminFrame.contentWindow) { return; }
  const data = event.data || {};
  if (data.type !== "matteluyong-quiz-room" || !isSameOriginQuizLink(data.link)) { return; }
  if (participantFrame.src !== data.link) {
    participantFrame.src = data.link;
  }
  status.textContent = "게임방이 연결됐어요. 오른쪽에서 닉네임을 입력하고 참가자로 입장해 보세요.";
});

resetButton.addEventListener("click", function () {
  if (!window.confirm("이 브라우저의 테스트 퀴즈·게임방·닉네임을 초기화할까요?")) { return; }
  window.localStorage.removeItem("matteluyong.quiz.builder-data");
  window.localStorage.removeItem("matteluyong.quiz.player-id");
  window.localStorage.removeItem("matteluyong.quiz.player-name");
  adminFrame.src = "admin.html?demo=1";
  participantFrame.src = "index.html?demo=1";
  status.textContent = "테스트 데이터를 초기화했습니다. 새 퀴즈를 만들어 보세요.";
});
