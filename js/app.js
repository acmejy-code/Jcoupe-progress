import { APP_VERSION, DEFAULT_PROJECT_ID, SEED_PROJECTS, cloneProject, normalizeProject } from "./project-data.js?v=3.1.2";
import {
  initDataLayer, storageMode, getCurrentUser, signInGoogle, signOutGoogle,
  upsertRecord, deleteRecordById, migrateLocalToCloud, replaceAllRecords,
  upsertMaterial, deleteMaterialById, migrateLocalMaterialsToCloud, replaceAllMaterials,
  upsertNotice, deleteNoticeById,
  setActiveProject, getActiveProjectId, getProjects, saveProject, archiveProject,
  publishStudentPortalData, studentPortalUrl,
  replaceStudentsForClass, saveSeatLayout, upsertAssessment, setAssessmentStatus, deleteAssessment,
  watchAssessmentAttempts, resetAssessmentRun, setAssessmentDuration, extendAssessmentTime, extendAssessmentStudentTime,
  reopenAssessmentAttempt, finalizeExpiredAssessmentAttempts, finalizeAllAssessmentAttempts, getAssessmentServerTimeMs,
  closeAssessmentStatusOnly, closeAssessmentImmediate, setAssessmentStatusVerified, getAssessmentRecoverySnapshots
} from "./db.js?v=3.1.2";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pad=n=>String(n).padStart(2,"0");
const toYmd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseLocalDate=s=>new Date(`${s}T12:00:00`);
const ASSESSMENT_FINALIZE_GRACE_MS=15000; // v3.1.2: 미제출자가 있을 때만 0초 후 15초 통신 유예

function assessmentTargetStudentIds(a){
  const target=(a?.targetClasses?.length?a.targetClasses:projectClasses()).map(String);
  const out=[];
  const seen=new Set();
  target.forEach(cls=>{
    const roster=students.filter(st=>String(st.className)===String(cls)).map(st=>String(st.studentId));
    let ids=[];
    try{
      const layout=getSeatLayout(cls);
      const slots=layout?layoutSlotsForClass(cls).filter(Boolean).map(String):[];
      const rosterSet=new Set(roster);
      ids=slots.filter(id=>rosterSet.has(id));
    }catch{}
    if(!ids.length)ids=roster;
    ids.forEach(id=>{if(id&&!seen.has(id)){seen.add(id);out.push(id);}});
  });
  return out;
}
function selectedAssessmentAllSubmitted(a){
  if(!a||a.id!==selectedAssessmentId)return false;
  const expected=assessmentTargetStudentIds(a);
  if(!expected.length)return false;
  const byId=new Map(assessmentAttempts.map(at=>[String(at.studentId||at.id),at]));
  return expected.every(id=>byId.get(id)?.status==="SUBMITTED");
}
const todayYmd=()=>toYmd(new Date());
const makeId=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const weekdays=["일","월","화","수","목","금","토"];

let projects=[];
let activeProject=null;
let records=[];
let recordSource="local";
let materials=[];
let materialSource="local";
let editingMaterialId=null;
let materialCategoryFilter="ALL";
let materialSearch="";
let notices=[];
let editingNoticeId=null;
let noticeTypeFilter="ALL";
let noticeSearch="";
let noticeKeptAttachments=[];
let noticeOriginalAttachments=[];
let currentMonth=new Date();
let calendarFilter="ALL";
let showAcademic=true;
let showHiddenSlots=false;
let editingId=null;
let editingProjectId=null;
let students=[];
let assessments=[];
let seatLayouts=[];
let selectedAssessmentId=null;
let selectedMonitorClass="";
let assessmentAttempts=[];
let editingAssessmentId=null;
let assessmentSaveInFlight=false;
let draggedStudentId=null;
let seatEditorSlots=[];
let seatEditorDragIndex=null;
let seatEditorLeftSide="NONE";
let seatEditorRightSide="NONE";
let seatEditorDepthCount=5;
let previewPayload=null;
let previewWindow=null;
let monitorControlStudentId=null;
const assessmentFinalizeLocks=new Set();
const ASSESSMENT_LIST_COLLAPSE_KEY="jcoup_assessment_list_collapsed_v1";
let assessmentListCollapsed=false;
try{assessmentListCollapsed=localStorage.getItem(ASSESSMENT_LIST_COLLAPSE_KEY)==="1";}catch{}
let assessmentServerOffsetMs=0;
let assessmentServerClockSyncedAt=0;

function toast(msg){
  $("toast").textContent=msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),2200);
}
function projectClasses(){ return activeProject?.classes||[]; }
function inSemester(date){
  if(!activeProject) return false;
  const start=activeProject.semesterStart||"0000-01-01";
  const end=activeProject.semesterEnd||"9999-12-31";
  return date>=start&&date<=end;
}
function isNoClassDate(date){ return (activeProject?.noClassDates||[]).includes(date); }
function scheduledSlots(date){
  if(!activeProject||!inSemester(date)||isNoClassDate(date)) return [];
  return activeProject.weeklyTimetable?.[parseLocalDate(date).getDay()]||[];
}
function fixedSlots(date){
  if(!activeProject||!inSemester(date)||isNoClassDate(date)) return [];
  return activeProject.fixedSubjects?.[parseLocalDate(date).getDay()]||[];
}
function eventsOn(date){ return (activeProject?.academicEvents||[]).filter(e=>e.date===date); }
function recordsOn(date){ return records.filter(r=>r.date===date).sort((a,b)=>Number(a.period)-Number(b.period)); }
function existingScheduledRecord(date,cls,period){
  return records.some(r=>r.date===date&&r.className===cls&&String(r.period)===String(period));
}
function sortedClassRecords(cls){
  return records.filter(r=>r.className===cls&&r.status!=="cancelled"&&r.status!=="schedule_hidden")
    .sort((a,b)=>a.date.localeCompare(b.date)||Number(a.period)-Number(b.period));
}
function latestClassRecord(cls,beforeDate=null){
  let arr=sortedClassRecords(cls);
  if(beforeDate) arr=arr.filter(r=>r.date<beforeDate);
  return arr[arr.length-1]||null;
}
function latestOtherRecord(cls,beforeDate=null){
  let arr=records.filter(r=>r.className===cls&&r.status!=="cancelled"&&r.status!=="schedule_hidden");
  if(beforeDate) arr=arr.filter(r=>r.date<=beforeDate);
  arr.sort((a,b)=>a.date.localeCompare(b.date)||Number(a.period)-Number(b.period));
  return arr[arr.length-1]||null;
}

function nextScheduledSlotAfterRecord(record){
  if(!record||!activeProject)return null;
  const end=activeProject.semesterEnd||record.date;
  let d=parseLocalDate(record.date);
  const max=370;
  for(let i=0;i<max;i++){
    const date=toYmd(d);
    if(date>end)break;
    const slots=scheduledSlots(date).filter(s=>String(s.className)===String(record.className)).sort((a,b)=>Number(a.period)-Number(b.period));
    for(const s of slots){
      if(date===record.date&&Number(s.period)<=Number(record.period))continue;
      const existing=records.find(r=>r.date===date&&String(r.className)===String(record.className)&&String(r.period)===String(s.period));
      if(existing?.status==="schedule_hidden"||existing?.status==="cancelled")continue;
      return {date,className:record.className,period:Number(s.period)};
    }
    d.setDate(d.getDate()+1);
  }
  return null;
}
function latestClassRecordBeforeSlot(cls,date,period){
  const arr=sortedClassRecords(cls).filter(r=>r.date<date||(r.date===date&&Number(r.period)<Number(period)));
  return arr[arr.length-1]||null;
}
function nextStartPreviewForSlot(date,className,period){
  const prev=latestClassRecordBeforeSlot(className,date,period);
  if(!prev?.nextStart)return "";
  const next=nextScheduledSlotAfterRecord(prev);
  if(!next)return "";
  return next.date===date&&String(next.className)===String(className)&&Number(next.period)===Number(period)?String(prev.nextStart):"";
}

