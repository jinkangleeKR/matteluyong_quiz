import { calculateAnswerScore, getQuizVersion } from "./quiz-data.js";
import { createQuizClient } from "./realtime-store.js";

const PLAYER_NAME_KEY = "matteluyong.quiz.player-name";
const MAX_CHAT_MESSAGES = 100;

const elements = {
  connectionBadge: document.querySelector("#connection-badge"),
  connectionNotice: document.querySelector("#connection-notice"),
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
  totalScore: document.querySelector("#total-score"),
  resultDetail: document.querySelector("#result-detail"),
  resultWaiting: document.querySelector("#result-waiting"),
  resultWaitingKicker: document.querySelector("#result-waiting-kicker"),
  resultWaitingTitle: document.querySelector("#result-waiting-title"),
  resultWaitingMessage: document.querySelector("#result-waiting-message"),
  resultCountdown: document.querySelector("#result-countdown"),
  resultRevealContent: document.querySelector("#result-reveal-content"),
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
let activeGame = { status: "waiting" };
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
let finalRankingGameId = "";
let finalRankingReady = false;
let finalAnswersReady = false;
let finalLobbyReady = false;
let renderedScreen = "";
let renderedChat = "";
let isSubmittingAnswer = false;
let isEnteringGame = false;
let isSendingChat = false;
let draftGameId = "";
let draftQuestionIndex = -1;
let draftChoice = null;

elements.playerName.value = window.localStorage.getItem(PLAYER_NAME_KEY) || "";
elements.playerName.addEventListener("input", function () {
  window.localStorage.setItem(PLAYER_NAME_KEY, elements.playerName.value.trim());
});

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function formatChatTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function getPhase(game) {
  if (!game || game.status === "waiting") {
    return { state: "waiting" };
  }

  const version = getQuizVersion(game.versionId);
  if (!version) {
    return { state: "error", message: "선택한 퀴즈 버전을 찾지 못했습니다." };
  }

  if (game.status === "finished") {
    return { state: "finished", version: version };
  }

  const startsIn = Number(game.startAt) - client.now();
  if (startsIn > 0) {
    return { state: "starting", version: version, startsIn: startsIn };
  }

  const durationMs = Number(game.questionDurationSec) * 1000;
  const elapsed = Math.max(0, client.now() - Number(game.startAt));
  const questionIndex = Math.floor(elapsed / durationMs);

  if (questionIndex >= version.questions.length) {
    return { state: "finished", version: version };
  }

  const questionElapsed = elapsed - questionIndex * durationMs;
  return {
    state: "question",
    version: version,
    questionIndex: questionIndex,
    question: version.questions[questionIndex],
    remainingMs: Math.max(0, durationMs - questionElapsed),
    durationMs: durationMs,
  };
}

function getScore(game, version) {
  let total = 0;
  let correct = 0;

  version.questions.forEach(function (question, index) {
    const answer = ownAnswers[String(index)];
    const gained = calculateAnswerScore(answer, question, game, index);
    total += gained;
    if (gained > 0) {
      correct += 1;
    }
  });

  return { total: total, correct: correct };
}

function setVisible(view) {
  elements.entryView.hidden = view !== "entry";
  elements.waitingView.hidden = view !== "waiting";
  elements.kickedView.hidden = view !== "kicked";
  elements.questionView.hidden = view !== "question";
  elements.finishedView.hidden = view !== "finished";
}

function renderEntry(phase) {
  setVisible("entry");
  elements.enterGame.disabled = isEnteringGame;

  if (phase.state === "question" || phase.state === "starting") {
    elements.entryMessage.textContent = "퀴즈가 이미 진행 중이에요. 다음 대기실이 열리면 입장할 수 있어요.";
    elements.enterGame.disabled = true;
  } else if (phase.state === "finished") {
    elements.entryMessage.textContent = "이번 퀴즈가 종료됐어요. 진행자가 대기실을 열면 입장할 수 있어요.";
    elements.enterGame.disabled = true;
  } else if (phase.state === "error") {
    elements.entryMessage.textContent = phase.message;
    elements.enterGame.disabled = true;
  } else {
    elements.entryMessage.textContent = "닉네임을 입력하고 입장하면 대기실 채팅에 참여할 수 있어요.";
  }
}

function renderWaiting(phase) {
  setVisible("waiting");
  elements.answerOptions.replaceChildren();
  elements.submitAnswer.disabled = true;
  elements.answerMessage.textContent = "";

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
  elements.questionCount.textContent = "문제 " + (phase.questionIndex + 1) + " / " + phase.version.questions.length;
  elements.questionText.textContent = phase.question.prompt;
  elements.answerOptions.replaceChildren();

  const submittedAnswer = ownAnswers[String(phase.questionIndex)];
  const isChangingAnswer = submittedAnswer && draftChoice !== submittedAnswer.choice;
  const canSubmit = draftChoice !== null && !isSubmittingAnswer && (!submittedAnswer || isChangingAnswer);
  elements.submitAnswer.disabled = !canSubmit;
  elements.submitAnswer.textContent = submittedAnswer
    ? (isChangingAnswer ? "변경한 답 제출하기" : "제출한 답")
    : "답안 제출하기";

  if (isSubmittingAnswer) {
    elements.answerMessage.textContent = "답안을 제출하는 중이에요…";
  } else if (submittedAnswer && isChangingAnswer) {
    elements.answerMessage.textContent = "새 답을 골랐어요. 제출 버튼을 눌러 변경을 확정하세요.";
  } else if (submittedAnswer) {
    elements.answerMessage.textContent = "답안을 제출했습니다. 다른 답을 고른 뒤 다시 제출하면 변경할 수 있어요.";
  } else if (draftChoice !== null) {
    elements.answerMessage.textContent = "선택한 답을 제출 버튼으로 확정해 주세요.";
  } else {
    elements.answerMessage.textContent = "답을 고른 뒤 제출 버튼을 눌러 확정해 주세요.";
  }

  phase.question.options.forEach(function (option, index) {
    const button = document.createElement("button");
    const marker = document.createElement("span");
    const text = document.createElement("span");
    marker.className = "answer-marker";
    marker.textContent = String.fromCharCode(65 + index);
    text.textContent = option;
    button.className = "answer-button";
    button.type = "button";
    button.append(marker, text);

    if (draftChoice === index) {
      button.classList.add("selected");
    }

    button.addEventListener("click", function () {
      chooseAnswer(phase, index);
    });
    elements.answerOptions.append(button);
  });
}

function syncDraft(phase) {
  if (phase.state !== "question") {
    draftGameId = "";
    draftQuestionIndex = -1;
    draftChoice = null;
    return;
  }

  if (draftGameId !== activeGame.id || draftQuestionIndex !== phase.questionIndex) {
    draftGameId = activeGame.id;
    draftQuestionIndex = phase.questionIndex;
    draftChoice = null;
  }
}

function chooseAnswer(phase, choice) {
  if (isSubmittingAnswer || phase.questionIndex !== draftQuestionIndex) {
    return;
  }

  draftChoice = choice;
  renderedScreen = "";
  render();
}

function getResultRevealState(game) {
  const revealAt = Number(game && game.resultsRevealAt);
  if (!Number.isFinite(revealAt) || revealAt <= 0) {
    return { state: "waiting" };
  }

  const remainingMs = revealAt - client.now();
  if (remainingMs > 0) {
    return {
      state: "countdown",
      count: Math.min(3, Math.max(1, Math.ceil(remainingMs / 1000))),
    };
  }

  return { state: "revealed" };
}

function renderFinished(phase, resultState) {
  setVisible("finished");
  const isRevealed = resultState.state === "revealed";
  elements.resultWaiting.hidden = isRevealed;
  elements.resultRevealContent.hidden = !isRevealed;

  if (!isRevealed) {
    const isCountdown = resultState.state === "countdown";
    elements.resultWaitingKicker.textContent = isCountdown ? "RESULTS INCOMING" : "RESULTS LOCKED";
    elements.resultWaitingTitle.textContent = isCountdown ? "결과 공개까지" : "결과 발표를 기다리고 있어요";
    elements.resultWaitingMessage.textContent = isCountdown
      ? "점수와 순위가 곧 공개됩니다."
      : "진행자가 결과를 공개하면 점수와 순위를 확인할 수 있어요.";
    elements.resultCountdown.hidden = !isCountdown;
    elements.resultCountdown.textContent = isCountdown ? String(resultState.count) : "";
    return;
  }

  const score = getScore(activeGame, phase.version);
  elements.totalScore.textContent = score.total.toLocaleString("ko-KR");
  elements.resultDetail.textContent = "정답 " + score.correct + " / " + phase.version.questions.length + "문항";
  renderFinalRanking(phase.version);
}

function getFinalLeaderboard(version) {
  const participantIds = new Set(Object.keys(finalLobby || {}));
  Object.keys(finalAnswers || {}).forEach(function (playerId) {
    participantIds.add(playerId);
  });
  if (ownLobbyEntry && client.playerId) {
    participantIds.add(client.playerId);
  }

  return Array.from(participantIds).map(function (playerId) {
    const answers = finalAnswers[playerId] || {};
    const participant = finalLobby[playerId] || {};
    let name = participant.name || "참가자";
    let score = 0;
    let correct = 0;

    version.questions.forEach(function (question, index) {
      const answer = answers[String(index)];
      if (!answer) {
        return;
      }
      if (!participant.name && answer.playerName) {
        name = answer.playerName;
      }
      const gained = calculateAnswerScore(answer, question, activeGame, index);
      score += gained;
      if (answer.choice === question.correctIndex) {
        correct += 1;
      }
    });

    return { id: playerId, name: name, score: score, correct: correct };
  }).sort(function (first, second) {
    if (second.score !== first.score) {
      return second.score - first.score;
    }
    if (second.correct !== first.correct) {
      return second.correct - first.correct;
    }
    return first.name.localeCompare(second.name, "ko");
  });
}

function renderFinalRanking(version) {
  const leaderboard = getFinalLeaderboard(version);
  const isLoading = !finalRankingGameId || !finalRankingReady;
  elements.finalRankingList.replaceChildren();
  elements.finalRankingCount.textContent = isLoading ? "집계 중" : leaderboard.length.toLocaleString("ko-KR") + "명";
  elements.finalRankingCount.className = "state-badge " + (leaderboard.length ? "live" : "waiting");
  elements.finalRankingEmpty.hidden = isLoading || leaderboard.length > 0;
  elements.finalRankingEmpty.textContent = isLoading
    ? "순위를 불러오는 중이에요…"
    : "이번 퀴즈에 입장한 참가자가 없습니다.";

  leaderboard.forEach(function (player, index) {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    const name = document.createElement("strong");
    const score = document.createElement("span");
    item.className = "final-ranking-item";
    if (player.id === client.playerId) {
      item.classList.add("is-me");
    }
    rank.textContent = String(index + 1);
    name.textContent = player.name + " · 정답 " + player.correct + "개";
    score.textContent = player.score.toLocaleString("ko-KR") + "점";
    item.append(rank, name, score);
    elements.finalRankingList.append(item);
  });
}

function updateTimer(phase) {
  if (phase.state === "question") {
    const percent = (phase.remainingMs / phase.durationMs) * 100;
    elements.timerText.textContent = formatSeconds(phase.remainingMs);
    elements.timerBar.style.width = percent + "%";
    return;
  }

  if (phase.state === "starting" && ownLobbyEntry) {
    elements.waitingMessage.textContent = formatSeconds(phase.startsIn) + " 뒤에 첫 문제가 열립니다.";
  }
}

function getOrderedMessages() {
  return Object.entries(waitingChat || {}).sort(function (first, second) {
    const firstTime = Number(first[1] && first[1].sentAt) || 0;
    const secondTime = Number(second[1] && second[1].sentAt) || 0;
    return firstTime - secondTime || first[0].localeCompare(second[0]);
  }).slice(-MAX_CHAT_MESSAGES);
}

function renderChat(phase) {
  const enabled = Boolean(ownLobbyEntry && !kickInfo && phase.state === "waiting");
  const messages = enabled ? getOrderedMessages() : [];
  const signature = enabled + "/" + messages.map(function (entry) {
    const message = entry[1] || {};
    return entry[0] + ":" + message.sentAt + ":" + message.text;
  }).join("|");

  elements.chatPanel.hidden = !enabled;
  if (renderedChat === signature) {
    return;
  }
  renderedChat = signature;
  elements.chatCount.textContent = messages.length + "개";
  elements.chatCount.className = "state-badge " + (messages.length ? "live" : "waiting");
  elements.chatMessages.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "첫 번째 인사를 남겨 보세요.";
    elements.chatMessages.append(empty);
  } else {
    messages.forEach(function (entry) {
      const message = entry[1] || {};
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
}

function syncChatSubscription() {
  const shouldSubscribe = Boolean(ownLobbyEntry && !kickInfo);
  if (shouldSubscribe && !chatSubscribed) {
    chatSubscribed = true;
    unsubscribeChat = client.subscribeWaitingChat(function (messages) {
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

function stopFinalRankingSubscriptions() {
  unsubscribeFinalAnswers();
  unsubscribeFinalLobby();
  unsubscribeFinalAnswers = function () {};
  unsubscribeFinalLobby = function () {};
  finalRankingGameId = "";
  finalRankingReady = false;
  finalAnswersReady = false;
  finalLobbyReady = false;
  finalAnswers = {};
  finalLobby = {};
}

function syncFinalRankingSubscriptions(phase, resultState) {
  const shouldSubscribe = Boolean(
    phase.state === "finished" && resultState.state === "revealed" && activeGame.id && ownLobbyEntry && !kickInfo
  );
  if (!shouldSubscribe) {
    if (finalRankingGameId) {
      stopFinalRankingSubscriptions();
    }
    return;
  }
  if (finalRankingGameId === activeGame.id) {
    return;
  }

  stopFinalRankingSubscriptions();
  finalRankingGameId = activeGame.id;
  unsubscribeFinalAnswers = client.subscribeLeaderboard(activeGame.id, function (answers) {
    finalAnswers = answers || {};
    finalAnswersReady = true;
    finalRankingReady = finalAnswersReady && finalLobbyReady;
    renderedScreen = "";
    render();
  });
  unsubscribeFinalLobby = client.subscribeFinishedLobby(function (lobby) {
    finalLobby = lobby || {};
    finalLobbyReady = true;
    finalRankingReady = finalAnswersReady && finalLobbyReady;
    renderedScreen = "";
    render();
  });
}

function render() {
  const phase = getPhase(activeGame);
  const resultState = phase.state === "finished" ? getResultRevealState(activeGame) : { state: "waiting" };
  syncDraft(phase);
  syncFinalRankingSubscriptions(phase, resultState);
  const screen = kickInfo ? "kicked" : !ownLobbyEntry ? "entry" : phase.state === "question" ? "question" : phase.state === "finished" ? "finished" : "waiting";
  const answer = phase.state === "question" ? ownAnswers[String(phase.questionIndex)] : null;
  const screenKey = [
    activeGame.id || "waiting",
    screen,
    phase.state,
    phase.questionIndex,
    resultState.state,
    resultState.count || "",
    answer ? answer.choice : "",
    draftChoice === null ? "" : draftChoice,
    isSubmittingAnswer ? "submitting" : "ready",
    isEnteringGame ? "entering" : "",
  ].join("/");

  if (renderedScreen !== screenKey) {
    renderedScreen = screenKey;
    if (screen === "entry") {
      renderEntry(phase);
    } else if (screen === "kicked") {
      setVisible("kicked");
    } else if (screen === "question") {
      renderQuestion(phase);
    } else if (screen === "finished") {
      renderFinished(phase, resultState);
    } else {
      renderWaiting(phase);
    }
  }

  updateTimer(phase);
  renderChat(phase);
}

async function enterGame() {
  const phase = getPhase(activeGame);
  const name = elements.playerName.value.trim();

  if (phase.state !== "waiting") {
    elements.entryStatus.textContent = "지금은 입장할 수 없어요. 다음 대기실이 열릴 때 다시 시도해 주세요.";
    return;
  }
  if (!name) {
    elements.entryStatus.textContent = "닉네임을 입력해 주세요.";
    elements.playerName.focus();
    return;
  }

  isEnteringGame = true;
  elements.entryStatus.textContent = "대기실에 입장하는 중이에요…";
  renderedScreen = "";
  render();

  try {
    await client.joinLobby(name);
    window.localStorage.setItem(PLAYER_NAME_KEY, name);
    elements.entryStatus.textContent = "";
  } catch (error) {
    elements.entryStatus.textContent = error.message || "대기실에 입장하지 못했습니다. 다시 시도해 주세요.";
  } finally {
    isEnteringGame = false;
    renderedScreen = "";
    render();
  }
}

async function submitAnswer() {
  const phase = getPhase(activeGame);
  const currentAnswer = ownAnswers[String(phase.questionIndex)];
  if (phase.state !== "question" || draftChoice === null || isSubmittingAnswer || !ownLobbyEntry) {
    return;
  }
  if (currentAnswer && currentAnswer.choice === draftChoice) {
    elements.answerMessage.textContent = "이미 제출한 답입니다. 다른 답을 고른 뒤 다시 제출할 수 있어요.";
    return;
  }

  isSubmittingAnswer = true;
  renderedScreen = "";
  render();
  try {
    await client.submitAnswer({
      gameId: activeGame.id,
      questionIndex: phase.questionIndex,
      choice: draftChoice,
      playerName: ownLobbyEntry.name || "참가자",
    });
  } catch (error) {
    elements.answerMessage.textContent = "답안 제출에 실패했어요. 연결 상태를 확인해 주세요.";
  } finally {
    isSubmittingAnswer = false;
    renderedScreen = "";
    render();
  }
}

async function sendChat(event) {
  event.preventDefault();
  const phase = getPhase(activeGame);
  const text = elements.chatInput.value.trim();
  if (!text || isSendingChat || !ownLobbyEntry || phase.state !== "waiting") {
    return;
  }

  isSendingChat = true;
  elements.chatStatus.textContent = "보내는 중이에요…";
  try {
    await client.sendWaitingChat({ playerName: ownLobbyEntry.name, text: text });
    elements.chatInput.value = "";
    elements.chatStatus.textContent = "";
  } catch (error) {
    elements.chatStatus.textContent = error.message || "메시지를 보내지 못했습니다. 다시 시도해 주세요.";
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

  client.subscribeGame(function (game) {
    activeGame = game || { status: "waiting" };
    unsubscribeAnswers();
    ownAnswers = {};
    if (activeGame.id) {
      unsubscribeAnswers = client.subscribeMyAnswers(activeGame.id, function (answers) {
        ownAnswers = answers || {};
        renderedScreen = "";
        render();
      });
    }
    renderedScreen = "";
    render();
  });

  client.subscribeLobbyEntry(function (entry) {
    ownLobbyEntry = entry || null;
    syncChatSubscription();
    renderedScreen = "";
    renderedChat = "";
    render();
  });
  client.subscribeKick(function (kick) {
    kickInfo = kick || null;
    syncChatSubscription();
    renderedScreen = "";
    renderedChat = "";
    render();
  });
  window.setInterval(render, 100);
}

initialize();
