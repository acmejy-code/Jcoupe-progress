import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { DEFAULT_PROJECT_ID, SEED_PROJECTS, cloneProject, normalizeProject } from "./project-data.js";

const PROJECTS_LOCAL_KEY = "jcoop_course_projects_v2";
const ACTIVE_PROJECT_KEY = "jcoop_active_project_v2";
const LEGACY_LOCAL_KEY = "doktogul_progress_v1_records";

let firebase = null;
let auth = null;
let db = null;
let currentUser = null;
let unsubscribeRecords = null;
let onRecordsCb = null;
let onProjectsCb = null;
let onAuthCb = null;
let activeProjectId = localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
let currentProjects = [];

const recordsLocalKey = projectId => `jcoop_course_records_v2_${projectId}`;

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
function saveLocalRecords(projectId, rows){ writeJson(recordsLocalKey(projectId), rows); }

function emitLocalProjects(){
  currentProjects = ensureLocalSeedProjects();
  onProjectsCb?.(currentProjects, "local");
}
function emitLocalRecords(){
  onRecordsCb?.(getLocalRecords(activeProjectId), "local", activeProjectId);
}

async function ensureCloudSeedProjects(){
  for(const seed of SEED_PROJECTS){
    const ref = firebase.fsMod.doc(db, "users", currentUser.uid, "courseProjects", seed.id);
    const snap = await firebase.fsMod.getDoc(ref);
    if(!snap.exists()){
      await firebase.fsMod.setDoc(ref, normalizeProject(seed), {merge:true});
    }
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
  if(unsubscribeRecords){
    unsubscribeRecords();
    unsubscribeRecords = null;
  }
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
      console.error("Firestore snapshot error:", err);
      onAuthCb?.({configured:true,user:currentUser,mode:"cloud",error:err.message});
    }
  );
}

export async function initDataLayer({onRecords,onProjects,onAuth}){
  onRecordsCb=onRecords;
  onProjectsCb=onProjects;
  onAuthCb=onAuth;

  ensureLocalSeedProjects();
  const legacyLocalCount=migrateLegacyLocalIfNeeded();
  emitLocalProjects();
  emitLocalRecords();
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
      stopRecordListener();

      if(!user){
        emitLocalProjects();
        emitLocalRecords();
        onAuthCb?.({configured:true,user:null,mode:"local"});
        return;
      }

      try{
        await ensureCloudSeedProjects();
        await loadCloudProjects();
        const migrated=await migrateLegacyCloudIfNeeded();
        startCloudRecordListener();
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
  if(storageMode()==="cloud"){
    startCloudRecordListener();
  }else{
    emitLocalRecords();
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

export async function archiveProject(projectId){
  const p=currentProjects.find(x=>x.id===projectId);
  if(!p) return;
  await saveProject({...p,status:"ARCHIVED"});
}

export function getProjects(){ return currentProjects.map(cloneProject); }
