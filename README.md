# JCOUP 수업 통합 제어 시스템 관리자 v2.5.0

## 이번 버전
- 기존 v2.4.3 좌석 배치·학생 테스트 새 창 유지
- **공지 메뉴 추가**: 수행평가 공지 / 일반 공지
- 공지 작성·수정·삭제·공개/비공개
- 공지당 첨부파일 최대 5개, 파일당 최대 20MB 직접 업로드
- 학생 포털 공지 자동 반영

## 배포
1. 관리자 저장소 `Jcoupe-progress`를 이 폴더 내용으로 전체 교체 후 Push
2. Firebase Firestore Rules에 `firestore.rules` 적용
3. Firebase Storage를 사용할 수 있도록 설정한 뒤 Storage Rules에 `storage.rules` 적용
4. GitHub Pages 배포 완료 후 Ctrl+F5

Firebase 프로젝트명 `doktogul-progress`는 변경하지 않습니다.
