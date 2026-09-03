// Firebase 웹 앱 구성값.
// 이 값은 기존 doktogul-progress 프로젝트 설정을 그대로 사용합니다.
// Firebase 웹 구성값 자체는 비밀키가 아니며, 실제 데이터 접근 통제는 firestore.rules가 담당합니다.
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
