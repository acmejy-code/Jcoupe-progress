// Firebase 콘솔에서 발급받은 '웹 앱 구성' 값을 아래에 붙여 넣으세요.
// 설정 전에는 앱이 자동으로 '이 기기 저장 모드(localStorage)'로 동작합니다.
// apiKey 등 Firebase 웹 구성 값은 클라이언트 앱에 포함되는 값입니다.
// 실제 데이터 보호는 firestore.rules가 담당하므로 반드시 규칙도 적용하세요.

export const firebaseConfig = {
  apiKey: "AIzaSyDaFR4L91m5NlWpD33lkn6l9VYPJppAaCg",
  authDomain: "doktogul-progress.firebaseapp.com",
  projectId: "doktogul-progress",
  storageBucket: "doktogul-progress.firebasestorage.app",
  messagingSenderId: "95481188113",
  appId: "1:95481188113:web:62c212c71c1b963da0c6b0"
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("PASTE_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("PASTE_")
  );
}
