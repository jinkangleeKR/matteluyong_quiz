import { calculateAnswerScore, isCorrectAnswer, isShortAnswerQuestion } from "./quiz-data.js";
import { createQuizClient, createQuizId } from "./realtime-store.js";

const elements = {
  notice: document.querySelector("#admin-notice"),
  login: document.querySelector("#admin-login"),
  loginForm: document.querySelector("#login-form"),
  loginMessage: document.querySelector("#login-message"),
  email: document.querySelector("#admin-email"),
  password: document.querySelector("#admin-password"),
  signUp: document.querySelector("#sign-up"),
  dashboard: document.querySelector("#admin-dashboard"),
  userEmail: document.querySelector("#admin-user-email"),
  signOut: document.querySelector("#sign-out"),
  tabs: Array.from(document.querySelectorAll(".admin-tab")),
  builderTab: document.querySelector("#builder-tab"),
  gameTab: document.querySelector("#game-tab"),
  editorTitle: document.querySelector("#editor-title"),
  quizTitle: document.querySelector("#quiz-title"),
  quizDescription: document.querySelector("#quiz-description"),
  questionEditor: document.querySelector("#question-editor"),
  questionCountBadge: document.querySelector("#question-count-badge"),
  addQuestion: document.querySelector("#add-question"),
  saveQuiz: document.querySelector("#save-quiz"),
  newQuiz: document.querySelector("#new-quiz"),
  quizEditorMessage: document.querySelector("#quiz-editor-message"),
  savedQuizCount: document.querySelector("#saved-quiz-count"),
  savedQuizList: document.querySelector("#saved-quiz-list"),
  savedQuizEmpty: document.querySelector("#saved-quiz-empty"),
  roomQuizSelect: document.querySelector("#room-quiz-select"),
  editSelectedQuiz: document.querySelector("#edit-selected-quiz"),
  duration: document.querySelector("#question-duration"),
  basePoints: document.querySelector("#base-points"),
  speedPoints: document.querySelector("#speed-points"),
  createRoom: document.querySelector("#create-room"),
  roomSetupMessage: document.querySelector("#room-setup-message"),
  roomCount: document.querySelector("#room-count"),
  roomList: document.querySelector("#room-list"),
  roomListEmpty: document.querySelector("#room-list-empty"),
  shareEmpty: document.querySelector("#room-share-empty"),
  shareContent: document.querySelector("#room-share-content"),
  selectedRoomState: document.querySelector("#selected-room-state"),
  selectedRoomTitle: document.querySelector("#selected-room-title"),
  roomQr: document.querySelector("#room-qr"),
  roomLink: document.querySelector("#room-link"),
  copyRoomLink: document.querySelector("#copy-room-link"),
  copyRoomMessage: document.querySelector("#copy-room-message"),
  controlSection: document.querySelector("#room-control-section"),
  lobbySection: document.querySelector("#room-lobby-section"),
  scoreSection: document.querySelector("#room-score-section"),
  stateBadge: document.querySelector("#game-state-badge"),
  monitorTitle: document.querySelector("#monitor-title"),
  monitorTimer: document.querySelector("#monitor-timer"),
  monitorSubtitle: document.querySelector("#monitor-subtitle"),
  monitorTimerBar: document.querySelector("#monitor-timer-bar"),
  monitorQuestion: document.querySelector("#monitor-question"),
  answerCount: document.querySelector("#answer-count"),
  start: document.querySelector("#start-game"),
  stop: document.querySelector("#stop-game"),
  reveal: document.querySelector("#reveal-results"),
  reset: document.querySelector("#reset-room"),
  deleteRoom: document.querySelector("#delete-room"),
  actionMessage: document.querySelector("#room-action-message"),
  lobbyCount: document.querySelector("#lobby-count"),
  lobbyHelp: document.querySelector("#lobby-help"),
  lobbyList: document.querySelector("#lobby-list"),
  lobbyEmpty: document.querySelector("#lobby-empty"),
  adminChatCount: document.querySelector("#admin-chat-count"),
  adminChatMessages: document.querySelector("#admin-chat-messages"),
  scoreboardCount: document.querySelector("#scoreboard-count"),
  scoreboardBody: document.querySelector("#scoreboard-body"),
  scoreboardEmpty: document.querySelector("#scoreboard-empty"),
};

let client;
let dashboardReady = false;
let savedQuizzes = {};
let ownedRooms = {};
let editorQuiz = createBlankQuiz();
let selectedRoomId = "";
let activeRoom = null;
let activeRoomSecret = null;
let activeAnswers = {};
let activeLobby = {};
let waitingChat = {};
let kickingParticipantId = "";
let isRevealing = false;
let unsubscribeQuizzes = function () {};
let unsubscribeRooms = function () {};
let unsubscribeRoomState = function () {};
let unsubscribeRoomSecrets = function () {};
let unsubscribeRoomAnswers = function () {};
let unsubscribeRoomLobby = function () {};
let unsubscribeRoomChat = function () {};

function createBlankQuiz() {
  return {
    id: createQuizId(),
    title: "",
    description: "",
    questions: [createQuestion()],
  };
}

