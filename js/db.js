import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=3.2.1";
import { DEFAULT_PROJECT_ID, SEED_PROJECTS, cloneProject, normalizeProject } from "./project-data.js?v=3.2.1";

const PROJECTS_LOCAL_KEY = "jcoop_course_projects_v2";
const ACTIVE_PROJECT_KEY = "jcoop_active_project_v2";
const LEGACY_LOCAL_KEY = "doktogul_progress_v1_records";

let firebase = null;
let auth = null;
let db = null;
let currentUser = null;
let unsubscribeRecords = null;
let unsubscribeMaterials = null;
let unsubscribeNotices = null;
let unsubscribeStudents = null;
let unsubscribeAssessments = null;
let unsubscribeSeatLayouts = null;
let unsubscribeAttempts = null;
let onRecordsCb = null;
let onMaterialsCb = null;
let onNoticesCb = null;
let onStudentsCb = null;
let onAssessmentsCb = null;
let onSeatLayoutsCb = null;
let onProjectsCb = null;
let onAuthCb = null;
let activeProjectId = localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
let currentProjects = [];

const recordsLocalKey = projectId => `jcoop_course_records_v2_${projectId}`;
const materialsLocalKey = projectId => `jcoop_course_materials_v1_${projectId}`;

export function storageMode(){
  if(!isFirebaseConfigured()) return "local";
  return currentUser ? "cloud" : "local";
}
export function getCurrentUser(){ return currentUser; }
export function getActiveProjectId(){ return activeProjectId; }

function readJson(key, fallback){
  try{
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    return parsed ?? fallback;
  }catch{
    return fallback;
  }
}
function writeJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

function ensureLocalSeedProjects(){
  let projects = readJson(PROJECTS_LOCAL_KEY, []);
  if(!Array.isArray(projects) || projects.length===0){
    projects = SEED_PROJECTS.map(cloneProject);
    writeJson(PROJECTS_LOCAL_KEY, projects);
  } else {
    SEED_PROJECTS.forEach(seed=>{
      if(!projects.some(p=>String(p.id)===String(seed.id))) projects.push(cloneProject(seed));
    });
    writeJson(PROJECTS_LOCAL_KEY, projects);
  }
  currentProjects = projects.map(normalizeProject);
  if(!currentProjects.some(p=>p.id===activeProjectId)){
    activeProjectId = currentProjects[0]?.id || DEFAULT_PROJECT_ID;
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
  }
  return currentProjects;
}

function migrateLegacyLocalIfNeeded(){
  const targetKey = recordsLocalKey(DEFAULT_PROJECT_ID);
  const target = readJson(targetKey, []);
  const legacy = readJson(LEGACY_LOCAL_KEY, []);
  if(Array.isArray(target) && target.length===0 && Array.isArray(legacy) && legacy.length){
    const migrated = legacy.map(r=>({...r, projectId:DEFAULT_PROJECT_ID}));
    writeJson(targetKey, migrated);
    return migrated.length;
  }
  return 0;
}

export function getLocalRecords(projectId=activeProjectId){
  return readJson(recordsLocalKey(projectId), []);
}
export function getLocalMaterials(projectId=activeProjectId){
  return readJson(materialsLocalKey(projectId), []);
}
function saveLocalRecords(projectId, rows){ writeJson(recordsLocalKey(projectId), rows); }
function saveLocalMaterials(projectId, rows){ writeJson(materialsLocalKey(projectId), rows); }

function emitLocalProjects(){
  currentProjects = ensureLocalSeedProjects();
  onProjectsCb?.(currentProjects, "local");
}
function emitLocalRecords(){
  onRecordsCb?.(getLocalRecords(activeProjectId), "local", activeProjectId);
}
function emitLocalMaterials(){
  onMaterialsCb?.(getLocalMaterials(activeProjectId), "local", activeProjectId);
}

async function ensureCloudSeedProjects(){
  for(const seed of SEED_PROJECTS){
    const ref = firebase.fsMod.doc(db, "users", currentUser.uid, "courseProjects", seed.id);
    const snap = await firebase.fsMod.getDoc(ref);
    if(!snap.exists()) await firebase.fsMod.setDoc(ref, normalizeProject(seed), {merge:true});
  }
}

async function loadCloudProjects(){
  const snap = await firebase.fsMod.getDocs(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects")
  );
  currentProjects = snap.docs
    .map(d=>normalizeProject({id:d.id, ...d.data()}))
    .filter(p=>p.status!=="DELETED")
    .sort((a,b)=>Number(b.academicYear)-Number(a.academicYear) || String(b.semester).localeCompare(String(a.semester)) || Number(a.grade)-Number(b.grade) || a.subjectName.localeCompare(b.subjectName,"ko"));
  if(!currentProjects.some(p=>p.id===activeProjectId)){
    activeProjectId = currentProjects[0]?.id || DEFAULT_PROJECT_ID;
    localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
  }
  onProjectsCb?.(currentProjects, "cloud");
}

async function migrateLegacyCloudIfNeeded(){
  const target = await firebase.fsMod.getDocs(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", DEFAULT_PROJECT_ID, "lessonRecords")
  );
  if(!target.empty) return 0;
  const legacy = await firebase.fsMod.getDocs(
    firebase.fsMod.collection(db, "users", currentUser.uid, "lessonRecords")
  );
  if(legacy.empty) return 0;
  let migrated = 0;
  for(const d of legacy.docs){
    const data = {...d.data(), id:d.id, projectId:DEFAULT_PROJECT_ID};
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db, "users", currentUser.uid, "courseProjects", DEFAULT_PROJECT_ID, "lessonRecords", d.id),
      data,
      {merge:true}
    );
    migrated++;
  }
  return migrated;
}

function stopRecordListener(){
  if(unsubscribeRecords){ unsubscribeRecords(); unsubscribeRecords = null; }
}
function stopMaterialListener(){
  if(unsubscribeMaterials){ unsubscribeMaterials(); unsubscribeMaterials = null; }
}
function stopNoticeListener(){
  if(unsubscribeNotices){ unsubscribeNotices(); unsubscribeNotices = null; }
}
function stopStudentListener(){
  if(unsubscribeStudents){ unsubscribeStudents(); unsubscribeStudents = null; }
}
function stopAssessmentListener(){
  if(unsubscribeAssessments){ unsubscribeAssessments(); unsubscribeAssessments = null; }
}
function stopSeatLayoutListener(){
  if(unsubscribeSeatLayouts){ unsubscribeSeatLayouts(); unsubscribeSeatLayouts = null; }
}
function stopAttemptListener(){
  if(unsubscribeAttempts){ unsubscribeAttempts(); unsubscribeAttempts = null; }
}
function stopProjectListeners(){
  stopRecordListener(); stopMaterialListener(); stopNoticeListener(); stopStudentListener(); stopAssessmentListener(); stopSeatLayoutListener(); stopAttemptListener();
}

function startCloudRecordListener(){
  stopRecordListener();
  const q = firebase.fsMod.query(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", activeProjectId, "lessonRecords"),
    firebase.fsMod.orderBy("date", "asc")
  );
  unsubscribeRecords = firebase.fsMod.onSnapshot(
    q,
    snap=>{
      const rows=snap.docs.map(d=>({id:d.id, ...d.data(), projectId:activeProjectId}));
      onRecordsCb?.(rows, "cloud", activeProjectId);
    },
    err=>{
      console.error("Firestore record snapshot error:", err);
      onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
    }
  );
}

function startCloudMaterialListener(){
  stopMaterialListener();
  const q = firebase.fsMod.query(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", activeProjectId, "materials"),
    firebase.fsMod.orderBy("updatedAt", "desc")
  );
  unsubscribeMaterials = firebase.fsMod.onSnapshot(
    q,
    snap=>{
      const rows=snap.docs.map(d=>({id:d.id, ...d.data(), projectId:activeProjectId}));
      onMaterialsCb?.(rows, "cloud", activeProjectId);
    },
    err=>{
      console.error("Firestore material snapshot error:", err);
      onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
    }
  );
}

