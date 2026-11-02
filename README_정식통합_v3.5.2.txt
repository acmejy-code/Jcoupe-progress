JCOUP 관리자 v3.5.2 정식 통합본

기준: 관리자 v3.5.1의 다음 정식 버전
학생 포털 대응: v1.8.2 정식 통합본

반영 사항
- 수행평가2 3차시 구조화 찬반 입론서 데이터(phase3Outline) 허용 Firestore Rules 반영
- 응답 CSV에 찬성/반대 주장·근거·출처·객관자료·예상반론·반박·요약정리를 각각 별도 열로 출력
- 기존 phase3Essay 호환 텍스트도 함께 유지
- 기존 수행평가1 및 v3.5.1 기능 유지

배포 시 반드시 이 패키지의 firestore.rules를 Firebase Console에 다시 게시하세요.
