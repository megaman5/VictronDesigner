import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { feedbackStorage } from "./feedback-storage";
import { userDesignsStorage } from "./user-designs-storage";
import { observabilityStorage } from "./observability-storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest, type AISystemResponse } from "@shared/schema";
import { DEVICE_DEFINITIONS } from "@shared/device-definitions";
import { calculateWireSize, calculateLoadRequirements, getACVoltage, calculateInverterDCInput } from "./wire-calculator";
import { calculateRuntimeEstimates } from "./runtime-calculator";
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
      const { components, systemVoltage = 12 } = req.body;
      const calculation = calculateLoadRequirements(components, systemVoltage);
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

      // Ensure all wires have unique IDs for proper validation
      const wiresWithIds = wires.map((wire: any, index: number) => ({
        ...wire,
        id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
      }));

      const validation = validateDesign(components, wiresWithIds, systemVoltage);
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
            { id: "solar-1", type: "solar-panel", name: "Solar Array", x: 400, y: 100, properties: { watts: 400, voltage: 18 } },
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
        model: "gpt-5.2-chat-latest",
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
- alternator: 140×120px (vehicle alternator - use with Orion DC-DC)
- shore-power: 140×100px (AC power source for boats/RVs)
- orion-dc-dc: 160×120px (DC-DC charger for alternator charging)
- blue-smart-charger: 140×120px (AC shore charger)
- transfer-switch: 180×140px (switches between AC sources)
- ac-load: 100×100px
- dc-load: 100×100px
- busbar-positive: 200×60px
- busbar-negative: 200×60px
- fuse: 80×60px
- switch: 80×80px
- breaker-panel: 160×200px
- ac-panel: 180×220px
- dc-panel: 160×240px
- phoenix-inverter: 160×130px
- inverter: 160×120px (generic inverter)

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
- alternator: { "amps": <output current 60-200A>, "voltage": <12 or 24> }
- orion-dc-dc: { "amps": <charge current 12-50A>, "voltage": <12 or 24> }
- blue-smart-charger: { "amps": <charge current 15-30A>, "voltage": <12 or 24> }
- shore-power: { "voltage": <120 or 230>, "maxAmps": <15/30/50A> }
- inverter: { "watts": <power rating 1000-3000W> }
- transfer-switch: { "switchType": "automatic" or "manual" }

ALTERNATOR CHARGING SETUP (for boats/RVs):
When user mentions alternator charging:
1. Add "alternator" component (represents vehicle alternator)
2. Add "orion-dc-dc" component (Orion DC-DC charger)
3. Wire: alternator output-positive → orion input-positive
4. Wire: alternator output-negative → orion input-negative  
5. Wire: orion output-positive → busbar (or battery)
6. Wire: orion output-negative → busbar (or SmartShunt)
7. The Orion isolates and regulates alternator charging to house battery

SHORE POWER SETUP (for boats/RVs):
When user mentions shore power:
1. Add "shore-power" component (AC power source)
2. For charging only: Wire shore-power to blue-smart-charger AC inputs
3. For full AC: Wire shore-power to multiplus AC inputs OR transfer-switch
4. Transfer switch: shore-power → source2 (primary), inverter → source1 (backup)
5. Transfer switch output → AC panel

NEVER use 0 or placeholder values for watts/amps - always provide realistic numbers!

