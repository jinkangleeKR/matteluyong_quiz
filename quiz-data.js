/* 답안과 시간 정보를 점수로 변환하는 공통 함수입니다. */
export function calculateAnswerScore(answer, question, game, questionIndex) {
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