function createQuestion() {
  return {
    id: createQuizId().replace("quiz-", "question-"),
    type: "multiple-choice",
    prompt: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    acceptedAnswers: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function formatDate(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) { return "방금 생성"; }
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(time));
}

function limitNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function getQuizEntries() {
  return Object.values(savedQuizzes).sort(function (first, second) {
    return (Number(second.updatedAt) || 0) - (Number(first.updatedAt) || 0);
  });
}

function createPublicQuizSnapshot(quiz) {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description || "",
    questions: quiz.questions.map(function (question) {
      const type = isShortAnswerQuestion(question) ? "short-answer" : "multiple-choice";
      return { id: question.id, type: type, prompt: question.prompt, options: type === "multiple-choice" ? question.options : [] };
    }),
  };
}

function getAnswerKeyEntry(answerKey, index) {
  if (Array.isArray(answerKey)) { return answerKey[index]; }
  if (answerKey && typeof answerKey === "object") { return answerKey[String(index)] || answerKey[index]; }
  return null;
}

function getAnswerList(value) {
  if (Array.isArray(value)) { return value; }
  if (value && typeof value === "object") { return Object.values(value); }
  return typeof value === "string" ? [value] : [];
}

function questionForScoring(question, index) {
  const answerKey = activeRoomSecret && activeRoomSecret.answerKey;
  const key = getAnswerKeyEntry(answerKey, index);
  if (isShortAnswerQuestion(question)) {
    const acceptedAnswers = getAnswerList(key && typeof key === "object" && !Array.isArray(key) ? key.acceptedAnswers : key);
    return Object.assign({}, question, { type: "short-answer", acceptedAnswers: acceptedAnswers });
  }
  const correctIndex = typeof key === "number" ? key : key && Number.isFinite(Number(key.correctIndex)) ? Number(key.correctIndex) : -1;
  return Object.assign({}, question, { type: "multiple-choice", correctIndex: correctIndex });
}

function getPhase(room) {
  if (!room || room.status === "waiting") { return { state: "waiting" }; }
  const quiz = room.quizSnapshot;
  if (!quiz || !Array.isArray(quiz.questions)) { return { state: "error" }; }
  if (room.status === "finished") { return { state: "finished", quiz: quiz }; }
  const startsIn = Number(room.startAt) - client.now();
  if (startsIn > 0) { return { state: "starting", quiz: quiz, startsIn: startsIn }; }
  const durationMs = Number(room.questionDurationSec) * 1000;
  const elapsed = Math.max(0, client.now() - Number(room.startAt));
  const questionIndex = Math.floor(elapsed / durationMs);
  if (questionIndex >= quiz.questions.length) { return { state: "finished", quiz: quiz }; }
  const questionElapsed = elapsed - questionIndex * durationMs;
  return { state: "question", quiz: quiz, questionIndex: questionIndex, remainingMs: Math.max(0, durationMs - questionElapsed), durationMs: durationMs };
}

function setStateBadge(label, state) {
  elements.stateBadge.textContent = label;
  elements.stateBadge.className = "state-badge " + state;
}

function roomParticipantLink(id) {
  const url = new URL("./", window.location.href);
  if (new URLSearchParams(window.location.search).get("demo") === "1") {
    url.searchParams.set("demo", "1");
  }
  url.searchParams.set("room", id);
  return url.toString();
}

function shareRoomWithPreview(link, id) {
  if (window.parent !== window) {
    window.parent.postMessage({ type: "matteluyong-quiz-room", link: link, roomId: id }, window.location.origin);
  }
}

