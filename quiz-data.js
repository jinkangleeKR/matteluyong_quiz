function normalizeShortAnswer(value) {
  return String(value || "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

export function isShortAnswerQuestion(question) {
  return question && question.type === "short-answer";
}

export function isCorrectAnswer(answer, question) {
  if (!answer || !question) { return false; }
  if (isShortAnswerQuestion(question)) {
    const submitted = normalizeShortAnswer(answer.text);
    const acceptedAnswers = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
    return Boolean(submitted) && acceptedAnswers.some(function (value) {
      return normalizeShortAnswer(value) === submitted;
    });
  }
  return answer.choice === question.correctIndex;
}

/* 답안과 시간 정보를 점수로 변환하는 공통 함수입니다. */
export function calculateAnswerScore(answer, question, game, questionIndex) {
  if (!isCorrectAnswer(answer, question)) {
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
