import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESIGNS_DIR = path.join(__dirname, "..", "user-designs");

export interface SavedDesign {
  id: string;
  userId: string;
  name: string;
  description?: string;
  systemVoltage: number;
  components: any[];
  wires: any[];
  thumbnail?: string; // base64 screenshot
  createdAt: string;
  updatedAt: string;
}

class UserDesignsStorage {
  constructor() {
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(DESIGNS_DIR)) {
      fs.mkdirSync(DESIGNS_DIR, { recursive: true });
    }
  }

  private getUserFile(userId: string): string {
    // Sanitize userId to be safe for filenames
    const safeId = userId.replace(/[^a-zA-Z0-9-_]/g, "_");
    return path.join(DESIGNS_DIR, `${safeId}.json`);
  }

  private readUserDesigns(userId: string): SavedDesign[] {
    const filePath = this.getUserFile(userId);
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error reading user designs:", error);
      return [];
    }
  }

  private writeUserDesigns(userId: string, designs: SavedDesign[]) {
    const filePath = this.getUserFile(userId);
    fs.writeFileSync(filePath, JSON.stringify(designs, null, 2));
  }

  async create(userId: string, data: {
    name: string;
    description?: string;
    systemVoltage: number;
    components: any[];
    wires: any[];
    thumbnail?: string;
  }): Promise<SavedDesign> {
    const now = new Date().toISOString();
    const design: SavedDesign = {
      id: randomUUID(),
      userId,
      name: data.name,
      description: data.description,
      systemVoltage: data.systemVoltage,
      components: data.components,
      wires: data.wires,
      thumbnail: data.thumbnail,
      createdAt: now,
      updatedAt: now,
    };

    const designs = this.readUserDesigns(userId);
    designs.push(design);
    this.writeUserDesigns(userId, designs);

    return design;
  }

  async update(userId: string, designId: string, data: {
    name?: string;
    description?: string;
    systemVoltage?: number;
    components?: any[];
    wires?: any[];
    thumbnail?: string;
  }): Promise<SavedDesign | null> {
    const designs = this.readUserDesigns(userId);
    const index = designs.findIndex(d => d.id === designId);
    
    if (index === -1) {
      return null;
    }

    const updated: SavedDesign = {
      ...designs[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    
    designs[index] = updated;
    this.writeUserDesigns(userId, designs);

    return updated;
  }

  async getAll(userId: string): Promise<Omit<SavedDesign, 'components' | 'wires' | 'thumbnail'>[]> {
    const designs = this.readUserDesigns(userId);
    // Return list without heavy data (components, wires, thumbnail)
    return designs
      .map(({ components, wires, thumbnail, ...rest }) => ({
        ...rest,
        componentCount: components.length,
        wireCount: wires.length,
        hasThumbnail: !!thumbnail,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getById(userId: string, designId: string): Promise<SavedDesign | null> {
    const designs = this.readUserDesigns(userId);
    return designs.find(d => d.id === designId) || null;
  }

  async delete(userId: string, designId: string): Promise<boolean> {
    const designs = this.readUserDesigns(userId);
    const filtered = designs.filter(d => d.id !== designId);
    
    if (filtered.length === designs.length) {
      return false;
    }

    this.writeUserDesigns(userId, filtered);
    return true;
  }

  async count(userId: string): Promise<number> {
    return this.readUserDesigns(userId).length;
  }
}

export const userDesignsStorage = new UserDesignsStorage();
