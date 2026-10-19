import { readLargeDraft, writeLargeDraft } from "@/lib/design-drafts";
import { useEffect, useRef, useState } from "react";
import { documentFingerprint, type DesignDocument } from "@shared/design-document";
export type SaveStatus = "Saving" | "Saved" | "Saved on this device" | "Offline" | "Sign-in required" | "Save failed" | "Conflict";
const tabId = () => { let id=sessionStorage.getItem("designDraftTabId"); if (!id) { id=crypto.randomUUID(); sessionStorage.setItem("designDraftTabId",id); } return id; };
export function draftKey(userId?: string | null, projectId?: string | null) {
  return `victron:draft:v1:${encodeURIComponent(userId ?? "anonymous")}:${encodeURIComponent(projectId ?? "untitled")}:${tabId()}`;
}
export function readDraft(userId?: string | null,projectId?: string | null) {
  try { const project=projectId ?? sessionStorage.getItem(`draftProject:${userId ?? "anonymous"}`); const raw=localStorage.getItem(draftKey(userId,project)); return raw ? JSON.parse(raw).document : null; } catch { return null; }
}
export async function readDraftAsync(userId?:string|null,projectId?:string|null) {
  const project=projectId ?? sessionStorage.getItem(`draftProject:${userId ?? "anonymous"}`);
  try { return await readLargeDraft(draftKey(userId,project)) ?? readDraft(userId,project); }
  catch { return readDraft(userId,project); }
}
export function autosaveFingerprint(document:DesignDocument) {
  return documentFingerprint({...document,metadata:{...document.metadata,cloudVersion:undefined,cloudSavedFingerprint:undefined}});
}
export function useCloudAutosave({document,userId,onSaved,paused=false}:{document:DesignDocument;userId?:string|null;onSaved:(design:any)=>void;paused?:boolean}) {
  const [localFailed,setLocalFailed]=useState(false);
  const [status,setStatus]=useState<SaveStatus>("Saved on this device");
  const [conflict,setConflict]=useState<any>(null);
  const [retryCount,retry]=useState(0);
  const latest=useRef({document,userId,onSaved,paused}); latest.current={document,userId,onSaved,paused};
  const inflight=useRef(false);
  const unauthorized=useRef(false);
  const saved=useRef<string|null>(null);
  const pending=useRef<{fingerprint:string;requestId:string;expectedVersion:number;document:DesignDocument}|null>(null);
  const scope=`${userId ?? "anonymous"}:${document.metadata.id ?? "untitled"}`;
  useEffect(()=>{ saved.current=null; pending.current=null; unauthorized.current=false; setConflict(null); },[scope]);
  useEffect(()=>{
    let timeout:ReturnType<typeof setTimeout>;
    const saveLocal=()=>{
      if(document.metadata.cloudOwnerId && document.metadata.cloudOwnerId !== userId) return;
      const key=draftKey(userId,document.metadata.id);
      try { sessionStorage.setItem(`draftProject:${userId ?? "anonymous"}`,document.metadata.id ?? "untitled"); } catch { /* Recovery still uses its scoped key. */ }
      let smallSaved=false;
      try {localStorage.setItem(key,JSON.stringify({document,savedAt:new Date().toISOString()}));smallSaved=true;}catch { /* IndexedDB supports larger designs. */ }
      writeLargeDraft(key,document).then(()=>setLocalFailed(false)).catch(()=>{setLocalFailed(!smallSaved);});
    };
    timeout=setTimeout(saveLocal,200);window.addEventListener("beforeunload",saveLocal);
    return ()=>{clearTimeout(timeout);window.removeEventListener("beforeunload",saveLocal);};
  },[document,userId]);
  useEffect(()=>{const online=()=>retry(n=>n+1);window.addEventListener("online",online);return()=>window.removeEventListener("online",online);},[]);
  useEffect(()=>{
    if (paused || conflict || inflight.current || unauthorized.current) return;
    if (!userId || !document.metadata.id || document.metadata.cloudOwnerId !== userId) { setStatus("Saved on this device"); return; }
    const version=Number(document.metadata.cloudVersion);
    if (!version) { setStatus("Save failed");return; }
    // A successful save updates metadata; these bookkeeping fields aren't edits.
    const fingerprint=autosaveFingerprint(document);
    if (fingerprint === saved.current || fingerprint === document.metadata.cloudSavedFingerprint) {setStatus("Saved");return;}
    if (!navigator.onLine) {setStatus("Offline");return;}
    const timer=setTimeout(async()=>{
      if (inflight.current) return;
      inflight.current=true;setStatus("Saving");
      if (!pending.current) pending.current={fingerprint,requestId:crypto.randomUUID(),expectedVersion:version,document};
      const attempt=pending.current;
      let retryLater=false;
      try {
        const response=await fetch(`/api/designs/${document.metadata.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...attempt,source:"autosave"})});
        const result=await response.json();
        if (latest.current.userId !== userId || latest.current.document.metadata.id !== document.metadata.id) return;
        if(response.status===401){unauthorized.current=true;setStatus("Sign-in required");return;}
        if(response.status===409){setConflict(result.current);setStatus("Conflict");return;}
        if(!response.ok) throw new Error(result.error);
        saved.current=attempt.fingerprint;pending.current=null;setStatus("Saved");
        latest.current.onSaved({...result,cloudSavedFingerprint:attempt.fingerprint});
      }catch {setStatus(navigator.onLine?"Save failed":"Offline");retryLater=true;}
      finally {inflight.current=false;if(retryLater)setTimeout(()=>retry(n=>n+1),Math.min(30000,2000*2**Math.min(retryCount,4)));else retry(n=>n+1);}
    },2000);
    return()=>clearTimeout(timer);
  },[document,userId,paused,conflict,retryCount]);
  return {status:localFailed ? "Save failed" as SaveStatus : status,conflict,retry:()=>{unauthorized.current=false;setConflict(null);retry(n=>n+1);},clearConflict:()=>{setConflict(null);pending.current=null;}};
}
