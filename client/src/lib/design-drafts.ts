import type { DesignDocument } from "@shared/design-document";
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("victron-design-drafts",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("drafts");
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function writeLargeDraft(key:string,document:DesignDocument) {
  const db=await database();
  try { await new Promise<void>((resolve,reject)=>{const transaction=db.transaction("drafts","readwrite");transaction.objectStore("drafts").put({document,savedAt:new Date().toISOString()},key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);}); }
  finally {db.close();}
}
export async function readLargeDraft(key:string) {
  const db=await database();
  try {return await new Promise<any>((resolve,reject)=>{const request=db.transaction("drafts").objectStore("drafts").get(key);request.onsuccess=()=>resolve(request.result?.document ?? null);request.onerror=()=>reject(request.error);});}
  finally {db.close();}
}