function setView(name){
  if(name!=="assessments"){closeAccessCodePresentation();closeFloatingExamTimer();}
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${name}`));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===name));
  if(name==="today")renderToday();
  if(name==="calendar")renderCalendar();
  if(name==="progress")renderProgress();
  if(name==="history")renderHistory();
  if(name==="materials")renderMaterials();
  if(name==="notices")renderNotices();
  if(name==="assessments")renderAssessments();
  if(name==="projects")renderProjects();
}

function renderHeader(){
  $("versionBadge").textContent=`v${APP_VERSION}`;
  $("projectSubtitle").textContent=activeProject
    ? `${activeProject.adminLabel} · ${activeProject.classes.join("·")}반`
    : "수업 프로젝트를 선택하세요.";

  $("projectSelect").innerHTML=projects.map(p=>
    `<option value="${esc(p.id)}"${p.id===activeProject?.id?" selected":""}>${esc(p.adminLabel)}</option>`
  ).join("");
}

function rebuildDynamicOptions(){
  const classes=projectClasses();
  $("classFilters").innerHTML=`<button class="chip active" data-class="ALL">전체</button>`+
    classes.map(c=>`<button class="chip" data-class="${esc(c)}">${esc(c)}반</button>`).join("");

  $("historyClass").innerHTML=`<option value="ALL">전체 반</option>`+
    classes.map(c=>`<option value="${esc(c)}">${esc(c)}반</option>`).join("");

  $("className").innerHTML=classes.map(c=>`<option value="${esc(c)}">${esc(c)}반</option>`).join("");

  $("copyFromClass").innerHTML=`<option value="">다른 반 최근 기록 불러오기</option>`+
    classes.map(c=>`<option value="${esc(c)}">${esc(c)}반</option>`).join("");

  $("preset").innerHTML=`<option value="">직접 입력</option>`+
    (activeProject?.textbookPresets||[]).map(x=>`<option>${esc(x)}</option>`).join("");

  document.querySelectorAll("#classFilters .chip").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("#classFilters .chip").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    calendarFilter=b.dataset.class;
    renderCalendar();
  });
}

async function switchProject(projectId){
  const p=projects.find(x=>x.id===projectId);
  if(!p)return;
  activeProject=p;
  calendarFilter="ALL";
  currentMonth=new Date();
  renderHeader();
  rebuildDynamicOptions();
  await setActiveProject(projectId);
  renderToday();renderCalendar();renderProgress();renderHistory();renderMaterials();renderNotices();renderProjects();
  toast(`${p.adminLabel} 프로젝트로 전환했습니다.`);
}

function renderToday(){
  if(!activeProject){
    $("view-today").innerHTML=`<div class="history-empty">수업 프로젝트가 없습니다.</div>`;
    return;
  }
  const date=todayYmd(),d=parseLocalDate(date);
  const slots=scheduledSlots(date).sort((a,b)=>a.period-b.period);
  const fixed=fixedSlots(date).sort((a,b)=>a.period-b.period);
  const evs=eventsOn(date);
  const all=[
    ...slots.map(x=>({...x,kind:"course"})),
    ...fixed.map(x=>({...x,kind:"fixed"}))
  ].sort((a,b)=>a.period-b.period);

  const items=all.map(x=>{
    if(x.kind==="fixed"){
      return `<div class="today-item">
        <div class="period">${x.period}교시</div>
        <div><div class="lesson-line">${esc(x.subject)}</div><div class="subline">${esc(x.className||"")} · 참고 시간표</div></div><div></div>
      </div>`;
    }
    const rec=records.find(r=>r.date===date&&r.className===x.className&&String(r.period)===String(x.period));
    if(rec){
      const cancelled=rec.status==="cancelled";
      return `<div class="today-item">
        <div class="period">${x.period}교시</div>
        <div><div class="lesson-line">${esc(x.className)}반 · ${cancelled?"미진행":esc(rec.title||rec.type)}</div>
        <div class="subline">${cancelled?esc(rec.memo||"사유 미입력"):esc(rec.detail||"기록 완료")}</div></div>
        <div class="today-action"><button class="btn small-btn" data-edit="${esc(rec.id)}">수정</button></div>
      </div>`;
    }
    return `<div class="today-item">
      <div class="period">${x.period}교시</div>
      <div><div class="lesson-line">${esc(x.className)}반 · ${esc(activeProject.subjectName)}</div><div class="subline">아직 실제 수업 기록 없음</div></div>
      <div class="today-action"><button class="btn primary small-btn" data-new="${date}|${esc(x.className)}|${x.period}">기록</button></div>
    </div>`;
  }).join("");

  const evHtml=evs.length?evs.map(e=>`<div class="event-line">${esc(e.title)}</div>`).join(""):`<div class="small muted">학교 일정 없음</div>`;
  const todayDone=recordsOn(date).filter(r=>r.status!=="cancelled"&&r.status!=="schedule_hidden");
  const mini=projectClasses().map(c=>{
    const r=latestClassRecord(c);
    return `<div class="mini-row"><b>${esc(c)}반</b> ${r?esc(r.title||r.type):"기록 없음"}<div class="subline">${r?.nextStart?`다음: ${esc(r.nextStart)}`:""}</div></div>`;
  }).join("");

  $("view-today").innerHTML=`
    <div class="today-head">
      <div><h2>오늘 수업</h2><div class="today-date">${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 · ${esc(activeProject.subjectName)}</div></div>
      <button class="btn" id="todayNew">＋ 수업 직접 기록</button>
    </div>
    <div class="today-layout">
      <div class="card today-main">${items||`<div class="history-empty">오늘 예정된 수업이 없습니다.</div>`}</div>
      <div class="card today-side">
        <h3 style="margin-top:0">학교 일정</h3>${evHtml}
        <div class="quick-stat" style="margin-top:12px">
          <div class="stat"><b>${todayDone.length}</b><span>오늘 실제 수업 기록</span></div>
          <div class="stat"><b>${new Set(todayDone.map(r=>r.className)).size}</b><span>오늘 기록된 반</span></div>
        </div>
        <div class="progress-mini"><h3>최근 진도</h3>${mini}</div>
      </div>
    </div>`;

  $("todayNew").onclick=()=>openRecord({date});
  document.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>{
    const [d,c,p]=b.dataset.new.split("|");openRecord({date:d,className:c,period:p});
  });
  document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editRecord(b.dataset.edit));
}

function renderCalendar(){
  if(!activeProject)return;
  const y=currentMonth.getFullYear(),m=currentMonth.getMonth();
  $("monthTitle").textContent=`${y}년 ${m+1}월`;
  const cal=$("calendar");cal.innerHTML="";
  weekdays.forEach(x=>cal.insertAdjacentHTML("beforeend",`<div class="dow">${x}</div>`));

  const first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate(),prevLast=new Date(y,m,0).getDate();
  for(let i=0;i<42;i++){
    let day,mm=m,yy=y,muted=false;
    if(i<first){day=prevLast-first+i+1;mm=m-1;muted=true;if(mm<0){mm=11;yy--;}}
    else if(i>=first+last){day=i-first-last+1;mm=m+1;muted=true;if(mm>11){mm=0;yy++;}}
    else day=i-first+1;
    const date=`${yy}-${pad(mm+1)}-${pad(day)}`;
    const cell=document.createElement("div");
    cell.className=`day${muted?" muted":""}${isNoClassDate(date)?" holiday-day":""}`;
    cell.innerHTML=`<div class="date">${day}</div>`;

    if(showAcademic)eventsOn(date).forEach(e=>cell.insertAdjacentHTML("beforeend",`<div class="academic">${esc(e.title)}</div>`));
    if(calendarFilter==="ALL")fixedSlots(date).forEach(x=>cell.insertAdjacentHTML("beforeend",`<div class="fixed">${x.period}교시 · ${esc(x.subject)}</div>`));

    scheduledSlots(date).filter(s=>calendarFilter==="ALL"||s.className===calendarFilter).sort((a,b)=>a.period-b.period).forEach(s=>{
      if(existingScheduledRecord(date,s.className,s.period))return;
      const el=document.createElement("div");el.className=`slot ${s.className}`;
      const preview=nextStartPreviewForSlot(date,s.className,s.period);
      const main=document.createElement("div");main.className="slot-main";
      main.innerHTML=`<span>＋ ${esc(s.className)}반 ${s.period}교시</span>${preview?`<small class="slot-next-preview">↪ 다음: ${esc(preview)}</small>`:""}`;
      main.title="눌러서 실제 수업 기록";main.onclick=()=>openRecord({date,className:s.className,period:s.period});
      const hide=document.createElement("button");hide.className="slot-hide";hide.type="button";hide.textContent="×";hide.title="이 날 예정 수업 숨기기";hide.onclick=async e=>{e.stopPropagation();await hideScheduledSlot(date,s.className,s.period);};
      el.append(main,hide);cell.appendChild(el);
    });

    if(showHiddenSlots){
      recordsOn(date).filter(r=>r.status==="schedule_hidden").filter(r=>calendarFilter==="ALL"||r.className===calendarFilter).forEach(r=>{
        const el=document.createElement("div");el.className="hidden-slot";el.innerHTML=`<span>${esc(r.className)}반 ${r.period}교시 · 숨김</span>`;
        const restore=document.createElement("button");restore.type="button";restore.textContent="복원";restore.onclick=async()=>restoreScheduledSlot(r.id);
        el.appendChild(restore);cell.appendChild(el);
      });
    }

    recordsOn(date).filter(r=>r.status!=="schedule_hidden").filter(r=>calendarFilter==="ALL"||r.className===calendarFilter).forEach(r=>{
      const el=document.createElement("div");el.className=`record ${r.className}${r.status==="cancelled"?" cancelled":""}`;
      el.innerHTML=`<strong>${esc(r.className)}반 ${r.period}교시 · ${r.status==="cancelled"?"미진행":esc(r.type)}</strong>
        ${r.status==="cancelled"?esc(r.memo||""):esc(r.title||"")}
        ${r.status!=="cancelled"&&r.nextStart?`<div class="next">다음: ${esc(r.nextStart)}</div>`:""}`;
      el.onclick=()=>editRecord(r.id);cell.appendChild(el);
    });
    cal.appendChild(cell);
  }
}

async function hideScheduledSlot(date,className,period){
  if(!confirm(`${date} ${className}반 ${period}교시 예정 수업을 달력에서 숨길까요?\n\n시험·행사·특별 일정 등으로 실제 수업이 없는 날에 사용하면 됩니다.`))return;
  const rec={id:`hidden-${date}-${className}-${period}`,projectId:activeProject.id,date,className,period:Number(period),status:"schedule_hidden",type:"시간표 제외",session:"",title:"",pages:"",worksheet:"",detail:"",nextStart:"",memo:"수동으로 예정 수업 숨김",studentVisible:false,updatedAt:new Date().toISOString()};
  try{await upsertRecord(rec);toast("예정 수업을 숨겼습니다.");}catch(err){alert("숨김 처리 실패: "+err.message);}
}
async function restoreScheduledSlot(id){
  try{await deleteRecordById(id);toast("예정 수업을 복원했습니다.");}catch(err){alert("복원 실패: "+err.message);}
}

function renderProgress(){
  if(!activeProject)return;
  const classes=projectClasses();
  const cards=classes.map(c=>{
    const arr=sortedClassRecords(c),last=arr[arr.length-1];
    const cancelled=records.filter(r=>r.className===c&&r.status==="cancelled").length;
    return `<div class="card progress-card">
      <h3>${esc(c)}반</h3>
      <div class="last">${last?esc(last.title||last.type):"기록 없음"}</div>
      <div class="nextline">${last?.nextStart?`다음: ${esc(last.nextStart)}`:"다음 시작점 미입력"}</div>
      <div class="count">진행 기록 <b>${arr.length}</b>회 · 미진행 <b>${cancelled}</b>회</div>
    </div>`;
  }).join("");
  const counts=Object.fromEntries(classes.map(c=>[c,sortedClassRecords(c).length]));
  const vals=Object.values(counts);
  const max=vals.length?Math.max(...vals):0,min=vals.length?Math.min(...vals):0;
  const lag=classes.filter(c=>counts[c]===min);
  const msg=max-min>=2?`⚠ ${lag.join(", ")}반이 실제 진행 기록 기준 ${max-min}차시 정도 적습니다. 페이지·지문 기준 비교는 기록을 더 쌓은 뒤 보완할 수 있습니다.`:"현재 반별 실제 진행 기록 수의 차이가 크지 않습니다.";
  $("view-progress").innerHTML=`<div class="progress-grid">${cards}</div><div class="progress-alert">${msg}</div>`;
}

function renderHistory(){
  if(!activeProject)return;
  const q=$("searchText").value.trim().toLowerCase(),c=$("historyClass").value,t=$("historyType").value;
  const rows=[...records].filter(r=>r.status!=="schedule_hidden").sort((a,b)=>b.date.localeCompare(a.date)||Number(b.period)-Number(a.period))
    .filter(r=>(c==="ALL"||r.className===c)&&(t==="ALL"||r.type===t))
    .filter(r=>!q||[r.title,r.detail,r.memo,r.worksheet,r.pages,r.nextStart].some(v=>String(v||"").toLowerCase().includes(q)));

  $("historyList").innerHTML=rows.length?rows.map(r=>`
    <div class="history-row">
      <div><b>${esc(r.date)}</b></div>
      <div>${esc(r.className)}반<br><span class="small muted">${r.period}교시</span></div>
      <div><div class="h-title">${r.status==="cancelled"?"미진행":esc(r.title||r.type)}${r.studentVisible!==false&&r.status!=="cancelled"?`<span class="public-badge">학생 공개 대상</span>`:""}</div>
      <div class="h-sub">${r.status==="cancelled"?esc(r.memo||""):esc([r.pages,r.session,r.detail].filter(Boolean).join(" · "))}</div></div>
      <div class="h-action"><button class="btn small-btn" data-history-edit="${esc(r.id)}">열기</button></div>
    </div>`).join(""):`<div class="history-empty">조건에 맞는 기록이 없습니다.</div>`;

  document.querySelectorAll("[data-history-edit]").forEach(b=>b.onclick=()=>editRecord(b.dataset.historyEdit));
}

function openRecord({date=todayYmd(),className=null,period=1}={}){
  if(!activeProject)return;
  editingId=null;$("dialogTitle").textContent="수업 기록 추가";$("dialogSub").textContent=activeProject.adminLabel;$("deleteBtn").classList.add("hidden");$("recordForm").reset();
  $("date").value=date;$("className").value=className||projectClasses()[0]||"";$("period").value=String(period);$("status").value="done";$("studentVisible").checked=true;
  $("recordDialog").showModal();
}
function editRecord(id){
  const r=records.find(x=>String(x.id)===String(id));if(!r)return;
  editingId=r.id;$("dialogTitle").textContent="수업 기록 수정";$("dialogSub").textContent=`${r.date} · ${r.className}반 ${r.period}교시`;$("deleteBtn").classList.remove("hidden");
  ["date","className","period","status","type","session","pages","worksheet","detail","nextStart","memo"].forEach(k=>$(k).value=r[k]??"");
  $("lessonTitle").value=r.title??"";$("preset").value="";$("studentVisible").checked=r.studentVisible!==false;$("recordDialog").showModal();
}
function copyRecordFields(src){
  if(!src){toast("불러올 이전 기록이 없습니다.");return;}
  $("type").value=src.type||"교과서";$("session").value=src.session||"";$("lessonTitle").value=src.title||"";$("pages").value=src.pages||"";$("worksheet").value=src.worksheet||"";$("detail").value=src.detail||"";$("nextStart").value=src.nextStart||"";$("memo").value="";$("studentVisible").checked=src.studentVisible!==false;toast("이전 수업 내용을 불러왔습니다.");
}
async function saveForm(e){
  e.preventDefault();
  const rec={id:editingId||makeId(),projectId:activeProject.id,date:$("date").value,className:$("className").value,period:Number($("period").value),status:$("status").value,type:$("type").value,session:$("session").value.trim(),title:$("lessonTitle").value.trim(),pages:$("pages").value.trim(),worksheet:$("worksheet").value.trim(),detail:$("detail").value.trim(),nextStart:$("nextStart").value.trim(),memo:$("memo").value.trim(),studentVisible:$("studentVisible").checked,updatedAt:new Date().toISOString()};
  try{
    await upsertRecord(rec);
    $("recordDialog").close();
    if(storageMode()==="cloud"){
      try{
        const result=await publishStudentPortalData(activeProject.id);
        toast(`저장 + 학생 포털 자동 반영 (${result.publishedRecordCount}건)`);
      }catch(pubErr){
        console.warn(pubErr);
        toast("수업은 저장됨 · 학생 포털 발행은 재시도 필요");
      }
    }else{
      toast("저장했습니다. 로그인 후 학생 포털에 발행할 수 있습니다.");
    }
  }catch(err){alert("저장 실패: "+err.message);}
}
async function deleteEditing(){
  if(!editingId||!confirm("이 수업 기록을 삭제할까요?"))return;
  try{
    await deleteRecordById(editingId);
    $("recordDialog").close();
    if(storageMode()==="cloud"){
      try{await publishStudentPortalData(activeProject.id);toast("삭제 + 학생 포털 반영 완료");}
      catch(pubErr){console.warn(pubErr);toast("삭제 완료 · 학생 포털 발행은 재시도 필요");}
    }else toast("삭제했습니다.");
  }catch(err){alert("삭제 실패: "+err.message);}
}


const MATERIAL_CATEGORIES=["수업자료","활동지","PPT","수행평가","시험대비","기타"];

function extractDriveFileId(url){
  const raw=String(url||"").trim();
  if(!raw) return "";
  const patterns=[
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/
  ];
  for(const re of patterns){
    const m=raw.match(re);
    if(m?.[1]) return m[1];
  }
  if(/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return "";
}
function driveLinks(url){
  const fileId=extractDriveFileId(url);
  if(!fileId) return {fileId:"",previewUrl:"",downloadUrl:""};
  return {
    fileId,
    previewUrl:`https://drive.google.com/file/d/${fileId}/view`,
    downloadUrl:`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
  };
}
function fmtMaterialDate(value){
  if(!value) return "-";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return String(value).slice(0,10)||"-";
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())}`;
}
function openMaterialDialog(material=null){
  if(!activeProject) return;
  editingMaterialId=material?.id||null;
  $("materialDialogTitle").textContent=material?"수업 자료 수정":"새 수업 자료 등록";
  $("materialForm").reset();
  $("materialTitle").value=material?.title||"";
  $("materialCategory").value=material?.category||"수업자료";
  $("materialFileType").value=material?.fileType||"PDF";
  $("materialDescription").value=material?.description||"";
  $("materialDriveUrl").value=material?.driveUrl||material?.previewUrl||"";
  $("materialPublished").checked=material?.isPublished!==false;
  $("deleteMaterialBtn").classList.toggle("hidden",!material);
  $("materialDialog").showModal();
}
async function publishAfterMaterialChange(successText){
  if(storageMode()!=="cloud"){
    toast(`${successText} · 로그인 후 학생 포털에 발행할 수 있습니다.`);
    return;
  }
  try{
    const result=await publishStudentPortalData(activeProject.id);
    toast(`${successText} + 학생 포털 반영 (${result.publishedMaterialCount}개 자료)`);
  }catch(err){
    console.warn(err);
    alert(`${successText}은 완료됐지만 학생 포털 발행에 실패했습니다.\n\n${err.message}\n\nFirebase 규칙 v2.2가 적용되었는지 확인해 주세요.`);
  }
}
async function saveMaterialForm(e){
  e.preventDefault();
  const rawUrl=$("materialDriveUrl").value.trim();
  const links=driveLinks(rawUrl);
  if(!links.fileId){
    alert("Google Drive 공유 링크에서 파일 ID를 찾지 못했습니다.\nDrive에서 ‘공유 → 링크 복사’로 받은 주소를 붙여 넣어 주세요.");
    return;
  }
  const existing=materials.find(x=>String(x.id)===String(editingMaterialId));
  const now=new Date().toISOString();
  const material={
    id:editingMaterialId||makeId(),
    projectId:activeProject.id,
    title:$("materialTitle").value.trim(),
    description:$("materialDescription").value.trim(),
    category:$("materialCategory").value,
    fileType:$("materialFileType").value,
    driveUrl:rawUrl,
    ...links,
    // v2.2.1: 수업 자료는 모든 학생 공통 자료로 고정
    targetClasses:["ALL"],
    isPublished:$("materialPublished").checked,
    createdAt:existing?.createdAt||now,
    updatedAt:now
  };
  if(!material.title){ alert("자료명을 입력해 주세요."); return; }
  try{
    await upsertMaterial(material);
    $("materialDialog").close();
    await publishAfterMaterialChange("자료 저장 완료");
  }catch(err){ alert("자료 저장 실패: "+err.message); }
}
async function deleteEditingMaterial(){
  if(!editingMaterialId||!confirm("이 자료를 목록에서 삭제할까요?\n\nGoogle Drive의 원본 파일은 삭제되지 않습니다.")) return;
  try{
    await deleteMaterialById(editingMaterialId);
    $("materialDialog").close();
    editingMaterialId=null;
    await publishAfterMaterialChange("자료 삭제 완료");
  }catch(err){ alert("자료 삭제 실패: "+err.message); }
}
function renderMaterials(){
  if(!activeProject||!$("view-materials")) return;
  const q=materialSearch.trim().toLowerCase();
  const rows=materials
    .filter(m=>materialCategoryFilter==="ALL"||m.category===materialCategoryFilter)
    .filter(m=>!q||[m.title,m.description,m.category,m.fileType].join(" ").toLowerCase().includes(q))
    .sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  const filters=["ALL",...MATERIAL_CATEGORIES].map(c=>`<button class="chip ${materialCategoryFilter===c?"active":""}" data-material-category="${esc(c)}">${c==="ALL"?"전체":esc(c)}</button>`).join("");
  const list=rows.length?rows.map(m=>`
    <div class="material-card card">
      <div class="material-top">
        <div class="material-badges"><span class="material-badge category">${esc(m.category||"수업자료")}</span><span class="material-badge type">${esc(m.fileType||"기타")}</span>${m.isPublished!==false?`<span class="material-badge published">학생 공개</span>`:`<span class="material-badge private">비공개</span>`}</div>
        <button class="btn small-btn" data-material-edit="${esc(m.id)}">수정</button>
      </div>
      <h3>${esc(m.title||"제목 없음")}</h3>
      <p>${esc(m.description||"설명 없음")}</p>
      <div class="material-meta">공통 자료 · 수정 ${esc(fmtMaterialDate(m.updatedAt))}</div>
      <div class="material-actions">
        <a class="btn small-btn" href="${esc(m.previewUrl||m.driveUrl||"#")}" target="_blank" rel="noopener">Drive 열기</a>
        ${m.downloadUrl?`<a class="btn small-btn" href="${esc(m.downloadUrl)}" target="_blank" rel="noopener">다운로드 확인</a>`:""}
      </div>
    </div>`).join(""):`<div class="card material-empty">등록된 수업 자료가 없습니다.<br><span class="small muted">Drive에 파일을 올린 뒤 공유 링크를 등록하세요.</span></div>`;

  $("view-materials").innerHTML=`
    <div class="material-head">
      <div><h2>수업 자료 관리</h2><div class="small muted">파일은 Google Drive에 보관하며, 등록한 자료는 모든 학생에게 공통으로 게시됩니다.</div></div>
      <button class="btn primary" id="newMaterialBtn">＋ 새 자료 등록</button>
    </div>
    <div class="card material-guide">
      <b>무료 운영 방식</b>
      <span>① Drive에 파일 업로드 → ② ‘링크가 있는 모든 사용자 · 뷰어’로 공유 → ③ 공유 링크를 아래 자료에 등록</span>
    </div>
    <div class="material-tools">
      <div class="filters">${filters}</div>
      <input id="materialSearchInput" value="${esc(materialSearch)}" placeholder="자료명·설명 검색"/>
    </div>
    <div class="material-grid">${list}</div>`;

  $("newMaterialBtn").onclick=()=>openMaterialDialog();
  $("materialSearchInput").oninput=e=>{materialSearch=e.target.value;renderMaterials();};
  document.querySelectorAll("[data-material-category]").forEach(b=>b.onclick=()=>{materialCategoryFilter=b.dataset.materialCategory;renderMaterials();});
  document.querySelectorAll("[data-material-edit]").forEach(b=>b.onclick=()=>openMaterialDialog(materials.find(m=>String(m.id)===String(b.dataset.materialEdit))));
}


const NOTICE_TYPES={ASSESSMENT:"수행평가 공지",GENERAL:"일반 공지"};
function formatBytes(bytes){
  const n=Number(bytes||0);if(!n)return "";if(n<1024)return `${n}B`;if(n<1024*1024)return `${(n/1024).toFixed(1)}KB`;return `${(n/1024/1024).toFixed(1)}MB`;
}
function renderNoticeFileLists(){
  const existing=$("noticeExistingAttachments");
  if(!existing)return;
  existing.innerHTML=noticeKeptAttachments.length?noticeKeptAttachments.map((a,i)=>`<div class="notice-file-row"><div><b>${esc(a.name||"첨부파일")}</b><span>${a.source==="GOOGLE_DRIVE"||a.driveUrl?"Google Drive":"링크"}</span>${a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">열기</a>`:""}</div><button type="button" class="notice-file-remove" data-notice-attachment-remove="${i}">×</button></div>`).join(""):`<div class="small muted">등록된 Drive 첨부 없음</div>`;
  existing.querySelectorAll("[data-notice-attachment-remove]").forEach(b=>b.onclick=()=>{noticeKeptAttachments.splice(Number(b.dataset.noticeAttachmentRemove),1);renderNoticeFileLists();});
}
function addNoticeDriveAttachment(){
  if(noticeKeptAttachments.length>=5){alert("첨부파일은 한 공지에 최대 5개까지 등록할 수 있습니다.");return;}
  const name=$("noticeDriveName").value.trim();
  const rawUrl=$("noticeDriveUrl").value.trim();
  if(!name){alert("학생에게 보일 첨부파일명을 입력해 주세요.");$("noticeDriveName").focus();return;}
  if(!rawUrl){alert("Google Drive 공유 링크를 입력해 주세요.");$("noticeDriveUrl").focus();return;}
  const links=driveLinks(rawUrl);
  if(!links){alert("Google Drive 공유 링크에서 파일 ID를 찾지 못했습니다.\nDrive에서 ‘공유 → 링크 복사’로 받은 주소를 붙여 넣어 주세요.");return;}
  if(noticeKeptAttachments.some(a=>String(a.url||a.driveUrl||"")===String(links.previewUrl)||String(a.driveUrl||"")===rawUrl)){alert("이미 등록된 Drive 첨부입니다.");return;}
  noticeKeptAttachments.push({name,size:0,type:"GOOGLE_DRIVE",path:"",url:links.previewUrl,driveUrl:rawUrl,downloadUrl:links.downloadUrl,source:"GOOGLE_DRIVE"});
  $("noticeDriveName").value="";$("noticeDriveUrl").value="";renderNoticeFileLists();
}
function openNoticeDialog(notice=null){
  if(storageMode()!=="cloud"){
    alert("공지 작성은 Google 로그인 후 사용할 수 있습니다.");
    return;
  }
  editingNoticeId=notice?.id||null;
  noticeOriginalAttachments=Array.isArray(notice?.attachments)?notice.attachments.map(a=>({...a})):[];
  noticeKeptAttachments=noticeOriginalAttachments.map(a=>({...a}));
  $("noticeDialogTitle").textContent=notice?"공지 수정":"새 공지 작성";
  $("noticeForm").reset();
  $("noticeType").value=notice?.type||"ASSESSMENT";
  $("noticePublished").value=notice?.isPublished===false?"false":"true";
  $("noticeTitle").value=notice?.title||"";
  $("noticeBody").value=notice?.body||"";
  $("deleteNoticeBtn").classList.toggle("hidden",!notice);
  renderNoticeFileLists();
  $("noticeDialog").showModal();
}
async function saveNoticeForm(e){
  e.preventDefault();
  if(storageMode()!=="cloud"){alert("Google 로그인 후 공지를 저장해 주세요.");return;}
  const title=$("noticeTitle").value.trim(),body=$("noticeBody").value.trim();
  if(!title||!body){alert("공지 제목과 내용을 입력해 주세요.");return;}
  if(noticeKeptAttachments.length>5){alert("첨부파일은 한 공지에 최대 5개까지 등록할 수 있습니다.");return;}
  const existing=notices.find(n=>String(n.id)===String(editingNoticeId));
  const id=editingNoticeId||makeId(), now=new Date().toISOString();
  const saveBtn=$("saveNoticeBtn");saveBtn.disabled=true;saveBtn.textContent="저장 중...";
  try{
    const notice={id,projectId:activeProject.id,type:$("noticeType").value,title,body,isPublished:$("noticePublished").value==="true",attachments:noticeKeptAttachments.map(a=>({...a})),createdAt:existing?.createdAt||now,updatedAt:now};
    await upsertNotice(notice);
    $("noticeDialog").close();editingNoticeId=null;toast(`공지 저장 완료 · ${notice.isPublished?"학생 포털 공개":"비공개"}`);
  }catch(err){
    alert("공지 저장 실패: "+err.message);
  }finally{saveBtn.disabled=false;saveBtn.textContent="공지 저장";}
}
async function deleteEditingNotice(){
  if(!editingNoticeId||!confirm("이 공지를 삭제할까요?\nGoogle Drive의 원본 파일은 삭제되지 않습니다."))return;
  try{await deleteNoticeById(editingNoticeId);$("noticeDialog").close();editingNoticeId=null;toast("공지를 삭제했습니다.");}
  catch(err){alert("공지 삭제 실패: "+err.message);}
}
function renderNotices(){
  const root=$("view-notices");if(!root||!activeProject)return;
  const q=noticeSearch.trim().toLowerCase();
  const rows=notices.filter(n=>noticeTypeFilter==="ALL"||n.type===noticeTypeFilter).filter(n=>!q||[n.title,n.body,NOTICE_TYPES[n.type]||""].join(" ").toLowerCase().includes(q)).sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  const filters=[["ALL","전체"],["ASSESSMENT","수행평가 공지"],["GENERAL","일반 공지"]].map(([v,l])=>`<button class="chip ${noticeTypeFilter===v?"active":""}" data-notice-type="${v}">${l}</button>`).join("");
  const list=rows.length?rows.map(n=>`<article class="notice-admin-card card"><div class="notice-admin-top"><div class="material-badges"><span class="notice-type-badge ${n.type==="ASSESSMENT"?"assessment":"general"}">${esc(NOTICE_TYPES[n.type]||"일반 공지")}</span>${n.isPublished!==false?`<span class="material-badge published">학생 공개</span>`:`<span class="material-badge private">비공개</span>`}${(n.attachments||[]).length?`<span class="material-badge type">첨부 ${(n.attachments||[]).length}</span>`:""}</div><button class="btn small-btn" data-notice-edit="${esc(n.id)}">수정</button></div><h3>${esc(n.title||"제목 없음")}</h3><p>${esc(n.body||"")}</p><div class="material-meta">수정 ${esc(fmtMaterialDate(n.updatedAt))}</div>${(n.attachments||[]).length?`<div class="notice-admin-attachments">${n.attachments.map(a=>`<a href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join("")}</div>`:""}</article>`).join(""):`<div class="card material-empty">등록된 공지가 없습니다.<br><span class="small muted">일반 공지 또는 수행평가 공지를 작성해 보세요.</span></div>`;
  root.innerHTML=`<div class="material-head"><div><h2>공지 관리</h2><div class="small muted">학생 포털의 공지 메뉴에 일반 공지와 수행평가 공지를 게시합니다.</div></div><button class="btn primary" id="newNoticeBtn">＋ 새 공지 작성</button></div><div class="card notice-guide"><b>공지 운영</b><span>수행평가 안내·예시 문항은 ‘수행평가 공지’, 그 밖의 수업 안내는 ‘일반 공지’로 게시하세요. 첨부파일은 Google Drive 공유 링크로 최대 5개까지 연결할 수 있습니다.</span></div><div class="material-tools"><div class="filters">${filters}</div><input id="noticeSearchInput" value="${esc(noticeSearch)}" placeholder="공지 제목·내용 검색"/></div><div class="notice-admin-grid">${list}</div>`;
  $("newNoticeBtn").onclick=()=>openNoticeDialog();$("noticeSearchInput").oninput=e=>{noticeSearch=e.target.value;renderNotices();};root.querySelectorAll("[data-notice-type]").forEach(b=>b.onclick=()=>{noticeTypeFilter=b.dataset.noticeType;renderNotices();});root.querySelectorAll("[data-notice-edit]").forEach(b=>b.onclick=()=>openNoticeDialog(notices.find(n=>String(n.id)===String(b.dataset.noticeEdit))));
}

