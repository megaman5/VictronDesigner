import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest } from "@shared/schema";
import { calculateWireSize, calculateLoadRequirements } from "./wire-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
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
            content: `You are an expert electrical system designer specializing in Victron Energy marine and RV electrical systems. Design complete, safe, code-compliant electrical systems.

CANVAS: 2000px wide × 1500px tall

COMPONENT DIMENSIONS & SPACING:
- multiplus: 160×180px
- mppt: 140×150px  
- cerbo: 160×140px
- bmv: 140×140px
- smartshunt: 140×130px
- battery: 160×110px
- solar-panel: 140×160px
- ac-load: 100×100px
- dc-load: 100×100px

LAYOUT RULES (CRITICAL - PREVENT OVERLAP):
1. Minimum 300px horizontal spacing between component centers
2. Minimum 250px vertical spacing between component centers
3. First component starts at x≥100, y≥100
4. Use left-to-right flow: Battery → Controllers → Inverters → Loads
5. Example positions:
   - Battery: x=150, y=400
   - MPPT: x=500, y=400 (350px from battery)
   - Solar: x=500, y=150 (250px above MPPT)
   - MultiPlus: x=850, y=400 (350px from MPPT)
   - Load: x=1200, y=400 (350px from MultiPlus)

COMPONENT TERMINALS (EXACT NAMES):
- multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative", "system-minus", "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "ac-in"
- dc-load: "positive", "negative"

WIRE REQUIREMENTS (ALL FIELDS MANDATORY):
EVERY wire must have these exact fields:
{
  "fromComponentId": "battery-1",
  "toComponentId": "mppt-1",
  "fromTerminal": "positive",
  "toTerminal": "batt-positive",
  "polarity": "positive",
  "gauge": "10 AWG",
  "length": 5
}

WIRE GAUGE SELECTION:
- 0-25A: 10 AWG
- 25-40A: 8 AWG
- 40-60A: 6 AWG
- 60-100A: 4 AWG
- 100-150A: 2 AWG
- 150-200A: 1 AWG

JSON RESPONSE FORMAT:
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5}
  ],
  "description": "System description",
  "recommendations": ["Install tip 1", "Install tip 2"]
}`,
          },
          {
            role: "user",
            content: `Design a ${systemVoltage}V electrical system with the following requirements: ${prompt}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(completion.choices[0].message.content || "{}");
      
      // Log AI response for debugging
      console.log("AI Response:", JSON.stringify(response, null, 2));
      console.log("Components count:", response.components?.length || 0);
      console.log("Wires count:", response.wires?.length || 0);
      if (response.wires && response.wires.length > 0) {
        console.log("Sample wire:", JSON.stringify(response.wires[0], null, 2));
      }
      
      res.json(response);
    } catch (error: any) {
      console.error("AI generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Export endpoints
  app.get("/api/export/shopping-list/:id", async (req, res) => {
    try {
      const schematic = await storage.getSchematic(req.params.id);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      const items = generateShoppingList(schematic);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/export/shopping-list-csv/:id", async (req, res) => {
    try {
      const schematic = await storage.getSchematic(req.params.id);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      const items = generateShoppingList(schematic);
      const csv = generateCSV(items);
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${schematic.name}-shopping-list.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/export/wire-labels/:id", async (req, res) => {
    try {
      const schematic = await storage.getSchematic(req.params.id);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      const labels = generateWireLabels(schematic);
      res.json(labels);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/export/system-report/:id", async (req, res) => {
    try {
      const schematic = await storage.getSchematic(req.params.id);
      if (!schematic) {
        return res.status(404).json({ error: "Schematic not found" });
      }
      const report = generateSystemReport(schematic);
      
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${schematic.name}-report.txt"`);
      res.send(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
