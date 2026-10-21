import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import type { Express } from 'express';
import type { SchematicComponent, Wire, Schematic } from '@shared/schema';
import { analyzeElectricalDesign } from '@shared/electrical-analysis';
import { buildDesignReview } from '@shared/design-review';
import { validateDesign } from './design-validator';
import { generateShoppingList } from './export-utils';
import { getComponentDimensions, getComponentTerminals, getTerminalPosition } from '../client/src/lib/terminal-config';

const componentSchema = z.object({ id: z.string().min(1).max(200), type: z.string().max(100), name: z.string().max(500), x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), properties: z.record(z.any()) });
const wireSchema = z.object({ id: z.string().min(1).max(200), fromComponentId: z.string(), toComponentId: z.string(), fromTerminal: z.string(), toTerminal: z.string(), polarity: z.enum(['positive','negative','hot','neutral','ground']), length: z.number().finite().nonnegative(), gauge: z.string().optional(), current: z.number().optional(), waypoints: z.array(z.object({x:z.number().finite(),y:z.number().finite()})).max(100).optional() }).passthrough();
export const installationPackageSchema = z.object({ name: z.string().max(500).default('Design'), components: z.array(componentSchema).max(500), wires: z.array(wireSchema).max(1500), systemVoltage: z.number().positive().max(1000).default(12), paperSize: z.enum(['A4','Letter']).default('Letter'), orientation: z.enum(['portrait','landscape']).default('landscape'), diagramMode: z.enum(['fit','tiled']).default('fit'), lengthUnit: z.enum(['ft','m']).default('ft'), wireGaugeFormat: z.enum(['awg','metric']).default('awg'), draft: z.boolean().default(false), revision: z.string().max(100).optional(), requirementIssues: z.array(z.string().max(2000)).max(100).default([]) });
export type InstallationPackageInput = z.input<typeof installationPackageSchema>;
export class InstallationPackageError extends Error { constructor(message: string, public status = 400, public issues?: unknown) { super(message); } }
const reference = (kind: string, id: string) => `${kind}-${createHash('sha256').update(id).digest('hex').slice(0,12).toUpperCase()}`;
const colors: Record<string,string> = {positive:'#c02626',negative:'#202020',hot:'#a75b16',neutral:'#64748b',ground:'#15803d'};
const fonts = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/fonts');
// The server is bundled into dist/index.js; font assets are versioned outside the bundle.
const fontRoot = path.basename(path.dirname(fileURLToPath(import.meta.url))) === 'dist' ? path.join(process.cwd(),'server/assets/fonts') : fonts;

