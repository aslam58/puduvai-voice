'use client';
import {useEffect,useRef} from 'react';
import {ArrowUpRight,Languages} from 'lucide-react';
import type {Locale} from '@/lib/domain';
export function LanguageChooser({open,onChoose}:{open:boolean;onChoose:(locale:Locale)=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close()},[open]);
 return <dialog ref={dialog} className="language-dialog" aria-labelledby="language-title" aria-describedby="language-explanation" onCancel={()=>onChoose('en')}>
  <div className="language-welcome"><span className="language-symbol"><Languages size={27} strokeWidth={1.5}/></span><p className="eyebrow">PUDUVAI VOICE · PUDUCHERRY</p><h2 id="language-title">Choose your language</h2><p className="welcome-translations"><span lang="ta">உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்</span><span lang="hi">अपनी भाषा चुनें</span></p></div>
  <div className="language-options">
   <button type="button" lang="en" onClick={()=>onChoose('en')}><span><strong>English</strong><small>Continue in English</small></span><ArrowUpRight size={20}/></button>
   <button type="button" lang="ta" onClick={()=>onChoose('ta')}><span><strong>தமிழ்</strong><small>தமிழில் தொடரவும்</small></span><ArrowUpRight size={20}/></button>
   <button type="button" lang="hi" onClick={()=>onChoose('hi')}><span><strong>हिन्दी</strong><small>हिन्दी में जारी रखें</small></span><ArrowUpRight size={20}/></button>
  </div>
  <div id="language-explanation" className="language-explanation"><p>You can change this anytime using the language menu.</p><p lang="ta">மொழிப் பட்டியில் எப்போது வேண்டுமானாலும் மாற்றலாம்.</p><p lang="hi">भाषा मेनू से कभी भी भाषा बदल सकते हैं।</p></div>
 </dialog>;
}
