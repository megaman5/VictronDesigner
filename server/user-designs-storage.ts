import { db } from "./db";
import { userDesigns } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface SavedDesign {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  systemVoltage: number;
  components: any[];
  wires: any[];
  thumbnail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class UserDesignsStorage {
  async create(userId: string, data: {
    name: string;
    description?: string;
    systemVoltage: number;
    components: any[];
    wires: any[];
    thumbnail?: string;
  }): Promise<SavedDesign> {
    const [design] = await db.insert(userDesigns)
      .values({
        userId,
        name: data.name,
        description: data.description,
        systemVoltage: data.systemVoltage,
        components: data.components,
        wires: data.wires,
        thumbnail: data.thumbnail,
      })
      .returning();

    return design as SavedDesign;
  }

  async update(userId: string, designId: string, data: {
    name?: string;
    description?: string;
    systemVoltage?: number;
    components?: any[];
    wires?: any[];
    thumbnail?: string;
  }): Promise<SavedDesign | null> {
    const updateData: any = { updatedAt: new Date() };
    
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.systemVoltage !== undefined) updateData.systemVoltage = data.systemVoltage;
    if (data.components !== undefined) updateData.components = data.components;
    if (data.wires !== undefined) updateData.wires = data.wires;
    if (data.thumbnail !== undefined) updateData.thumbnail = data.thumbnail;

    const [design] = await db.update(userDesigns)
      .set(updateData)
      .where(and(eq(userDesigns.id, designId), eq(userDesigns.userId, userId)))
      .returning();

    return design as SavedDesign || null;
  }

  async getAll(userId: string): Promise<{
    id: string;
    userId: string;
    name: string;
    description: string | null;
    systemVoltage: number;
    createdAt: Date;
    updatedAt: Date;
    componentCount: number;
    wireCount: number;
    hasThumbnail: boolean;
  }[]> {
    const designs = await db.select({
      id: userDesigns.id,
      userId: userDesigns.userId,
      name: userDesigns.name,
      description: userDesigns.description,
      systemVoltage: userDesigns.systemVoltage,
      createdAt: userDesigns.createdAt,
      updatedAt: userDesigns.updatedAt,
      components: userDesigns.components,
      wires: userDesigns.wires,
      thumbnail: userDesigns.thumbnail,
    })
      .from(userDesigns)
      .where(eq(userDesigns.userId, userId))
      .orderBy(desc(userDesigns.updatedAt));

    return designs.map(d => ({
      id: d.id,
      userId: d.userId,
      name: d.name,
      description: d.description,
      systemVoltage: d.systemVoltage,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      componentCount: Array.isArray(d.components) ? d.components.length : 0,
      wireCount: Array.isArray(d.wires) ? d.wires.length : 0,
      hasThumbnail: !!d.thumbnail,
    }));
  }

  async getById(userId: string, designId: string): Promise<SavedDesign | null> {
    const [design] = await db.select()
      .from(userDesigns)
      .where(and(eq(userDesigns.id, designId), eq(userDesigns.userId, userId)));

    return design as SavedDesign || null;
  }

  async delete(userId: string, designId: string): Promise<boolean> {
    const result = await db.delete(userDesigns)
      .where(and(eq(userDesigns.id, designId), eq(userDesigns.userId, userId)))
      .returning({ id: userDesigns.id });

    return result.length > 0;
  }

  async count(userId: string): Promise<number> {
    const designs = await db.select({ id: userDesigns.id })
      .from(userDesigns)
      .where(eq(userDesigns.userId, userId));

    return designs.length;
  }
}

export const userDesignsStorage = new UserDesignsStorage();