function startCloudNoticeListener(){
  stopNoticeListener();
  const q = firebase.fsMod.query(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", activeProjectId, "notices"),
    firebase.fsMod.orderBy("updatedAt", "desc")
  );
  unsubscribeNotices = firebase.fsMod.onSnapshot(
    q,
    snap=>{
      const rows=snap.docs.map(d=>({id:d.id, ...d.data(), projectId:activeProjectId}));
      onNoticesCb?.(rows, "cloud", activeProjectId);
    },
    err=>{
      console.error("Firestore notice snapshot error:", err);
      onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
    }
  );
}

function startCloudStudentListener(){
  stopStudentListener();
  const q = firebase.fsMod.query(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", activeProjectId, "students"),
    firebase.fsMod.orderBy("studentId", "asc")
  );
  unsubscribeStudents = firebase.fsMod.onSnapshot(q, snap=>{
    const rows=snap.docs.map(d=>({id:d.id,...d.data(),projectId:activeProjectId}));
    onStudentsCb?.(rows,"cloud",activeProjectId);
  }, err=>{
    console.error("Firestore student snapshot error:",err);
    onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
  });
}

function startCloudAssessmentListener(){
  stopAssessmentListener();
  const q = firebase.fsMod.query(
    firebase.fsMod.collection(db, "users", currentUser.uid, "courseProjects", activeProjectId, "assessments"),
    firebase.fsMod.orderBy("updatedAt", "desc")
  );
  unsubscribeAssessments = firebase.fsMod.onSnapshot(q,{includeMetadataChanges:true}, snap=>{
    // v3.2.1: 수행평가 목록은 오직 Firestore 서버 스냅샷만 화면에 반영한다.
    // 캐시/지연보상 스냅샷이 OPEN/삭제 전 상태를 다시 그려 '원상복귀'처럼 보이는 현상을 차단한다.
    if(snap.metadata?.hasPendingWrites || snap.metadata?.fromCache) return;
    const rows=snap.docs.map(d=>({id:d.id,...d.data(),projectId:activeProjectId}));
    onAssessmentsCb?.(rows,"cloud-server",activeProjectId);
  }, err=>{
    console.error("Firestore assessment snapshot error:",err);
    onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
  });
}

function startCloudSeatLayoutListener(){
  stopSeatLayoutListener();
  unsubscribeSeatLayouts = firebase.fsMod.onSnapshot(
    firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",activeProjectId,"seatLayouts"),
    snap=>{
      const rows=snap.docs.map(d=>({id:d.id,...d.data(),projectId:activeProjectId}));
      onSeatLayoutsCb?.(rows,"cloud",activeProjectId);
    },
    err=>{
      console.error("Firestore seat layout snapshot error:",err);
      onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
    }
  );
}

function startCloudProjectListeners(){
  startCloudRecordListener();
  startCloudMaterialListener();
  startCloudNoticeListener();
  startCloudStudentListener();
  startCloudAssessmentListener();
  startCloudSeatLayoutListener();
}

export async function initDataLayer({onRecords,onMaterials,onNotices,onStudents,onAssessments,onSeatLayouts,onProjects,onAuth}){
  onRecordsCb=onRecords;
  onMaterialsCb=onMaterials;
  onNoticesCb=onNotices;
  onStudentsCb=onStudents;
  onAssessmentsCb=onAssessments;
  onSeatLayoutsCb=onSeatLayouts;
  onProjectsCb=onProjects;
  onAuthCb=onAuth;

  ensureLocalSeedProjects();
  const legacyLocalCount=migrateLegacyLocalIfNeeded();
  emitLocalProjects();
  emitLocalRecords();
  emitLocalMaterials();
  onNoticesCb?.([],"local",activeProjectId);
  onStudentsCb?.([],"local",activeProjectId);
  onAssessmentsCb?.([],"local",activeProjectId);
  onSeatLayoutsCb?.([],"local",activeProjectId);
  if(legacyLocalCount) onAuthCb?.({configured:isFirebaseConfigured(),user:null,mode:"local",legacyLocalMigrated:legacyLocalCount});

  if(!isFirebaseConfigured()){
    onAuthCb?.({configured:false,user:null,mode:"local"});
    return;
  }

  try{
    const [appMod,authMod,fsMod]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js")
    ]);
    const app=appMod.initializeApp(firebaseConfig);
    auth=authMod.getAuth(app);
    db=fsMod.getFirestore(app);
    firebase={authMod,fsMod};

    authMod.onAuthStateChanged(auth, async user=>{
      currentUser=user||null;
      stopProjectListeners();

      if(!user){
        emitLocalProjects();
        emitLocalRecords();
        emitLocalMaterials();
        onNoticesCb?.([],"local",activeProjectId);
        onStudentsCb?.([],"local",activeProjectId);
        onAssessmentsCb?.([],"local",activeProjectId);
        onSeatLayoutsCb?.([],"local",activeProjectId);
        onAuthCb?.({configured:true,user:null,mode:"local"});
        return;
      }

      try{
        await ensureCloudSeedProjects();
        await loadCloudProjects();
        const migrated=await migrateLegacyCloudIfNeeded();
        startCloudProjectListeners();
        onAuthCb?.({configured:true,user,mode:"cloud",legacyCloudMigrated:migrated});
      }catch(err){
        console.error(err);
        onAuthCb?.({configured:true,user,mode:"cloud",error:err.message});
      }
    });
  }catch(err){
    console.error(err);
    onAuthCb?.({configured:true,user:null,mode:"local",error:err.message});
  }
}

export async function setActiveProject(projectId){
  activeProjectId=String(projectId||DEFAULT_PROJECT_ID);
  localStorage.setItem(ACTIVE_PROJECT_KEY,activeProjectId);
  if(storageMode()==="cloud") startCloudProjectListeners();
  else {
    emitLocalRecords(); emitLocalMaterials();
    onNoticesCb?.([],"local",activeProjectId);
    onStudentsCb?.([],"local",activeProjectId);
    onAssessmentsCb?.([],"local",activeProjectId);
    onSeatLayoutsCb?.([],"local",activeProjectId);
  }
}

export async function signInGoogle(){
  if(!firebase||!auth) throw new Error("Firebase 초기화가 완료되지 않았습니다.");
  const provider=new firebase.authMod.GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  return firebase.authMod.signInWithPopup(auth,provider);
}
export async function signOutGoogle(){
  if(!firebase||!auth) return;
  return firebase.authMod.signOut(auth);
}

function normalizeRecord(record){
  const copy={...record};
  delete copy._source;
  copy.projectId=String(copy.projectId||activeProjectId);
  return copy;
}
function normalizeMaterial(material){
  const copy={...material};
  delete copy._source;
  copy.projectId=String(copy.projectId||activeProjectId);
  copy.title=String(copy.title||"").trim();
  copy.description=String(copy.description||"").trim();
  copy.category=String(copy.category||"수업자료");
  copy.fileType=String(copy.fileType||"기타");
  copy.driveUrl=String(copy.driveUrl||"").trim();
  copy.fileId=String(copy.fileId||"").trim();
  copy.previewUrl=String(copy.previewUrl||"").trim();
  copy.downloadUrl=String(copy.downloadUrl||"").trim();
  // v2.2.1: 학생 자료실은 반 구분 없이 전체 학생 공통 자료로 운영
  // 하위 호환을 위해 필드는 유지하되 값은 항상 ALL로 고정한다.
  copy.targetClasses=["ALL"];
  copy.isPublished=copy.isPublished!==false;
  return copy;
}

export async function upsertRecord(record){
  const clean=normalizeRecord(record);
  if(storageMode()==="cloud"){
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"lessonRecords",String(clean.id)),
      clean,{merge:true}
    );
    return;
  }
  const rows=getLocalRecords(activeProjectId);
  const idx=rows.findIndex(r=>String(r.id)===String(clean.id));
  if(idx>=0) rows[idx]=clean; else rows.push(clean);
  saveLocalRecords(activeProjectId,rows);
  onRecordsCb?.(rows,"local",activeProjectId);
}

export async function deleteRecordById(id){
  if(storageMode()==="cloud"){
    await firebase.fsMod.deleteDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"lessonRecords",String(id))
    );
    return;
  }
  const rows=getLocalRecords(activeProjectId).filter(r=>String(r.id)!==String(id));
  saveLocalRecords(activeProjectId,rows);
  onRecordsCb?.(rows,"local",activeProjectId);
}