JSON RESPONSE FORMAT:
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "load-1", "type": "dc-load", "name": "Refrigerator", "x": 450, "y": 400, "properties": {"watts": 80}},
    {"id": "load-2", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5},
    {"fromComponentId": "inverter-1", "toComponentId": "ac-panel-1", "fromTerminal": "ac-out-hot", "toTerminal": "main-in-hot", "polarity": "hot", "gauge": "10 AWG", "length": 10},
    {"fromComponentId": "ac-panel-1", "toComponentId": "ac-load-1", "fromTerminal": "load-1-hot", "toTerminal": "hot", "polarity": "hot", "gauge": "10 AWG", "length": 5}
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
        model: "gpt-5.2-chat-latest",
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
        model: "gpt-5.2-chat-latest",
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
      const { 
        components, 
        wires = [],
        systemVoltage = 12,
        validationFeedback = null,
        wireCalculationIssues = [],
        maxIterations = 6,
        minQualityScore = 70
      } = req.body;

      if (!components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ error: "Components array is required" });
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      let bestWires: any[] = [];
      let bestScore = 0;
      let bestValidation: any = null;
      const iterationHistory: any[] = [];
      const existingWires = wires.length > 0 ? wires : [];

      // Iterative improvement loop
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`\n=== AI Wire Iteration ${iteration + 1}/${maxIterations} ===`);

        // If there are existing wires, validate them to get current issues
        let currentValidation = null;
        const wiresToValidate = iteration === 0 ? existingWires : bestWires;
        
        if (wiresToValidate.length > 0) {
          try {
            // Ensure all wires have unique IDs for proper validation
            const wiresWithIds = wiresToValidate.map((wire: any, index: number) => ({
              ...wire,
              id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
            }));
            currentValidation = validateDesign(components, wiresWithIds, systemVoltage);
          } catch (error) {
            console.error("Validation error during AI wire generation:", error);
          }
        }

        // Combine validation feedback from client and server
        const allValidationErrors = [
          ...(iteration === 0 ? (validationFeedback?.errors || []) : []),
          ...(currentValidation?.issues.filter((i: any) => i.severity === "error") || [])
        ];
        const allValidationWarnings = [
          ...(iteration === 0 ? (validationFeedback?.warnings || []) : []),
          ...(currentValidation?.issues.filter((i: any) => i.severity === "warning") || [])
        ];

        // Calculate wire sizing issues for current wires (always calculate, not just after first iteration)
        const currentWireCalculationIssues: any[] = [];
        const wiresToCalculateForIssues = iteration === 0 ? existingWires : (bestWires.length > 0 ? bestWires : []);
        
        if (wiresToCalculateForIssues.length > 0) {
          for (const wire of wiresToCalculateForIssues) {
            try {
              const fromComp = components.find((c: any) => c.id === wire.fromComponentId);
              const toComp = components.find((c: any) => c.id === wire.toComponentId);
              
              let current = wire.current || 0;
              const isACWire = wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground" ||
                               toComp?.type === "ac-load" || fromComp?.type === "ac-load" ||
                               toComp?.type === "ac-panel" || fromComp?.type === "ac-panel" ||
                               toComp?.type === "multiplus" || fromComp?.type === "multiplus" ||
                               toComp?.type === "phoenix-inverter" || fromComp?.type === "phoenix-inverter" ||
                               toComp?.type === "inverter" || fromComp?.type === "inverter";
              
              let voltage = isACWire ? getACVoltage(toComp || fromComp) : systemVoltage;
              if (!isACWire && fromComp?.properties?.voltage) {
                voltage = fromComp.properties.voltage;
              } else if (!isACWire && toComp?.properties?.voltage) {
                voltage = toComp.properties.voltage;
              }
              
              // Calculate current from load if not set
              if (current === 0) {
                // Helper to trace loads through components (similar to design-validator logic)
                const findConnectedLoads = (componentId: string, visited: Set<string> = new Set()): number => {
                  if (visited.has(componentId)) return 0;
                  visited.add(componentId);
                  
                  const comp = components.find((c: any) => c.id === componentId);
                  if (!comp) return 0;
                  
                  // If this is a load, calculate current from it
                  if (comp.type === "dc-load" || comp.type === "ac-load") {
                    const loadWatts = (comp.properties?.watts || comp.properties?.power || 0) as number;
                    const loadVoltage = comp.type === "ac-load" ? getACVoltage(comp) : (comp.properties?.voltage as number || systemVoltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      return loadWatts / loadVoltage;
                    }
                  }
                  
                  // If this is an inverter, calculate DC input from connected AC loads
                  if (comp.type === "multiplus" || comp.type === "phoenix-inverter" || comp.type === "inverter") {
                    const inverterDC = calculateInverterDCInput(comp.id, components, wiresToCalculateForIssues, systemVoltage);
                    if (inverterDC.dcCurrent > 0) {
                      return inverterDC.dcCurrent;
                    }
                  }
                  
                  // For bus bars, sum up current from all connected loads (excluding sources)
                  if (comp.type === "busbar-positive" || comp.type === "busbar-negative") {
                    let totalLoadCurrent = 0;
                    const connectedWires = wiresToCalculateForIssues.filter((w: any) => 
                      w.fromComponentId === componentId || w.toComponentId === componentId
                    );
                    
                    for (const connWire of connectedWires) {
                      const otherCompId = connWire.fromComponentId === componentId 
                        ? connWire.toComponentId 
                        : connWire.fromComponentId;
                      
                      if (visited.has(otherCompId)) continue;
                      
                      const otherComp = components.find((c: any) => c.id === otherCompId);
                      if (!otherComp) continue;
                      
                      // Skip AC loads and AC panels - they're on separate AC system
                      if (otherComp.type === "ac-load" || otherComp.type === "ac-panel") continue;
                      
                      // Skip sources (MPPT, chargers) - they add current, not consume
                      if (otherComp.type === "mppt" || otherComp.type === "blue-smart-charger" || otherComp.type === "orion-dc-dc") continue;
                      
                      // Trace to find loads
                      const foundCurrent = findConnectedLoads(otherCompId, new Set(visited));
                      totalLoadCurrent += foundCurrent;
                    }
                    
                    return totalLoadCurrent;
                  }
                  
                  return 0;
                };
                
                if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                  const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                  const loadVoltage = toComp.type === "ac-load" ? getACVoltage(toComp) : (toComp.properties?.voltage as number || voltage);
                  if (loadWatts > 0 && loadVoltage > 0) {
                    current = loadWatts / loadVoltage;
                  }
                } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                  const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                  const loadVoltage = fromComp.type === "ac-load" ? getACVoltage(fromComp) : (fromComp.properties?.voltage as number || voltage);
                  if (loadWatts > 0 && loadVoltage > 0) {
                    current = loadWatts / loadVoltage;
                  }
                } else if (fromComp?.type === "mppt" || fromComp?.type === "blue-smart-charger") {
                  // For MPPT/charger output wires, use their output current
                  current = fromComp.type === "mppt"
                    ? (fromComp.properties?.maxCurrent || fromComp.properties?.amps || 0) as number
                    : (fromComp.properties?.amps || fromComp.properties?.current || 0) as number;
                } else if (fromComp?.type === "inverter" || fromComp?.type === "multiplus" || fromComp?.type === "phoenix-inverter") {
                  // For inverter AC output wires
                  if (isACWire && (wire.polarity === "hot" || wire.polarity === "neutral")) {
                    const inverterDC = calculateInverterDCInput(fromComp.id, components, wiresToCalculateForIssues, systemVoltage);
                    if (inverterDC.acLoadWatts > 0) {
                      current = inverterDC.acLoadWatts / inverterDC.acVoltage;
                    }
                  } else {
                    // For inverter DC input wires
                    const inverterDC = calculateInverterDCInput(fromComp.id, components, wiresToCalculateForIssues, systemVoltage);
                    if (inverterDC.dcCurrent > 0) {
                      current = inverterDC.dcCurrent;
                    }
                  }
                } else if (toComp?.type === "busbar-positive" || toComp?.type === "busbar-negative" || 
                           fromComp?.type === "busbar-positive" || fromComp?.type === "busbar-negative") {
                  // For bus bar connections, trace to find loads
                  const targetCompId = toComp?.type?.includes("busbar") ? toComp.id : fromComp?.id;
                  if (targetCompId) {
                    current = findConnectedLoads(targetCompId);
                  }
                } else {
                  // Fallback: try tracing from either end
                  if (toComp) {
                    current = findConnectedLoads(toComp.id);
                  }
                  if (current === 0 && fromComp) {
                    current = findConnectedLoads(fromComp.id);
                  }
                }
              }
              
              if (current > 0 && wire.length) {
                const calc = calculateWireSize({
                  current,
                  length: wire.length,
                  voltage,
                  conductorMaterial: (wire as any).conductorMaterial || "copper",
                  currentGauge: wire.gauge,
                });
                
                // Include all wires with issues: errors, warnings, or gauge mismatches
                if (calc.status === "error" || calc.status === "warning" || calc.recommendedGauge !== wire.gauge || calc.voltageDropPercent > 3) {
                  currentWireCalculationIssues.push({
                    wireId: wire.id,
                    fromComponentId: wire.fromComponentId,
                    toComponentId: wire.toComponentId,
                    issue: calc.message || `${calc.status}: Wire sizing issue`,
                    currentGauge: wire.gauge,
                    recommendedGauge: calc.recommendedGauge,
                    current,
                    voltageDrop: calc.voltageDropPercent,
                    status: calc.status,
                  });
                }
              } else if (current === 0 && wire.polarity !== "ground") {
                // Warn about wires with no current detected
                currentWireCalculationIssues.push({
                  wireId: wire.id,
                  fromComponentId: wire.fromComponentId,
                  toComponentId: wire.toComponentId,
                  issue: "Cannot determine current for wire - gauge validation skipped",
                  currentGauge: wire.gauge,
                  recommendedGauge: null,
                  current: 0,
                  voltageDrop: null,
                  status: "warning",
                });
              }
            } catch (err) {
              // Skip wires that can't be calculated
            }
          }
        }

        // Combine wire calculation issues
        const allWireCalculationIssues = iteration === 0 
          ? wireCalculationIssues 
          : currentWireCalculationIssues;

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Build iteration feedback if not first iteration
        let iterationFeedback = "";
        if (iteration > 0 && currentValidation) {
          // Separate wire-related issues from other issues
          const wireErrors = allValidationErrors.filter((e: any) => 
            e.category === "wire-sizing" || e.wireId || e.wireIds
          );
          const wireWarnings = allValidationWarnings.filter((w: any) => 
            w.category === "wire-sizing" || w.wireId || w.wireIds
          );
          const nonWireErrors = allValidationErrors.filter((e: any) => 
            e.category !== "wire-sizing" && !e.wireId && !e.wireIds
          );
          const nonWireWarnings = allValidationWarnings.filter((w: any) => 
            w.category !== "wire-sizing" && !w.wireId && !w.wireIds
          );
          
          const wireSizingIssues = allWireCalculationIssues.map((issue: any) => 
            `Wire ${issue.fromComponentId} → ${issue.toComponentId}: ${issue.issue}${issue.currentGauge ? ` (Current: ${issue.currentGauge})` : ""}${issue.recommendedGauge ? ` (Recommended: ${issue.recommendedGauge})` : ""}${issue.current ? ` (Current: ${issue.current}A)` : ""}${issue.voltageDrop ? ` (Voltage Drop: ${issue.voltageDrop.toFixed(2)}%)` : ""}`
          ).join("\n");
          
          iterationFeedback = `

PREVIOUS ITERATION FEEDBACK (Iteration ${iteration}, Score: ${currentValidation.score}/100):

${wireErrors.length > 0 ? `WIRE ERRORS (MUST FIX):
${wireErrors.map((e: any, i: number) => `${i + 1}. ${e.message}${e.suggestion ? ` - Suggestion: ${e.suggestion}` : ""}${e.componentIds ? ` (Components: ${e.componentIds.join(", ")})` : ""}${e.wireId ? ` (Wire ID: ${e.wireId})` : ""}${e.wireIds ? ` (Wire IDs: ${e.wireIds.join(", ")})` : ""}`).join("\n")}
` : ""}
${wireWarnings.length > 0 ? `WIRE WARNINGS (MUST FIX):
${wireWarnings.map((w: any, i: number) => `${i + 1}. ${w.message}${w.suggestion ? ` - Suggestion: ${w.suggestion}` : ""}${w.componentIds ? ` (Components: ${w.componentIds.join(", ")})` : ""}${w.wireId ? ` (Wire ID: ${w.wireId})` : ""}${w.wireIds ? ` (Wire IDs: ${w.wireIds.join(", ")})` : ""}`).join("\n")}
` : ""}
${wireSizingIssues ? `WIRE CALCULATION ISSUES (MUST FIX):
${wireSizingIssues}
` : ""}
${nonWireErrors.length > 0 ? `OTHER ERRORS:
${nonWireErrors.map((e: any, i: number) => `${i + 1}. ${e.message}${e.suggestion ? ` - Suggestion: ${e.suggestion}` : ""}`).join("\n")}
` : ""}
${nonWireWarnings.length > 0 ? `OTHER WARNINGS:
${nonWireWarnings.map((w: any, i: number) => `${i + 1}. ${w.message}${w.suggestion ? ` - Suggestion: ${w.suggestion}` : ""}`).join("\n")}
` : ""}

CRITICAL: You MUST fix ALL wire errors and wire warnings. Use the recommended wire gauges from wire calculation issues. Update wire gauges based on calculated current and voltage drop requirements.`;
        }

        // Build validation feedback section for AI prompt (all iterations)
        let validationSection = "";
        if (allValidationErrors.length > 0 || allValidationWarnings.length > 0 || allWireCalculationIssues.length > 0) {
          // Separate wire-related issues
          const wireErrors = allValidationErrors.filter((e: any) => 
            e.category === "wire-sizing" || e.wireId || e.wireIds
          );
          const wireWarnings = allValidationWarnings.filter((w: any) => 
            w.category === "wire-sizing" || w.wireId || w.wireIds
          );
          
          validationSection = `

CURRENT DESIGN VALIDATION FEEDBACK (CRITICAL - FIX THESE ISSUES):

${wireErrors.length > 0 ? `WIRE ERRORS (MUST FIX):
${wireErrors.map((e: any, i: number) => `${i + 1}. ${e.message}${e.suggestion ? ` - Suggestion: ${e.suggestion}` : ""}${e.componentIds ? ` (Components: ${e.componentIds.join(", ")})` : ""}${e.wireId ? ` (Wire ID: ${e.wireId})` : ""}${e.wireIds ? ` (Wire IDs: ${e.wireIds.join(", ")})` : ""}`).join("\n")}
` : ""}

${wireWarnings.length > 0 ? `WIRE WARNINGS (MUST FIX):
${wireWarnings.map((w: any, i: number) => `${i + 1}. ${w.message}${w.suggestion ? ` - Suggestion: ${w.suggestion}` : ""}${w.componentIds ? ` (Components: ${w.componentIds.join(", ")})` : ""}${w.wireId ? ` (Wire ID: ${w.wireId})` : ""}${w.wireIds ? ` (Wire IDs: ${w.wireIds.join(", ")})` : ""}`).join("\n")}
` : ""}

${allWireCalculationIssues.length > 0 ? `WIRE CALCULATION ISSUES (MUST FIX):
${allWireCalculationIssues.map((issue: any, i: number) => `${i + 1}. Wire ${issue.fromComponentId} → ${issue.toComponentId}: ${issue.issue}${issue.currentGauge ? ` (Current: ${issue.currentGauge})` : ""}${issue.recommendedGauge ? ` (Recommended: ${issue.recommendedGauge})` : ""}${issue.current ? ` (Current: ${issue.current}A)` : ""}${issue.voltageDrop ? ` (Voltage Drop: ${issue.voltageDrop.toFixed(2)}%)` : ""}`).join("\n")}
` : ""}

${allValidationErrors.filter((e: any) => e.message?.includes("Parallel wire") || e.message?.includes("parallel") || e.message?.includes("Parallel conductors")).length > 0 ? `PARALLEL WIRE ERRORS (CRITICAL - MUST FIX):
${allValidationErrors.filter((e: any) => e.message?.includes("Parallel wire") || e.message?.includes("parallel") || e.message?.includes("Parallel conductors")).map((e: any, i: number) => `${i + 1}. ${e.message}${e.suggestion ? ` - ${e.suggestion}` : ""}${e.wireIds ? ` (Wire IDs: ${e.wireIds.join(", ")})` : ""}`).join("\n")}

CRITICAL PARALLEL WIRE RULES:
- If current ≤230A: REMOVE parallel runs, use single larger gauge wire
- If current >230A: Use parallel runs, but ALL wires must be 4/0 AWG (identical gauges)
- NEVER mix different gauges in parallel runs
- NEVER use parallel runs for currents ≤230A
` : ""}

${allValidationErrors.filter((e: any) => e.category !== "wire-sizing" && !e.wireId && !e.wireIds).length > 0 ? `OTHER ERRORS:
${allValidationErrors.filter((e: any) => e.category !== "wire-sizing" && !e.wireId && !e.wireIds).map((e: any, i: number) => `${i + 1}. ${e.message}${e.suggestion ? ` - Suggestion: ${e.suggestion}` : ""}`).join("\n")}
` : ""}

${allValidationWarnings.filter((w: any) => w.category !== "wire-sizing" && !w.wireId && !w.wireIds).length > 0 ? `OTHER WARNINGS:
${allValidationWarnings.filter((w: any) => w.category !== "wire-sizing" && !w.wireId && !w.wireIds).map((w: any, i: number) => `${i + 1}. ${w.message}${w.suggestion ? ` - Suggestion: ${w.suggestion}` : ""}`).join("\n")}
` : ""}

${currentValidation ? `Current Design Quality Score: ${currentValidation.score}/100` : ""}

CRITICAL: Your generated wires MUST fix ALL wire errors and wire warnings. Pay special attention to:
- Wire gauge sizing (use recommended gauges from wire calculation issues)
- Wire current calculations (ensure all wires have proper current values)
- Voltage drop requirements (keep voltage drop under 3% per ABYC)
- Terminal connection correctness
- Electrical safety rules (fuses, SmartShunt placement, etc.)

WIRE CAPACITY WARNINGS (REDUCE QUALITY SCORE):
- Wires running at >90% capacity will generate warnings and reduce quality score
- If you see "running at 95% capacity" or "running at 100% capacity" warnings:
  * IMMEDIATELY use the next larger gauge (e.g., 2 AWG → 1 AWG → 1/0 AWG → 2/0 AWG → 3/0 AWG → 4/0 AWG)
  * Example: 2 AWG at 99% → use 1 AWG
  * Example: 3/0 AWG at 100% → use 4/0 AWG
  * Example: 4/0 AWG at 100% → use 2 parallel 4/0 AWG wires (divide current by 2)
- These warnings prevent achieving high quality scores (>90)
- Fix capacity warnings in early iterations to improve quality faster

PARALLEL WIRE RUNS - STRICT RULES (NEC/ABYC - CRITICAL):
- ONLY create parallel wire runs when current exceeds 230A (4/0 AWG max capacity)
- NEVER create parallel runs for currents ≤230A - use single larger gauge instead
- ALL parallel conductors MUST be 4/0 AWG (per NEC/ABYC standard practice)
- NEVER mix different gauges in parallel runs (e.g., don't use 2 AWG + 1 AWG in parallel)
- When creating parallel runs, each wire must have the SAME gauge (all 4/0 AWG)
- Each parallel wire's "current" field should be the TOTAL current (system divides automatically)
- Example CORRECT: 300A load → 2 parallel 4/0 AWG wires, each wire has current: 300 (system calculates 150A per wire automatically)
- Example CORRECT: 238A load → 2 parallel 4/0 AWG wires, each wire has current: 238 (system calculates 119A per wire automatically)
- CRITICAL: When creating parallel wires, set current field to TOTAL current on EACH wire (don't divide it yourself)
- Example WRONG: 200A load → 2 parallel 2/0 AWG wires (should use single 4/0 AWG instead)
- Example WRONG: 100A load → 2 parallel 1/0 AWG wires (should use single 2 AWG or 1 AWG instead)
- Example WRONG: 16.7A load → 3 parallel 6 AWG wires (should use single 10 AWG instead)
- If you see errors about "insufficient for XA" where X > 230A, use parallel 4/0 AWG runs
- If you see errors about "Parallel wire runs used for XA" where X ≤ 230A, REMOVE parallel runs and use single gauge

QUALITY IMPROVEMENT GUIDELINES:
- For complex systems with multiple components, prioritize clean organization:
  * Use bus bars to consolidate connections (3+ connections to same component type)
  * Distribute connections across bus bar terminals (pos-1, pos-2, pos-3, etc.) for better organization
  * Avoid daisy-chaining when bus bars would be cleaner
- WIRE CAPACITY MANAGEMENT (CRITICAL FOR QUALITY):
  * NEVER size wires at >90% of their ampacity - always leave 10-20% safety margin
  * If a wire would run at >90% capacity, use the next larger gauge
  * Example: 190A load → use 2/0 AWG (175A max) OR 3/0 AWG (200A max)
  * Example: 200A load → use 3/0 AWG (200A max) OR 4/0 AWG (230A max)
  * ONLY use parallel wire runs when you've reached 4/0 AWG (230A) and still need more capacity
  * Parallel runs require each conductor to be at least 1/0 AWG per NEC/ABYC
  * Example: 300A load → use 2 parallel 4/0 AWG wires (150A each) since single 4/0 AWG maxes at 230A
  * Wires at 95-100% capacity will generate warnings and reduce quality score
- When multiple parallel wires exist between the same components:
  * Each wire carries total current ÷ number of parallel wires
  * Calculate current per wire correctly (e.g., 154.3A total ÷ 2 wires = 77.1A per wire)
  * Size each wire based on its per-wire current, not total current
- For high current applications exceeding 4/0 AWG capacity (230A), use parallel wire runs:
  * ONLY suggest parallel runs when single 4/0 AWG (230A max) is insufficient
  * Each parallel conductor must be at least 1/0 AWG per NEC/ABYC requirements
  * Use multiple 4/0 AWG wires in parallel for currents >230A
  * Example: 300A load → use 2 parallel 4/0 AWG wires (150A each, 230A max per wire = 65% capacity)
  * Example: 400A load → use 2 parallel 4/0 AWG wires (200A each, 230A max = 87% capacity)
- Ground wire gauge matching is CRITICAL:
  * Always match ground gauge to hot/neutral in the same circuit
  * This is a safety requirement and will cause validation errors if violated

`;
        }

      const completion = await openai.chat.completions.create({
        model: "gpt-5.2-chat-latest",
        messages: [
          {
            role: "system",
            content: `You are an expert Victron electrical system designer. Your task is to create wire connections for a set of components that a user has already placed on a canvas.

CRITICAL INSTRUCTION: If the user provides existing wires, you MUST preserve ALL existing wires that are correct. Only generate NEW wires for:
1. Missing connections that are needed
2. Wires that have errors (you'll see these in the validation feedback)
3. Wires that need to be fixed based on validation warnings

DO NOT regenerate wires that are already correct and have no errors. Preserve the existing wire structure and only add/fix what's needed.${validationSection}${iterationFeedback}

COMPONENT TERMINALS (EXACT NAMES):
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "power-positive", "power-negative", "ve-bus", "ve-direct", "ve-can"
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
- ac-panel: "main-in-hot", "main-in-neutral", "main-in-ground", "load-1-hot", "load-1-neutral", "load-1-ground", "load-2-hot", "load-2-neutral", "load-2-ground"
- dc-panel: "main-in-pos", "main-in-neg", "load-1-pos", "load-1-neg", "load-2-pos", "load-2-neg", "load-3-pos", "load-3-neg"
- shore-power: "ac-out-hot", "ac-out-neutral", "ac-out-ground"
- transfer-switch: "source1-hot", "source1-neutral", "source1-ground", "source2-hot", "source2-neutral", "source2-ground", "output-hot", "output-neutral", "output-ground"

WIRE REQUIREMENTS (ALL FIELDS MANDATORY):
EVERY wire must have these exact fields:
{
  "fromComponentId": "battery-1",
  "toComponentId": "mppt-1",
  "fromTerminal": "positive",
  "toTerminal": "batt-positive",
  "polarity": "positive",
  "gauge": "10 AWG",
  "length": 5,
  "current": 25.0
}

IMPORTANT: Include "current" field in amps for ALL wires. Calculate current based on:
- For load wires: Load watts / voltage (e.g., 1200W / 120V AC = 10A)
- For inverter DC input: Calculate from connected AC loads (AC watts / AC voltage / 0.875 efficiency)
- For MPPT output: Use MPPT maxCurrent property
- For bus bar wires: Sum all connected loads (trace through bus bar to find total load current)
- For AC wires: Use AC voltage (110V/120V/220V/230V), not DC system voltage
- For ground wires: Set current to 0 (ground carries no current under normal conditions)
- For parallel wires: Current field should be TOTAL current (will be divided by parallel count automatically)
  * Example: 2 parallel wires with 154.3A total load → each wire has current: 154.3 (system divides by 2)
  * The validation system automatically divides by parallel count for per-wire calculations

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
   - Hot wire: From inverter "ac-out-hot" or panel "load-X-hot" to ac-load "hot" → polarity MUST be "hot"
   - Neutral wire: From inverter "ac-out-neutral" or panel "load-X-neutral" to ac-load "neutral" → polarity MUST be "neutral"
   - Ground wire: From inverter "ac-out-ground" or panel "load-X-ground" to ac-load "ground" → polarity MUST be "ground"
   - CRITICAL: The polarity field MUST match the terminal type (hot/neutral/ground), NOT "positive" or "negative"
8. GROUND WIRE GAUGE MATCHING (NEC/ABYC REQUIREMENT - CRITICAL):
   - Ground wires MUST ALWAYS match the gauge of hot/neutral wires in the SAME circuit
   - If hot wire is "8 AWG", ground wire MUST be "8 AWG" (NOT "10 AWG" or any other gauge)
   - If neutral wire is "10 AWG", ground wire MUST be "10 AWG"
   - This applies to ALL AC circuits: shore power, inverter outputs, AC panels, AC loads
   - Example: Shore Power → Charger with hot="8 AWG", neutral="8 AWG", ground MUST be "8 AWG" (not "10 AWG")
   - Example: Inverter → AC Panel with hot="10 AWG", neutral="10 AWG", ground MUST be "10 AWG"
   - FAILURE TO MATCH GROUND GAUGE WILL RESULT IN VALIDATION ERRORS

DEVICE KNOWLEDGE BASE (STRICTLY FOLLOW THESE RULES):
${Object.values(DEVICE_DEFINITIONS).map(d => `
${d.name.toUpperCase()} (${d.type}):
- Terminals: ${d.terminals.map(t => `${t.id} (${t.type})`).join(", ")}
- Rules:
${d.wiringRules.map(r => `  * ${r}`).join("\n")}
`).join("\n")}

WIRE GAUGE SELECTION (with safety margins):
- 0-20A: 10 AWG (20% margin)
- 20-35A: 8 AWG (20% margin)
- 35-50A: 6 AWG (20% margin)
- 50-80A: 4 AWG (20% margin)
- 80-115A: 2 AWG (20% margin)
- 115-150A: 1 AWG (20% margin)
- 150-180A: 1/0 AWG (20% margin)
- 180-200A: 2/0 AWG (20% margin)
- 200-230A: Use 4/0 AWG (230A max)
- 230A+: Use parallel runs of 4/0 AWG (each parallel conductor must be at least 1/0 AWG per NEC/ABYC)

CRITICAL: Avoid wires running at >90% capacity. If current approaches wire limit:
- Use next larger gauge (e.g., if 2 AWG at 95%, use 1 AWG → 1/0 AWG → 2/0 AWG → 3/0 AWG → 4/0 AWG)
- ONLY use parallel wire runs when 4/0 AWG (230A max) is insufficient
- Per NEC/ABYC: Parallel conductors must be at least 1/0 AWG
- Example: 200A load → use 4/0 AWG (230A max = 87% capacity)
- Example: 300A load → use 2 parallel 4/0 AWG wires (150A each, 230A max per wire = 65% capacity)

CRITICAL: For AC circuits with hot, neutral, and ground wires:
- Calculate gauge based on current for hot/neutral wires
- Ground wire MUST use the EXACT SAME gauge as hot/neutral wires in the same circuit
- NEVER use a different gauge for ground wire (e.g., if hot="8 AWG", ground MUST be "8 AWG", not "10 AWG")
- This is a NEC/ABYC safety requirement and will cause validation errors if violated

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
    {"fromComponentId": "battery-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "batt-positive", "polarity": "positive", "gauge": "10 AWG", "length": 5},
    {"fromComponentId": "inverter-1", "toComponentId": "ac-panel-1", "fromTerminal": "ac-out-hot", "toTerminal": "main-in-hot", "polarity": "hot", "gauge": "10 AWG", "length": 10},
    {"fromComponentId": "ac-panel-1", "toComponentId": "ac-load-1", "fromTerminal": "load-1-hot", "toTerminal": "hot", "polarity": "hot", "gauge": "10 AWG", "length": 5},
    {"fromComponentId": "ac-panel-1", "toComponentId": "ac-load-1", "fromTerminal": "load-1-neutral", "toTerminal": "neutral", "polarity": "neutral", "gauge": "10 AWG", "length": 5},
    {"fromComponentId": "ac-panel-1", "toComponentId": "ac-load-1", "fromTerminal": "load-1-ground", "toTerminal": "ground", "polarity": "ground", "gauge": "10 AWG", "length": 5}
  ],
  "description": "Brief description of the wiring strategy",
  "recommendations": ["Wiring tip 1", "Wiring tip 2"]
}

CRITICAL: For AC wires, the polarity field MUST match the terminal type:
- Terminal ends with "-hot" or contains "hot" → polarity: "hot"
- Terminal ends with "-neutral" or contains "neutral" → polarity: "neutral"  
- Terminal ends with "-ground" or contains "ground" → polarity: "ground"
- Terminal is "positive" or "negative" → polarity: "positive" or "negative" (for DC)`,
          },
          {
            role: "user",
            content: `Create wiring connections for these ${systemVoltage}V components: ${JSON.stringify(components)}${wires.length > 0 ? `\n\nExisting wires (review and improve if needed): ${JSON.stringify(wires)}` : ""}`,
          },
        ],
        response_format: { type: "json_object" },
      });

        const response = JSON.parse(extractJSON(completion.choices[0].message.content || "{}"));

        console.log(`AI Wire Generation Response (Iteration ${iteration + 1}):`, JSON.stringify(response, null, 2));
        console.log(`Generated wires count: ${response.wires?.length || 0}`);

        // Post-process wires to ensure polarity matches terminal names (fix any missing/mismatched polarities)
        if (response.wires && Array.isArray(response.wires)) {
          response.wires = response.wires.map((wire: any) => {
            // If polarity is missing or doesn't match terminal type, infer from terminal names
            const fromTerm = wire.fromTerminal || "";
            const toTerm = wire.toTerminal || "";
            
            // Check for AC wire indicators in terminal names
            if (fromTerm.includes("hot") || toTerm.includes("hot") || fromTerm === "hot" || toTerm === "hot") {
              if (!wire.polarity || wire.polarity === "positive" || wire.polarity === "negative") {
                wire.polarity = "hot";
              }
            } else if (fromTerm.includes("neutral") || toTerm.includes("neutral") || fromTerm === "neutral" || toTerm === "neutral") {
              if (!wire.polarity || wire.polarity === "positive" || wire.polarity === "negative") {
                wire.polarity = "neutral";
              }
            } else if (fromTerm.includes("ground") || toTerm.includes("ground") || fromTerm === "ground" || toTerm === "ground") {
              if (!wire.polarity || wire.polarity === "positive" || wire.polarity === "negative") {
                wire.polarity = "ground";
              }
            } else if (!wire.polarity) {
              // Default to positive for DC wires if polarity is missing
              if (fromTerm.includes("negative") || toTerm.includes("negative") || fromTerm === "negative" || toTerm === "negative") {
                wire.polarity = "negative";
              } else {
                wire.polarity = "positive";
              }
            }
            
            return wire;
          });
        }

        // Merge with existing wires (preserve valid ones)
        let mergedWires: any[] = [];
        if (iteration === 0 && existingWires.length > 0) {
          // First iteration: merge AI wires with existing wires
          const newWireMap = new Map<string, any>();
          (response.wires || []).forEach((wire: any) => {
            const key = `${wire.fromComponentId}:${wire.fromTerminal}→${wire.toComponentId}:${wire.toTerminal}`;
            newWireMap.set(key, wire);
          });
          
          // Keep existing wires that don't conflict with new ones
          const existingWireKeys = new Set(
            existingWires.map((w: any) => `${w.fromComponentId}:${w.fromTerminal}→${w.toComponentId}:${w.toTerminal}`)
          );
          
          const preservedWires = existingWires.filter((w: any) => {
            const key = `${w.fromComponentId}:${w.fromTerminal}→${w.toComponentId}:${w.toTerminal}`;
            return !newWireMap.has(key);
          });
          
          mergedWires = [...preservedWires, ...(response.wires || [])];
        } else {
          // Subsequent iterations: use AI-generated wires
          mergedWires = response.wires || [];
        }

        // Validate the merged wires (ensure all have unique IDs)
        const mergedWiresWithIds = mergedWires.map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));
        let validation = validateDesign(components, mergedWiresWithIds, systemVoltage);
        const score = validation.score;
        
        console.log(`Iteration ${iteration + 1} validation score: ${score}/100`);
        console.log(`Errors: ${validation.issues.filter((i: any) => i.severity === "error").length}, Warnings: ${validation.issues.filter((i: any) => i.severity === "warning").length}`);

        iterationHistory.push({
          iteration: iteration + 1,
          score,
          errorCount: validation.issues.filter((i: any) => i.severity === "error").length,
          warningCount: validation.issues.filter((i: any) => i.severity === "warning").length,
          wireCount: mergedWires.length,
        });

        // Keep track of best result
        if (score > bestScore || (score === bestScore && mergedWires.length > bestWires.length)) {
          bestScore = score;
          bestWires = mergedWires;
          bestValidation = validation;
        }

        // Check for wire-related errors and warnings
        const wireErrors = validation.issues.filter((i: any) => 
          i.severity === "error" && 
          (i.category === "wire-sizing" || i.wireId || i.wireIds)
        );
        const wireWarnings = validation.issues.filter((i: any) => 
          i.severity === "warning" && 
          (i.category === "wire-sizing" || i.wireId || i.wireIds)
        );
        
        // If we've achieved the minimum quality score, no errors, AND no critical wire issues, we're done
        // Allow capacity warnings (95-100%) as they're informational - only stop on errors and critical issues
        const criticalWireWarnings = wireWarnings.filter((w: any) => 
          !w.message?.includes("capacity") && 
          !w.message?.includes("Cannot determine associated hot/neutral wire")
        );
        const criticalWireCalcIssues = allWireCalculationIssues.filter((i: any) => 
          i.status === "error" || 
          (i.status === "warning" && !i.issue?.includes("capacity"))
        );
        
        if (score >= minQualityScore && 
            validation.issues.filter((i: any) => i.severity === "error").length === 0 &&
            criticalWireWarnings.length === 0 &&
            criticalWireCalcIssues.length === 0) {
          console.log(`Achieved target quality score (${score} >= ${minQualityScore}) with no errors and no critical wire issues. Stopping iterations.`);
          break;
        }
        
        // If we have wire errors or critical warnings, we should continue iterating
        if (wireErrors.length > 0 || criticalWireWarnings.length > 0 || criticalWireCalcIssues.length > 0) {
          const capacityWarnings = wireWarnings.filter((w: any) => w.message?.includes("capacity"));
          const parallelErrors = wireErrors.filter((e: any) => e.message?.includes("Parallel wire") || e.message?.includes("parallel"));
          console.log(`Wire issues found: ${wireErrors.length} errors (${parallelErrors.length} parallel), ${criticalWireWarnings.length} critical warnings, ${criticalWireCalcIssues.length} critical calc issues. ${capacityWarnings.length} capacity warnings (informational). Continuing iteration.`);
        } else if (wireWarnings.length > 0) {
          // Only capacity warnings remaining - these are acceptable for early stopping
          console.log(`Only capacity warnings remaining (${wireWarnings.length}). These are informational and acceptable.`);
        }

        // If this is the last iteration, use best result
        if (iteration === maxIterations - 1) {
          console.log(`Reached max iterations. Using best result (score: ${bestScore})`);
          mergedWires = bestWires;
          validation = bestValidation!;
        }
      }

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
        iterations: iterationHistory.length,
        qualityScore: Math.round(bestScore), // Round to integer for database
        componentCount: components.length,
        wireCount: bestWires.length,
        model: "gpt-5.2-chat-latest",
        response: {
          wires: bestWires,
          description: `Wiring generated after ${iterationHistory.length} iteration(s). Quality score: ${bestScore}/100`,
          recommendations: [],
        },
        validationFeedback: {
          score: bestScore,
          errors: bestValidation?.issues.filter((i: any) => i.severity === "error").map((i: any) => i.message) || [],
          warnings: bestValidation?.issues.filter((i: any) => i.severity === "warning").map((i: any) => i.message) || [],
        },
        iterationHistory,
      });

      res.json({
        wires: bestWires,
        description: `Wiring generated after ${iterationHistory.length} iteration(s). Quality score: ${bestScore}/100`,
        recommendations: [],
        iterations: iterationHistory.length,
        qualityScore: bestScore,
        validation: bestValidation,
      });
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
        model: "gpt-5.2-chat-latest",
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
        maxIterations = 5,
        existingDesign // Optional: { components, wires } for iteration mode
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
          
          // Build wire feedback (errors/warnings + calc issues)
          const wireErrors = validation.issues.filter((i: any) =>
            i.severity === "error" && (i.category === "wire-sizing" || i.wireId || i.wireIds)
          );
          const wireWarnings = validation.issues.filter((i: any) =>
            i.severity === "warning" && (i.category === "wire-sizing" || i.wireId || i.wireIds)
          );

          const wireCalcIssues: string[] = [];
          wireCalculations.forEach((calc: any) => {
            if (calc.currentGauge !== calc.recommendedGauge) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% Vdrop)`
              );
            }
            if (calc.voltageDrop > 3) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
              );
            } else if (calc.voltageDrop > 2.5) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
              );
            }
          });
          
          // Separate voltage drop errors (critical wire sizing issues)
          const voltageDropErrors = wireErrors.filter((e: any) => 
            e.message?.includes("voltage drop") || 
            e.message?.includes("Excessive voltage drop")
          );
          
          // Separate capacity warnings (wires at high capacity)
          const capacityWarnings = wireWarnings.filter((w: any) => 
            w.message?.includes("capacity") || 
            w.message?.includes("running at")
          );
          
          // Separate component errors (missing properties, orphaned, etc.)
          const componentErrors = validation.issues.filter((i: any) => 
            i.severity === 'error' && 
            !(i.category === 'wire-sizing' || i.wireId || i.wireIds) &&
            (i.message?.includes("missing") || 
             i.message?.includes("overlap") ||
             i.message?.includes("orphaned") ||
             i.message?.includes("not connected") ||
             i.message?.includes("no properties") ||
             i.message?.includes("solar panel") ||
             i.message?.includes("battery") ||
             i.message?.includes("cerbo"))
          );

          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
${voltageDropErrors.length > 0 ? `VOLTAGE DROP ERRORS (CRITICAL - MUST FIX IMMEDIATELY):\n${voltageDropErrors.map((e: any, idx: number) => `${idx + 1}. ${e.message}${e.suggestion ? ` - ${e.suggestion}` : ""}${e.componentIds ? ` (${e.componentIds.join(" → ")})` : ""}`).join("\n")}\n\nThese wires exceed 3% voltage drop limit. Use LARGER gauge wire immediately.\n` : ""}
${wireErrors.filter((e: any) => !voltageDropErrors.includes(e)).length > 0 ? `OTHER WIRE ERRORS (MUST FIX):\n${wireErrors.filter((e: any) => !voltageDropErrors.includes(e)).map((e: any, idx: number) => `${idx + 1}. ${e.message}${e.suggestion ? ` - ${e.suggestion}` : ""}`).join("\n")}\n` : ""}
${capacityWarnings.length > 0 ? `WIRE CAPACITY WARNINGS (SHOULD FIX):\n${capacityWarnings.map((w: any, idx: number) => `${idx + 1}. ${w.message}${w.suggestion ? ` - ${w.suggestion}` : ""}`).join("\n")}\n\nWires at >80% capacity should use next larger gauge for safety margin.\n` : ""}
${wireWarnings.filter((w: any) => !capacityWarnings.includes(w)).length > 0 ? `OTHER WIRE WARNINGS:\n${wireWarnings.filter((w: any) => !capacityWarnings.includes(w)).map((w: any, idx: number) => `${idx + 1}. ${w.message}${w.suggestion ? ` - ${w.suggestion}` : ""}`).join("\n")}\n` : ""}
${wireCalcIssues.length > 0 ? `WIRE CALCULATION ISSUES (GAUGE/VOLTAGE DROP):\n${wireCalcIssues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n` : ""}
${componentErrors.length > 0 ? `COMPONENT ERRORS (MUST FIX):\n${componentErrors.map((e: any, idx: number) => `${idx + 1}. ${e.message}${e.suggestion ? ` - ${e.suggestion}` : ""}${e.componentIds ? ` (Components: ${e.componentIds.join(", ")})` : ""}`).join("\n")}\n\nIf Cerbo is "not connected" or "orphaned", you MUST add two wires:\n- Battery "positive" → Cerbo "power-positive" (10 AWG, 5ft)\n- Battery "negative" → Cerbo "power-negative" (10 AWG, 5ft)\n` : ""}
OTHER ERRORS: ${validation.issues.filter((i: any) => i.severity === 'error' && !(i.category === 'wire-sizing' || i.wireId || i.wireIds) && !componentErrors.includes(i)).map((i: any) => i.message).join(', ') || "None"}
OTHER WARNINGS: ${validation.issues.filter((i: any) => i.severity === 'warning' && !(i.category === 'wire-sizing' || i.wireId || i.wireIds)).map((i: any) => i.message).join(', ') || "None"}
SUGGESTIONS: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ') || "None"}

CRITICAL FIXES NEEDED:
1. Fix ALL voltage drop errors (exceeds 3% limit) - use larger gauge wire
2. Fix ALL component errors (missing properties, orphaned components like Cerbo)
3. Consider fixing capacity warnings (wires at >80% capacity) - use next larger gauge for safety`;
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
- alternator: 140×120px (vehicle alternator - use with Orion DC-DC)
- shore-power: 140×100px (AC power source for boats/RVs)
- orion-dc-dc: 160×120px (DC-DC charger for alternator charging)
- blue-smart-charger: 140×120px (AC shore charger)
- transfer-switch: 180×140px (switches between AC sources)
- inverter: 160×120px (generic inverter)
- phoenix-inverter: 160×130px
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
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "power-positive", "power-negative", "ve-bus", "ve-direct", "ve-can"
- smartshunt: "negative", "system-minus", "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- alternator: "output-positive", "output-negative"
- shore-power: "ac-out-hot", "ac-out-neutral", "ac-out-ground"
- orion-dc-dc: "input-positive", "input-negative", "output-positive", "output-negative", "remote"
- blue-smart-charger: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "dc-positive", "dc-negative"
- transfer-switch: "source1-hot", "source1-neutral", "source1-ground", "source2-hot", "source2-neutral", "source2-ground", "output-hot", "output-neutral", "output-ground"
- inverter: "dc-positive", "dc-negative", "ac-out-hot", "ac-out-neutral", "ac-out-ground"
- phoenix-inverter: "dc-positive", "dc-negative", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "remote"
- ac-load: "hot", "neutral", "ground"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"
- fuse: "in", "out"
- switch: "in", "out"
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
8. Ground wire gauge MUST MATCH hot/neutral gauge in the SAME circuit (NEC/ABYC):
   - If hot/neutral are "8 AWG", ground MUST be "8 AWG" (not "10 AWG")
   - Applies to all AC circuits: shore power, inverter outputs, AC panels, AC loads
   - Validation will fail if ground gauge differs from the circuit conductors

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
- battery: {"voltage": 12, "capacity": 400} - REQUIRED: voltage and capacity
- solar-panel: {"watts": 300, "voltage": 18} - REQUIRED: BOTH watts AND voltage properties. Voltage is PV voltage/Vmp (18V, 36V, 72V, etc.), NOT system voltage. NEVER omit either!
- mppt: {"maxCurrent": 50} - REQUIRED: maxCurrent property
- multiplus: {"powerRating": 3000} - REQUIRED: powerRating property
- cerbo: {"voltage": 12} - REQUIRED: voltage property (typically 12V or 24V). MUST connect power-positive and power-negative terminals!
- fuse: {"fuseRating": 400} - REQUIRED: fuseRating property (amps)
- alternator: {"amps": 100, "voltage": 12} - REQUIRED: amps (60-200A) and voltage (12 or 24)
- orion-dc-dc: {"amps": 20, "voltage": 12} - REQUIRED: amps (12-50A) and voltage
- blue-smart-charger: {"amps": 30, "voltage": 12} - REQUIRED: amps (15-30A) and voltage
- shore-power: {"voltage": 120, "maxAmps": 30} - REQUIRED: AC voltage and max amps
- inverter: {"watts": 3000} - REQUIRED: power rating in watts
- transfer-switch: {"switchType": "automatic"} - REQUIRED: "automatic" or "manual"

ALTERNATOR CHARGING SETUP (for boats/RVs):
When user mentions alternator charging:
1. Add "alternator" component (vehicle alternator)
2. Add "orion-dc-dc" component (Orion DC-DC charger)
3. Wire: alternator output-positive → orion input-positive
4. Wire: alternator output-negative → orion input-negative  
5. Wire: orion output-positive → busbar (or battery)
6. Wire: orion output-negative → busbar (or SmartShunt)

SHORE POWER SETUP (for boats/RVs):
When user mentions shore power:
1. Add "shore-power" component (AC power source)
2. For charging only: Wire shore-power to blue-smart-charger AC inputs (hot/neutral/ground)
3. For full AC: Wire shore-power to transfer-switch source2 inputs
4. Transfer switch: shore-power → source2 (primary), inverter → source1 (backup)
5. Transfer switch output → AC panel

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

⚠️⚠️⚠️ CERBO GX WIRING - MANDATORY FOR ALL SYSTEMS WITH CERBO:
If you include a Cerbo GX, you MUST add these power wires:
- {"fromComponentId": "busbar-pos-1", "toComponentId": "cerbo-1", "fromTerminal": "pos-1", "toTerminal": "power-positive", "polarity": "positive", "gauge": "18 AWG", "length": 3}
- {"fromComponentId": "busbar-neg-1", "toComponentId": "cerbo-1", "fromTerminal": "neg-1", "toTerminal": "power-negative", "polarity": "negative", "gauge": "18 AWG", "length": 3}
WITHOUT these wires, the Cerbo will be flagged as "orphaned" and cause validation errors!

⚠️⚠️⚠️ SOLAR PANEL WIRE GAUGE - IMPORTANT:
Solar panels at 25ft runs need LARGER gauge to avoid voltage drop errors:
- 300W @ 18V = 16.7A → Use "6 AWG" for 25ft runs (NOT 10 AWG!)
- 400W @ 18V = 22.2A → Use "4 AWG" for 25ft runs
- Shorter runs (10ft): "8 AWG" or "10 AWG" is acceptable

⚠️⚠️⚠️ BATTERY/INVERTER MAIN WIRE GAUGE - CRITICAL:
Main battery wires (battery → fuse → bus bar) must handle FULL inverter DC current!
- 3000W inverter @ 12V = 286A DC input (with efficiency) → MUST use "4/0 AWG"!
- 2000W inverter @ 12V = 190A → Use "4/0 AWG" or "3/0 AWG"
- 1000W inverter @ 12V = 95A → Use "1/0 AWG" or "2/0 AWG"
- Bus bar to inverter wires: Same gauge as main battery wires!
- 2/0 AWG only handles 175A max - NOT enough for 3000W inverter!

JSON RESPONSE FORMAT (FOLLOW THIS EXACTLY):
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "House Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "solar-1", "type": "solar-panel", "name": "Solar Panel 300W", "x": 150, "y": 100, "properties": {"watts": 300, "voltage": 18}},
    {"id": "cerbo-1", "type": "cerbo", "name": "Victron Cerbo GX", "x": 600, "y": 100, "properties": {"voltage": 12}},
    {"id": "load-dc-1", "type": "dc-load", "name": "LED Cabin Lights", "x": 450, "y": 400, "properties": {"watts": 50}},
    {"id": "load-ac-1", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "fuse-1", "fromTerminal": "positive", "toTerminal": "in", "polarity": "positive", "gauge": "4/0 AWG", "length": 2},
    {"fromComponentId": "fuse-1", "toComponentId": "busbar-pos-1", "fromTerminal": "out", "toTerminal": "pos-1", "polarity": "positive", "gauge": "4/0 AWG", "length": 5},
    {"fromComponentId": "busbar-pos-1", "toComponentId": "multiplus-1", "fromTerminal": "pos-2", "toTerminal": "dc-positive", "polarity": "positive", "gauge": "4/0 AWG", "length": 5},
    {"fromComponentId": "solar-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "pv-positive", "polarity": "positive", "gauge": "6 AWG", "length": 25},
    {"fromComponentId": "busbar-pos-1", "toComponentId": "cerbo-1", "fromTerminal": "pos-3", "toTerminal": "power-positive", "polarity": "positive", "gauge": "18 AWG", "length": 3}
  ],
  "description": "Brief system description",
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

        const userMessage = iteration === 0
          ? prompt
          : `${prompt}\n\nImprove the previous design based on the feedback above.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.2-chat-latest",
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

        // Validate the design (ensure all wires have unique IDs)
        const wiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));
        const validation = validateDesign(
          response.components,
          wiresWithIds,
          systemVoltage
        );

        const errors = validation.issues.filter((i: any) => i.severity === 'error');
        const wireErrors = errors.filter((i: any) => i.category === "wire-sizing" || i.wireId || i.wireIds);
        const voltageDropErrors = wireErrors.filter((e: any) => 
          e.message?.includes("voltage drop") || 
          e.message?.includes("Excessive voltage drop")
        );
        const componentErrors = errors.filter((i: any) => 
          i.message?.includes("missing") || 
          i.message?.includes("overlap") ||
          i.message?.includes("orphaned") ||
          i.message?.includes("not connected") ||
          i.message?.includes("no properties")
        );
        const criticalErrorsCount = voltageDropErrors.length + componentErrors.length;
        
        console.log(`Iteration ${iteration + 1} - Score: ${validation.score}, Errors: ${errors.length} (${criticalErrorsCount} critical), Warnings: ${validation.issues.filter(i => i.severity === 'warning').length}`);
        if (criticalErrorsCount > 0) {
          console.log(`  Critical errors: ${voltageDropErrors.length} voltage drop, ${componentErrors.length} component errors`);
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
          warningCount: validation.issues.filter(i => i.severity === 'warning').length,
          design: response,
          validation
        });

        // Update best design if this is better OR if we don't have one yet
        if (validation.score > bestScore || !bestDesign) {
          bestScore = validation.score;
          bestDesign = {
            ...response,
            validation,
            visualFeedback
          };
        }

        // Check if we've achieved minimum quality AND no critical errors (reuse variables from above)
        // Allow early stopping if quality threshold met and no critical errors remain
        if (validation.score >= minQualityScore && criticalErrorsCount === 0) {
          console.log(`✓ Achieved quality threshold (${validation.score} >= ${minQualityScore}) with no critical errors at iteration ${iteration + 1}`);
          res.json({
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            achievedQualityThreshold: true
          });
          return;
        }
        
        // Also stop early if we have high quality (>90) even with some minor errors (but not voltage drop or orphaned components)
        if (validation.score >= 90 && criticalErrorsCount === 0 && errors.length <= 3) {
          console.log(`✓ High quality score (${validation.score}) with minimal errors at iteration ${iteration + 1}`);
          res.json({
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            achievedQualityThreshold: true
          });
          return;
        }
        
        // Early stop if score has plateaued for 2 iterations (no improvement)
        if (iteration >= 2) {
          const recentScores = iterationHistory.slice(-3).map(h => h.score);
          const maxRecentScore = Math.max(...recentScores);
          const currentIsBest = validation.score >= maxRecentScore;
          const notImproving = recentScores.every(s => Math.abs(s - recentScores[0]) <= 5);
          
          if (notImproving && criticalErrorsCount === 0 && errors.length <= 3) {
            console.log(`✓ Score plateaued (${recentScores.join(' → ')}) with acceptable errors at iteration ${iteration + 1}`);
            res.json({
              ...bestDesign,
              iterationHistory,
              finalIteration: iteration + 1,
              achievedQualityThreshold: bestScore >= minQualityScore
            });
            return;
          }
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
        maxIterations = 6,
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
          
          // Build wire feedback (errors/warnings + calc issues)
          const wireErrors = validation.issues.filter((i: any) =>
            i.severity === "error" && (i.category === "wire-sizing" || i.wireId || i.wireIds)
          );
          const wireWarnings = validation.issues.filter((i: any) =>
            i.severity === "warning" && (i.category === "wire-sizing" || i.wireId || i.wireIds)
          );

          const wireCalcIssues: string[] = [];
          wireCalculations.forEach((calc: any) => {
            if (calc.currentGauge !== calc.recommendedGauge) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Current gauge ${calc.currentGauge} should be ${calc.recommendedGauge} (${calc.current.toFixed(1)}A, ${calc.length}ft, ${calc.voltageDrop.toFixed(2)}% Vdrop)`
              );
            }
            if (calc.voltageDrop > 3) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: Excessive voltage drop ${calc.voltageDrop.toFixed(2)}% (max 3%) - use larger gauge or shorten run`
              );
            } else if (calc.voltageDrop > 2.5) {
              wireCalcIssues.push(
                `Wire ${calc.fromComponent} → ${calc.toComponent}: High voltage drop ${calc.voltageDrop.toFixed(2)}% - consider larger gauge`
              );
            }
          });
          
          feedbackContext = `\n\nPREVIOUS ITERATION FEEDBACK (Score: ${validation.score}/100):
