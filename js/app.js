import {
  APP_VERSION, SEMESTER, CLASSES, WEEKLY_TIMETABLE, FIXED_SUBJECTS,
  TEXTBOOK_PRESETS, ACADEMIC_EVENTS
} from "./static-data.js";
import {
  initDataLayer, storageMode, getCurrentUser, signInGoogle, signOutGoogle,
  upsertRecord, deleteRecordById, migrateLocalToCloud, replaceAllRecords
} from "./db.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pad = n => String(n).padStart(2,"0");
const toYmd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseLocalDate = s => new Date(`${s}T12:00:00`);
const todayYmd = () => toYmd(new Date());
const inSemester = date => date >= SEMESTER.start && date <= SEMESTER.end;
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let records = [];
let recordSource = "local";
let currentMonth = new Date();
let calendarFilter = "ALL";
let showAcademic = true;
let editingId = null;

function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),1800);
}

function scheduledSlots(date){
  if(!inSemester(date)) return [];
  return WEEKLY_TIMETABLE[parseLocalDate(date).getDay()] || [];
}
function fixedSlots(date){
  if(!inSemester(date)) return [];
  return FIXED_SUBJECTS[parseLocalDate(date).getDay()] || [];
}
function eventsOn(date){ return ACADEMIC_EVENTS.filter(e=>e.date===date); }
function recordsOn(date){ return records.filter(r=>r.date===date).sort((a,b)=>Number(a.period)-Number(b.period)); }
function existingScheduledRecord(date, cls, period){
  return records.some(r=>r.date===date && r.className===cls && String(r.period)===String(period));
}
function sortedClassRecords(cls){
  return records.filter(r=>r.className===cls && r.status!=="cancelled")
    .sort((a,b)=>a.date.localeCompare(b.date)||Number(a.period)-Number(b.period));
}
function latestClassRecord(cls, beforeDate=null){
  let arr = sortedClassRecords(cls);
  if(beforeDate) arr = arr.filter(r=>r.date < beforeDate);
  return arr[arr.length-1] || null;
}
function latestOtherRecord(cls, beforeDate=null){
  let arr = records.filter(r=>r.className===cls && r.status!=="cancelled");
  if(beforeDate) arr=arr.filter(r=>r.date<=beforeDate);
  arr.sort((a,b)=>a.date.localeCompare(b.date)||Number(a.period)-Number(b.period));
  return arr[arr.length-1]||null;
}

function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id===`view-${name}`));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.view===name));
  if(name==="today") renderToday();
  if(name==="calendar") renderCalendar();
  if(name==="progress") renderProgress();
  if(name==="history") renderHistory();
}

function renderToday(){
  const date = todayYmd();
  const d = parseLocalDate(date);
  const slots = scheduledSlots(date).sort((a,b)=>a.period-b.period);
  const fixed = fixedSlots(date).sort((a,b)=>a.period-b.period);
  const evs = eventsOn(date);
  const all = [
    ...slots.map(x=>({...x, kind:"dok"})),
    ...fixed.map(x=>({...x, kind:"fixed"}))
  ].sort((a,b)=>a.period-b.period);

  let items = all.map(x=>{
    if(x.kind==="fixed"){
      return `<div class="today-item">
        <div class="period">${x.period}교시</div>
        <div><div class="lesson-line">심화국어</div><div class="subline">3학년 K · 고정 시간표</div></div>
        <div></div>
      </div>`;
    }
    const rec = records.find(r=>r.date===date&&r.className===x.className&&String(r.period)===String(x.period));
    if(rec){
      const cancelled = rec.status==="cancelled";
      return `<div class="today-item">
        <div class="period">${x.period}교시</div>
        <div><div class="lesson-line">${x.className}반 · ${cancelled?"미진행":esc(rec.title||rec.type)}</div>
          <div class="subline">${cancelled?esc(rec.memo||"사유 미입력"):esc(rec.detail||"기록 완료")}</div></div>
        <div class="today-action"><button class="btn small-btn" data-edit="${esc(rec.id)}">수정</button></div>
      </div>`;
    }
    return `<div class="today-item">
      <div class="period">${x.period}교시</div>
      <div><div class="lesson-line">${x.className}반 · 독서토론과 글쓰기</div><div class="subline">아직 실제 수업 기록 없음</div></div>
      <div class="today-action"><button class="btn primary small-btn" data-new="${date}|${x.className}|${x.period}">기록</button></div>
    </div>`;
  }).join("");

  const evHtml = evs.length ? evs.map(e=>`<div class="event-line">${esc(e.title)}</div>`).join("") : `<div class="small muted">학교 일정 없음</div>`;

  const totalToday = recordsOn(date).filter(r=>r.status!=="cancelled").length;
  const doneClasses = new Set(recordsOn(date).filter(r=>r.status!=="cancelled").map(r=>r.className)).size;
  const mini = CLASSES.map(c=>{
    const r=latestClassRecord(c);
    return `<div class="mini-row"><b>${c}반</b> ${r?esc(r.title||r.type):"기록 없음"}<div class="subline">${r?.nextStart?`다음: ${esc(r.nextStart)}`:""}</div></div>`;
  }).join("");

  $("view-today").innerHTML = `
    <div class="today-head"><div><h2>오늘 수업</h2><div class="today-date">${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일</div></div>
    <button class="btn" id="todayNew">＋ 수업 직접 기록</button></div>
    <div class="today-layout">
      <div class="card today-main">${items || `<div class="history-empty">오늘 예정된 수업이 없습니다.</div>`}</div>
      <div class="card today-side">
        <h3 style="margin-top:0">학교 일정</h3>${evHtml}
        <div class="quick-stat" style="margin-top:12px">
          <div class="stat"><b>${totalToday}</b><span>오늘 실제 수업 기록</span></div>
          <div class="stat"><b>${doneClasses}</b><span>오늘 기록된 반</span></div>
        </div>
        <div class="progress-mini"><h3>최근 진도</h3>${mini}</div>
      </div>
    </div>`;

  $("todayNew").onclick=()=>openRecord({date});
  document.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>{
    const [date,className,period]=b.dataset.new.split("|");
    openRecord({date,className,period});
  });
  document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editRecord(b.dataset.edit));
}

