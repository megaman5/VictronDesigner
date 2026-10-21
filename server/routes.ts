import { buildDesignReview } from "@shared/design-review";
import { wirePreflight, prefersAICandidate, candidateDecision, AICorrectionTracker } from "@shared/ai-policy";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { feedbackStorage } from "./feedback-storage";
import { registerDesignRoutes } from "./design-routes";
import { observabilityStorage } from "./observability-storage";
import { appSettingsStorage, DEFAULT_AI_MODEL, DEFAULT_WIRE_ROUTING_STYLE, WIRE_ROUTING_STYLE_VALUES } from "./app-settings-storage";
import { normalizeAIDesign } from "./ai-design-normalizer";
import { parseAIDesign } from "./ai/parse-design";
import { createRequirementContext, annotateCandidate, requirementFeedback, preserveRepairEquipment, createAIRunBudget, repairFeedback, reviewFeedback } from "./ai/requirements";
import { registerAIRoutes } from "./ai/routes";
import { systemDesignSkill, wireComponentsSkill } from "./ai/skills";
import { insertSchematicSchema, updateSchematicSchema, insertCustomComponentSchema, updateCustomComponentSchema, type AISystemRequest, type AISystemResponse } from "@shared/schema";
import { customComponentsStorage } from "./custom-components-storage";
import { DEVICE_DEFINITIONS } from "@shared/device-definitions";
import { calculateWireSize, calculateLoadRequirements, getACVoltage, calculateInverterDCInput } from "./wire-calculator";
import { calculateRuntimeEstimates } from "./runtime-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
import { registerInstallationPackageRoute } from "./installation-package";
import { validateDesign } from "./design-validator";
import { renderSchematicToPNG, getVisualFeedback } from "./schematic-renderer";
import { hasKeyForModel } from "./ai/model-client";
import { AISession, canUseAIFallback, type FallbackEvent } from "./ai/fallback";
import { notifyAIFailure } from "./ai/failure-alerts";
import { describeAIError, isPermanentAIError, setErrorMessage } from "./ai/errors";
import { passport, isAdmin, isAuthenticated, type AuthUser } from "./auth";
import { handleOAuthCallbackError, oauthReturnPath } from "./oauth-callback";
import { checkQuota } from "./ai/usage-limits";
import { buildIterationUserMessage } from "./ai/schematic-image";