export async function replaceAllRecords(imported){
  if(!Array.isArray(imported)) throw new Error("올바른 기록 배열이 아닙니다.");
  const rows=imported.map(r=>normalizeRecord({...r,projectId:activeProjectId}));
  if(storageMode()==="cloud"){
    const existing=await firebase.fsMod.getDocs(
      firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",activeProjectId,"lessonRecords")
    );
    const batch=firebase.fsMod.writeBatch(db);
    existing.docs.forEach(d=>batch.delete(d.ref));
    rows.forEach(r=>{
      const id=String(r.id||crypto.randomUUID());
      batch.set(firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"lessonRecords",id),{...r,id});
    });
    await batch.commit();
  }else{
    saveLocalRecords(activeProjectId,rows);
    onRecordsCb?.(rows,"local",activeProjectId);
  }
}

export async function migrateLocalToCloud(){
  if(storageMode()!=="cloud") throw new Error("먼저 Google 로그인을 해 주세요.");
  const rows=getLocalRecords(activeProjectId);
  for(const row of rows){
    const clean=normalizeRecord(row);
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"lessonRecords",String(clean.id)),
      clean,{merge:true}
    );
  }
  return rows.length;
}

export async function upsertMaterial(material){
  const clean=normalizeMaterial(material);
  if(!clean.id) throw new Error("자료 ID가 없습니다.");
  if(storageMode()==="cloud"){
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"materials",String(clean.id)),
      clean,{merge:true}
    );
    return clean;
  }
  const rows=getLocalMaterials(activeProjectId);
  const idx=rows.findIndex(r=>String(r.id)===String(clean.id));
  if(idx>=0) rows[idx]=clean; else rows.unshift(clean);
  rows.sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  saveLocalMaterials(activeProjectId,rows);
  onMaterialsCb?.(rows,"local",activeProjectId);
  return clean;
}

export async function deleteMaterialById(id){
  if(storageMode()==="cloud"){
    await firebase.fsMod.deleteDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"materials",String(id))
    );
    return;
  }
  const rows=getLocalMaterials(activeProjectId).filter(r=>String(r.id)!==String(id));
  saveLocalMaterials(activeProjectId,rows);
  onMaterialsCb?.(rows,"local",activeProjectId);
}

export async function replaceAllMaterials(imported){
  if(!Array.isArray(imported)) throw new Error("올바른 자료 배열이 아닙니다.");
  const rows=imported.map(r=>normalizeMaterial({...r,projectId:activeProjectId}));
  if(storageMode()==="cloud"){
    const existing=await firebase.fsMod.getDocs(
      firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",activeProjectId,"materials")
    );
    const batch=firebase.fsMod.writeBatch(db);
    existing.docs.forEach(d=>batch.delete(d.ref));
    rows.forEach(r=>{
      const id=String(r.id||crypto.randomUUID());
      batch.set(firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"materials",id),{...r,id});
    });
    await batch.commit();
  }else{
    saveLocalMaterials(activeProjectId,rows);
    onMaterialsCb?.(rows,"local",activeProjectId);
  }
}

export async function migrateLocalMaterialsToCloud(){
  if(storageMode()!=="cloud") throw new Error("먼저 Google 로그인을 해 주세요.");
  const rows=getLocalMaterials(activeProjectId);
  for(const row of rows){
    const clean=normalizeMaterial(row);
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"materials",String(clean.id)),
      clean,{merge:true}
    );
  }
  return rows.length;
}


function normalizeNotice(notice){
  const n={...notice};
  delete n._source;
  n.id=String(n.id||crypto.randomUUID());
  n.projectId=String(n.projectId||activeProjectId);
  n.type=["ASSESSMENT","GENERAL"].includes(String(n.type))?String(n.type):"GENERAL";
  n.title=String(n.title||"").trim();
  n.body=String(n.body||"").trim();
  n.isPublished=n.isPublished!==false;
  n.attachments=Array.isArray(n.attachments)?n.attachments.map(a=>({
    name:String(a?.name||"첨부파일"),
    size:Number(a?.size||0),
    type:String(a?.type||""),
    path:String(a?.path||""),
    url:String(a?.url||""),
    driveUrl:String(a?.driveUrl||""),
    downloadUrl:String(a?.downloadUrl||""),
    source:String(a?.source||((a?.driveUrl)?"GOOGLE_DRIVE":"LINK"))
  })).filter(a=>a.url):[];
  n.createdAt=String(n.createdAt||new Date().toISOString());
  n.updatedAt=String(n.updatedAt||new Date().toISOString());
  return n;
}
function publicNotice(notice){
  const n=normalizeNotice(notice);
  return {
    noticeId:n.id,
    type:n.type,
    title:n.title,
    body:n.body,
    attachments:n.attachments,
    createdAt:n.createdAt,
    updatedAt:n.updatedAt
  };
}
async function syncPublicNotice(notice){
  const n=normalizeNotice(notice);
  await ensurePublicCourseShell();
  const ref=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"notices",n.id);
  if(n.isPublished) await firebase.fsMod.setDoc(ref,publicNotice(n),{merge:true});
  else await firebase.fsMod.deleteDoc(ref).catch(()=>{});
  return n;
}
export async function upsertNotice(notice){
  requireNoticeCloud();
  const n=normalizeNotice(notice);
  if(!n.title)throw new Error("공지 제목을 입력해 주세요.");
  if(!n.body)throw new Error("공지 내용을 입력해 주세요.");
  await ensurePublicCourseShell();
  const privateRef=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"notices",n.id);
  const publicRef=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"notices",n.id);
  const batch=firebase.fsMod.writeBatch(db);
  batch.set(privateRef,n,{merge:true});
  if(n.isPublished)batch.set(publicRef,publicNotice(n),{merge:true});
  else batch.delete(publicRef);
  await batch.commit();
  return n;
}
export async function deleteNoticeById(id){
  requireNoticeCloud();
  const privateRef=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"notices",String(id));
  const batch=firebase.fsMod.writeBatch(db);
  batch.delete(privateRef);
  batch.delete(firebase.fsMod.doc(db,"publicCourses",activeProjectId,"notices",String(id)));
  await batch.commit();
}
function requireNoticeCloud(){
  if(storageMode()!=="cloud"||!currentUser||!firebase||!db){
    throw new Error("공지 작성은 Google 로그인 상태에서 사용할 수 있습니다.");
  }
}

export async function saveProject(project){
  const p=normalizeProject(project);
  if(!p.id) throw new Error("프로젝트 ID가 없습니다.");
  p.updatedAt=new Date().toISOString();
  if(storageMode()==="cloud"){
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",p.id),
      p,{merge:true}
    );
    await loadCloudProjects();
  }else{
    const rows=ensureLocalSeedProjects();
    const idx=rows.findIndex(x=>x.id===p.id);
    if(idx>=0) rows[idx]=p; else rows.push(p);
    writeJson(PROJECTS_LOCAL_KEY,rows);
    currentProjects=rows;
    onProjectsCb?.(currentProjects,"local");
  }
  return p;
}

function publicRecord(record){
  return {
    date: String(record.date || ""),
    period: Number(record.period || 0),
    type: String(record.type || ""),
    session: String(record.session || ""),
    title: String(record.title || ""),
    detail: String(record.detail || ""),
    nextStart: String(record.nextStart || ""),
    updatedAt: String(record.updatedAt || "")
  };
}
function publicMaterial(material){
  return {
    title: String(material.title||""),
    description: String(material.description||""),
    category: String(material.category||"수업자료"),
    fileType: String(material.fileType||"기타"),
    driveUrl: String(material.driveUrl||""),
    fileId: String(material.fileId||""),
    previewUrl: String(material.previewUrl||""),
    downloadUrl: String(material.downloadUrl||""),
    targetClasses: ["ALL"],
    createdAt: String(material.createdAt||""),
    updatedAt: String(material.updatedAt||"")
  };
}
function compareRecords(a,b){
  return String(a.date||"").localeCompare(String(b.date||"")) || Number(a.period||0)-Number(b.period||0);
}
function publicAcademicEvents(project){
  return (Array.isArray(project?.academicEvents)?project.academicEvents:[])
    .map(e=>({date:String(e?.date||""),title:String(e?.title||""),detail:String(e?.detail||"")}))
    .filter(e=>e.date&&e.title);
}
function publicWeeklyTimetable(project){
  const out={};
  const source=project?.weeklyTimetable&&typeof project.weeklyTimetable==="object"?project.weeklyTimetable:{};
  Object.entries(source).forEach(([day,slots])=>{
    out[String(day)]=(Array.isArray(slots)?slots:[])
      .map(s=>({className:String(s?.className||""),period:Number(s?.period||0)}))
      .filter(s=>s.className&&s.period>0);
  });
  return out;
}
function publicScheduleMeta(project){
  return {
    semesterStart:String(project?.semesterStart||""),
    semesterEnd:String(project?.semesterEnd||""),
    noClassDates:(Array.isArray(project?.noClassDates)?project.noClassDates:[]).map(String).filter(Boolean),
    academicEvents:publicAcademicEvents(project),
    weeklyTimetable:publicWeeklyTimetable(project)
  };
}

