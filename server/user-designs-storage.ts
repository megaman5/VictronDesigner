import { db } from "./db";
import { userDesigns, designRevisions } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { DesignDocument } from "@shared/design-document";

export interface SavedDesign {
  id: string; userId: string; name: string; description: string | null;
  systemVoltage: number; components: any[]; wires: any[]; thumbnail: string | null;
  version: number; document: DesignDocument | null; createdAt: Date; updatedAt: Date;
}
export class DesignConflict extends Error {
  constructor(public current: SavedDesign) { super("This design changed in another session. Your local changes have been kept."); }
}
function hydrate(row: any): SavedDesign {
  const d = row.snapshot ?? row;
  return { ...d, userId: d.userId ?? d.user_id, systemVoltage: d.systemVoltage ?? d.system_voltage,
    createdAt: d.createdAt ?? d.created_at, updatedAt: d.updatedAt ?? d.updated_at };
}
export class UserDesignsStorage {
  async create(userId: string, data: { document: DesignDocument; thumbnail?: string; requestId: string }): Promise<SavedDesign> {
    const d = data.document;
    const result = await db.execute(sql`
      WITH saved AS (
        INSERT INTO user_designs(id,user_id,name,description,system_voltage,components,wires,thumbnail,document,create_request_id)
        VALUES (${randomUUID()},${userId},${d.metadata.name},${d.metadata.description ?? null},${d.systemVoltage},
          ${JSON.stringify(d.components)}::jsonb,${JSON.stringify(d.wires)}::jsonb,${data.thumbnail ?? null},${JSON.stringify(d)}::jsonb,${data.requestId})
        ON CONFLICT (user_id,create_request_id) DO NOTHING RETURNING *
      ), checkpoint AS (
        INSERT INTO design_revisions(design_id,user_id,version,request_id,source,snapshot)
        SELECT id,user_id,version,${data.requestId},'manual',to_jsonb(saved) FROM saved RETURNING snapshot
      ) SELECT snapshot FROM checkpoint`);
    if (result.rows[0]) return hydrate(result.rows[0]);
    const [existing] = await db.select().from(userDesigns).where(and(eq(userDesigns.userId,userId),eq(userDesigns.createRequestId,data.requestId)));
    return existing as SavedDesign;
  }
  async update(userId: string, designId: string, data: { document: DesignDocument; expectedVersion: number; requestId: string; source?: string; thumbnail?: string }): Promise<SavedDesign | null> {
    const previous = await this.requestResult(userId, designId, data.requestId);
    if (previous) return previous;
    const d = data.document;
    const result = await db.execute(sql`
      WITH saved AS (
        UPDATE user_designs SET name=${d.metadata.name},description=${d.metadata.description ?? null},system_voltage=${d.systemVoltage},
          components=${JSON.stringify(d.components)}::jsonb,wires=${JSON.stringify(d.wires)}::jsonb,document=${JSON.stringify(d)}::jsonb,
          thumbnail=COALESCE(${data.thumbnail ?? null},thumbnail),version=version+1,updated_at=now()
        WHERE id=${designId} AND user_id=${userId} AND version=${data.expectedVersion}
        RETURNING *
      ), checkpoint AS (
        INSERT INTO design_revisions(design_id,user_id,version,request_id,source,snapshot)
        SELECT id,user_id,version,${data.requestId},${data.source ?? "manual"},to_jsonb(saved) FROM saved RETURNING snapshot
      ) SELECT snapshot FROM checkpoint`);
    if (result.rows[0]) {
      await this.pruneAutomaticRevisions(userId,designId);
      return hydrate(result.rows[0]);
    }
    // A concurrent retry may have completed while this statement waited on the row lock.
    const retried = await this.requestResult(userId,designId,data.requestId);
    if (retried) return retried;
    const current = await this.getById(userId,designId);
    if (current) throw new DesignConflict(current);
    return null;
  }
  async requestResult(userId: string, designId: string, requestId: string) {
    const [r] = await db.select().from(designRevisions).where(and(eq(designRevisions.userId,userId),eq(designRevisions.designId,designId),eq(designRevisions.requestId,requestId)));
    return r ? hydrate(r) : null;
  }
  async pruneAutomaticRevisions(userId:string,designId:string) {
    // Preserve every manual, AI and restore checkpoint. Automatic recovery is bounded.
    // Pruning is independent of the atomic save: failure must never turn a committed save into a retry.
    try { await db.execute(sql`DELETE FROM design_revisions WHERE user_id=${userId} AND design_id=${designId} AND source='autosave'
      AND id IN (SELECT id FROM (SELECT id,created_at,row_number() OVER (ORDER BY version DESC) AS rank
        FROM design_revisions WHERE user_id=${userId} AND design_id=${designId} AND source='autosave') old
        WHERE rank > 100 OR (rank > 1 AND created_at < now() - interval '30 days'))`); }
    catch { console.warn("Automatic design revision cleanup deferred"); }
  }
  async getAll(userId: string) {
    const designs = await db.select({id:userDesigns.id,userId:userDesigns.userId,name:userDesigns.name,description:userDesigns.description,
      systemVoltage:userDesigns.systemVoltage,version:userDesigns.version,createdAt:userDesigns.createdAt,updatedAt:userDesigns.updatedAt,
      componentCount:sql<number>`jsonb_array_length(${userDesigns.components})`,wireCount:sql<number>`jsonb_array_length(${userDesigns.wires})`,
      hasThumbnail:sql<boolean>`${userDesigns.thumbnail} IS NOT NULL`}).from(userDesigns).where(eq(userDesigns.userId,userId)).orderBy(desc(userDesigns.updatedAt));
    return designs;
  }
  async getById(userId: string, designId: string): Promise<SavedDesign | null> {
    const [d] = await db.select().from(userDesigns).where(and(eq(userDesigns.id,designId),eq(userDesigns.userId,userId)));
    return d as SavedDesign ?? null;
  }
  async revisions(userId: string, designId: string) {
    return db.select({id: designRevisions.id,version:designRevisions.version,source:designRevisions.source,createdAt:designRevisions.createdAt})
      .from(designRevisions).where(and(eq(designRevisions.userId,userId),eq(designRevisions.designId,designId))).orderBy(desc(designRevisions.version)).limit(100);
  }
  async revision(userId: string, designId: string, revisionId: string) {
    const [r] = await db.select().from(designRevisions).where(and(eq(designRevisions.userId,userId),eq(designRevisions.designId,designId),eq(designRevisions.id,revisionId)));
    return r ? {...r, snapshot:hydrate(r)} : null;
  }
  async delete(userId: string,designId: string) {
    const rows = await db.delete(userDesigns).where(and(eq(userDesigns.id,designId),eq(userDesigns.userId,userId))).returning({id:userDesigns.id});
    return rows.length > 0;
  }
  async count(userId: string) { return (await this.getAll(userId)).length; }
}
export const userDesignsStorage = new UserDesignsStorage();
