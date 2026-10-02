# JCOUP 관리자 v3.3.0 — Firestore 쿼터 보호 안정화

기준: 관리자 v3.2.1에서 확인된 Firestore 429(Quota exceeded) 상황을 반영한 안정화본입니다.

## 핵심 변경
- 수행평가 자동 마감 시 3초마다 전체 attempts를 다시 읽고 강제 제출하던 반복 루프 제거.
- 마감 + 15초 후 평가 상태 문서만 1회 CLOSED 처리. 학생의 이미 열린 응시 화면은 최종 제출/재시도를 계속할 수 있음.
- 교사 `평가 종료`도 평가 상태만 우선 닫고, 모든 미제출 답안을 다시 읽어 일괄 강제확정하는 백그라운드 작업 제거.
- REST가 HTTP 429 / RESOURCE_EXHAUSTED를 반환하면 SDK로 재시도하지 않음. 동일 Firestore quota를 중복 소모하는 재시도 차단.
- REST 성공 뒤 Firestore 네트워크를 disable/enable 하던 재연결 동작 제거. 실시간 리스너의 불필요한 전체 재조회 방지.
- 반별/평가 ID별 독립 운영, 평가 목록 접기, 중복 평가 식별 ID 표시는 유지.

## 중요
현재 Firebase 프로젝트가 이미 429 `Quota exceeded` 상태라면 코드 배포만으로 즉시 quota가 복구되지는 않습니다.
Firebase Console > Firestore Database > Usage에서 오늘 사용량을 확인하고, quota가 복구된 뒤 이 버전으로 운영해야 합니다.

## 배포
관리자 저장소 `Jcoupe-progress` 파일을 이 폴더 내용으로 전체 교체 후 GitHub Pages 배포 완료를 확인하고 Ctrl+F5 하세요.
화면 버전은 v3.3.0이어야 합니다.

Firestore Rules 변경 없음.
