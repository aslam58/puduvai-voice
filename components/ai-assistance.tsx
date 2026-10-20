'use client';
import {useEffect,useState} from 'react';
type Translation={title:string;description:string|null};
type Job={id:string;revision:number;state:string;attempts:number;error_code:string|null;model:string|null;approved_at:string|null;result:{title:string;category:string;summary:string;translations:Record<'en'|'ta'|'hi',Translation>}|null};
type State={enabled:boolean;job:Job|null;revision:number};
export function AiAssistance({id,revision}:{id:string;revision:number}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[reviewed,setReviewed]=useState(false);
 useEffect(()=>{
  let active=true;setState(null);setReviewed(false);setError('');
  async function load(){try{const r=await fetch(`/api/admin?action=admin_ai_get&id=${id}`,{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json() as State;if(active)setState(data)}catch{if(active)setError('Could not load Gemini assistance. Reporting and moderation remain available.')}}
  void load();const timer=setInterval(()=>{void load()},15000);return()=>{active=false;clearInterval(timer)};
 },[id,revision,refresh]);
 async function action(action:'admin_ai_request'|'admin_ai_approve'){
  setBusy(true);setError('');try{const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,revision})});
   if(!r.ok)throw Error(r.status===409?'Report changed. Reload it before requesting or approving assistance.':r.status===429?'Usage limit reached. Please try later.':r.status===503?'Gemini is not configured. Reporting and moderation remain available.':'Gemini action rejected. Please reload the report.');
   setRefresh(v=>v+1);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const job=state?.job;const stale=state?.revision!==revision;
 return <section className="report-form"><h3>Gemini assistance</h3><p className="form-help">Optional assistance sends the original report title, description, category, language and area to Google Gemini. Contact fields, photos, coordinates and private audit notes are excluded. Original content is preserved. AI cannot publish or resolve reports.</p>
 {error&&<p role="alert" className="form-error">{error}</p>}
 {!state?<p role="status">{error?'Assistance status unavailable.':'Loading assistance status…'}</p>:<>
 {!state.enabled&&<p role="status">Gemini is disabled until server-side billing, model and credentials are configured.</p>}
 {stale&&<p role="status">This report has changed. Reload it to review the current revision.</p>}
 {!job&&<button type="button" disabled={busy||!state.enabled||stale} onClick={()=>action('admin_ai_request')}>{busy?'Requesting…':'Request Gemini suggestions & translations'}</button>}
 {job&&<><p role="status">Job: {job.state} · Revision {job.revision} · Attempts {job.attempts}/3</p>{['pending','running','retry'].includes(job.state)&&<p className="form-help">Queued work runs in the background. You can leave this page. Temporary failures retry automatically within usage limits.</p>}{job.state==='failed'&&<p role="status">Assistance failed: {job.error_code}. Continue human review using the original report. An operator can investigate this job.</p>}
 {job.result&&job.state==='succeeded'&&<><p className="eyebrow">Machine suggestions · human review required</p><p>Suggested category: <strong>{job.result.category}</strong></p><p>Suggested title: <strong>{job.result.title}</strong></p><h4>Private administrator summary</h4><p className="description">{job.result.summary}</p><h4>Machine translations</h4>{(['en','ta','hi'] as const).map(language=><details key={language}><summary>{({en:'English',ta:'தமிழ்',hi:'हिन्दी'})[language]} · Machine translation</summary><div lang={language}><strong>{job.result!.translations[language].title}</strong>{job.result!.translations[language].description&&<p className="description">{job.result!.translations[language].description}</p>}</div></details>)}<p className="form-help">Translations retain the original report meaning; they may contain mistakes. Review all three languages against the original before enabling display. Title/category suggestions and the summary remain private. Model: {job.model}.</p>{job.approved_at?<p role="status">Human-reviewed translations are available wherever the original report is accessible.</p>:<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I have reviewed all three translations against the original report.</label><button type="button" disabled={busy||!reviewed||stale} onClick={()=>action('admin_ai_approve')}>Approve reviewed translations</button></>}</>}
 </>}
 <button type="button" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh assistance</button>
 </>}
 </section>;
}
