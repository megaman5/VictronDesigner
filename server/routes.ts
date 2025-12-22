import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { feedbackStorage } from "./feedback-storage";
import { userDesignsStorage } from "./user-designs-storage";
import { observabilityStorage } from "./observability-storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest, type AISystemResponse } from "@shared/schema";
import { DEVICE_DEFINITIONS } from "@shared/device-definitions";
import { calculateWireSize, calculateLoadRequirements, getACVoltage, calculateInverterDCInput } from "./wire-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
import { validateDesign } from "./design-validator";
import { renderSchematicToPNG, getVisualFeedback } from "./schematic-renderer";
import OpenAI from "openai";
import { passport, isAdmin, type AuthUser } from "./auth";

// Helper to extract visitor ID from request
function getVisitorId(req: Request): string {
  // Try to get from cookie first, then generate from IP + User-Agent
  const cookie = req.cookies?.visitorId;
  if (cookie) return cookie;
  
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  // Simple hash for visitor fingerprint
  return Buffer.from(`${ip}:${ua}`).toString("base64").substring(0, 24);
}

// Helper to get client IP
function getClientIP(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() 
    || req.ip 
    || req.socket.remoteAddress 
    || "unknown";
}

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
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    
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

      // Log to observability
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "generate-system",
        prompt,
        systemVoltage,
        success: true,
        durationMs: Date.now() - startTime,
        componentCount: response.components?.length || 0,
        wireCount: response.wires?.length || 0,
        model: "gpt-5.1-chat-latest",
        response: {
          components: response.components,
          wires: response.wires,
          description: response.description,
          recommendations: response.recommendations,
        },
      });

      res.json(response);
    } catch (error: any) {
      console.error("AI generation error:", error);
      
      // Log error to observability
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "generate-system",
        prompt: req.body.prompt || "",
        systemVoltage: req.body.systemVoltage || 12,
        success: false,
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        model: "gpt-5.1-chat-latest",
      });
      
      res.status(500).json({ error: error.message });
    }
  });

  // AI wire generation for existing components
  app.post("/api/ai-wire-components", async (req, res) => {
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    
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

Calculate wire length using logical defaults based on component types (canvas is logical, not physical):
- Battery to fuse: 2 feet
- Battery to SmartShunt: 3 feet
- Battery to bus bar: 5 feet
- Battery to other: 8 feet
- Solar panel to MPPT: 25 feet
- Solar panel to other: 15 feet
- Fuse to bus bar: 10 feet
- Fuse to other: 5 feet
- Bus bar to loads: 10 feet
- Bus bar to other: 8 feet
- MPPT to bus bar: 8 feet
- MPPT to battery: 5 feet
- Loads to bus bar: 10 feet
- Loads to inverter: 5 feet
- Inverter to bus bar: 8 feet
- Inverter to battery: 5 feet
- Charger to battery: 5 feet
- Charger to bus bar: 8 feet
- SmartShunt to bus bar: 8 feet
- Default for other connections: 10 feet
- Use these logical defaults, NOT pixel-based calculations

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

      // Log to observability
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "wire-components",
        prompt: `Wire ${components.length} components`,
        systemVoltage,
        success: true,
        durationMs: Date.now() - startTime,
        componentCount: components.length,
        wireCount: response.wires?.length || 0,
        model: "gpt-5.1-chat-latest",
        response: {
          wires: response.wires,
          description: response.description,
          recommendations: response.recommendations,
        },
      });

      res.json(response);
    } catch (error: any) {
      console.error("AI wire generation error:", error);
      
      // Log error to observability
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "wire-components",
        prompt: `Wire ${req.body.components?.length || 0} components`,
        systemVoltage: req.body.systemVoltage || 12,
        success: false,
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        model: "gpt-5.1-chat-latest",
      });
      
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
          
          // Calculate wire sizing for all wires to provide detailed feedback
          const wireCalculations: any[] = [];
          if (bestDesign.wires) {
            for (const wire of bestDesign.wires) {
              try {
                // Find connected components to determine current and voltage
                const fromComp = bestDesign.components?.find((c: any) => c.id === wire.fromComponentId);
                const toComp = bestDesign.components?.find((c: any) => c.id === wire.toComponentId);
                
                let current = wire.current || 0;
                
                // Determine if this is an AC wire based on polarity or component types
                const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                                 toComp?.type === "ac-load" || fromComp?.type === "ac-load" ||
                                 toComp?.type === "ac-panel" || fromComp?.type === "ac-panel" ||
                                 toComp?.type === "multiplus" || fromComp?.type === "multiplus" ||
                                 toComp?.type === "phoenix-inverter" || fromComp?.type === "phoenix-inverter" ||
                                 toComp?.type === "inverter" || fromComp?.type === "inverter";
                
                // For AC wires, use AC voltage (110V/120V/220V/230V); for DC wires, use component voltage or system voltage
                let voltage = isACWire ? getACVoltage(toComp || fromComp) : systemVoltage;
                if (!isACWire) {
                  if (fromComp?.properties?.voltage) {
                    voltage = fromComp.properties.voltage;
                  } else if (toComp?.properties?.voltage) {
                    voltage = toComp.properties.voltage;
                  }
                }
                
                // Check if this is an inverter DC connection (dc-positive or dc-negative terminal)
                const isInverterDC = (fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter") &&
                                      (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative") ||
                                      (toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "inverter") &&
                                      (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative");
                
                // Calculate current from load if not set
                if (current === 0) {
                  // For inverter DC connections, calculate from connected AC loads
                  if (isInverterDC) {
                    const inverterId = fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter"
                      ? fromComp.id
                      : toComp?.id;
                    if (inverterId && bestDesign.components && bestDesign.wires) {
                      const inverterDC = calculateInverterDCInput(inverterId, bestDesign.components, bestDesign.wires, systemVoltage);
                      current = inverterDC.dcCurrent;
                    }
                  } else if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                    const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                    // AC loads use AC voltage (110V/120V/220V/230V), DC loads use component voltage or system voltage
                    const loadVoltage = toComp.type === "ac-load" ? getACVoltage(toComp) : (toComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                    const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                    // AC loads use AC voltage (110V/120V/220V/230V), DC loads use component voltage or system voltage
                    const loadVoltage = fromComp.type === "ac-load" ? getACVoltage(fromComp) : (fromComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  }
                }
                
                if (current > 0 && wire.length) {
                  const calc = calculateWireSize({
                    current,
                    length: wire.length,
                    voltage,
                    conductorMaterial: (wire as any).conductorMaterial || "copper",
                    currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
                  });
                  
                  wireCalculations.push({
                    wireId: wire.id,
                    fromComponent: fromComp?.name || wire.fromComponentId,
                    toComponent: toComp?.name || wire.toComponentId,
                    currentGauge: wire.gauge,
                    recommendedGauge: calc.recommendedGauge,
                    voltageDrop: calc.voltageDropPercent,
                    current,
                    length: wire.length,
                    status: calc.status,
                    message: calc.message,
                  });
                }
              } catch (err) {
                // Skip wires that can't be calculated
              }
            }
          }
          
          // Build wire sizing feedback
          const wireSizingIssues: string[] = [];
          wireCalculations.forEach((calc: any) => {
            if (calc.currentGauge !== calc.recommendedGauge) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% voltage drop)`
              );
            }
            if (calc.voltageDrop > 3) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
              );
            } else if (calc.voltageDrop > 2.5) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
              );
            }
          });
          
          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
- Errors: ${validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message).join(', ')}
- Warnings: ${validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message).join(', ')}
${wireSizingIssues.length > 0 ? `- Wire Sizing Issues:\n  ${wireSizingIssues.map(i => `  • ${i}`).join('\n')}` : ''}
- Suggestions: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ')}

Please address these issues in your next design. Pay special attention to wire gauge sizing based on current and voltage drop calculations.`;
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
6. Wire gauge sizing - CRITICAL: You MUST calculate gauge based on BOTH current AND voltage drop:
   - Calculate current from load: I = P / V (watts / voltage)
   - For each wire, calculate required gauge using: current, length, and 3% max voltage drop
   - Example calculations:
     * 50W load at 12V = 4.17A. For 10ft run: needs "10 AWG" (handles 35A, <3% drop)
     * 1000W load at 12V = 83.3A. For 10ft run: needs "2 AWG" (handles 115A, <3% drop)
     * 2000W inverter at 12V = 166.7A. For 5ft run: needs "1/0 AWG" (handles 150A, <3% drop)
   - Quick reference (for SHORT runs <5ft only):
     * 0-25A: "10 AWG"
     * 25-40A: "8 AWG"
     * 40-60A: "6 AWG"
     * 60-100A: "4 AWG"
     * 100-150A: "2 AWG"
     * 150-200A: "1 AWG"
     * 200-250A: "1/0 AWG"
     * 250-300A: "2/0 AWG"
   - For LONGER runs, use LARGER gauge to keep voltage drop <3%
   - ALWAYS err on the side of larger gauge for safety
   - Wire gauge format: "10 AWG" (with space between number and AWG)
7. Wire length defaults (canvas is logical, not physical - use these defaults):
   - Battery to fuse: 2 feet
   - Battery to SmartShunt: 3 feet
   - Battery to bus bar: 5 feet
   - Battery to other: 8 feet
   - Solar panel to MPPT: 25 feet
   - Solar panel to other: 15 feet
   - Fuse to bus bar: 10 feet
   - Fuse to other: 5 feet
   - Bus bar to loads: 10 feet
   - Bus bar to other: 8 feet
   - MPPT to bus bar: 8 feet
   - MPPT to battery: 5 feet
   - Loads to bus bar: 10 feet
   - Loads to inverter: 5 feet
   - Inverter to bus bar: 8 feet
   - Inverter to battery: 5 feet
   - Charger to battery: 5 feet
   - Charger to bus bar: 8 feet
   - SmartShunt to bus bar: 8 feet
   - Default for other connections: 10 feet

⚠️⚠️⚠️ COMPONENT PROPERTIES - REQUIRED FOR ALL COMPONENTS (VALIDATION WILL FAIL WITHOUT THEM):
EVERY component MUST include a "properties" object. Missing properties = INVALID design.

DC Loads (dc-load) - "properties": {"watts": <number>} REQUIRED:
- LED Lights: 10-50W
- Refrigerator: 50-150W
- Water Pump: 40-100W
- Fans/Ventilation: 10-30W
- Electronics/USB: 10-50W
- Cabin Outlets: 100-500W (multiple devices)
✅ CORRECT: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "x": 100, "y": 100, "properties": {"watts": 30}}
❌ WRONG: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "x": 100, "y": 100} (MISSING properties!)

AC Loads (ac-load) - "properties": {"watts": <number>} REQUIRED:
- Microwave: 1000-1500W
- Coffee Maker: 800-1200W
- TV/Monitor: 100-300W
- AC Outlets: 500-2000W (multiple devices)
- Air Conditioner: 1000-1800W
✅ CORRECT: {"id": "load-2", "type": "ac-load", "name": "Cabin AC Outlets", "x": 200, "y": 200, "properties": {"watts": 1500}}
❌ WRONG: {"id": "load-2", "type": "ac-load", "name": "Cabin AC Outlets", "x": 200, "y": 200} (MISSING properties!)

Other Components - ALL need properties:
- battery: {"voltage": 12, "capacity": 400}
- solar-panel: {"watts": 300}
- mppt: {"maxCurrent": 50}
- multiplus: {"powerRating": 3000}

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

⚠️ CRITICAL: Respond with ONLY valid JSON. NO explanations. NO text outside the JSON structure.
⚠️ EVERY component MUST have a "properties" field with realistic values (watts for loads, capacity for batteries, etc.)

JSON RESPONSE FORMAT (FOLLOW THIS EXACTLY):
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "House Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "solar-1", "type": "solar-panel", "name": "Solar Panel", "x": 150, "y": 100, "properties": {"watts": 300}},
    {"id": "load-dc-1", "type": "dc-load", "name": "LED Cabin Lights", "x": 450, "y": 400, "properties": {"watts": 50}},
    {"id": "load-ac-1", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5}
  ],
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
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    
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
      
      // Store full messages at the start for observability
      let fullSystemMessage = "";
      let fullUserMessage = "";

      console.log(`[SSE] Starting iteration loop: ${maxIterations} iterations`);

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`[SSE] Iteration ${iteration + 1} of ${maxIterations} starting...`);
        sendEvent('iteration-start', { iteration: iteration + 1, maxIterations });

        try {
          // Build feedback context from previous iteration
        let feedbackContext = "";
        if (iteration > 0 && bestDesign) {
          const validation = bestDesign.validation;
          // Calculate wire sizing for all wires to provide detailed feedback
          const wireCalculations: any[] = [];
          if (bestDesign.wires) {
            for (const wire of bestDesign.wires) {
              try {
                // Find connected components to determine current and voltage
                const fromComp = bestDesign.components?.find((c: any) => c.id === wire.fromComponentId);
                const toComp = bestDesign.components?.find((c: any) => c.id === wire.toComponentId);
                
                let current = wire.current || 0;
                
                // Determine if this is an AC wire based on polarity or component types
                const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                                 toComp?.type === "ac-load" || fromComp?.type === "ac-load" ||
                                 toComp?.type === "ac-panel" || fromComp?.type === "ac-panel" ||
                                 toComp?.type === "multiplus" || fromComp?.type === "multiplus" ||
                                 toComp?.type === "phoenix-inverter" || fromComp?.type === "phoenix-inverter" ||
                                 toComp?.type === "inverter" || fromComp?.type === "inverter";
                
                // For AC wires, use AC voltage (110V/120V/220V/230V); for DC wires, use component voltage or system voltage
                let voltage = isACWire ? getACVoltage(toComp || fromComp) : systemVoltage;
                if (!isACWire) {
                  if (fromComp?.properties?.voltage) {
                    voltage = fromComp.properties.voltage;
                  } else if (toComp?.properties?.voltage) {
                    voltage = toComp.properties.voltage;
                  }
                }
                
                // Check if this is an inverter DC connection (dc-positive or dc-negative terminal)
                const isInverterDC = (fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter") &&
                                      (wire.fromTerminal === "dc-positive" || wire.fromTerminal === "dc-negative") ||
                                      (toComp?.type === "multiplus" || toComp?.type === "phoenix-inverter" || toComp?.type === "inverter") &&
                                      (wire.toTerminal === "dc-positive" || wire.toTerminal === "dc-negative");
                
                // Calculate current from load if not set
                if (current === 0) {
                  // For inverter DC connections, calculate from connected AC loads
                  if (isInverterDC) {
                    const inverterId = fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter" || fromComp?.type === "inverter"
                      ? fromComp.id
                      : toComp?.id;
                    if (inverterId && bestDesign.components && bestDesign.wires) {
                      const inverterDC = calculateInverterDCInput(inverterId, bestDesign.components, bestDesign.wires, systemVoltage);
                      current = inverterDC.dcCurrent;
                    }
                  } else if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                    const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                    // AC loads use AC voltage (110V/120V/220V/230V), DC loads use component voltage or system voltage
                    const loadVoltage = toComp.type === "ac-load" ? getACVoltage(toComp) : (toComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                    const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                    // AC loads use AC voltage (110V/120V/220V/230V), DC loads use component voltage or system voltage
                    const loadVoltage = fromComp.type === "ac-load" ? getACVoltage(fromComp) : (fromComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  }
                }
                
                if (current > 0 && wire.length) {
                  const calc = calculateWireSize({
                    current,
                    length: wire.length,
                    voltage,
                    conductorMaterial: (wire as any).conductorMaterial || "copper",
                    currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
                  });
                  
                  wireCalculations.push({
                    wireId: wire.id,
                    fromComponent: fromComp?.name || wire.fromComponentId,
                    toComponent: toComp?.name || wire.toComponentId,
                    currentGauge: wire.gauge,
                    recommendedGauge: calc.recommendedGauge,
                    voltageDrop: calc.voltageDropPercent,
                    current,
                    length: wire.length,
                    status: calc.status,
                    message: calc.message,
                  });
                }
              } catch (err) {
                // Skip wires that can't be calculated
              }
            }
          }
          
          // Build wire sizing feedback
          const wireSizingIssues: string[] = [];
          wireCalculations.forEach((calc: any) => {
            if (calc.currentGauge !== calc.recommendedGauge) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% voltage drop)`
              );
            }
            if (calc.voltageDrop > 3) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
              );
            } else if (calc.voltageDrop > 2.5) {
              wireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
              );
            }
          });
          
          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
- Errors: ${validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message).join(', ')}
- Warnings: ${validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message).join(', ')}
${wireSizingIssues.length > 0 ? `- Wire Sizing Issues:\n  ${wireSizingIssues.map(i => `  • ${i}`).join('\n')}` : ''}
- Suggestions: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ')}

Please address these issues in your next design. Pay special attention to wire gauge sizing based on current and voltage drop calculations.`;
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
6. Wire gauge sizing - CRITICAL: You MUST calculate gauge based on BOTH current AND voltage drop:
   - Calculate current from load: I = P / V (watts / voltage)
   - For each wire, calculate required gauge using: current, length, and 3% max voltage drop
   - Example calculations:
     * 50W load at 12V = 4.17A. For 10ft run: needs "10 AWG" (handles 35A, <3% drop)
     * 1000W load at 12V = 83.3A. For 10ft run: needs "2 AWG" (handles 115A, <3% drop)
     * 2000W inverter at 12V = 166.7A. For 5ft run: needs "1/0 AWG" (handles 150A, <3% drop)
   - Quick reference (for SHORT runs <5ft only):
     * 0-25A: "10 AWG"
     * 25-40A: "8 AWG"
     * 40-60A: "6 AWG"
     * 60-100A: "4 AWG"
     * 100-150A: "2 AWG"
     * 150-200A: "1 AWG"
     * 200-250A: "1/0 AWG"
     * 250-300A: "2/0 AWG"
   - For LONGER runs, use LARGER gauge to keep voltage drop <3%
   - ALWAYS err on the side of larger gauge for safety
   - Wire gauge format: "10 AWG" (with space between number and AWG)
7. Wire length defaults (canvas is logical, not physical - use these defaults):
   - Battery to fuse: 2 feet
   - Battery to SmartShunt: 3 feet
   - Battery to bus bar: 5 feet
   - Battery to other: 8 feet
   - Solar panel to MPPT: 25 feet
   - Solar panel to other: 15 feet
   - Fuse to bus bar: 10 feet
   - Fuse to other: 5 feet
   - Bus bar to loads: 10 feet
   - Bus bar to other: 8 feet
   - MPPT to bus bar: 8 feet
   - MPPT to battery: 5 feet
   - Loads to bus bar: 10 feet
   - Loads to inverter: 5 feet
   - Inverter to bus bar: 8 feet
   - Inverter to battery: 5 feet
   - Charger to battery: 5 feet
   - Charger to bus bar: 8 feet
   - SmartShunt to bus bar: 8 feet
   - Default for other connections: 10 feet

⚠️⚠️⚠️ COMPONENT PROPERTIES - REQUIRED FOR ALL COMPONENTS (VALIDATION WILL FAIL WITHOUT THEM):
EVERY component MUST include a "properties" object. Missing properties = INVALID design.

DC Loads (dc-load) - "properties": {"watts": <number>} REQUIRED:
- LED Lights: 10-50W
- Refrigerator: 50-150W
- Water Pump: 40-100W
- Fans/Ventilation: 10-30W
- Electronics/USB: 10-50W
- Cabin Outlets: 100-500W (multiple devices)
✅ CORRECT: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "x": 100, "y": 100, "properties": {"watts": 30}}
❌ WRONG: {"id": "load-1", "type": "dc-load", "name": "LED Lights", "x": 100, "y": 100} (MISSING properties!)

AC Loads (ac-load) - "properties": {"watts": <number>} REQUIRED:
- Microwave: 1000-1500W
- Coffee Maker: 800-1200W
- TV/Monitor: 100-300W
- AC Outlets: 500-2000W (multiple devices)
- Air Conditioner: 1000-1800W
✅ CORRECT: {"id": "load-2", "type": "ac-load", "name": "Cabin AC Outlets", "x": 200, "y": 200, "properties": {"watts": 1500}}
❌ WRONG: {"id": "load-2", "type": "ac-load", "name": "Cabin AC Outlets", "x": 200, "y": 200} (MISSING properties!)

Other Components - ALL need properties:
- battery: {"voltage": 12, "capacity": 400}
- solar-panel: {"watts": 300}
- mppt: {"maxCurrent": 50}
- multiplus: {"powerRating": 3000}

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

⚠️ CRITICAL: Respond with ONLY valid JSON. NO explanations. NO text outside the JSON structure.
⚠️ EVERY component MUST have a "properties" field with realistic values (watts for loads, capacity for batteries, etc.)

JSON RESPONSE FORMAT (FOLLOW THIS EXACTLY):
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "House Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "solar-1", "type": "solar-panel", "name": "Solar Panel", "x": 150, "y": 100, "properties": {"watts": 300}},
    {"id": "load-dc-1", "type": "dc-load", "name": "LED Cabin Lights", "x": 450, "y": 400, "properties": {"watts": 50}},
    {"id": "load-ac-1", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5}
  ],
  "description": "Brief system description",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

        const userMessage = iteration === 0
          ? prompt
          : `${prompt}\n\nImprove the previous design based on the feedback above.`;

        // Store full messages for observability (update on each iteration)
        fullSystemMessage = systemMessage;
        fullUserMessage = userMessage;

        // Send event that we're starting AI request
        sendEvent('ai-request-start', {
          iteration: iteration + 1,
          promptLength: userMessage.length,
          systemMessageLength: systemMessage.length
        });

        // Stream the AI response
        const stream = await openai.chat.completions.create({
          model: "gpt-5.1-chat-latest",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userMessage }
          ],
          max_completion_tokens: 4000,
          stream: true, // Enable streaming
        });

        let content = "";
        let rawResponse = ""; // Store raw response for debugging
        let promptTokens = 0;
        let completionTokens = 0;
        let lastTokenTime = Date.now();
        let tokenBuffer = "";

        // Stream tokens as they arrive
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            rawResponse += delta.content; // Accumulate raw response
            tokenBuffer += delta.content;
            
            // Send token update every 50ms to avoid overwhelming the client
            const now = Date.now();
            if (now - lastTokenTime > 50) {
              sendEvent('ai-token', {
                iteration: iteration + 1,
                token: tokenBuffer,
                accumulatedLength: content.length
              });
              tokenBuffer = "";
              lastTokenTime = now;
            }
          }
          
          // Track token usage (may come in final chunk)
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens || promptTokens;
            completionTokens = chunk.usage.completion_tokens || completionTokens;
          }
        }

        // Send any remaining buffered tokens
        if (tokenBuffer) {
          sendEvent('ai-token', {
            iteration: iteration + 1,
            token: tokenBuffer,
            accumulatedLength: content.length
          });
        }

        // Send final token count
        sendEvent('ai-response-complete', {
          iteration: iteration + 1,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          responseLength: content.length
        });

        if (!content) {
          console.error(`[SSE] Iteration ${iteration + 1}: Empty response from AI`);
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: "Empty response from AI"
          });
          continue;
        }

        let response: AISystemResponse;
        try {
          const extracted = extractJSON(content);
          response = JSON.parse(extracted);
        } catch (err: any) {
          console.error(`[SSE] Iteration ${iteration + 1}: Failed to parse AI response - AI returned: ${content.substring(0, 500)}...`);
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: `Invalid JSON: ${err.message}`
          });
          continue;
        }

        // Check if response has components
        if (!response.components || !Array.isArray(response.components) || response.components.length === 0) {
          console.error(`[SSE] Iteration ${iteration + 1}: No components in response`);
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: "No components generated"
          });
          continue;
        }

        // Validate the design
        let validation;
        try {
          validation = validateDesign(
            response.components,
            response.wires || [],
            systemVoltage
          );
        } catch (err: any) {
          console.error(`[SSE] Iteration ${iteration + 1}: Validation error:`, err);
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: `Validation error: ${err.message}`
          });
          continue;
        }

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

        // Update best design if this is better, or if we don't have one yet
        if (validation.score > bestScore || !bestDesign) {
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
          // Calculate wire sizing for observability (reuse same logic as feedback)
          const wireCalculationsForObs: any[] = [];
          if (response.wires) {
            for (const wire of response.wires) {
              try {
                const fromComp = response.components?.find((c: any) => c.id === wire.fromComponentId);
                const toComp = response.components?.find((c: any) => c.id === wire.toComponentId);
                
                let current = wire.current || 0;
                let voltage = systemVoltage;
                
                if (fromComp?.properties?.voltage) {
                  voltage = fromComp.properties.voltage;
                } else if (toComp?.properties?.voltage) {
                  voltage = toComp.properties.voltage;
                }
                
                // Determine if this is an AC wire
                const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                                 toComp?.type === "ac-load" || fromComp?.type === "ac-load" ||
                                 toComp?.type === "ac-panel" || fromComp?.type === "ac-panel" ||
                                 toComp?.type === "multiplus" || fromComp?.type === "multiplus" ||
                                 toComp?.type === "phoenix-inverter" || fromComp?.type === "phoenix-inverter" ||
                                 toComp?.type === "inverter" || fromComp?.type === "inverter";
                
                // For AC wires, use 120V
                if (isACWire) {
                  voltage = 120;
                }
                
                if (current === 0) {
                  if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                    const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                    // AC loads use 120V, DC loads use component voltage or system voltage
                    const loadVoltage = toComp.type === "ac-load" ? 120 : (toComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                    const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                    // AC loads use 120V, DC loads use component voltage or system voltage
                    const loadVoltage = fromComp.type === "ac-load" ? 120 : (fromComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  }
                }
                
                if (current > 0 && wire.length) {
                  const calc = calculateWireSize({
                    current,
                    length: wire.length,
                    voltage,
                    conductorMaterial: (wire as any).conductorMaterial || "copper",
                    currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
                  });
                  
                  wireCalculationsForObs.push({
                    wireId: wire.id,
                    fromComponent: fromComp?.name || wire.fromComponentId,
                    toComponent: toComp?.name || wire.toComponentId,
                    currentGauge: wire.gauge,
                    recommendedGauge: calc.recommendedGauge,
                    voltageDrop: calc.voltageDropPercent,
                    current,
                    length: wire.length,
                  });
                }
              } catch (err) {
                // Skip wires that can't be calculated
              }
            }
          }

          // Build wire sizing issues for observability
          const currentWireSizingIssues: string[] = [];
          wireCalculationsForObs.forEach((calc: any) => {
            if (calc.currentGauge !== calc.recommendedGauge) {
              currentWireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% voltage drop)`
              );
            }
            if (calc.voltageDrop > 3) {
              currentWireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
              );
            } else if (calc.voltageDrop > 2.5) {
              currentWireSizingIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
              );
            }
          });

          // Build validation feedback for observability
          const validationFeedback = {
            score: validation.score,
            errors: validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message),
            warnings: validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message),
            wireSizingIssues: currentWireSizingIssues,
            suggestions: validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion),
          };

          // Log success to observability with full debugging info
          await observabilityStorage.logAIRequest({
            visitorId,
            userId: user?.id,
            userEmail: user?.email,
            ip: clientIP,
            action: "iterate-design",
            prompt,
            systemVoltage,
            success: true,
            durationMs: Date.now() - startTime,
            iterations: iteration + 1,
            qualityScore: validation.score,
            componentCount: bestDesign.components?.length || 0,
            wireCount: bestDesign.wires?.length || 0,
            model: "gpt-5.1-chat-latest",
            systemMessage: fullSystemMessage,
            userMessage: fullUserMessage,
            rawResponse: rawResponse,
            validationFeedback,
            iterationHistory: iterationHistory.map((h: any) => ({
              iteration: h.iteration,
              score: h.score,
              errorCount: h.errorCount,
              warningCount: h.warningCount,
            })),
            response: {
              components: bestDesign.components,
              wires: bestDesign.wires,
              description: bestDesign.description,
              recommendations: bestDesign.recommendations,
            },
          });
          
          sendEvent('complete', {
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            achievedQualityThreshold: true
          });
          res.end();
          return;
        }
        } catch (iterationError: any) {
          // Log iteration error but continue to next iteration
          console.error(`[SSE] Iteration ${iteration + 1} failed:`, iterationError);
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: iterationError.message || "Iteration failed"
          });
          // Continue to next iteration - don't break the loop
        }
      }

      // Return best design after max iterations
      if (!bestDesign || !bestDesign.components || bestDesign.components.length === 0) {
        console.log('[SSE] All iterations failed - no valid design generated');
        console.log('[SSE] Iteration history:', JSON.stringify(iterationHistory, null, 2));
        
        // Log failure to observability with full debugging info
        await observabilityStorage.logAIRequest({
          visitorId,
          userId: user?.id,
          userEmail: user?.email,
          ip: clientIP,
          action: "iterate-design",
          prompt,
          systemVoltage,
          success: false,
          durationMs: Date.now() - startTime,
          iterations: maxIterations,
          errorMessage: "All iterations failed - no valid design generated. Check iteration history for details.",
          model: "gpt-5.1-chat-latest",
          systemMessage: fullSystemMessage,
          userMessage: fullUserMessage,
          iterationHistory: iterationHistory,
        });
        
        sendEvent('error', {
          error: 'Failed to generate a valid design after all iterations. Check iteration history for details.',
          iterationHistory,
          finalIteration: maxIterations
        });
        res.end();
        return;
      }

      // Calculate wire sizing for final observability log
      const finalWireCalculations: any[] = [];
      if (bestDesign.wires) {
        for (const wire of bestDesign.wires) {
          try {
            const fromComp = bestDesign.components?.find((c: any) => c.id === wire.fromComponentId);
            const toComp = bestDesign.components?.find((c: any) => c.id === wire.toComponentId);
            
            let current = wire.current || 0;
            let voltage = systemVoltage;
            
            if (fromComp?.properties?.voltage) {
              voltage = fromComp.properties.voltage;
            } else if (toComp?.properties?.voltage) {
              voltage = toComp.properties.voltage;
            }
            
            // Determine if this is an AC wire
            const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                             toComp?.type === "ac-load" || fromComp?.type === "ac-load" ||
                             toComp?.type === "ac-panel" || fromComp?.type === "ac-panel" ||
                             toComp?.type === "multiplus" || fromComp?.type === "multiplus" ||
                             toComp?.type === "phoenix-inverter" || fromComp?.type === "phoenix-inverter" ||
                             toComp?.type === "inverter" || fromComp?.type === "inverter";
            
            // For AC wires, use 120V
            if (isACWire) {
              voltage = 120;
            }
            
            if (current === 0) {
              if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                // AC loads use 120V, DC loads use component voltage or system voltage
                const loadVoltage = toComp.type === "ac-load" ? 120 : (toComp.properties?.voltage as number || voltage);
                if (loadWatts > 0 && loadVoltage > 0) {
                  current = loadWatts / loadVoltage;
                }
              } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                // AC loads use 120V, DC loads use component voltage or system voltage
                const loadVoltage = fromComp.type === "ac-load" ? 120 : (fromComp.properties?.voltage as number || voltage);
                if (loadWatts > 0 && loadVoltage > 0) {
                  current = loadWatts / loadVoltage;
                }
              }
            }
            
            if (current > 0 && wire.length) {
              const calc = calculateWireSize({
                current,
                length: wire.length,
                voltage,
                conductorMaterial: (wire as any).conductorMaterial || "copper",
                currentGauge: wire.gauge, // Pass current gauge to prevent recommending smaller
              });
              
              finalWireCalculations.push({
                wireId: wire.id,
                fromComponent: fromComp?.name || wire.fromComponentId,
                toComponent: toComp?.name || wire.toComponentId,
                currentGauge: wire.gauge,
                recommendedGauge: calc.recommendedGauge,
                voltageDrop: calc.voltageDropPercent,
                current,
                length: wire.length,
              });
            }
          } catch (err) {
            // Skip wires that can't be calculated
          }
        }
      }

      // Build final wire sizing issues
      const finalWireSizingIssues: string[] = [];
      finalWireCalculations.forEach((calc: any) => {
        if (calc.currentGauge !== calc.recommendedGauge) {
          finalWireSizingIssues.push(
            `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% voltage drop)`
          );
        }
        if (calc.voltageDrop > 3) {
          finalWireSizingIssues.push(
            `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
          );
        } else if (calc.voltageDrop > 2.5) {
          finalWireSizingIssues.push(
            `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
          );
        }
      });

      // Build final validation feedback
      const finalValidationFeedback = bestDesign.validation ? {
        score: bestDesign.validation.score,
        errors: bestDesign.validation.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.message),
        warnings: bestDesign.validation.issues.filter((i: any) => i.severity === 'warning').map((i: any) => i.message),
        wireSizingIssues: finalWireSizingIssues,
        suggestions: bestDesign.validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion),
      } : undefined;

      // Log success to observability with full debugging info
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "iterate-design",
        prompt,
        systemVoltage,
        success: true,
        durationMs: Date.now() - startTime,
        iterations: maxIterations,
        qualityScore: bestScore,
        componentCount: bestDesign.components?.length || 0,
        wireCount: bestDesign.wires?.length || 0,
        model: "gpt-5.1-chat-latest",
        systemMessage: fullSystemMessage,
        userMessage: fullUserMessage,
        validationFeedback: finalValidationFeedback,
        iterationHistory: iterationHistory,
        response: {
          components: bestDesign.components,
          wires: bestDesign.wires,
          description: bestDesign.description,
          recommendations: bestDesign.recommendations,
        },
      });

      sendEvent('complete', {
        ...bestDesign,
        iterationHistory,
        finalIteration: maxIterations,
        achievedQualityThreshold: bestScore >= minQualityScore
      });
      res.end();

    } catch (error: any) {
      console.error("SSE streaming error:", error);
      
      // Log error to observability
      await observabilityStorage.logAIRequest({
        visitorId,
        userId: user?.id,
        userEmail: user?.email,
        ip: clientIP,
        action: "iterate-design",
        prompt: req.body.prompt || "",
        systemVoltage: req.body.systemVoltage || 12,
        success: false,
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        model: "gpt-5.1-chat-latest",
      });
      
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

  // ==========================================
  // Observability / Admin Analytics Endpoints
  // ==========================================

  // Get overall stats
  app.get("/api/admin/observability/stats", isAdmin, async (req, res) => {
    try {
      const stats = await observabilityStorage.getStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get daily analytics
  app.get("/api/admin/observability/analytics", isAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const analytics = await observabilityStorage.getAnalytics(days);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI action breakdown
  app.get("/api/admin/observability/ai-breakdown", isAdmin, async (req, res) => {
    try {
      const breakdown = await observabilityStorage.getAIActionBreakdown();
      res.json(breakdown);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI logs
  app.get("/api/admin/observability/ai-logs", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = await observabilityStorage.getAILogs(limit, offset);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get sessions
  app.get("/api/admin/observability/sessions", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const sessions = await observabilityStorage.getSessions(limit, offset);
      res.json(sessions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get events
  app.get("/api/admin/observability/events", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const events = await observabilityStorage.getEvents(limit, offset);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get errors
  app.get("/api/admin/observability/errors", isAdmin, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const errors = await observabilityStorage.getErrors(limit, offset);
      res.json(errors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cleanup old data
  app.post("/api/admin/observability/cleanup", isAdmin, async (req, res) => {
    try {
      const retentionDays = parseInt(req.body.retentionDays as string) || 90;
      const result = await observabilityStorage.cleanupOldData(retentionDays);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Track page view (called from client)
  app.post("/api/track/pageview", async (req, res) => {
    try {
      const visitorId = getVisitorId(req);
      const userAgent = req.headers["user-agent"] || "unknown";
      const ip = getClientIP(req);
      const user = req.user as AuthUser | undefined;

      const session = await observabilityStorage.getOrCreateSession(
        visitorId,
        userAgent,
        ip,
        user?.id,
        user?.email
      );

      await observabilityStorage.incrementSessionStats(session.id, 1, 0);

      await observabilityStorage.logEvent({
        sessionId: session.id,
        visitorId,
        userId: user?.id,
        type: "page_view",
        name: req.body.page || "/",
        metadata: req.body.metadata,
      });

      res.json({ success: true, sessionId: session.id });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Track action (called from client)
  app.post("/api/track/action", async (req, res) => {
    try {
      const visitorId = getVisitorId(req);
      const userAgent = req.headers["user-agent"] || "unknown";
      const ip = getClientIP(req);
      const user = req.user as AuthUser | undefined;

      const session = await observabilityStorage.getOrCreateSession(
        visitorId,
        userAgent,
        ip,
        user?.id,
        user?.email
      );

      await observabilityStorage.incrementSessionStats(session.id, 0, 1);

      await observabilityStorage.logEvent({
        sessionId: session.id,
        visitorId,
        userId: user?.id,
        type: req.body.type || "action",
        name: req.body.name,
        metadata: req.body.metadata,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Track client-side error
  app.post("/api/track/error", async (req, res) => {
    try {
      const visitorId = getVisitorId(req);
      const user = req.user as AuthUser | undefined;

      await observabilityStorage.logError({
        visitorId,
        userId: user?.id,
        type: "client_error",
        message: req.body.message || "Unknown error",
        stack: req.body.stack,
        metadata: req.body.metadata,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
