import { db } from "./db";
import { customComponents } from "@shared/schema";
import type {
  CustomComponentDefinition,
  InsertCustomComponentDefinition,
  UpdateCustomComponentDefinition,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

/**
 * CRUD for user-defined ("Phase 1") custom component definitions.
 * Owner-scoped throughout - every method takes the owner's id and only
 * touches rows belonging to that owner, mirroring userDesignsStorage.
 */
class CustomComponentsStorage {
  async getAllForOwner(ownerId: string): Promise<CustomComponentDefinition[]> {
    return db
      .select()
      .from(customComponents)
      .where(eq(customComponents.ownerId, ownerId))
      .orderBy(desc(customComponents.updatedAt));
  }

  async getById(ownerId: string, id: string): Promise<CustomComponentDefinition | null> {
    const [row] = await db
      .select()
      .from(customComponents)
      .where(and(eq(customComponents.id, id), eq(customComponents.ownerId, ownerId)));

    return row || null;
  }

  async create(
    ownerId: string,
    data: Omit<InsertCustomComponentDefinition, "ownerId">
  ): Promise<CustomComponentDefinition> {
    const [row] = await db
      .insert(customComponents)
      .values({ ...data, ownerId })
      .returning();

    return row;
  }

  async update(
    ownerId: string,
    id: string,
    data: UpdateCustomComponentDefinition
  ): Promise<CustomComponentDefinition | null> {
    const [row] = await db
      .update(customComponents)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(customComponents.id, id), eq(customComponents.ownerId, ownerId)))
      .returning();

    return row || null;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(customComponents)
      .where(and(eq(customComponents.id, id), eq(customComponents.ownerId, ownerId)))
      .returning({ id: customComponents.id });

    return result.length > 0;
  }
}

export const customComponentsStorage = new CustomComponentsStorage();
