import { calculateAnswerScore, isCorrectAnswer, isShortAnswerQuestion } from "./quiz-data.js";
import { createQuizClient } from "./realtime-store.js";

const PLAYER_NAME_KEY = "matteluyong.quiz.player-name";
const MAX_CHAT_MESSAGES = 100;
const roomId = new URLSearchParams(window.location.search).get("room") || "";

const elements = {
  connectionBadge: document.querySelector("#connection-badge"),
  connectionNotice: document.querySelector("#connection-notice"),
  noRoomView: document.querySelector("#no-room-view"),
  entryView: document.querySelector("#entry-view"),
  waitingView: document.querySelector("#waiting-view"),
  kickedView: document.querySelector("#kicked-view"),
  questionView: document.querySelector("#question-view"),
  finishedView: document.querySelector("#finished-view"),
  entryMessage: document.querySelector("#entry-message"),
  entryStatus: document.querySelector("#entry-status"),
  playerName: document.querySelector("#player-name"),
  enterGame: document.querySelector("#enter-game"),
  waitingMessage: document.querySelector("#waiting-message"),
  quizStatus: document.querySelector("#quiz-status"),
  questionCount: document.querySelector("#question-count"),
  timerText: document.querySelector("#timer-text"),
  timerBar: document.querySelector("#timer-bar"),
  questionText: document.querySelector("#question-text"),
  answerOptions: document.querySelector("#answer-options"),
  submitAnswer: document.querySelector("#submit-answer"),
  answerMessage: document.querySelector("#answer-message"),
  resultWaiting: document.querySelector("#result-waiting"),
  resultWaitingKicker: document.querySelector("#result-waiting-kicker"),
  resultWaitingTitle: document.querySelector("#result-waiting-title"),
  resultWaitingMessage: document.querySelector("#result-waiting-message"),
  resultCountdown: document.querySelector("#result-countdown"),
  resultRevealContent: document.querySelector("#result-reveal-content"),
  totalScore: document.querySelector("#total-score"),
  resultDetail: document.querySelector("#result-detail"),
  finalRankingCount: document.querySelector("#final-ranking-count"),
  finalRankingList: document.querySelector("#final-ranking-list"),
  finalRankingEmpty: document.querySelector("#final-ranking-empty"),
  chatPanel: document.querySelector("#chat-panel"),
  chatCount: document.querySelector("#chat-count"),
  chatMessages: document.querySelector("#chat-messages"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  chatStatus: document.querySelector("#chat-status"),
};

let client;
let room = null;
let ownAnswers = {};
let ownLobbyEntry = null;
let kickInfo = null;
let waitingChat = {};
let finalAnswers = {};
let finalLobby = {};
let unsubscribeAnswers = function () {};
let unsubscribeChat = function () {};
let unsubscribeFinalAnswers = function () {};
let unsubscribeFinalLobby = function () {};
let chatSubscribed = false;
let finalRankingRoomId = "";
let finalRankingReady = false;
let finalAnswersReady = false;
let finalLobbyReady = false;
let renderedScreen = "";
let renderedChat = "";
let isSubmittingAnswer = false;
let isEnteringGame = false;
let isSendingChat = false;
let answerSubmissionError = "";
let draftQuestionIndex = -1;
let draftChoice = null;
let draftText = "";
let draftWasUserEdited = false;

elements.playerName.value = window.localStorage.getItem(PLAYER_NAME_KEY) || "";
elements.playerName.addEventListener("input", function () {
  window.localStorage.setItem(PLAYER_NAME_KEY, elements.playerName.value.trim());
});

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function formatChatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) { return ""; }
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function getQuiz() {
  return room && room.quizSnapshot && Array.isArray(room.quizSnapshot.questions) ? room.quizSnapshot : null;
}

function getPhase() {
  if (!room) { return { state: "missing" }; }
  if (room.status === "waiting") { return { state: "waiting" }; }
  const quiz = getQuiz();
  if (!quiz) { return { state: "error", message: "이 게임방의 퀴즈 정보를 찾지 못했습니다." }; }
  if (room.status === "finished") { return { state: "finished", quiz: quiz }; }

  const startsIn = Number(room.startAt) - client.now();
  if (startsIn > 0) { return { state: "starting", quiz: quiz, startsIn: startsIn }; }
  const durationMs = Number(room.questionDurationSec) * 1000;
  const elapsed = Math.max(0, client.now() - Number(room.startAt));
  const questionIndex = Math.floor(elapsed / durationMs);
  if (questionIndex >= quiz.questions.length) { return { state: "finished", quiz: quiz }; }
  const questionElapsed = elapsed - questionIndex * durationMs;
  return {
    state: "question",
    quiz: quiz,
    questionIndex: questionIndex,
    question: quiz.questions[questionIndex],
    remainingMs: Math.max(0, durationMs - questionElapsed),
    durationMs: durationMs,
  };
}

