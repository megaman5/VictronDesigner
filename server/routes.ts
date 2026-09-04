import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { feedbackStorage } from "./feedback-storage";
import { userDesignsStorage } from "./user-designs-storage";
import { observabilityStorage } from "./observability-storage";
import { appSettingsStorage, DEFAULT_AI_MODEL, DEFAULT_WIRE_ROUTING_STYLE, WIRE_ROUTING_STYLE_VALUES } from "./app-settings-storage";
import { normalizeAIDesign } from "./ai-design-normalizer";
import { registerAIRoutes } from "./ai/routes";
import { systemDesignSkill, wireComponentsSkill } from "./ai/skills";
import { insertSchematicSchema, updateSchematicSchema, insertCustomComponentSchema, updateCustomComponentSchema, type AISystemRequest, type AISystemResponse } from "@shared/schema";
import { customComponentsStorage } from "./custom-components-storage";
import { DEVICE_DEFINITIONS } from "@shared/device-definitions";
import { calculateWireSize, calculateLoadRequirements, getACVoltage, calculateInverterDCInput } from "./wire-calculator";
import { calculateRuntimeEstimates } from "./runtime-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
import { validateDesign } from "./design-validator";
import { renderSchematicToPNG, getVisualFeedback } from "./schematic-renderer";
import OpenAI from "openai";
import { clientForModel, hasKeyForModel } from "./ai/model-client";
import { passport, isAdmin, isAuthenticated, type AuthUser } from "./auth";
import { checkQuota } from "./ai/usage-limits";
import { buildIterationUserMessage } from "./ai/schematic-image";

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


// Authentication middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

/**
 * Gate for the AI endpoints, which run on the platform's API key and cost real
 * money. These were open to anonymous callers, so sign-in is now required and
 * both the lifetime allowance and the monthly cap are enforced before the
 * model is ever called.
 *
 * The `code` in the body is what the client keys its tooltip off, so the
 * wording lives in one place on the front end rather than being parsed out of
 * a message string.
 */