function renderCalendar(){
  const y=currentMonth.getFullYear(), m=currentMonth.getMonth();
  $("monthTitle").textContent=`${y}년 ${m+1}월`;
  const cal=$("calendar"); cal.innerHTML="";
  ["일","월","화","수","목","금","토"].forEach(x=>cal.insertAdjacentHTML("beforeend",`<div class="dow">${x}</div>`));
  const first=new Date(y,m,1).getDay(), last=new Date(y,m+1,0).getDate(), prevLast=new Date(y,m,0).getDate();

  for(let i=0;i<42;i++){
    let day,mm=m,yy=y,muted=false;
    if(i<first){day=prevLast-first+i+1;mm=m-1;muted=true;if(mm<0){mm=11;yy--;}}
    else if(i>=first+last){day=i-first-last+1;mm=m+1;muted=true;if(mm>11){mm=0;yy++;}}
    else day=i-first+1;
    const date=`${yy}-${pad(mm+1)}-${pad(day)}`;
    const cell=document.createElement("div"); cell.className=`day${muted?" muted":""}`;
    cell.innerHTML=`<div class="date">${day}</div>`;

    if(showAcademic) eventsOn(date).forEach(e=>cell.insertAdjacentHTML("beforeend",`<div class="academic">${esc(e.title)}</div>`));
    if(calendarFilter==="ALL") fixedSlots(date).forEach(x=>cell.insertAdjacentHTML("beforeend",`<div class="fixed">${x.period}교시 · 심화국어</div>`));

    scheduledSlots(date).filter(s=>calendarFilter==="ALL"||s.className===calendarFilter)
      .sort((a,b)=>a.period-b.period).forEach(s=>{
        if(existingScheduledRecord(date,s.className,s.period)) return;
        const el=document.createElement("div"); el.className=`slot ${s.className}`;
        el.textContent=`＋ ${s.className}반 ${s.period}교시`;
        el.onclick=()=>openRecord({date,className:s.className,period:s.period});
        cell.appendChild(el);
      });

    recordsOn(date).filter(r=>calendarFilter==="ALL"||r.className===calendarFilter).forEach(r=>{
      const el=document.createElement("div");
      el.className=`record ${r.className}${r.status==="cancelled"?" cancelled":""}`;
      el.innerHTML=`<strong>${r.className}반 ${r.period}교시 · ${r.status==="cancelled"?"미진행":esc(r.type)}</strong>
        ${r.status==="cancelled"?esc(r.memo||""):esc(r.title||"")}
        ${r.status!=="cancelled"&&r.nextStart?`<div class="next">다음: ${esc(r.nextStart)}</div>`:""}`;
      el.onclick=()=>editRecord(r.id);
      cell.appendChild(el);
    });
    cal.appendChild(cell);
  }
}

