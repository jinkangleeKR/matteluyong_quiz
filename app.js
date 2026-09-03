import { getQuizVersion } from "./quiz-data.js";
import { createQuizClient } from "./realtime-store.js";

const PLAYER_NAME_KEY = "matteluyong.quiz.player-name";

const elements = {
  connectionBadge: document.querySelector("#connection-badge"),
  connectionNotice: document.querySelector("#connection-notice"),
  waitingView: document.querySelector("#waiting-view"),
  questionView: document.querySelector("#question-view"),
  finishedView: document.querySelector("#finished-view"),
  waitingMessage: document.querySelector("#waiting-message"),
  quizStatus: document.querySelector("#quiz-status"),
  playerName: document.querySelector("#player-name"),
  questionCount: document.querySelector("#question-count"),
  timerText: document.querySelector("#timer-text"),
  timerBar: document.querySelector("#timer-bar"),
  questionText: document.querySelector("#question-text"),
  answerOptions: document.querySelector("#answer-options"),
  answerMessage: document.querySelector("#answer-message"),
  totalScore: document.querySelector("#total-score"),
  resultDetail: document.querySelector("#result-detail"),
};

let client;
let activeGame = { status: "waiting" };
let ownAnswers = {};
let unsubscribeAnswers = function () {};
let renderedScreen = "";

elements.playerName.value = window.localStorage.getItem(PLAYER_NAME_KEY) || "";
elements.playerName.addEventListener("input", function () {
  window.localStorage.setItem(PLAYER_NAME_KEY, elements.playerName.value.trim());
});

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
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

  const now = client.now();
  const startsIn = Number(game.startAt) - now;
  if (startsIn > 0) {
    return { state: "starting", version: version, startsIn: startsIn };
  }

  const durationMs = Number(game.questionDurationSec) * 1000;
  const elapsed = Math.max(0, now - Number(game.startAt));
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

function scoreAnswer(answer, question, game, questionIndex) {
  if (!answer || answer.choice !== question.correctIndex) {
    return 0;
  }

  const durationMs = Number(game.questionDurationSec) * 1000;
  const submittedAt = Number(answer.answeredAt);
  const questionStartedAt = Number(game.startAt) + questionIndex * durationMs;
  const elapsed = Math.min(durationMs, Math.max(0, submittedAt - questionStartedAt));
  const base = Number(game.basePoints) || 0;
  const speed = Number(game.speedPoints) || 0;

  return base + Math.ceil(speed * (1 - elapsed / durationMs));
}

function getScore(game, version) {
  let total = 0;
  let correct = 0;

  version.questions.forEach(function (question, index) {
    const answer = ownAnswers[index];
    const gained = scoreAnswer(answer, question, game, index);
    total += gained;
    if (gained > 0) {
      correct += 1;
    }
  });

  return { total: total, correct: correct };
}

function setVisible(view) {
  elements.waitingView.hidden = view !== "waiting";
  elements.questionView.hidden = view !== "question";
  elements.finishedView.hidden = view !== "finished";
}

function renderWaiting(phase) {
  setVisible("waiting");
  elements.answerOptions.replaceChildren();
  elements.answerMessage.textContent = "";

  if (phase.state === "starting") {
    elements.quizStatus.textContent = "퀴즈가 곧 시작돼요";
    elements.waitingMessage.textContent = "모든 참가자에게 첫 문제가 동시에 열립니다.";
  } else if (phase.state === "error") {
    elements.quizStatus.textContent = "퀴즈 설정을 확인해 주세요";
    elements.waitingMessage.textContent = phase.message;
  } else {
    elements.quizStatus.textContent = "퀴즈 시작을 기다리고 있어요";
    elements.waitingMessage.textContent = "진행자가 시작하면 첫 번째 문제가 자동으로 열립니다.";
  }
}

function renderQuestion(phase) {
  setVisible("question");
  elements.questionCount.textContent = "문제 " + (phase.questionIndex + 1) + " / " + phase.version.questions.length;
  elements.questionText.textContent = phase.question.prompt;
  elements.answerOptions.replaceChildren();

  const submittedAnswer = ownAnswers[phase.questionIndex];
  if (submittedAnswer) {
    elements.answerMessage.textContent = "답안을 제출했습니다. 다음 문제를 기다려 주세요.";
  } else {
    elements.answerMessage.textContent = "답은 한 번만 제출할 수 있습니다.";
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

    if (submittedAnswer) {
      button.disabled = true;
      if (submittedAnswer.choice === index) {
        button.classList.add("selected");
      }
    } else {
      button.addEventListener("click", function () {
        submitAnswer(phase.questionIndex, index);
      });
    }

    elements.answerOptions.append(button);
  });
}

function renderFinished(phase) {
  setVisible("finished");
  const score = getScore(activeGame, phase.version);
  elements.totalScore.textContent = score.total.toLocaleString("ko-KR");
  elements.resultDetail.textContent = "정답 " + score.correct + " / " + phase.version.questions.length + "문항";
}

function updateTimer(phase) {
  if (phase.state === "question") {
    const percent = (phase.remainingMs / phase.durationMs) * 100;
    elements.timerText.textContent = formatSeconds(phase.remainingMs);
    elements.timerBar.style.width = percent + "%";
    return;
  }

  if (phase.state === "starting") {
    elements.waitingMessage.textContent = formatSeconds(phase.startsIn) + " 뒤에 첫 문제가 열립니다.";
  }
}

function render() {
  const phase = getPhase(activeGame);
  const answer = phase.state === "question" ? ownAnswers[phase.questionIndex] : null;
  const screenKey = [
    activeGame.id || "waiting",
    phase.state,
    phase.questionIndex,
    answer ? answer.choice : "",
  ].join("/");

  if (renderedScreen !== screenKey) {
    renderedScreen = screenKey;
    if (phase.state === "question") {
      renderQuestion(phase);
    } else if (phase.state === "finished") {
      renderFinished(phase);
    } else {
      renderWaiting(phase);
    }
  }

  updateTimer(phase);
}

async function submitAnswer(questionIndex, choice) {
  const phase = getPhase(activeGame);
  if (phase.state !== "question" || phase.questionIndex !== questionIndex || ownAnswers[questionIndex]) {
    return;
  }

  const savedName = window.localStorage.getItem(PLAYER_NAME_KEY) || "";
  const playerName = savedName.trim() || "참가자";
  elements.answerMessage.textContent = "답안을 제출하는 중이에요…";

  try {
    const saved = await client.submitAnswer({
      gameId: activeGame.id,
      questionIndex: questionIndex,
      choice: choice,
      playerName: playerName,
    });

    if (!saved) {
      elements.answerMessage.textContent = "이미 제출한 답안입니다.";
    }
  } catch (error) {
    elements.answerMessage.textContent = "답안 제출에 실패했어요. 연결 상태를 확인해 주세요.";
  }
}

async function initialize() {
  client = await createQuizClient("participant");
  elements.connectionBadge.textContent = client.mode === "firebase" ? "실시간 연결" : "데모 모드";
  elements.connectionBadge.classList.toggle("demo", client.mode !== "firebase");
  elements.connectionNotice.hidden = false;
  elements.connectionNotice.textContent = client.notice;

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

  window.setInterval(render, 100);
}

initialize();