function renderTabs(tab) {
  elements.tabs.forEach(function (button) {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  elements.builderTab.hidden = tab !== "builder";
  elements.gameTab.hidden = tab !== "game";
}

function renderQuestionEditor() {
  elements.questionEditor.replaceChildren();
  editorQuiz.questions.forEach(function (question, questionIndex) {
    const card = document.createElement("fieldset");
    const legend = document.createElement("legend");
    const topRow = document.createElement("div");
    const typeLabel = document.createElement("label");
    const typeText = document.createElement("span");
    const typeSelect = document.createElement("select");
    const remove = document.createElement("button");
    const prompt = document.createElement("input");
    const isShortAnswer = isShortAnswerQuestion(question);
    card.className = "question-edit-card";
    legend.textContent = "문항 " + (questionIndex + 1);
    topRow.className = "question-edit-top-row";
    typeLabel.className = "question-type-field";
    typeText.textContent = "문제 유형";
    [
      ["multiple-choice", "객관식 (4지선다)"],
      ["short-answer", "주관식"],
    ].forEach(function (entry) {
      const option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      typeSelect.append(option);
    });
    typeSelect.value = isShortAnswer ? "short-answer" : "multiple-choice";
    typeSelect.addEventListener("change", function () {
      editorQuiz.questions[questionIndex].type = typeSelect.value;
      renderQuestionEditor();
    });
    typeLabel.append(typeText, typeSelect);
    remove.type = "button";
    remove.className = "quiet-button compact-button question-remove-button";
    remove.textContent = "문항 삭제";
    remove.disabled = editorQuiz.questions.length === 1;
    remove.addEventListener("click", function () {
      editorQuiz.questions.splice(questionIndex, 1);
      renderEditor();
    });
    topRow.append(typeLabel, remove);
    prompt.type = "text";
    prompt.className = "question-prompt-input";
    prompt.maxLength = 240;
    prompt.placeholder = "문제를 입력하세요";
    prompt.value = question.prompt;
    prompt.addEventListener("input", function () { editorQuiz.questions[questionIndex].prompt = prompt.value; });
    card.append(legend, topRow, prompt);
    if (isShortAnswer) {
      const answerRow = document.createElement("label");
      const answerLabel = document.createElement("span");
      const answerInput = document.createElement("input");
      const help = document.createElement("p");
      answerRow.className = "short-answer-key-row";
      answerLabel.textContent = "정답";
      answerInput.type = "text";
      answerInput.maxLength = 240;
      answerInput.placeholder = "예: 서울, Seoul";
      answerInput.value = (Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : []).join(", ");
      answerInput.addEventListener("input", function () {
        editorQuiz.questions[questionIndex].acceptedAnswers = answerInput.value.split(",").map(function (value) { return value.trim(); }).filter(Boolean);
      });
      help.className = "field-help short-answer-help";
      help.textContent = "여러 정답은 쉼표(,)로 나눠 입력하세요. 공백과 대소문자는 구분하지 않습니다.";
      answerRow.append(answerLabel, answerInput);
      card.append(answerRow, help);
    } else {
      const options = document.createElement("div");
      const answerRow = document.createElement("label");
      const answerLabel = document.createElement("span");
      const answerSelect = document.createElement("select");
      question.options = Array.from({ length: 4 }, function (_, optionIndex) { return (question.options || [])[optionIndex] || ""; });
      options.className = "option-edit-grid";
      question.options.forEach(function (option, optionIndex) {
        const label = document.createElement("label");
        const marker = document.createElement("span");
        const input = document.createElement("input");
        marker.textContent = String.fromCharCode(65 + optionIndex);
        input.type = "text";
        input.maxLength = 120;
        input.placeholder = "보기 " + String.fromCharCode(65 + optionIndex);
        input.value = option;
        input.addEventListener("input", function () { editorQuiz.questions[questionIndex].options[optionIndex] = input.value; });
        label.append(marker, input);
        options.append(label);
      });
      answerLabel.textContent = "정답";
      for (let index = 0; index < 4; index += 1) {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = String.fromCharCode(65 + index) + "번";
        answerSelect.append(option);
      }
      answerSelect.value = String(Number(question.correctIndex) || 0);
      answerSelect.addEventListener("change", function () { editorQuiz.questions[questionIndex].correctIndex = Number(answerSelect.value); });
      answerRow.className = "answer-key-row";
      answerRow.append(answerLabel, answerSelect);
      card.append(options, answerRow);
    }
    elements.questionEditor.append(card);
  });
}

function renderEditor() {
  elements.editorTitle.textContent = savedQuizzes[editorQuiz.id] ? "퀴즈 수정하기" : "새 퀴즈 만들기";
  elements.quizTitle.value = editorQuiz.title || "";
  elements.quizDescription.value = editorQuiz.description || "";
  elements.questionCountBadge.textContent = editorQuiz.questions.length + "문항";
  renderQuestionEditor();
}

function renderSavedQuizzes() {
  const quizzes = getQuizEntries();
  elements.savedQuizCount.textContent = quizzes.length + "개";
  elements.savedQuizCount.className = "state-badge " + (quizzes.length ? "live" : "waiting");
  elements.savedQuizList.replaceChildren();
  elements.savedQuizEmpty.hidden = quizzes.length > 0;
  quizzes.forEach(function (quiz) {
    const item = document.createElement("article");
    const text = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const actions = document.createElement("div");
    const edit = document.createElement("button");
    const remove = document.createElement("button");
    item.className = "saved-item";
    title.textContent = quiz.title || "제목 없는 퀴즈";
    meta.textContent = quiz.questions.length + "문항 · " + formatDate(quiz.updatedAt || quiz.createdAt);
    edit.type = "button";
    edit.className = "quiet-button compact-button";
    edit.textContent = "수정";
    edit.addEventListener("click", function () { openQuizEditor(quiz); });
    remove.type = "button";
    remove.className = "danger-button compact-button";
    remove.textContent = "삭제";
    remove.addEventListener("click", function () { deleteQuiz(quiz); });
    text.append(title, meta);
    actions.append(edit, remove);
    item.append(text, actions);
    elements.savedQuizList.append(item);
  });
}

function renderRoomQuizSelect() {
  const previous = elements.roomQuizSelect.value;
  const quizzes = getQuizEntries();
  elements.roomQuizSelect.replaceChildren();
  if (!quizzes.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "먼저 퀴즈를 저장해 주세요";
    elements.roomQuizSelect.append(option);
    elements.createRoom.disabled = true;
    elements.editSelectedQuiz.disabled = true;
    return;
  }
  quizzes.forEach(function (quiz) {
    const option = document.createElement("option");
    option.value = quiz.id;
    option.textContent = quiz.title + " · " + quiz.questions.length + "문항";
    elements.roomQuizSelect.append(option);
  });
  elements.roomQuizSelect.value = quizzes.some(function (quiz) { return quiz.id === previous; }) ? previous : quizzes[0].id;
  elements.createRoom.disabled = false;
  elements.editSelectedQuiz.disabled = false;
}

function openQuizEditor(quiz) {
  if (!quiz) { return; }
  editorQuiz = clone(quiz);
  elements.quizEditorMessage.textContent = "";
  renderEditor();
  renderTabs("builder");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRoomList() {
  const rooms = Object.entries(ownedRooms).sort(function (first, second) {
    return (Number(second[1].updatedAt || second[1].createdAt) || 0) - (Number(first[1].updatedAt || first[1].createdAt) || 0);
  });
  elements.roomCount.textContent = rooms.length + "개";
  elements.roomCount.className = "state-badge " + (rooms.length ? "live" : "waiting");
  elements.roomList.replaceChildren();
  elements.roomListEmpty.hidden = rooms.length > 0;
  rooms.forEach(function (entry) {
    const roomId = entry[0];
    const summary = entry[1] || {};
    const item = document.createElement("article");
    const text = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const select = document.createElement("button");
    item.className = "saved-item" + (roomId === selectedRoomId ? " selected-room" : "");
    title.textContent = summary.title || "제목 없는 게임방";
    meta.textContent = roomStatusLabel(summary.status) + " · " + formatDate(summary.updatedAt || summary.createdAt);
    select.type = "button";
    select.className = "primary-button compact-button";
    select.textContent = roomId === selectedRoomId ? "선택됨" : "열기";
    select.addEventListener("click", function () { selectRoom(roomId); });
    text.append(title, meta);
    item.append(text, select);
    elements.roomList.append(item);
  });
}

function roomStatusLabel(status) {
  if (status === "live") { return "진행 중"; }
  if (status === "finished") { return "종료"; }
  return "대기 중";
}

function renderSelectedRoom() {
  const hasRoom = Boolean(activeRoom && selectedRoomId);
  elements.shareEmpty.hidden = hasRoom;
  elements.shareContent.hidden = !hasRoom;
  elements.controlSection.hidden = !hasRoom;
  elements.lobbySection.hidden = !hasRoom;
  elements.scoreSection.hidden = !hasRoom;
  if (!hasRoom) {
    elements.selectedRoomState.textContent = "방 선택 필요";
    elements.selectedRoomState.className = "state-badge waiting";
    return;
  }
  const link = roomParticipantLink(selectedRoomId);
  const phase = getPhase(activeRoom);
  elements.selectedRoomTitle.textContent = activeRoom.title || "제목 없는 퀴즈";
  elements.roomLink.value = link;
  shareRoomWithPreview(link, selectedRoomId);
  elements.roomQr.src = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=" + encodeURIComponent(link);
  elements.selectedRoomState.textContent = roomStatusLabel(activeRoom.status);
  elements.selectedRoomState.className = "state-badge " + (phase.state === "question" ? "live" : phase.state === "finished" ? "finished" : "waiting");
  renderMonitor();
  renderLobby();
  renderScoreboard();
}

function countCurrentAnswers(questionIndex) {
  if (typeof questionIndex !== "number") { return 0; }
  return Object.keys(activeAnswers).filter(function (playerId) { return Boolean(activeAnswers[playerId] && activeAnswers[playerId][questionIndex]); }).length;
}

function getLeaderboard() {
  if (!activeRoom || !activeRoom.quizSnapshot) { return []; }
  return Object.keys(activeAnswers).map(function (playerId) {
    const answers = activeAnswers[playerId] || {};
    let name = "참가자";
    let score = 0;
    let correct = 0;
    activeRoom.quizSnapshot.questions.forEach(function (question, index) {
      const answer = answers[String(index)];
      if (!answer) { return; }
      if (answer.playerName) { name = answer.playerName; }
      const scoredQuestion = questionForScoring(question, index);
      score += calculateAnswerScore(answer, scoredQuestion, activeRoom, index);
      if (isCorrectAnswer(answer, scoredQuestion)) { correct += 1; }
    });
    return { id: playerId, name: name, score: score, correct: correct };
  }).sort(function (first, second) {
    return second.score - first.score || second.correct - first.correct || first.name.localeCompare(second.name, "ko");
  });
}

function renderScoreboard() {
  const leaderboard = getLeaderboard();
  elements.scoreboardCount.textContent = leaderboard.length + "명";
  elements.scoreboardCount.className = "state-badge " + (leaderboard.length ? "live" : "waiting");
  elements.scoreboardBody.replaceChildren();
  elements.scoreboardEmpty.hidden = leaderboard.length > 0;
  leaderboard.forEach(function (player, index) {
    const row = document.createElement("tr");
    [String(index + 1), player.name, player.correct + " / " + activeRoom.quizSnapshot.questions.length, player.score.toLocaleString("ko-KR") + "점"].forEach(function (value) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    elements.scoreboardBody.append(row);
  });
}

function renderResultRevealControl(phase) {
  const revealAt = Number(activeRoom && activeRoom.resultsRevealAt);
  if (!activeRoom || !activeRoom.id) {
    elements.reveal.disabled = true;
    return;
  }
  if (Number.isFinite(revealAt) && revealAt > 0) {
    elements.reveal.textContent = client.now() < revealAt ? "결과 공개 카운트 중" : "결과 공개 완료";
    elements.reveal.disabled = true;
    return;
  }
  const hasAnswerKey = Boolean(activeRoomSecret && activeRoomSecret.answerKey && Object.keys(activeRoomSecret.answerKey).length);
  elements.reveal.textContent = hasAnswerKey ? "결과 공개 (3초 카운트)" : "정답 정보 불러오는 중";
  elements.reveal.disabled = phase.state !== "finished" || isRevealing || !hasAnswerKey;
}

function renderMonitor() {
  if (!activeRoom) { return; }
  const phase = getPhase(activeRoom);
  elements.monitorTimerBar.style.width = "0%";
  renderResultRevealControl(phase);
  if (phase.state === "waiting") {
    setStateBadge("대기 중", "waiting");
    elements.monitorTitle.textContent = "참가자 입장을 기다리고 있어요";
    elements.monitorTimer.textContent = "--:--";
    elements.monitorSubtitle.textContent = "QR 링크를 공유한 뒤 시작 버튼을 눌러 주세요.";
    elements.monitorQuestion.textContent = "- / -";
    elements.answerCount.textContent = "0";
    return;
  }
  if (phase.state === "starting") {
    setStateBadge("시작 준비", "starting");
    elements.monitorTitle.textContent = activeRoom.title;
    elements.monitorTimer.textContent = formatSeconds(phase.startsIn);
    elements.monitorSubtitle.textContent = "첫 문제가 동시에 열릴 때까지 남은 시간";
    elements.monitorQuestion.textContent = "시작 전";
    elements.answerCount.textContent = "0";
    return;
  }
  if (phase.state === "question") {
    setStateBadge("진행 중", "live");
    elements.monitorTitle.textContent = "문제 " + (phase.questionIndex + 1) + " 진행 중";
    elements.monitorTimer.textContent = formatSeconds(phase.remainingMs);
    elements.monitorSubtitle.textContent = "시간이 끝나면 모든 참가자가 자동으로 다음 문제로 이동합니다.";
    elements.monitorQuestion.textContent = phase.questionIndex + 1 + " / " + phase.quiz.questions.length;
    elements.answerCount.textContent = countCurrentAnswers(phase.questionIndex) + "";
    elements.monitorTimerBar.style.width = (phase.remainingMs / phase.durationMs) * 100 + "%";
    return;
  }
  setStateBadge(phase.state === "error" ? "설정 오류" : "종료", "finished");
  elements.monitorTitle.textContent = phase.state === "error" ? "퀴즈 정보를 찾지 못했습니다" : "퀴즈가 종료됐어요";
  elements.monitorTimer.textContent = phase.state === "error" ? "--:--" : "DONE";
  elements.monitorSubtitle.textContent = phase.state === "error" ? "게임방을 새로 만들어 주세요." : "결과를 공개하거나 새 대기실을 열 수 있습니다.";
  elements.monitorQuestion.textContent = phase.quiz ? phase.quiz.questions.length + " / " + phase.quiz.questions.length : "- / -";
  elements.answerCount.textContent = Object.keys(activeAnswers).length + "";
}

function renderLobby() {
  if (!activeRoom) { return; }
  const phase = getPhase(activeRoom);
  const waiting = phase.state === "waiting";
  const participants = Object.entries(activeLobby).sort(function (first, second) { return (Number(first[1].joinedAt) || 0) - (Number(second[1].joinedAt) || 0); });
  elements.lobbyCount.textContent = participants.length + "명";
  elements.lobbyCount.className = "state-badge " + (participants.length ? "live" : "waiting");
  elements.lobbyHelp.textContent = waiting ? "대기 중인 참가자는 여기에서 확인하고 내보낼 수 있습니다." : "게임 진행 중에는 대기실 채팅과 내보내기 기능이 잠시 꺼집니다.";
  elements.lobbyList.replaceChildren();
  elements.lobbyEmpty.hidden = participants.length > 0;
  participants.forEach(function (entry) {
    const uid = entry[0];
    const participant = entry[1] || {};
    const item = document.createElement("li");
    const info = document.createElement("div");
    const name = document.createElement("strong");
    const time = document.createElement("span");
    const kick = document.createElement("button");
    item.className = "lobby-participant";
    name.textContent = participant.name || "참가자";
    time.textContent = formatDate(participant.joinedAt) + " 입장";
    kick.type = "button";
    kick.className = "kick-button";
    kick.textContent = kickingParticipantId === uid ? "내보내는 중" : "내보내기";
    kick.disabled = !waiting || Boolean(kickingParticipantId);
    kick.addEventListener("click", function () { kickParticipant(uid, participant.name || "참가자"); });
    info.append(name, time);
    item.append(info, kick);
    elements.lobbyList.append(item);
  });
  renderAdminChat();
}

function renderAdminChat() {
  const messages = Object.entries(waitingChat).sort(function (first, second) { return (Number(first[1].sentAt) || 0) - (Number(second[1].sentAt) || 0); }).slice(-100);
  elements.adminChatCount.textContent = messages.length + "개";
  elements.adminChatCount.className = "state-badge " + (messages.length ? "live" : "waiting");
  elements.adminChatMessages.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "아직 채팅이 없습니다.";
    elements.adminChatMessages.append(empty);
    return;
  }
  messages.forEach(function (entry) {
    const message = entry[1];
    const item = document.createElement("article");
    const meta = document.createElement("p");
    const name = document.createElement("strong");
    const time = document.createElement("span");
    const text = document.createElement("p");
    item.className = "chat-message";
    name.textContent = message.playerName || "참가자";
    time.textContent = formatDate(message.sentAt);
    text.textContent = message.text || "";
    meta.append(name, time);
    item.append(meta, text);
    elements.adminChatMessages.append(item);
  });
}

async function saveQuiz() {
  const quiz = clone(editorQuiz);
  quiz.title = elements.quizTitle.value.trim();
  quiz.description = elements.quizDescription.value.trim();
  if (!quiz.title) { elements.quizEditorMessage.textContent = "퀴즈 이름을 입력해 주세요."; elements.quizTitle.focus(); return; }
  for (let index = 0; index < quiz.questions.length; index += 1) {
    const question = quiz.questions[index];
    question.type = isShortAnswerQuestion(question) ? "short-answer" : "multiple-choice";
    if (!question.prompt.trim()) {
      elements.quizEditorMessage.textContent = "문항 " + (index + 1) + "의 문제를 입력해 주세요.";
      return;
    }
    question.prompt = question.prompt.trim();
    if (question.type === "short-answer") {
      question.acceptedAnswers = (Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : []).map(function (answer) { return answer.trim(); }).filter(Boolean);
      if (!question.acceptedAnswers.length) {
        elements.quizEditorMessage.textContent = "주관식 문항 " + (index + 1) + "의 정답을 하나 이상 입력해 주세요.";
        return;
      }
      question.options = [];
    } else {
      question.options = Array.from({ length: 4 }, function (_, optionIndex) { return (question.options || [])[optionIndex] || ""; }).map(function (option) { return option.trim(); });
      if (question.options.some(function (option) { return !option; })) {
        elements.quizEditorMessage.textContent = "객관식 문항 " + (index + 1) + "의 보기 4개를 모두 입력해 주세요.";
        return;
      }
      question.correctIndex = limitNumber(question.correctIndex, 0, 3, 0);
      question.acceptedAnswers = [];
    }
  }
  quiz.createdAt = savedQuizzes[quiz.id] ? savedQuizzes[quiz.id].createdAt : client.now();
  elements.saveQuiz.disabled = true;
  try {
    await client.saveQuiz(quiz);
    editorQuiz = clone(quiz);
    elements.quizEditorMessage.textContent = "저장했습니다. 게임 진행 탭에서 이 퀴즈를 선택할 수 있어요.";
  } catch (error) {
    elements.quizEditorMessage.textContent = error.message || "퀴즈를 저장하지 못했습니다.";
  } finally {
    elements.saveQuiz.disabled = false;
  }
}

async function deleteQuiz(quiz) {
  if (!window.confirm("'" + quiz.title + "' 퀴즈를 삭제할까요? 이미 만든 게임방의 문제는 그대로 유지됩니다.")) { return; }
  try {
    await client.deleteQuiz(quiz.id);
    if (editorQuiz.id === quiz.id) { editorQuiz = createBlankQuiz(); renderEditor(); }
  } catch (error) {
    elements.quizEditorMessage.textContent = error.message || "퀴즈를 삭제하지 못했습니다.";
  }
}

async function createRoom() {
  const quiz = savedQuizzes[elements.roomQuizSelect.value];
  if (!quiz) { elements.roomSetupMessage.textContent = "먼저 저장한 퀴즈를 선택해 주세요."; return; }
  const duration = limitNumber(elements.duration.value, 5, 600, 20);
  const basePoints = limitNumber(elements.basePoints.value, 0, 10000, 100);
  const speedPoints = limitNumber(elements.speedPoints.value, 0, 10000, 100);
  elements.createRoom.disabled = true;
  try {
    const state = await client.createRoom({
      title: quiz.title,
      quizId: quiz.id,
      quizSnapshot: createPublicQuizSnapshot(quiz),
      status: "waiting",
      questionDurationSec: duration,
      basePoints: basePoints,
      speedPoints: speedPoints,
      questionCount: quiz.questions.length,
      resultsRevealAt: null,
      revealedAnswerKey: null,
    }, {
      answerKey: Object.fromEntries(quiz.questions.map(function (question, index) {
        return [String(index), isShortAnswerQuestion(question)
          ? { type: "short-answer", acceptedAnswers: question.acceptedAnswers }
          : { type: "multiple-choice", correctIndex: question.correctIndex }];
      })),
    });
    elements.roomSetupMessage.textContent = "새 게임방을 만들었습니다. QR 코드 또는 링크를 공유하세요.";
    selectRoom(state.id);
  } catch (error) {
    elements.roomSetupMessage.textContent = error.message || "게임방을 만들지 못했습니다.";
  } finally {
    elements.createRoom.disabled = false;
  }
}

function clearRoomSubscriptions() {
  unsubscribeRoomState();
  unsubscribeRoomSecrets();
  unsubscribeRoomAnswers();
  unsubscribeRoomLobby();
  unsubscribeRoomChat();
  unsubscribeRoomState = function () {};
  unsubscribeRoomSecrets = function () {};
  unsubscribeRoomAnswers = function () {};
  unsubscribeRoomLobby = function () {};
  unsubscribeRoomChat = function () {};
}

function selectRoom(roomId) {
  clearRoomSubscriptions();
  selectedRoomId = roomId;
  activeRoom = null;
  activeRoomSecret = null;
  activeAnswers = {};
  activeLobby = {};
  waitingChat = {};
  renderRoomList();
  renderSelectedRoom();
  unsubscribeRoomState = client.subscribeRoomState(roomId, function (state) {
    activeRoom = state;
    renderSelectedRoom();
  });
  unsubscribeRoomSecrets = client.subscribeRoomSecrets(roomId, function (secret) {
    activeRoomSecret = secret;
    renderResultRevealControl(getPhase(activeRoom));
    renderScoreboard();
  });
  unsubscribeRoomAnswers = client.subscribeRoomAnswers(roomId, function (answers) {
    activeAnswers = answers || {};
    renderMonitor();
    renderScoreboard();
  });
  unsubscribeRoomLobby = client.subscribeRoomLobby(roomId, function (lobby) {
    activeLobby = lobby || {};
    renderLobby();
  });
  unsubscribeRoomChat = client.subscribeRoomWaitingChat(roomId, function (messages) {
    waitingChat = messages || {};
    renderAdminChat();
  });
}

async function startGame() {
  if (!activeRoom || !selectedRoomId) { return; }
  const startAt = client.now() + 5000;
  const questionCount = activeRoom.quizSnapshot && activeRoom.quizSnapshot.questions ? activeRoom.quizSnapshot.questions.length : 0;
  const endsAt = startAt + Number(activeRoom.questionDurationSec) * 1000 * questionCount;
  try {
    await client.saveRoomState(selectedRoomId, Object.assign({}, activeRoom, { status: "live", startAt: startAt, endsAt: endsAt, resultsRevealAt: null, revealedAnswerKey: null }));
    elements.actionMessage.textContent = "5초 후 모든 참가자에게 첫 문제가 동시에 열립니다.";
  } catch (error) { elements.actionMessage.textContent = error.message || "퀴즈를 시작하지 못했습니다."; }
}

async function stopGame() {
  if (!activeRoom || !selectedRoomId) { return; }
  try {
    await client.saveRoomState(selectedRoomId, Object.assign({}, activeRoom, { status: "finished", finishedAt: client.now() }));
    elements.actionMessage.textContent = "퀴즈를 종료했습니다. 원하는 때에 결과 공개 버튼을 누르세요.";
  } catch (error) { elements.actionMessage.textContent = error.message || "퀴즈를 종료하지 못했습니다."; }
}

async function revealResults() {
  const phase = getPhase(activeRoom);
  if (!activeRoom || !selectedRoomId || phase.state !== "finished" || activeRoom.resultsRevealAt) { return; }
  isRevealing = true;
  renderResultRevealControl(phase);
  try {
    await client.saveRoomState(selectedRoomId, Object.assign({}, activeRoom, {
      status: "finished",
      finishedAt: activeRoom.finishedAt || client.now(),
      resultsRevealAt: client.now() + 3200,
      revealedAnswerKey: activeRoomSecret.answerKey,
    }));
    elements.actionMessage.textContent = "참가자 화면에서 3, 2, 1 카운트 후 결과가 공개됩니다.";
  } catch (error) { elements.actionMessage.textContent = error.message || "결과를 공개하지 못했습니다."; }
  finally { isRevealing = false; renderMonitor(); }
}

async function resetRoom() {
  if (!activeRoom || !selectedRoomId) { return; }
  if (!window.confirm("새 대기실을 열까요? 이전 참가자·채팅·답안은 초기화됩니다.")) { return; }
  try {
    await client.resetRoom(selectedRoomId, activeRoom);
    elements.actionMessage.textContent = "새 대기실을 열었습니다. QR 링크는 그대로 사용할 수 있습니다.";
  } catch (error) { elements.actionMessage.textContent = error.message || "초기화하지 못했습니다."; }
}

async function deleteSelectedRoom() {
  if (!activeRoom || !selectedRoomId || !window.confirm("이 게임방과 참가 기록을 완전히 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) { return; }
  try {
    await client.deleteRoom(selectedRoomId);
    clearRoomSubscriptions();
    selectedRoomId = "";
    activeRoom = null;
    activeRoomSecret = null;
    activeAnswers = {};
    activeLobby = {};
    waitingChat = {};
    renderRoomList();
    renderSelectedRoom();
  } catch (error) { elements.actionMessage.textContent = error.message || "게임방을 삭제하지 못했습니다."; }
}

async function kickParticipant(uid, name) {
  if (!activeRoom || getPhase(activeRoom).state !== "waiting" || kickingParticipantId) { return; }
  kickingParticipantId = uid;
  renderLobby();
  try {
    await client.kickRoomParticipant(selectedRoomId, uid, name);
    elements.actionMessage.textContent = name + " 님을 대기실에서 내보냈습니다.";
  } catch (error) { elements.actionMessage.textContent = error.message || "참가자를 내보내지 못했습니다."; }
  finally { kickingParticipantId = ""; renderLobby(); }
}

async function copyRoomLink() {
  const value = elements.roomLink.value;
  try {
    await navigator.clipboard.writeText(value);
    elements.copyRoomMessage.textContent = "링크를 복사했습니다.";
  } catch (error) {
    elements.roomLink.select();
    document.execCommand("copy");
    elements.copyRoomMessage.textContent = "링크를 복사했습니다.";
  }
}

function showDashboard() {
  if (dashboardReady) { return; }
  dashboardReady = true;
  elements.login.hidden = true;
  elements.dashboard.hidden = false;
  const user = client.getUser();
  elements.userEmail.textContent = user && user.email ? user.email : "데모 관리자";
  renderEditor();
  renderTabs("builder");
  unsubscribeQuizzes = client.subscribeOwnedQuizzes(function (quizzes) {
    savedQuizzes = quizzes || {};
    renderSavedQuizzes();
    renderRoomQuizSelect();
    renderEditor();
  });
  unsubscribeRooms = client.subscribeOwnedRooms(function (rooms) {
    ownedRooms = rooms || {};
    if (selectedRoomId && !ownedRooms[selectedRoomId]) {
      clearRoomSubscriptions();
      selectedRoomId = "";
      activeRoom = null;
    }
    renderRoomList();
    renderSelectedRoom();
  });
}

function showLogin() {
  dashboardReady = false;
  unsubscribeQuizzes();
  unsubscribeRooms();
  clearRoomSubscriptions();
  elements.dashboard.hidden = true;
  elements.login.hidden = false;
  elements.password.value = "";
}

elements.quizTitle.addEventListener("input", function () { editorQuiz.title = elements.quizTitle.value; });
elements.quizDescription.addEventListener("input", function () { editorQuiz.description = elements.quizDescription.value; });
elements.saveQuiz.addEventListener("click", saveQuiz);
elements.addQuestion.addEventListener("click", function () {
  editorQuiz.questions.push(createQuestion());
  elements.quizEditorMessage.textContent = "";
  renderEditor();
  elements.questionEditor.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
});
elements.newQuiz.addEventListener("click", function () { editorQuiz = createBlankQuiz(); elements.quizEditorMessage.textContent = ""; renderEditor(); });
elements.createRoom.addEventListener("click", createRoom);
elements.editSelectedQuiz.addEventListener("click", function () {
  openQuizEditor(savedQuizzes[elements.roomQuizSelect.value]);
});
elements.copyRoomLink.addEventListener("click", copyRoomLink);
elements.start.addEventListener("click", startGame);
elements.stop.addEventListener("click", stopGame);
elements.reveal.addEventListener("click", revealResults);
elements.reset.addEventListener("click", resetRoom);
elements.deleteRoom.addEventListener("click", deleteSelectedRoom);
elements.signOut.addEventListener("click", async function () { await client.signOut(); showLogin(); });
elements.tabs.forEach(function (button) { button.addEventListener("click", function () { renderTabs(button.dataset.tab); }); });

async function submitLogin(createAccount) {
  elements.loginMessage.textContent = createAccount ? "계정을 만드는 중이에요…" : "로그인하는 중이에요…";
  try {
    if (createAccount) { await client.signUpAdmin(elements.email.value, elements.password.value); }
    else { await client.signInAdmin(elements.email.value, elements.password.value); }
    elements.password.value = "";
    showDashboard();
  } catch (error) {
    elements.loginMessage.textContent = error.message || (createAccount ? "계정을 만들지 못했습니다." : "로그인하지 못했습니다.");
  }
}

elements.loginForm.addEventListener("submit", function (event) { event.preventDefault(); submitLogin(false); });
elements.signUp.addEventListener("click", function () { if (elements.loginForm.reportValidity()) { submitLogin(true); } });

async function initialize() {
  client = await createQuizClient("admin");
  elements.notice.hidden = !client.notice;
  elements.notice.textContent = client.notice || "";
  if (client.mode === "demo" || client.isAdmin()) { showDashboard(); }
  else { elements.login.hidden = false; }
  window.setInterval(function () { if (dashboardReady && activeRoom) { renderMonitor(); } }, 100);
}

initialize();