export async function publishStudentPortalData(projectId=activeProjectId){
  if(storageMode()!=="cloud" || !currentUser || !firebase || !db){
    throw new Error("학생 포털 발행은 Google 로그인 후 사용할 수 있습니다.");
  }
  const project=currentProjects.find(p=>String(p.id)===String(projectId));
  if(!project) throw new Error("발행할 수업 프로젝트를 찾을 수 없습니다.");

  const [recordSnap,materialSnap,noticeSnap]=await Promise.all([
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",projectId,"lessonRecords")),
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",projectId,"materials")),
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",projectId,"notices"))
  ]);
  const sourceRows=recordSnap.docs.map(d=>({id:d.id,...d.data()}));
  const visibleRows=sourceRows
    .filter(r=>r.status!=="cancelled" && r.status!=="schedule_hidden" && r.studentVisible!==false)
    .sort(compareRecords);
  const visibleMaterials=materialSnap.docs
    .map(d=>({id:d.id,...d.data()}))
    .filter(m=>m.isPublished!==false && String(m.title||"").trim() && String(m.fileId||"").trim())
    .sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));
  const visibleNotices=noticeSnap.docs
    .map(d=>normalizeNotice({id:d.id,...d.data()}))
    .filter(n=>n.isPublished!==false && n.title && n.body)
    .sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));

  const publicRef=firebase.fsMod.doc(db,"publicCourses",projectId);
  const classesRef=firebase.fsMod.collection(db,"publicCourses",projectId,"classes");
  const materialsRef=firebase.fsMod.collection(db,"publicCourses",projectId,"materials");
  const noticesRef=firebase.fsMod.collection(db,"publicCourses",projectId,"notices");
  const [existingClassSnap,existingMaterialSnap,existingNoticeSnap]=await Promise.all([
    firebase.fsMod.getDocs(classesRef),
    firebase.fsMod.getDocs(materialsRef),
    firebase.fsMod.getDocs(noticesRef)
  ]);

  const batch=firebase.fsMod.writeBatch(db);
  batch.set(publicRef,{
    ownerUid: currentUser.uid,
    projectId: project.id,
    academicYear: Number(project.academicYear||0),
    semester: String(project.semester||""),
    grade: Number(project.grade||0),
    subjectName: String(project.subjectName||""),
    shortName: String(project.shortName||project.subjectName||""),
    portalTitle: String(project.portalTitle||`${project.shortName||project.subjectName} 수업 종합 포털`),
    portalSubtitle: String(project.portalSubtitle||`${project.academicYear}학년도 ${project.grade}학년 · ${project.subjectName}`),
    classes: Array.isArray(project.classes)?project.classes.map(String):[],
    ...publicScheduleMeta(project),
    publishedRecordCount: visibleRows.length,
    publishedMaterialCount: visibleMaterials.length,
    publishedNoticeCount: visibleNotices.length,
    updatedAt: firebase.fsMod.serverTimestamp()
  },{merge:true});

  existingClassSnap.docs.forEach(d=>batch.delete(d.ref));
  existingMaterialSnap.docs.forEach(d=>batch.delete(d.ref));
  existingNoticeSnap.docs.forEach(d=>batch.delete(d.ref));

  for(const className of (project.classes||[])){
    const classRows=visibleRows.filter(r=>String(r.className)===String(className));
    const current=classRows.length?publicRecord(classRows[classRows.length-1]):null;
    const recent=classRows.slice(-10).reverse().map(publicRecord);
    const calendarRecords=classRows.map(publicRecord);
    const scheduleSkips=sourceRows
      .filter(r=>String(r.className)===String(className) && (r.status==="cancelled" || r.status==="schedule_hidden"))
      .map(r=>({date:String(r.date||""),period:Number(r.period||0)}))
      .filter(r=>r.date&&r.period>0);
    batch.set(firebase.fsMod.doc(db,"publicCourses",projectId,"classes",String(className)),{
      className: String(className), current, recent, calendarRecords, scheduleSkips, updatedAt: firebase.fsMod.serverTimestamp()
    });
  }
  for(const material of visibleMaterials){
    batch.set(
      firebase.fsMod.doc(db,"publicCourses",projectId,"materials",String(material.id)),
      publicMaterial(material)
    );
  }
  for(const notice of visibleNotices){
    batch.set(
      firebase.fsMod.doc(db,"publicCourses",projectId,"notices",String(notice.id)),
      publicNotice(notice)
    );
  }

  await batch.commit();
  return {
    projectId,
    publishedRecordCount: visibleRows.length,
    publishedMaterialCount: visibleMaterials.length,
    publishedNoticeCount: visibleNotices.length,
    classCount: (project.classes||[]).filter(c=>visibleRows.some(r=>String(r.className)===String(c))).length
  };
}

export function studentPortalUrl(projectId=activeProjectId){
  return `https://acmejy-code.github.io/Jcoupe-class-portal/?project=${encodeURIComponent(projectId)}`;
}


function requireAssessmentCloud(){
  if(storageMode()!=="cloud" || !currentUser || !firebase || !db){
    throw new Error("수행평가 응시 관리는 Google 로그인 상태에서 사용할 수 있습니다.");
  }
}

async function getDocServer(ref){
  requireAssessmentCloud();
  if(typeof firebase.fsMod.getDocFromServer==="function") return firebase.fsMod.getDocFromServer(ref);
  return firebase.fsMod.getDoc(ref);
}
async function getDocsServer(refOrQuery){
  requireAssessmentCloud();
  if(typeof firebase.fsMod.getDocsFromServer==="function") return firebase.fsMod.getDocsFromServer(refOrQuery);
  return firebase.fsMod.getDocs(refOrQuery);
}

