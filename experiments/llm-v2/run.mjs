import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observer, simpleMessages, sha } from '../llm/run.mjs';
import { loadConfig } from '../../server/config.mjs';
import { defaultProfile } from '../../server/db.mjs';
import { recipeSchema } from '../../server/schemas.mjs';
import { generateDescription } from '../../server/generation.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const phase=process.argv[2];
if (!['dev','final','tones','freeze'].includes(phase)) throw new Error('dev|freeze|final|tones');
const out=resolve(root,'results'); mkdirSync(out,{recursive:true});
const corpus=JSON.parse(readFileSync(resolve(root,'inputs.json'),'utf8'));
const files=['server/generation.mjs','server/grounding.mjs','server/tags.mjs','server/db.mjs','server/config.mjs','server/schemas.mjs',
  'experiments/llm-v2/run.mjs','experiments/llm-v2/inputs.json','experiments/llm/run.mjs'];
const sources=Object.fromEntries(files.map(f=>[f,readFileSync(resolve(root,'../..',f),'utf8')]));
const hashes=Object.fromEntries(Object.entries(sources).map(([f,s])=>[f,sha(s)]));
if (phase==='freeze') {
  if(existsSync(resolve(out,'final.jsonl')) || existsSync(resolve(out,'freeze.json'))) throw new Error('Freeze must precede final, and cannot be overwritten');
  writeFileSync(resolve(out,'freeze.json'),JSON.stringify({at:new Date().toISOString(),hashes,sources,
    protocol:'Paired simple/detailed, alternate order, all detailed regenerations; max two native calls per logical request, shared timeout. Do not tune on final.'},null,2));
  console.log('Frozen before held-out generation.');
  process.exit(0);
}
if (phase==='final') {
 const freeze=JSON.parse(readFileSync(resolve(out,'freeze.json'),'utf8'));
 if(JSON.stringify(hashes)!==JSON.stringify(freeze.hashes)) throw new Error('Frozen source mismatch');
}
const label=process.argv[3]??phase;
if(!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid output label');
const path=resolve(out,`${label}.jsonl`);
if(existsSync(path)) throw new Error('Will not overwrite evidence: '+path);
const config=loadConfig();
if(config.llm.provider!=='openai-compatible'||!config.llm.apiKey) throw new Error('Real LLM required');
const manifest={phase,startedAt:new Date().toISOString(),hashes,model:config.llm.model,timeoutMs:config.llm.timeoutMs};
writeFileSync(resolve(out,`${label}-manifest.json`),JSON.stringify(manifest,null,2));
let cases=corpus.filter(r=>r.split===phase);
if(phase==='tones') cases=corpus.filter(r=>r.group==='porridge').flatMap(r=>['editorial','bistro','concierge'].map(tone=>({...r,id:`${r.id}-${tone}`,tone})));
for(const [index,input] of cases.entries()) {
 const strategies=phase==='final'?(index%2?['detailed','simple']:['simple','detailed']):['detailed'];
 for(const strategy of strategies) {
  let previous=null;
  for(let repetition=0;repetition<(strategy==='detailed'&&phase!=='tones'?2:1);repetition++) {
   if(repetition&&!previous) continue;
   const calls=[];
   const trace=observer(calls,'detailed');
   const fetchImpl=async(url,opts)=>{
    if(strategy==='simple') {
     const body=JSON.parse(opts.body), data=JSON.parse(body.messages[1].content);
     body.messages=simpleMessages(body.messages);
     if(data.correction) body.messages.push({role:'user',content:JSON.stringify({correction:data.correction})});
     opts={...opts,body:JSON.stringify(body)};
    }
    return trace(url,opts);
   };
   const start=performance.now();
   const record={id:`${input.id}:${strategy}:${repetition}`,phase,input,strategy,repetition,calls};
   try {
    record.result=await generateDescription({recipe:recipeSchema.parse(input.recipe),profile:defaultProfile('Acceptance study'),
      language:input.language,tone:input.tone,maxLength:input.maxLength,previous,config:config.llm,fetchImpl});
    previous=record.result; record.accepted=true;
   } catch(error) {record.accepted=false;record.error={code:error.code??error.name,message:error.message};}
   record.elapsedMs=Math.round(performance.now()-start);
   appendFileSync(path,JSON.stringify(record)+'\n');
   console.log(`${phase} ${record.id}: ${record.accepted?'OK':record.error.code}, ${record.elapsedMs} ms, calls=${calls.length}`);
   if(calls.some(c=>[401,403,404].includes(c.httpStatus))) throw new Error('Provider access failure. Stop paid calls.');
  }
 }
}
manifest.completedAt=new Date().toISOString();
writeFileSync(resolve(out,`${label}-manifest.json`),JSON.stringify(manifest,null,2));