function renderProgress(){
  const cards=CLASSES.map(c=>{
    const arr=sortedClassRecords(c), last=arr[arr.length-1];
    const cancelled=records.filter(r=>r.className===c&&r.status==="cancelled").length;
    return `<div class="card progress-card">
      <h3>${c}반</h3>
      <div class="last">${last?esc(last.title||last.type):"기록 없음"}</div>
      <div class="nextline">${last?.nextStart?`다음: ${esc(last.nextStart)}`:"다음 시작점 미입력"}</div>
      <div class="count">진행 기록 <b>${arr.length}</b>회 · 미진행 <b>${cancelled}</b>회</div>
    </div>`;
  }).join("");

  const counts=Object.fromEntries(CLASSES.map(c=>[c,sortedClassRecords(c).length]));
  const max=Math.max(...Object.values(counts)), min=Math.min(...Object.values(counts));
  const lag=CLASSES.filter(c=>counts[c]===min);
  const msg=max-min>=2 ? `⚠ ${lag.join(", ")}반이 실제 진행 기록 기준 ${max-min}차시 정도 적습니다. 페이지·지문 기준 비교는 기록을 더 쌓은 뒤 보완할 수 있습니다.` : "현재 반별 실제 진행 기록 수의 차이가 크지 않습니다.";

  $("view-progress").innerHTML=`<div class="progress-grid">${cards}</div><div class="progress-alert">${msg}</div>`;
}

function renderHistory(){
  const q=$("searchText").value.trim().toLowerCase();
  const c=$("historyClass").value.replace("반","");
  const t=$("historyType").value;
  const rows=[...records].sort((a,b)=>b.date.localeCompare(a.date)||Number(b.period)-Number(a.period))
    .filter(r=>(c==="ALL"||r.className===c)&&(t==="ALL"||r.type===t))
    .filter(r=>!q || [r.title,r.detail,r.memo,r.worksheet,r.pages,r.nextStart].some(v=>String(v||"").toLowerCase().includes(q)));

  $("historyList").innerHTML=rows.length?rows.map(r=>`
    <div class="history-row">
      <div><b>${esc(r.date)}</b></div>
      <div>${r.className}반<br><span class="small muted">${r.period}교시</span></div>
      <div><div class="h-title">${r.status==="cancelled"?"미진행":esc(r.title||r.type)}</div>
      <div class="h-sub">${r.status==="cancelled"?esc(r.memo||""):esc([r.pages,r.session,r.detail].filter(Boolean).join(" · "))}</div></div>
      <div class="h-action"><button class="btn small-btn" data-history-edit="${esc(r.id)}">열기</button></div>
    </div>`).join(""):`<div class="history-empty">조건에 맞는 기록이 없습니다.</div>`;
  document.querySelectorAll("[data-history-edit]").forEach(b=>b.onclick=()=>editRecord(b.dataset.historyEdit));
}

function openRecord({date=todayYmd(),className="A",period=1}={}){
  editingId=null;
  $("dialogTitle").textContent="수업 기록 추가";
  $("dialogSub").textContent="";
  $("deleteBtn").classList.add("hidden");
  $("recordForm").reset();
  $("date").value=date;$("className").value=className;$("period").value=String(period);$("status").value="done";
  $("recordDialog").showModal();
}
function editRecord(id){
  const r=records.find(x=>String(x.id)===String(id)); if(!r)return;
  editingId=r.id;
  $("dialogTitle").textContent="수업 기록 수정";
  $("dialogSub").textContent=`${r.date} · ${r.className}반 ${r.period}교시`;
  $("deleteBtn").classList.remove("hidden");
  ["date","className","period","status","type","session","pages","worksheet","detail","nextStart","memo"].forEach(k=>$(k).value=r[k]??"");
  $("lessonTitle").value=r.title??"";
  $("preset").value="";
  $("recordDialog").showModal();
}
function copyRecordFields(src){
  if(!src){toast("불러올 이전 기록이 없습니다.");return;}
  $("type").value=src.type||"교과서";$("session").value=src.session||"";$("lessonTitle").value=src.title||"";
  $("pages").value=src.pages||"";$("worksheet").value=src.worksheet||"";$("detail").value=src.detail||"";
  $("nextStart").value=src.nextStart||"";$("memo").value="";
  toast("이전 수업 내용을 불러왔습니다.");
}

