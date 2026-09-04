import type { Express, Request, Response } from "express";
import { isAdmin, isAuthenticated, type AuthUser } from "../auth";
import { byokStorage } from "./byok-storage";
import { KeyVaultError, redactSecrets } from "./key-vault";
import { checkQuota, getMonthlySpend, monthlyLimitUsd } from "./usage-limits";
import { allowanceAdmin } from "./allowance-admin";
import { PROVIDERS } from "./providers";
import { listSuites, getSuite } from "./benchmark/cases";
import { listSkills, getSkill } from "./skills";
import { startBenchmarkRun, cancelBenchmarkRun, listActiveRuns } from "./benchmark/service";
import { benchmarkStorage } from "./benchmark/storage";
import { describeProviders, inferProvider, type ProviderId } from "./providers";
import { MODEL_PRICING, PRICING_AS_OF, isPriced } from "./pricing";

/**
 * Admin API for the benchmarking system.
 *
 * Everything here is admin-only: runs spend real money against the platform
 * key unless the caller supplies their own.
 */
export function registerAIRoutes(app: Express): void {
  // --- discovery ---------------------------------------------------------

  app.get("/api/admin/ai/providers", isAdmin, (_req, res) => {
    res.json({
      providers: describeProviders(),
      pricing: {
        asOf: PRICING_AS_OF,
        pricedModels: Object.keys(MODEL_PRICING),
        note: "Models outside this list report a null cost rather than an assumed zero.",
      },
    });
  });

  app.get("/api/admin/ai/skills", isAdmin, (_req, res) => {
    res.json({ skills: listSkills() });
  });

  /** Render a skill's prompt so changes can be reviewed without a model call. */
  app.get("/api/admin/ai/skills/:id/preview", isAdmin, (req, res) => {
    try {
      const skill = getSkill(req.params.id);
      const systemVoltage = Number(req.query.systemVoltage ?? 12);
      const prompt = String(req.query.prompt ?? "Design a 12V camper van system.");
      const ctx = { systemVoltage };
      res.json({
        id: skill.id,
        version: skill.version,
        systemPrompt: skill.buildSystemPrompt(ctx),
        userPrompt: skill.buildUserPrompt(prompt, ctx),
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.get("/api/admin/ai/suites", isAdmin, (_req, res) => {
    res.json({ suites: listSuites() });
  });

  // --- bring your own key (per user, not admin) ---------------------------

  /** Which providers a user may store a key for, and whether they have one. */
  app.get("/api/ai/keys", isAuthenticated, async (req, res) => {
    const user = req.user as AuthUser;
    if (!byokStorage.isAvailable()) {
      return res.status(503).json({
        error: "Key storage is not configured on this server (API_KEY_ENCRYPTION_KEY is unset).",
      });
    }
    try {
      const keys = await byokStorage.listKeys(user.id);
      res.json({
        keys, // last four only - the key itself is never returned
        providers: Object.values(PROVIDERS).map(p => ({
          id: p.id,
          label: p.label,
          requiresBaseUrl: p.requiresBaseUrl,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  app.put("/api/ai/keys/:provider", isAuthenticated, async (req, res) => {
    const user = req.user as AuthUser;
    const provider = req.params.provider as keyof typeof PROVIDERS;

    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider "${provider}"` });
    }
    if (!byokStorage.isAvailable()) {
      return res.status(503).json({ error: "Key storage is not configured on this server." });
    }

    const { apiKey, baseUrl, label } = req.body ?? {};
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    if (PROVIDERS[provider].requiresBaseUrl && !baseUrl) {
      return res.status(400).json({ error: `${PROVIDERS[provider].label} also needs a baseUrl` });
    }

    try {
      const saved = await byokStorage.saveKey({
        userId: user.id,
        provider,
        apiKey,
        baseUrl,
        label,
      });
      res.json({ saved });
    } catch (err: any) {
      const status = err instanceof KeyVaultError ? 400 : 500;
      res.status(status).json({ error: redactSecrets(err.message) });
    }
  });

  app.delete("/api/ai/keys/:provider", isAuthenticated, async (req, res) => {
    const user = req.user as AuthUser;
    const provider = req.params.provider as keyof typeof PROVIDERS;
    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider "${provider}"` });
    }
    const deleted = await byokStorage.deleteKey(user.id, provider);
    res.json({ deleted });
  });

  /** What the signed-in user has spent this month against the platform key. */
  app.get("/api/ai/usage", isAuthenticated, async (req, res) => {
    const user = req.user as AuthUser;
    try {
      const quota = await checkQuota(user.id);
      res.json({
        limitUsd: quota.limitUsd,
        spentUsd: Number(quota.spend.costUsd.toFixed(4)),
        remainingUsd: Number(quota.remainingUsd.toFixed(4)),
        lifetimeLimitUsd: Number(quota.lifetimeLimitUsd.toFixed(4)),
        lifetimeSpentUsd: Number(quota.lifetimeSpentUsd.toFixed(4)),
        lifetimeRemainingUsd: Number(quota.lifetimeRemainingUsd.toFixed(4)),
        blockedBy: quota.blockedBy,
        reason: quota.reason,
        requests: quota.spend.requests,
        // Requests on models with no price entry - cost is unknown, not zero
        unpricedRequests: quota.spend.unpricedRequests,
        inputTokens: quota.spend.inputTokens,
        outputTokens: quota.spend.outputTokens,
        since: quota.spend.since.toISOString(),
        allowed: quota.allowed,
      });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  // --- per-user AI allowance (admin) --------------------------------------

  app.get("/api/admin/ai/usage", isAdmin, async (_req, res) => {
    try {
      res.json({
        users: await allowanceAdmin.listUserUsage(),
        defaultLifetimeLimitUsd: allowanceAdmin.defaultLifetimeLimitUsd(),
        monthlyLimitUsd: allowanceAdmin.monthlyLimitUsd(),
      });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  /** Daily spend across all users, for the usage-over-time chart. */
  app.get("/api/admin/ai/usage/daily", isAdmin, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
      res.json({ days: await allowanceAdmin.listDailyUsage(days) });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  /** Set a user's total allowance outright. */
  app.post("/api/admin/ai/usage/:userId/limit", isAdmin, async (req, res) => {
    const admin = req.user as AuthUser;
    const limitUsd = Number(req.body?.limitUsd);
    if (!Number.isFinite(limitUsd) || limitUsd < 0) {
      return res.status(400).json({ error: "limitUsd must be a non-negative number" });
    }
    try {
      const row = await allowanceAdmin.setLifetimeLimit(
        req.params.userId,
        limitUsd,
        admin.email,
        req.body?.note
      );
      res.json({ allowance: row });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  /** Add credit on top of the current allowance - the "they tipped me" path. */
  app.post("/api/admin/ai/usage/:userId/credit", isAdmin, async (req, res) => {
    const admin = req.user as AuthUser;
    const amountUsd = Number(req.body?.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: "amountUsd must be a positive number" });
    }
    try {
      const row = await allowanceAdmin.grantCredit(
        req.params.userId,
        amountUsd,
        admin.email,
        req.body?.note
      );
      res.json({ allowance: row });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  /** Start counting this user's spend from now, leaving their history intact. */
  app.post("/api/admin/ai/usage/:userId/reset", isAdmin, async (req, res) => {
    const admin = req.user as AuthUser;
    try {
      const row = await allowanceAdmin.resetSpend(req.params.userId, admin.email, req.body?.note);
      res.json({ allowance: row });
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) });
    }
  });

  // --- runs --------------------------------------------------------------

  app.post("/api/admin/ai/benchmarks", isAdmin, async (req: Request, res: Response) => {
    try {
      const {
        suiteId,
        model,
        provider,
        repeats = 1,
        iterations = 1,
        targetScore,
        temperature,
        seed,
        label,
        apiKey,
        baseUrl,
        maxOutputTokens,
        caseIds,
        judge = false,
        judges,
      } = req.body ?? {};

      if (!suiteId || !model) {
        return res.status(400).json({ error: "suiteId and model are required" });
      }
      getSuite(suiteId); // throws on unknown suite

      if (repeats < 1 || repeats > 10) {
        return res.status(400).json({ error: "repeats must be between 1 and 10" });
      }

      const providerId: ProviderId = provider ?? inferProvider(model);
      const user = req.user as AuthUser | undefined;

      const { runId } = await startBenchmarkRun({
        suiteId,
        model,
        providerId,
        repeats,
        iterations,
        targetScore,
        temperature,
        seed,
        maxOutputTokens,
        caseIds: Array.isArray(caseIds) ? caseIds : undefined,
        judge: Boolean(judge),
        judges: Array.isArray(judges) ? judges : undefined,
        label,
        triggeredBy: user?.email,
        credentials: apiKey ? { apiKey, baseUrl } : null,
      });

      res.status(202).json({
        runId,
        model,
        provider: providerId,
        repeats,
        priced: isPriced(model),
        note: isPriced(model)
          ? undefined
          : "This model has no price entry, so cost will be reported as null.",
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/api/admin/ai/benchmarks", isAdmin, async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const runs = await benchmarkStorage.listRuns(limit);
    res.json({ runs, active: listActiveRuns() });
  });

  app.get("/api/admin/ai/benchmarks/:id", isAdmin, async (req, res) => {
    const found = await benchmarkStorage.getRun(req.params.id);
    if (!found) return res.status(404).json({ error: "Run not found" });
    res.json(found);
  });

  app.post("/api/admin/ai/benchmarks/:id/cancel", isAdmin, (req, res) => {
    const cancelled = cancelBenchmarkRun(req.params.id);
    res.json({ cancelled });
  });

  /** Latest completed runs for a suite, for side-by-side comparison. */
  app.get("/api/admin/ai/benchmarks/compare/:suiteId", isAdmin, async (req, res) => {
    const runs = await benchmarkStorage.compareSuite(req.params.suiteId);
    res.json({ runs });
  });
}