${wireErrors.length ? `WIRE ERRORS (MUST FIX):\n${wireErrors.map((e: any, idx: number) => `${idx + 1}. ${e.message}${e.suggestion ? ` - Suggestion: ${e.suggestion}` : ""}`).join("\n")}\n` : ""}
${wireWarnings.length ? `WIRE WARNINGS (MUST FIX):\n${wireWarnings.map((w: any, idx: number) => `${idx + 1}. ${w.message}${w.suggestion ? ` - Suggestion: ${w.suggestion}` : ""}`).join("\n")}\n` : ""}
${wireCalcIssues.length ? `WIRE CALCULATION ISSUES (GAUGE/VOLTAGE DROP):\n${wireCalcIssues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n` : ""}
OTHER ERRORS: ${validation.issues.filter((i: any) => i.severity === 'error' && !(i.category === 'wire-sizing' || i.wireId || i.wireIds)).map((i: any) => i.message).join(', ') || "None"}
OTHER WARNINGS: ${validation.issues.filter((i: any) => i.severity === 'warning' && !(i.category === 'wire-sizing' || i.wireId || i.wireIds)).map((i: any) => i.message).join(', ') || "None"}
SUGGESTIONS: ${validation.issues.filter((i: any) => i.suggestion).map((i: any) => i.suggestion).join(', ') || "None"}