async function saveForm(e){
  e.preventDefault();
  const rec={
    id:editingId||makeId(),
    date:$("date").value,className:$("className").value,period:Number($("period").value),
    status:$("status").value,type:$("type").value,session:$("session").value.trim(),
    title:$("lessonTitle").value.trim(),pages:$("pages").value.trim(),worksheet:$("worksheet").value.trim(),
    detail:$("detail").value.trim(),nextStart:$("nextStart").value.trim(),memo:$("memo").value.trim(),
    updatedAt:new Date().toISOString()
  };
  try{ await upsertRecord(rec); $("recordDialog").close(); toast("저장했습니다."); }
  catch(err){ alert("저장 실패: "+err.message); }
}
async function deleteEditing(){
  if(!editingId)return;
  if(!confirm("이 수업 기록을 삭제할까요?"))return;
  try{ await deleteRecordById(editingId); $("recordDialog").close(); toast("삭제했습니다."); }
  catch(err){alert("삭제 실패: "+err.message);}
}

function updateAuthUi(state){
  const pill=$("syncPill");
  if(state.error){pill.textContent="동기화 오류";pill.className="sync-pill error";}
  else if(state.user){pill.textContent="클라우드 동기화";pill.className="sync-pill cloud";}
  else{pill.textContent=state.configured?"로그인 전 · 이 기기 저장":"이 기기 저장";pill.className="sync-pill local";}
  $("loginBtn").classList.toggle("hidden",Boolean(state.user));
  $("logoutBtn").classList.toggle("hidden",!state.user);
  $("loginBtn").textContent=state.configured?"Google 로그인":"온라인 설정";
}

function exportBackup(){
  const payload={version:APP_VERSION,exportedAt:new Date().toISOString(),records};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`독토글_진도백업_${todayYmd()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
async function importBackup(file){
  const text=await file.text(), data=JSON.parse(text), arr=Array.isArray(data)?data:data.records;
  if(!Array.isArray(arr))throw new Error("백업 형식이 올바르지 않습니다.");
  if(!confirm(`현재 저장소의 기록을 지우고 ${arr.length}개 기록으로 교체할까요?`))return;
  await replaceAllRecords(arr); toast("백업을 복원했습니다.");
}

function bind(){
  $("versionBadge").textContent=`v${APP_VERSION}`;
  document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>setView(t.dataset.view));
  $("prevMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar();};
  $("nextMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar();};
  $("goToday").onclick=()=>{currentMonth=new Date();renderCalendar();};
  document.querySelectorAll("#classFilters .chip").forEach(b=>b.onclick=()=>{document.querySelectorAll("#classFilters .chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");calendarFilter=b.dataset.class;renderCalendar();});
  $("showEvents").onchange=e=>{showAcademic=e.target.checked;renderCalendar();};
  $("newRecordFab").onclick=()=>openRecord({});
  $("closeDialog").onclick=()=>$("recordDialog").close();$("cancelBtn").onclick=()=>$("recordDialog").close();
  $("recordForm").onsubmit=saveForm;$("deleteBtn").onclick=deleteEditing;
  $("preset").innerHTML=`<option value="">직접 입력</option>`+TEXTBOOK_PRESETS.map(x=>`<option>${esc(x)}</option>`).join("");
  $("preset").onchange=e=>{if(e.target.value)$("lessonTitle").value=e.target.value;};
  $("loadSameClassBtn").onclick=()=>copyRecordFields(latestClassRecord($("className").value,$("date").value));
  $("copyFromClass").onchange=e=>{if(e.target.value)copyRecordFields(latestOtherRecord(e.target.value,$("date").value));e.target.value="";};
  ["searchText","historyClass","historyType"].forEach(id=>$(id).oninput=renderHistory);
  $("exportBtn").onclick=exportBackup;
  $("importFile").onchange=async e=>{try{if(e.target.files[0])await importBackup(e.target.files[0]);}catch(err){alert(err.message);}e.target.value="";};
  $("loginBtn").onclick=async()=>{
    if($("loginBtn").textContent==="온라인 설정"){$("settingsDialog").showModal();return;}
    try{await signInGoogle();}catch(err){alert("Google 로그인 실패: "+err.message);}
  };
  $("logoutBtn").onclick=()=>signOutGoogle();
  $("closeSettings").onclick=()=>$("settingsDialog").close();
}

bind();
initDataLayer({
  onRecords:(rows,source)=>{
    records=rows.map(r=>({...r,_source:source}));recordSource=source;
    renderToday();renderCalendar();renderProgress();renderHistory();
  },
  onAuth:state=>{
    updateAuthUi(state);
    if(state.user && recordSource==="local"){
      const localCount=records.length;
      if(localCount>0 && confirm(`이 기기에 저장된 ${localCount}개 기록을 클라우드로 옮길까요?`)){
        migrateLocalToCloud().then(n=>toast(`${n}개 기록을 클라우드로 옮겼습니다.`)).catch(err=>alert(err.message));
      }
    }
  }
});
setView("today");
