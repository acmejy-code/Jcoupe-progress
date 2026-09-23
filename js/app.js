import { APP_VERSION, DEFAULT_PROJECT_ID, SEED_PROJECTS, cloneProject, normalizeProject } from "./project-data.js";
import {
  initDataLayer, storageMode, getCurrentUser, signInGoogle, signOutGoogle,
  upsertRecord, deleteRecordById, migrateLocalToCloud, replaceAllRecords,
  upsertMaterial, deleteMaterialById, migrateLocalMaterialsToCloud, replaceAllMaterials,
  setActiveProject, getActiveProjectId, getProjects, saveProject, archiveProject,
  publishStudentPortalData, studentPortalUrl,
  replaceStudentsForClass, saveSeatLayout, upsertAssessment, setAssessmentStatus, deleteAssessment,
  watchAssessmentAttempts, resetAssessmentRun
} from "./db.js";

const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pad=n=>String(n).padStart(2,"0");
const toYmd=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseLocalDate=s=>new Date(`${s}T12:00:00`);
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
let draggedStudentId=null;

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

function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${name}`));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===name));
  if(name==="today")renderToday();
  if(name==="calendar")renderCalendar();
  if(name==="progress")renderProgress();
  if(name==="history")renderHistory();
  if(name==="materials")renderMaterials();
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
  renderToday();renderCalendar();renderProgress();renderHistory();renderMaterials();renderProjects();
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
      const main=document.createElement("div");main.className="slot-main";main.textContent=`＋ ${s.className}반 ${s.period}교시`;main.title="눌러서 실제 수업 기록";main.onclick=()=>openRecord({date,className:s.className,period:s.period});
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
  const payload={system:"JCOOP Course Control",version:APP_VERSION,project:activeProject,exportedAt:new Date().toISOString(),records,materials};
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
  if(!confirm(`현재 '${activeProject.adminLabel}'의 학생 공개 진도와 수업 자료를 포털에 반영할까요?\n\n교사용 메모는 공개되지 않으며, 자료는 공개 설정된 항목만 반영됩니다.`)) return;
  const btn=$("publishPortalBtn");
  if(btn){btn.disabled=true;btn.textContent="발행 중...";}
  try{
    const result=await publishStudentPortalData(activeProject.id);
    toast(`학생 포털 발행 완료 · 진도 ${result.publishedRecordCount}건 · 자료 ${result.publishedMaterialCount}개`);
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
function orderedStudents(cls){
  const rows=classStudents(cls), layout=getSeatLayout(cls), map=new Map(rows.map(s=>[String(s.studentId),s]));
  const ordered=[];
  (layout?.orderedStudentIds||[]).forEach(id=>{if(map.has(String(id))){ordered.push(map.get(String(id)));map.delete(String(id));}});
  return ordered.concat([...map.values()].sort((a,b)=>String(a.studentId).localeCompare(String(b.studentId),"ko",{numeric:true})));
}
function statusInfo(studentId){
  const a=assessmentAttempts.find(x=>String(x.studentId||x.id)===String(studentId));
  if(!a)return {key:"NONE",label:"미접속",sub:"-"};
  if(a.status==="SUBMITTED")return {key:"SUBMITTED",label:"제출완료",sub:fmtDateTime(a.submittedAt)};
  let ms=0; try{const d=a.lastSeenAt?.toDate?a.lastSeenAt.toDate():new Date(a.lastSeenAt);ms=Date.now()-d.getTime();}catch{}
  if(ms>65000)return {key:"STALE",label:"연결이상",sub:`마지막 신호 ${Math.floor(ms/1000)}초 전`};
  return {key:"IN_PROGRESS",label:"응시중",sub:a.lastSavedAt?`저장 ${fmtDateTime(a.lastSavedAt)}`:"접속 확인"};
}
function assessmentStatusLabel(v){return v==="OPEN"?"응시 중":v==="CLOSED"?"종료":"준비";}
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
  const questions=[...document.querySelectorAll(".question-edit-row")].map((row,i)=>({id:`q${i+1}`,prompt:row.querySelector(".question-prompt").value.trim(),placeholder:row.querySelector(".question-placeholder").value.trim(),required:true})).filter(q=>q.prompt);
  const targetClasses=[...$("assessmentClassChecks").querySelectorAll("input:checked")].map(x=>x.value);
  const old=editingAssessmentId?assessments.find(x=>x.id===editingAssessmentId):null;
  try{
    const saved=await upsertAssessment({...(old||{}),id:editingAssessmentId||makeId(),title:$("assessmentTitle").value,description:$("assessmentDescription").value,instructions:$("assessmentInstructions").value,accessCode:$("assessmentAccessCode").value,targetClasses,durationMinutes:Number($("assessmentDuration").value||0),questions,status:old?.status||"DRAFT"});
    selectedAssessmentId=saved.id;$("assessmentDialog").close();toast("수행평가를 저장했습니다.");
  }catch(err){alert("수행평가 저장 실패: "+err.message);}
}
function openRosterDialog(){
  if(storageMode()!=="cloud"){alert("학생 명단은 Google 로그인 후 관리할 수 있습니다.");return;}
  $("rosterClass").innerHTML=projectClasses().map(c=>`<option value="${esc(c)}">${esc(c)}반</option>`).join("");
  $("rosterClass").value=selectedMonitorClass||projectClasses()[0]||"";loadRosterDialogText();$("rosterDialog").showModal();
}
function loadRosterDialogText(){const cls=$("rosterClass").value, layout=getSeatLayout(cls);$("rosterColumns").value=String(layout?.columns||5);$("rosterText").value=classStudents(cls).map(s=>`${s.studentId}\t${s.name}`).join("\n");}
function parseRosterText(text){
  return String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const parts=line.split(/[\t, ]+/).filter(Boolean);return {studentId:String(parts.shift()||"").trim(),name:parts.join(" ").trim()};}).filter(x=>x.studentId&&x.name).sort((a,b)=>a.studentId.localeCompare(b.studentId,"ko",{numeric:true}));
}
async function applyRoster(){
  const cls=$("rosterClass").value, rows=parseRosterText($("rosterText").value);if(!rows.length){alert("학생 명단을 입력해 주세요.");return;}
  if(!confirm(`${cls}반 명단을 ${rows.length}명으로 교체할까요?\n좌석은 학번 오름차순으로 다시 배치됩니다.`))return;
  try{await replaceStudentsForClass(cls,rows);await saveSeatLayout(cls,Number($("rosterColumns").value||5),rows.map(x=>x.studentId));selectedMonitorClass=cls;$("rosterDialog").close();toast(`${cls}반 ${rows.length}명 명단을 적용했습니다.`);}catch(err){alert(err.message);}
}
function startAttemptWatch(){
  if(storageMode()!=="cloud"||!selectedAssessmentId){assessmentAttempts=[];return;}
  try{watchAssessmentAttempts(selectedAssessmentId,(rows,err)=>{if(err)return;assessmentAttempts=rows;renderAssessmentMonitor();});}catch(err){console.error(err);}
}
function renderAssessmentMonitor(){
  const root=$("assessmentMonitor");if(!root)return;const a=assessments.find(x=>x.id===selectedAssessmentId);if(!a){root.innerHTML="";return;}
  const cls=selectedMonitorClass||a.targetClasses?.[0]||projectClasses()[0]||"";selectedMonitorClass=cls;
  const rows=orderedStudents(cls),layout=getSeatLayout(cls),cols=Number(layout?.columns||5);
  const statuses=rows.map(s=>statusInfo(s.studentId));
  const count=k=>statuses.filter(x=>x.key===k).length;
  root.innerHTML=`<div class="monitor-head"><div><h3>${esc(cls)}반 실시간 좌석 감독</h3><div class="small muted">Firestore 상태 변경은 즉시 반영 · 화면 상태는 10초마다 재계산 · 학생 접속 신호는 30초 간격</div></div><div class="monitor-summary"><span>미접속 ${count("NONE")}</span><span>응시중 ${count("IN_PROGRESS")}</span><span>제출 ${count("SUBMITTED")}</span><span>연결이상 ${count("STALE")}</span></div></div><div class="front-label">칠판 · 교탁 (교실 앞)</div><div class="seat-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${rows.map(s=>{const st=statusInfo(s.studentId);return `<div class="seat-card status-${st.key.toLowerCase()}" draggable="true" data-seat-student="${esc(s.studentId)}"><div class="seat-id">${esc(s.studentId)}</div><strong>${esc(s.name)}</strong><span>${st.label}</span><small>${esc(st.sub)}</small></div>`;}).join("")}</div><div class="seat-tools"><span class="small muted">실제 책상 배열과 다르면 카드를 드래그해서 이동한 뒤 저장하세요.</span><button class="btn small-btn" id="saveSeatOrderBtn">좌석 순서 저장</button></div>`;
  root.querySelectorAll("[data-seat-student]").forEach(card=>{card.ondragstart=()=>{draggedStudentId=card.dataset.seatStudent};card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const target=card.dataset.seatStudent;if(!draggedStudentId||draggedStudentId===target)return;const grid=card.parentElement,cards=[...grid.children],from=cards.find(x=>x.dataset.seatStudent===draggedStudentId);if(from)grid.insertBefore(from,card);};});
  $("saveSeatOrderBtn").onclick=async()=>{const ids=[...root.querySelectorAll("[data-seat-student]")].map(x=>x.dataset.seatStudent);try{await saveSeatLayout(cls,cols,ids);toast("좌석 배치를 저장했습니다.");}catch(err){alert(err.message);}};
}
function downloadAssessmentCsv(){
  const a=assessments.find(x=>x.id===selectedAssessmentId);if(!a)return;const rosterMap=new Map(students.map(s=>[String(s.studentId),s]));
  const qs=a.questions||[], headers=["학번","이름","반","상태","시작시각","제출시각",...qs.map((_,i)=>`문항${i+1}`)];
  const quote=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const rows=assessmentAttempts.map(at=>{const st=rosterMap.get(String(at.studentId))||{};return [at.studentId,st.name||at.studentName||"",st.className||"",at.status||"",fmtDateTime(at.startedAt),fmtDateTime(at.submittedAt),...qs.map(q=>at.answers?.[q.id]||"")];});
  const csv="\ufeff"+[headers,...rows].map(r=>r.map(quote).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${a.title||"수행평가"}_응답.csv`;link.click();URL.revokeObjectURL(url);
}
function renderAssessments(){
  const root=$("view-assessments");if(!activeProject)return;
  if(storageMode()!=="cloud"){root.innerHTML=`<div class="card assessment-empty"><h2>수행평가 응시 관리</h2><p>학생 인증·실시간 감독·답안 수집은 Firestore를 사용하므로 Google 로그인 후 사용할 수 있습니다.</p></div>`;return;}
  if(!selectedAssessmentId||!assessments.some(a=>a.id===selectedAssessmentId))selectedAssessmentId=assessments[0]?.id||null;
  const selected=assessments.find(a=>a.id===selectedAssessmentId)||null;if(!selectedMonitorClass)selectedMonitorClass=selected?.targetClasses?.[0]||projectClasses()[0]||"";
  root.innerHTML=`<div class="assessment-toolbar"><div><h2>수행평가 응시 관리</h2><div class="small muted">학생은 포털에서 학번·이름·응시코드로 입장합니다. 답안은 실시간으로 수집됩니다.</div></div><div class="assessment-actions"><button class="btn" id="manageRosterBtn">학생 명단·좌석</button><button class="btn primary" id="newAssessmentBtn">＋ 수행평가 만들기</button></div></div><div class="assessment-layout"><div class="assessment-list-panel card"><h3>평가 목록</h3><div class="assessment-list">${assessments.length?assessments.map(a=>`<button class="assessment-row ${a.id===selectedAssessmentId?"active":""}" data-assessment-id="${esc(a.id)}"><span><b>${esc(a.title)}</b><small>${esc((a.targetClasses||[]).join("·"))}반 · ${a.questions?.length||0}문항</small></span><em class="assessment-status ${String(a.status).toLowerCase()}">${assessmentStatusLabel(a.status)}</em></button>`).join(""):`<div class="empty">아직 만든 수행평가가 없습니다.</div>`}</div></div><div class="assessment-main">${selected?`<div class="card assessment-control"><div class="assessment-control-head"><div><div class="label">${assessmentStatusLabel(selected.status)}</div><h3>${esc(selected.title)}</h3><p>${esc(selected.description||"학생 안내 없음")}</p></div><div class="code-box"><span>응시코드</span><strong>${esc(selected.accessCode)}</strong></div></div><div class="assessment-control-actions"><button class="btn" id="editAssessmentBtn">수정</button>${selected.status!=="OPEN"?`<button class="btn success-btn" id="openAssessmentBtn">평가 시작</button>`:`<button class="btn danger" id="closeAssessmentBtn2">평가 종료</button>`}<button class="btn" id="exportAssessmentBtn">응답 CSV</button><button class="btn" id="resetAssessmentBtn">테스트 기록 초기화</button><label class="monitor-class-label">감독 반 <select id="monitorClassSelect">${(selected.targetClasses||[]).map(c=>`<option value="${esc(c)}" ${c===selectedMonitorClass?"selected":""}>${esc(c)}반</option>`).join("")}</select></label></div></div><div id="assessmentMonitor" class="card assessment-monitor"></div>`:`<div class="card assessment-empty"><b>수행평가를 만들어 주세요.</b></div>`}</div></div>`;
  $("manageRosterBtn").onclick=openRosterDialog;$("newAssessmentBtn").onclick=()=>openAssessmentDialog();
  document.querySelectorAll("[data-assessment-id]").forEach(b=>b.onclick=()=>{selectedAssessmentId=b.dataset.assessmentId;assessmentAttempts=[];const aa=assessments.find(x=>x.id===selectedAssessmentId);selectedMonitorClass=aa?.targetClasses?.[0]||"";renderAssessments();startAttemptWatch();});
  if(selected){$("editAssessmentBtn").onclick=()=>openAssessmentDialog(selected);const openBtn=$("openAssessmentBtn");if(openBtn)openBtn.onclick=async()=>{if(confirm("이 수행평가를 학생 포털에서 응시 가능 상태로 열까요?")){await setAssessmentStatus(selected.id,"OPEN");toast("수행평가를 시작했습니다.");}};const closeBtn=$("closeAssessmentBtn2");if(closeBtn)closeBtn.onclick=async()=>{if(confirm("새로운 학생의 입장을 막고 평가를 종료할까요?\n이미 입장한 학생은 저장·제출을 계속할 수 있습니다.")){await setAssessmentStatus(selected.id,"CLOSED");toast("수행평가를 종료했습니다.");}};$("exportAssessmentBtn").onclick=downloadAssessmentCsv;$("resetAssessmentBtn").onclick=async()=>{if(confirm("이 평가의 학생 응시 기록과 인증 세션을 모두 삭제할까요?\n시험 전 시뮬레이션 기록 초기화 용도입니다.")){const n=await resetAssessmentRun(selected.id);assessmentAttempts=[];toast(`${n}개 응시 기록을 초기화했습니다.`);}};$("monitorClassSelect").onchange=e=>{selectedMonitorClass=e.target.value;renderAssessmentMonitor();};renderAssessmentMonitor();}
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
  $("closeAssessmentDialog").onclick=()=>$("assessmentDialog").close();$("cancelAssessmentBtn").onclick=()=>$("assessmentDialog").close();$("assessmentForm").onsubmit=saveAssessmentForm;$("addQuestionBtn").onclick=()=>addQuestionEditor({});$("generateAccessCodeBtn").onclick=()=>$("assessmentAccessCode").value=generateAccessCode();$("deleteAssessmentBtn").onclick=async()=>{if(!editingAssessmentId)return;if(confirm("이 수행평가를 삭제할까요?")){try{await deleteAssessment(editingAssessmentId);$("assessmentDialog").close();toast("수행평가를 삭제했습니다.");}catch(err){alert(err.message);}}};
  $("closeRosterDialog").onclick=()=>$("rosterDialog").close();$("cancelRosterBtn").onclick=()=>$("rosterDialog").close();$("rosterClass").onchange=loadRosterDialogText;$("applyRosterBtn").onclick=applyRoster;
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
  onStudents:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;students=rows;renderAssessments();},
  onAssessments:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;assessments=rows;renderAssessments();startAttemptWatch();},
  onSeatLayouts:(rows,source,projectId)=>{if(projectId&&activeProject&&projectId!==activeProject.id)return;seatLayouts=rows;renderAssessmentMonitor();},
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
setInterval(()=>{if(document.getElementById("view-assessments")?.classList.contains("active"))renderAssessmentMonitor();},10000);
