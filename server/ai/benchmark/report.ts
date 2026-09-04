import { getSuite, SUITES } from "./cases";
import { renderSchematicPng } from "../schematic-image";
import { validateDesign } from "../../design-validator";
import { judgeDesign, availableJudges, type JudgePanelResult } from "./judge";

/**
 * Self-contained HTML review of the stored exemplars.
 *
 * The scores in the DB say a design passed; they do not show what it looks
 * like, and layout quality is the thing a number is worst at conveying. This
 * embeds each rendered schematic next to its validator issues and the judges'
 * written notes so a human can review the reference set in one file, offline,
 * with no server running.
 */

export interface ExemplarReportRow {
  caseId: string;
  suiteId: string;
  model: string;
  prompt: string;
  systemVoltage: number;
  componentCount: number;
  wireCount: number;
  validatorScore: number;
  errors: string[];
  warnings: string[];
  dataUrl: string;
  panel: JudgePanelResult | null;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function collectExemplarReport(opts: { judges?: string[]; judge?: boolean } = {}) {
  // Imported here, not at module scope: storage pulls in the DB client, and the
  // HTML rendering below is worth unit-testing without a DATABASE_URL.
  const { benchmarkStorage } = await import("./storage");
  const rows = await benchmarkStorage.listExemplars();
  const judges = opts.judge ? opts.judges?.length ? opts.judges : availableJudges() : [];
  const out: ExemplarReportRow[] = [];

  for (const row of rows) {
    const design = row.design as any;
    const suite = SUITES[row.suiteId] ?? getSuite(row.suiteId);
    const testCase = suite.cases.find(c => c.id === row.caseId);
    const systemVoltage = testCase?.systemVoltage ?? 12;

    const validation = validateDesign(design.components, design.wires, systemVoltage);
    const image = renderSchematicPng(design.components, design.wires, { maxDimension: 1400 });

    let panel: JudgePanelResult | null = null;
    if (judges.length && testCase) {
      try {
        panel = await judgeDesign({
          design,
          prompt: testCase.prompt,
          systemVoltage,
          judges,
        });
      } catch (err: any) {
        console.warn(`[report] judging ${row.caseId} failed: ${err?.message}`);
      }
    }

    out.push({
      caseId: row.caseId,
      suiteId: row.suiteId,
      model: row.model,
      prompt: testCase?.prompt ?? "(case no longer in the suite)",
      systemVoltage,
      componentCount: design.components.length,
      wireCount: design.wires.length,
      validatorScore: validation.score,
      errors: validation.issues.filter((i: any) => i.severity === "error").map((i: any) => i.message),
      warnings: validation.issues.filter((i: any) => i.severity === "warning").map((i: any) => i.message),
      dataUrl: image.dataUrl,
      panel,
    });
  }

  return out.sort((a, b) => a.caseId.localeCompare(b.caseId));
}

export function renderExemplarReportHtml(rows: ExemplarReportRow[]): string {
  const generated = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const judgeNames = Array.from(
    new Set(rows.flatMap(r => r.panel?.verdicts.map(v => v.model) ?? []))
  );

  const summary = `
    <table class="summary">
      <thead><tr>
        <th>Case</th><th>Suite</th><th>Winning model</th><th>Validator</th>
        <th>Judge median</th><th>Parts</th><th>Wires</th><th>Errors</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            r => `<tr>
          <td><a href="#${esc(r.caseId)}">${esc(r.caseId)}</a></td>
          <td>${esc(r.suiteId)}</td>
          <td class="mono">${esc(r.model)}</td>
          <td class="${r.validatorScore >= 90 ? "good" : r.validatorScore >= 70 ? "ok" : "bad"}">${r.validatorScore}</td>
          <td>${r.panel?.score ?? "-"}${r.panel?.lowConfidence ? ' <span class="flag">low-conf</span>' : ""}</td>
          <td>${r.componentCount}</td><td>${r.wireCount}</td>
          <td class="${r.errors.length ? "bad" : "good"}">${r.errors.length}</td>
        </tr>`
          )
          .join("\n")}
      </tbody>
    </table>`;

  const sections = rows
    .map(r => {
      const verdicts = r.panel?.verdicts ?? [];
      const judgeBlocks = verdicts.length
        ? verdicts
            .map(
              v => `<div class="judge">
              <div class="judge-head"><span class="mono">${esc(v.model)}</span>
                ${v.ok ? `<b>${v.overall}</b>/100` : `<span class="bad">failed: ${esc(v.error)}</span>`}</div>
              ${
                v.ok
                  ? `<div class="dims">layout ${v.dimensions.layout ?? "-"} &middot; routing ${v.dimensions.routing ?? "-"} &middot; correctness ${v.dimensions.correctness ?? "-"} &middot; completeness ${v.dimensions.completeness ?? "-"}</div>
                     <p>${esc(v.notes)}</p>`
                  : ""
              }
            </div>`
            )
            .join("\n")
        : "<p class='muted'>Not judged.</p>";

      const issues = (label: string, list: string[], cls: string) =>
        list.length
          ? `<div class="issues"><h4 class="${cls}">${label} (${list.length})</h4><ul>${list
              .map(m => `<li>${esc(m)}</li>`)
              .join("")}</ul></div>`
          : "";

      return `
      <section id="${esc(r.caseId)}">
        <h2>${esc(r.caseId)} <span class="muted">${esc(r.suiteId)} &middot; ${r.systemVoltage}V</span></h2>
        <blockquote>${esc(r.prompt)}</blockquote>
        <div class="meta">
          Generated by <span class="mono">${esc(r.model)}</span> &middot;
          validator <b class="${r.validatorScore >= 90 ? "good" : "bad"}">${r.validatorScore}/100</b> &middot;
          judge median <b>${r.panel?.score ?? "-"}</b>
          ${r.panel?.stdDev != null ? `(spread ${r.panel.stdDev.toFixed(1)})` : ""}
          ${r.panel?.lowConfidence ? '<span class="flag">low confidence</span>' : ""}
        </div>
        <img src="${r.dataUrl}" alt="${esc(r.caseId)} schematic">
        ${issues("Validator errors", r.errors, "bad")}
        ${issues("Validator warnings", r.warnings, "ok")}
        <h3>Judge feedback</h3>
        ${judgeBlocks}
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>VictronDesigner AI reference designs</title>
<style>
  body { font: 15px/1.55 -apple-system, Segoe UI, Roboto, sans-serif; margin: 0 auto; max-width: 1100px; padding: 32px 24px 80px; color: #0f172a; }
  h1 { margin-bottom: 4px; }
  .muted { color: #64748b; font-weight: normal; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  table.summary { border-collapse: collapse; width: 100%; margin: 20px 0 40px; }
  table.summary th, table.summary td { border-bottom: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; }
  table.summary th { background: #f8fafc; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
  .good { color: #15803d; font-weight: 600; }
  .ok   { color: #a16207; font-weight: 600; }
  .bad  { color: #b91c1c; font-weight: 600; }
  .flag { background: #fef3c7; color: #92400e; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  section { border-top: 3px solid #e2e8f0; padding-top: 24px; margin-top: 48px; }
  blockquote { margin: 0 0 12px; padding: 10px 14px; background: #f8fafc; border-left: 3px solid #cbd5e1; color: #334155; }
  .meta { margin-bottom: 14px; font-size: 14px; }
  img { width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
  .judge { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
  .judge-head { display: flex; gap: 10px; align-items: baseline; }
  .dims { color: #64748b; font-size: 13px; margin-top: 2px; }
  .judge p { margin: 8px 0 0; }
  .issues ul { margin: 6px 0 0; padding-left: 20px; }
  .issues h4 { margin: 16px 0 0; }
  a { color: #1d4ed8; }
</style></head>
<body>
  <h1>AI reference designs</h1>
  <p class="muted">Benchmark exemplars &middot; generated ${esc(generated)}${
    judgeNames.length ? ` &middot; judged by ${esc(judgeNames.join(", "))}` : ""
  }</p>
  <p>Each case below is the best design produced across several frontier models, kept as the
  calibration anchor future benchmark runs are graded against. The validator score is
  machine-checked (ABYC/NEC wire sizing, terminals, fusing); the judge score is a panel of
  vision models grading the rendered drawing on layout and routing, where a median hides less
  than an average would.</p>
  ${summary}
  ${sections}
</body></html>`;
}