export function buildInstallationViewModel(raw: InstallationPackageInput) {
  const input = installationPackageSchema.parse(raw);
  const ids = new Set<string>();
  for (const item of [...input.components,...input.wires]) { if(ids.has(item.id)) throw new InstallationPackageError(`Duplicate object ID: ${item.id}`); ids.add(item.id); }
  const references = new Set<string>();
  for (const [kind,items] of [['C',input.components],['W',input.wires]] as const) for(const item of items){const ref=reference(kind,item.id);if(references.has(ref)) throw new InstallationPackageError('Reference collision: rename the duplicated object ID.');references.add(ref);}
  const components = structuredClone(input.components) as SchematicComponent[];
  const wires = structuredClone(input.wires) as Wire[];
  const analysis = analyzeElectricalDesign({components,wires,systemVoltage:input.systemVoltage});
  const validation = buildDesignReview({ components, wires, systemVoltage: input.systemVoltage }, validateDesign(components, wires, input.systemVoltage));
  const byId = new Map(components.map(c=>[c.id,c]));
  const issues = [...validation.issues.map(i=>`${i.severity.toUpperCase()}: ${i.message}${i.suggestion ? ` Suggested action: ${i.suggestion}` : ''}`), ...input.requirementIssues.map(i=>`REQUIREMENT: ${i}`)];
  const unresolved = Object.values(analysis.wires).filter(w=>w.status !== 'known');
  for (const w of unresolved) issues.push(`UNRESOLVED ${reference('W',w.wireId)}: ${w.reason || 'Electrical current could not be resolved.'}`);
  const analysisProblems = Object.values(analysis.wires).filter(w => w.issues.length > 0 || w.calculation?.status === 'error');
  for (const w of analysisProblems) {
    const details = [...w.issues];
    if (w.calculation?.status === 'error' && !details.includes(w.calculation.message || 'Conductor sizing failed.')) details.push(w.calculation.message || 'Conductor sizing failed.');
    for (const detail of details) issues.push(`ELECTRICAL ${reference('W', w.wireId)}: ${detail}`);
  }
  for (const w of wires.filter(w => w.length <= 0)) issues.push(`UNRESOLVED ${reference('W', w.id)}: Set a positive physical wire length before installation.`);
  const draft = !validation.valid || unresolved.length > 0 || analysisProblems.length > 0 || wires.some(w => w.length <= 0) || input.requirementIssues.length > 0;
  const routes = wires.map(w=>{
    const from = byId.get(w.fromComponentId), to = byId.get(w.toComponentId);
    const fromTerminalExists = from && getComponentTerminals(from.type, from.properties).some(t => t.id === w.fromTerminal);
    const toTerminalExists = to && getComponentTerminals(to.type, to.properties).some(t => t.id === w.toTerminal);
    const start = from && fromTerminalExists && getTerminalPosition(from.x,from.y,from.type,w.fromTerminal,from.properties);
    const end = to && toTerminalExists && getTerminalPosition(to.x,to.y,to.type,w.toTerminal,to.properties);
    if(!start || !end) { issues.push(`ERROR ${reference('W',w.id)}: Missing component or terminal; connection cannot be drawn.`); return {wire:w, points:[]}; }
    const points = w.waypoints?.length ? [start,...w.waypoints.map(p=>({x:from!.x+p.x,y:from!.y+p.y})),end] : [start,{x:(start.x+end.x)/2,y:start.y},{x:(start.x+end.x)/2,y:end.y},end];
    return {wire:w,points};
  });
  const boundsPoints = components.flatMap(c=>{ const d=getComponentDimensions(c.type,c.properties); if(!Number.isFinite(d.width)||!Number.isFinite(d.height)||d.width<=0||d.height<=0||d.width>5000||d.height>5000) throw new InstallationPackageError(`Invalid component dimensions: ${c.name}`); return [{x:c.x,y:c.y},{x:c.x+d.width,y:c.y+d.height+32},...getComponentTerminals(c.type,c.properties).map(t=>({x:c.x+t.x,y:c.y+t.y}))]; }).concat(routes.flatMap(r=>r.points));
  const bounds = { minX:(boundsPoints.length?Math.min(...boundsPoints.map(p=>p.x)):0)-30,minY:(boundsPoints.length?Math.min(...boundsPoints.map(p=>p.y)):0)-30,maxX:Math.max(300,...boundsPoints.map(p=>p.x))+30,maxY:Math.max(200,...boundsPoints.map(p=>p.y))+30 };
  return {input,components,wires,analysis,validation,issues,routes,bounds,draft:draft||routes.some(r=>!r.points.length),reference};
}