const ASSESSMENT_SERVER_TIMEOUT_MS=8000;
const ASSESSMENT_REST_TIMEOUT_MS=7000;
function withAssessmentTimeout_(promise,label,ms=ASSESSMENT_SERVER_TIMEOUT_MS){
  let timer=null;
  return Promise.race([
    Promise.resolve(promise).finally(()=>{ if(timer) clearTimeout(timer); }),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} 서버 응답이 ${Math.round(ms/1000)}초를 초과했습니다.`)),ms);
    })
  ]);
}
async function commitAssessmentBatch_(batch,label){
  return withAssessmentTimeout_(batch.commit(),label);
}

function restDocName_(segments){
  const path=segments.map(x=>encodeURIComponent(String(x))).join('/');
  return `projects/${firebaseConfig.projectId}/databases/(default)/documents/${path}`;
}
function restValue_(value){
  if(value===null||value===undefined)return {nullValue:null};
  if(value instanceof Date)return {timestampValue:value.toISOString()};
  if(Array.isArray(value))return {arrayValue:{values:value.map(restValue_)}};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='number'){
    if(Number.isInteger(value))return {integerValue:String(value)};
    return {doubleValue:value};
  }
  if(typeof value==='object'){
    const fields={};
    Object.entries(value).forEach(([k,v])=>{fields[k]=restValue_(v);});
    return {mapValue:{fields}};
  }
  return {stringValue:String(value)};
}
function restFields_(obj){
  const fields={};
  Object.entries(obj||{}).forEach(([k,v])=>{fields[k]=restValue_(v);});
  return fields;
}
function restUpdateWrite_(segments,data,{mustExist=false}={}){
  const fieldPaths=Object.keys(data||{});
  const write={
    update:{name:restDocName_(segments),fields:restFields_(data)},
    updateMask:{fieldPaths}
  };
  if(mustExist)write.currentDocument={exists:true};
  return write;
}
function restDeleteWrite_(segments){return {delete:restDocName_(segments)};}

async function firebaseIdToken_(forceRefresh=false){
  if(!currentUser)throw new Error('Google 로그인 정보가 없습니다.');
  if(firebase?.authMod?.getIdToken)return withAssessmentTimeout_(firebase.authMod.getIdToken(currentUser,forceRefresh),'인증 토큰',4000);
  if(typeof currentUser.getIdToken==='function')return withAssessmentTimeout_(currentUser.getIdToken(forceRefresh),'인증 토큰',4000);
  throw new Error('Firebase 인증 토큰을 가져올 수 없습니다.');
}
async function firestoreRestCommitOnce_(writes,label,token){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ASSESSMENT_REST_TIMEOUT_MS);
  try{
    const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents:commit`;
    const res=await fetch(url,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({writes}),signal:controller.signal,cache:'no-store'});
    const text=await res.text();
    let data=null;try{data=text?JSON.parse(text):null;}catch{data=null;}
    if(!res.ok){
      const msg=data?.error?.message||text||`HTTP ${res.status}`;
      const err=new Error(`${label} REST 처리 실패 (${res.status}): ${msg}`);err.httpStatus=res.status;throw err;
    }
    return data||{ok:true};
  }catch(err){
    if(err?.name==='AbortError')throw new Error(`${label} REST 서버 응답이 ${Math.round(ASSESSMENT_REST_TIMEOUT_MS/1000)}초를 초과했습니다.`);
    throw err;
  }finally{clearTimeout(timer);}
}
async function firestoreRestCommit_(writes,label){
  let token=await firebaseIdToken_(false);
  try{return await firestoreRestCommitOnce_(writes,label,token);}catch(err){
    if(Number(err?.httpStatus)!==401)throw err;
    token=await firebaseIdToken_(true);
    return firestoreRestCommitOnce_(writes,label,token);
  }
}
async function resetFirestoreNetworkBestEffort_(){
  try{
    if(firebase?.fsMod?.disableNetwork&&firebase?.fsMod?.enableNetwork&&db){
      await withAssessmentTimeout_(firebase.fsMod.disableNetwork(db),'Firestore 연결 초기화',1500).catch(()=>{});
      await new Promise(r=>setTimeout(r,120));
      await withAssessmentTimeout_(firebase.fsMod.enableNetwork(db),'Firestore 재연결',2000).catch(()=>{});
    }
  }catch(err){console.warn('Firestore 연결 복구 실패',err);}
}
async function commitAssessmentLifecycle_(writes,label,sdkBatchFactory=null){
  // v3.2.1: 평가 생명주기(입장/시작/종료/삭제)는 REST commit을 우선 사용한다.
  // Firestore JS SDK의 로컬 write queue가 이전 지연 쓰기에 막혀도 새 평가가 간섭받지 않게 한다.
  try{
    const result=await firestoreRestCommit_(writes,label);
    resetFirestoreNetworkBestEffort_();
    return {ok:true,transport:'rest',result};
  }catch(restErr){
    console.warn(`${label}: REST 경로 실패, SDK 경로 재시도`,restErr);
    if(!sdkBatchFactory)throw restErr;
    await resetFirestoreNetworkBestEffort_();
    try{
      const batch=sdkBatchFactory();
      await withAssessmentTimeout_(batch.commit(),`${label} SDK 재시도`,7000);
      return {ok:true,transport:'sdk-retry'};
    }catch(sdkErr){
      const e=new Error(`${label} 서버 반영에 실패했습니다. REST: ${restErr.message||restErr} / SDK: ${sdkErr.message||sdkErr}`);
      e.restError=restErr;e.sdkError=sdkErr;throw e;
    }
  }
}
function assessmentFingerprintData(a){
  const classes=Array.isArray(a?.targetClasses)?a.targetClasses.map(String).sort().join("|"):"";
  const qCount=Array.isArray(a?.questions)?a.questions.length:Number(a?.questionCount||0);
  return [String(a?.title||"").trim(),classes,Number(a?.durationMinutes||0),qCount].join("::");
}
function normalizeNameKey(value){ return String(value||"").replace(/\s+/g,"").trim(); }
function normalizeStudent(student){
  return {
    studentId:String(student.studentId||student.id||"").trim(),
    name:String(student.name||"").trim(),
    nameKey:normalizeNameKey(student.nameKey||student.name||""),
    className:String(student.className||"").trim(),
    seatOrder:Number(student.seatOrder||0),
    updatedAt:new Date().toISOString(),
    createdAt:String(student.createdAt||new Date().toISOString())
  };
}
function normalizeAssessment(assessment){
  const questions=Array.isArray(assessment.questions)?assessment.questions.map((q,i)=>({
    id:String(q.id||`q${i+1}`),
    prompt:String(q.prompt||"").trim(),
    placeholder:String(q.placeholder||"").trim(),
    required:q.required!==false
  })).filter(q=>q.prompt):[];
  return {
    id:String(assessment.id||crypto.randomUUID()),
    title:String(assessment.title||"").trim(),
    description:String(assessment.description||"").trim(),
    instructions:String(assessment.instructions||"").trim(),
    accessCode:String(assessment.accessCode||"").trim(),
    targetClasses:Array.isArray(assessment.targetClasses)?assessment.targetClasses.map(String).filter(Boolean):[],
    durationMinutes:Math.max(0,Number(assessment.durationMinutes||0)),
    timeExtensionMinutes:Math.max(0,Number(assessment.timeExtensionMinutes||0)),
    startedAt:assessment.startedAt||null,
    status:["DRAFT","WAITING","OPEN","CLOSED"].includes(String(assessment.status))?String(assessment.status):"DRAFT",
    questions,
    projectId:activeProjectId,
    createdAt:assessment.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
async function ensurePublicCourseShell(){
  const project=currentProjects.find(p=>String(p.id)===String(activeProjectId));
  if(!project) throw new Error("현재 수업 프로젝트를 찾을 수 없습니다.");
  await firebase.fsMod.setDoc(firebase.fsMod.doc(db,"publicCourses",activeProjectId),{
    ownerUid:currentUser.uid,
    projectId:project.id,
    academicYear:Number(project.academicYear||0),
    semester:String(project.semester||""),
    grade:Number(project.grade||0),
    subjectName:String(project.subjectName||""),
    shortName:String(project.shortName||project.subjectName||""),
    portalTitle:String(project.portalTitle||`${project.shortName||project.subjectName} 수업 종합 포털`),
    portalSubtitle:String(project.portalSubtitle||`${project.academicYear}학년도 ${project.grade}학년 · ${project.subjectName}`),
    classes:Array.isArray(project.classes)?project.classes.map(String):[],
    ...publicScheduleMeta(project),
    updatedAt:firebase.fsMod.serverTimestamp()
  },{merge:true});
}
async function publishAssessmentPublic(assessment){
  requireAssessmentCloud();
  const a=normalizeAssessment(assessment);
  await ensurePublicCourseShell();
  const batch=firebase.fsMod.writeBatch(db);
  const metaRef=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"assessments",a.id);
  const contentRef=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"assessments",a.id,"content","main");
  batch.set(metaRef,{
    ownerUid:currentUser.uid,
    assessmentId:a.id,
    title:a.title,
    description:a.description,
    status:a.status,
    targetClasses:a.targetClasses,
    durationMinutes:a.durationMinutes,
    timeExtensionMinutes:a.timeExtensionMinutes||0,
    startedAt:a.startedAt||null,
    questionCount:a.questions.length,
    updatedAt:firebase.fsMod.serverTimestamp()
  },{merge:true});
  batch.set(contentRef,{
    assessmentId:a.id,
    title:a.title,
    instructions:a.instructions,
    questions:a.questions,
    updatedAt:firebase.fsMod.serverTimestamp()
  },{merge:true});
  await batch.commit();
  return a;
}

