import {
  calculateAnswerScore,
  defaultQuizVersionId,
  getQuizVersion,
  quizVersions,
} from "./quiz-data.js";
import { createGameId, createQuizClient } from "./realtime-store.js";

const elements = {
  notice: document.querySelector("#admin-notice"),
  login: document.querySelector("#admin-login"),
  loginForm: document.querySelector("#login-form"),
  loginMessage: document.querySelector("#login-message"),
  email: document.querySelector("#admin-email"),
  password: document.querySelector("#admin-password"),
  dashboard: document.querySelector("#admin-dashboard"),
  modeBadge: document.querySelector("#admin-mode-badge"),
  version: document.querySelector("#quiz-version"),
  versionDescription: document.querySelector("#version-description"),
  duration: document.querySelector("#question-duration"),
  basePoints: document.querySelector("#base-points"),
  speedPoints: document.querySelector("#speed-points"),
  questionPlan: document.querySelector("#question-plan"),
  start: document.querySelector("#start-game"),
  stop: document.querySelector("#stop-game"),
  reset: document.querySelector("#reset-game"),
  actionMessage: document.querySelector("#admin-action-message"),
  stateBadge: document.querySelector("#game-state-badge"),
  monitorTitle: document.querySelector("#monitor-title"),
  monitorTimer: document.querySelector("#monitor-timer"),
  monitorSubtitle: document.querySelector("#monitor-subtitle"),
  monitorTimerBar: document.querySelector("#monitor-timer-bar"),
  monitorQuestion: document.querySelector("#monitor-question"),
  answerCount: document.querySelector("#answer-count"),
  scoreboardCount: document.querySelector("#scoreboard-count"),
  scoreboardBody: document.querySelector("#scoreboard-body"),
  scoreboardEmpty: document.querySelector("#scoreboard-empty"),
};

let client;
let activeGame = { status: "waiting" };
let activeAnswers = {};
let unsubscribeAnswers = function () {};
let dashboardReady = false;

