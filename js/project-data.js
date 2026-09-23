// 제이쿱 수업 통합 제어 시스템 - 기본 수업 프로젝트
// v2.0부터 학년도·학년·과목별 수업을 "수업 프로젝트" 단위로 관리합니다.

export const APP_VERSION = "2.3.0";
export const DEFAULT_PROJECT_ID = "2026-2-G2-DOKTOGUL";

export const SEED_PROJECTS = [
  {
    id: "2026-2-G2-DOKTOGUL",
    academicYear: 2026,
    semester: "2",
    grade: 2,
    subjectName: "독서 토론과 글쓰기",
    shortName: "독-토-글",
    adminLabel: "2026학년도 2학년 독서 토론과 글쓰기",
    portalTitle: "독-토-글 수업 종합 포털",
    portalSubtitle: "2026학년도 2학년 · 독서 토론과 글쓰기",
    classes: ["A", "B", "C", "E"],
    semesterStart: "2026-08-14",
    semesterEnd: "2027-01-05",
    weeklyTimetable: {
      1: [{ className:"A", period:3 }, { className:"E", period:6 }, { className:"B", period:7 }],
      2: [{ className:"C", period:1 }, { className:"E", period:2 }],
      3: [{ className:"A", period:2 }, { className:"C", period:3 }],
      4: [{ className:"A", period:3 }, { className:"B", period:4 }, { className:"C", period:6 }],
      5: [{ className:"E", period:1 }, { className:"B", period:3 }]
    },
    fixedSubjects: {
      1: [{ subject:"심화국어", className:"K", period:4 }],
      3: [{ subject:"심화국어", className:"K", period:1 }],
      5: [{ subject:"심화국어", className:"K", period:7 }]
    },
    textbookPresets: [
      "Ⅰ. 독서 토론과 글쓰기의 이해",
      "Ⅱ-(1) 「배반의 여름」",
      "Ⅱ-(2) 「인간의 욕구는 전염된다」",
      "Ⅲ-(1) 「우리는 무엇을 공정하다고 느끼는가」",
      "Ⅲ-(2) 「미래의 유일한 상수는 기후 변화」",
      "Ⅳ-(1) 「슈퍼 지능의 출현」",
      "Ⅳ-(2) 「과학과 인문학의 크로스」"
    ],
    noClassDates: [
      "2026-08-17",
      "2026-09-24",
      "2026-09-25",
      "2026-10-05",
      "2026-10-09",
      "2026-11-19",
      "2026-12-25",
      "2027-01-01"
    ],
    academicEvents: [
    {
        "date": "2026-08-14",
        "title": "개학일",
        "detail": "2학기 시작"
    },
    {
        "date": "2026-08-17",
        "title": "대체휴일",
        "detail": ""
    },
    {
        "date": "2026-08-20",
        "title": "사설 모의고사(3학년)",
        "detail": ""
    },
    {
        "date": "2026-09-02",
        "title": "전국연합학력평가(1·2학년) / 수능모의평가(3학년)",
        "detail": ""
    },
    {
        "date": "2026-09-07",
        "title": "수시 원서 접수(~11)",
        "detail": "9/7~9/11"
    },
    {
        "date": "2026-09-24",
        "title": "추석 연휴",
        "detail": ""
    },
    {
        "date": "2026-09-25",
        "title": "추석",
        "detail": ""
    },
    {
        "date": "2026-10-05",
        "title": "개천절 대체휴일",
        "detail": ""
    },
    {
        "date": "2026-10-09",
        "title": "한글날",
        "detail": ""
    },
    {
        "date": "2026-10-12",
        "title": "1회 정기시험",
        "detail": "10/12~10/16"
    },
    {
        "date": "2026-10-13",
        "title": "1회 정기시험",
        "detail": "10/12~10/16"
    },
    {
        "date": "2026-10-14",
        "title": "1회 정기시험",
        "detail": "10/12~10/16"
    },
    {
        "date": "2026-10-15",
        "title": "1회 정기시험",
        "detail": "10/12~10/16"
    },
    {
        "date": "2026-10-16",
        "title": "1회 정기시험",
        "detail": "10/12~10/16"
    },
    {
        "date": "2026-10-20",
        "title": "전국연합학력평가",
        "detail": ""
    },
    {
        "date": "2026-10-22",
        "title": "현장체험학습(1학년)",
        "detail": ""
    },
    {
        "date": "2026-10-27",
        "title": "학부모 공개수업",
        "detail": ""
    },
    {
        "date": "2026-11-03",
        "title": "학생 독립의 날",
        "detail": ""
    },
    {
        "date": "2026-11-11",
        "title": "사설 모의고사(3학년)",
        "detail": ""
    },
    {
        "date": "2026-11-16",
        "title": "수능 출정식",
        "detail": ""
    },
    {
        "date": "2026-11-19",
        "title": "대학수학능력시험(3학년) / 재량휴업일(1·2학년)",
        "detail": ""
    },
    {
        "date": "2026-11-23",
        "title": "2회 정기시험(3학년)",
        "detail": "11/23~11/26"
    },
    {
        "date": "2026-11-24",
        "title": "2회 정기시험(3학년)",
        "detail": "11/23~11/26"
    },
    {
        "date": "2026-11-25",
        "title": "2회 정기시험(3학년)",
        "detail": "11/23~11/26"
    },
    {
        "date": "2026-11-26",
        "title": "2회 정기시험(3학년)",
        "detail": "11/23~11/26"
    },
    {
        "date": "2026-12-07",
        "title": "2회 정기시험(1·2학년)",
        "detail": "12/7~12/11"
    },
    {
        "date": "2026-12-08",
        "title": "2회 정기시험(1·2학년)",
        "detail": "12/7~12/11"
    },
    {
        "date": "2026-12-09",
        "title": "2회 정기시험(1·2학년)",
        "detail": "12/7~12/11"
    },
    {
        "date": "2026-12-10",
        "title": "2회 정기시험(1·2학년)",
        "detail": "12/7~12/11"
    },
    {
        "date": "2026-12-11",
        "title": "2회 정기시험(1·2학년)",
        "detail": "12/7~12/11"
    },
    {
        "date": "2026-12-23",
        "title": "삭주제",
        "detail": "원본 학사일정 표기"
    },
    {
        "date": "2026-12-24",
        "title": "삭주제",
        "detail": "원본 학사일정 표기"
    },
    {
        "date": "2026-12-25",
        "title": "성탄절",
        "detail": ""
    },
    {
        "date": "2026-12-28",
        "title": "사정회",
        "detail": ""
    },
    {
        "date": "2027-01-01",
        "title": "신정",
        "detail": ""
    },
    {
        "date": "2027-01-04",
        "title": "제67회 졸업식",
        "detail": ""
    },
    {
        "date": "2027-01-05",
        "title": "종업식",
        "detail": "2학기 종료"
    }
],
    status: "ACTIVE",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z"
  }
];

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function normalizeProject(project) {
  const p = cloneProject(project || {});
  p.id = String(p.id || "");
  p.academicYear = Number(p.academicYear || new Date().getFullYear());
  p.semester = String(p.semester || "1");
  p.grade = Number(p.grade || 1);
  p.subjectName = String(p.subjectName || "새 과목");
  p.shortName = String(p.shortName || p.subjectName);
  p.adminLabel = String(p.adminLabel || `${p.academicYear}학년도 ${p.grade}학년 ${p.subjectName}`);
  p.portalTitle = String(p.portalTitle || `${p.shortName} 수업 종합 포털`);
  p.portalSubtitle = String(p.portalSubtitle || `${p.academicYear}학년도 ${p.grade}학년 · ${p.subjectName}`);
  p.classes = Array.isArray(p.classes) ? p.classes.map(String).filter(Boolean) : [];
  p.semesterStart = String(p.semesterStart || "");
  p.semesterEnd = String(p.semesterEnd || "");
  p.weeklyTimetable = p.weeklyTimetable && typeof p.weeklyTimetable === "object" ? p.weeklyTimetable : {};
  p.fixedSubjects = p.fixedSubjects && typeof p.fixedSubjects === "object" ? p.fixedSubjects : {};
  p.textbookPresets = Array.isArray(p.textbookPresets) ? p.textbookPresets : [];
  p.noClassDates = Array.isArray(p.noClassDates) ? p.noClassDates : [];
  p.academicEvents = Array.isArray(p.academicEvents) ? p.academicEvents : [];
  p.status = String(p.status || "ACTIVE");
  return p;
}
