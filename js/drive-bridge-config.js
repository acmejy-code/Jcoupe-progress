// 수행평가2 추가자료 Google Drive Bridge 설정
// 학생 포털과 동일한 Google Apps Script 웹 앱 /exec URL을 입력하세요.
export const DRIVE_BRIDGE_CONFIG = {
  webAppUrl: "PASTE_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"
};

export function isDriveBridgeConfigured(){
  const url=String(DRIVE_BRIDGE_CONFIG.webAppUrl||"").trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/i.test(url);
}