function updateAuthUi(state){
  const pill=$("syncPill");
  if(state.error){pill.textContent="동기화 오류";pill.className="sync-pill error";}
  else if(state.user){pill.textContent="클라우드 동기화";pill.className="sync-pill cloud";}
  else{pill.textContent=state.configured?"로그인 전 · 이 기기 저장":"이 기기 저장";pill.className="sync-pill local";}
  $("loginBtn").classList.toggle("hidden",Boolean(state.user));$("logoutBtn").classList.toggle("hidden",!state.user);$("loginBtn").textContent=state.configured?"Google 로그인":"온라인 설정";
  if(state.legacyCloudMigrated>0)toast(`기존 독토글 클라우드 기록 ${state.legacyCloudMigrated}건을 새 프로젝트 구조로 복사했습니다.`);
  if(state.legacyLocalMigrated>0)toast(`기존 이 기기 기록 ${state.legacyLocalMigrated}건을 새 프로젝트 구조로 복사했습니다.`);
}

function exportBackup(){
  const payload={system:"JCOOP Course Control",version:APP_VERSION,project:activeProject,exportedAt:new Date().toISOString(),records,materials,notices};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`JCOOP_${activeProject.shortName||activeProject.subjectName}_진도백업_${todayYmd()}.json`;a.click();URL.revokeObjectURL(a.href);
}
async function importBackup(file){
  const text=await file.text(),data=JSON.parse(text),arr=Array.isArray(data)?data:data.records;
  if(!Array.isArray(arr))throw new Error("백업 형식이 올바르지 않습니다.");
  const importedMaterials=Array.isArray(data?.materials)?data.materials:null;
  const msg=importedMaterials
    ? `현재 '${activeProject.adminLabel}'의 기록과 자료 목록을 지우고\n기록 ${arr.length}개 · 자료 ${importedMaterials.length}개로 교체할까요?`
    : `현재 '${activeProject.adminLabel}' 기록을 지우고 ${arr.length}개 기록으로 교체할까요?\n\n※ 이 백업에는 자료실 데이터가 없어 현재 자료 목록은 유지됩니다.`;
  if(!confirm(msg))return;
  await replaceAllRecords(arr);
  if(importedMaterials) await replaceAllMaterials(importedMaterials);
  if(storageMode()==="cloud") await publishStudentPortalData(activeProject.id);
  toast(importedMaterials?"기록과 자료실 백업을 복원했습니다.":"기록 백업을 복원했습니다.");
}

function projectIdFromForm(year,semester,grade,subject){
  const slug=String(subject||"COURSE").toUpperCase().replace(/[^0-9A-Z가-힣]+/g,"-").replace(/^-|-$/g,"").slice(0,24)||"COURSE";
  return `${year}-${semester}-G${grade}-${slug}`;
}
function parseClasses(text){ return String(text||"").split(/[,\n]/).map(x=>x.trim()).filter(Boolean); }
function parseLines(text){ return String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }
function parseTimetableInput(text){
  return String(text||"").split(",").map(x=>x.trim()).filter(Boolean).map(token=>{
    const [className,period]=token.split("@").map(x=>x.trim());
    if(!className||!period||Number.isNaN(Number(period)))return null;
    return {className,period:Number(period)};
  }).filter(Boolean);
}
function timetableText(project,day){
  return (project?.weeklyTimetable?.[day]||[]).map(x=>`${x.className}@${x.period}`).join(", ");
}
function buildTimetableEditor(project=null){
  $("timetableEditor").innerHTML="";
  for(let d=1;d<=5;d++){
    $("timetableEditor").insertAdjacentHTML("beforeend",`<div class="weekday">${weekdays[d]}요일</div><input id="ttDay${d}" placeholder="A@3, B@5" value="${esc(timetableText(project,d))}"/>`);
  }
}
function openProjectDialog(project=null,{duplicate=false}={}){
  editingProjectId=project&&!duplicate?project.id:null;
  const source=project?cloneProject(project):null;
  $("projectDialogTitle").textContent=duplicate?"수업 프로젝트 복제":project?"수업 프로젝트 수정":"새 수업 프로젝트";
  $("projectForm").reset();
  const now=new Date();
  $("projectYear").value=source?.academicYear||now.getFullYear();
  $("projectSemester").value=source?.semester||"1";
  $("projectGrade").value=source?.grade||1;
  $("projectSubject").value=source?.subjectName||"";
  $("projectShortName").value=source?.shortName||"";
  $("projectPortalTitle").value=source?.portalTitle||"";
  $("projectClasses").value=(source?.classes||[]).join(", ");
  $("projectStart").value=source?.semesterStart||"";
  $("projectEnd").value=source?.semesterEnd||"";
  $("projectPresets").value=(source?.textbookPresets||[]).join("\n");
  $("projectNoClassDates").value=(source?.noClassDates||[]).join("\n");
  buildTimetableEditor(source);
  $("projectDialog").showModal();
}
async function saveProjectForm(e){
  e.preventDefault();
  const year=Number($("projectYear").value),semester=$("projectSemester").value,grade=Number($("projectGrade").value),subject=$("projectSubject").value.trim();
  const baseProject=editingProjectId?projects.find(p=>p.id===editingProjectId):null;
  const id=editingProjectId||projectIdFromForm(year,semester,grade,subject);
  const weeklyTimetable={};
  for(let d=1;d<=5;d++){const rows=parseTimetableInput($(`ttDay${d}`).value);if(rows.length)weeklyTimetable[d]=rows;}
  const p=normalizeProject({
    ...(baseProject||{}),id,academicYear:year,semester,grade,subjectName:subject,
    shortName:$("projectShortName").value.trim()||subject,
    portalTitle:$("projectPortalTitle").value.trim()||`${$("projectShortName").value.trim()||subject} 수업 종합 포털`,
    portalSubtitle:`${year}학년도 ${grade}학년 · ${subject}`,
    adminLabel:`${year}학년도 ${grade}학년 ${subject}`,
    classes:parseClasses($("projectClasses").value),
    semesterStart:$("projectStart").value,semesterEnd:$("projectEnd").value,
    weeklyTimetable,
    fixedSubjects:baseProject?.fixedSubjects||{},
    textbookPresets:parseLines($("projectPresets").value),
    noClassDates:parseLines($("projectNoClassDates").value),
    academicEvents:baseProject?.academicEvents||[],
    status:"ACTIVE",
    createdAt:baseProject?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()
  });
  try{
    await saveProject(p);$("projectDialog").close();toast("수업 프로젝트를 저장했습니다.");
    if(!editingProjectId) await switchProject(p.id);
  }catch(err){alert("프로젝트 저장 실패: "+err.message);}
}