Please fix ALL wire errors/warnings and follow wire calculation recommendations (gauge + voltage drop).`;
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
- alternator: 140×120px (vehicle alternator - use with Orion DC-DC)
- shore-power: 140×100px (AC power source for boats/RVs)
- orion-dc-dc: 160×120px (DC-DC charger for alternator charging)
- blue-smart-charger: 140×120px (AC shore charger)
- transfer-switch: 180×140px (switches between AC sources)
- inverter: 160×120px (generic inverter)
- phoenix-inverter: 160×130px
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
- multiplus: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "power-positive", "power-negative", "ve-bus", "ve-direct", "ve-can"
- smartshunt: "negative", "system-minus", "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- alternator: "output-positive", "output-negative"
- shore-power: "ac-out-hot", "ac-out-neutral", "ac-out-ground"
- orion-dc-dc: "input-positive", "input-negative", "output-positive", "output-negative", "remote"
- blue-smart-charger: "ac-in-hot", "ac-in-neutral", "ac-in-ground", "dc-positive", "dc-negative"
- transfer-switch: "source1-hot", "source1-neutral", "source1-ground", "source2-hot", "source2-neutral", "source2-ground", "output-hot", "output-neutral", "output-ground"
- inverter: "dc-positive", "dc-negative", "ac-out-hot", "ac-out-neutral", "ac-out-ground"
- phoenix-inverter: "dc-positive", "dc-negative", "ac-out-hot", "ac-out-neutral", "ac-out-ground", "remote"
- ac-load: "hot", "neutral", "ground"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"
- fuse: "in", "out"
- switch: "in", "out"
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
8. Ground wire gauge MUST MATCH hot/neutral gauge in the SAME circuit (NEC/ABYC):
   - If hot/neutral are "8 AWG", ground MUST be "8 AWG" (not "10 AWG")
   - Applies to all AC circuits: shore power, inverter outputs, AC panels, AC loads
   - Validation will fail if ground gauge differs from the circuit conductors

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
- battery: {"voltage": 12, "capacity": 400} - REQUIRED: voltage and capacity
- solar-panel: {"watts": 300, "voltage": 18} - REQUIRED: BOTH watts AND voltage properties. Voltage is PV voltage/Vmp (18V, 36V, 72V, etc.), NOT system voltage. NEVER omit either!
- mppt: {"maxCurrent": 50} - REQUIRED: maxCurrent property
- multiplus: {"powerRating": 3000} - REQUIRED: powerRating property
- cerbo: {"voltage": 12} - REQUIRED: voltage property (typically 12V or 24V). MUST connect power-positive and power-negative terminals!
- fuse: {"fuseRating": 400} - REQUIRED: fuseRating property (amps)
- alternator: {"amps": 100, "voltage": 12} - REQUIRED: amps (60-200A) and voltage (12 or 24)
- orion-dc-dc: {"amps": 20, "voltage": 12} - REQUIRED: amps (12-50A) and voltage
- blue-smart-charger: {"amps": 30, "voltage": 12} - REQUIRED: amps (15-30A) and voltage
- shore-power: {"voltage": 120, "maxAmps": 30} - REQUIRED: AC voltage and max amps
- inverter: {"watts": 3000} - REQUIRED: power rating in watts
- transfer-switch: {"switchType": "automatic"} - REQUIRED: "automatic" or "manual"

ALTERNATOR CHARGING SETUP (for boats/RVs):
When user mentions alternator charging:
1. Add "alternator" component (vehicle alternator)
2. Add "orion-dc-dc" component (Orion DC-DC charger)
3. Wire: alternator output-positive → orion input-positive
4. Wire: alternator output-negative → orion input-negative  
5. Wire: orion output-positive → busbar (or battery)
6. Wire: orion output-negative → busbar (or SmartShunt)

SHORE POWER SETUP (for boats/RVs):
When user mentions shore power:
1. Add "shore-power" component (AC power source)
2. For charging only: Wire shore-power to blue-smart-charger AC inputs (hot/neutral/ground)
3. For full AC: Wire shore-power to transfer-switch source2 inputs
4. Transfer switch: shore-power → source2 (primary), inverter → source1 (backup)
5. Transfer switch output → AC panel

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

⚠️⚠️⚠️ CERBO GX WIRING - MANDATORY FOR ALL SYSTEMS WITH CERBO:
If you include a Cerbo GX, you MUST add these power wires:
- {"fromComponentId": "busbar-pos-1", "toComponentId": "cerbo-1", "fromTerminal": "pos-1", "toTerminal": "power-positive", "polarity": "positive", "gauge": "18 AWG", "length": 3}
- {"fromComponentId": "busbar-neg-1", "toComponentId": "cerbo-1", "fromTerminal": "neg-1", "toTerminal": "power-negative", "polarity": "negative", "gauge": "18 AWG", "length": 3}
WITHOUT these wires, the Cerbo will be flagged as "orphaned" and cause validation errors!

⚠️⚠️⚠️ SOLAR PANEL WIRE GAUGE - IMPORTANT:
Solar panels at 25ft runs need LARGER gauge to avoid voltage drop errors:
- 300W @ 18V = 16.7A → Use "6 AWG" for 25ft runs (NOT 10 AWG!)
- 400W @ 18V = 22.2A → Use "4 AWG" for 25ft runs
- Shorter runs (10ft): "8 AWG" or "10 AWG" is acceptable

⚠️⚠️⚠️ BATTERY/INVERTER MAIN WIRE GAUGE - CRITICAL:
Main battery wires (battery → fuse → bus bar) must handle FULL inverter DC current!
- 3000W inverter @ 12V = 286A DC input (with efficiency) → MUST use "4/0 AWG"!
- 2000W inverter @ 12V = 190A → Use "4/0 AWG" or "3/0 AWG"
- 1000W inverter @ 12V = 95A → Use "1/0 AWG" or "2/0 AWG"
- Bus bar to inverter wires: Same gauge as main battery wires!
- 2/0 AWG only handles 175A max - NOT enough for 3000W inverter!

JSON RESPONSE FORMAT (FOLLOW THIS EXACTLY):
{
  "components": [
    {"id": "battery-1", "type": "battery", "name": "House Battery Bank", "x": 150, "y": 400, "properties": {"voltage": 12, "capacity": 400}},
    {"id": "solar-1", "type": "solar-panel", "name": "Solar Panel 300W", "x": 150, "y": 100, "properties": {"watts": 300, "voltage": 18}},
    {"id": "cerbo-1", "type": "cerbo", "name": "Victron Cerbo GX", "x": 600, "y": 100, "properties": {"voltage": 12}},
    {"id": "load-dc-1", "type": "dc-load", "name": "LED Cabin Lights", "x": 450, "y": 400, "properties": {"watts": 50}},
    {"id": "load-ac-1", "type": "ac-load", "name": "Microwave", "x": 750, "y": 400, "properties": {"watts": 1200}}
  ],
  "wires": [
    {"fromComponentId": "battery-1", "toComponentId": "fuse-1", "fromTerminal": "positive", "toTerminal": "in", "polarity": "positive", "gauge": "4/0 AWG", "length": 2},
    {"fromComponentId": "fuse-1", "toComponentId": "busbar-pos-1", "fromTerminal": "out", "toTerminal": "pos-1", "polarity": "positive", "gauge": "4/0 AWG", "length": 5},
    {"fromComponentId": "busbar-pos-1", "toComponentId": "multiplus-1", "fromTerminal": "pos-2", "toTerminal": "dc-positive", "polarity": "positive", "gauge": "4/0 AWG", "length": 5},
    {"fromComponentId": "solar-1", "toComponentId": "mppt-1", "fromTerminal": "positive", "toTerminal": "pv-positive", "polarity": "positive", "gauge": "6 AWG", "length": 25},
    {"fromComponentId": "busbar-pos-1", "toComponentId": "cerbo-1", "fromTerminal": "pos-3", "toTerminal": "power-positive", "polarity": "positive", "gauge": "18 AWG", "length": 3}
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
          model: "gpt-5.2-chat-latest",
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

        // Validate the design (ensure all wires have unique IDs)
        const wiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));
        let validation;
        try {
          validation = validateDesign(
            response.components,
            wiresWithIds,
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
            qualityScore: Math.round(validation.score), // Round to integer for database
            componentCount: bestDesign.components?.length || 0,
            wireCount: bestDesign.wires?.length || 0,
            model: "gpt-5.2-chat-latest",
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
          model: "gpt-5.2-chat-latest",
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
        model: "gpt-5.2-chat-latest",
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
        model: "gpt-5.2-chat-latest",
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

  // Runtime estimates endpoint
  app.post("/api/runtime-estimates", async (req, res) => {
    try {
      const { components, systemVoltage = 12 } = req.body;

      if (!components || !Array.isArray(components)) {
        return res.status(400).json({ error: "Components array is required" });
      }

      const estimates = calculateRuntimeEstimates({
        components,
        systemVoltage,
      });

      res.json(estimates);
    } catch (error: any) {
      console.error("Runtime estimates error:", error);
      res.status(500).json({ error: error.message || "Failed to calculate runtime estimates" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
