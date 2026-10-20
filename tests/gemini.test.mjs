import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../backend/gemini.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {validateResult,generateAssistance}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const input={category:'roads',language:'en',title:'Road surface damage',description:'The road surface has several holes.',area:'White Town'};
const result=()=>({category:'roads',title:'Damaged road surface',summary:'The resident reports several holes in the road surface.',translations:Object.fromEntries(['en','ta','hi'].map(l=>[l,{title:input.title,description:input.description}]))});
const config={apiKey:'synthetic-test-key',model:'gemini-2.5-flash'};
const response=v=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(v)}]}}]}));
test('strict schema rejects extra actions, invented categories, missing languages, and invalid nulls',()=>{
 assert.deepEqual(validateResult(result(),input),result());
 for(const v of [{...result(),publish:true},{...result(),category:'emergency'},{...result(),translations:{en:{title:'abc',description:'abc'}}},{...result(),summary:'x'.repeat(2001)}])assert.throws(()=>validateResult(v,input),/invalid_output/);
 const v=result();v.translations.ta.description=null;assert.throws(()=>validateResult(v,input),/invalid_output/);
 const outage={...input,category:'electricity',description:null};const o=result();for(const l of ['en','ta','hi'])o.translations[l].description=null;
 assert.deepEqual(validateResult(o,outage),o);
 o.translations.hi.description='invented description';assert.throws(()=>validateResult(o,outage),/invalid_output/);
});
test('provider receives only allowlisted report text, structured output and server credential header',async()=>{
 const fetched=await generateAssistance({...input,phone:'+919999999999',owner_subject:'private',audit:'secret'},config,async(url,options)=>{
  assert.match(url,/generativelanguage.googleapis.com/);assert.equal(url.includes(config.apiKey),false);
  assert.equal(options.headers['x-goog-api-key'],config.apiKey);
  const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.generationConfig.maxOutputTokens,8192);assert.equal(body.tools,undefined);
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),input);
  assert.match(body.systemInstruction.parts[0].text,/untrusted data/);
  return response(result());
 });assert.deepEqual(fetched,result());
});
test('transient failures retry; credential failures and blocked responses stop',async()=>{
 for(const [status,code,retry] of [[429,'upstream_rate_limit',true],[503,'upstream_unavailable',true],[403,'configuration_error',false]]){
  await assert.rejects(generateAssistance(input,config,async()=>new Response('provider secret details',{status})),e=>e.code===code&&e.retry===retry&&!e.message.includes('secret'));
 }
 await assert.rejects(generateAssistance(input,config,async()=>{throw Error('private network details')}),e=>e.code==='upstream_unavailable'&&e.retry);
 await assert.rejects(generateAssistance(input,config,async()=>new Response(JSON.stringify({promptFeedback:{blockReason:'SAFETY'}}))),e=>e.code==='blocked_output'&&!e.retry);
 await assert.rejects(generateAssistance(input,config,async()=>response({...result(),resolve:true})),e=>e.code==='invalid_output'&&e.retry);
 await assert.rejects(generateAssistance(input,config,async()=>new Response('{invalid')),e=>e.code==='invalid_output');
 await assert.rejects(generateAssistance(input,{apiKey:'',model:config.model}),e=>e.code==='configuration_error');
});