async function publishPortalNow(){
  if(storageMode()!=="cloud"){
    alert("학생 포털 발행은 Google 로그인 상태에서 사용할 수 있습니다.");
    return;
  }
  if(!confirm(`현재 '${activeProject.adminLabel}'의 학생 공개 진도·수업 자료·공지를 포털에 반영할까요?\n\n교사용 메모는 공개되지 않으며, 자료는 공개 설정된 항목만 반영됩니다.`)) return;
  const btn=$("publishPortalBtn");
  if(btn){btn.disabled=true;btn.textContent="발행 중...";}
  try{
    const result=await publishStudentPortalData(activeProject.id);
    toast(`학생 포털 발행 완료 · 진도 ${result.publishedRecordCount}건 · 자료 ${result.publishedMaterialCount}개 · 공지 ${result.publishedNoticeCount||0}개`);
  }catch(err){
    alert("학생 포털 발행 실패: "+err.message+"\n\nFirebase 규칙이 v2.2용으로 적용되었는지 확인해 주세요.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent="학생 포털 지금 발행";}
  }
}
function openStudentPortal(){
  window.open(studentPortalUrl(activeProject.id),"_blank","noopener");
}


function nameKey(v){return String(v||"").replace(/\s+/g,"").trim();}
function classStudents(cls){return students.filter(s=>String(s.className)===String(cls)).sort((a,b)=>String(a.studentId).localeCompare(String(b.studentId),"ko",{numeric:true}));}
function getSeatLayout(cls){return seatLayouts.find(x=>String(x.className||x.id)===String(cls))||null;}
function seatDepthCount(layoutOrValue=5){
  if(layoutOrValue&&typeof layoutOrValue==="object"){
    const direct=layoutOrValue.seatsPerVerticalLine??layoutOrValue.verticalDepth;
    if(direct!==undefined&&direct!==null)return Math.min(8,Math.max(2,Number(direct||5)));
    const sourceLen=Array.isArray(layoutOrValue.slots)&&layoutOrValue.slots.length?layoutOrValue.slots.length:(layoutOrValue.orderedStudentIds||[]).length;
    const oldCols=Math.min(8,Math.max(2,Number(layoutOrValue.verticalLines??layoutOrValue.columns??5)));
    if(sourceLen&&oldCols)return Math.min(8,Math.max(2,Math.ceil(sourceLen/oldCols)));
    return 5;
  }
  return Math.min(8,Math.max(2,Number(layoutOrValue||5)));
}
function seatColumnCount(slots,depth){
  const d=seatDepthCount(depth), n=Array.isArray(slots)?slots.length:0;
  return Math.max(1,Math.ceil(n/d));
}
function normalizeSeatSide(v){return ["CORRIDOR","OUTER"].includes(String(v||"").toUpperCase())?String(v).toUpperCase():"NONE";}
function seatSideText(v){return normalizeSeatSide(v)==="CORRIDOR"?"복도쪽 창가":normalizeSeatSide(v)==="OUTER"?"외벽 창가":"";}
function buildVerticalDepthSlots(ids,depthCount){
  const list=(ids||[]).filter(Boolean).map(String), depth=seatDepthCount(depthCount);
  if(!list.length)return [];
  const cols=Math.ceil(list.length/depth), slots=Array(cols*depth).fill(null);
  list.forEach((id,index)=>slots[index]=id);
  return slots;
}
function oldRowMajorToDepthSlots(source,oldColumnCount){
  const list=Array.isArray(source)?source:[], cols=Math.min(8,Math.max(2,Number(oldColumnCount||5)));
  if(!list.length)return [];
  const rows=Math.ceil(list.length/cols), out=[];
  for(let col=0;col<cols;col++){
    for(let row=0;row<rows;row++){
      const index=row*cols+col;
      if(index<list.length)out.push(list[index]===undefined?null:list[index]);
    }
  }
  return out;
}
function verticalStudentOrder(slots){
  return (Array.isArray(slots)?slots:[]).filter(Boolean).map(String);
}
function layoutSlotsForClass(cls){
  const rows=classStudents(cls), layout=getSeatLayout(cls), valid=new Set(rows.map(s=>String(s.studentId)));
  const hasSavedSlots=Array.isArray(layout?.slots)&&layout.slots.length;
  const rawSource=hasSavedSlots?layout.slots:(layout?.orderedStudentIds||[]);
  const sortedIds=rows.map(s=>String(s.studentId));
  let source=[];
  if(layout?.flow==="VERTICAL_DEPTH"){
    source=rawSource.slice();
  }else if(hasSavedSlots){
    const oldCols=Math.min(8,Math.max(2,Number(layout?.verticalLines??layout?.columns??5)));
    source=oldRowMajorToDepthSlots(rawSource,oldCols);
  }else if(rawSource.length){
    source=buildVerticalDepthSlots(rawSource,seatDepthCount(layout||5));
  }else{
    source=buildVerticalDepthSlots(sortedIds,5);
  }
  const slots=[], used=new Set();
  source.forEach(v=>{
    if(v===null||v===undefined||v===""){slots.push(null);return;}
    const id=String(v);
    if(valid.has(id)&&!used.has(id)){slots.push(id);used.add(id);}
  });
  rows.forEach(s=>{const id=String(s.studentId);if(!used.has(id)){slots.push(id);used.add(id);}});
  return slots;
}
function orderedStudents(cls){
  const map=new Map(classStudents(cls).map(s=>[String(s.studentId),s]));
  return layoutSlotsForClass(cls).filter(Boolean).map(id=>map.get(String(id))).filter(Boolean);
}
function timestampMs(v){
  try{
    if(!v)return 0;
    if(typeof v.toMillis==="function")return v.toMillis();
    if(typeof v.toDate==="function")return v.toDate().getTime();
    const d=new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();
  }catch{return 0;}
}
function assessmentDeadlineMs(a,attempt=null){
  const started=timestampMs(a?.startedAt);
  if(!started||!Number(a?.durationMinutes||0))return 0;
  return started+(Number(a.durationMinutes||0)+Number(a.timeExtensionMinutes||0)+Number(attempt?.extraMinutes||0))*60000;
}
function formatRemaining(ms){
  if(!Number.isFinite(ms)||ms<=0)return "00:00";
  const total=Math.ceil(ms/1000),m=Math.floor(total/60),s=total%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function statusInfo(studentId){
  const a=assessmentAttempts.find(x=>String(x.studentId||x.id)===String(studentId));
  if(!a)return {key:"NONE",label:"미접속",sub:"-"};
  if(a.status==="SUBMITTED"){
    const reason=String(a.submissionReason||"");
    const label=reason==="TEACHER_CLOSE"?"종료 제출":a.autoSubmitted?"자동 제출":"제출완료";
    return {key:"SUBMITTED",label,sub:fmtDateTime(a.submittedAt)};
  }
  let ms=0; try{const d=a.lastSeenAt?.toDate?a.lastSeenAt.toDate():new Date(a.lastSeenAt);ms=Date.now()-d.getTime();}catch{}
  if(a.status==="WAITING"){
    if(a.waitingActive===false)return {key:"WAITING_LEFT",label:"대기실 나감",sub:a.lastSeenAt?`마지막 ${fmtDateTime(a.lastSeenAt)}`:"-"};
    if(ms>100000)return {key:"STALE",label:"대기실 연결 끊김",sub:`마지막 신호 ${Math.floor(ms/1000)}초 전`};
    if(ms>45000)return {key:"WARNING",label:"대기실 연결 지연",sub:`마지막 신호 ${Math.floor(ms/1000)}초 전`};
    return {key:"WAITING",label:"대기실 입장",sub:a.lastSeenAt?`접속 ${fmtDateTime(a.lastSeenAt)}`:"입장 확인"};
  }
  const currentAssessment=assessments.find(x=>x.id===selectedAssessmentId);
  const deadline=currentAssessment?assessmentDeadlineMs(currentAssessment,a):0;
  if(deadline&&assessmentNowMs()>=deadline)return {key:"EXPIRED_PENDING",label:"종료 · 확정 대기",sub:a.lastSavedAt?`마지막 저장 ${fmtDateTime(a.lastSavedAt)}`:"서버 저장 확인 중"};
  if(ms>100000)return {key:"STALE",label:"접속 이상",sub:`마지막 신호 ${Math.floor(ms/1000)}초 전`};
  if(ms>45000)return {key:"WARNING",label:"연결 지연",sub:`마지막 신호 ${Math.floor(ms/1000)}초 전`};
  return {key:"IN_PROGRESS",label:"응시중",sub:a.lastSavedAt?`저장 ${fmtDateTime(a.lastSavedAt)}`:"접속 확인"};
}

function assessmentStatusLabel(v){return v==="WAITING"?"입장 대기":v==="OPEN"?"응시 중":v==="CLOSED"?"종료":"준비";}
function assessmentClientFingerprint(a){
  const classes=(Array.isArray(a?.targetClasses)?a.targetClasses:[]).map(String).sort().join("|");
  const qCount=Array.isArray(a?.questions)?a.questions.length:Number(a?.questionCount||0);
  return [String(a?.title||"").trim(),classes,Number(a?.durationMinutes||0),qCount].join("::");
}
function assessmentShortId(a){const id=String(a?.id||"");return id?`#${id.slice(-8).toUpperCase()}`:"#-";}
function fmtDateTime(v){
  if(!v)return "-"; try{const d=v?.toDate?v.toDate():new Date(v);if(Number.isNaN(d.getTime()))return "-";return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}catch{return "-";}
}
function generateAccessCode(){return Math.random().toString(36).slice(2,8).toUpperCase();}
function addQuestionEditor(q={}){
  const wrap=document.createElement("div");wrap.className="question-edit-row";
  wrap.innerHTML=`<div class="question-edit-head"><strong>문항</strong><button type="button" class="icon-btn question-remove">✕</button></div><textarea class="question-prompt" placeholder="문항 내용을 입력하세요.">${esc(q.prompt||"")}</textarea><input class="question-placeholder" placeholder="답안 입력칸 안내(선택)" value="${esc(q.placeholder||"")}"/>`;
  wrap.querySelector(".question-remove").onclick=()=>wrap.remove();
  $("assessmentQuestionEditor").appendChild(wrap);
}
function openAssessmentDialog(a=null){
  if(storageMode()!=="cloud"){alert("수행평가 기능은 Google 로그인 후 사용할 수 있습니다.");return;}
  editingAssessmentId=a?.id||null;
  $("assessmentDialogTitle").textContent=a?"수행평가 수정":"수행평가 만들기";
  $("assessmentTitle").value=a?.title||"";$("assessmentDescription").value=a?.description||"";$("assessmentInstructions").value=a?.instructions||"";
  $("assessmentAccessCode").value=a?.accessCode||generateAccessCode();$("assessmentDuration").value=a?.durationMinutes||50;
  $("assessmentClassChecks").innerHTML=projectClasses().map(c=>`<label><input type="checkbox" value="${esc(c)}" ${(a?.targetClasses||projectClasses()).includes(c)?"checked":""}> ${esc(c)}반</label>`).join("");
  $("assessmentQuestionEditor").innerHTML="";(a?.questions?.length?a.questions:[{}]).forEach(addQuestionEditor);
  $("deleteAssessmentBtn").classList.toggle("hidden",!a);$("assessmentDialog").showModal();
}
async function saveAssessmentForm(e){
  e.preventDefault();
  if(assessmentSaveInFlight)return;
  const questions=[...document.querySelectorAll(".question-edit-row")].map((row,i)=>({id:`q${i+1}`,prompt:row.querySelector(".question-prompt").value.trim(),placeholder:row.querySelector(".question-placeholder").value.trim(),required:true})).filter(q=>q.prompt);
  const targetClasses=[...$("assessmentClassChecks").querySelectorAll("input:checked")].map(x=>x.value);
  const old=editingAssessmentId?assessments.find(x=>x.id===editingAssessmentId):null;
  const targetId=editingAssessmentId||makeId(); // v3.1.2: 저장 시작 시 ID를 한 번만 생성해 연속 클릭 중복 생성을 막음
  const draft={...(old||{}),id:targetId,title:$("assessmentTitle").value,description:$("assessmentDescription").value,instructions:$("assessmentInstructions").value,accessCode:$("assessmentAccessCode").value,targetClasses,durationMinutes:Number($("assessmentDuration").value||0),questions,status:old?.status||"DRAFT"};
  if(!editingAssessmentId){
    const fp=assessmentClientFingerprint(draft);
    const same=assessments.filter(a=>assessmentClientFingerprint(a)===fp);
    if(same.length&&!confirm(`같은 제목·대상 반·시험시간·문항 수의 평가가 이미 ${same.length}개 있습니다.\n\n기존 평가를 수정하려는 것이 아니라 새 평가를 하나 더 만드는 것이 맞습니까?`))return;
  }
  const submit=$("saveAssessmentBtn");
  assessmentSaveInFlight=true;
  if(submit){submit.disabled=true;submit.textContent="저장 중…";}
  try{
    const saved=await upsertAssessment(draft);
    selectedAssessmentId=saved.id;$("assessmentDialog").close();toast(`수행평가를 저장했습니다. (${assessmentShortId(saved)})`);
  }catch(err){alert("수행평가 저장 실패: "+err.message);}
  finally{assessmentSaveInFlight=false;if(submit){submit.disabled=false;submit.textContent="저장";}}
}

function setRosterTab(name){
  document.querySelectorAll("[data-roster-tab]").forEach(b=>b.classList.toggle("active",b.dataset.rosterTab===name));
  ["list","seat"].forEach(k=>$("rosterTab-"+k)?.classList.toggle("active",k===name));
  if(name==="seat")renderSeatEditor();
}
function openRosterDialog(){
  if(storageMode()!=="cloud"){alert("학생 명단은 Google 로그인 후 관리할 수 있습니다.");return;}
  $("rosterClass").innerHTML=projectClasses().map(c=>`<option value="${esc(c)}">${esc(c)}반</option>`).join("");
  $("rosterClass").value=selectedMonitorClass||projectClasses()[0]||"";
  loadRosterDialogText();setRosterTab("list");$("rosterDialog").showModal();
}
function loadRosterDialogText(){
  const cls=$("rosterClass").value, layout=getSeatLayout(cls);
  seatEditorDepthCount=seatDepthCount(layout||5);
  $("rosterColumns").value=String(seatEditorDepthCount);
  seatEditorLeftSide=normalizeSeatSide(layout?.leftSide);
  seatEditorRightSide=normalizeSeatSide(layout?.rightSide);
  if($("seatLeftSide"))$("seatLeftSide").value=seatEditorLeftSide;
  if($("seatRightSide"))$("seatRightSide").value=seatEditorRightSide;
  $("seatSidePanel")?.classList.add("hidden");
  $("rosterText").value=classStudents(cls).map(s=>`${s.studentId}\t${s.name}`).join("\n");
  seatEditorSlots=layoutSlotsForClass(cls);
  renderSeatEditor();
}
function resetSeatEditorSlots(){
  const depth=seatDepthCount($("rosterColumns").value);
  seatEditorDepthCount=depth;
  seatEditorSlots=buildVerticalDepthSlots(classStudents($("rosterClass").value).map(s=>String(s.studentId)),depth);
  renderSeatEditor();
}
function renderSeatSideMarkers(){
  const pairs=[["seatEditorLeftMarker",seatEditorLeftSide],["seatEditorRightMarker",seatEditorRightSide]];
  pairs.forEach(([id,value])=>{const el=$(id);if(!el)return;const label=seatSideText(value);el.textContent=label;el.classList.toggle("hidden",!label);el.classList.toggle("corridor",normalizeSeatSide(value)==="CORRIDOR");el.classList.toggle("outer",normalizeSeatSide(value)==="OUTER");});
  const btn=$("seatSideBtn");if(btn)btn.classList.toggle("seat-side-btn-active",seatEditorLeftSide!=="NONE"||seatEditorRightSide!=="NONE");
}
function applySeatSideSettings(){
  seatEditorLeftSide=normalizeSeatSide($("seatLeftSide")?.value);
  seatEditorRightSide=normalizeSeatSide($("seatRightSide")?.value);
  renderSeatSideMarkers();
  $("seatSidePanel")?.classList.add("hidden");
}
function swapSeatSides(){
  const left=$("seatLeftSide"),right=$("seatRightSide");if(!left||!right)return;
  const tmp=left.value;left.value=right.value;right.value=tmp;
}
function renderSeatEditor(){
  const grid=$("seatEditorGrid");if(!grid)return;
  const cls=$("rosterClass").value, depth=seatDepthCount($("rosterColumns").value), rows=classStudents(cls);
  const studentMap=new Map(rows.map(s=>[String(s.studentId),s]));
  const valid=new Set(rows.map(s=>String(s.studentId))), used=new Set();
  seatEditorSlots=(seatEditorSlots||[]).map(v=>v?String(v):null).filter(v=>!v||valid.has(v));
  seatEditorSlots=seatEditorSlots.map(v=>{if(!v)return null;if(used.has(v))return null;used.add(v);return v;});
  rows.forEach(st=>{const id=String(st.studentId);if(!used.has(id)){seatEditorSlots.push(id);used.add(id);}});
  const cols=seatColumnCount(seatEditorSlots,depth);
  $("seatEditorTitle").textContent=`${cls}반 좌석 배치 · ${rows.length}명 · 세로 한 줄 ${depth}석 · 좌우 ${cols}열`;
  grid.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;
  grid.style.gridTemplateRows=`repeat(${depth},auto)`;
  renderSeatSideMarkers();
  if(!seatEditorSlots.length){grid.innerHTML='<div class="assessment-empty">먼저 학생 명단을 등록해 주세요.</div>';return;}
  grid.innerHTML=seatEditorSlots.map((id,index)=>{
    const row=(index%depth)+1, col=Math.floor(index/depth)+1, pos=`style="grid-column:${col};grid-row:${row}"`;
    if(!id)return `<div class="seat-editor-slot empty" ${pos} data-seat-index="${index}"><span>빈 자리</span><button type="button" class="seat-empty-remove" data-remove-empty="${index}" title="빈 자리 삭제">×</button></div>`;
    const st=studentMap.get(String(id));
    return `<div class="seat-editor-slot" ${pos} data-seat-index="${index}"><div class="seat-card status-none" draggable="true" data-seat-drag-index="${index}"><div class="seat-id">${esc(st?.studentId||id)}</div><strong>${esc(st?.name||"")}</strong><span>좌석 이동</span><small class="seat-position">왼쪽 ${col}번째 열 · 앞에서 ${row}번째</small></div></div>`;
  }).join("");
  grid.querySelectorAll("[data-seat-index]").forEach(slot=>{
    slot.ondragover=e=>{e.preventDefault();slot.classList.add("drag-over")};
    slot.ondragleave=()=>slot.classList.remove("drag-over");
    slot.ondrop=e=>{e.preventDefault();slot.classList.remove("drag-over");const to=Number(slot.dataset.seatIndex);if(seatEditorDragIndex===null||Number.isNaN(to)||to===seatEditorDragIndex)return;const tmp=seatEditorSlots[to]??null;seatEditorSlots[to]=seatEditorSlots[seatEditorDragIndex]??null;seatEditorSlots[seatEditorDragIndex]=tmp;seatEditorDragIndex=null;renderSeatEditor();};
  });
  grid.querySelectorAll("[data-seat-drag-index]").forEach(card=>{
    card.ondragstart=()=>{seatEditorDragIndex=Number(card.dataset.seatDragIndex);card.classList.add("dragging")};
    card.ondragend=()=>{seatEditorDragIndex=null;card.classList.remove("dragging")};
  });
  grid.querySelectorAll("[data-remove-empty]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();seatEditorSlots.splice(Number(btn.dataset.removeEmpty),1);renderSeatEditor();});
}
async function saveSeatEditor(){
  const cls=$("rosterClass").value,depth=seatDepthCount($("rosterColumns").value);
  const ids=verticalStudentOrder(seatEditorSlots);
  const rosterIds=classStudents(cls).map(s=>String(s.studentId));
  if(ids.length!==rosterIds.length||new Set(ids).size!==rosterIds.length){alert("좌석에 모든 학생이 정확히 한 번씩 배치되어야 합니다.");return;}
  try{await saveSeatLayout(cls,depth,ids,seatEditorSlots,{leftSide:seatEditorLeftSide,rightSide:seatEditorRightSide,flow:"VERTICAL_DEPTH"});selectedMonitorClass=cls;toast(`${cls}반 좌석 배치와 교실 방향을 저장했습니다.`);renderAssessmentMonitor();}catch(err){alert(err.message);}
}
function isValidStudentId(value){return /^\d{4,5}$/.test(String(value||"").trim());}
function normalizeRosterRows(rows){
  const cleaned=(rows||[]).map((r,index)=>({
    studentId:String(r?.studentId??r?.id??"").trim().replace(/\.0$/,""),
    name:String(r?.name??"").trim(),
    _row:index+1
  })).filter(r=>r.studentId||r.name);
  const invalid=cleaned.find(r=>!isValidStudentId(r.studentId)||!r.name);
  if(invalid){
    if(!isValidStudentId(invalid.studentId)) throw new Error(`학번은 4자리 또는 5자리 숫자로 입력해 주세요. 확인 위치: ${invalid._row}행 (${invalid.studentId||"빈 값"})`);
    throw new Error(`이름이 비어 있습니다. 확인 위치: ${invalid._row}행`);
  }
  const seen=new Set();
  for(const r of cleaned){
    if(seen.has(r.studentId)) throw new Error(`중복 학번이 있습니다: ${r.studentId}`);
    seen.add(r.studentId);
  }
  return cleaned.map(({_row,...r})=>r).sort((a,b)=>a.studentId.localeCompare(b.studentId,"ko",{numeric:true}));
}
function parseRosterText(text){
  const raw=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const rows=[];
  raw.forEach((line,idx)=>{
    const parts=line.split(/[\t, ]+/).filter(Boolean);
    if(idx===0 && parts.length>=2 && /학번|student/i.test(parts[0]) && /이름|성명|name/i.test(parts.slice(1).join(" "))) return;
    rows.push({studentId:String(parts.shift()||"").trim(),name:parts.join(" ").trim()});
  });
  return normalizeRosterRows(rows);
}
function rosterHeaderKey(value){
  return String(value??"").replace(/^\uFEFF/,"").replace(/[\s·._()\-\/]/g,"").toLowerCase();
}
function findRosterHeader(rows){
  const limit=Math.min(rows.length,30);
  let best=null;
  for(let r=0;r<limit;r++){
    const keys=(rows[r]||[]).map(rosterHeaderKey);
    const find=(aliases)=>keys.findIndex(v=>aliases.includes(v));
    const idCol=find(["학번","학생학번","studentid","studentno","studentnumber"]);
    const nameCol=find(["이름","성명","학생명","학생이름","name","studentname"]);
    const gradeCol=find(["학년","grade"]);
    const classCol=find(["반","학급","class","classno"]);
    const numberCol=find(["번호","번","출석번호","studentnumberinclass","no"]);
    let score=0;
    if(idCol>=0) score+=5;
    if(nameCol>=0) score+=5;
    if(gradeCol>=0) score+=2;
    if(classCol>=0) score+=2;
    if(numberCol>=0) score+=2;
    if(nameCol>=0 && (idCol>=0 || (gradeCol>=0&&classCol>=0&&numberCol>=0))) score+=10;
    if(!best || score>best.score) best={rowIndex:r,idCol,nameCol,gradeCol,classCol,numberCol,score};
  }
  return best;
}
function digitsOnly(value){return String(value??"").trim().replace(/\.0$/,"").replace(/[^0-9]/g,"");}
function buildFiveDigitStudentId(gradeValue,classValue,numberValue){
  const grade=digitsOnly(gradeValue), cls=digitsOnly(classValue), no=digitsOnly(numberValue);
  if(!grade||!cls||!no) return "";
  const g=String(Number(grade));
  if(!/^\d$/.test(g)) return "";
  const c=String(Number(cls)).padStart(2,"0"), n=String(Number(no)).padStart(2,"0");
  if(!/^\d{2}$/.test(c)||!/^\d{2}$/.test(n)) return "";
  return `${g}${c}${n}`;
}
function rosterMatrixToRows(matrix){
  const rows=Array.isArray(matrix)?matrix:[];
  if(!rows.length) return [];
  const normalized=rows.map(r=>Array.isArray(r)?r.map(v=>String(v??"").trim()):[]);
  const headerInfo=findRosterHeader(normalized);
  if(!headerInfo || headerInfo.score<15 || headerInfo.nameCol<0 || (headerInfo.idCol<0 && !(headerInfo.gradeCol>=0&&headerInfo.classCol>=0&&headerInfo.numberCol>=0))){
    throw new Error("명단의 머리글을 찾지 못했습니다. 파일 안에 '이름'과 '학번' 열 또는 '학년·반·번호·이름' 열이 있는지 확인해 주세요.");
  }
  const {rowIndex,idCol,nameCol,gradeCol,classCol,numberCol}=headerInfo;
  const out=[];
  for(let i=rowIndex+1;i<normalized.length;i++){
    const row=normalized[i];
    const name=String(row[nameCol]??"").trim();
    let studentId=idCol>=0?digitsOnly(row[idCol]):"";
    if(!isValidStudentId(studentId) && gradeCol>=0 && classCol>=0 && numberCol>=0){
      studentId=buildFiveDigitStudentId(row[gradeCol],row[classCol],row[numberCol]);
    }
    if(!studentId&&!name) continue;
    // 제목·합계·비고처럼 학생행이 아닌 행은 학번이 없으면 건너뜁니다.
    if(!studentId && name) continue;
    out.push({studentId,name});
  }
  return normalizeRosterRows(out);
}
async function readRosterFile(file){
  if(!file) return [];
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(["csv","tsv","txt"].includes(ext)){
    const text=await file.text(), delimiter=ext==="tsv"?"\t":",";
    const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());
    const matrix=lines.map(line=>{
      if(ext==="txt" && !line.includes("\t") && !line.includes(",")) return line.trim().split(/\s+/);
      return line.split(delimiter).map(v=>v.replace(/^"(.*)"$/,"$1").trim());
    });
    return rosterMatrixToRows(matrix);
  }
  if(["xlsx","xls"].includes(ext)){
    if(!window.XLSX) throw new Error("Excel 읽기 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV로 저장해 다시 시도해 주세요.");
    const buf=await file.arrayBuffer(), wb=window.XLSX.read(buf,{type:"array",cellDates:false});
    if(!wb.SheetNames?.length) throw new Error("Excel 파일에서 시트를 찾을 수 없습니다.");
    const ws=wb.Sheets[wb.SheetNames[0]], matrix=window.XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:""});
    return rosterMatrixToRows(matrix);
  }
  throw new Error("지원하지 않는 파일 형식입니다. Excel, CSV, TSV, TXT 파일을 사용해 주세요.");
}
async function importRosterFile(){
  const file=$("rosterFile")?.files?.[0],status=$("rosterFileStatus");
  if(!file) return;
  if(status) status.textContent="명단 파일을 읽는 중...";
  try{
    const rows=await readRosterFile(file); if(!rows.length) throw new Error("인식된 학생이 없습니다.");
    $("rosterText").value=rows.map(r=>`${r.studentId}\t${r.name}`).join("\n");
    if(status) status.textContent=`${file.name} · ${rows.length}명 인식 완료 · 4자리/5자리 학번 지원`;
  }catch(err){ if(status) status.textContent=`파일 불러오기 실패: ${err.message}`; alert(err.message); }
}
async function applyRoster(){
  let rows; try{rows=parseRosterText($("rosterText").value);}catch(err){alert(err.message);return;}
  const cls=$("rosterClass").value;if(!rows.length){alert("학생 명단을 입력해 주세요.");return;}
  if(!confirm(`${cls}반 명단을 ${rows.length}명으로 교체할까요?\n좌석은 학번 오름차순으로 각 세로줄의 앞→뒤 방향부터 다시 배치됩니다.`))return;
  try{
    await replaceStudentsForClass(cls,rows);
    const depth=seatDepthCount($("rosterColumns").value);
    const orderedIds=rows.map(x=>String(x.studentId)),initialSlots=buildVerticalDepthSlots(orderedIds,depth);
    await saveSeatLayout(cls,depth,orderedIds,initialSlots,{leftSide:seatEditorLeftSide,rightSide:seatEditorRightSide,flow:"VERTICAL_DEPTH"});
    students=students.filter(s=>String(s.className)!==String(cls)).concat(rows.map((r,i)=>({...r,className:cls,seatOrder:i+1})));
    seatEditorDepthCount=depth;seatEditorSlots=initialSlots;selectedMonitorClass=cls;
    toast(`${cls}반 ${rows.length}명 명단을 적용했습니다. 이제 실제 좌석을 배치하세요.`);
    setRosterTab("seat");renderAssessments();
  }catch(err){alert(err.message);}
}
function startAttemptWatch(){
  if(storageMode()!=="cloud"||!selectedAssessmentId){assessmentAttempts=[];return;}
  try{watchAssessmentAttempts(selectedAssessmentId,(rows,err)=>{
    if(err)return;
    assessmentAttempts=rows;
    renderAssessmentMonitor();
    // 마지막 학생 제출 직후 3초 주기까지 기다리지 않고 즉시 종료 여부를 확인한다.
    Promise.resolve().then(()=>runExpiredFinalize()).catch(e=>console.warn("전원 제출 즉시 종료 확인 실패",e));
  });}catch(err){console.error(err);}
}
function monitorEventSummary(at){
  const focus=Number(at?.focusLossCount||0),copy=Number(at?.copyCount||0),paste=Number(at?.pasteCount||0),right=Number(at?.contextMenuCount||0);
  const bits=[];if(focus)bits.push(`이탈 ${focus}`);if(copy)bits.push(`복사 ${copy}`);if(paste)bits.push(`붙여넣기 ${paste}`);if(right)bits.push(`우클릭 ${right}`);
  return bits.join(" · ");
}
function eventLabel(type){
  return ({FOCUS_LOSS:"화면 이탈",COPY:"복사",PASTE:"붙여넣기",CONTEXT_MENU:"우클릭",OFFLINE:"오프라인",ONLINE:"재연결"})[type]||type||"이벤트";
}
function openMonitorControl(studentId){
  const at=assessmentAttempts.find(x=>String(x.studentId||x.id)===String(studentId));
  const st=students.find(x=>String(x.studentId)===String(studentId));
  if(!at||!st)return;
  monitorControlStudentId=String(studentId);
  $("monitorStudentTitle").textContent=`${st.studentId} ${st.name}`;
  const events=Array.isArray(at.eventLog)?[...at.eventLog].slice(-30).reverse():[];
  $("monitorStudentMeta").innerHTML=`상태: <b>${esc(statusInfo(studentId).label)}</b> · 개인 추가시간 <b>${Number(at.extraMinutes||0)}분</b> · 재응시 ${Number(at.reopenCount||0)}회`;
  $("monitorEventList").innerHTML=events.length?events.map(e=>`<div class="monitor-event-row"><b>${esc(eventLabel(e.type))}</b><span>${esc(e.at?new Date(e.at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"-")}</span>${e.detail?`<small>${esc(e.detail)}</small>`:""}</div>`).join(""):`<div class="small muted">기록된 화면 이탈·복사·붙여넣기 이벤트가 없습니다.</div>`;
  $("monitorStudentDialog").showModal();
}
function renderAssessmentMonitor(){
  const root=$("assessmentMonitor");if(!root)return;const a=assessments.find(x=>x.id===selectedAssessmentId);if(!a){root.innerHTML="";return;}
  const cls=selectedMonitorClass||a.targetClasses?.[0]||projectClasses()[0]||"";selectedMonitorClass=cls;
  const layout=getSeatLayout(cls),depth=seatDepthCount(layout||5),slots=layoutSlotsForClass(cls),cols=seatColumnCount(slots,depth),studentMap=new Map(classStudents(cls).map(s=>[String(s.studentId),s]));
  const rows=slots.filter(Boolean).map(id=>studentMap.get(String(id))).filter(Boolean);
  const statuses=rows.map(s=>statusInfo(s.studentId));
  const count=k=>statuses.filter(x=>x.key===k).length;
  const leftLabel=seatSideText(layout?.leftSide),rightLabel=seatSideText(layout?.rightSide);
  const leftMarker=leftLabel?`<div class="seat-side-marker ${normalizeSeatSide(layout?.leftSide).toLowerCase()}">${esc(leftLabel)}</div>`:"";
  const rightMarker=rightLabel?`<div class="seat-side-marker ${normalizeSeatSide(layout?.rightSide).toLowerCase()}">${esc(rightLabel)}</div>`:"";
  const seatHtml=slots.map((id,index)=>{
    const row=(index%depth)+1,col=Math.floor(index/depth)+1,pos=`style="grid-column:${col};grid-row:${row}"`;
    if(!id)return `<div class="seat-empty-monitor" ${pos} data-monitor-slot="${index}">빈 자리</div>`;
    const s=studentMap.get(String(id));if(!s)return `<div class="seat-empty-monitor" ${pos}>빈 자리</div>`;
    const st=statusInfo(s.studentId),at=assessmentAttempts.find(x=>String(x.studentId||x.id)===String(s.studentId)),events=monitorEventSummary(at);
    const remain=assessmentDeadlineMs(a,at)?formatRemaining(assessmentDeadlineMs(a,at)-assessmentNowMs()):"";
    return `<div class="seat-card status-${st.key.toLowerCase()}" ${pos} draggable="true" data-seat-student="${esc(s.studentId)}" data-monitor-slot="${index}">
      <button type="button" class="seat-monitor-more" data-monitor-control="${esc(s.studentId)}" title="감독 기록·시간 조정">⋯</button>
      <div class="seat-id">${esc(s.studentId)}</div><strong>${esc(s.name)}</strong><span>${st.label}</span><small>${esc(st.sub)}</small>
      ${remain&&at?.status!=="SUBMITTED"?`<small class="seat-remaining">남은 ${remain}</small>`:""}
      ${events?`<small class="seat-integrity">${esc(events)}</small>`:""}
    </div>`;
  }).join("");
  root.innerHTML=`<div class="monitor-head"><div><h3>${esc(cls)}반 실시간 좌석 감독</h3><div class="small muted">대기실 입장 학생은 문항을 볼 수 없습니다. 시험 시작 후 정상 신호는 초록, 45초 이상 지연은 노랑, 100초 이상 무응답일 때만 빨강으로 표시합니다.</div></div><div class="monitor-summary"><span>미접속 ${count("NONE")}</span><span>대기 ${count("WAITING")}</span><span>대기실 나감 ${count("WAITING_LEFT")}</span><span>응시중 ${count("IN_PROGRESS")}</span><span>지연 ${count("WARNING")}</span><span>제출 ${count("SUBMITTED")}</span><span>확정대기 ${count("EXPIRED_PENDING")}</span><span>접속이상 ${count("STALE")}</span></div></div><div class="front-label">칠판 · 교탁 (교실 앞)</div><div class="seat-room-layout">${leftMarker}<div class="seat-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${depth},auto)">${seatHtml}</div>${rightMarker}</div><div class="seat-tools"><span class="small muted">카드의 ⋯ 버튼에서 개인 추가시간과 재응시를 허용할 수 있습니다. 화면 이탈 기록은 감독 참고용이며 자동으로 부정행위로 확정하지 않습니다.</span><button class="btn small-btn" id="saveSeatOrderBtn">현재 순서 저장</button></div>`;
  let dragIndex=null;
  root.querySelectorAll("[data-monitor-slot]").forEach(slot=>{slot.ondragover=e=>e.preventDefault();slot.ondrop=e=>{e.preventDefault();const to=Number(slot.dataset.monitorSlot);if(dragIndex===null||to===dragIndex)return;const tmp=slots[to]??null;slots[to]=slots[dragIndex]??null;slots[dragIndex]=tmp;dragIndex=null;const ids=verticalStudentOrder(slots);saveSeatLayout(cls,depth,ids,slots).then(()=>toast("좌석 위치를 저장했습니다.")).catch(err=>alert(err.message));};});
  root.querySelectorAll("[data-seat-student]").forEach(card=>{card.ondragstart=e=>{if(e.target.closest?.("[data-monitor-control]")){e.preventDefault();return;}dragIndex=Number(card.dataset.monitorSlot);draggedStudentId=card.dataset.seatStudent};card.ondragend=()=>{dragIndex=null;draggedStudentId=null};});
  root.querySelectorAll("[data-monitor-control]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();e.preventDefault();openMonitorControl(btn.dataset.monitorControl);});
  $("saveSeatOrderBtn").onclick=async()=>{try{const current=layoutSlotsForClass(cls);await saveSeatLayout(cls,depth,verticalStudentOrder(current),current);toast("좌석 배치를 저장했습니다.");}catch(err){alert(err.message);}};
}

async function downloadAssessmentCsv(){
  const a=assessments.find(x=>x.id===selectedAssessmentId);if(!a)return;
  const rosterMap=new Map(students.map(s=>[String(s.studentId),s]));
  let recoveryRows=[];
  try{recoveryRows=await getAssessmentRecoverySnapshots(a.id);}catch(err){console.warn("복구 스냅샷 조회 실패",err);}
  const recoveryMap=new Map();
  recoveryRows.filter(r=>r.recoveryPending&&r.recoveryStudentId).forEach(r=>{
    const id=String(r.recoveryStudentId),prev=recoveryMap.get(id);
    if(!prev||timestampMs(r.recoveryDetectedAt)>=timestampMs(prev.recoveryDetectedAt))recoveryMap.set(id,r);
  });
  const qs=a.questions||[];
  const headers=["학번","이름","반","상태","시작시각","개인마감시각","제출확정시각","강제확정시각","강제확정기준서버저장시각","강제확정기준기기수정시각","마지막서버저장시각","마지막신호시각","마지막답안수정시각(기기)","자동제출","강제확정","제출사유","복구후보","복구감지시각","복구기기수정시각","화면이탈","복사","붙여넣기","개인추가시간",...qs.map((_,i)=>`문항${i+1}`),...qs.map((_,i)=>`복구문항${i+1}`)];
  const quote=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const rows=assessmentAttempts.map(at=>{
    const st=rosterMap.get(String(at.studentId))||{},rec=recoveryMap.get(String(at.studentId));
    return [at.studentId,st.name||at.studentName||"",st.className||"",at.status||"",fmtDateTime(at.startedAt),fmtDateTime(assessmentDeadlineMs(a,at)),fmtDateTime(at.submittedAt),fmtDateTime(at.forcedFinalizedAt),fmtDateTime(at.forcedFinalizedSourceSavedAt),fmtDateTime(at.forcedFinalizedSourceClientEditAt),fmtDateTime(at.lastSavedAt),fmtDateTime(at.lastSeenAt),fmtDateTime(at.lastClientEditAt),at.autoSubmitted?"Y":"",at.forcedFinalized?"Y":"",at.submissionReason||"",rec?"Y":"",fmtDateTime(rec?.recoveryDetectedAt),fmtDateTime(rec?.recoveryClientEditAt),Number(at.focusLossCount||0),Number(at.copyCount||0),Number(at.pasteCount||0),Number(at.extraMinutes||0),...qs.map(q=>at.answers?.[q.id]||""),...qs.map(q=>rec?.recoveryAnswers?.[q.id]||"")];
  });
  const csv="\ufeff"+[headers,...rows].map(r=>r.map(quote).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`${a.title||"수행평가"}_응답.csv`;link.click();URL.revokeObjectURL(url);
  if(recoveryMap.size)toast(`CSV에 복구 후보 ${recoveryMap.size}명의 기기 최종답안도 함께 포함했습니다.`);
}
function refreshStudentTestSelectors(){
  const aId=$("testAssessmentSelect").value||selectedAssessmentId||assessments[0]?.id||"";
  $("testAssessmentSelect").innerHTML=assessments.map(a=>`<option value="${esc(a.id)}" ${a.id===aId?"selected":""}>${esc(a.title)} (${assessmentStatusLabel(a.status)})</option>`).join("");
  const a=assessments.find(x=>x.id===$("testAssessmentSelect").value)||assessments.find(x=>x.id===aId)||null;
  const target=a?.targetClasses?.length?a.targetClasses:projectClasses();
  let cls=$("testClassSelect").value; if(!target.includes(cls))cls=target[0]||"";
  $("testClassSelect").innerHTML=target.map(c=>`<option value="${esc(c)}" ${c===cls?"selected":""}>${esc(c)}반</option>`).join("");
  const rows=classStudents(cls);
  const current=$("testStudentSelect").value;
  $("testStudentSelect").innerHTML=rows.map(st=>`<option value="${esc(st.studentId)}" ${String(st.studentId)===String(current)?"selected":""}>${esc(st.studentId)} · ${esc(st.name)}</option>`).join("");
}
function openStudentTestDialog(){
  if(storageMode()!=="cloud"){alert("학생 화면 테스트는 Google 로그인 후 사용할 수 있습니다.");return;}
  if(!assessments.length){alert("먼저 수행평가를 만들어 주세요.");return;}
  $("testAssessmentSelect").innerHTML=assessments.map(a=>`<option value="${esc(a.id)}">${esc(a.title)}</option>`).join("");
  $("testAssessmentSelect").value=selectedAssessmentId||assessments[0].id;
  refreshStudentTestSelectors();
  $("testStartAt").value="list";
  $("studentTestDialog").showModal();
}
function buildStudentPreviewPayload(){
  const a=assessments.find(x=>x.id===$("testAssessmentSelect").value);
  const cls=$("testClassSelect").value,studentId=$("testStudentSelect").value,st=classStudents(cls).find(x=>String(x.studentId)===String(studentId));
  if(!a)throw new Error("테스트할 수행평가를 선택해 주세요.");
  if(!st)throw new Error("테스트할 학생을 선택해 주세요.");
  return {
    type:"JCOUP_ADMIN_PREVIEW",
    payload:{
      projectId:activeProject.id,
      previewRun:makeId(),
      startAt:$("testStartAt").value||"list",
      assessment:{...a,status:"OPEN",questionCount:a.questions?.length||0},
      student:{studentId:String(st.studentId),name:String(st.name),className:String(cls)}
    }
  };
}
function sendPreviewPayload(){
  if(!previewPayload||!previewWindow||previewWindow.closed)return;
  try{previewWindow.postMessage(previewPayload,location.origin);}catch(err){console.warn("학생 테스트 데이터 전송 실패",err);}
}
function startStudentPreview(){
  try{previewPayload=buildStudentPreviewPayload();}catch(err){alert(err.message);return;}
  const p=previewPayload.payload,a=p.assessment,st=p.student;
  const url=`${studentPortalUrl(activeProject.id)}&adminPreview=1&previewRun=${encodeURIComponent(p.previewRun)}&v=${encodeURIComponent(APP_VERSION)}`;
  const features="popup=yes,width=1180,height=860,resizable=yes,scrollbars=yes";
  previewWindow=window.open(url,"JCOUP_STUDENT_TEST",features);
  if(!previewWindow){
    alert("학생 테스트 창을 열 수 없습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해 주세요.");
    return;
  }
  $("studentTestDialog").close();
  try{previewWindow.focus();}catch{}
  toast(`${st.className}반 ${st.studentId} ${st.name} 학생 테스트 창을 열었습니다.`);
  let tries=0;
  const timer=setInterval(()=>{
    tries+=1;
    if(!previewWindow||previewWindow.closed||tries>24){clearInterval(timer);return;}
    sendPreviewPayload();
  },250);
}
window.addEventListener("message",e=>{
  if(e.origin!==location.origin)return;
  if(e.data?.type!=="JCOUP_PREVIEW_READY")return;
  if(previewWindow&&e.source!==previewWindow)return;
  sendPreviewPayload();
});


function currentSelectedAssessment(){return assessments.find(x=>x.id===selectedAssessmentId)||null;}
function presentationMonitorRect(){
  const room=document.querySelector("#assessmentMonitor .seat-room-layout")||$("assessmentMonitor");
  const rect=room?.getBoundingClientRect?.();
  if(rect&&rect.width>240&&rect.height>120)return rect;
  return {left:Math.max(16,(window.innerWidth-900)/2),top:Math.max(80,(window.innerHeight-520)/2),width:Math.min(900,window.innerWidth-32),height:Math.min(520,window.innerHeight-120)};
}
function openAccessCodePresentation(){
  const a=currentSelectedAssessment();if(!a)return;
  const overlay=$("accessCodePresentation"),panel=$("accessCodePresentationPanel"),value=$("accessCodePresentationValue");
  if(!overlay||!panel||!value)return;
  const rect=presentationMonitorRect();
  const width=Math.min(Math.max(rect.width,520),window.innerWidth-36);
  const height=Math.min(Math.max(rect.height,300),window.innerHeight-80);
  panel.style.width=`${Math.round(width)}px`;panel.style.height=`${Math.round(height)}px`;
  value.textContent=String(a.accessCode||"-");
  overlay.classList.remove("hidden");overlay.setAttribute("aria-hidden","false");document.body.classList.add("presentation-open");
}
function closeAccessCodePresentation(){
  const overlay=$("accessCodePresentation");if(!overlay)return;
  overlay.classList.add("hidden");overlay.setAttribute("aria-hidden","true");document.body.classList.remove("presentation-open");
}
function sizeFloatingExamTimer(recenter=false){
  const panel=$("floatingExamTimer");if(!panel||panel.classList.contains("hidden"))return;
  const rect=presentationMonitorRect();
  const sample=document.querySelector("#assessmentMonitor .seat-card")||document.querySelector("#assessmentMonitor .seat-empty-monitor");
  const sampleHeight=sample?.getBoundingClientRect?.().height||96;
  const width=Math.min(Math.max(rect.width,520),window.innerWidth-28);
  const height=Math.min(Math.max(sampleHeight*2+64,220),Math.min(340,window.innerHeight-28));
  panel.style.width=`${Math.round(width)}px`;panel.style.height=`${Math.round(height)}px`;
  if(recenter||!panel.dataset.positioned){
    const left=Math.min(Math.max(14,rect.left),Math.max(14,window.innerWidth-width-14));
    const preferredTop=rect.top+Math.min(28,Math.max(8,rect.height*.08));
    const top=Math.min(Math.max(14,preferredTop),Math.max(14,window.innerHeight-height-14));
    panel.style.left=`${Math.round(left)}px`;panel.style.top=`${Math.round(top)}px`;panel.dataset.positioned="1";
  }else{
    const box=panel.getBoundingClientRect();
    panel.style.left=`${Math.min(Math.max(8,box.left),Math.max(8,window.innerWidth-width-8))}px`;
    panel.style.top=`${Math.min(Math.max(8,box.top),Math.max(8,window.innerHeight-height-8))}px`;
  }
}
function openFloatingExamTimer(){
  const a=currentSelectedAssessment();if(!a||a.status!=="OPEN")return;
  const panel=$("floatingExamTimer");if(!panel)return;
  panel.classList.remove("hidden");panel.dataset.positioned="";sizeFloatingExamTimer(true);updateAdminAssessmentClock();
}
function closeFloatingExamTimer(){
  const panel=$("floatingExamTimer");if(!panel)return;
  panel.classList.add("hidden");panel.classList.remove("timer-warning","timer-expired");panel.dataset.positioned="";
}
function bindFloatingExamTimerDrag(){
  const panel=$("floatingExamTimer"),handle=$("floatingExamTimerHandle");if(!panel||!handle||handle.dataset.dragBound)return;
  handle.dataset.dragBound="1";
  let dragging=false,startX=0,startY=0,startLeft=0,startTop=0;
  handle.addEventListener("pointerdown",e=>{
    if(e.target.closest?.("button"))return;
    const r=panel.getBoundingClientRect();dragging=true;startX=e.clientX;startY=e.clientY;startLeft=r.left;startTop=r.top;
    try{handle.setPointerCapture(e.pointerId);}catch{}
    e.preventDefault();
  });
  handle.addEventListener("pointermove",e=>{
    if(!dragging)return;
    const left=Math.min(Math.max(8,startLeft+e.clientX-startX),Math.max(8,window.innerWidth-panel.offsetWidth-8));
    const top=Math.min(Math.max(8,startTop+e.clientY-startY),Math.max(8,window.innerHeight-panel.offsetHeight-8));
    panel.style.left=`${Math.round(left)}px`;panel.style.top=`${Math.round(top)}px`;panel.dataset.positioned="1";
  });
  const stop=e=>{if(!dragging)return;dragging=false;try{handle.releasePointerCapture(e.pointerId);}catch{}};
  handle.addEventListener("pointerup",stop);handle.addEventListener("pointercancel",stop);
}
function presentationKeyboardActivate(el,fn){
  if(!el)return;el.onclick=fn;el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();fn();}};
}

