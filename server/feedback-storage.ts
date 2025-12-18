import { db } from "./db";
import { feedback } from "@shared/schema";
import { eq, desc, count } from "drizzle-orm";

export interface FeedbackData {
  message: string;
  email?: string;
  userAgent: string;
  state: {
    components: any[];
    wires: any[];
    systemVoltage: number;
  };
  screenshot?: string;
}

class FeedbackStorage {
  async create(data: FeedbackData) {
    const [result] = await db.insert(feedback)
      .values({
        message: data.message,
        email: data.email,
        userAgent: data.userAgent,
        state: data.state,
        screenshot: data.screenshot,
      })
      .returning();

    return result;
  }

  async getAll() {
    return db.select()
      .from(feedback)
      .orderBy(desc(feedback.createdAt));
  }

  async getById(id: string) {
    const [result] = await db.select()
      .from(feedback)
      .where(eq(feedback.id, id));

    return result || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(feedback)
      .where(eq(feedback.id, id))
      .returning({ id: feedback.id });

    return result.length > 0;
  }

  async count(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(feedback);
    return result?.count || 0;
  }
}

export const feedbackStorage = new FeedbackStorage();
