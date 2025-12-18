import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_DIR = path.join(__dirname, "..", "feedback-data");
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, "feedback.json");

export interface Feedback {
  id: string;
  message: string;
  email?: string;
  userAgent: string;
  timestamp: string;
  state: {
    components: any[];
    wires: any[];
    systemVoltage: number;
  };
  screenshot?: string; // base64 encoded image
}

class FeedbackStorage {
  constructor() {
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(FEEDBACK_DIR)) {
      fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
    }
    if (!fs.existsSync(FEEDBACK_FILE)) {
      fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([], null, 2));
    }
  }

  private readFeedback(): Feedback[] {
    try {
      const data = fs.readFileSync(FEEDBACK_FILE, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error reading feedback:", error);
      return [];
    }
  }

  private writeFeedback(feedback: Feedback[]) {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
  }

  async create(data: Omit<Feedback, "id" | "timestamp">): Promise<Feedback> {
    const feedback: Feedback = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    };

    const allFeedback = this.readFeedback();
    allFeedback.push(feedback);
    this.writeFeedback(allFeedback);

    return feedback;
  }

  async getAll(): Promise<Feedback[]> {
    return this.readFeedback().sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async getById(id: string): Promise<Feedback | undefined> {
    const allFeedback = this.readFeedback();
    return allFeedback.find(f => f.id === id);
  }

  async delete(id: string): Promise<boolean> {
    const allFeedback = this.readFeedback();
    const filtered = allFeedback.filter(f => f.id !== id);
    
    if (filtered.length === allFeedback.length) {
      return false; // Nothing was deleted
    }

    this.writeFeedback(filtered);
    return true;
  }

  async count(): Promise<number> {
    return this.readFeedback().length;
  }
}

export const feedbackStorage = new FeedbackStorage();
