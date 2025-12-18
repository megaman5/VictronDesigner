import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { feedbackStorage } from "./feedback-storage";
import { userDesignsStorage } from "./user-designs-storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest, type AISystemResponse } from "@shared/schema";
import { DEVICE_DEFINITIONS } from "@shared/device-definitions";
import { calculateWireSize, calculateLoadRequirements } from "./wire-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
import { validateDesign } from "./design-validator";
import { renderSchematicToPNG, getVisualFeedback } from "./schematic-renderer";
import OpenAI from "openai";
import { passport, isAdmin, type AuthUser } from "./auth";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Authentication middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

// Helper function to extract JSON from markdown code blocks
function extractJSON(content: string): string {
  // Remove markdown code blocks (```json ... ``` or ``` ... ```)
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find a JSON object (starts with { and ends with })
  // Look for the first { and last } to get the outermost object
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return content.substring(firstBrace, lastBrace + 1).trim();
  }

  // If no JSON found, return trimmed content (will likely fail parsing)
  return content.trim();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.get("/auth/google", (req, res, next) => {
    const returnTo = req.query.returnTo as string || "/";
    // Pass returnTo through OAuth state parameter (base64 encoded)
    const state = Buffer.from(JSON.stringify({ returnTo })).toString("base64");
    passport.authenticate("google", { 
      scope: ["profile", "email"],
      state 
    })(req, res, next);
  });

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=failed" }),
    (req, res) => {
      // Decode returnTo from state parameter
      let returnTo = "/";
      try {
        const state = req.query.state as string;
        if (state) {
          const decoded = JSON.parse(Buffer.from(state, "base64").toString());
          returnTo = decoded.returnTo || "/";
        }
      } catch (e) {
        console.error("Error decoding OAuth state:", e);
      }
      res.redirect(returnTo);
    }
  );

  app.get("/auth/user", (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user as AuthUser;
      res.json({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
      });
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Schematic CRUD operations (protected)
  app.get("/api/schematics", requireAuth, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const schematics = await storage.getUserSchematics(user.id);
      res.json(schematics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/schematics/:id", requireAuth, async (req, res) => {
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

  app.post("/api/schematics", requireAuth, async (req, res) => {
    try {
      const user = getAuthUser(req);
      const data = insertSchematicSchema.parse({ ...req.body, userId: user.id });
      const schematic = await storage.createSchematic(data);
      res.json(schematic);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/schematics/:id", requireAuth, async (req, res) => {
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

  app.delete("/api/schematics/:id", requireAuth, async (req, res) => {
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

  // Design validation endpoint
  app.post("/api/validate-design", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12 } = req.body;

      if (!components || !Array.isArray(components)) {
        return res.status(400).json({ error: "Components array is required" });
      }

      if (!wires || !Array.isArray(wires)) {
        return res.status(400).json({ error: "Wires array is required" });
      }

      const validation = validateDesign(components, wires, systemVoltage);
      res.json(validation);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI-powered system generation
  app.post("/api/ai-generate-system", async (req, res) => {
    try {
      const { prompt, systemVoltage = 12 }: AISystemRequest = req.body;

      if (!process.env.OPENAI_API_KEY) {
        console.log("No OpenAI API key found, returning mock response");
        const mockResponse = {
          components: [
            { id: "battery-1", type: "battery", name: "Battery Bank", x: 100, y: 400, properties: { voltage: 12, capacity: 400 } },
            { id: "mppt-1", type: "mppt", name: "Solar Controller", x: 400, y: 400, properties: { voltage: 12, current: 30 } },
            { id: "solar-1", type: "solar-panel", name: "Solar Array", x: 400, y: 100, properties: { watts: 400 } },
            { id: "load-1", type: "dc-load", name: "LED Lights", x: 700, y: 400, properties: { watts: 60 } },
            { id: "bus-pos", type: "busbar-positive", name: "DC Positive Bus", x: 400, y: 250, properties: {} },
            { id: "bus-neg", type: "busbar-negative", name: "DC Negative Bus", x: 400, y: 550, properties: {} }
          ],
          wires: [
            // Solar to MPPT
            { fromComponentId: "solar-1", toComponentId: "mppt-1", fromTerminal: "positive", toTerminal: "pv-positive", polarity: "positive", gauge: "10 AWG", length: 2 },
            { fromComponentId: "solar-1", toComponentId: "mppt-1", fromTerminal: "negative", toTerminal: "pv-negative", polarity: "negative", gauge: "10 AWG", length: 2 },

            // MPPT to Busbars
            { fromComponentId: "mppt-1", toComponentId: "bus-pos", fromTerminal: "batt-positive", toTerminal: "pos-1", polarity: "positive", gauge: "8 AWG", length: 3 },
            { fromComponentId: "mppt-1", toComponentId: "bus-neg", fromTerminal: "batt-negative", toTerminal: "neg-1", polarity: "negative", gauge: "8 AWG", length: 3 },

            // Battery to Busbars
            { fromComponentId: "battery-1", toComponentId: "bus-pos", fromTerminal: "positive", toTerminal: "pos-2", polarity: "positive", gauge: "4 AWG", length: 3 },
            { fromComponentId: "battery-1", toComponentId: "bus-neg", fromTerminal: "negative", toTerminal: "neg-2", polarity: "negative", gauge: "4 AWG", length: 3 },

            // Load to Busbars
            { fromComponentId: "bus-pos", toComponentId: "load-1", fromTerminal: "pos-3", toTerminal: "positive", polarity: "positive", gauge: "12 AWG", length: 4 },
            { fromComponentId: "bus-neg", toComponentId: "load-1", fromTerminal: "neg-3", toTerminal: "negative", polarity: "negative", gauge: "12 AWG", length: 4 }
          ],
          description: "Mock system generated without OpenAI API key. Includes battery, solar, busbars, and basic load.",
          recommendations: ["Connect solar panels in series/parallel as needed", "Fuse battery connections"]
        };
        return res.json(mockResponse);
      }

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1-chat-latest",
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
- busbar-positive: 200×60px
- busbar-negative: 200×60px
- fuse: 80×60px
- switch: 80×80px
- breaker-panel: 160×200px
- ac-panel: 180×220px
- dc-panel: 160×240px

LAYOUT RULES (CRITICAL - PREVENT OVERLAP):
1. Minimum 300px horizontal spacing between component centers
2. Minimum 250px vertical spacing between component centers
3. First component starts at x≥100, y≥100
4. Use left-to-right flow: Battery → Fuses/Switches → Busbars → Inverters/Loads
5. Bus bars can centralize multiple connections (use when 3+ loads)
6. Example positions:
   - Battery: x=150, y=400
   - Fuse: x=300, y=400 (between battery and switch)
   - Switch: x=450, y=400 (between fuse and busbar)
   - Positive Bus: x=600, y=200
   - Negative Bus: x=600, y=600
   - MPPT: x=800, y=200
   - MultiPlus: x=1000, y=400
   - Breaker Panel: x=1200, y=400
   - MultiPlus: x=1000, y=400
   - Breaker Panel: x=1200, y=400
- fuse: "in", "out"
- switch: "in", "out"
- breaker-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-2-pos", "load-3-pos", "load-4-pos"
- ac-panel: "main-in-hot", "main-in-neutral", "main-in-ground", "load-1-hot", "load-1-neutral", "load-1-ground", ...
- dc-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-1-neg", ...

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

CRITICAL WIRING RULES:
1. BATTERY FUSE (SAFETY BEST PRACTICE):
   - NEW battery installations should include a fuse on the POSITIVE terminal
   - Flow: Battery "positive" → Fuse "in", Fuse "out" → Rest of system
   - Place fuse 100px from battery (e.g., if battery at x=150, fuse at x=250)
   - If modifying existing designs without fuses, you may proceed without adding fuses
   - Example: Battery "positive" → Fuse "in", Fuse "out" → Busbar pos-1
2. SmartShunt MUST be in negative path between battery and ALL loads
   - Battery negative → SmartShunt "negative" terminal
   - SmartShunt "system-minus" → All loads' negative terminals
   - This ensures ALL current flows through the shunt for accurate monitoring
3. Use SEPARATE bus bars for DC and AC circuits when both are present:
   - DC Bus Bars (12V/24V): Connect DC loads (dc-load) to dedicated DC positive/negative busbars
   - AC Bus Bars (120V/230V): Connect AC loads (ac-load) to dedicated AC positive/negative busbars OR directly to inverter AC outputs
   - Name busbars clearly: "DC Positive Bus", "DC Negative Bus", "AC Positive Bus", "AC Negative Bus"
   - Never connect DC and AC loads to the same bus bar
4. Use bus bars when connecting 3+ devices of the same type to simplify wiring
5. Main battery cables (battery to inverter): Use largest gauge (4/0 AWG or 2/0 AWG)
6. Never mix polarities on same bus bar
7. MultiPlus Connections:
   - AC IN: Connect to Shore Power or Grid (Hot/Neutral/Ground)
   - AC OUT: Connect to AC Distribution Panel (Hot/Neutral/Ground)
   - DC: Connect to Battery Bank (MUST go through battery fuse first)
8. AC Load Connections (MANDATORY - ALL THREE WIRES):
   - EVERY ac-load MUST have THREE wire connections: hot, neutral, AND ground
   - Hot wire: From inverter "ac-out-hot" or panel "load-X-hot" to ac-load "hot"
   - Neutral wire: From inverter "ac-out-neutral" or panel "load-X-neutral" to ac-load "neutral"
   - Ground wire: From inverter "ac-out-ground" or panel "load-X-ground" to ac-load "ground"
   - Example: Inverter AC OUT → AC Load requires 3 wires (hot, neutral, ground)

DEVICE KNOWLEDGE BASE (STRICTLY FOLLOW THESE RULES):
${Object.values(DEVICE_DEFINITIONS).map(d => `
${d.name.toUpperCase()} (${d.type}):
- Terminals: ${d.terminals.map(t => `${t.id} (${t.type})`).join(", ")}
- Rules:
${d.wiringRules.map(r => `  * ${r}`).join("\n")}
`).join("\n")}

WIRE GAUGE SELECTION (BASED ON CURRENT):
- 0-20A: 12 AWG or 10 AWG
- 20-40A: 8 AWG
- 40-60A: 6 AWG
- 60-100A: 4 AWG
- 100-150A: 2 AWG
- 150-200A: 1/0 AWG
- 200A+: 4/0 AWG
- Battery to Inverter: ALWAYS 4/0 AWG or 2/0 AWG

COMPONENT PROPERTIES (MUST BE REALISTIC):
All components MUST have realistic property values based on their type:

DC Loads:
- properties: { "watts": <realistic value> } OR { "amps": <realistic value> }
- Examples:
  * LED Lights: 10-50W (1-4A @ 12V)
  * Refrigerator: 50-150W (4-12A @ 12V)
  * Water Pump: 40-100W (3-8A @ 12V)
  * Fans: 10-30W (1-3A @ 12V)
  * Electronics: 10-50W (1-4A @ 12V)

AC Loads:
- properties: { "watts": <realistic value> } OR { "amps": <realistic value> }
- Examples:
  * Microwave: 1000-1500W (8-12A @ 120V)
  * Coffee Maker: 800-1200W (7-10A @ 120V)
  * TV: 100-300W (1-3A @ 120V)
  * Laptop: 60-100W (0.5-1A @ 120V)
  * Air Conditioner: 1000-1800W (8-15A @ 120V)
  * Space Heater: 1500W (12-13A @ 120V)

Other Components:
- battery: { "voltage": <12/24/48>, "capacity": <amp-hours, e.g., 200-800> }
- solar-panel: { "watts": <realistic value, e.g., 100-400W per panel> }
- mppt: { "maxCurrent": <amps, e.g., 30-100A> }
- multiplus: { "powerRating": <watts, e.g., 1200-3000W> }

NEVER use 0 or placeholder values for watts/amps - always provide realistic numbers!

JSON RESPONSE FORMAT:
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "load-1", "type": "dc-load", "name": "Refrigerator", "x": 450, "y": 400, "properties": {"watts": 80}},
    {"id": "load-2", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
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

      const response = JSON.parse(extractJSON(completion.choices[0].message.content || "{}"));

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

  // AI wire generation for existing components
  app.post("/api/ai-wire-components", async (req, res) => {
    try {
      const { components, systemVoltage = 12 } = req.body;

      if (!components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ error: "Components array is required" });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1-chat-latest",
        messages: [
          {
            role: "system",
            content: `You are an expert Victron electrical system designer. Your task is to create ONLY the wire connections for a set of components that a user has already placed on a canvas.

COMPONENT TERMINALS (EXACT NAMES):
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative", "chassis-ground"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative" (battery side), "system-minus" (system side), "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "hot", "neutral", "ground"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"
- fuse: "in", "out"
- switch: "in", "out"
- breaker-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-2-pos", "load-3-pos", "load-4-pos"
- ac-panel: "main-in-hot", "main-in-neutral", "main-in-ground", "load-1-hot", "load-1-neutral", "load-1-ground", "load-2-hot", "load-2-neutral", "load-2-ground"
- dc-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-1-neg", "load-2-pos", "load-2-neg", "load-3-pos", "load-3-neg"

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

CRITICAL WIRING RULES:
1. BATTERY FUSE (SAFETY BEST PRACTICE):
   - NEW battery installations should include a fuse on the POSITIVE terminal
   - Flow: Battery "positive" → Fuse "in", Fuse "out" → Rest of system
   - Place fuse 100px from battery (e.g., if battery at x=150, fuse at x=250)
   - If modifying existing designs without fuses, you may proceed without adding fuses
   - Example: Battery "positive" → Fuse "in", Fuse "out" → Busbar pos-1
2. SmartShunt MUST be in negative path between battery and ALL loads
   - Battery negative → SmartShunt "negative" terminal
   - SmartShunt "system-minus" → All loads' negative terminals
   - This ensures ALL current flows through the shunt for accurate monitoring
3. Use SEPARATE bus bars for DC and AC circuits when both are present:
   - DC Bus Bars (12V/24V): Connect DC loads (dc-load) to dedicated DC positive/negative busbars
   - AC Bus Bars (120V/230V): Connect AC loads (ac-load) to dedicated AC positive/negative busbars OR directly to inverter AC outputs
   - Name busbars clearly: "DC Positive Bus", "DC Negative Bus", "AC Positive Bus", "AC Negative Bus"
   - Never connect DC and AC loads to the same bus bar
4. Use bus bars when connecting 3+ devices of the same type to simplify wiring
   - DISTRIBUTE connections across bus bar terminals (e.g., pos-1, pos-2, pos-3)
   - Do NOT connect all wires to the same terminal (e.g., do not put everything on pos-1)
5. DC loads connect to battery/bus bars after SmartShunt on negative side
6. Data connections: BMV/SmartShunt to Cerbo via data terminals
7. AC Load Connections (MANDATORY - ALL THREE WIRES):
   - EVERY ac-load MUST have THREE wire connections: hot, neutral, AND ground
   - Hot wire: From inverter "ac-out-hot" or panel "load-X-hot" to ac-load "hot"
   - Neutral wire: From inverter "ac-out-neutral" or panel "load-X-neutral" to ac-load "neutral"
   - Ground wire: From inverter "ac-out-ground" or panel "load-X-ground" to ac-load "ground"

DEVICE KNOWLEDGE BASE (STRICTLY FOLLOW THESE RULES):
${Object.values(DEVICE_DEFINITIONS).map(d => `
${d.name.toUpperCase()} (${d.type}):
- Terminals: ${d.terminals.map(t => `${t.id} (${t.type})`).join(", ")}
- Rules:
${d.wiringRules.map(r => `  * ${r}`).join("\n")}
`).join("\n")}

WIRE GAUGE SELECTION:
- 0-25A: 10 AWG
- 25-40A: 8 AWG
- 40-60A: 6 AWG
- 60-100A: 4 AWG
- 100-150A: 2 AWG
- 150-200A: 1 AWG

Calculate wire length based on component positions (use Euclidean distance / 100 as rough estimate).

JSON RESPONSE FORMAT:
{
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5}
  ],
  "description": "Brief description of the wiring strategy",
  "recommendations": ["Wiring tip 1", "Wiring tip 2"]
}`,
          },
          {
            role: "user",
            content: `Create wiring connections for these ${systemVoltage}V components: ${JSON.stringify(components)}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const response = JSON.parse(extractJSON(completion.choices[0].message.content || "{}"));

      console.log("AI Wire Generation Response:", JSON.stringify(response, null, 2));
      console.log("Generated wires count:", response.wires?.length || 0);

      res.json(response);
    } catch (error: any) {
      console.error("AI wire generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Iterative AI generation with quality validation
  app.post("/api/ai-generate-system-iterative", async (req, res) => {
    try {
      const {
        prompt,
        systemVoltage = 12,
        minQualityScore = 70,
        maxIterations = 5
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      let bestDesign: any = null;
      let bestScore = 0;
      const iterationHistory: any[] = [];

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`\n=== Iteration ${iteration + 1}/${maxIterations} ===`);

        // Build feedback context from previous iteration
        let feedbackContext = "";
        if (iteration > 0 && bestDesign) {
          const validation = bestDesign.validation;
          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
- Errors: ${validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message).join(', ')}
- Warnings: ${validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message).join(', ')}
- Suggestions: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ')}

Please address these issues in your next design.`;
        }

        const systemMessage = `You are a Victron energy system design expert. Design a complete electrical schematic based on the user's requirements.

CANVAS DIMENSIONS: 2000px width × 1500px height (0,0 is top-left corner)

COMPONENT DIMENSIONS (width × height):
- multiplus: 180×140px
- mppt: 160×130px
- cerbo: 180×120px
- bmv: 140×140px
- smartshunt: 140×130px
- battery: 160×110px
- solar-panel: 140×120px
- ac-load: 120×100px
- dc-load: 120×100px
- busbar-positive: 200×60px
- busbar-negative: 200×60px
- fuse: 80×60px
- switch: 80×80px
- breaker-panel: 160×200px
- ac-panel: 180×220px
- dc-panel: 160×240px

LAYOUT RULES:
1. Components must NOT overlap - check dimensions above
2. Leave minimum 300px horizontal spacing between component centers
3. Leave minimum 250px vertical spacing between component centers
4. Organize logically: solar/charging top, battery middle, loads bottom
5. Use grid alignment: positions should be multiples of 20px
6. Stay within canvas bounds with margin: x=100-1800, y=100-1300

⚠️ CRITICAL: USE EXACT TERMINAL IDs - DO NOT ABBREVIATE OR MODIFY ⚠️

TERMINAL IDs BY COMPONENT (copy these EXACTLY):
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative", "chassis-ground"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- smartshunt: "negative", "system-minus", "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "hot", "neutral", "ground"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"
- fuse: "in", "out"
- switch: "in", "out"
- breaker-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-2-pos", "load-3-pos", "load-4-pos"
- ac-panel: "main-in-hot", "main-in-neutral", "main-in-ground", "load-1-hot", "load-1-neutral", "load-1-ground", "load-2-hot", "load-2-neutral", "load-2-ground"
- dc-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-1-neg", "load-2-pos", "load-2-neg", "load-3-pos", "load-3-neg"

⚠️ EXAMPLES OF CORRECT vs WRONG TERMINAL IDs:
✅ CORRECT: "ac-out-hot" (multiplus AC output)
❌ WRONG: "ac-out" (TOO SHORT - validation will FAIL)
✅ CORRECT: "ac-in-neutral" (multiplus AC input neutral)
❌ WRONG: "ac-in" (TOO SHORT - validation will FAIL)

⚠️ CRITICAL WIRE GAUGE FORMAT - MUST INCLUDE SPACE:
✅ CORRECT: "10 AWG", "8 AWG", "2 AWG" (space between number and AWG)
❌ WRONG: "10AWG", "8AWG", "2AWG" (no space - validation will FAIL)

⚠️ CRITICAL COMPONENT NAMING - MUST BE DESCRIPTIVE:
✅ CORRECT: {"id": "load-1", "type": "ac-load", "name": "Kitchen Outlets", ...}
❌ WRONG: {"id": "load-1", "type": "ac-load", "name": undefined, ...}

CRITICAL WIRING RULES:
1. BATTERY FUSE (BEST PRACTICE): For NEW systems, include fuse: Battery "positive" → Fuse "in", Fuse "out" → system (100px from battery). If modifying existing design, may skip if already wired.
2. SmartShunt MUST be in negative path: Battery "negative" → SmartShunt "negative", SmartShunt "system-minus" → all loads
3. Use bus bars when 3+ connections needed (separate bars for positive/negative)
4. ALL wires MUST have: fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, gauge, length
5. Use EXACT terminal IDs from list above (copy them character-by-character)
6. Wire gauge format: "10 AWG" (with space), based on current: 0-25A="10 AWG", 25-40A="8 AWG", 40-60A="6 AWG", 60-100A="4 AWG", 100-150A="2 AWG", 150-200A="1 AWG"

⚠️ COMPONENT PROPERTIES - MUST USE REALISTIC VALUES (NEVER 0):
DC Loads (dc-load) - properties MUST have watts or amps:
- LED Lights: 10-50W (1-4A @ 12V)
- Refrigerator: 50-150W (4-12A @ 12V)
- Water Pump: 40-100W (3-8A @ 12V)
- Fans/Ventilation: 10-30W (1-3A @ 12V)
- Electronics/USB: 10-50W (1-4A @ 12V)
- Example: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "properties": {"watts": 30}}

AC Loads (ac-load) - properties MUST have watts or amps:
- Microwave: 1000-1500W
- Coffee Maker: 800-1200W
- TV/Monitor: 100-300W
- Laptop Charger: 60-100W
- Air Conditioner: 1000-1800W
- Example: {"id": "load-2", "type": "ac-load", "name": "Microwave", "properties": {"watts": 1200}}

Other Components:
- battery: {"voltage": 12/24/48, "capacity": 200-800}
- solar-panel: {"watts": 100-400}
- mppt: {"maxCurrent": 30-100}
- multiplus: {"powerRating": 1200-3000}

VALIDATION CHECKLIST:
✓ All components within canvas bounds (100-1800, 100-1300)
✓ No overlapping components (check dimensions + 300px spacing)
✓ All wires have valid terminal IDs
✓ SmartShunt in negative path if present
✓ Proper polarity on all connections
✓ Appropriate wire gauges for current
✓ Logical component layout
✓ ALL loads have realistic watts (NEVER use 0 or omit properties)

${feedbackContext}
${existingDesign ? `
⚠️ ITERATION MODE: Modifying existing design with ${existingDesign.components?.length || 0} components and ${existingDesign.wires?.length || 0} wires.
BASE DESIGN: ${JSON.stringify({ components: existingDesign.components, wires: existingDesign.wires })}
MODIFY based on user request. Keep existing component IDs. Return COMPLETE design with ALL components and wires.
` : ''}

⚠️ CRITICAL: Respond with ONLY valid JSON. NO explanations. NO text outside the JSON structure:
Respond with valid JSON only:
{
  "components": [...],
  "wires": [...],
  "description": "Brief system description",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

        const userMessage = iteration === 0
          ? prompt
          : `${prompt}\n\nImprove the previous design based on the feedback above.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.1-chat-latest",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage }
          ],
          max_completion_tokens: 4000,
        });

        const content = completion.choices[0].message.content;
        if (!content) {
          throw new Error("Empty response from AI");
        }

        let response: AISystemResponse;
        try {
          const extracted = extractJSON(content);
          response = JSON.parse(extracted);
        } catch (err) {
          console.error(`Failed to parse AI response - AI returned: ${content.substring(0, 500)}...`);
          throw new Error(`AI returned invalid JSON: ${content.substring(0, 100)}...`);
        }

        // Validate the design
        const validation = validateDesign(
          response.components,
          response.wires,
          systemVoltage
        );

        console.log(`Iteration ${iteration + 1} - Score: ${validation.score}, Errors: ${validation.issues.filter(i => i.severity === 'error').length}, Warnings: ${validation.issues.filter(i => i.severity === 'warning').length}`);

        // Generate visual feedback (optional, for debugging)
        let visualFeedback = null;
        try {
          visualFeedback = await renderSchematicToPNG(response.components, response.wires);
        } catch (err) {
          console.log("Visual feedback generation skipped:", err);
        }

        // Track this iteration
        iterationHistory.push({
          iteration: iteration + 1,
          score: validation.score,
          errorCount: validation.issues.filter(i => i.severity === 'error').length,
          warningCount: validation.issues.filter(i => i.severity === 'warning').length,
          design: response,
          validation
        });

        // Update best design if this is better
        if (validation.score > bestScore) {
          bestScore = validation.score;
          bestDesign = {
            ...response,
            validation,
            visualFeedback
          };
        }

        // Check if we've achieved minimum quality
        if (validation.score >= minQualityScore) {
          console.log(`✓ Achieved quality threshold (${validation.score} >= ${minQualityScore}) at iteration ${iteration + 1}`);
          res.json({
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            achievedQualityThreshold: true
          });
          return;
        }
      }

      // Return best design after max iterations
      console.log(`Max iterations reached. Best score: ${bestScore}/${minQualityScore}`);
      res.json({
        ...bestDesign,
        iterationHistory,
        finalIteration: maxIterations,
        achievedQualityThreshold: bestScore >= minQualityScore
      });

    } catch (error: any) {
      console.error("Iterative AI generation error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // SSE streaming endpoint for real-time progress updates
  app.post("/api/ai-generate-system-stream", async (req, res) => {
    try {
      const {
        prompt,
        systemVoltage = 12,
        minQualityScore = 70,
        maxIterations = 5,
        existingDesign // Optional: { components, wires } for iteration mode
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`[SSE] Starting generation: ${maxIterations} iterations, min score ${minQualityScore}`);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sendEvent = (event: string, data: any) => {
        console.log(`[SSE] Sending event: ${event}`, data);
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      let bestDesign: any = null;
      let bestScore = 0;
      const iterationHistory: any[] = [];

      console.log(`[SSE] Starting iteration loop: ${maxIterations} iterations`);

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`[SSE] Iteration ${iteration + 1} of ${maxIterations} starting...`);
        sendEvent('iteration-start', { iteration: iteration + 1, maxIterations });

        // Build feedback context from previous iteration
        let feedbackContext = "";
        if (iteration > 0 && bestDesign) {
          const validation = bestDesign.validation;
          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
- Errors: ${validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message).join(', ')}
- Warnings: ${validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message).join(', ')}
- Suggestions: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ')}

Please address these issues in your next design.`;
        }

        const systemMessage = `You are a Victron energy system design expert. Design a complete electrical schematic based on the user's requirements.

CANVAS DIMENSIONS: 2000px width × 1500px height (0,0 is top-left corner)

COMPONENT DIMENSIONS (width × height):
- multiplus: 180×140px
- mppt: 160×130px
- cerbo: 180×120px
- bmv: 140×140px
- smartshunt: 140×130px
- battery: 160×110px
- solar-panel: 140×120px
- ac-load: 120×100px
- dc-load: 120×100px
- busbar-positive: 200×60px
- busbar-negative: 200×60px
- fuse: 80×60px
- switch: 80×80px
- breaker-panel: 160×200px
- ac-panel: 180×220px
- dc-panel: 160×240px

LAYOUT RULES:
1. Components must NOT overlap - check dimensions above
2. Leave minimum 300px horizontal spacing between component centers
3. Leave minimum 250px vertical spacing between component centers
4. Organize logically: solar/charging top, battery middle, loads bottom
5. Use grid alignment: positions should be multiples of 20px
6. Stay within canvas bounds with margin: x=100-1800, y=100-1300

⚠️ CRITICAL: USE EXACT TERMINAL IDs - DO NOT ABBREVIATE OR MODIFY ⚠️

TERMINAL IDs BY COMPONENT (copy these EXACTLY):
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative", "chassis-ground"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- smartshunt: "negative", "system-minus", "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "hot", "neutral", "ground"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"
- fuse: "in", "out"
- switch: "in", "out"
- breaker-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-2-pos", "load-3-pos", "load-4-pos"
- ac-panel: "main-in-hot", "main-in-neutral", "main-in-ground", "load-1-hot", "load-1-neutral", "load-1-ground", "load-2-hot", "load-2-neutral", "load-2-ground"
- dc-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-1-neg", "load-2-pos", "load-2-neg", "load-3-pos", "load-3-neg"

⚠️ EXAMPLES OF CORRECT vs WRONG TERMINAL IDs:
✅ CORRECT: "ac-out-hot" (multiplus AC output)
❌ WRONG: "ac-out" (TOO SHORT - validation will FAIL)
✅ CORRECT: "ac-in-neutral" (multiplus AC input neutral)
❌ WRONG: "ac-in" (TOO SHORT - validation will FAIL)

⚠️ CRITICAL WIRE GAUGE FORMAT - MUST INCLUDE SPACE:
✅ CORRECT: "10 AWG", "8 AWG", "2 AWG" (space between number and AWG)
❌ WRONG: "10AWG", "8AWG", "2AWG" (no space - validation will FAIL)

⚠️ CRITICAL COMPONENT NAMING - MUST BE DESCRIPTIVE:
✅ CORRECT: {"id": "load-1", "type": "ac-load", "name": "Kitchen Outlets", ...}
❌ WRONG: {"id": "load-1", "type": "ac-load", "name": undefined, ...}

CRITICAL WIRING RULES:
1. BATTERY FUSE (BEST PRACTICE): For NEW systems, include fuse: Battery "positive" → Fuse "in", Fuse "out" → system (100px from battery). If modifying existing design, may skip if already wired.
2. SmartShunt MUST be in negative path: Battery "negative" → SmartShunt "negative", SmartShunt "system-minus" → all loads
3. Use bus bars when 3+ connections needed (separate bars for positive/negative)
4. ALL wires MUST have: fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, gauge, length
5. Use EXACT terminal IDs from list above (copy them character-by-character)
6. Wire gauge format: "10 AWG" (with space), based on current: 0-25A="10 AWG", 25-40A="8 AWG", 40-60A="6 AWG", 60-100A="4 AWG", 100-150A="2 AWG", 150-200A="1 AWG"

⚠️ COMPONENT PROPERTIES - MUST USE REALISTIC VALUES (NEVER 0):
DC Loads (dc-load) - properties MUST have watts or amps:
- LED Lights: 10-50W (1-4A @ 12V)
- Refrigerator: 50-150W (4-12A @ 12V)
- Water Pump: 40-100W (3-8A @ 12V)
- Fans/Ventilation: 10-30W (1-3A @ 12V)
- Electronics/USB: 10-50W (1-4A @ 12V)
- Example: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "properties": {"watts": 30}}

AC Loads (ac-load) - properties MUST have watts or amps:
- Microwave: 1000-1500W
- Coffee Maker: 800-1200W
- TV/Monitor: 100-300W
- Laptop Charger: 60-100W
- Air Conditioner: 1000-1800W
- Example: {"id": "load-2", "type": "ac-load", "name": "Microwave", "properties": {"watts": 1200}}

Other Components:
- battery: {"voltage": 12/24/48, "capacity": 200-800}
- solar-panel: {"watts": 100-400}
- mppt: {"maxCurrent": 30-100}
- multiplus: {"powerRating": 1200-3000}

VALIDATION CHECKLIST:
✓ All components within canvas bounds (100-1800, 100-1300)
✓ No overlapping components (check dimensions + 300px spacing)
✓ All wires have valid terminal IDs
✓ SmartShunt in negative path if present
✓ Proper polarity on all connections
✓ Appropriate wire gauges for current
✓ Logical component layout
✓ ALL loads have realistic watts (NEVER use 0 or omit properties)

${feedbackContext}
${existingDesign ? `
⚠️ ITERATION MODE: Modifying existing design with ${existingDesign.components?.length || 0} components and ${existingDesign.wires?.length || 0} wires.
BASE DESIGN: ${JSON.stringify({ components: existingDesign.components, wires: existingDesign.wires })}
MODIFY based on user request. Keep existing component IDs. Return COMPLETE design with ALL components and wires.
` : ''}

⚠️ CRITICAL: Respond with ONLY valid JSON. NO explanations. NO text outside the JSON structure:
Respond with valid JSON only:
{
  "components": [...],
  "wires": [...],
  "description": "Brief system description",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

        const userMessage = iteration === 0
          ? prompt
          : `${prompt}\n\nImprove the previous design based on the feedback above.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.1-chat-latest",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage }
          ],
          max_completion_tokens: 4000,
        });

        const content = completion.choices[0].message.content;
        if (!content) {
          throw new Error("Empty response from AI");
        }

        let response: AISystemResponse;
        try {
          const extracted = extractJSON(content);
          response = JSON.parse(extracted);
        } catch (err) {
          console.error(`Failed to parse AI response - AI returned: ${content.substring(0, 500)}...`);
          throw new Error(`AI returned invalid JSON: ${content.substring(0, 100)}...`);
        }

        // Validate the design
        const validation = validateDesign(
          response.components,
          response.wires,
          systemVoltage
        );

        // Generate visual feedback (optional, for debugging)
        let visualFeedback = null;
        try {
          visualFeedback = await renderSchematicToPNG(response.components, response.wires);
        } catch (err) {
          console.log("Visual feedback generation skipped:", err);
        }

        // Track this iteration
        iterationHistory.push({
          iteration: iteration + 1,
          score: validation.score,
          errorCount: validation.issues.filter(i => i.severity === 'error').length,
          warningCount: validation.issues.filter(i => i.severity === 'warning').length
        });

        // Log validation details
        console.log(`[SSE] Iteration ${iteration + 1} validation (score ${validation.score}):`);
        if (validation.issues.length > 0) {
          validation.issues.forEach(issue => {
            console.log(`  [${issue.severity}] ${issue.category}: ${issue.message}`);
          });
        } else {
          console.log(`  No issues found`);
        }

        // Update best design if this is better
        if (validation.score > bestScore) {
          bestScore = validation.score;
          bestDesign = {
            ...response,
            validation,
            visualFeedback
          };
        }

        sendEvent('iteration-complete', {
          iteration: iteration + 1,
          score: validation.score,
          errorCount: validation.issues.filter(i => i.severity === 'error').length,
          warningCount: validation.issues.filter(i => i.severity === 'warning').length,
          isBest: validation.score === bestScore
        });

        // Check if we've achieved minimum quality
        if (validation.score >= minQualityScore) {
          sendEvent('complete', {
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            achievedQualityThreshold: true
          });
          res.end();
          return;
        }
      }

      // Return best design after max iterations
      if (!bestDesign || !bestDesign.components || bestDesign.components.length === 0) {
        console.log('[SSE] All iterations failed - no valid design generated');
        sendEvent('error', {
          error: 'Failed to generate a valid design after all iterations. All attempts had validation errors.',
          iterationHistory,
          finalIteration: maxIterations
        });
        res.end();
        return;
      }

      sendEvent('complete', {
        ...bestDesign,
        iterationHistory,
        finalIteration: maxIterations,
        achievedQualityThreshold: bestScore >= minQualityScore
      });
      res.end();

    } catch (error: any) {
      console.error("SSE streaming error:", error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Export endpoints - POST versions for current design (no save required)
  app.post("/api/export/shopping-list", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const items = generateShoppingList(schematic as any);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/export/wire-labels", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const labels = generateWireLabels(schematic as any);
      res.json(labels);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/export/system-report", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const report = generateSystemReport(schematic as any);
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${name}-report.txt"`);
      res.send(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export endpoints - GET versions (require saved schematic ID)
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

  // User designs endpoints (requires authentication)
  app.get("/api/designs", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const designs = await userDesignsStorage.getAll(user.id);
      res.json(designs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/designs/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const design = await userDesignsStorage.getById(user.id, req.params.id);
      if (!design) {
        return res.status(404).json({ error: "Design not found" });
      }
      res.json(design);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/designs", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const { name, description, systemVoltage, components, wires, thumbnail } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Design name is required" });
      }

      const design = await userDesignsStorage.create(user.id, {
        name: name.trim(),
        description: description?.trim(),
        systemVoltage: systemVoltage || 12,
        components: components || [],
        wires: wires || [],
        thumbnail,
      });

      res.json(design);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/designs/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const { name, description, systemVoltage, components, wires, thumbnail } = req.body;

      const design = await userDesignsStorage.update(user.id, req.params.id, {
        name: name?.trim(),
        description: description?.trim(),
        systemVoltage,
        components,
        wires,
        thumbnail,
      });

      if (!design) {
        return res.status(404).json({ error: "Design not found" });
      }

      res.json(design);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/designs/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const deleted = await userDesignsStorage.delete(user.id, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Design not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Feedback endpoints
  app.post("/api/feedback", async (req, res) => {
    try {
      const { message, email, state, screenshot } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({ error: "Feedback message is required" });
      }

      if (!state || !state.components || !state.wires) {
        return res.status(400).json({ error: "Design state is required" });
      }

      const feedback = await feedbackStorage.create({
        message: message.trim(),
        email: email?.trim() || undefined,
        userAgent: req.headers["user-agent"] || "Unknown",
        state,
        screenshot,
      });

      res.json({ success: true, id: feedback.id });
    } catch (error: any) {
      console.error("Error saving feedback:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Protected admin-only feedback endpoints
  app.get("/api/feedback", isAdmin, async (req, res) => {
    try {
      const allFeedback = await feedbackStorage.getAll();
      res.json(allFeedback);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feedback/:id", isAdmin, async (req, res) => {
    try {
      const feedback = await feedbackStorage.getById(req.params.id);
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(feedback);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/feedback/:id", isAdmin, async (req, res) => {
    try {
      const deleted = await feedbackStorage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/feedback-count", isAdmin, async (req, res) => {
    try {
      const count = await feedbackStorage.count();
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
