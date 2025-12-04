import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSchematicSchema, updateSchematicSchema, type AISystemRequest } from "@shared/schema";
import { calculateWireSize, calculateLoadRequirements } from "./wire-calculator";
import { generateShoppingList, generateWireLabels, generateCSV, generateSystemReport } from "./export-utils";
import { validateDesign } from "./design-validator";
import { renderSchematicToPNG, getVisualFeedback } from "./schematic-renderer";
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

      const validationResult = validateDesign(components, wires, systemVoltage);
      res.json(validationResult);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI-powered system generation
  app.post("/api/ai-generate-system", async (req, res) => {
    try {
      const { prompt, systemVoltage = 12 }: AISystemRequest = req.body;

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

LAYOUT RULES (CRITICAL - PREVENT OVERLAP):
1. Minimum 300px horizontal spacing between component centers
2. Minimum 250px vertical spacing between component centers
3. First component starts at x≥100, y≥100
4. Use left-to-right flow: Battery → Controllers → Inverters → Loads
5. Bus bars can centralize multiple connections (use when 3+ loads)
6. Example positions:
   - Battery: x=150, y=400
   - MPPT: x=500, y=400 (350px from battery)
   - Solar: x=500, y=150 (250px above MPPT)
   - MultiPlus: x=850, y=400 (350px from MPPT)
   - SmartShunt (if used): x=150, y=550 (below battery)
   - Positive Bus: x=900, y=200 (above loads)
   - Negative Bus: x=900, y=600 (below loads)
   - Loads: x=1100-1400, y=300-500 (stacked vertically)

COMPONENT TERMINALS (EXACT NAMES):
- multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative" (battery side), "system-minus" (system side), "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "ac-in"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"

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
1. SmartShunt MUST be in negative path between battery and ALL loads
   - Battery negative → SmartShunt "negative" terminal
   - SmartShunt "system-minus" → All loads' negative terminals
   - This ensures ALL current flows through the shunt for accurate monitoring
2. Use SEPARATE bus bars for DC and AC circuits when both are present:
   - DC Bus Bars (12V/24V): Connect DC loads (dc-load) to dedicated DC positive/negative busbars
   - AC Bus Bars (120V/230V): Connect AC loads (ac-load) to dedicated AC positive/negative busbars OR directly to inverter AC outputs
   - Name busbars clearly: "DC Positive Bus", "DC Negative Bus", "AC Positive Bus", "AC Negative Bus"
   - Never connect DC and AC loads to the same bus bar
3. Use bus bars when connecting 3+ devices of the same type to simplify wiring
4. Main battery cables (battery to inverter): Use largest gauge
5. Never mix polarities on same bus bar

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

  // AI-powered system generation with iterative quality improvement (SSE version for real-time updates)
  app.post("/api/ai-generate-system-stream", async (req, res) => {
    try {
      const { prompt, systemVoltage = 12, minQualityScore = 70, maxIterations = 5 } = req.body;

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Helper function to send SSE message
      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      let currentIteration = 0;
      let bestDesign: any = null;
      let bestScore = 0;
      let validationHistory: any[] = [];

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Helper function to generate design
      const generateDesign = async (userPrompt: string, feedbackContext: string = '') => {
        const systemMessage = `You are an expert electrical system designer specializing in Victron Energy marine and RV electrical systems. Design complete, safe, code-compliant electrical systems.

CANVAS: 2000px wide × 1500px tall

COMPONENT DIMENSIONS & SPACING:
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

LAYOUT RULES (CRITICAL - PREVENT OVERLAP):
1. Minimum 300px horizontal spacing between component LEFT edges (x coordinates)
2. Minimum 250px vertical spacing between component TOP edges (y coordinates)
3. EXAMPLE POSITIONS (use these patterns):
   - Battery: x=150, y=400
   - SmartShunt: x=150, y=600 (250px below battery)
   - MPPT: x=500, y=400 (350px right of battery)
   - Solar Panel: x=500, y=150 (250px above MPPT)
   - DC Load: x=850, y=400 (350px right of MPPT)
4. First component starts at x≥100, y≥100
5. Use left-to-right flow: Battery → Controllers → Inverters → Loads
6. Place SmartShunt BELOW battery (same x, y+200 or more)

COMPONENT TERMINALS (EXACT NAMES - MUST USE THESE EXACTLY):
- multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative" (battery side), "system-minus" (system side), "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "ac-in"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"

CRITICAL WIRING RULES:
1. SmartShunt MUST be in negative path between battery and ALL loads:
   - Battery negative terminal → SmartShunt "negative" terminal
   - SmartShunt "system-minus" terminal → All load negative terminals
2. EVERY wire MUST have ALL these fields (no exceptions - NEVER use null, undefined, or "n/a"):
   - fromComponentId: exact component id (e.g., "battery-1")
   - toComponentId: exact component id (e.g., "mppt-1")
   - fromTerminal: exact terminal name from list above
   - toTerminal: exact terminal name from list above
   - polarity: "positive" or "negative" or "neutral" (never null/undefined)
   - gauge: MUST be EXACTLY one of: "10 AWG", "8 AWG", "6 AWG", "4 AWG", "2 AWG", "1 AWG" (NEVER "n/a", "TBD", null, or any other value)
   - length: number in feet (e.g., 5, 10, 15)
3. Wire gauge selection by current:
   - 0-25A: "10 AWG"
   - 25-40A: "8 AWG"
   - 40-60A: "6 AWG"
   - 60-100A: "4 AWG"
   - 100-150A: "2 AWG"
   - 150-200A: "1 AWG"

${feedbackContext || ''}

MANDATORY JSON RESPONSE FORMAT (follow exactly):
{
  "components": [
    {
      "id": "battery-1",
      "type": "battery",
      "name": "Main Battery Bank",
      "x": 150,
      "y": 400,
      "properties": {
        "voltage": 12,
        "capacity": 200
      }
    }
  ],
  "wires": [
    {
      "fromComponentId": "battery-1",
      "toComponentId": "smartshunt-1",
      "fromTerminal": "negative",
      "toTerminal": "negative",
      "polarity": "negative",
      "gauge": "10 AWG",
      "length": 3
    }
  ],
  "description": "Brief system description",
  "recommendations": ["tip 1", "tip 2"]
}

VALIDATION CHECKLIST (ensure all are true):
✓ Every component has: id, type, name, x, y, properties
✓ Every wire has ALL 7 fields: fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, gauge, length
✓ All terminal names match the exact names in COMPONENT TERMINALS list
✓ All components are 300px apart horizontally, 250px apart vertically
✓ SmartShunt is in negative path if present
✓ Wire gauges are appropriate for expected current`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.1-chat-latest",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: `Design a ${systemVoltage}V electrical system with the following requirements: ${userPrompt}` },
          ],
          response_format: { type: "json_object" },
        });

        return JSON.parse(completion.choices[0].message.content || "{}");
      };

      // Iterative improvement loop
      let lastVisualFeedback: string | undefined;
      let needsVisualImprovementIteration = false;

      while (currentIteration < maxIterations || needsVisualImprovementIteration) {
        currentIteration++;

        // Check if this is the visual improvement iteration
        const isDoingVisualImprovement = needsVisualImprovementIteration;
        if (needsVisualImprovementIteration) {
          needsVisualImprovementIteration = false;
        }

        // Send iteration start event
        sendEvent('iteration-start', {
          iteration: currentIteration,
          maxIterations,
          isVisualImprovement: isDoingVisualImprovement,
        });

        // Generate design (with feedback from previous iteration if available)
        let feedbackContext = '';

        if (validationHistory.length > 0) {
          const lastValidation = validationHistory[validationHistory.length - 1];
          const errors = lastValidation.topIssues.filter((i: any) => i.severity === 'error');
          const warnings = lastValidation.topIssues.filter((i: any) => i.severity === 'warning');

          feedbackContext = `\n\nPREVIOUS ITERATION RESULTS:
Score: ${lastValidation.score}/100 (Target: 70+)
Errors: ${lastValidation.errorCount}
Warnings: ${lastValidation.warningCount}

CRITICAL ERRORS TO FIX:
${errors.map((issue: any) => `❌ ${issue.message}\n   → ${issue.suggestion || 'Fix this issue'}`).join('\n')}

WARNINGS TO ADDRESS:
${warnings.map((issue: any) => `⚠️  ${issue.message}\n   → ${issue.suggestion || 'Improve this'}`).join('\n')}

MUST FIX ALL ERRORS BEFORE NEXT ITERATION!`;
        }

        // Add visual feedback from previous iteration if available
        if (lastVisualFeedback) {
          feedbackContext = (feedbackContext || '') + `\n\nVISUAL LAYOUT ANALYSIS FROM AI VISION:
${lastVisualFeedback}

APPLY THESE VISUAL IMPROVEMENTS IN THE NEXT DESIGN!`;
        }

        const design = await generateDesign(prompt, feedbackContext);

        // Validate the design
        const validation = validateDesign(design.components || [], design.wires || [], systemVoltage);

        // Get visual feedback if we have components
        let visualFeedback: string | undefined;
        if (design.components && design.components.length > 0) {
          try {
            const pngBuffer = renderSchematicToPNG(design.components, design.wires || []);
            visualFeedback = await getVisualFeedback(pngBuffer, openai);
            lastVisualFeedback = visualFeedback;
          } catch (error: any) {
            console.error(`⚠️  Visual review failed: ${error.message}`);
          }
        }

        // Store validation history
        const topIssues = validation.issues
          .filter((i: any) => i.severity === 'error' || i.severity === 'warning')
          .slice(0, 5);

        validationHistory.push({
          iteration: currentIteration,
          score: validation.score,
          valid: validation.valid,
          errorCount: validation.issues.filter((i: any) => i.severity === 'error').length,
          warningCount: validation.issues.filter((i: any) => i.severity === 'warning').length,
          topIssues,
          visualFeedback,
        });

        // Keep track of best design
        if (validation.score >= bestScore) {
          bestScore = validation.score;
          bestDesign = {
            ...design,
            validation,
            iteration: currentIteration,
            visualFeedback,
          };
        }

        // Send iteration complete event
        sendEvent('iteration-complete', {
          iteration: currentIteration,
          score: validation.score,
          errorCount: validation.issues.filter((i: any) => i.severity === 'error').length,
          warningCount: validation.issues.filter((i: any) => i.severity === 'warning').length,
          visualFeedback,
        });

        // If we just completed the visual improvement iteration, we're done
        if (isDoingVisualImprovement) {
          break;
        }

        // Check if design meets quality threshold
        const thresholdMet = validation.score >= minQualityScore &&
                             validation.issues.filter((i: any) => i.severity === 'error').length === 0;

        if (thresholdMet) {
          // If we have visual feedback, schedule one more iteration to apply visual improvements
          if (visualFeedback) {
            needsVisualImprovementIteration = true;
          } else {
            break;
          }
        }
      }

      // Send final complete event
      sendEvent('complete', {
        ...bestDesign,
        iterationHistory: validationHistory,
        finalIteration: currentIteration,
        achievedQualityThreshold: bestScore >= minQualityScore,
      });

      res.end();
    } catch (error: any) {
      console.error("Iterative AI generation error:", error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // AI-powered system generation with iterative quality improvement
  app.post("/api/ai-generate-system-iterative", async (req, res) => {
    try {
      const { prompt, systemVoltage = 12, minQualityScore = 70, maxIterations = 5 } = req.body;

      let currentIteration = 0;
      let bestDesign: any = null;
      let bestScore = 0;
      let validationHistory: any[] = [];

      // Helper function to generate design
      const generateDesign = async (userPrompt: string, feedbackContext?: string) => {
        const systemMessage = `You are an expert electrical system designer specializing in Victron Energy marine and RV electrical systems. Design complete, safe, code-compliant electrical systems.

CANVAS: 2000px wide × 1500px tall

COMPONENT DIMENSIONS & SPACING:
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

LAYOUT RULES (CRITICAL - PREVENT OVERLAP):
1. Minimum 300px horizontal spacing between component LEFT edges (x coordinates)
2. Minimum 250px vertical spacing between component TOP edges (y coordinates)
3. EXAMPLE POSITIONS (use these patterns):
   - Battery: x=150, y=400
   - SmartShunt: x=150, y=600 (250px below battery)
   - MPPT: x=500, y=400 (350px right of battery)
   - Solar Panel: x=500, y=150 (250px above MPPT)
   - DC Load: x=850, y=400 (350px right of MPPT)
4. First component starts at x≥100, y≥100
5. Use left-to-right flow: Battery → Controllers → Inverters → Loads
6. Place SmartShunt BELOW battery (same x, y+200 or more)

COMPONENT TERMINALS (EXACT NAMES - MUST USE THESE EXACTLY):
- multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative" (battery side), "system-minus" (system side), "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "ac-in"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"

CRITICAL WIRING RULES:
1. SmartShunt MUST be in negative path between battery and ALL loads:
   - Battery negative terminal → SmartShunt "negative" terminal
   - SmartShunt "system-minus" terminal → All load negative terminals
2. EVERY wire MUST have ALL these fields (no exceptions - NEVER use null, undefined, or "n/a"):
   - fromComponentId: exact component id (e.g., "battery-1")
   - toComponentId: exact component id (e.g., "mppt-1")
   - fromTerminal: exact terminal name from list above
   - toTerminal: exact terminal name from list above
   - polarity: "positive" or "negative" or "neutral" (never null/undefined)
   - gauge: MUST be EXACTLY one of: "10 AWG", "8 AWG", "6 AWG", "4 AWG", "2 AWG", "1 AWG" (NEVER "n/a", "TBD", null, or any other value)
   - length: number in feet (e.g., 5, 10, 15)
3. Wire gauge selection by current:
   - 0-25A: "10 AWG"
   - 25-40A: "8 AWG"
   - 40-60A: "6 AWG"
   - 60-100A: "4 AWG"
   - 100-150A: "2 AWG"
   - 150-200A: "1 AWG"

${feedbackContext || ''}

MANDATORY JSON RESPONSE FORMAT (follow exactly):
{
  "components": [
    {
      "id": "battery-1",
      "type": "battery",
      "name": "Main Battery Bank",
      "x": 150,
      "y": 400,
      "properties": {
        "voltage": 12,
        "capacity": 200
      }
    }
  ],
  "wires": [
    {
      "fromComponentId": "battery-1",
      "toComponentId": "smartshunt-1",
      "fromTerminal": "negative",
      "toTerminal": "negative",
      "polarity": "negative",
      "gauge": "10 AWG",
      "length": 3
    }
  ],
  "description": "Brief system description",
  "recommendations": ["tip 1", "tip 2"]
}

VALIDATION CHECKLIST (ensure all are true):
✓ Every component has: id, type, name, x, y, properties
✓ Every wire has ALL 7 fields: fromComponentId, toComponentId, fromTerminal, toTerminal, polarity, gauge, length
✓ All terminal names match the exact names in COMPONENT TERMINALS list
✓ All components are 300px apart horizontally, 250px apart vertically
✓ SmartShunt is in negative path if present
✓ Wire gauges are appropriate for expected current`;

        const completion = await openai.chat.completions.create({
          model: "gpt-5.1-chat-latest",
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: `Design a ${systemVoltage}V electrical system with the following requirements: ${userPrompt}` },
          ],
          response_format: { type: "json_object" },
        });

        return JSON.parse(completion.choices[0].message.content || "{}");
      };

      // Iterative improvement loop
      let lastVisualFeedback: string | undefined;
      let needsVisualImprovementIteration = false;

      while (currentIteration < maxIterations || needsVisualImprovementIteration) {
        currentIteration++;

        // Check if this is the visual improvement iteration
        const isDoingVisualImprovement = needsVisualImprovementIteration;
        if (needsVisualImprovementIteration) {
          needsVisualImprovementIteration = false; // Reset so we only do one bonus iteration
          console.log(`\n🎨 Iteration ${currentIteration} (VISUAL IMPROVEMENT): Applying AI vision feedback...`);
        } else {
          console.log(`\n🔄 Iteration ${currentIteration}/${maxIterations}`);
        }

        // Generate design (with feedback from previous iteration if available)
        let feedbackContext = '';

        if (validationHistory.length > 0) {
          const lastValidation = validationHistory[validationHistory.length - 1];
          const errors = lastValidation.topIssues.filter((i: any) => i.severity === 'error');
          const warnings = lastValidation.topIssues.filter((i: any) => i.severity === 'warning');

          feedbackContext = `\n\nPREVIOUS ITERATION RESULTS:
Score: ${lastValidation.score}/100 (Target: 70+)
Errors: ${lastValidation.errorCount}
Warnings: ${lastValidation.warningCount}

CRITICAL ERRORS TO FIX:
${errors.map((issue: any) => `❌ ${issue.message}\n   → ${issue.suggestion || 'Fix this issue'}`).join('\n')}

WARNINGS TO ADDRESS:
${warnings.map((issue: any) => `⚠️  ${issue.message}\n   → ${issue.suggestion || 'Improve this'}`).join('\n')}

MUST FIX ALL ERRORS BEFORE NEXT ITERATION!`;
        }

        // Add visual feedback from previous iteration if available
        if (lastVisualFeedback) {
          feedbackContext = (feedbackContext || '') + `\n\nVISUAL LAYOUT ANALYSIS FROM AI VISION:
${lastVisualFeedback}

APPLY THESE VISUAL IMPROVEMENTS IN THE NEXT DESIGN!`;
        }

        const design = await generateDesign(prompt, feedbackContext);

        // Debug: log what AI generated
        console.log(`  AI generated: ${design.components?.length || 0} components, ${design.wires?.length || 0} wires`);
        if (design.components?.length === 0 || !design.components) {
          console.log(`  ⚠️  AI Response:`, JSON.stringify(design).substring(0, 200));
        }

        // Validate the design
        const validation = validateDesign(design.components || [], design.wires || [], systemVoltage);

        console.log(`📊 Quality Score: ${validation.score}/100`);
        console.log(`❌ Errors: ${validation.issues.filter((i: any) => i.severity === 'error').length}`);
        console.log(`⚠️  Warnings: ${validation.issues.filter((i: any) => i.severity === 'warning').length}`);

        // Store validation history
        const topIssues = validation.issues
          .filter((i: any) => i.severity === 'error' || i.severity === 'warning')
          .slice(0, 5);

        // Get visual feedback if we have components (always generate, even on last iteration)
        let visualFeedback: string | undefined;
        if (design.components && design.components.length > 0) {
          try {
            console.log(`  📸 Generating visual preview for iteration ${currentIteration}...`);
            const pngBuffer = renderSchematicToPNG(design.components, design.wires || []);

            console.log(`  👁️  Getting visual feedback from AI...`);
            visualFeedback = await getVisualFeedback(pngBuffer, openai);
            lastVisualFeedback = visualFeedback;
            console.log(`  💬 Visual feedback: ${visualFeedback.substring(0, 100)}...`);
          } catch (error: any) {
            console.error(`  ⚠️  Visual review failed: ${error.message}`);
          }
        }

        validationHistory.push({
          iteration: currentIteration,
          score: validation.score,
          valid: validation.valid,
          errorCount: validation.issues.filter((i: any) => i.severity === 'error').length,
          warningCount: validation.issues.filter((i: any) => i.severity === 'warning').length,
          topIssues,
          visualFeedback,
        });

        // Keep track of best design (use >= to capture first design even if score is 0)
        if (validation.score >= bestScore) {
          bestScore = validation.score;
          bestDesign = {
            ...design,
            validation,
            iteration: currentIteration,
            visualFeedback,
          };
        }

        // If we just completed the visual improvement iteration, we're done
        if (isDoingVisualImprovement) {
          console.log(`✅ Visual improvement iteration complete`);
          break;
        }

        // Check if design meets quality threshold
        const thresholdMet = validation.score >= minQualityScore && validation.issues.filter((i: any) => i.severity === 'error').length === 0;

        if (thresholdMet) {
          console.log(`✅ Design meets quality threshold (${validation.score} >= ${minQualityScore})`);

          // If we have visual feedback, schedule one more iteration to apply visual improvements
          if (visualFeedback) {
            console.log(`🎨 Quality threshold met - scheduling final visual improvement iteration...`);
            needsVisualImprovementIteration = true;
            // Continue to next iteration to apply visual improvements
          } else {
            // No visual feedback, exit
            break;
          }
        }

        // If not last iteration, continue improving
        if (currentIteration < maxIterations) {
          console.log(`🔧 Improving design...`);
        }
      }

      // Return best design with iteration history
      res.json({
        ...bestDesign,
        iterationHistory: validationHistory,
        finalIteration: currentIteration,
        achievedQualityThreshold: bestScore >= minQualityScore,
      });

    } catch (error: any) {
      console.error("Iterative AI generation error:", error);
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
- multiplus: "ac-in", "ac-out", "dc-positive", "dc-negative"
- mppt: "pv-positive", "pv-negative", "batt-positive", "batt-negative"
- cerbo: "data-1", "data-2", "data-3", "power"
- bmv: "data"
- smartshunt: "negative" (battery side), "system-minus" (system side), "data"
- battery: "positive", "negative"
- solar-panel: "positive", "negative"
- ac-load: "ac-in"
- dc-load: "positive", "negative"
- busbar-positive: "pos-1", "pos-2", "pos-3", "pos-4", "pos-5", "pos-6"
- busbar-negative: "neg-1", "neg-2", "neg-3", "neg-4", "neg-5", "neg-6"

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
1. SmartShunt MUST be in negative path between battery and ALL loads
   - Battery negative → SmartShunt "negative" terminal
   - SmartShunt "system-minus" → All loads' negative terminals
   - This ensures ALL current flows through the shunt for accurate monitoring
2. Use SEPARATE bus bars for DC and AC circuits when both are present:
   - DC Bus Bars (12V/24V): Connect DC loads (dc-load) to dedicated DC positive/negative busbars
   - AC Bus Bars (120V/230V): Connect AC loads (ac-load) to dedicated AC positive/negative busbars OR directly to inverter AC outputs
   - Name busbars clearly: "DC Positive Bus", "DC Negative Bus", "AC Positive Bus", "AC Negative Bus"
   - Never connect DC and AC loads to the same bus bar
3. Use bus bars when connecting 3+ devices of the same type to simplify wiring
4. Main battery cables (battery to inverter): Use largest gauge
5. Never mix polarities on same bus bar
5. Solar panels connect to MPPT PV terminals, MPPT battery terminals connect to battery
6. Inverters connect to battery or main bus bars
7. AC loads connect to inverter AC output
8. DC loads connect to battery/bus bars after SmartShunt on negative side
9. Data connections: BMV/SmartShunt to Cerbo via data terminals

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

      const response = JSON.parse(completion.choices[0].message.content || "{}");
      
      console.log("AI Wire Generation Response:", JSON.stringify(response, null, 2));
      console.log("Generated wires count:", response.wires?.length || 0);
      
      res.json(response);
    } catch (error: any) {
      console.error("AI wire generation error:", error);
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