function assessmentNowMs(){return Date.now()+Number(assessmentServerOffsetMs||0);}
async function syncAssessmentServerClock(force=false){
  if(storageMode()!=="cloud")return;
  const now=Date.now();
  if(!force&&assessmentServerClockSyncedAt&&now-assessmentServerClockSyncedAt<60000)return;
  try{
    const serverMs=await getAssessmentServerTimeMs();
    if(serverMs){assessmentServerOffsetMs=serverMs-Date.now();assessmentServerClockSyncedAt=Date.now();}
  }catch(err){console.warn("시험 서버 시각 동기화 실패",err);}
}

function updateAdminAssessmentClock(){
  const el=$("assessmentAdminTimer");
  const floating=$("floatingExamTimer"),floatingValue=$("floatingExamTimerValue"),floatingMeta=$("floatingExamTimerMeta");
  const a=currentSelectedAssessment();
  if(!a||a.status!=="OPEN"||!assessmentDeadlineMs(a)){
    if(el)el.textContent="시간 미시작";
    if(floating&&!floating.classList.contains("hidden"))closeFloatingExamTimer();
    return;
  }
  const ms=assessmentDeadlineMs(a)-assessmentNowMs();
  const remain=ms>0?formatRemaining(ms):"00:00";
  if(el){
    el.textContent=ms>0?`남은 시간 ${remain}`:"기본 시험시간 종료";
    el.classList.toggle("timer-warning",ms>0&&ms<=300000);
    el.classList.toggle("timer-expired",ms<=0);
  }
  if(floatingValue)floatingValue.textContent=ms>0?remain:"00:00";
  if(floatingMeta)floatingMeta.textContent=`시험 ${Number(a.durationMinutes||0)}분${Number(a.timeExtensionMinutes||0)?` · 전체 연장 +${Number(a.timeExtensionMinutes)}분`:""}`;
  if(floating){
    floating.classList.toggle("timer-warning",ms>0&&ms<=300000);
    floating.classList.toggle("timer-expired",ms<=0);
  }
}
async function finalizeOneAssessmentLifecycle(a,now){
  const id=String(a?.id||"");
  if(!id||assessmentFinalizeLocks.has(id))return;
  assessmentFinalizeLocks.add(id);
  try{
    // 선택 중인 평가는 현재 감시 중인 해당 평가의 attempts만 사용한다.
    // 다른 평가의 attempts / 상태는 절대 참조하지 않는다.
    if(id===String(selectedAssessmentId||"")&&selectedAssessmentAllSubmitted(a)){
      await closeAssessmentImmediate(id,"ALL_SUBMITTED");
      toast("대상 학생 전원이 제출하여 평가를 자동 종료했습니다.");
      return;
    }

    const commonDeadline=assessmentDeadlineMs(a);
    if(!commonDeadline||now<commonDeadline+ASSESSMENT_FINALIZE_GRACE_MS)return;

    let result=null;
    try{result=await finalizeExpiredAssessmentAttempts(id,now);}catch(err){console.warn(`${a.title}: 마감 답안 확정 실패`,err);}
    if(result?.finalized>0&&id===String(selectedAssessmentId||""))toast(`시험시간이 끝난 ${result.finalized}명의 마지막 저장 답안을 자동 제출했습니다.`);

    // 개인 추가시간이 남아 있는 학생만 해당 평가를 계속 OPEN으로 둔다.
    if(Number(result?.remainingUnexpired||0)>0)return;

    if(result&&Number(result.failed||0)===0){
      await closeAssessmentImmediate(id,"TIME_EXPIRED");
      if(id===String(selectedAssessmentId||""))toast("시험시간이 종료되어 평가를 자동 종료했습니다.");
      return;
    }

    // 해당 평가 하나만 실패 안전 종료. 다른 평가의 대기실/시험 상태에는 손대지 않는다.
    if(now>=commonDeadline+60000){
      try{
        await closeAssessmentImmediate(id,"TIME_EXPIRED_FAILSAFE");
        if(id===String(selectedAssessmentId||""))toast("마감 지연 안전장치로 평가 상태를 종료했습니다. 답안은 보존됩니다.");
      }catch(err){console.warn(`${a.title}: 마감 지연 안전 종료 실패`,err);}
    }
  }finally{
    assessmentFinalizeLocks.delete(id);
  }
}