function formatSeconds(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function limitNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function getPhase(game) {
  if (!game || game.status === "waiting") {
    return { state: "waiting" };
  }

  const version = getQuizVersion(game.versionId);
  if (!version) {
    return { state: "error" };
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
    remainingMs: Math.max(0, durationMs - questionElapsed),
    durationMs: durationMs,
  };
}

function setStateBadge(label, state) {
  elements.stateBadge.textContent = label;
  elements.stateBadge.className = "state-badge " + state;
}

function countCurrentAnswers(questionIndex) {
  if (typeof questionIndex !== "number") {
    return 0;
  }

  return Object.keys(activeAnswers).filter(function (playerId) {
    return Boolean(activeAnswers[playerId] && activeAnswers[playerId][questionIndex]);
  }).length;
}

function getLeaderboard() {
  const version = activeGame && activeGame.id ? getQuizVersion(activeGame.versionId) : null;
  if (!version) {
    return [];
  }

  return Object.keys(activeAnswers).map(function (playerId) {
    const playerAnswers = activeAnswers[playerId] || {};
    let playerName = "참가자";
    let score = 0;
    let correct = 0;

    version.questions.forEach(function (question, index) {
      const answer = playerAnswers[String(index)];
      if (!answer) {
        return;
      }

      if (answer.playerName) {
        playerName = answer.playerName;
      }
      score += calculateAnswerScore(answer, question, activeGame, index);
      if (answer.choice === question.correctIndex) {
        correct += 1;
      }
    });

    return {
      id: playerId,
      name: playerName,
      score: score,
      correct: correct,
    };
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

function renderScoreboard() {
  const leaderboard = getLeaderboard();
  elements.scoreboardCount.textContent = leaderboard.length.toLocaleString("ko-KR") + "명";
  elements.scoreboardCount.className = "state-badge " + (leaderboard.length ? "live" : "waiting");
  elements.scoreboardBody.replaceChildren();
  elements.scoreboardEmpty.hidden = leaderboard.length > 0;

  leaderboard.forEach(function (player, index) {
    const row = document.createElement("tr");
    const rank = document.createElement("td");
    const name = document.createElement("td");
    const correct = document.createElement("td");
    const score = document.createElement("td");
    rank.textContent = String(index + 1);
    name.textContent = player.name;
    correct.textContent = player.correct + " / 4";
    score.textContent = player.score.toLocaleString("ko-KR") + "점";
    row.append(rank, name, correct, score);
    elements.scoreboardBody.append(row);
  });
}

function renderMonitor() {
  const phase = getPhase(activeGame);
  elements.monitorTimerBar.style.width = "0%";

  if (phase.state === "waiting") {
    setStateBadge("대기 중", "waiting");
    elements.monitorTitle.textContent = "퀴즈 시작을 기다리고 있어요";
    elements.monitorTimer.textContent = "--:--";
    elements.monitorSubtitle.textContent = "시작 버튼을 누르면 5초 후 모든 참가자에게 첫 문제가 열립니다.";
    elements.monitorQuestion.textContent = "- / -";
    elements.answerCount.textContent = "0";
    return;
  }

  if (phase.state === "starting") {
    setStateBadge("시작 준비", "starting");
    elements.monitorTitle.textContent = phase.version.title;
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
    elements.monitorSubtitle.textContent = "시간이 끝나면 자동으로 다음 문제로 넘어갑니다.";
    elements.monitorQuestion.textContent = phase.questionIndex + 1 + " / " + phase.version.questions.length;
    elements.answerCount.textContent = countCurrentAnswers(phase.questionIndex).toLocaleString("ko-KR");
    elements.monitorTimerBar.style.width = (phase.remainingMs / phase.durationMs) * 100 + "%";
    return;
  }

  if (phase.state === "error") {
    setStateBadge("설정 오류", "finished");
    elements.monitorTitle.textContent = "퀴즈 버전을 찾지 못했습니다";
    elements.monitorTimer.textContent = "--:--";
    elements.monitorSubtitle.textContent = "게임을 초기화한 뒤 올바른 퀴즈 버전을 선택해 주세요.";
    return;
  }

  setStateBadge("종료", "finished");
  elements.monitorTitle.textContent = "퀴즈가 종료됐어요";
  elements.monitorTimer.textContent = "DONE";
  elements.monitorSubtitle.textContent = "새 퀴즈를 시작하거나 대기 화면으로 초기화할 수 있습니다.";
  elements.monitorQuestion.textContent = phase.version.questions.length + " / " + phase.version.questions.length;
  elements.answerCount.textContent = Object.keys(activeAnswers).length.toLocaleString("ko-KR");
}

function renderQuestionPlan() {
  const version = getQuizVersion(elements.version.value || defaultQuizVersionId);
  if (!version) {
    return;
  }

  elements.versionDescription.textContent = version.description;
  elements.questionPlan.replaceChildren();
  version.questions.forEach(function (question, index) {
    const item = document.createElement("li");
    const prompt = document.createElement("strong");
    const answer = document.createElement("span");
    prompt.textContent = index + 1 + ". " + question.prompt;
    answer.textContent = "정답: " + question.options[question.correctIndex];
    item.append(prompt, answer);
    elements.questionPlan.append(item);
  });
}

function populateVersions() {
  quizVersions.forEach(function (version) {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = version.title + " · " + version.questions.length + "문항";
    elements.version.append(option);
  });
  elements.version.value = defaultQuizVersionId;
  renderQuestionPlan();
}

function showDashboard() {
  if (dashboardReady) {
    return;
  }

  dashboardReady = true;
  elements.login.hidden = true;
  elements.dashboard.hidden = false;
  elements.modeBadge.textContent = client.mode === "firebase" ? "실시간 연결" : "데모 모드";
  elements.modeBadge.classList.toggle("demo", client.mode !== "firebase");
  populateVersions();

  client.subscribeGame(function (game) {
    activeGame = game || { status: "waiting" };
    unsubscribeAnswers();
    activeAnswers = {};

    if (activeGame.id) {
      unsubscribeAnswers = client.subscribeAllAnswers(activeGame.id, function (answers) {
        activeAnswers = answers || {};
        renderMonitor();
        renderScoreboard();
      });
    }

    renderMonitor();
    renderScoreboard();
  });
}

async function startGame() {
  const version = getQuizVersion(elements.version.value);
  if (!version) {
    return;
  }

  if (version.questions.length !== 4) {
    elements.actionMessage.textContent = "현재 게임은 정확히 4문항으로 구성해야 시작할 수 있습니다.";
    return;
  }

  const duration = limitNumber(elements.duration.value, 5, 600, 20);
  const basePoints = limitNumber(elements.basePoints.value, 0, 10000, 100);
  const speedPoints = limitNumber(elements.speedPoints.value, 0, 10000, 100);
  const startAt = client.now() + 5000;
  const game = {
    id: createGameId(startAt),
    status: "live",
    versionId: version.id,
    startAt: startAt,
    questionDurationSec: duration,
    basePoints: basePoints,
    speedPoints: speedPoints,
    questionCount: version.questions.length,
    createdAt: client.now(),
  };

  elements.start.disabled = true;
  try {
    await client.saveGame(game);
    elements.actionMessage.textContent = "설정이 저장됐습니다. 5초 후 1번 문제가 모든 참가자에게 열립니다.";
  } catch (error) {
    elements.actionMessage.textContent = error.message || "퀴즈를 시작하지 못했습니다.";
  } finally {
    elements.start.disabled = false;
  }
}

async function stopGame() {
  if (!activeGame || !activeGame.id) {
    elements.actionMessage.textContent = "진행 중인 퀴즈가 없습니다.";
    return;
  }

  try {
    await client.saveGame(Object.assign({}, activeGame, {
      status: "finished",
      finishedAt: client.now(),
    }));
    elements.actionMessage.textContent = "퀴즈를 종료했습니다.";
  } catch (error) {
    elements.actionMessage.textContent = error.message || "퀴즈를 종료하지 못했습니다.";
  }
}

async function resetGame() {
  try {
    await client.saveGame({ status: "waiting", updatedAt: client.now() });
    elements.actionMessage.textContent = "참가자 화면을 대기 상태로 바꿨습니다.";
  } catch (error) {
    elements.actionMessage.textContent = error.message || "초기화하지 못했습니다.";
  }
}

elements.version.addEventListener("change", renderQuestionPlan);
elements.start.addEventListener("click", startGame);
elements.stop.addEventListener("click", stopGame);
elements.reset.addEventListener("click", resetGame);

async function initialize() {
  client = await createQuizClient("admin");
  elements.notice.hidden = false;
  elements.notice.textContent = client.notice;

  if (client.mode === "demo") {
    showDashboard();
  } else if (client.isAdmin()) {
    showDashboard();
  } else {
    elements.login.hidden = false;
  }

  window.setInterval(function () {
    if (dashboardReady) {
      renderMonitor();
    }
  }, 100);
}

elements.loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();
  elements.loginMessage.textContent = "로그인하는 중이에요…";

  try {
    await client.signInAdmin(elements.email.value, elements.password.value);
    elements.password.value = "";
    showDashboard();
  } catch (error) {
    elements.loginMessage.textContent = error.message || "로그인하지 못했습니다.";
  }
});

initialize();
