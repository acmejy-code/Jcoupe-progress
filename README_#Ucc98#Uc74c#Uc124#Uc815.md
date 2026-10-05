# 독서토론과 글쓰기 진도관리기 v1.0

## 이 버전의 목표

이 프로젝트는 **매일 실제 수업을 빠르게 기록하고, 이동수업 반별 진도 차이를 확인하는 것**이 핵심입니다.

### 바로 들어 있는 기능
- 오늘 수업 화면
- 월간 달력
- A/B/C/E반 실제 시간표 자동 표시
- 3학년 심화국어 월 4교시 / 수 1교시 / 금 7교시 고정 표시
- 학교 2학기 일정 표시(수업 가능 여부 판단에는 사용하지 않음)
- 예정 수업 클릭 → 날짜·반·교시 자동 입력
- 진행 / 미진행·결강 기록
- 교과서 지문 빠른 선택
- 페이지, 학습지, 차시, 실제 진행 내용, 다음 시작점, 메모
- 같은 반의 이전 수업 불러오기
- 다른 반 최근 수업 불러오기
- 반별 최근 진도 / 기록 수 비교
- 전체 기록 검색
- JSON 백업·복원
- Firebase 설정 전에는 브라우저 localStorage 저장
- Firebase 설정 후 같은 Google 계정으로 학교 PC·집 PC·휴대폰 동기화
- GitHub Actions를 통한 GitHub Pages 자동 배포

---

# 처음 설정: 순서대로 하면 됩니다

## 1. GitHub 저장소 만들기

1. GitHub에서 새 저장소를 만듭니다.
2. 이름 예시: `doktogul-progress`
3. 이 프로젝트 폴더 안의 파일을 **그대로** 저장소에 올립니다.
4. 기본 브랜치는 `main`으로 둡니다.

> `.github/workflows/pages.yml`도 반드시 같이 올라가야 합니다.

## 2. GitHub Pages 켜기

저장소에서:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

를 선택합니다.

이후 `main`에 파일이 올라가면 포함된 workflow가 사이트를 자동 배포합니다.

---

# 3. Firebase 만들기 — 여러 기기 동기화용

## 3-1. Firebase 프로젝트 생성
Firebase Console에서 새 프로젝트를 만듭니다.

## 3-2. 웹 앱 등록
프로젝트 설정에서 **웹 앱(</>)** 을 추가합니다.

등록 후 아래와 비슷한 설정값이 나옵니다.

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

이 값을 프로젝트의:

`js/firebase-config.js`

파일에 그대로 넣습니다.

## 3-3. Google 로그인 켜기

Firebase Console:

**Authentication → Sign-in method → Google → 사용 설정**

GitHub Pages 배포 후 사이트 주소가 예를 들어

`https://내아이디.github.io/doktogul-progress/`

이라면 Authentication 설정의 **Authorized domains**에

`내아이디.github.io`

를 추가합니다.

## 3-4. Firestore 만들기

Firebase Console:

**Firestore Database → Create database**

를 선택하여 데이터베이스를 만듭니다.

그 다음 **Rules** 탭에 이 프로젝트의 `firestore.rules` 내용을 그대로 붙여 넣고 **Publish** 합니다.

이 규칙은 로그인한 사용자가 자기 UID 아래의 기록만 읽고 쓸 수 있게 합니다.

---

# 4. 다시 GitHub에 올리기

`js/firebase-config.js`를 수정해 GitHub의 `main` 브랜치에 올리면 자동 재배포됩니다.

사이트를 열면 우측 상단에:

- `Google 로그인`
- 로그인 후 `클라우드 동기화`

가 표시됩니다.

학교 PC, 집 PC, 휴대폰에서 **같은 Google 계정으로 로그인하면 같은 기록이 표시됩니다.**

---

# 사용법

## 매일 가장 쉬운 사용
1. 사이트 열기
2. **오늘** 화면 확인
3. 수업이 끝난 반의 `기록` 버튼 누르기
4. 지문명·페이지·진행 내용·다음 시작점 입력
5. 저장

## 진도가 비슷한 반
수업 기록 창에서:
- `이 반의 이전 수업 불러오기`
- `다른 반 최근 기록 불러오기`

를 이용하면 반복 입력을 줄일 수 있습니다.

## 행사로 수업을 못 한 경우
`수업 상태`를 **미진행·결강**으로 바꾸고 이유만 적으면 됩니다.

학교 일정이 달력에 떠 있어도 예정 수업은 지워지지 않습니다.
실제로 했는지 안 했는지는 교사가 기록합니다.

---

# 데이터 저장 방식

## Firebase를 아직 설정하지 않은 경우
현재 브라우저에 저장됩니다.

- 장점: 바로 테스트 가능
- 단점: 다른 PC에서는 보이지 않음

## Firebase 설정 + Google 로그인 후
Firestore에 저장됩니다.

- 학교 PC
- 집 PC
- 휴대폰

에서 같은 Google 계정으로 같은 기록을 사용합니다.

로그인할 때 기존 로컬 기록이 있으면 클라우드로 옮길지 물어봅니다.

---

# 파일 구조

```text
index.html
styles.css
js/
  app.js
  db.js
  firebase-config.js
  static-data.js
firestore.rules
.github/
  workflows/
    pages.yml
.nojekyll
```

### 주로 수정할 파일
- 시간표/학사일정/교과서 지문: `js/static-data.js`
- 화면 디자인: `styles.css`
- 기능: `js/app.js`
- Firebase 연결값: `js/firebase-config.js`

---

# 주의

GitHub Pages는 정적 사이트이므로 **학생 개인정보나 민감한 내용을 코드 파일에 직접 넣지 마세요.**
수업 기록은 Firestore에 저장하고, `firestore.rules`로 로그인한 본인의 데이터만 접근하도록 유지하는 것이 중요합니다.