async function runExpiredFinalize(){
  if(storageMode()!=="cloud")return;
  const open=assessments.filter(a=>a.status==="OPEN"&&assessmentDeadlineMs(a));
  if(!open.length)return;

  // 서버 시각 동기화 실패가 특정 평가의 생명주기를 막지 않도록 보조적으로만 사용한다.
  await syncAssessmentServerClock().catch(()=>{});
  const now=assessmentNowMs()||Date.now();

  // v3.1.2: 평가별 독립 실행. 한 평가의 네트워크 지연/강제확정 실패가
  // 다른 반 평가의 입장·시작·종료를 기다리게 하지 않는다.
  await Promise.allSettled(open.map(a=>finalizeOneAssessmentLifecycle(a,now)));
}

function renderAssessments(){
  const root=$("view-assessments");if(!activeProject)return;
  if(storageMode()!=="cloud"){root.innerHTML=`<div class="card assessment-empty"><h2>수행평가 응시 관리</h2><p>학생 인증·실시간 감독·답안 수집은 Firestore를 사용하므로 Google 로그인 후 사용할 수 있습니다.</p></div>`;return;}
  if(!selectedAssessmentId||!assessments.some(a=>a.id===selectedAssessmentId))selectedAssessmentId=assessments[0]?.id||null;
  const selected=assessments.find(a=>a.id===selectedAssessmentId)||null;if(!selectedMonitorClass)selectedMonitorClass=selected?.targetClasses?.[0]||projectClasses()[0]||"";
  const timer=selected?.status==="OPEN"?`<div class="assessment-admin-time" id="expandAssessmentTimerBtn" role="button" tabindex="0" title="클릭하면 큰 시험시간 창을 띄웁니다"><b id="assessmentAdminTimer">남은 시간 계산 중</b><span>시험 ${Number(selected.durationMinutes||0)}분${Number(selected.timeExtensionMinutes||0)?` + 전체 연장 ${Number(selected.timeExtensionMinutes)}분`:""}</span></div>`:"";
  const preStartControls=selected?.status==="DRAFT"
    ?`<button class="btn success-btn" id="openWaitingRoomBtn">학생 입장 열기</button>`
    :selected?.status==="WAITING"
      ?`<label class="assessment-duration-inline">시험시간 <input id="waitingDurationInput" type="number" min="1" max="300" value="${Number(selected.durationMinutes||50)}">분</label><button class="btn success-btn" id="startExamBtn">시험 시작</button>`
      :"";
  root.innerHTML=`<div class="assessment-toolbar"><div><h2>수행평가 응시 관리</h2><div class="small muted">각 수행평가는 평가 ID별로 독립 운영됩니다. 한 반의 평가가 지연·종료 실패 상태여도 다른 반 평가의 입장·시작·종료에는 영향을 주지 않습니다.</div></div><div class="assessment-actions"><button class="btn" id="manageRosterBtn">학생 명단·좌석</button><button class="btn" id="studentTestBtn">학생 화면 테스트</button><button class="btn primary" id="newAssessmentBtn">＋ 수행평가 만들기</button></div></div><div class="assessment-layout ${assessmentListCollapsed?"list-collapsed":""}"><div class="assessment-list-panel card"><div class="assessment-list-head"><h3>평가 목록</h3><button type="button" class="assessment-list-toggle" id="assessmentListToggleBtn" title="${assessmentListCollapsed?"평가 목록 펼치기":"평가 목록 접기"}" aria-label="${assessmentListCollapsed?"평가 목록 펼치기":"평가 목록 접기"}">${assessmentListCollapsed?"▶":"◀"}</button></div><div class="assessment-list">${assessments.length?assessments.map(a=>`<button class="assessment-row ${a.id===selectedAssessmentId?"active":""}" data-assessment-id="${esc(a.id)}"><span><b>${esc(a.title)}</b><small>${esc((a.targetClasses||[]).join("·"))}반 · ${a.questions?.length||0}문항 · ${Number(a.durationMinutes||0)}분 · ${esc(assessmentShortId(a))}</small></span><em class="assessment-status ${String(a.status).toLowerCase()}">${assessmentStatusLabel(a.status)}</em></button>`).join(""):`<div class="empty">아직 만든 수행평가가 없습니다.</div>`}</div></div><div class="assessment-main">${selected?`<div class="card assessment-control"><div class="assessment-control-head"><div><div class="label">${assessmentStatusLabel(selected.status)}</div><h3>${esc(selected.title)}</h3><p>${esc(selected.description||"학생 안내 없음")}</p><div class="small muted">평가 ID ${esc(selected.id)}</div></div><div class="assessment-control-side"><div class="code-box" id="expandAccessCodeBtn" role="button" tabindex="0" title="클릭하면 응시코드를 크게 표시합니다"><span>응시코드</span><strong>${esc(selected.accessCode)}</strong></div>${timer}</div></div><div class="assessment-control-actions"><button class="btn" id="editAssessmentBtn">수정</button>${preStartControls}${selected.status==="OPEN"?`<button class="btn danger" id="closeAssessmentBtn2">평가 종료</button><button class="btn" id="extendAssessment5Btn">전체 +5분</button><button class="btn" id="extendAssessment10Btn">전체 +10분</button>`:""}${selected.status==="WAITING"?`<button class="btn danger" id="cancelWaitingAssessmentBtn">대기실 닫기</button>`:""}<button class="btn" id="exportAssessmentBtn">응답 CSV</button><button class="btn" id="resetAssessmentBtn">테스트 기록 초기화</button><button class="btn danger" id="deleteAssessmentDirectBtn">평가 삭제</button><label class="monitor-class-label">감독 반 <select id="monitorClassSelect">${(selected.targetClasses||[]).map(c=>`<option value="${esc(c)}" ${c===selectedMonitorClass?"selected":""}>${esc(c)}반</option>`).join("")}</select></label></div></div><div id="assessmentMonitor" class="card assessment-monitor"></div>`:`<div class="card assessment-empty"><b>수행평가를 만들어 주세요.</b></div>`}</div></div>`;
  $("manageRosterBtn").onclick=openRosterDialog;$("studentTestBtn").onclick=openStudentTestDialog;$("newAssessmentBtn").onclick=()=>openAssessmentDialog();
  const listToggle=$("assessmentListToggleBtn");if(listToggle)listToggle.onclick=()=>{assessmentListCollapsed=!assessmentListCollapsed;try{localStorage.setItem(ASSESSMENT_LIST_COLLAPSE_KEY,assessmentListCollapsed?"1":"0");}catch{}renderAssessments();startAttemptWatch();};
  document.querySelectorAll("[data-assessment-id]").forEach(b=>b.onclick=()=>{closeAccessCodePresentation();closeFloatingExamTimer();selectedAssessmentId=b.dataset.assessmentId;assessmentAttempts=[];const aa=assessments.find(x=>x.id===selectedAssessmentId);selectedMonitorClass=aa?.targetClasses?.[0]||"";renderAssessments();startAttemptWatch();});
  if(selected){
    presentationKeyboardActivate($("expandAccessCodeBtn"),openAccessCodePresentation);
    presentationKeyboardActivate($("expandAssessmentTimerBtn"),openFloatingExamTimer);
    $("editAssessmentBtn").onclick=()=>openAssessmentDialog(selected);
    const waitingBtn=$("openWaitingRoomBtn");if(waitingBtn)waitingBtn.onclick=async()=>{
      if(!confirm("학생 입장을 열까요?\n\n학생들은 학번·이름·응시코드로 인증한 뒤 대기실에서 기다리며, 아직 문항은 볼 수 없습니다."))return;
      waitingBtn.disabled=true;waitingBtn.textContent="입장 여는 중…";
      try{
        await setAssessmentStatusVerified(selected.id,"WAITING");
        toast("학생 대기실을 열었습니다. 관리자·학생 상태 확인 완료");
      }catch(err){
        alert(`학생 입장을 열지 못했습니다.\n${err.message||err}\n\n새로고침 후 다시 시도해 주세요.`);
      }finally{if(waitingBtn.isConnected){waitingBtn.disabled=false;waitingBtn.textContent="학생 입장 열기";}}
    };
    const startBtn=$("startExamBtn");if(startBtn)startBtn.onclick=async()=>{
      const minutes=Math.max(1,Number($("waitingDurationInput")?.value||selected.durationMinutes||50));
      if(!confirm(`시험을 지금 시작할까요?\n\n문항이 학생들에게 동시에 공개되고 ${minutes}분의 공통 시험시간이 지금부터 시작됩니다.`))return;
      startBtn.disabled=true;startBtn.textContent="시험 시작 중…";
      try{
        await setAssessmentDuration(selected.id,minutes);
        await setAssessmentStatusVerified(selected.id,"OPEN");
        toast(`${minutes}분 시험을 시작했습니다. 학생 공개 상태 확인 완료`);
      }catch(err){
        alert(`시험 시작 처리에 실패했습니다.\n${err.message||err}`);
      }finally{if(startBtn.isConnected){startBtn.disabled=false;startBtn.textContent="시험 시작";}}
    };
    const closeBtn=$("closeAssessmentBtn2");if(closeBtn)closeBtn.onclick=async()=>{
      if(!confirm("평가를 지금 종료할까요?\n\n평가 상태는 즉시 종료되어 학생 목록에서 닫히며, 아직 제출하지 않은 답안은 서버의 마지막 저장본을 기준으로 백그라운드 확정합니다. 기존 답안은 삭제되지 않습니다."))return;
      closeBtn.disabled=true;closeBtn.textContent="즉시 종료 중…";
      try{
        // v3.1.2 핵심: Firestore batch.commit 서버 승인까지만 기다리고 CLOSED 처리한다.
        // 추가 서버 재조회는 하지 않으며, 8초 이상 응답이 없으면 버튼을 즉시 복구해 무한 대기를 막는다.
        const closed=await closeAssessmentImmediate(selected.id,"TEACHER_CLOSE_IMMEDIATE");
        if(closed?.sameFingerprintOpen>0){
          alert(`선택한 평가 ${assessmentShortId(selected)}는 서버에서 종료 확정되었습니다.\n\n다만 제목·반·시험시간·문항 수가 같은 다른 평가가 ${closed.sameFingerprintOpen}개 아직 '응시 중'입니다. 목록의 평가 ID를 확인해 각각 종료해 주세요.`);
        }else{
          toast(`평가 종료가 서버에 반영되었습니다. (${assessmentShortId(selected)})`);
        }
        finalizeAllAssessmentAttempts(selected.id,"TEACHER_CLOSE").then(r=>{
          if(r.failed>0)console.warn(`백그라운드 답안 확정 실패 ${r.failed}명`,r.errorCodes||[]);
          else if(r.finalized>0)toast(`${r.finalized}명의 미제출 답안을 서버 저장본으로 확정했습니다.`);
        }).catch(err=>console.warn("백그라운드 답안 확정 실패",err));
      }catch(err){
        alert(`평가 종료 요청을 완료하지 못했습니다.\n${err.message||err}\n\n버튼은 다시 사용할 수 있습니다. 같은 버튼을 연속으로 누르기보다 잠시 뒤 목록 상태를 확인해 주세요. 답안 데이터는 삭제되지 않습니다.`);
      }finally{
        if(closeBtn.isConnected){closeBtn.disabled=false;closeBtn.textContent="평가 종료";}
      }
    };
    const cancelWaitingBtn=$("cancelWaitingAssessmentBtn");if(cancelWaitingBtn)cancelWaitingBtn.onclick=async()=>{
      if(!confirm("이 평가의 학생 대기실을 닫고 평가를 종료 상태로 바꿀까요?\n대기실 인증 기록과 평가 데이터는 삭제되지 않습니다."))return;
      cancelWaitingBtn.disabled=true;
      try{await closeAssessmentImmediate(selected.id,"WAITING_CANCELLED");toast("대기실을 닫았습니다.");}
      catch(err){alert(`대기실 종료에 실패했습니다.\n${err.message||err}`);}
      finally{if(cancelWaitingBtn.isConnected)cancelWaitingBtn.disabled=false;}
    };
    const ex5=$("extendAssessment5Btn");if(ex5)ex5.onclick=async()=>{await extendAssessmentTime(selected.id,5);toast("전체 시험시간을 5분 연장했습니다.");};
    const ex10=$("extendAssessment10Btn");if(ex10)ex10.onclick=async()=>{await extendAssessmentTime(selected.id,10);toast("전체 시험시간을 10분 연장했습니다.");};
    $("exportAssessmentBtn").onclick=downloadAssessmentCsv;
    $("resetAssessmentBtn").onclick=async()=>{if(confirm("이 평가의 학생 응시 기록과 인증 세션을 모두 삭제할까요?\n시험 전 시뮬레이션 기록 초기화 용도입니다.")){const n=await resetAssessmentRun(selected.id);assessmentAttempts=[];toast(`${n}개 응시 기록을 초기화했습니다.`);}};
    $("deleteAssessmentDirectBtn").onclick=async()=>{
      if(selected.status==="OPEN"){alert("현재 응시 중인 평가는 바로 삭제할 수 없습니다. 평가 종료 후 삭제해 주세요.");return;}
      if(!confirm(`「${selected.title}」 평가를 완전히 삭제할까요?\n\n응시 기록·인증 세션·문항 데이터도 함께 삭제되며 복구할 수 없습니다.`))return;
      if(!confirm("정말 삭제합니다. 이 작업은 되돌릴 수 없습니다."))return;
      try{
        const r=await deleteAssessment(selected.id);
        selectedAssessmentId=null;assessmentAttempts=[];
        if(r?.sameFingerprintRemaining>0){
          alert(`선택한 평가 ${assessmentShortId(selected)}는 Firestore 서버에서 삭제 확인되었습니다.\n\n다만 제목·반·시험시간·문항 수가 같은 별도 평가 ID가 ${r.sameFingerprintRemaining}개 남아 있습니다.\n목록에 같은 제목이 다시 보여도 삭제한 평가가 부활한 것이 아니라 다른 평가입니다.`);
        }else{
          toast(`평가를 서버에서 삭제 확인했습니다. (${assessmentShortId(selected)} · 응시기록 ${r?.attempts||0}건 정리)`);
        }
      }
      catch(err){alert(`평가 삭제 중 오류가 발생했습니다.\n${err.message||err}`);}
    };
    $("monitorClassSelect").onchange=e=>{selectedMonitorClass=e.target.value;renderAssessmentMonitor();};
    renderAssessmentMonitor();updateAdminAssessmentClock();
  }
}