async function requireAiQuota(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      code: "auth_required",
      error: "Log in to use AI features",
    });
  }

  const user = req.user as AuthUser;
  try {
    const quota = await checkQuota(user.id);
    if (!quota.allowed) {
      return res.status(429).json({
        code: quota.blockedBy === "monthly" ? "monthly_limit" : "quota_exhausted",
        error: quota.reason,
        lifetimeLimitUsd: quota.lifetimeLimitUsd,
        lifetimeSpentUsd: quota.lifetimeSpentUsd,
      });
    }
    next();
  } catch (err: any) {
    // A quota lookup failure must not silently hand out free model calls.
    console.error("[ai-quota] check failed:", err?.message);
    res.status(503).json({ code: "quota_unavailable", error: "AI is temporarily unavailable" });
  }
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
  // Benchmarking, provider and skill admin API
  registerAIRoutes(app);

  const getAIModel = () => appSettingsStorage.getAIModel();

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
      const user = req.user as AuthUser;
      const schematics = await storage.getUserSchematics(user.id);
      res.json(schematics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/schematics/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const schematic = await storage.getUserSchematic(user.id, req.params.id);
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
      const user = req.user as AuthUser;
      const data = insertSchematicSchema.parse({ ...req.body, userId: user.id });
      const schematic = await storage.createSchematic(data);
      res.json(schematic);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/schematics/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const data = updateSchematicSchema.parse(req.body);
      const schematic = await storage.updateUserSchematic(user.id, req.params.id, data);
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
      const user = req.user as AuthUser;
      const success = await storage.deleteUserSchematic(user.id, req.params.id);
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
  app.post("/api/ai-generate-system", requireAiQuota, async (req, res) => {
    // Token usage for cost accounting. Accumulated across every model call
    // this request makes (the iterative endpoint makes several), so the
    // logged cost reflects the whole request, not just the last round.
    const tokenUsage = { inputTokens: 0, outputTokens: 0 };
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    let aiModel = DEFAULT_AI_MODEL;
    
    try {
      aiModel = await getAIModel();
      const { prompt, systemVoltage = 12 }: AISystemRequest = req.body;

      if (!hasKeyForModel(aiModel)) {
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

      const completion = await clientForModel(aiModel).chat.completions.create({
        model: aiModel,
        messages: [
          {
            role: "system",
            // Versioned system-design skill - see server/ai/skills
            content: systemDesignSkill.buildSystemPrompt({ systemVoltage }),
          },
          {
            role: "user",
            content: `Design a ${systemVoltage}V electrical system with the following requirements: ${prompt}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
      tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
      const response = JSON.parse(extractJSON(completion.choices[0].message.content || "{}"));

      // Log AI response for debugging
      console.log("AI Response:", JSON.stringify(response, null, 2));
      console.log("Components count:", response.components?.length || 0);
      console.log("Wires count:", response.wires?.length || 0);
      if (response.wires && response.wires.length > 0) {
        console.log("Sample wire:", JSON.stringify(response.wires[0], null, 2));
      }

      // Repair invented terminal ids and size the wires (same pass the
      // iterative endpoints use) so single-shot output is usable too.
      if (Array.isArray(response.components)) {
        const wiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));
        const normalized = normalizeAIDesign(response.components, wiresWithIds, systemVoltage);
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
      }

      // Log to observability
      await observabilityStorage.logAIRequest({
        ...tokenUsage,
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
        model: aiModel,
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
        ...tokenUsage,
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
        model: aiModel,
      });
      
      res.status(500).json({ error: error.message });
    }
  });

  // AI wire generation for existing components
  app.post("/api/ai-wire-components", requireAiQuota, async (req, res) => {
    // Token usage for cost accounting. Accumulated across every model call
    // this request makes (the iterative endpoint makes several), so the
    // logged cost reflects the whole request, not just the last round.
    const tokenUsage = { inputTokens: 0, outputTokens: 0 };
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    let aiModel = DEFAULT_AI_MODEL;
    
    try {
      aiModel = await getAIModel();
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

      const openai = clientForModel(aiModel);
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

      const openai = clientForModel(aiModel);

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
- If current ≤370A: REMOVE parallel runs, use single larger gauge wire (4/0 AWG carries 445A per ABYC 105°C free air)
- If current >370A: Use parallel runs, but ALL wires must be 4/0 AWG (identical gauges)
- NEVER mix different gauges in parallel runs
- NEVER use parallel runs for currents ≤370A
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

PARALLEL WIRE RUNS - STRICT RULES (ABYC - CRITICAL):
- ONLY create parallel wire runs when current exceeds 370A (4/0 AWG carries 445A per ABYC 105°C free air; 370A keeps a 20% margin)
- NEVER create parallel runs for currents ≤370A - use single larger gauge instead
- ALL parallel conductors MUST be 4/0 AWG (per NEC/ABYC standard practice)
- NEVER mix different gauges in parallel runs (e.g., don't use 2 AWG + 1 AWG in parallel)
- When creating parallel runs, each wire must have the SAME gauge (all 4/0 AWG)
- Each parallel wire's "current" field should be the TOTAL current (system divides automatically)
- Example CORRECT: 500A load → 2 parallel 4/0 AWG wires, each wire has current: 500 (system calculates 250A per wire automatically)
- Example CORRECT: 800A load → 3 parallel 4/0 AWG wires, each wire has current: 800 (system calculates 267A per wire automatically)
- CRITICAL: When creating parallel wires, set current field to TOTAL current on EACH wire (don't divide it yourself)
- Example WRONG: 300A load → 2 parallel 2/0 AWG wires (should use single 4/0 AWG instead)
- Example WRONG: 100A load → 2 parallel 1/0 AWG wires (should use single 6 AWG instead)
- Example WRONG: 16.7A load → 3 parallel 6 AWG wires (should use single 10 AWG instead)
- If you see errors about "insufficient for XA" where X > 370A, use parallel 4/0 AWG runs
- If you see errors about "Parallel wire runs used for XA" where X ≤ 370A, REMOVE parallel runs and use single gauge

QUALITY IMPROVEMENT GUIDELINES:
- For complex systems with multiple components, prioritize clean organization:
  * Use bus bars to consolidate connections (3+ connections to same component type)
  * Distribute connections across bus bar terminals (pos-1, pos-2, pos-3, etc.) for better organization
  * Avoid daisy-chaining when bus bars would be cleaner
- WIRE CAPACITY MANAGEMENT (CRITICAL FOR QUALITY):
  * NEVER size wires at >90% of their ampacity - always leave 10-20% safety margin
  * If a wire would run at >90% capacity, use the next larger gauge
  * Example: 190A load → use 2 AWG (210A max) OR 1 AWG (245A max)
  * Example: 300A load → use 3/0 AWG (385A max) OR 4/0 AWG (445A max)
  * ONLY use parallel wire runs when you've reached 4/0 AWG (445A) and still need more capacity
  * Parallel runs require each conductor to be at least 1/0 AWG per NEC/ABYC
  * Example: 500A load → use 2 parallel 4/0 AWG wires (250A each) since single 4/0 AWG maxes at 445A
  * Wires at 95-100% capacity will generate warnings and reduce quality score
- When multiple parallel wires exist between the same components:
  * Each wire carries total current ÷ number of parallel wires
  * Calculate current per wire correctly (e.g., 154.3A total ÷ 2 wires = 77.1A per wire)
  * Size each wire based on its per-wire current, not total current
- For high current applications exceeding 4/0 AWG capacity (445A per ABYC 105°C free air), use parallel wire runs:
  * ONLY suggest parallel runs when single 4/0 AWG (445A max) is insufficient (current >370A with 20% margin)
  * Each parallel conductor must be at least 1/0 AWG per NEC/ABYC requirements
  * Use multiple 4/0 AWG wires in parallel for currents >370A
  * Example: 500A load → use 2 parallel 4/0 AWG wires (250A each, 445A max per wire = 56% capacity)
  * Example: 700A load → use 2 parallel 4/0 AWG wires (350A each, 445A max = 79% capacity)
- Ground wire gauge matching is CRITICAL:
  * Always match ground gauge to hot/neutral in the same circuit
  * This is a safety requirement and will cause validation errors if violated

`;
        }

      const completion = await clientForModel(aiModel).chat.completions.create({
        model: aiModel,
        messages: [
          {
            role: "system",
            // Versioned wire-components skill - see server/ai/skills
            content: wireComponentsSkill.buildSystemPrompt({ systemVoltage }),
          },
          {
            role: "user",
            content: `Create wiring connections for these ${systemVoltage}V components: ${JSON.stringify(components)}${wires.length > 0 ? `\n\nExisting wires (review and improve if needed): ${JSON.stringify(wires)}` : ""}`,
          },
        ],
        response_format: { type: "json_object" },
      });

        tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
        tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
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
        ...tokenUsage,
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
        model: aiModel,
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
        ...tokenUsage,
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
        model: aiModel,
      });
      
      res.status(500).json({ error: error.message });
    }
  });

  // Iterative AI generation with quality validation
  app.post("/api/ai-generate-system-iterative", requireAiQuota, async (req, res) => {
    // Token usage for cost accounting. Accumulated across every model call
    // this request makes (the iterative endpoint makes several), so the
    // logged cost reflects the whole request, not just the last round.
    const tokenUsage = { inputTokens: 0, outputTokens: 0 };
    let aiModel = DEFAULT_AI_MODEL;

    try {
      aiModel = await getAIModel();
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

        // Prompt comes from the versioned system-design skill. It used to be
        // pasted here and at the streaming endpoint as two identical 287-line
        // copies, which is how the Lynx terminal ids ended up documented in one
        // place and not the other.
        const systemMessage = systemDesignSkill.buildSystemPrompt({ systemVoltage });

        const userMessage = iteration === 0
          ? prompt
          : `${prompt}\n\nImprove the previous design based on the feedback above.`;

        // From the second round on, show the model what it just built.
        const userContent = buildIterationUserMessage(userMessage, bestDesign, aiModel);

        const completion = await clientForModel(aiModel).chat.completions.create({
          model: aiModel,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userContent as any }
          ],
          max_completion_tokens: 128000,
        });

        tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
        tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
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
        const rawWiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));

        // Repair the two things the model reliably gets wrong - invented
        // terminal ids and guessed wire gauges - before scoring the design.
        // Both are computable, so spending iterations on them is wasted.
        const normalized = normalizeAIDesign(response.components, rawWiresWithIds, systemVoltage);
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
          for (const r of normalized.repairs.slice(0, 10)) console.log(`  ${r.kind}: ${r.detail}`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
        const wiresWithIds = normalized.wires;
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
  app.post("/api/ai-generate-system-stream", requireAiQuota, async (req, res) => {
    // Token usage for cost accounting. Accumulated across every model call
    // this request makes (the iterative endpoint makes several), so the
    // logged cost reflects the whole request, not just the last round.
    const tokenUsage = { inputTokens: 0, outputTokens: 0 };
    const startTime = Date.now();
    const visitorId = getVisitorId(req);
    const user = req.user as AuthUser | undefined;
    const clientIP = getClientIP(req);
    let aiModel = DEFAULT_AI_MODEL;
    
    try {
      aiModel = await getAIModel();
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

        // Prompt comes from the versioned system-design skill. It used to be
        // pasted here and at the streaming endpoint as two identical 287-line
        // copies, which is how the Lynx terminal ids ended up documented in one
        // place and not the other.
        const systemMessage = systemDesignSkill.buildSystemPrompt({ systemVoltage });

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

        // From the second round on, show the model what it just built.
        const userContent = buildIterationUserMessage(userMessage, bestDesign, aiModel);
        if (Array.isArray(userContent)) {
          sendEvent('ai-layout-image', { iteration: iteration + 1 });
        }

        // Stream the AI response
        const stream = await clientForModel(aiModel).chat.completions.create({
          model: aiModel,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userContent as any }
          ],
          max_completion_tokens: 128000,
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
            const priorPrompt = promptTokens;
            const priorCompletion = completionTokens;
            promptTokens = chunk.usage.prompt_tokens || promptTokens;
            completionTokens = chunk.usage.completion_tokens || completionTokens;
            // Roll the delta into the request total so multi-iteration streams
            // bill for every round, not just the last one.
            tokenUsage.inputTokens += Math.max(0, promptTokens - priorPrompt);
            tokenUsage.outputTokens += Math.max(0, completionTokens - priorCompletion);
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
        const rawWiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));

        // Repair the two things the model reliably gets wrong - invented
        // terminal ids and guessed wire gauges - before scoring the design.
        // Both are computable, so spending iterations on them is wasted.
        const normalized = normalizeAIDesign(response.components, rawWiresWithIds, systemVoltage);
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
          for (const r of normalized.repairs.slice(0, 10)) console.log(`  ${r.kind}: ${r.detail}`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
        const wiresWithIds = normalized.wires;
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
                
                // AC wires are sized at their own AC voltage, which may be
                // 120V, 230V or 240V split phase - not always 120V.
                if (isACWire) {
                  voltage = getACVoltage(toComp) || getACVoltage(fromComp);
                }
                
                if (current === 0) {
                  if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                    const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                    // AC loads use 120V, DC loads use component voltage or system voltage
                    const loadVoltage = toComp.type === "ac-load" ? getACVoltage(toComp) : (toComp.properties?.voltage as number || voltage);
                    if (loadWatts > 0 && loadVoltage > 0) {
                      current = loadWatts / loadVoltage;
                    }
                  } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                    const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                    // AC loads use 120V, DC loads use component voltage or system voltage
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
            ...tokenUsage,
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
            model: aiModel,
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
          ...tokenUsage,
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
          model: aiModel,
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
            
            // AC wires are sized at their own AC voltage, which may be
            // 120V, 230V or 240V split phase - not always 120V.
            if (isACWire) {
              voltage = getACVoltage(toComp) || getACVoltage(fromComp);
            }
            
            if (current === 0) {
              if (toComp && (toComp.type === "dc-load" || toComp.type === "ac-load")) {
                const loadWatts = (toComp.properties?.watts || toComp.properties?.power || 0) as number;
                // AC loads use 120V, DC loads use component voltage or system voltage
                const loadVoltage = toComp.type === "ac-load" ? getACVoltage(toComp) : (toComp.properties?.voltage as number || voltage);
                if (loadWatts > 0 && loadVoltage > 0) {
                  current = loadWatts / loadVoltage;
                }
              } else if (fromComp && (fromComp.type === "dc-load" || fromComp.type === "ac-load")) {
                const loadWatts = (fromComp.properties?.watts || fromComp.properties?.power || 0) as number;
                // AC loads use 120V, DC loads use component voltage or system voltage
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
        ...tokenUsage,
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
        model: aiModel,
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
        ...tokenUsage,
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
        model: aiModel,
      });
      
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Export endpoints - POST versions for current design (no save required)
  app.post("/api/export/shopping-list", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design", wireGaugeFormat = "awg", lengthUnit = "ft" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const items = generateShoppingList(schematic as any, wireGaugeFormat, lengthUnit);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/export/wire-labels", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design", wireGaugeFormat = "awg", lengthUnit = "ft" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const labels = generateWireLabels(schematic as any, wireGaugeFormat, lengthUnit);
      res.json(labels);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/export/system-report", async (req, res) => {
    try {
      const { components, wires, systemVoltage = 12, name = "Design", wireGaugeFormat = "awg", lengthUnit = "ft" } = req.body;
      const schematic = { components, wires, systemVoltage, name };
      const report = generateSystemReport(schematic as any, wireGaugeFormat, lengthUnit);
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

  // Custom component definitions (Phase 1: personal, private only).
  // Owner-scoped throughout - a user can only read/edit/delete their own.
  app.get("/api/custom-components", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const items = await customComponentsStorage.getAllForOwner(user.id);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/custom-components/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const item = await customComponentsStorage.getById(user.id, req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Custom component not found" });
      }
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/custom-components", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      // ownerId comes from the session; version is owned by the server (it is
      // bumped on every update), so neither is accepted from the client.
      const data = insertCustomComponentSchema.omit({ ownerId: true, version: true }).parse(req.body);

      if (!Array.isArray(data.terminals) || data.terminals.length === 0) {
        return res.status(400).json({ error: "At least one terminal is required" });
      }

      const item = await customComponentsStorage.create(user.id, data);
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/custom-components/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const data = updateCustomComponentSchema.parse(req.body);

      if (data.terminals !== undefined && (!Array.isArray(data.terminals) || data.terminals.length === 0)) {
        return res.status(400).json({ error: "At least one terminal is required" });
      }

      const item = await customComponentsStorage.update(user.id, req.params.id, data);
      if (!item) {
        return res.status(404).json({ error: "Custom component not found" });
      }
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/custom-components/:id", requireAuth, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const success = await customComponentsStorage.delete(user.id, req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Custom component not found" });
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

  app.patch("/api/feedback/:id/status", isAdmin, async (req, res) => {
    try {
      const { status } = req.body;
      if (status !== "new" && status !== "completed") {
        return res.status(400).json({ error: "Status must be 'new' or 'completed'" });
      }
      const updated = await feedbackStorage.updateStatus(req.params.id, status);
      if (!updated) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(updated);
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

  // Per-user disclaimer acceptance (account state, survives across devices).
  app.get("/api/user/disclaimer", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const acceptedVersion = await appSettingsStorage.getUserDisclaimer(user.id);
      res.json({ acceptedVersion });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/user/disclaimer", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as AuthUser;
      const version = String(req.body?.version || "").trim();
      if (!version) {
        return res.status(400).json({ error: "version is required" });
      }
      await appSettingsStorage.setUserDisclaimer(user.id, version);
      res.json({ acceptedVersion: version });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Public app config (no auth) - safe, non-sensitive settings the client needs.
  app.get("/api/config", async (req, res) => {
    try {
      const [wireRoutingSelectorEnabled, defaultWireRoutingStyle] = await Promise.all([
        appSettingsStorage.getWireRoutingSelectorEnabled(),
        appSettingsStorage.getDefaultWireRoutingStyle(),
      ]);
      // Allow key rotation to take effect without stale cached copies
      res.set("Cache-Control", "no-store");
      res.json({
        wireRoutingSelectorEnabled,
        defaultWireRoutingStyle,
        // PostHog project key is a public client-side key; served at
        // runtime so rotating it doesn't require a rebuild.
        posthogKey: process.env.POSTHOG_PROJ || null,
        posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get overall stats
  app.get("/api/admin/settings", isAdmin, async (req, res) => {
    try {
      const [aiModel, wireRoutingSelectorEnabled, defaultWireRoutingStyle] = await Promise.all([
        appSettingsStorage.getAIModel(),
        appSettingsStorage.getWireRoutingSelectorEnabled(),
        appSettingsStorage.getDefaultWireRoutingStyle(),
      ]);
      res.json({
        aiModel,
        defaultAIModel: DEFAULT_AI_MODEL,
        wireRoutingSelectorEnabled,
        defaultWireRoutingStyle,
        wireRoutingStyleOptions: WIRE_ROUTING_STYLE_VALUES,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/settings/ai-model", isAdmin, async (req, res) => {
    try {
      const model = String(req.body.model || "").trim();
      if (!model) {
        return res.status(400).json({ error: "Model is required" });
      }

      await appSettingsStorage.setAIModel(model);
      res.json({ aiModel: model });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/settings/wire-routing", isAdmin, async (req, res) => {
    try {
      const { enabled, defaultStyle } = req.body;

      if (typeof enabled === "boolean") {
        await appSettingsStorage.setWireRoutingSelectorEnabled(enabled);
      }
      if (defaultStyle !== undefined) {
        if (!WIRE_ROUTING_STYLE_VALUES.includes(String(defaultStyle))) {
          return res.status(400).json({ error: `Invalid style. Must be one of: ${WIRE_ROUTING_STYLE_VALUES.join(", ")}` });
        }
        await appSettingsStorage.setDefaultWireRoutingStyle(String(defaultStyle));
      }

      const [wireRoutingSelectorEnabled, defaultWireRoutingStyle] = await Promise.all([
        appSettingsStorage.getWireRoutingSelectorEnabled(),
        appSettingsStorage.getDefaultWireRoutingStyle(),
      ]);
      res.json({ wireRoutingSelectorEnabled, defaultWireRoutingStyle });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const analytics = await observabilityStorage.getAnalytics(days);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Error breakdown by type + most frequent messages
  app.get("/api/admin/observability/error-breakdown", isAdmin, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const breakdown = await observabilityStorage.getErrorBreakdown(days);
      res.json(breakdown);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top events by name
  app.get("/api/admin/observability/top-events", isAdmin, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const topEvents = await observabilityStorage.getTopEvents(days);
      res.json(topEvents);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Session engagement metrics
  app.get("/api/admin/observability/session-metrics", isAdmin, async (req, res) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      const metrics = await observabilityStorage.getSessionMetrics(days);
      res.json(metrics);
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
