import { APP_VERSION, DEFAULT_PROJECT_ID, SEED_PROJECTS, cloneProject, normalizeProject } from "./project-data.js";
import {
  initDataLayer, storageMode, getCurrentUser, signInGoogle, signOutGoogle,
  upsertRecord, deleteRecordById, migrateLocalToCloud, replaceAllRecords,
  setActiveProject, getActiveProjectId, getProjects, saveProject, archiveProject,
  publishStudentPortalData, studentPortalUrl
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
let currentMonth=new Date();
let calendarFilter="ALL";
let showAcademic=true;
let showHiddenSlots=false;
let editingId=null;
let editingProjectId=null;

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
  renderToday();renderCalendar();renderProgress();renderHistory();renderProjects();
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
  const payload={system:"JCOOP Course Control",version:APP_VERSION,project:activeProject,exportedAt:new Date().toISOString(),records};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`JCOOP_${activeProject.shortName||activeProject.subjectName}_진도백업_${todayYmd()}.json`;a.click();URL.revokeObjectURL(a.href);
}
async function importBackup(file){
  const text=await file.text(),data=JSON.parse(text),arr=Array.isArray(data)?data:data.records;
  if(!Array.isArray(arr))throw new Error("백업 형식이 올바르지 않습니다.");
  if(!confirm(`현재 '${activeProject.adminLabel}' 기록을 지우고 ${arr.length}개 기록으로 교체할까요?`))return;
  await replaceAllRecords(arr);toast("백업을 복원했습니다.");
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
  if(!confirm(`현재 '${activeProject.adminLabel}'의 학생 공개 대상 진도를 포털에 반영할까요?\n\n교사용 메모는 공개되지 않습니다.`)) return;
  const btn=$("publishPortalBtn");
  if(btn){btn.disabled=true;btn.textContent="발행 중...";}
  try{
    const result=await publishStudentPortalData(activeProject.id);
    toast(`학생 포털 발행 완료 · ${result.publishedRecordCount}건`);
  }catch(err){
    alert("학생 포털 발행 실패: "+err.message+"\n\nFirebase 규칙이 v2.1용으로 적용되었는지 확인해 주세요.");
  }finally{
    if(btn){btn.disabled=false;btn.textContent="학생 포털 지금 발행";}
  }
}
function openStudentPortal(){
  window.open(studentPortalUrl(activeProject.id),"_blank","noopener");
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
  onAuth:state=>{
    updateAuthUi(state);
    if(state.user&&recordSource==="local"){
      const localCount=records.length;
      if(localCount>0&&confirm(`현재 프로젝트에 이 기기에 저장된 ${localCount}개 기록이 있습니다.\n클라우드 프로젝트로 복사할까요?`)){
        migrateLocalToCloud().then(n=>toast(`${n}개 기록을 클라우드로 복사했습니다.`)).catch(err=>alert(err.message));
      }
    }
  }
});
setView("today");