export async function generateInstallationPackage(raw: InstallationPackageInput): Promise<Buffer> {
  const vm = buildInstallationViewModel(raw);
  if(vm.draft && !vm.input.draft) throw new InstallationPackageError('This design has errors or unresolved checks. Review the issues or export a marked draft package.',409,vm.issues);
  const doc = new PDFDocument({size:vm.input.paperSize === 'Letter' ? 'LETTER':'A4',layout:vm.input.orientation,margin:36,bufferPages:true,info:{Title:`${vm.input.name} installation package`,Author:'VictronDesigner',Subject:'Planning schematic and installation schedules'}});
  doc.registerFont('regular',path.join(fontRoot,'DejaVuSans.ttf')).registerFont('bold',path.join(fontRoot,'DejaVuSans-Bold.ttf')).font('regular');
  const chunks:Buffer[]=[];
  const finished=new Promise<Buffer>((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const width=()=>doc.page.width-72, bottom=()=>doc.page.height-55;
  const title=(text:string)=>{doc.font('bold').fontSize(18).fillColor('#006bb6').text(text,36,36,{width:width()});doc.font('regular').fontSize(10).fillColor('#202020');doc.y=70;};
  const page=(text:string)=>{doc.addPage();title(text);};
  const line=(text:string)=>{doc.font('regular').fontSize(10);const h=doc.heightOfString(text,{width:width()});if(doc.y+h>bottom()) doc.addPage();doc.text(text,36,doc.y,{width:width()});doc.moveDown(.5);};
  const table=(heading:string,headers:string[],rows:string[][],ratios:number[])=>{
    page(heading);const colWidths=ratios.map(r=>width()*r);const header=()=>{let x=36;const y=doc.y;doc.font('bold').fontSize(9);headers.forEach((h,i)=>{doc.text(h,x,y,{width:colWidths[i]-8,height:28,lineBreak:false});x+=colWidths[i];});doc.y=y+32;doc.font('regular');};header();
    for(const row of rows){doc.fontSize(9);const h=Math.max(20,...row.map((cell,i)=>doc.heightOfString(cell,{width:colWidths[i]-8})))+10;if(h>bottom()-105)throw new InstallationPackageError('A schedule entry is too long to fit on a page. Shorten component names or terminal descriptions.');if(doc.y+h>bottom()){doc.addPage();title(`${heading} (continued)`);header();}const y=doc.y;let x=36;row.forEach((cell,i)=>{doc.text(cell,x,y,{width:colWidths[i]-8});x+=colWidths[i];});doc.strokeColor('#dddddd').lineWidth(.5).moveTo(36,y+h-4).lineTo(doc.page.width-36,y+h-4).stroke();doc.y=y+h;}
  };
  title(`${vm.input.draft || vm.draft ? 'DRAFT — ' : ''}Installation package`);
  line(vm.input.name);line(`Exported ${new Date().toISOString()} • ${vm.input.systemVoltage} V DC system`);line(`Revision: ${vm.input.revision || 'Unsaved snapshot'} • Snapshot: ${vm.analysis.fingerprint}`);line(`Calculation engine: ${vm.analysis.engineVersion}`);line(`${vm.components.length} components • ${vm.wires.length} wires • ${vm.issues.length} review issues`);
  line('Planning document. Verify component ratings, protection, wire lengths and manufacturer installation instructions before installation. Electrical checks cover supported configurations and do not establish professional design approval.');
  line('References are derived from persistent object IDs and stay unchanged when equipment is reordered or new wires are added. Schematic symbols are terminal blocks; the connection schedules identify every endpoint.');
  line('Contents: schematic; component schedule; terminal and wire schedule; shopping list; two-end wire label sheets; calculation assumptions and review issues. Labels are general cut-out sheets, not calibrated commercial label stock.');
  const b=vm.bounds,bw=b.maxX-b.minX,bh=b.maxY-b.minY;
  const availW=width(),availH=doc.page.height-135;
  const scale=vm.input.diagramMode==='tiled' ? .75 : Math.min(availW/bw,availH/bh,1);
  const cols=Math.ceil(bw*scale/availW),rows=Math.ceil(bh*scale/availH);
  if(cols*rows>100)throw new InstallationPackageError('Diagram requires more than 100 tiles. Choose fit-to-page or reduce diagram spacing.');
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    page(`Schematic${cols*rows>1?` — tile ${row+1},${col+1} of ${rows} × ${cols}`:''}`);
    doc.save().rect(36,78,availW,availH).clip().translate(36-col*availW,78-row*availH).scale(scale).translate(-b.minX,-b.minY);
    for(const route of vm.routes){if(!route.points.length)continue;doc.strokeColor(colors[route.wire.polarity]).lineWidth(2);route.points.forEach((p,i)=>{if(i===0)doc.moveTo(p.x,p.y);else doc.lineTo(p.x,p.y);});doc.stroke();const p=route.points[Math.floor(route.points.length/2)];doc.fontSize(8).fillColor('#202020').text(reference('W',route.wire.id),p.x+3,p.y+3,{lineBreak:false});}
    for(const c of vm.components){const d=getComponentDimensions(c.type,c.properties);doc.fillColor('#eef6fd').strokeColor('#006bb6').lineWidth(1).rect(c.x,c.y,d.width,d.height).fillAndStroke();doc.fillColor('#202020').fontSize(10).text(`${reference('C',c.id)}\n${c.name}\n${c.type}`,c.x+8,c.y+10,{width:d.width-16,height:d.height-12});for(const t of getComponentTerminals(c.type,c.properties)){doc.fillColor(colors[t.type]||'#64748b').circle(c.x+t.x,c.y+t.y,3).fill();}}
    doc.restore();doc.fillColor('#202020').fontSize(8).text(`Vector terminal schematic • ${scale.toFixed(3)} print scale • wire lengths are schedule values`,36,doc.page.height-51,{lineBreak:false});
  }
  const refs=new Map(vm.components.map(c=>[c.id,reference('C',c.id)]));
  table('Component schedule',['Reference','Equipment','Electrical properties'],vm.components.map(c=>[reference('C',c.id),`${c.name}\n${c.type}`,Object.entries(c.properties).filter(([k,v])=>['string','number','boolean'].includes(typeof v)&&!['image','svg','imageUrl'].includes(k)).map(([k,v])=>`${k}: ${v}`).join('\n')||'Not specified']),[.24,.32,.44]);
  const length=(feet:number)=>`${(vm.input.lengthUnit==='m'?feet/3.28084:feet).toFixed(2)} ${vm.input.lengthUnit}`;
  const gauge=(wire:Wire)=>{if(!wire.gauge)return 'Unresolved';if(vm.input.wireGaugeFormat==='awg')return wire.gauge;const mm:Record<string,number>={'18':.823,'16':1.31,'14':2.08,'12':3.31,'10':5.26,'8':8.37,'6':13.3,'4':21.2,'2':33.6,'1':42.4,'1/0':53.5,'2/0':67.4,'3/0':85,'4/0':107};const area=mm[wire.gauge.replace(/\s*AWG/i,'').trim()];return area?`${area} mm²`:wire.gauge;};
  table('Terminal and wire schedule',['Wire','From → To','Conductor','Analysis'],vm.wires.map(w=>{const a=vm.analysis.wires[w.id];return [reference('W',w.id),`${refs.get(w.fromComponentId)||'MISSING'} / ${w.fromTerminal}\n→ ${refs.get(w.toComponentId)||'MISSING'} / ${w.toTerminal}`,`${w.polarity}\n${gauge(w)} • ${length(w.length)}\n${w.conductorMaterial||'copper'}`,a?.status==='known'?`${a.currentA?.toFixed(2) ?? 'Unresolved'} A @ ${a.voltageV ?? 'Unresolved'} V\n${a.selectedGaugeVoltageDropPercent === undefined ? 'Drop unresolved':`${a.selectedGaugeVoltageDropPercent.toFixed(2)}% drop`}`:`Unresolved: ${a?.reason||'Not calculated'}`];}),[.23,.32,.22,.23]);
  const shopping=generateShoppingList({components:vm.components,wires:vm.wires,systemVoltage:vm.input.systemVoltage,name:vm.input.name} as Schematic,vm.input.wireGaugeFormat,vm.input.lengthUnit);
  table('Shopping list',['Category','Item','Quantity','Notes'],shopping.map(i=>[i.category,i.item,String(i.quantity),i.description]),[.2,.3,.1,.4]);
  page('Wire labels — cut out, apply at both ends');
  let labelIndex=0;const labelW=width()/2,labelH=72;
  for(const w of vm.wires)for(const end of ['FROM','TO']){const perPage=Math.floor((bottom()-90)/labelH)*2;if(labelIndex>=perPage){page('Wire labels (continued)');labelIndex=0;}const x=36+(labelIndex%2)*labelW,y=90+Math.floor(labelIndex/2)*labelH;doc.strokeColor('#aaaaaa').rect(x,y,labelW-8,labelH-8).stroke();doc.fontSize(9).fillColor('#202020').text(`${reference('W',w.id)} — ${end}\n${refs.get(w.fromComponentId)||'MISSING'} / ${w.fromTerminal}\n→ ${refs.get(w.toComponentId)||'MISSING'} / ${w.toTerminal}\n${gauge(w)} • ${w.polarity}`,x+6,y+5,{width:labelW-20,height:labelH-14});labelIndex++;}
  page('Calculation assumptions and review issues');
  for(const assumption of vm.analysis.assumptions)line(assumption);
  line('Wire lengths are one-way physical lengths stored in feet; exported length units only affect display. User-selected gauges are preserved. Missing analysis values remain unresolved. Ground conductors are not sized from normal operating current alone.');
  if(!vm.issues.length)line('No errors found in supported checks.');else for(const issue of vm.issues)line(issue);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footers deliberately occupy the margin. PDFKit otherwise creates a new
    // page for every footer below its normal text boundary.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#666666').text(`${vm.input.draft || vm.draft ? 'DRAFT • ' : ''}${vm.input.name.slice(0, 55)} • Page ${i + 1} / ${range.count}`, 36, doc.page.height - 30, { width: width(), lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();return finished;
}

export function registerInstallationPackageRoute(app: Express) {
  app.post('/api/export/installation-package',async(req,res)=>{
    try { const input=installationPackageSchema.parse(req.body);const pdf=await generateInstallationPackage(input);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="installation-package.pdf"');res.send(pdf); }
    catch(error){if(error instanceof z.ZodError){res.status(400).json({error:'Invalid export document',details:error.flatten()});return;}if(error instanceof InstallationPackageError){res.status(error.status).json({error:error.message,issues:error.issues});return;}console.error('Installation package export failed',error);res.status(500).json({error:'Unable to generate the installation package. Check document details and retry.'});}
  });
}
