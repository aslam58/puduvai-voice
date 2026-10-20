import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function sourceModule(path,replacements={}){
 let source=ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [from,to] of Object.entries(replacements))source=source.replaceAll(from,to);
 return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
}
const domain=await sourceModule('../lib/domain.ts');
const coverage=await sourceModule('../lib/coverage.ts');
const {reportSchema}=await import(await sourceModule('../lib/report-validation.ts',{"'./coverage'":JSON.stringify(coverage),"'./domain'":JSON.stringify(domain),"'zod'":JSON.stringify(import.meta.resolve('zod'))}));
const {outageDuration,istInputToIso}=await import(await sourceModule('../lib/outage.ts'));
const base={requestId:crypto.randomUUID(),language:'en',area:'White Town',region:'Puducherry',constituency:14,latitude:11.94,longitude:79.83,category:'electricity',observed:true,outageStartedAt:'2026-10-14T23:30:00+05:30'};
test('outage duration uses IST across midnight and supports optional end',()=>{
 assert.equal(istInputToIso('2026-10-14T23:30'),'2026-10-14T18:00:00.000Z');
 assert.equal(outageDuration(base.outageStartedAt,'2026-10-15T01:00:00+05:30','en'),'1 hr 30 min');
 assert.equal(outageDuration(base.outageStartedAt,null,'en'),null);
 assert.equal(reportSchema.safeParse(base).success,true);
});
test('invalid times and unconfirmed outage reports are rejected',()=>{
 assert.equal(reportSchema.safeParse({...base,outageEndedAt:'2026-10-14T22:30:00+05:30'}).success,false);
 assert.equal(reportSchema.safeParse({...base,outageEndedAt:new Date(Date.now()+3600000).toISOString()}).success,false);
 assert.equal(reportSchema.safeParse({...base,observed:false}).success,false);
 assert.equal(reportSchema.safeParse({...base,photo:'unwanted'}).success,false);
});
test('Traffic and Accidents use the validated location reporting flow',()=>{
 for(const category of ['traffic','accidents']){
  const r={requestId:crypto.randomUUID(),language:'hi',area:'White Town',region:'Puducherry',constituency:14,category,title:'Road hazard',description:'A route is blocked by a road hazard.',latitude:11.94,longitude:79.83};
  assert.equal(reportSchema.safeParse(r).success,true);
  assert.equal(reportSchema.safeParse({...r,latitude:13}).success,false);
 }
});
test('all 30 constituencies accept locations in their selected region',async()=>{
 const {constituencies}=await import(coverage);
 assert.equal(constituencies.length,30);
 const points={Puducherry:[11.94,79.83],Karaikal:[10.92,79.83],Mahe:[11.70,75.54],Yanam:[16.73,82.22]};
 for(const c of constituencies){
  const [latitude,longitude]=points[c.region];
  const r={...base,region:c.region,constituency:c.id,latitude,longitude,address:'12 Example Street',pinCode:'605001'};
  assert.equal(reportSchema.safeParse(r).success,true,c.name);
  assert.equal(reportSchema.safeParse({...r,region:c.region==='Yanam'?'Mahe':'Yanam'}).success,false,c.name);
  assert.equal(reportSchema.safeParse({...r,latitude:0,longitude:0}).success,false,c.name);
 }
});
test('address capture is optional and rejects malformed or oversized input',()=>{
 for(const bad of [{address:'x'.repeat(501)},{landmark:'x'.repeat(201)},{pinCode:'000000'},{pinCode:'abc'},{latitude:undefined},{constituency:31},{area:' '}]){
  assert.equal(reportSchema.safeParse({...base,...bad}).success,false);
 }
 assert.equal(reportSchema.safeParse({...base,address:'  12 Example Street  '}).data.address,'12 Example Street');
});