function getResultRevealState() {
  const revealAt = Number(room && room.resultsRevealAt);
  if (!Number.isFinite(revealAt) || revealAt <= 0) { return { state: "waiting" }; }
  const remainingMs = revealAt - client.now();
  if (remainingMs > 0) {
    return { state: "countdown", count: Math.min(3, Math.max(1, Math.ceil(remainingMs / 1000))) };
  }
  return { state: "revealed" };
}

function questionForScoring(question, index) {
  const answerKey = room && room.revealedAnswerKey;
  const key = Array.isArray(answerKey) ? answerKey[index] : null;
  if (isShortAnswerQuestion(question)) {
    const acceptedAnswers = Array.isArray(key) ? key : key && Array.isArray(key.acceptedAnswers) ? key.acceptedAnswers : [];
    return Object.assign({}, question, { type: "short-answer", acceptedAnswers: acceptedAnswers });
  }
  const correctIndex = typeof key === "number" ? key : key && Number.isFinite(Number(key.correctIndex)) ? Number(key.correctIndex) : -1;
  return Object.assign({}, question, { type: "multiple-choice", correctIndex: correctIndex });
}

function getScore(quiz) {
  let total = 0;
  let correct = 0;
  quiz.questions.forEach(function (question, index) {
    const scoredQuestion = questionForScoring(question, index);
    const gained = calculateAnswerScore(ownAnswers[String(index)], scoredQuestion, room, index);
    total += gained;
    if (isCorrectAnswer(ownAnswers[String(index)], scoredQuestion)) { correct += 1; }
  });
  return { total: total, correct: correct };
}

function setVisible(view) {
  elements.noRoomView.hidden = view !== "no-room";
  elements.entryView.hidden = view !== "entry";
  elements.waitingView.hidden = view !== "waiting";
  elements.kickedView.hidden = view !== "kicked";
  elements.questionView.hidden = view !== "question";
  elements.finishedView.hidden = view !== "finished";
}

function renderEntry(phase) {
  setVisible("entry");
  elements.enterGame.disabled = isEnteringGame || phase.state !== "waiting";
  if (phase.state === "missing") {
    elements.entryMessage.textContent = "초대 링크가 없거나 이미 삭제된 게임방이에요. 진행자에게 새 QR 코드 또는 링크를 받아 주세요.";
  } else if (phase.state === "question" || phase.state === "starting") {
    elements.entryMessage.textContent = "퀴즈가 이미 진행 중이에요. 다음 대기실에서 입장할 수 있어요.";
  } else if (phase.state === "finished") {
    elements.entryMessage.textContent = "이번 퀴즈는 종료됐어요. 진행자가 새 게임방을 열면 입장할 수 있어요.";
  } else if (phase.state === "error") {
    elements.entryMessage.textContent = phase.message;
  } else {
    elements.entryMessage.textContent = (room.title || "현장 퀴즈") + " 대기실에 입장해 보세요.";
  }
}

function renderWaiting(phase) {
  setVisible("waiting");
  if (phase.state === "starting") {
    elements.quizStatus.textContent = "퀴즈가 곧 시작돼요";
    elements.waitingMessage.textContent = "모든 참가자에게 첫 문제가 동시에 열립니다.";
  } else if (phase.state === "error") {
    elements.quizStatus.textContent = "퀴즈 설정을 확인해 주세요";
    elements.waitingMessage.textContent = phase.message;
  } else {
    elements.quizStatus.textContent = "대기실에 입장했어요";
    elements.waitingMessage.textContent = "진행자가 시작하면 첫 번째 문제가 자동으로 열립니다.";
  }
}

