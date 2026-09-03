/*
 * Firebase 프로젝트를 만든 뒤 웹 앱 설정값을 붙여 넣으세요.
 * Firebase의 웹 API 키는 비밀값이 아니며, 실제 접근 권한은 database.rules.json에서 제어합니다.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAjLb1hMu4mxkl_ru2ZSLqsmA3Qz922k9s",
  authDomain: "matteluyongquiz.firebaseapp.com",
  databaseURL: "https://matteluyongquiz-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "matteluyongquiz",
  appId: "1:554976812071:web:5adaac6cbf8ef5304dc202",
};

export const isFirebaseConfigured = Object.keys(firebaseConfig).every(function (key) {
  return Boolean(firebaseConfig[key]);
});