function buildVerticalDepthSlots(ids,depthCount){
  const list=(ids||[]).filter(Boolean).map(String);
  const depth=Math.min(8,Math.max(2,Number(depthCount||5)));
  if(!list.length)return [];
  const cols=Math.ceil(list.length/depth),slots=Array(cols*depth).fill(null);
  list.forEach((id,index)=>slots[index]=id);
  return slots;
}

export async function replaceStudentsForClass(className,students){
  requireAssessmentCloud();
  const cls=String(className||"").trim();
  if(!cls) throw new Error("반을 선택해 주세요.");
  const normalized=(students||[]).map((s,i)=>normalizeStudent({...s,className:cls,seatOrder:i+1})).filter(s=>s.studentId&&s.name);
  const dup=new Set();
  for(const st of normalized){
    if(!/^\d{4,5}$/.test(st.studentId)) throw new Error(`학번은 4자리 또는 5자리 숫자만 사용할 수 있습니다: ${st.studentId}`);
    if(dup.has(st.studentId)) throw new Error(`중복 학번이 있습니다: ${st.studentId}`);
    dup.add(st.studentId);
  }
  const col=firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",activeProjectId,"students");
  const existing=await firebase.fsMod.getDocs(col);
  const old=existing.docs.filter(d=>String(d.data().className||"")===cls);
  const batch=firebase.fsMod.writeBatch(db);
  old.forEach(d=>batch.delete(d.ref));
  normalized.forEach(st=>batch.set(firebase.fsMod.doc(col,st.studentId),st));
  await batch.commit();
  const initialIds=normalized.map(s=>s.studentId);
  await saveSeatLayout(cls,5,initialIds,buildVerticalDepthSlots(initialIds,5));
  return normalized.length;
}

export async function saveSeatLayout(className,seatsPerVerticalLine,orderedStudentIds,slots=null,layoutMeta=null){
  requireAssessmentCloud();
  const cls=String(className||"").trim();
  const safeDepth=Math.min(8,Math.max(2,Number(seatsPerVerticalLine||5)));
  const safeOrdered=(orderedStudentIds||[]).filter(Boolean).map(String);
  const safeSlots=Array.isArray(slots)?slots.map(v=>v?String(v):null):buildVerticalDepthSlots(safeOrdered,safeDepth);
  const safeColumns=Math.max(1,Math.ceil(safeSlots.length/safeDepth));
  const payload={className:cls,seatsPerVerticalLine:safeDepth,verticalDepth:safeDepth,columns:safeColumns,verticalLines:safeColumns,flow:"VERTICAL_DEPTH",orderedStudentIds:safeOrdered,slots:safeSlots,updatedAt:new Date().toISOString()};
  if(layoutMeta&&typeof layoutMeta==="object"){
    const normSide=v=>["CORRIDOR","OUTER"].includes(String(v||"").toUpperCase())?String(v).toUpperCase():"NONE";
    if("leftSide" in layoutMeta)payload.leftSide=normSide(layoutMeta.leftSide);
    if("rightSide" in layoutMeta)payload.rightSide=normSide(layoutMeta.rightSide);
  }
  await firebase.fsMod.setDoc(
    firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"seatLayouts",cls),
    payload,
    {merge:true}
  );
}

export async function upsertAssessment(assessment){
  requireAssessmentCloud();
  const a=normalizeAssessment(assessment);
  if(!a.title) throw new Error("수행평가 제목을 입력해 주세요.");
  if(!a.accessCode) throw new Error("응시코드를 입력해 주세요.");
  if(!a.targetClasses.length) throw new Error("응시 대상 반을 한 개 이상 선택해 주세요.");
  if(!a.questions.length) throw new Error("문항을 한 개 이상 등록해 주세요.");
  await firebase.fsMod.setDoc(
    firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"assessments",a.id),
    a,{merge:true}
  );
  await publishAssessmentPublic(a);
  return a;
}

