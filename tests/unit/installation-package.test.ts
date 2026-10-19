// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildInstallationViewModel, generateInstallationPackage, installationPackageSchema } from '../../server/installation-package';
import type { InstallationPackageInput } from '../../server/installation-package';

const design:InstallationPackageInput = {name:'Boat system',systemVoltage:24,components:[
  {id:'battery-a',type:'battery',name:'Battery',x:100,y:300,properties:{voltage:24,capacity:200}},
  {id:'load-a',type:'dc-load',name:'Lights',x:450,y:300,properties:{voltage:24,watts:120}},
],wires:[{id:'wire-a',fromComponentId:'battery-a',toComponentId:'load-a',fromTerminal:'positive',toTerminal:'positive',polarity:'positive',gauge:'10 AWG',length:6}],draft:true};
describe('installation package',()=>{
  it('keeps connection references stable across order changes and new equipment',()=>{
    const original=buildInstallationViewModel(design);
    const reordered=buildInstallationViewModel({...design,components:[...design.components].reverse()});
    expect(original.reference('W','wire-a')).toBe(reordered.reference('W','wire-a'));
    expect(original.reference('C','battery-a')).toBe(reordered.reference('C','battery-a'));
    expect(design.wires[0].gauge).toBe('10 AWG');
  });
  it('includes manual route extents beyond equipment and preserves unresolved checks',()=>{
    const vm=buildInstallationViewModel({...design,wires:[{...design.wires[0],waypoints:[{x:1800,y:-800}]}]});
    expect(vm.bounds.maxX).toBeGreaterThanOrEqual(1900);
    expect(vm.bounds.minY).toBeLessThanOrEqual(-500);
    expect(vm.issues.length).toBeGreaterThan(0);
  });
  it('rejects duplicate IDs and malformed documents without rewriting them',()=>{
    expect(()=>buildInstallationViewModel({...design,components:[design.components[0],design.components[0]]})).toThrow('Duplicate');
    expect(installationPackageSchema.safeParse({...design,systemVoltage:-24}).success).toBe(false);
  });
  it('requires draft consent for unresolved or invalid systems',async()=>{
    await expect(generateInstallationPackage({...design,draft:false,wires:[{...design.wires[0],toTerminal:'missing'}]})).rejects.toMatchObject({status:409});
  });
  it('reports shared sizing issues and requires a draft for known but undersized wires',()=>{
    const vm=buildInstallationViewModel({...design,wires:[{...design.wires[0],gauge:'18 AWG',length:500}]});
    expect(vm.analysis.wires['wire-a'].status).toBe('known');
    expect(vm.draft).toBe(true);
    expect(vm.issues.some(i=>i.startsWith('ELECTRICAL ') && i.includes('voltage drop'))).toBe(true);
  });
  it('does not draw missing terminal IDs and makes zero physical lengths unresolved',()=>{
    const missing=buildInstallationViewModel({...design,wires:[{...design.wires[0],toTerminal:'unknown'}]});
    expect(missing.routes[0].points).toEqual([]);
    expect(missing.draft).toBe(true);
    const zero=buildInstallationViewModel({...design,wires:[{...design.wires[0],length:0}]});
    expect(zero.draft).toBe(true);
    expect(zero.issues.some(i=>i.includes('positive physical wire length'))).toBe(true);
  });
  it.each(['A4','Letter'] as const)('creates a self-contained multipage vector PDF for %s',async paperSize=>{
    const bytes=await generateInstallationPackage({...design,paperSize});
    expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1')).toContain('/FontFile2');
    expect(bytes.toString('latin1')).toContain('/Type /Page');
    expect(bytes.toString('latin1')).toMatch(/\/Count 7\b/);
    expect(bytes.byteLength).toBeGreaterThan(10000);
  });
});
