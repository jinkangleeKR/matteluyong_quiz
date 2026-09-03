/*
 * Firebase 프로젝트를 만든 뒤 웹 앱 설정값을 붙여 넣으세요.
 * Firebase의 웹 API 키는 비밀값이 아니며, 실제 접근 권한은 database.rules.json에서 제어합니다.
 */
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  appId: "",
};

/* Firebase Authentication에서 관리자 계정의 UID를 입력하세요. */
export const firebaseAdminUid = "";

export const isFirebaseConfigured = Object.keys(firebaseConfig).every(function (key) {
  return Boolean(firebaseConfig[key]);
});