function recordFallbackFailure(req: Request, action: string, event: FallbackEvent) {
  void notifyAIFailure({ action, model: event.primaryModel, errorMessage: event.reason })
    .catch(error => console.error("[ai-fallback] Alert failed:", error));
  void observabilityStorage.logError({
    type: "ai_error", endpoint: req.path, visitorId: getVisitorId(req),
    userId: (req.user as AuthUser)?.id, message: event.reason,
    metadata: { primaryModel: event.primaryModel, fallbackModel: event.model, fallbackStarted: true },
  }).catch(error => console.error("[ai-fallback] Error logging failed:", error));
}

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
    (req: Request, res: Response) => {
      // Decode returnTo from state parameter
      let returnTo = "/";
      try {
        const state = req.query.state as string;
        if (state) {
          const decoded = JSON.parse(Buffer.from(state, "base64").toString());
          returnTo = oauthReturnPath(decoded.returnTo);
        }
      } catch (e) {
        console.error("Error decoding OAuth state:", e);
      }
      res.redirect(returnTo);
    },
    handleOAuthCallbackError
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
      res.json(buildDesignReview({ components, wires, systemVoltage, options: req.body.options, requirements: req.body.requirements }, validation));
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
    let aiSession: AISession | undefined;
    let attemptContext: ReturnType<typeof createRequirementContext> | undefined;
    let attemptedIterations = 0;
    const requestHistory: any[] = [];
    
    try {
      const requirementContext = attemptContext = createRequirementContext(req.body);
      const runBudget = createAIRunBudget(res, req.body.maxIterations);
      aiModel = await getAIModel();
      aiSession = new AISession(aiModel, event => {
        aiModel = event.model;
        recordFallbackFailure(req, "generate-system", event);
      });
      aiSession.signal = runBudget.signal; aiSession.deadline = runBudget.deadline;
      const { prompt, systemVoltage = 12 }: AISystemRequest = req.body;

      if (!hasKeyForModel(aiModel) && !canUseAIFallback()) {
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
        return res.json(annotateCandidate(mockResponse, requirementContext));
      }

      attemptedIterations = 1;
      const completion = await aiSession.create({
        model: aiModel,
        messages: [
          {
            role: "system",
            // Versioned system-design skill - see server/ai/skills
            content: systemDesignSkill.buildSystemPrompt({ systemVoltage }),
          },
          {
            role: "user",
            content: `Design a ${systemVoltage}V electrical system with the following requirements: ${prompt}${requirementFeedback(requirementContext)}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
      tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
      const response = parseAIDesign(completion.choices[0].message.content || "{}");

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
        const normalized = normalizeAIDesign(response.components, wiresWithIds, systemVoltage, { existingWires: requirementContext.inputSnapshot.existingDesign?.wires ?? [], allowWireLengthChanges: requirementContext.allowWireLengthChanges });
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
      }

      response.validation = validateDesign(response.components || [], response.wires || [], systemVoltage);
      annotateCandidate(response, requirementContext);
      if (aiSession.usedFallback) {
        aiSession.assertValidFallback(response.review, 70, response.requirementCheck);
      }

      requestHistory.push({ iteration: 1, model: aiModel, durationMs: Date.now() - startTime, finishReason: completion.choices[0]?.finish_reason, usage: completion.usage, review: response.review, requirementCheck: response.requirementCheck });
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
        qualityScore: response.validation.score,
        iterationHistory: requestHistory,
        durationMs: Date.now() - startTime,
        componentCount: response.components?.length || 0,
        wireCount: response.wires?.length || 0,
        ...aiSession?.metadata,
        model: aiModel,
        iterations: attemptedIterations,
        response: {
          attemptContext: { ...requirementContext, skillVersion: systemDesignSkill.version },
          requirements: requirementContext.requirements,
          requirementCheck: response.requirementCheck,
          runStatus: response.runStatus, review: response.review, stopReason: "single-pass",
          components: response.components,
          wires: response.wires,
          description: response.description,
          recommendations: response.recommendations,
        },
      });

      res.json({ ...annotateCandidate(response, requirementContext), ...aiSession.responseMetadata });
    } catch (error: any) {
      console.error("AI generation error:", error);
      setErrorMessage(error, describeAIError(error));
      
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
        iterations: attemptedIterations, iterationHistory: requestHistory, response: { attemptContext, abortCause: error.abortCause ?? aiSession?.metadata.aiRouting.abortCause, field: error.field, stopReason: error.abortCause ?? "request-failed" },
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        ...aiSession?.metadata,
        model: aiModel,
      });
      
      res.status([400, 422, 504].includes(error.status) ? error.status : 500).json({ error: error.message, field: error.field, abortCause: error.abortCause, iterations: attemptedIterations });
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
    let aiSession: AISession | undefined;
    let attemptContext: ReturnType<typeof createRequirementContext> | undefined;
    let attemptedIterations = 0;
    const requestHistory: any[] = [];
    
    try {
      const requirementContext = attemptContext = createRequirementContext(req.body);
      const runBudget = createAIRunBudget(res, req.body.maxIterations);
      aiModel = await getAIModel();
      aiSession = new AISession(aiModel, event => {
        aiModel = event.model;
        recordFallbackFailure(req, "wire-components", event);
      });
      const { 
        components, 
        wires = [],
        systemVoltage = 12,
        validationFeedback = null,
        wireCalculationIssues = [],
        minQualityScore = 70
      } = req.body;

      if (!components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ error: "Components array is required" });
      }

      const preflight = wirePreflight(components, requirementContext.requirements);
      if (preflight.length) {
        const candidate = annotateCandidate({ components, wires, validation: validateDesign(components, wires, systemVoltage) }, requirementContext);
        const result = { ...candidate, preflight, iterations: 0, stopReason: "preflight-blocked", description: "Review the required equipment and specifications before AI Wire. No AI request was made." };
        await observabilityStorage.logAIRequest({ visitorId, userId: user?.id, userEmail: user?.email, ip: clientIP, action: "wire-components", prompt: `Wire ${components.length} components`, systemVoltage, success: false, durationMs: Date.now() - startTime, iterations: 0, errorMessage: preflight.map(issue => issue.message).join(" "), response: { ...result, attemptContext: requirementContext } });
        return res.json(result);
      }
      const maxIterations = runBudget.maxIterations;
      aiSession.signal = runBudget.signal; aiSession.deadline = runBudget.deadline;
      const correctionTracker = new AICorrectionTracker();
      let correctionStopReason: string | undefined;
      let bestCandidate: any = null;
      let bestWires: any[] = [];
      let bestScore = 0;
      let bestValidation: any = null;
      let bestRequirementCheck: any = null;
      let stoppedForStagnation = false;
      const iterationHistory: any[] = requestHistory;
      const existingWires = wires.length > 0 ? wires : [];

      // Iterative improvement loop
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (runBudget.exhausted()) break;
        attemptedIterations = Math.max(attemptedIterations, iteration + 1);
        const iterationStartedAt = Date.now();
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
            currentValidation = buildDesignReview({ components, wires: wiresWithIds, systemVoltage }, validateDesign(components, wiresWithIds, systemVoltage));
          } catch (error) {
            console.error("Validation error during AI wire generation:", error);
          }
        }

        const currentCandidate = currentValidation ? { components, wires: wiresToValidate, review: currentValidation, validation: currentValidation } : null;
        const iterationFeedback = currentCandidate ? repairFeedback(currentCandidate) : "Create the initial wiring. Preserve declared equipment and do not invent specifications.";
        let completion;
        try { completion = await aiSession.create({
        model: aiModel,
        messages: [
          {
            role: "system",
            // Versioned wire-components skill - see server/ai/skills
            content: wireComponentsSkill.buildSystemPrompt({ systemVoltage }),
          },
          {
            role: "user",
            content: wireComponentsSkill.buildUserPrompt("Create the complete wiring for these components.", {
              systemVoltage,
              existingDesign: { components, wires: wiresToValidate },
              feedback: iterationFeedback + requirementFeedback(requirementContext, { requirementCheck: bestRequirementCheck }),
            }),
          },
        ],
        response_format: { type: "json_object" },
      });
        } catch (error: any) {
          iterationHistory.push({ iteration: iteration + 1, durationMs: Date.now() - iterationStartedAt, error: describeAIError(error), abortCause: error.abortCause, model: aiModel });
          // With a usable draft in hand, any provider failure ends the run with that draft.
          if (!bestCandidate) throw error;
          correctionStopReason = error.abortCause ?? "provider-error";
          break;
        }

        tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
        tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
        let response;
        try { response = parseAIDesign(completion.choices[0].message.content || "{}", true); }
        catch (error: any) {
          iterationHistory.push({ iteration: iteration + 1, durationMs: Date.now() - iterationStartedAt, error: error.message, model: aiModel });
          if (!bestCandidate) throw error;
          correctionStopReason = 'invalid-provider-output';
          break;
        }

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

        let mergedWires: any[] = response.wires || [];

        // Validate the merged wires (ensure all have unique IDs)
        let mergedWiresWithIds = mergedWires.map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));
        const repairCandidate = { components, wires: mergedWiresWithIds };
        preserveRepairEquipment(repairCandidate, bestCandidate ?? { components, wires: existingWires, validation: currentValidation }, components, requirementContext.allowWireLengthChanges);
        mergedWiresWithIds = normalizeAIDesign(components, repairCandidate.wires, systemVoltage, { existingWires: wires, allowWireLengthChanges: requirementContext.allowWireLengthChanges }).wires;
        mergedWires = mergedWiresWithIds;
        let validation = validateDesign(components, mergedWiresWithIds, systemVoltage);
        const candidate = annotateCandidate({ components, wires: mergedWiresWithIds, validation, producedByBackup: aiSession.usedFallback }, requirementContext);
        const candidateCheck = candidate.requirementCheck;
        const score = validation.score;
        
        console.log(`Iteration ${iteration + 1} validation score: ${score}/100`);
        console.log(`Errors: ${validation.issues.filter((i: any) => i.severity === "error").length}, Warnings: ${validation.issues.filter((i: any) => i.severity === "warning").length}`);

        iterationHistory.push({
          durationMs: Date.now() - iterationStartedAt,
          model: aiModel,
          skillVersion: wireComponentsSkill.version,
          requirementCheck: candidateCheck,
          validationIssues: validation.issues,
          finishReason: completion.choices[0]?.finish_reason,
          usage: completion.usage,
          repairScope: components.map((component: any) => component.id),
          iteration: iteration + 1,
          score,
          errorCount: validation.issues.filter((i: any) => i.severity === "error").length,
          warningCount: validation.issues.filter((i: any) => i.severity === "warning").length,
          wireCount: mergedWires.length,
        });

        // Keep track of best result
        if (prefersAICandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
          bestScore = score; bestWires = mergedWires; bestValidation = validation; bestRequirementCheck = candidateCheck;
        }
        const progress = correctionTracker.observe(candidate);
        const decision = candidateDecision(candidate, minQualityScore);
        iterationHistory.at(-1).review = candidate.review;
        iterationHistory.at(-1).continuationReasons = decision.continuationReasons;
        if (decision.stop || progress.stop) {
          correctionStopReason = decision.stop ? decision.reason : progress.reason;
          stoppedForStagnation = progress.stop && !decision.stop;
          break;
        }


      }

      if (!bestCandidate) throw new Error("No usable AI wiring candidate was returned.");
      bestCandidate.stopReason = correctionStopReason ?? runBudget.abortCause() ?? "iteration-budget";
      aiSession.assertValidFallback(bestCandidate.review, minQualityScore, bestCandidate.requirementCheck, bestCandidate.producedByBackup);

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
        iterations: attemptedIterations,
        qualityScore: Math.round(bestScore), // Round to integer for database
        componentCount: components.length,
        wireCount: bestWires.length,
        ...aiSession?.metadata,
        model: aiModel,
        response: {
          attemptContext: { ...requirementContext, skillVersion: wireComponentsSkill.version },
          requirements: requirementContext.requirements,
          requirementCheck: annotateCandidate({ components, wires: bestWires, validation: bestValidation }, requirementContext).requirementCheck,
          runStatus: bestCandidate.runStatus, review: bestCandidate.review, stopReason: bestCandidate.stopReason,
          wires: bestWires,
          description: `${stoppedForStagnation ? "Stopped because repeated corrections produced the same result. Review the remaining validation issues. " : ""}Wiring generated after ${iterationHistory.length} iteration(s). Quality score: ${bestScore}/100`,
          recommendations: stoppedForStagnation ? ["AI Wire stopped because repeated correction attempts produced the same result. Review the remaining validation issues and component settings before trying again."] : [],
        },
        validationFeedback: reviewFeedback(bestCandidate),
        iterationHistory,
      });

      res.json({
        ...aiSession.responseMetadata,
        ...annotateCandidate({ components, wires: bestWires, validation: bestValidation }, requirementContext),
        wires: bestWires,
        description: `${stoppedForStagnation ? "Stopped because repeated corrections produced the same result. Review the remaining validation issues. " : ""}Wiring generated after ${iterationHistory.length} iteration(s). Quality score: ${bestScore}/100`,
        recommendations: stoppedForStagnation ? ["AI Wire stopped because repeated correction attempts produced the same result. Review the remaining validation issues and component settings before trying again."] : [],
        iterations: attemptedIterations,
        stopReason: bestCandidate.stopReason,
        qualityScore: bestScore,
        validation: bestValidation,
      });
    } catch (error: any) {
      console.error("AI wire generation error:", error);
      setErrorMessage(error, describeAIError(error));
      
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
        iterations: attemptedIterations, iterationHistory: requestHistory, response: { attemptContext, abortCause: error.abortCause ?? aiSession?.metadata.aiRouting.abortCause, field: error.field, stopReason: error.abortCause ?? "request-failed" },
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        ...aiSession?.metadata,
        model: aiModel,
      });
      
      res.status([400, 422, 504].includes(error.status) ? error.status : 500).json({ error: error.message, field: error.field, abortCause: error.abortCause, iterations: attemptedIterations });
    }
  });

  // Iterative AI generation with quality validation
  app.post("/api/ai-generate-system-iterative", requireAiQuota, async (req, res) => {
    const startTime = Date.now();
    // Token usage for cost accounting. Accumulated across every model call
    // this request makes (the iterative endpoint makes several), so the
    // logged cost reflects the whole request, not just the last round.
    const tokenUsage = { inputTokens: 0, outputTokens: 0 };
    let aiModel = DEFAULT_AI_MODEL;
    let aiSession: AISession | undefined;
    let attemptContext: ReturnType<typeof createRequirementContext> | undefined;
    let attemptedIterations = 0;
    const requestHistory: any[] = [];

    try {
      const requirementContext = attemptContext = createRequirementContext(req.body);
      const runBudget = createAIRunBudget(res, req.body.maxIterations);
      aiModel = await getAIModel();
      aiSession = new AISession(aiModel, event => {
        aiModel = event.model;
        recordFallbackFailure(req, "iterate-design", event);
      });
      const {
        prompt,
        systemVoltage = 12,
        minQualityScore = 70,
        existingDesign // Optional: { components, wires } for iteration mode
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const maxIterations = runBudget.maxIterations;
      aiSession.signal = runBudget.signal; aiSession.deadline = runBudget.deadline;
      let bestDesign: any = null;
      let stoppedForRepeatedCandidate = false;
      let correctionStopReason: string | undefined;
      const correctionTracker = new AICorrectionTracker();
      let bestScore = 0;
      const iterationHistory: any[] = requestHistory;
      const finishDesign = async (finalIteration: number, achievedQualityThreshold: boolean) => {
        if (!bestDesign) throw new Error("No usable AI candidate was returned within the run budget.");
        annotateCandidate(bestDesign, requirementContext);
        finalIteration = attemptedIterations;
        bestDesign.stopReason = correctionStopReason ?? runBudget.abortCause() ?? (achievedQualityThreshold ? "quality-threshold" : "iteration-budget");
        achievedQualityThreshold = achievedQualityThreshold && candidateDecision(bestDesign, minQualityScore).reason === "quality-threshold";
        aiSession!.assertValidFallback(bestDesign?.review, minQualityScore, bestDesign?.requirementCheck, bestDesign?.producedByBackup);
        await observabilityStorage.logAIRequest({
          ...tokenUsage, ...aiSession!.metadata, visitorId: getVisitorId(req),
          userId: (req.user as AuthUser)?.id, userEmail: (req.user as AuthUser)?.email,
          ip: getClientIP(req), action: "iterate-design", prompt, systemVoltage,
          success: true, durationMs: Date.now() - startTime, iterations: finalIteration,
          qualityScore: Math.round(bestScore), componentCount: bestDesign?.components?.length || 0,
          wireCount: bestDesign?.wires?.length || 0, response: { ...bestDesign, attemptContext: requirementContext }, iterationHistory,
        });
        if (res.destroyed) return;
        res.json({ ...bestDesign, ...aiSession!.responseMetadata, iterationHistory, finalIteration, achievedQualityThreshold: achievedQualityThreshold && bestDesign.requirementCheck.issues.length === 0, stopReason: bestDesign.stopReason });
      };

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (runBudget.exhausted()) break;
        attemptedIterations = Math.max(attemptedIterations, iteration + 1);
        const iterationStartedAt = Date.now();
        console.log(`\n=== Iteration ${iteration + 1}/${maxIterations} ===`);

        const feedbackContext = bestDesign ? repairFeedback(bestDesign) : "";

        const systemMessage = systemDesignSkill.buildSystemPrompt({ systemVoltage });

        const userMessage = bestDesign
          ? `${prompt}\n\nPrevious best design:\n${JSON.stringify({ components: bestDesign.components, wires: bestDesign.wires })}${feedbackContext}\n\nReturn a corrected COMPLETE design that addresses this feedback and preserves the original requirements.`
          : prompt;

        // From the second round on, show the model what it just built.
        const userContent = buildIterationUserMessage(userMessage + requirementFeedback(requirementContext, bestDesign), bestDesign, aiModel);

        let completion;
        try { completion = await aiSession.create({
          model: aiModel,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userContent as any }
          ],
          max_completion_tokens: 128000,
        });
        } catch (error: any) {
          iterationHistory.push({ iteration: iteration + 1, durationMs: Date.now() - iterationStartedAt, error: describeAIError(error), abortCause: error.abortCause, model: aiModel });
          // With a usable draft in hand, any provider failure ends the run with that draft.
          if (!bestDesign) throw error;
          correctionStopReason = error.abortCause ?? "provider-error";
          break;
        }

        tokenUsage.inputTokens += completion.usage?.prompt_tokens ?? 0;
        tokenUsage.outputTokens += completion.usage?.completion_tokens ?? 0;
        const content = completion.choices[0].message.content;
        if (!content) {
          throw new Error("Empty response from AI");
        }

        let response: AISystemResponse;
        try {
          response = parseAIDesign(content);
        } catch (err) {
          console.error(`Failed to parse AI response - AI returned: ${content.substring(0, 500)}...`);
          iterationHistory.push({ iteration: iteration + 1, durationMs: Date.now() - iterationStartedAt, error: describeAIError(err as Error), model: aiModel });
          if (!bestDesign) throw err;
          correctionStopReason = 'invalid-provider-output';
          break;
        }

        // Validate the design (ensure all wires have unique IDs)
        const rawWiresWithIds = (response.wires || []).map((wire: any, index: number) => ({
          ...wire,
          id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}`
        }));

        // Repair the two things the model reliably gets wrong - invented
        // terminal ids and guessed wire gauges - before scoring the design.
        // Both are computable, so spending iterations on them is wasted.
        preserveRepairEquipment(response, bestDesign, [], requirementContext.allowWireLengthChanges);
        const normalized = normalizeAIDesign(response.components, (response.wires || []).map((wire: any, index: number) => ({ ...wire, id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}` })), systemVoltage, { existingWires: requirementContext.inputSnapshot.existingDesign?.wires ?? [], allowWireLengthChanges: requirementContext.allowWireLengthChanges });
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
          for (const r of normalized.repairs.slice(0, 10)) console.log(`  ${r.kind}: ${r.detail}`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
        annotateCandidate(response, requirementContext);
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
          durationMs: Date.now() - iterationStartedAt,
          model: aiModel,
          skillVersion: systemDesignSkill.version,
          requirementCheck: (response as any).requirementCheck,
          repairScope: bestDesign?.validation?.issues.flatMap((issue: any) => issue.componentIds || []) || [],
          iteration: iteration + 1,
          finishReason: completion.choices[0]?.finish_reason,
          usage: completion.usage,
          validationIssues: validation.issues,
          score: validation.score,
          errorCount: validation.issues.filter(i => i.severity === 'error').length,
          warningCount: validation.issues.filter(i => i.severity === 'warning').length,
          design: response,
          validation
        });

        (response as any).validation = validation;
        annotateCandidate(response, requirementContext);
        const progress = correctionTracker.observe(response);
        const decision = candidateDecision(response, minQualityScore);
        iterationHistory.at(-1).review = (response as any).review;
        iterationHistory.at(-1).continuationReasons = decision.continuationReasons;
        if (progress.stop && !decision.stop) { stoppedForRepeatedCandidate = true; correctionStopReason = progress.reason; }
        if (decision.stop) correctionStopReason = decision.reason;

        // Update best design if this is better OR if we don't have one yet
        if (prefersAICandidate(response, bestDesign)) {
          bestScore = validation.score;
          bestDesign = {
            ...response,
            validation,
            visualFeedback,
            producedByBackup: aiSession!.usedFallback,
          };
        }

        if (stoppedForRepeatedCandidate) break;

        if (decision.stop) {
          await finishDesign(iterationHistory.length, decision.reason === "quality-threshold");
          return;
        }
      }

      // Return best design after max iterations
      console.log(`Max iterations reached. Best score: ${bestScore}/${minQualityScore}`);
      await finishDesign(iterationHistory.length, candidateDecision(bestDesign, minQualityScore).reason === "quality-threshold");

    } catch (error: any) {
      console.error("Iterative AI generation error:", error);
      setErrorMessage(error, describeAIError(error));
      await observabilityStorage.logAIRequest({
        ...tokenUsage, visitorId: getVisitorId(req),
        userId: (req.user as AuthUser)?.id, userEmail: (req.user as AuthUser)?.email,
        ip: getClientIP(req), action: "iterate-design",
        prompt: req.body.prompt || "", systemVoltage: req.body.systemVoltage || 12,
        success: false, iterations: attemptedIterations, iterationHistory: requestHistory, response: { attemptContext, abortCause: error.abortCause ?? aiSession?.metadata.aiRouting.abortCause, field: error.field, stopReason: error.abortCause ?? "request-failed" }, durationMs: Date.now() - startTime,
        errorMessage: error.message, model: aiModel,
        ...aiSession?.metadata,
      });
      res.status([400, 422, 504].includes(error.status) ? error.status : 500).json({ error: error.message, field: error.field, abortCause: error.abortCause, iterations: attemptedIterations });
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
    let aiSession: AISession | undefined;
    let attemptContext: ReturnType<typeof createRequirementContext> | undefined;
    let attemptedIterations = 0;
    const requestHistory: any[] = [];
    
    try {
      const requirementContext = attemptContext = createRequirementContext(req.body);
      const runBudget = createAIRunBudget(res, req.body.maxIterations);
      aiModel = await getAIModel();
      const {
        prompt,
        systemVoltage = 12,
        minQualityScore = 70,
        existingDesign // Optional: { components, wires } for iteration mode
      } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`[SSE] Starting generation: ${runBudget.maxIterations} iterations, min score ${minQualityScore}`);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      // Keep proxies connected while the provider is planning. These comments
      // are transport keepalives, never evidence of model activity.
      const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
      }, 15_000);
      res.once('close', () => clearInterval(heartbeat));
      res.once('finish', () => clearInterval(heartbeat));

      const sendEvent = (event: string, data: any) => {
        if (res.destroyed || res.writableEnded) return;
        console.log(`[SSE] Sending event: ${event}`, data);
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      aiSession = new AISession(aiModel, event => {
        aiModel = event.model;
        recordFallbackFailure(req, "iterate-design", event);
        sendEvent("ai-fallback", { model: event.model, provider: event.provider });
      });

      const maxIterations = runBudget.maxIterations;
      aiSession.signal = runBudget.signal; aiSession.deadline = runBudget.deadline;
      let bestDesign: any = null;
      let stoppedForRepeatedCandidate = false;
      let correctionStopReason: string | undefined;
      const correctionTracker = new AICorrectionTracker();
      let bestScore = 0;
      const iterationHistory: any[] = requestHistory;
      
      // Store full messages at the start for observability
      let fullSystemMessage = "";
      let fullUserMessage = "";

      console.log(`[SSE] Starting iteration loop: ${maxIterations} iterations`);

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (runBudget.exhausted()) break;
        attemptedIterations = Math.max(attemptedIterations, iteration + 1);
        const iterationStartedAt = Date.now();
        console.log(`[SSE] Iteration ${iteration + 1} of ${maxIterations} starting...`);
        sendEvent('iteration-start', { iteration: iteration + 1, maxIterations });

        try {
          const feedbackContext = bestDesign ? repairFeedback(bestDesign) : "";

        const systemMessage = systemDesignSkill.buildSystemPrompt({ systemVoltage });

        const userMessage = bestDesign
          ? `${prompt}\n\nPrevious best design:\n${JSON.stringify({ components: bestDesign.components, wires: bestDesign.wires })}${feedbackContext}\n\nReturn a corrected COMPLETE design that addresses this feedback and preserves the original requirements.`
          : prompt;

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
        const userContent = buildIterationUserMessage(userMessage + requirementFeedback(requirementContext, bestDesign), bestDesign, aiModel);
        if (Array.isArray(userContent)) {
          sendEvent('ai-layout-image', { iteration: iteration + 1 });
        }

        // Stream the AI response
        const stream = await aiSession.create({
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
        let finishReason: string | null = null;
        let promptTokens = 0;
        let completionTokens = 0;
        let lastTokenTime = Date.now();
        let lastActivityTime = 0;
        let tokenBuffer = "";

        // Stream tokens as they arrive
        for await (const chunk of stream) {
          if (Date.now() - lastActivityTime >= 1000) {
            sendEvent('ai-activity', { iteration: iteration + 1, phase: chunk.choices?.some(choice => choice.delta?.content) ? 'drawing' : 'planning' });
            lastActivityTime = Date.now();
          }
          if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            rawResponse += delta.content; // Accumulate raw response
            tokenBuffer += delta.content;
            
            // Batch draft redraws to keep the interface responsive.
            const now = Date.now();
            if (now - lastTokenTime > 200) {
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
          response = parseAIDesign(content);
        } catch (err: any) {
          console.error(`[SSE] Iteration ${iteration + 1}: Failed to parse AI response - AI returned: ${content.substring(0, 500)}...`);
          iterationHistory.push({ iteration: iteration + 1, durationMs: Date.now() - iterationStartedAt, error: err.message, model: aiModel });
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: `Invalid JSON: ${err.message}`
          });
          if (bestDesign) { correctionStopReason = 'invalid-provider-output'; break; }
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
        preserveRepairEquipment(response, bestDesign, [], requirementContext.allowWireLengthChanges);
        const normalized = normalizeAIDesign(response.components, (response.wires || []).map((wire: any, index: number) => ({ ...wire, id: wire.id || `wire-${index}-${wire.fromComponentId}-${wire.toComponentId}-${wire.polarity}` })), systemVoltage, { existingWires: requirementContext.inputSnapshot.existingDesign?.wires ?? [], allowWireLengthChanges: requirementContext.allowWireLengthChanges });
        if (normalized.repairs.length > 0) {
          console.log(`[AI] Normalized design: ${normalized.repairs.length} repair(s)`);
          for (const r of normalized.repairs.slice(0, 10)) console.log(`  ${r.kind}: ${r.detail}`);
        }
        response.components = normalized.components;
        response.wires = normalized.wires;
        annotateCandidate(response, requirementContext);
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
          durationMs: Date.now() - iterationStartedAt,
          model: aiModel,
          skillVersion: systemDesignSkill.version,
          finishReason,
          usage: { inputTokens: promptTokens, outputTokens: completionTokens },
          validationIssues: validation.issues,
          requirementCheck: (response as any).requirementCheck,
          repairScope: bestDesign?.validation?.issues.flatMap((issue: any) => issue.componentIds || []) || [],
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

        (response as any).validation = validation;
        annotateCandidate(response, requirementContext);
        const progress = correctionTracker.observe(response);
        const decision = candidateDecision(response, minQualityScore);
        iterationHistory.at(-1).review = (response as any).review;
        iterationHistory.at(-1).continuationReasons = decision.continuationReasons;
        if (progress.stop && !decision.stop) { stoppedForRepeatedCandidate = true; correctionStopReason = progress.reason; }
        if (decision.stop) correctionStopReason = decision.reason;

        // Update best design if this is better, or if we don't have one yet
        if (prefersAICandidate(response, bestDesign)) {
          bestScore = validation.score;
          bestDesign = {
            ...response,
            validation,
            visualFeedback,
            producedByBackup: aiSession!.usedFallback,
          };
        }

        annotateCandidate(bestDesign, requirementContext);
        sendEvent('iteration-complete', {
          requirementCheck: (response as any).requirementCheck,
          iteration: iteration + 1,
          score: validation.score,
          errorCount: validation.issues.filter(i => i.severity === 'error').length,
          warningCount: validation.issues.filter(i => i.severity === 'warning').length,
          isBest: validation.score === bestScore
        });

        if (stoppedForRepeatedCandidate) break;

        if (decision.stop && decision.reason !== "quality-threshold") break;
        // All supported electrical and declared requirement checks must pass.
        if (decision.stop && decision.reason === "quality-threshold") {
          const validationFeedback = reviewFeedback(bestDesign);
          aiSession.assertValidFallback(bestDesign.review, minQualityScore, bestDesign.requirementCheck, bestDesign.producedByBackup);

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
            ...aiSession?.metadata,
            model: aiModel,
            systemMessage: fullSystemMessage,
            userMessage: fullUserMessage,
            rawResponse: rawResponse,
            validationFeedback,
            iterationHistory,
            response: {
          attemptContext: { ...requirementContext, skillVersion: systemDesignSkill.version },
          requirements: requirementContext.requirements,
          requirementCheck: bestDesign?.requirementCheck,
          runStatus: bestDesign?.runStatus, review: bestDesign?.review, stopReason: correctionStopReason ?? runBudget.abortCause() ?? "iteration-budget",
              components: bestDesign.components,
              wires: bestDesign.wires,
              description: bestDesign.description,
              recommendations: bestDesign.recommendations,
            },
          });
          
          annotateCandidate(bestDesign, requirementContext);
      sendEvent('complete', {
            ...aiSession.responseMetadata,
            ...bestDesign,
            iterationHistory,
            finalIteration: iteration + 1,
            stopReason: "quality-threshold",
            achievedQualityThreshold: true
          });
          res.end();
          return;
        }
        } catch (iterationError: any) {
          // Billing/auth/configuration errors cannot improve on another iteration.
          if (iterationError.retryWithFallback) {
            iteration--; // Retry this pass with an empty buffer and the sticky backup model.
            continue;
          }
          const providerGaveUp = iterationError.fallbackExhausted || isPermanentAIError(iterationError);
          // With a usable draft in hand, return it rather than failing the request.
          if (providerGaveUp && !bestDesign) throw iterationError;
          console.error(`[SSE] Iteration ${iteration + 1} failed:`, iterationError);
          iterationHistory.push({
            iteration: iteration + 1, score: 0, errorCount: 1, warningCount: 0, durationMs: Date.now() - iterationStartedAt, abortCause: iterationError.abortCause,
            error: describeAIError(iterationError),
          });
          sendEvent('iteration-complete', {
            iteration: iteration + 1,
            score: 0,
            errorCount: 1,
            warningCount: 0,
            isBest: false,
            error: iterationError.message || "Iteration failed"
          });
          if (iterationError.abortCause || providerGaveUp) { correctionStopReason = iterationError.abortCause ?? "provider-error"; break; }
          // Continue after a recoverable parser/provider error.
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
          iterations: attemptedIterations,
          errorMessage: iterationHistory.at(-1)?.error || "All iterations failed - no valid design generated. Check iteration history for details.",
          ...aiSession?.metadata,
          model: aiModel,
          systemMessage: fullSystemMessage,
          userMessage: fullUserMessage,
          iterationHistory: iterationHistory,
        });
        
        sendEvent('error', {
          error: iterationHistory.at(-1)?.error || 'Failed to generate a valid design after all iterations. Check iteration history for details.',
          iterationHistory,
          finalIteration: attemptedIterations
        });
        res.end();
        return;
      }

      const finalValidationFeedback = reviewFeedback(bestDesign);
      aiSession.assertValidFallback(bestDesign.review, minQualityScore, bestDesign.requirementCheck, bestDesign.producedByBackup);

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
        iterations: attemptedIterations,
        qualityScore: bestScore,
        componentCount: bestDesign.components?.length || 0,
        wireCount: bestDesign.wires?.length || 0,
        ...aiSession?.metadata,
        model: aiModel,
        systemMessage: fullSystemMessage,
        userMessage: fullUserMessage,
        validationFeedback: finalValidationFeedback,
        iterationHistory: iterationHistory,
        response: {
          attemptContext: { ...requirementContext, skillVersion: systemDesignSkill.version },
          requirements: requirementContext.requirements,
          requirementCheck: bestDesign?.requirementCheck,
          runStatus: bestDesign?.runStatus, review: bestDesign?.review, stopReason: correctionStopReason ?? runBudget.abortCause() ?? "iteration-budget",
          components: bestDesign.components,
          wires: bestDesign.wires,
          description: bestDesign.description,
          recommendations: bestDesign.recommendations,
        },
      });

      annotateCandidate(bestDesign, requirementContext);
      sendEvent('complete', {
        ...aiSession.responseMetadata,
        ...bestDesign,
        iterationHistory,
        finalIteration: attemptedIterations,
        stopReason: correctionStopReason ?? runBudget.abortCause() ?? "iteration-budget",
        achievedQualityThreshold: candidateDecision(bestDesign, minQualityScore).reason === "quality-threshold"
      });
      res.end();

    } catch (error: any) {
      console.error("SSE streaming error:", error);
      setErrorMessage(error, describeAIError(error));
      
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
        iterations: attemptedIterations, iterationHistory: requestHistory, response: { attemptContext, abortCause: error.abortCause ?? aiSession?.metadata.aiRouting.abortCause, field: error.field, stopReason: error.abortCause ?? "request-failed" },
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        ...aiSession?.metadata,
        model: aiModel,
      });
      
      if (!res.headersSent) return res.status([400, 422, 504].includes(error.status) ? error.status : 500).json({ error: error.message, field: error.field, abortCause: error.abortCause });
      if (res.destroyed || res.writableEnded) return;
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message, abortCause: error.abortCause, iterations: attemptedIterations })}\n\n`);
      res.end();
    }
  });

  registerInstallationPackageRoute(app);

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
      res.attachment(`${name}-report.txt`);
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
      res.attachment(`${schematic.name}-shopping-list.csv`);
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
      res.attachment(`${schematic.name}-report.txt`);
      res.send(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  registerDesignRoutes(app, requireAuth);

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
