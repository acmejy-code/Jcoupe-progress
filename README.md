# JCOUP 수업 통합 제어 시스템 관리자 v2.5.3

## 이번 버전
- 안정적으로 사용 중인 v2.5.0 공지 기능을 기준으로 Google Drive 첨부 링크 방식을 적용
- Firebase Storage 사용 안 함
- 공지 첨부: Google Drive 파일명 + 공유 링크 등록, 공지당 최대 5개
- Google Drive 파일은 반드시 `링크가 있는 모든 사용자 - 뷰어`로 공유
- 공지 삭제 시 Google Drive 원본 파일은 삭제되지 않음
- 기존 좌석 배치/창가 표시/수행평가/학생 테스트 새 창 기능 유지

## 중요 수정
이전 v2.5.1에는 삭제된 `noticeFiles` 요소를 초기화 코드에서 계속 참조하는 한 줄이 남아 있어
화면 초기화가 중단될 수 있었습니다. v2.5.3에서 해당 참조를 제거했습니다.

GitHub Pages의 신·구 JS 파일 혼재를 줄이기 위해 로컬 모듈 URL에도 v2.5.3 버전값을 부여했습니다.

## 배포
1. Jcoupe-progress 저장소의 기존 파일을 이 폴더 내용으로 전체 교체
2. Commit
3. Push origin
4. GitHub Actions / Pages 배포 완료 확인
5. 관리자 페이지에서 Ctrl+F5
6. 화면 상단 버전이 v2.5.3인지 확인

## Firebase
- Firebase Storage 활성화/설정 불필요
- storage.rules 적용 불필요
- 공지 데이터 저장용 Firestore 규칙은 기존 v2.5.0 공지 규칙을 유지