function renderProjects(){
  if(!activeProject)return;
  const cards=projects.map(p=>`
    <div class="card project-card ${p.id===activeProject.id?"active-project":""}">
      ${p.id===activeProject.id?`<span class="active-label">현재 프로젝트</span>`:""}
      <h3>${esc(p.subjectName)}</h3>
      <div class="project-meta">
        ${p.academicYear}학년도 · ${esc(p.semester)}학기 · ${p.grade}학년<br>
        담당 반: ${esc((p.classes||[]).join(" · ")||"미설정")}<br>
        기간: ${esc(p.semesterStart||"-")} ~ ${esc(p.semesterEnd||"-")}
      </div>
      <div class="project-actions">
        ${p.id!==activeProject.id?`<button class="btn small-btn" data-project-use="${esc(p.id)}">열기</button>`:""}
        <button class="btn small-btn" data-project-edit="${esc(p.id)}">수정</button>
        <button class="btn small-btn" data-project-copy="${esc(p.id)}">복제</button>
      </div>
    </div>`).join("");

  $("view-projects").innerHTML=`
    <div class="project-head"><div><h2>수업 프로젝트</h2><div class="small muted">학년도·학기·학년·과목별로 수업 데이터를 분리해 누적합니다.</div></div><button class="btn primary" id="newProjectBtn">＋ 새 프로젝트</button></div>
    <div class="card project-summary">
      <div class="project-summary-row">
        <div>
          <strong>${esc(activeProject.adminLabel)}</strong>
          <div class="small muted">현재 진도 기록은 이 프로젝트에 저장됩니다. 학생용 포털 제목: ${esc(activeProject.portalTitle)}</div>
          <div class="small muted" style="margin-top:4px">수업 기록 저장 시 학생 공개 대상 진도가 자동으로 포털에 반영됩니다.</div>
        </div>
        <div class="project-publish-actions">
          <button class="btn primary" id="publishPortalBtn">학생 포털 지금 발행</button>
          <button class="btn" id="openPortalBtn">학생 포털 열기</button>
        </div>
      </div>
    </div>
    <div class="project-grid">${cards}</div>`;

  $("newProjectBtn").onclick=()=>openProjectDialog();
  $("publishPortalBtn").onclick=publishPortalNow;
  $("openPortalBtn").onclick=openStudentPortal;
  document.querySelectorAll("[data-project-use]").forEach(b=>b.onclick=()=>switchProject(b.dataset.projectUse));
  document.querySelectorAll("[data-project-edit]").forEach(b=>b.onclick=()=>openProjectDialog(projects.find(p=>p.id===b.dataset.projectEdit)));
  document.querySelectorAll("[data-project-copy]").forEach(b=>b.onclick=()=>openProjectDialog(projects.find(p=>p.id===b.dataset.projectCopy),{duplicate:true}));
}

