// 수행평가2 추가자료 Google Drive Bridge 설정
// 학생 포털과 동일한 Google Apps Script 웹 앱 /exec URL을 입력하세요.
export const DRIVE_BRIDGE_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/AKfycbzwf4mStl7qK5PYR0Rk7JCcW-OnN5J9A_tnblW25D8oGAFyc-JrJEmDN4cpaibQ2r-E/exec"
};

export function isDriveBridgeConfigured(){
  const url=String(DRIVE_BRIDGE_CONFIG.webAppUrl||"").trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/i.test(url);
}
