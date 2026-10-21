import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { userDesignsStorage, DesignConflict, type SavedDesign } from "./user-designs-storage";
import type { AuthUser } from "./auth";
import { loadDesignDocument } from "@shared/design-document";
const writeSchema = z.object({
  requestId:z.string().min(8).max(200), expectedVersion:z.number().int().positive().optional(),
  source:z.enum(["manual","autosave","ai","restore"]).default("manual"),
  thumbnail:z.string().max(8_000_000).optional(), document:z.record(z.unknown()).optional(),
}).passthrough();
export function designResponse(design: SavedDesign) {
  return {...design, ...(design.document ?? {}), id:design.id, name:design.name,
    description:design.description, metadata:{...design.document?.metadata,id:design.id,name:design.name,description:design.description ?? undefined},
    version:design.version, schemaVersion:design.document?.schemaVersion ?? 1, calculationOptions:design.document?.calculationOptions ?? {}};
}
export function registerDesignRoutes(app:Express, requireAuth:RequestHandler) {
  const run = (fn: (req:any,res:any,userId:string)=>Promise<unknown>):RequestHandler => async (req,res) => {
    try { await fn(req,res,(req.user as AuthUser).id); }
    catch (error) {
      if (error instanceof DesignConflict) { res.status(409).json({error:error.message,current:designResponse(error.current)}); return; }
      if (error instanceof z.ZodError) { res.status(400).json({error:"Invalid design",issues:error.issues}); return; }
      console.error("Design persistence failed",error instanceof Error ? error.name : "unknown");
      res.status(500).json({error:"Unable to save or load this design. Your local changes are kept."});
    }
  };
  app.get("/api/designs",requireAuth,run(async (_req,res,id)=>res.json(await userDesignsStorage.getAll(id))));
  app.get("/api/designs/:id",requireAuth,run(async(req,res,id)=>{
    const d=await userDesignsStorage.getById(id,req.params.id);
    return d ? res.json(designResponse(d)) : res.status(404).json({error:"Design not found"});
  }));
  app.post("/api/designs",requireAuth,run(async(req,res,id)=>{
    const body=writeSchema.parse(req.body);
    const document=loadDesignDocument(body.document ?? body);
    if (!document.metadata.name.trim()) return res.status(400).json({error:"Design name is required"});
    document.metadata.name=document.metadata.name.trim(); delete document.metadata.id;
    const d=await userDesignsStorage.create(id,{document,requestId:body.requestId,thumbnail:body.thumbnail});
    return res.json(designResponse(d));
  }));
  app.put("/api/designs/:id",requireAuth,run(async(req,res,id)=>{
    const body=writeSchema.parse(req.body);
    if (!body.expectedVersion) return res.status(428).json({error:"Reload this design before saving; a cloud version is required."});
    const existing=await userDesignsStorage.getById(id,req.params.id);
    if (!existing) return res.status(404).json({error:"Design not found"});
    const base=designResponse(existing);
    const document=loadDesignDocument(body.document ?? {...base,...body,metadata:{...base.metadata,name:typeof body.name === "string" ? body.name:base.name,description:typeof body.description === "string" ? body.description:base.description ?? undefined}});
    document.metadata.id=req.params.id;
    if (!document.metadata.name.trim()) return res.status(400).json({error:"Design name is required"});
    const d=await userDesignsStorage.update(id,req.params.id,{document,expectedVersion:body.expectedVersion,requestId:body.requestId,source:body.source,thumbnail:body.thumbnail});
    return d ? res.json(designResponse(d)) : res.status(404).json({error:"Design not found"});
  }));
  app.get("/api/designs/:id/revisions",requireAuth,run(async(req,res,id)=>{
    if (!await userDesignsStorage.getById(id,req.params.id)) return res.status(404).json({error:"Design not found"});
    return res.json(await userDesignsStorage.revisions(id,req.params.id));
  }));
  app.get("/api/designs/:id/revisions/:revisionId",requireAuth,run(async(req,res,id)=>{
    const r=await userDesignsStorage.revision(id,req.params.id,req.params.revisionId);
    return r ? res.json({...r,snapshot:designResponse(r.snapshot)}) : res.status(404).json({error:"Revision not found"});
  }));
  app.post("/api/designs/:id/revisions/:revisionId/restore",requireAuth,run(async(req,res,id)=>{
    const body=writeSchema.parse(req.body);
    if (!body.expectedVersion) return res.status(428).json({error:"A cloud version is required"});
    const r=await userDesignsStorage.revision(id,req.params.id,req.params.revisionId);
    if (!r) return res.status(404).json({error:"Revision not found"});
    const document=loadDesignDocument(designResponse(r.snapshot));
    const d=await userDesignsStorage.update(id,req.params.id,{document,expectedVersion:body.expectedVersion,requestId:body.requestId,source:"restore"});
    return d ? res.json(designResponse(d)) : res.status(404).json({error:"Design not found"});
  }));
  app.delete("/api/designs/:id",requireAuth,run(async(req,res,id)=>
    (await userDesignsStorage.delete(id,req.params.id)) ? res.json({success:true}) : res.status(404).json({error:"Design not found"})));
}
