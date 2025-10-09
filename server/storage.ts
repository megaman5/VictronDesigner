import { type User, type InsertUser, type Schematic, type InsertSchematic, type UpdateSchematic } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Schematic operations
  getSchematic(id: string): Promise<Schematic | undefined>;
  getAllSchematics(): Promise<Schematic[]>;
  createSchematic(schematic: InsertSchematic): Promise<Schematic>;
  updateSchematic(id: string, schematic: UpdateSchematic): Promise<Schematic | undefined>;
  deleteSchematic(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private schematics: Map<string, Schematic>;

  constructor() {
    this.users = new Map();
    this.schematics = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getSchematic(id: string): Promise<Schematic | undefined> {
    return this.schematics.get(id);
  }

  async getAllSchematics(): Promise<Schematic[]> {
    return Array.from(this.schematics.values());
  }

  async createSchematic(insertSchematic: InsertSchematic): Promise<Schematic> {
    const id = randomUUID();
    const now = new Date();
    const schematic: Schematic = {
      id,
      name: insertSchematic.name,
      description: insertSchematic.description ?? null,
      systemVoltage: insertSchematic.systemVoltage ?? 12,
      components: insertSchematic.components ?? [],
      wires: insertSchematic.wires ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.schematics.set(id, schematic);
    return schematic;
  }

  async updateSchematic(id: string, updateSchematic: UpdateSchematic): Promise<Schematic | undefined> {
    const existing = this.schematics.get(id);
    if (!existing) return undefined;

    const updated: Schematic = {
      ...existing,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      name: updateSchematic.name ?? existing.name,
      description: updateSchematic.description !== undefined ? updateSchematic.description : existing.description,
      systemVoltage: updateSchematic.systemVoltage ?? existing.systemVoltage,
      components: updateSchematic.components ?? existing.components,
      wires: updateSchematic.wires ?? existing.wires,
    };
    this.schematics.set(id, updated);
    return updated;
  }

  async deleteSchematic(id: string): Promise<boolean> {
    return this.schematics.delete(id);
  }
}

export const storage = new MemStorage();
