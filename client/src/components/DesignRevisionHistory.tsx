import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
function RevisionDiagram({snapshot}:{snapshot:any}) {
  const components=snapshot.components ?? [];
  if(!components.length)return <p className="text-xs text-muted-foreground">Empty diagram</p>;
  const minX=Math.min(...components.map((c:any)=>c.x))-20,minY=Math.min(...components.map((c:any)=>c.y))-20;
  const maxX=Math.max(...components.map((c:any)=>c.x))+140,maxY=Math.max(...components.map((c:any)=>c.y))+80;
  const byId=new Map<string,any>(components.map((c:any)=>[c.id,c]));
  return <svg role="img" aria-label="Revision diagram preview" className="w-full h-40 rounded border bg-muted" viewBox={`${minX} ${minY} ${maxX-minX} ${maxY-minY}`}>
    {(snapshot.wires ?? []).map((w:any)=>{const from=byId.get(w.fromComponentId),to=byId.get(w.toComponentId);return from&&to?<line key={w.id} x1={from.x+60} y1={from.y+20} x2={to.x+60} y2={to.y+20} stroke={w.polarity==="positive"||w.polarity==="hot"?"#dc2626":w.polarity==="ground"?"#16a34a":"#64748b"} strokeWidth="2"/>:null;})}
    {components.map((c:any)=><g key={c.id}><rect x={c.x} y={c.y} width="120" height="40" rx="4" fill="#e2e8f0" stroke="#0284c7"/><text x={c.x+60} y={c.y+24} textAnchor="middle" fontSize="10" fill="#0f172a">{c.name || c.type}</text></g>)}
  </svg>;
}
export function DesignRevisionHistory({designId,onLoad,onClose}:{designId:string;onLoad:(design:any)=>void;onClose:()=>void}) {
  const [revisions,setRevisions]=useState<any[]>([]);
  const [preview,setPreview]=useState<any>(null);
  const [current,setCurrent]=useState<any>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    Promise.all([fetch(`/api/designs/${designId}/revisions`),fetch(`/api/designs/${designId}`)]).then(async responses=>{
      if(responses.some(r=>!r.ok))throw new Error("Unable to load revision history. Sign in and try again.");
      const [list,cloud]=await Promise.all(responses.map(r=>r.json()));if(active){setRevisions(list);setCurrent(cloud);}
    }).catch(e=>active&&setError(e.message));return()=>{active=false;};
  },[designId]);
  const inspect=async(id:string)=>{
    setBusy(true);setError("");
    try {const r=await fetch(`/api/designs/${designId}/revisions/${id}`);if(!r.ok)throw new Error("Unable to open revision");setPreview(await r.json());}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const restore=async()=>{
    setBusy(true);setError("");
    try {
      const r=await fetch(`/api/designs/${designId}/revisions/${preview.id}/restore`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:current.version,requestId:crypto.randomUUID()})});
      if(r.status===409)throw new Error("The cloud design changed. Close history and open it again before restoring.");
      if(!r.ok)throw new Error("Unable to restore revision");onLoad(await r.json());onClose();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  return <div className="space-y-3">
    <Button size="sm" variant="outline" onClick={onClose}>Back to designs</Button>
    <p className="text-sm">Restoring creates a new version. The current version remains in history.</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview&&<div className="rounded border p-3 space-y-2"><p className="font-medium">Preview: {preview.snapshot.name} · version {preview.version}</p><p className="text-sm">{preview.snapshot.components.length} components, {preview.snapshot.wires.length} wires, {preview.snapshot.systemVoltage}V</p><RevisionDiagram snapshot={preview.snapshot}/><p className="text-sm">Current: {current?.components.length} components, {current?.wires.length} wires, {current?.systemVoltage}V</p>{preview.snapshot.description&&<p className="text-sm">{preview.snapshot.description}</p>}<Button size="sm" disabled={busy} onClick={restore}>Restore this revision</Button></div>}
    <div className="max-h-64 overflow-auto space-y-2">{revisions.map(r=><div key={r.id} className="flex items-center justify-between gap-2 border-b py-2 text-sm"><span>Version {r.version} · {r.source} · {new Date(r.createdAt).toLocaleString()}</span><Button size="sm" variant="outline" disabled={busy} onClick={()=>inspect(r.id)}>Preview</Button></div>)}</div>
  </div>;
}
