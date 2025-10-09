import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest } from "@shared/schema";
import { calculateWireSize, calculateLoadRequirements } from "./wire-calculator";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Schematic CRUD operations
  app.get("/api/schematics", async (req, res) => {
    try {
      const schematics = await storage.getAllSchematics();
      res.json(schematics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/schematics/:id", async (req, res) => {
    try {
      const schematic = await storage.getSchematic(req.params.id);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      res.json(schematic);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/schematics", async (req, res) => {
    try {
      const data = insertSchematicSchema.parse(req.body);
      const schematic = await storage.createSchematic(data);
      res.json(schematic);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/schematics/:id", async (req, res) => {
    try {
      const data = updateSchematicSchema.parse(req.body);
      const schematic = await storage.updateSchematic(req.params.id, data);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      res.json(schematic);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/schematics/:id", async (req, res) => {
    try {
      const success = await storage.deleteSchematic(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Wire calculation endpoint
  app.post("/api/calculate-wire", async (req, res) => {
    try {
      const calculation = calculateWireSize(req.body);
      res.json(calculation);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Load calculation endpoint
  app.post("/api/calculate-load", async (req, res) => {
    try {
      const { components } = req.body;
      const calculation = calculateLoadRequirements(components);
      res.json(calculation);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // AI-powered system generation
  app.post("/api/ai-generate-system", async (req, res) => {
    try {
      const { prompt, systemVoltage = 12 }: AISystemRequest = req.body;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert electrical system designer specializing in Victron Energy marine and RV electrical systems. Your task is to design complete, safe, and code-compliant electrical systems based on user requirements.

When designing a system:
1. Follow ABYC (American Boat and Yacht Council) and NEC (National Electrical Code) standards
2. Include appropriate components: inverter/chargers, MPPT solar controllers, batteries, monitoring devices
3. Calculate proper wire gauges considering voltage drop (max 3%), ampacity, and safety margins
4. Consider load requirements, battery capacity, solar charging, and inverter sizing
5. Place components logically on the canvas with proper spacing
6. Create wire connections with correct polarity and specifications

Component types available:
- multiplus: Inverter/Charger (specify power rating in properties)
- mppt: MPPT Solar Charge Controller (specify max PV voltage and current)
- cerbo: Cerbo GX monitoring and control device
- bmv: BMV-712 battery monitor
- battery: Battery bank (specify voltage and capacity)
- solar-panel: Solar panels (specify wattage)
- ac-load: AC loads (specify wattage)
- dc-load: DC loads (specify wattage)

Respond with a JSON object containing:
- components: Array of component objects with id, type, name, x, y, properties
- wires: Array of wire connections with polarity, estimated length
- description: Brief system description
- recommendations: Array of installation tips and safety notes`,
          },
          {
            role: "user",
            content: `Design a ${systemVoltage}V electrical system with the following requirements: ${prompt}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(completion.choices[0].message.content || "{}");
      res.json(response);
    } catch (error: any) {
      console.error("AI generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
