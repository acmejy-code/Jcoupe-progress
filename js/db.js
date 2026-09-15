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
let unsubscribeMaterials = null;
let onRecordsCb = null;
let onMaterialsCb = null;
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
function stopProjectListeners(){ stopRecordListener(); stopMaterialListener(); }

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

function startCloudProjectListeners(){
  startCloudRecordListener();
  startCloudMaterialListener();
}

export async function initDataLayer({onRecords,onMaterials,onProjects,onAuth}){
  onRecordsCb=onRecords;
  onMaterialsCb=onMaterials;
  onProjectsCb=onProjects;
  onAuthCb=onAuth;

  ensureLocalSeedProjects();
  const legacyLocalCount=migrateLegacyLocalIfNeeded();
  emitLocalProjects();
  emitLocalRecords();
  emitLocalMaterials();
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
  else { emitLocalRecords(); emitLocalMaterials(); }
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
  copy.targetClasses=Array.isArray(copy.targetClasses)?copy.targetClasses.map(String):["ALL"];
  if(copy.targetClasses.length===0) copy.targetClasses=["ALL"];
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
    targetClasses: Array.isArray(material.targetClasses)?material.targetClasses.map(String):["ALL"],
    createdAt: String(material.createdAt||""),
    updatedAt: String(material.updatedAt||"")
  };
}
function compareRecords(a,b){
  return String(a.date||"").localeCompare(String(b.date||"")) || Number(a.period||0)-Number(b.period||0);
}

export async function publishStudentPortalData(projectId=activeProjectId){
  if(storageMode()!=="cloud" || !currentUser || !firebase || !db){
    throw new Error("학생 포털 발행은 Google 로그인 후 사용할 수 있습니다.");
  }
  const project=currentProjects.find(p=>String(p.id)===String(projectId));
  if(!project) throw new Error("발행할 수업 프로젝트를 찾을 수 없습니다.");

  const [recordSnap,materialSnap]=await Promise.all([
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",projectId,"lessonRecords")),
    firebase.fsMod.getDocs(firebase.fsMod.collection(db,"users",currentUser.uid,"courseProjects",projectId,"materials"))
  ]);
  const sourceRows=recordSnap.docs.map(d=>({id:d.id,...d.data()}));
  const visibleRows=sourceRows
    .filter(r=>r.status!=="cancelled" && r.status!=="schedule_hidden" && r.studentVisible!==false)
    .sort(compareRecords);
  const visibleMaterials=materialSnap.docs
    .map(d=>({id:d.id,...d.data()}))
    .filter(m=>m.isPublished!==false && String(m.title||"").trim() && String(m.fileId||"").trim())
    .sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")));

  const publicRef=firebase.fsMod.doc(db,"publicCourses",projectId);
  const classesRef=firebase.fsMod.collection(db,"publicCourses",projectId,"classes");
  const materialsRef=firebase.fsMod.collection(db,"publicCourses",projectId,"materials");
  const [existingClassSnap,existingMaterialSnap]=await Promise.all([
    firebase.fsMod.getDocs(classesRef),
    firebase.fsMod.getDocs(materialsRef)
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
    publishedRecordCount: visibleRows.length,
    publishedMaterialCount: visibleMaterials.length,
    updatedAt: firebase.fsMod.serverTimestamp()
  },{merge:true});

  existingClassSnap.docs.forEach(d=>batch.delete(d.ref));
  existingMaterialSnap.docs.forEach(d=>batch.delete(d.ref));

  for(const className of (project.classes||[])){
    const classRows=visibleRows.filter(r=>String(r.className)===String(className));
    if(!classRows.length) continue;
    const current=publicRecord(classRows[classRows.length-1]);
    const recent=classRows.slice(-10).reverse().map(publicRecord);
    batch.set(firebase.fsMod.doc(db,"publicCourses",projectId,"classes",String(className)),{
      className: String(className), current, recent, updatedAt: firebase.fsMod.serverTimestamp()
    });
  }
  for(const material of visibleMaterials){
    batch.set(
      firebase.fsMod.doc(db,"publicCourses",projectId,"materials",String(material.id)),
      publicMaterial(material)
    );
  }

  await batch.commit();
  return {
    projectId,
    publishedRecordCount: visibleRows.length,
    publishedMaterialCount: visibleMaterials.length,
    classCount: (project.classes||[]).filter(c=>visibleRows.some(r=>String(r.className)===String(c))).length
  };
}

export function studentPortalUrl(projectId=activeProjectId){
  return `https://acmejy-code.github.io/Jcoupe-class-portal/?project=${encodeURIComponent(projectId)}`;
}

export async function archiveProject(projectId){
  const p=currentProjects.find(x=>x.id===projectId);
  if(!p) return;
  await saveProject({...p,status:"ARCHIVED"});
}
export function getProjects(){ return currentProjects.map(cloneProject); }