export async function setAssessmentStatus(assessmentId,status,assessmentSnapshot=null){
  requireAssessmentCloud();
  const id=String(assessmentId);
  const ref=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id);
  // v3.2.1: 입장/시작 직전에 SDK getDoc()을 호출하지 않는다.
  // 이전 평가의 pending write/network queue가 SDK 읽기까지 붙잡는 상황을 완전히 우회하기 위해,
  // 관리자 화면이 이미 서버 스냅샷으로 보유한 선택 평가 객체를 그대로 사용한다.
  if(!assessmentSnapshot || String(assessmentSnapshot.id||"")!==id){
    throw new Error("현재 평가 정보가 없습니다. 수행평가 목록을 다시 선택한 뒤 시도해 주세요.");
  }
  const a=normalizeAssessment({...assessmentSnapshot,status});
  const now=new Date();
  const nowIso=now.toISOString();
  const privatePath=["users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id];
  const publicPath=["publicCourses",activeProjectId,"assessments",id];
  const contentPath=["publicCourses",activeProjectId,"assessments",id,"content","main"];

  if(status==="WAITING"){
    const privatePayload={...a,status:"WAITING",timeExtensionMinutes:0,startedAt:null,updatedAt:nowIso};
    const publicPayload={
      ownerUid:currentUser.uid,assessmentId:a.id,title:a.title,description:a.description,status:"WAITING",
      targetClasses:a.targetClasses,durationMinutes:a.durationMinutes,timeExtensionMinutes:0,
      startedAt:null,questionCount:a.questions.length,updatedAt:now
    };
    const contentPayload={assessmentId:a.id,title:a.title,instructions:a.instructions,questions:a.questions,updatedAt:now};
    const writes=[
      restUpdateWrite_(privatePath,privatePayload,{mustExist:true}),
      restUpdateWrite_(publicPath,publicPayload),
      restUpdateWrite_(contentPath,contentPayload)
    ];
    const sdkFactory=()=>{
      const batch=firebase.fsMod.writeBatch(db);
      batch.set(ref,{...privatePayload},{merge:true});
      batch.set(firebase.fsMod.doc(db,...publicPath),{...publicPayload,updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
      batch.set(firebase.fsMod.doc(db,...contentPath),{...contentPayload,updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
      return batch;
    };
    const r=await commitAssessmentLifecycle_(writes,"학생 입장 열기",sdkFactory);
    return {...a,status:"WAITING",timeExtensionMinutes:0,startedAt:null,_transport:r.transport};
  }

  if(status==="OPEN"){
    const privatePayload={...a,status:"OPEN",timeExtensionMinutes:0,startedAt:now,updatedAt:nowIso};
    const publicPayload={
      ownerUid:currentUser.uid,assessmentId:a.id,title:a.title,description:a.description,status:"OPEN",
      targetClasses:a.targetClasses,durationMinutes:a.durationMinutes,timeExtensionMinutes:0,
      startedAt:now,questionCount:a.questions.length,updatedAt:now
    };
    const contentPayload={assessmentId:a.id,title:a.title,instructions:a.instructions,questions:a.questions,updatedAt:now};
    const writes=[
      restUpdateWrite_(privatePath,privatePayload,{mustExist:true}),
      restUpdateWrite_(publicPath,publicPayload),
      restUpdateWrite_(contentPath,contentPayload)
    ];
    const sdkFactory=()=>{
      const batch=firebase.fsMod.writeBatch(db);
      batch.set(ref,{...privatePayload,startedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
      batch.set(firebase.fsMod.doc(db,...publicPath),{...publicPayload,startedAt:firebase.fsMod.Timestamp.fromDate(now),updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
      batch.set(firebase.fsMod.doc(db,...contentPath),{...contentPayload,updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
      return batch;
    };
    const r=await commitAssessmentLifecycle_(writes,"시험 시작",sdkFactory);
    return {...a,status:"OPEN",timeExtensionMinutes:0,startedAt:now,_transport:r.transport};
  }

  const payload={...a,status,updatedAt:nowIso};
  await firebase.fsMod.setDoc(ref,payload,{merge:true});
  await publishAssessmentPublic(payload);
  return payload;
}


export async function closeAssessmentStatusOnly(assessmentId,reason="AUTO_CLOSE"){
  requireAssessmentCloud();
  const id=String(assessmentId);
  const now=new Date();
  const nowIso=now.toISOString();
  const privatePath=["users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id];
  const publicPath=["publicCourses",activeProjectId,"assessments",id];
  const privateData={status:"CLOSED",closeReason:String(reason||"AUTO_CLOSE"),closedAt:now,updatedAt:nowIso};
  const publicData={ownerUid:currentUser.uid,status:"CLOSED",closeReason:String(reason||"AUTO_CLOSE"),closedAt:now,updatedAt:now};
  const writes=[restUpdateWrite_(privatePath,privateData,{mustExist:true}),restUpdateWrite_(publicPath,publicData)];
  const sdkFactory=()=>{
    const batch=firebase.fsMod.writeBatch(db);
    batch.set(firebase.fsMod.doc(db,...privatePath),{...privateData,closedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
    batch.set(firebase.fsMod.doc(db,...publicPath),{...publicData,closedAt:firebase.fsMod.Timestamp.fromDate(now),updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
    return batch;
  };
  const r=await commitAssessmentLifecycle_(writes,"평가 상태 종료",sdkFactory);
  return {ok:true,id,transport:r.transport};
}


async function retryAssessmentLifecycle_(label, fn, attempts=4){
  let lastErr=null;
  const waits=[0,350,900,1800];
  for(let i=0;i<Math.max(1,attempts);i++){
    if(waits[i])await new Promise(r=>setTimeout(r,waits[i]));
    try{return await fn();}catch(err){lastErr=err;console.warn(`${label} 재시도 ${i+1}/${attempts}`,err);}
  }
  throw lastErr||new Error(`${label} 처리에 실패했습니다.`);
}

export async function setAssessmentStatusVerified(assessmentId,status,assessmentSnapshot=null){
  // v3.2.1: 입장/시작은 화면에 이미 로드된 서버 스냅샷을 사용하고,
  // 실제 상태 반영만 REST commit으로 수행한다. SDK 사전 읽기 큐에 의존하지 않는다.
  return setAssessmentStatus(String(assessmentId),status,assessmentSnapshot);
}

export async function closeAssessmentImmediate(assessmentId,reason="TEACHER_CLOSE"){
  requireAssessmentCloud();
  const id=String(assessmentId);
  const now=new Date();
  const nowIso=now.toISOString();
  const privatePath=["users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id];
  const publicPath=["publicCourses",activeProjectId,"assessments",id];
  const privateData={status:"CLOSED",closeReason:String(reason||"TEACHER_CLOSE"),closedAt:now,updatedAt:nowIso};
  const publicData={ownerUid:currentUser.uid,status:"CLOSED",closeReason:String(reason||"TEACHER_CLOSE"),closedAt:now,updatedAt:now};
  const writes=[restUpdateWrite_(privatePath,privateData,{mustExist:true}),restUpdateWrite_(publicPath,publicData)];
  const sdkFactory=()=>{
    const batch=firebase.fsMod.writeBatch(db);
    batch.set(firebase.fsMod.doc(db,...privatePath),{...privateData,closedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
    batch.set(firebase.fsMod.doc(db,...publicPath),{...publicData,closedAt:firebase.fsMod.Timestamp.fromDate(now),updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
    return batch;
  };
  const r=await commitAssessmentLifecycle_(writes,"평가 종료",sdkFactory);
  return {ok:true,id,transport:r.transport};
}


export async function setAssessmentDuration(assessmentId,minutes,assessmentSnapshot=null){
  requireAssessmentCloud();
  const duration=Math.max(1,Math.min(300,Number(minutes||0)));
  if(!Number.isFinite(duration)) throw new Error("시험시간을 확인해 주세요.");
  const id=String(assessmentId);
  // v3.2.1: 시험 시작 직전 시험시간 저장도 SDK getDoc() 선행 없이 처리한다.
  if(!assessmentSnapshot || String(assessmentSnapshot.id||"")!==id){
    throw new Error("현재 평가 정보가 없습니다. 수행평가 목록을 다시 선택한 뒤 시도해 주세요.");
  }
  if(String(assessmentSnapshot.status||"")==="OPEN") throw new Error("시험 시작 후에는 기본 시험시간을 변경할 수 없습니다. 추가시간 기능을 사용하세요.");
  const now=new Date();
  const privatePath=["users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id];
  const publicPath=["publicCourses",activeProjectId,"assessments",id];
  const writes=[
    restUpdateWrite_(privatePath,{durationMinutes:duration,updatedAt:now.toISOString()},{mustExist:true}),
    restUpdateWrite_(publicPath,{ownerUid:currentUser.uid,durationMinutes:duration,updatedAt:now})
  ];
  const sdkFactory=()=>{
    const batch=firebase.fsMod.writeBatch(db);
    batch.update(firebase.fsMod.doc(db,...privatePath),{durationMinutes:duration,updatedAt:now.toISOString()});
    batch.set(firebase.fsMod.doc(db,...publicPath),{ownerUid:currentUser.uid,durationMinutes:duration,updatedAt:firebase.fsMod.Timestamp.fromDate(now)},{merge:true});
    return batch;
  };
  await commitAssessmentLifecycle_(writes,"시험시간 저장",sdkFactory);
  return duration;
}


export async function extendAssessmentTime(assessmentId,minutes){
  requireAssessmentCloud();
  const add=Math.max(0,Number(minutes||0));
  if(!add)return;
  const privateRef=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"assessments",String(assessmentId));
  const publicRef=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"assessments",String(assessmentId));
  const batch=firebase.fsMod.writeBatch(db);
  batch.update(privateRef,{timeExtensionMinutes:firebase.fsMod.increment(add),updatedAt:new Date().toISOString()});
  batch.update(publicRef,{timeExtensionMinutes:firebase.fsMod.increment(add),updatedAt:firebase.fsMod.serverTimestamp()});
  await batch.commit();
}

export async function extendAssessmentStudentTime(assessmentId,studentId,minutes){
  requireAssessmentCloud();
  const add=Math.max(0,Number(minutes||0));
  if(!add)return;
  const ref=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"attempts",String(studentId));
  await firebase.fsMod.updateDoc(ref,{extraMinutes:firebase.fsMod.increment(add),lastTeacherActionAt:firebase.fsMod.serverTimestamp()});
}

export async function reopenAssessmentAttempt(assessmentId,studentId){
  requireAssessmentCloud();
  const ref=firebase.fsMod.doc(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"attempts",String(studentId));
  await firebase.fsMod.updateDoc(ref,{
    status:"IN_PROGRESS",
    reopenedAt:firebase.fsMod.serverTimestamp(),
    reopenCount:firebase.fsMod.increment(1),
    autoSubmitted:false,
    submissionReason:null,
    forcedFinalized:false,
    forcedFinalizedAt:null,
    lastTeacherActionAt:firebase.fsMod.serverTimestamp()
  });
}

function tsMillis(v){
  try{
    if(!v)return 0;
    if(typeof v.toMillis==="function")return v.toMillis();
    if(typeof v.toDate==="function")return v.toDate().getTime();
    const d=new Date(v);return Number.isNaN(d.getTime())?0:d.getTime();
  }catch{return 0;}
}

export async function getAssessmentServerTimeMs(){
  requireAssessmentCloud();
  const ref=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"runtime","assessmentClock");
  await firebase.fsMod.setDoc(ref,{
    sampledAt:firebase.fsMod.serverTimestamp(),
    clientSampleAt:Date.now()
  },{merge:true});
  const snap=await firebase.fsMod.getDoc(ref);
  return tsMillis(snap.data()?.sampledAt)||Date.now();
}

async function finalizeAttemptRefs(items,reason){
  let finalized=0,failed=0;
  const errorCodes=new Set();
  const maxAttempts=4;
  const rows=(items||[]).map(item=>item?.ref?item:{ref:item,doc:null,deadline:0});
  // v2.6.8: 관리자 강제 확정은 답안 본문을 절대 덮지 않고,
  // 확정 당시 서버에 존재하던 마지막 저장/기기수정 시각과 개인 마감시각을 감사정보로 남긴다.
  for(let i=0;i<rows.length;i+=20){
    const chunk=rows.slice(i,i+20);
    let committed=false,lastErr=null;
    for(let attempt=1;attempt<=maxAttempts&&!committed;attempt++){
      try{
        const batch=firebase.fsMod.writeBatch(db);
        chunk.forEach(item=>{
          const data=item.doc?.data?.()||{};
          const payload={
            status:"SUBMITTED",
            submittedAt:firebase.fsMod.serverTimestamp(),
            autoSubmitted:true,
            submissionReason:String(reason||"TIME_EXPIRED"),
            forcedFinalized:true,
            forcedFinalizedAt:firebase.fsMod.serverTimestamp(),
            forcedFinalizedSourceSavedAt:data.lastSavedAt||null,
            forcedFinalizedSourceClientEditAt:data.lastClientEditAt||null,
            waitingActive:false,
            lastSeenAt:firebase.fsMod.serverTimestamp()
          };
          if(item.deadline)payload.effectiveDeadlineAt=new Date(Number(item.deadline));
          batch.update(item.ref,payload);
        });
        await batch.commit();
        finalized+=chunk.length;committed=true;
      }catch(err){
        lastErr=err;errorCodes.add(String(err?.code||err?.name||"unknown"));
        console.warn(`강제 제출 batch 실패 ${attempt}/${maxAttempts}`,chunk.map(x=>x.ref.path),err);
        if(attempt<maxAttempts)await new Promise(resolve=>setTimeout(resolve,350*attempt*attempt));
      }
    }
    if(!committed){failed+=chunk.length;if(lastErr)console.warn("강제 제출 최종 실패",lastErr);}
  }
  return {finalized,failed,errorCodes:[...errorCodes]};
}

const ASSESSMENT_FINALIZE_GRACE_MS=15000;

export async function finalizeExpiredAssessmentAttempts(assessmentId,nowMs=Date.now()){
  requireAssessmentCloud();
  const aRef=firebase.fsMod.doc(db,"users",currentUser.uid,"courseProjects",activeProjectId,"assessments",String(assessmentId));
  const aSnap=await firebase.fsMod.getDoc(aRef);
  if(!aSnap.exists())return {finalized:0,failed:0,remainingUnexpired:0,totalPending:0,commonDeadlineMs:0,nextDeadlineMs:0};
  const a=aSnap.data();
  const started=tsMillis(a.startedAt);
  if(!started||!Number(a.durationMinutes||0))return {finalized:0,failed:0,remainingUnexpired:0,totalPending:0,commonDeadlineMs:0,nextDeadlineMs:0};
  const globalMinutes=Number(a.durationMinutes||0)+Number(a.timeExtensionMinutes||0);
  const now=Number.isFinite(Number(nowMs))?Number(nowMs):Date.now();
  const attempts=await firebase.fsMod.getDocs(firebase.fsMod.collection(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"attempts"));
  const pending=attempts.docs.filter(d=>d.data().status!=="SUBMITTED");
  const rows=pending.map(d=>({doc:d,deadline:started+(globalMinutes+Number(d.data().extraMinutes||0))*60000}));
  const expired=rows.filter(x=>now>=x.deadline+ASSESSMENT_FINALIZE_GRACE_MS).map(x=>({ref:x.doc.ref,doc:x.doc,deadline:x.deadline}));
  const remainingUnexpired=rows.filter(x=>now<x.deadline+ASSESSMENT_FINALIZE_GRACE_MS).length;
  const nextDeadlineMs=rows.filter(x=>now<x.deadline+ASSESSMENT_FINALIZE_GRACE_MS).reduce((m,x)=>Math.max(m,x.deadline+ASSESSMENT_FINALIZE_GRACE_MS),0);
  const result=await finalizeAttemptRefs(expired,"TIME_EXPIRED");
  return {
    ...result,
    remainingUnexpired,
    totalPending:pending.length,
    commonDeadlineMs:started+globalMinutes*60000,
    commonFinalizeAtMs:started+globalMinutes*60000+ASSESSMENT_FINALIZE_GRACE_MS,
    nextDeadlineMs
  };
}

export async function finalizeAllAssessmentAttempts(assessmentId,reason="TEACHER_CLOSE"){
  requireAssessmentCloud();
  const attempts=await firebase.fsMod.getDocs(firebase.fsMod.collection(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"attempts"));
  const pending=attempts.docs.filter(d=>d.data().status!=="SUBMITTED");
  const result=await finalizeAttemptRefs(pending.map(d=>({ref:d.ref,doc:d,deadline:0})),reason);
  return {...result,totalPending:pending.length};
}

export async function getAssessmentRecoverySnapshots(assessmentId){
  requireAssessmentCloud();
  const snap=await firebase.fsMod.getDocs(firebase.fsMod.collection(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"sessions"));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function cleanupAssessmentChildrenBestEffort_(assessmentId){
  const id=String(assessmentId);
  const base=["publicCourses",activeProjectId,"assessments",id];
  try{
    const [attempts,sessions]=await Promise.all([
      firebase.fsMod.getDocs(firebase.fsMod.collection(db,...base,"attempts")),
      firebase.fsMod.getDocs(firebase.fsMod.collection(db,...base,"sessions"))
    ]);
    const children=[...attempts.docs,...sessions.docs];
    for(let i=0;i<children.length;i+=400){
      const childBatch=firebase.fsMod.writeBatch(db);
      children.slice(i,i+400).forEach(d=>childBatch.delete(d.ref));
      await commitAssessmentBatch_(childBatch,"평가 하위 기록 정리");
    }
  }catch(err){
    // 상위 평가 문서가 이미 삭제되었으므로 하위 정리 실패가 평가 목록/학생 입장을 되살리지는 않는다.
    console.warn("평가 하위 기록 백그라운드 정리 실패",id,err);
  }
}

export async function deleteAssessment(assessmentId){
  requireAssessmentCloud();
  const id=String(assessmentId);
  const privatePath=["users",currentUser.uid,"courseProjects",activeProjectId,"assessments",id];
  const publicPath=["publicCourses",activeProjectId,"assessments",id];
  const contentPath=["publicCourses",activeProjectId,"assessments",id,"content","main"];

  // v3.2.1: 삭제도 REST commit을 우선 사용해 SDK pending-write queue와 분리한다.
  // 상위 문서가 실제 서버에서 삭제된 뒤에만 성공을 반환한다.
  const writes=[restDeleteWrite_(contentPath),restDeleteWrite_(publicPath),restDeleteWrite_(privatePath)];
  const sdkFactory=()=>{
    const batch=firebase.fsMod.writeBatch(db);
    batch.delete(firebase.fsMod.doc(db,...contentPath));
    batch.delete(firebase.fsMod.doc(db,...publicPath));
    batch.delete(firebase.fsMod.doc(db,...privatePath));
    return batch;
  };
  const r=await commitAssessmentLifecycle_(writes,"평가 삭제",sdkFactory);
  cleanupAssessmentChildrenBestEffort_(id);
  return {id,serverDeleted:true,transport:r.transport};
}


export function watchAssessmentAttempts(assessmentId,callback){
  requireAssessmentCloud();
  stopAttemptListener();
  if(!assessmentId){ callback?.([]); return ()=>{}; }
  unsubscribeAttempts=firebase.fsMod.onSnapshot(
    firebase.fsMod.collection(db,"publicCourses",activeProjectId,"assessments",String(assessmentId),"attempts"),
    snap=>callback?.(snap.docs.map(d=>({id:d.id,...d.data()}))),
    err=>{ console.error("attempt listener error",err); callback?.([],err); }
  );
  return ()=>stopAttemptListener();
}

export async function resetAssessmentRun(assessmentId){
  requireAssessmentCloud();
  const base=["publicCourses",activeProjectId,"assessments",String(assessmentId)];
  const [attempts,sessions]=await Promise.all([
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,...base,"attempts")),
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,...base,"sessions"))
  ]);
  const docs=[...attempts.docs,...sessions.docs];
  for(let i=0;i<docs.length;i+=400){
    const batch=firebase.fsMod.writeBatch(db);
    docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
  return attempts.size;
}

export async function archiveProject(projectId){
  const p=currentProjects.find(x=>x.id===projectId);
  if(!p) return;
  await saveProject({...p,status:"ARCHIVED"});
}
export function getProjects(){ return currentProjects.map(cloneProject); }
