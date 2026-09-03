/*
 * 퀴즈 버전 목록입니다.
 * 새 퀴즈는 이 배열에 같은 형태의 객체를 추가하면 관리자 화면에서 자동으로 선택됩니다.
 * 진행 중인 게임은 versionId를 저장하므로, 이미 사용한 버전의 문항을 수정하지 말고 새 버전을 추가하세요.
 */
export const quizVersions = [
  {
    id: "demo-general-knowledge-v1",
    title: "데모 상식 퀴즈",
    description: "실시간 진행 흐름을 확인하기 위한 4문항 예시입니다.",
    questions: [
      {
        id: "q1",
        prompt: "대한민국의 수도는 어디인가요?",
        options: ["부산", "서울", "인천", "대전"],
        correctIndex: 1,
      },
      {
        id: "q2",
        prompt: "무지개의 색은 일반적으로 몇 가지로 구분할까요?",
        options: ["5가지", "6가지", "7가지", "8가지"],
        correctIndex: 2,
      },
      {
        id: "q3",
        prompt: "태양계에서 가장 큰 행성은 무엇인가요?",
        options: ["지구", "화성", "목성", "토성"],
        correctIndex: 2,
      },
      {
        id: "q4",
        prompt: "한글을 창제한 왕은 누구인가요?",
        options: ["세종대왕", "정조", "광개토대왕", "태조"],
        correctIndex: 0,
      },
    ],
  },
];

export const defaultQuizVersionId = quizVersions[0].id;

export function getQuizVersion(versionId) {
  return quizVersions.find(function (version) {
    return version.id === versionId;
  });
}