function bind(){
  document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>setView(t.dataset.view));
  if($("closeAccessCodePresentation"))$("closeAccessCodePresentation").onclick=closeAccessCodePresentation;
  if($("accessCodePresentation"))$("accessCodePresentation").onclick=e=>{if(e.target===$("accessCodePresentation"))closeAccessCodePresentation();};
  if($("closeFloatingExamTimer"))$("closeFloatingExamTimer").onclick=closeFloatingExamTimer;
  bindFloatingExamTimerDrag();
  window.addEventListener("keydown",e=>{if(e.key==="Escape"){closeAccessCodePresentation();closeFloatingExamTimer();}});
  window.addEventListener("resize",()=>{if(!$("floatingExamTimer")?.classList.contains("hidden"))sizeFloatingExamTimer(false);});
  $("projectSelect").onchange=e=>switchProject(e.target.value);
  $("prevMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();};
  $("nextMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();};
  $("goToday").onclick=()=>{currentMonth=new Date();renderCalendar();};
  $("showEvents").onchange=e=>{showAcademic=e.target.checked;renderCalendar();};
  $("showHiddenSlots").onchange=e=>{showHiddenSlots=e.target.checked;renderCalendar();};
  $("newRecordFab").onclick=()=>openRecord({});
  $("closeDialog").onclick=()=>$("recordDialog").close();$("cancelBtn").onclick=()=>$("recordDialog").close();
  $("recordForm").onsubmit=saveForm;$("deleteBtn").onclick=deleteEditing;
  $("preset").onchange=e=>{if(e.target.value)$("lessonTitle").value=e.target.value;};
  $("loadSameClassBtn").onclick=()=>copyRecordFields(latestClassRecord($("className").value,$("date").value));
  $("copyFromClass").onchange=e=>{if(e.target.value)copyRecordFields(latestOtherRecord(e.target.value,$("date").value));e.target.value="";};
  ["searchText","historyClass","historyType"].forEach(id=>$(id).oninput=renderHistory);
  $("exportBtn").onclick=exportBackup;
  $("importFile").onchange=async e=>{try{if(e.target.files[0])await importBackup(e.target.files[0]);}catch(err){alert(err.message);}e.target.value="";};
  $("loginBtn").onclick=async()=>{if($("loginBtn").textContent==="온라인 설정"){$("settingsDialog").showModal();return;}try{await signInGoogle();}catch(err){alert("Google 로그인 실패: "+err.message);}};
  $("logoutBtn").onclick=()=>signOutGoogle();$("closeSettings").onclick=()=>$("settingsDialog").close();
  $("closeProjectDialog").onclick=()=>$("projectDialog").close();$("cancelProjectBtn").onclick=()=>$("projectDialog").close();$("projectForm").onsubmit=saveProjectForm;
  $("closeMaterialDialog").onclick=()=>$("materialDialog").close();$("cancelMaterialBtn").onclick=()=>$("materialDialog").close();$("materialForm").onsubmit=saveMaterialForm;$("deleteMaterialBtn").onclick=deleteEditingMaterial;
  $("closeNoticeDialog").onclick=()=>$("noticeDialog").close();$("cancelNoticeBtn").onclick=()=>$("noticeDialog").close();$("noticeForm").onsubmit=saveNoticeForm;$("addNoticeDriveBtn").onclick=addNoticeDriveAttachment;$("deleteNoticeBtn").onclick=deleteEditingNotice;
  $("closeAssessmentDialog").onclick=()=>$("assessmentDialog").close();$("cancelAssessmentBtn").onclick=()=>$("assessmentDialog").close();$("assessmentForm").onsubmit=saveAssessmentForm;$("addQuestionBtn").onclick=()=>addQuestionEditor({});$("generateAccessCodeBtn").onclick=()=>$("assessmentAccessCode").value=generateAccessCode();$("deleteAssessmentBtn").onclick=async()=>{if(!editingAssessmentId)return;const target=assessments.find(x=>x.id===editingAssessmentId);if(target?.status==="OPEN"){alert("현재 응시 중인 평가는 평가 종료 후 삭제해 주세요.");return;}if(confirm("이 수행평가를 완전히 삭제할까요?\n응시 기록과 인증 세션도 함께 삭제되며 복구할 수 없습니다.")){try{const r=await deleteAssessment(editingAssessmentId);$("assessmentDialog").close();selectedAssessmentId=null;assessmentAttempts=[];if(r?.sameFingerprintRemaining>0)alert(`선택한 평가는 서버에서 삭제되었습니다. 다만 동일 조건의 별도 평가 ID가 ${r.sameFingerprintRemaining}개 남아 있습니다.`);else toast("수행평가를 서버에서 삭제 확인했습니다.");}catch(err){alert(err.message);}}};
  $("closeMonitorStudentDialog").onclick=()=>$("monitorStudentDialog").close();
  const addStudentMinutes=async minutes=>{if(!monitorControlStudentId)return;const n=Math.max(1,Math.min(120,Math.floor(Number(minutes||0))));if(!Number.isFinite(n))return;await extendAssessmentStudentTime(selectedAssessmentId,monitorControlStudentId,n);toast(`해당 학생에게 ${n}분을 추가했습니다.`);$("monitorStudentDialog").close();};
  $("monitorAdd1Btn").onclick=()=>addStudentMinutes(1);
  $("monitorAdd5Btn").onclick=()=>addStudentMinutes(5);
  $("monitorAdd10Btn").onclick=()=>addStudentMinutes(10);
  $("monitorAddCustomBtn").onclick=()=>addStudentMinutes($("monitorAddMinutesInput").value);
  $("monitorReopenBtn").onclick=async()=>{if(!monitorControlStudentId)return;if(confirm("이 학생의 제출 상태를 다시 응시중으로 열까요?")){await reopenAssessmentAttempt(selectedAssessmentId,monitorControlStudentId);toast("재응시를 허용했습니다.");$("monitorStudentDialog").close();}};

  $("closeRosterDialog").onclick=()=>$("rosterDialog").close();$("cancelRosterBtn").onclick=()=>$("rosterDialog").close();
  $("closeSeatEditorBtn").onclick=()=>$("rosterDialog").close();$("backToRosterListBtn").onclick=()=>setRosterTab("list");
  document.querySelectorAll("[data-roster-tab]").forEach(b=>b.onclick=()=>setRosterTab(b.dataset.rosterTab));
  $("rosterClass").onchange=loadRosterDialogText;$("rosterColumns").onchange=()=>{const newDepth=seatDepthCount($("rosterColumns").value),ids=verticalStudentOrder(seatEditorSlots);seatEditorSlots=buildVerticalDepthSlots(ids,newDepth);seatEditorDepthCount=newDepth;renderSeatEditor();toast(`세로 한 줄 좌석 수를 ${newDepth}석으로 바꿔 앞→뒤 기준으로 다시 배치했습니다.`);};if($("rosterFile"))$("rosterFile").onchange=importRosterFile;$("applyRosterBtn").onclick=applyRoster;
  $("seatResetBtn").onclick=()=>{if(confirm("현재 좌석을 학번 오름차순으로, 각 세로줄의 앞→뒤 순서로 다시 배치할까요? 아직 저장되지는 않습니다."))resetSeatEditorSlots();};
  $("seatAddBlankBtn").onclick=()=>{seatEditorSlots.push(null);renderSeatEditor();};
  $("seatAddRowBtn").onclick=()=>{const oldDepth=seatDepthCount($("rosterColumns").value);if(oldDepth>=8){alert("세로 한 줄 좌석 수는 최대 8석입니다.");return;}const cols=seatColumnCount(seatEditorSlots,oldDepth),expanded=[];for(let col=0;col<cols;col++){for(let row=0;row<oldDepth;row++){const index=col*oldDepth+row;expanded.push(index<seatEditorSlots.length?(seatEditorSlots[index]??null):null);}expanded.push(null);}seatEditorSlots=expanded;seatEditorDepthCount=oldDepth+1;$("rosterColumns").value=String(seatEditorDepthCount);renderSeatEditor();toast(`교실 뒤쪽에 빈 행을 추가해 세로 한 줄을 ${seatEditorDepthCount}석으로 늘렸습니다.`);};
  $("seatTrimBlanksBtn").onclick=()=>{while(seatEditorSlots.length&&seatEditorSlots[seatEditorSlots.length-1]===null)seatEditorSlots.pop();renderSeatEditor();};
  $("seatSideBtn").onclick=()=>{$("seatLeftSide").value=seatEditorLeftSide;$("seatRightSide").value=seatEditorRightSide;$("seatSidePanel").classList.toggle("hidden");};
  $("seatSwapSidesBtn").onclick=swapSeatSides;$("seatSideDoneBtn").onclick=applySeatSideSettings;
  $("saveSeatLayoutBtn").onclick=saveSeatEditor;
  $("closeStudentTestDialog").onclick=()=>$("studentTestDialog").close();$("cancelStudentTestBtn").onclick=()=>$("studentTestDialog").close();
  $("testAssessmentSelect").onchange=refreshStudentTestSelectors;$("testClassSelect").onchange=refreshStudentTestSelectors;$("startStudentTestBtn").onclick=startStudentPreview;
}

bind();
initDataLayer({
  onProjects:(rows,source)=>{
    projects=rows.map(normalizeProject);
    const desired=getActiveProjectId();
    activeProject=projects.find(p=>p.id===desired)||projects[0]||normalizeProject(SEED_PROJECTS[0]);
    renderHeader();rebuildDynamicOptions();renderProjects();
  },
  onRecords:(rows,source,projectId)=>{
    if(projectId&&activeProject&&projectId!==activeProject.id)return;
    records=rows.map(r=>({...r,_source:source}));recordSource=source;
    renderToday();renderCalendar();renderProgress();renderHistory();
  },
  onMaterials:(rows,source,projectId)=>{
    if(projectId&&activeProject&&projectId!==activeProject.id)return;
    materials=rows.map(r=>({...r,_source:source}));materialSource=source;
    renderMaterials();
  },
  onNotices:(rows,source,projectId)=>{
    if(projectId&&activeProject&&projectId!==activeProject.id)return;
    notices=rows.map(r=>({...r,_source:source}));
    renderNotices();
  },
  onStudents:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;students=rows;renderAssessments();if($("rosterDialog")?.open){seatEditorSlots=layoutSlotsForClass($("rosterClass").value);renderSeatEditor();}},
  onAssessments:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;assessments=rows;renderAssessments();startAttemptWatch();},
  onSeatLayouts:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;seatLayouts=rows;renderAssessmentMonitor();if($("rosterDialog")?.open){seatEditorSlots=layoutSlotsForClass($("rosterClass").value);renderSeatEditor();}},
  onAuth:state=>{
    updateAuthUi(state);
    if(state.user&&recordSource==="local"){
      const localCount=records.length;
      if(localCount>0&&confirm(`현재 프로젝트에 이 기기에 저장된 ${localCount}개 기록이 있습니다.\n클라우드 프로젝트로 복사할까요?`)){
        migrateLocalToCloud().then(n=>toast(`${n}개 기록을 클라우드로 복사했습니다.`)).catch(err=>alert(err.message));
      }
    }
    if(state.user&&materialSource==="local"){
      const localMaterialCount=materials.length;
      if(localMaterialCount>0&&confirm(`현재 프로젝트에 이 기기에 저장된 자료 ${localMaterialCount}개가 있습니다.\n클라우드 프로젝트로 복사할까요?`)){
        migrateLocalMaterialsToCloud().then(async n=>{await publishStudentPortalData(activeProject.id);toast(`${n}개 자료를 클라우드로 복사하고 포털에 반영했습니다.`);}).catch(err=>alert(err.message));
      }
    }
  }
});
setView("today");
setInterval(()=>{if(document.getElementById("view-assessments")?.classList.contains("active")){renderAssessmentMonitor();updateAdminAssessmentClock();}runExpiredFinalize();},3000);
setInterval(updateAdminAssessmentClock,1000);