function renderQuestion(phase) {
  setVisible("question");
  elements.questionCount.textContent = "문제 " + (phase.questionIndex + 1) + " / " + phase.quiz.questions.length;
  elements.questionText.textContent = phase.question.prompt;
  elements.answerOptions.replaceChildren();
  const submitted = ownAnswers[String(phase.questionIndex)];
  const shortAnswer = isShortAnswerQuestion(phase.question);
  if (submitted && !draftWasUserEdited) {
    if (shortAnswer && !draftText) { draftText = String(submitted.text || ""); }
    if (!shortAnswer && draftChoice === null && Number.isFinite(Number(submitted.choice))) { draftChoice = Number(submitted.choice); }
  }
  const hasDraftAnswer = shortAnswer ? Boolean(draftText.trim()) : draftChoice !== null;
  const normalizeText = function (value) { return String(value || "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, ""); };
  const isChanging = submitted && (shortAnswer ? normalizeText(draftText) !== normalizeText(submitted.text) : draftChoice !== submitted.choice);
  elements.submitAnswer.disabled = !hasDraftAnswer || isSubmittingAnswer || Boolean(submitted && !isChanging);
  elements.submitAnswer.textContent = submitted ? (isChanging ? "변경한 답 제출하기" : "제출한 답") : "답안 제출하기";
  elements.answerMessage.textContent = isSubmittingAnswer
    ? "답안을 제출하는 중이에요…"
    : answerSubmissionError
      ? answerSubmissionError
    : submitted && isChanging
      ? "새 답을 골랐어요. 제출 버튼을 눌러 변경을 확정하세요."
      : submitted
        ? "답안을 제출했습니다. 다른 답을 골라 다시 제출하면 변경할 수 있어요."
        : hasDraftAnswer
          ? (shortAnswer ? "입력한 답을 제출 버튼으로 확정해 주세요." : "선택한 답을 제출 버튼으로 확정해 주세요.")
          : (shortAnswer ? "정답을 입력한 뒤 제출 버튼을 눌러 확정해 주세요." : "답을 고른 뒤 제출 버튼을 눌러 확정해 주세요.");

  if (shortAnswer) {
    const answerField = document.createElement("label");
    const answerLabel = document.createElement("span");
    const answerInput = document.createElement("input");
    answerField.className = "short-answer-field";
    answerLabel.textContent = "주관식 정답";
    answerInput.type = "text";
    answerInput.maxLength = 120;
    answerInput.autocomplete = "off";
    answerInput.placeholder = "정답을 입력하세요";
    answerInput.value = draftText;
    answerInput.disabled = isSubmittingAnswer;
    answerInput.addEventListener("input", function () {
      draftText = answerInput.value;
      draftWasUserEdited = true;
      answerSubmissionError = "";
      const currentText = draftText.trim();
      const changing = submitted && normalizeText(currentText) !== normalizeText(submitted.text);
      elements.submitAnswer.disabled = !currentText || isSubmittingAnswer || Boolean(submitted && !changing);
      elements.submitAnswer.textContent = submitted ? (changing ? "변경한 답 제출하기" : "제출한 답") : "답안 제출하기";
      elements.answerMessage.textContent = !currentText
        ? "정답을 입력한 뒤 제출 버튼을 눌러 확정해 주세요."
        : submitted && !changing
          ? "답안을 제출했습니다. 다른 답을 입력해 다시 제출하면 변경할 수 있어요."
          : submitted
            ? "새 답을 입력했어요. 제출 버튼을 눌러 변경을 확정하세요."
            : "입력한 답을 제출 버튼으로 확정해 주세요.";
    });
    answerField.append(answerLabel, answerInput);
    elements.answerOptions.append(answerField);
    return;
  }

  phase.question.options.forEach(function (option, index) {
    const button = document.createElement("button");
    const marker = document.createElement("span");
    const text = document.createElement("span");
    button.type = "button";
    button.className = "answer-button";
    marker.className = "answer-marker";
    marker.textContent = String.fromCharCode(65 + index);
    text.textContent = option;
    button.append(marker, text);
    if (draftChoice === index) { button.classList.add("selected"); }
    button.addEventListener("click", function () {
      if (!isSubmittingAnswer) {
        draftChoice = index;
        draftWasUserEdited = true;
        answerSubmissionError = "";
        renderedScreen = "";
        render();
      }
    });
    elements.answerOptions.append(button);
  });
}

function renderFinished(phase, resultState) {
  setVisible("finished");
  const revealed = resultState.state === "revealed";
  elements.resultWaiting.hidden = revealed;
  elements.resultRevealContent.hidden = !revealed;
  if (!revealed) {
    const countdown = resultState.state === "countdown";
    elements.resultWaitingKicker.textContent = countdown ? "RESULTS INCOMING" : "RESULTS LOCKED";
    elements.resultWaitingTitle.textContent = countdown ? "결과 공개까지" : "결과 발표를 기다리고 있어요";
    elements.resultWaitingMessage.textContent = countdown ? "점수와 순위가 곧 공개됩니다." : "진행자가 결과를 공개하면 점수와 순위를 확인할 수 있어요.";
    elements.resultCountdown.hidden = !countdown;
    elements.resultCountdown.textContent = countdown ? String(resultState.count) : "";
    return;
  }
  const score = getScore(phase.quiz);
  elements.totalScore.textContent = score.total.toLocaleString("ko-KR");
  elements.resultDetail.textContent = "정답 " + score.correct + " / " + phase.quiz.questions.length + "문항";
  renderFinalRanking(phase.quiz);
}

function getFinalLeaderboard(quiz) {
  const ids = new Set(Object.keys(finalLobby));
  Object.keys(finalAnswers).forEach(function (id) { ids.add(id); });
  if (ownLobbyEntry && client.getUser()) { ids.add(client.getUser().uid); }
  return Array.from(ids).map(function (id) {
    const answers = finalAnswers[id] || {};
    const participant = finalLobby[id] || {};
    let name = participant.name || "참가자";
    let score = 0;
    let correct = 0;
    quiz.questions.forEach(function (question, index) {
      const answer = answers[String(index)];
      if (!answer) { return; }
      if (!participant.name && answer.playerName) { name = answer.playerName; }
      const scoredQuestion = questionForScoring(question, index);
      score += calculateAnswerScore(answer, scoredQuestion, room, index);
      if (isCorrectAnswer(answer, scoredQuestion)) { correct += 1; }
    });
    return { id: id, name: name, score: score, correct: correct };
  }).sort(function (first, second) {
    return second.score - first.score || second.correct - first.correct || first.name.localeCompare(second.name, "ko");
  });
}

function renderFinalRanking(quiz) {
  const leaderboard = getFinalLeaderboard(quiz);
  const loading = !finalRankingRoomId || !finalRankingReady;
  elements.finalRankingList.replaceChildren();
  elements.finalRankingCount.textContent = loading ? "집계 중" : leaderboard.length + "명";
  elements.finalRankingCount.className = "state-badge " + (leaderboard.length ? "live" : "waiting");
  elements.finalRankingEmpty.hidden = loading || leaderboard.length > 0;
  elements.finalRankingEmpty.textContent = loading ? "순위를 불러오는 중이에요…" : "이번 퀴즈에 입장한 참가자가 없습니다.";
  leaderboard.forEach(function (player, index) {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    const name = document.createElement("strong");
    const score = document.createElement("span");
    item.className = "final-ranking-item";
    if (client.getUser() && player.id === client.getUser().uid) { item.classList.add("is-me"); }
    rank.textContent = String(index + 1);
    name.textContent = player.name + " · 정답 " + player.correct + "개";
    score.textContent = player.score.toLocaleString("ko-KR") + "점";
    item.append(rank, name, score);
    elements.finalRankingList.append(item);
  });
}

function syncDraft(phase) {
  if (phase.state !== "question") {
    draftQuestionIndex = -1;
    draftChoice = null;
    draftText = "";
    draftWasUserEdited = false;
    answerSubmissionError = "";
  } else if (draftQuestionIndex !== phase.questionIndex) {
    draftQuestionIndex = phase.questionIndex;
    draftChoice = null;
    draftText = "";
    draftWasUserEdited = false;
    answerSubmissionError = "";
  }
}

function stopFinalRankingSubscriptions() {
  unsubscribeFinalAnswers();
  unsubscribeFinalLobby();
  unsubscribeFinalAnswers = function () {};
  unsubscribeFinalLobby = function () {};
  finalRankingRoomId = "";
  finalRankingReady = false;
  finalAnswersReady = false;
  finalLobbyReady = false;
  finalAnswers = {};
  finalLobby = {};
}

function syncFinalRankingSubscriptions(phase, resultState) {
  const shouldSubscribe = Boolean(roomId && phase.state === "finished" && resultState.state === "revealed" && ownLobbyEntry && !kickInfo);
  if (!shouldSubscribe) {
    if (finalRankingRoomId) { stopFinalRankingSubscriptions(); }
    return;
  }
  if (finalRankingRoomId === roomId) { return; }
  stopFinalRankingSubscriptions();
  finalRankingRoomId = roomId;
  unsubscribeFinalAnswers = client.subscribeRoomAnswers(roomId, function (answers) {
    finalAnswers = answers || {};
    finalAnswersReady = true;
    finalRankingReady = finalAnswersReady && finalLobbyReady;
    renderedScreen = "";
    render();
  });
  unsubscribeFinalLobby = client.subscribeRoomLobby(roomId, function (lobby) {
    finalLobby = lobby || {};
    finalLobbyReady = true;
    finalRankingReady = finalAnswersReady && finalLobbyReady;
    renderedScreen = "";
    render();
  });
}

function getOrderedMessages() {
  return Object.entries(waitingChat).sort(function (first, second) {
    return (Number(first[1].sentAt) || 0) - (Number(second[1].sentAt) || 0) || first[0].localeCompare(second[0]);
  }).slice(-MAX_CHAT_MESSAGES);
}

function renderChat(phase) {
  const enabled = Boolean(roomId && ownLobbyEntry && !kickInfo && phase.state === "waiting");
  const messages = enabled ? getOrderedMessages() : [];
  const signature = enabled + "/" + messages.map(function (entry) { return entry[0] + ":" + entry[1].sentAt + ":" + entry[1].text; }).join("|");
  elements.chatPanel.hidden = !enabled;
  if (signature === renderedChat) { return; }
  renderedChat = signature;
  elements.chatCount.textContent = messages.length + "개";
  elements.chatCount.className = "state-badge " + (messages.length ? "live" : "waiting");
  elements.chatMessages.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "첫 번째 인사를 남겨 보세요.";
    elements.chatMessages.append(empty);
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
    time.textContent = formatChatTime(message.sentAt);
    text.textContent = message.text || "";
    meta.append(name, time);
    item.append(meta, text);
    elements.chatMessages.append(item);
  });
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function syncChatSubscription() {
  const shouldSubscribe = Boolean(roomId && ownLobbyEntry && !kickInfo && getPhase().state === "waiting");
  if (shouldSubscribe && !chatSubscribed) {
    chatSubscribed = true;
    unsubscribeChat = client.subscribeRoomWaitingChat(roomId, function (messages) {
      waitingChat = messages || {};
      renderedChat = "";
      render();
    });
  } else if (!shouldSubscribe && chatSubscribed) {
    unsubscribeChat();
    unsubscribeChat = function () {};
    chatSubscribed = false;
    waitingChat = {};
  }
}

function updateTimer(phase) {
  if (phase.state === "question") {
    elements.timerText.textContent = formatSeconds(phase.remainingMs);
    elements.timerBar.style.width = (phase.remainingMs / phase.durationMs) * 100 + "%";
  } else if (phase.state === "starting" && ownLobbyEntry) {
    elements.waitingMessage.textContent = formatSeconds(phase.startsIn) + " 뒤에 첫 문제가 열립니다.";
  }
}

function render() {
  if (!roomId) {
    setVisible("no-room");
    elements.chatPanel.hidden = true;
    return;
  }
  const phase = getPhase();
  const resultState = phase.state === "finished" ? getResultRevealState() : { state: "waiting" };
  syncDraft(phase);
  syncFinalRankingSubscriptions(phase, resultState);
  const screen = kickInfo ? "kicked" : !ownLobbyEntry ? "entry" : phase.state === "question" ? "question" : phase.state === "finished" ? "finished" : "waiting";
  const answer = phase.state === "question" ? ownAnswers[String(phase.questionIndex)] : null;
  const key = [room && room.id, screen, phase.state, phase.questionIndex, resultState.state, resultState.count || "", answer && answer.choice, answer && answer.text, draftChoice, isSubmittingAnswer, isEnteringGame].join("/");
  if (key !== renderedScreen) {
    renderedScreen = key;
    if (screen === "entry") { renderEntry(phase); }
    else if (screen === "kicked") { setVisible("kicked"); }
    else if (screen === "question") { renderQuestion(phase); }
    else if (screen === "finished") { renderFinished(phase, resultState); }
    else { renderWaiting(phase); }
  }
  updateTimer(phase);
  syncChatSubscription();
  renderChat(phase);
}

async function enterGame() {
  const phase = getPhase();
  const name = elements.playerName.value.trim();
  if (phase.state !== "waiting") { elements.entryStatus.textContent = "지금은 입장할 수 없습니다."; return; }
  if (!name) { elements.entryStatus.textContent = "닉네임을 입력해 주세요."; elements.playerName.focus(); return; }
  isEnteringGame = true;
  elements.entryStatus.textContent = "대기실에 입장하는 중이에요…";
  renderedScreen = "";
  render();
  try {
    await client.joinRoom(roomId, name);
    window.localStorage.setItem(PLAYER_NAME_KEY, name);
    elements.entryStatus.textContent = "";
  } catch (error) {
    elements.entryStatus.textContent = error.message || "대기실에 입장하지 못했습니다.";
  } finally {
    isEnteringGame = false;
    renderedScreen = "";
    render();
  }
}

async function submitAnswer() {
  const phase = getPhase();
  const submitted = ownAnswers[String(phase.questionIndex)];
  const shortAnswer = phase.state === "question" && isShortAnswerQuestion(phase.question);
  const text = draftText.trim();
  if (phase.state !== "question" || isSubmittingAnswer || !ownLobbyEntry || (shortAnswer ? !text : draftChoice === null)) { return; }
  if (submitted && (shortAnswer ? text === String(submitted.text || "").trim() : submitted.choice === draftChoice)) { return; }
  isSubmittingAnswer = true;
  answerSubmissionError = "";
  renderedScreen = "";
  render();
  try {
    await client.submitRoomAnswer(roomId, shortAnswer
      ? { questionIndex: phase.questionIndex, answerType: "short-answer", choice: 0, text: text, playerName: ownLobbyEntry.name || "참가자" }
      : { questionIndex: phase.questionIndex, answerType: "multiple-choice", choice: draftChoice, playerName: ownLobbyEntry.name || "참가자" });
  } catch (error) {
    answerSubmissionError = error.message || "답안 제출에 실패했어요. 연결 상태를 확인해 주세요.";
  } finally {
    isSubmittingAnswer = false;
    renderedScreen = "";
    render();
  }
}

async function sendChat(event) {
  event.preventDefault();
  const phase = getPhase();
  const text = elements.chatInput.value.trim();
  if (!text || isSendingChat || !ownLobbyEntry || phase.state !== "waiting") { return; }
  isSendingChat = true;
  elements.chatStatus.textContent = "보내는 중이에요…";
  try {
    await client.sendRoomWaitingChat(roomId, { playerName: ownLobbyEntry.name, text: text });
    elements.chatInput.value = "";
    elements.chatStatus.textContent = "";
  } catch (error) {
    elements.chatStatus.textContent = error.message || "메시지를 보내지 못했습니다.";
  } finally {
    isSendingChat = false;
  }
}

elements.enterGame.addEventListener("click", enterGame);
elements.submitAnswer.addEventListener("click", submitAnswer);
elements.chatForm.addEventListener("submit", sendChat);

async function initialize() {
  client = await createQuizClient("participant");
  elements.connectionBadge.textContent = client.mode === "firebase" ? "실시간 연결" : "데모 모드";
  elements.connectionBadge.classList.toggle("demo", client.mode !== "firebase");
  elements.connectionNotice.hidden = !client.notice;
  elements.connectionNotice.textContent = client.notice || "";
  if (!roomId) { render(); return; }

  client.subscribeRoomState(roomId, function (state) {
    room = state;
    unsubscribeAnswers();
    ownAnswers = {};
    if (room && room.id) {
      unsubscribeAnswers = client.subscribeMyRoomAnswers(roomId, function (answers) {
        ownAnswers = answers || {};
        renderedScreen = "";
        render();
      });
    }
    renderedScreen = "";
    render();
  });
  client.subscribeMyRoomLobbyEntry(roomId, function (entry) {
    ownLobbyEntry = entry || null;
    syncChatSubscription();
    renderedScreen = "";
    renderedChat = "";
    render();
  });
  client.subscribeRoomKick(roomId, function (kick) {
    kickInfo = kick || null;
    syncChatSubscription();
    renderedScreen = "";
    renderedChat = "";
    render();
  });
  window.setInterval(render, 100);
}

initialize();
