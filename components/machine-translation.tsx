'use client';
import {useEffect,useState} from 'react';
import type {Locale} from '@/lib/domain';
const copy={
 en:{heading:'Machine translation',note:'Reviewed by an administrator. Machine translations may contain errors; the original report above is preserved.'},
 ta:{heading:'இயந்திர மொழிபெயர்ப்பு',note:'நிர்வாகியால் ஆய்வு செய்யப்பட்டது. இயந்திர மொழிபெயர்ப்பில் பிழைகள் இருக்கலாம்; மேலே உள்ள அசல் புகார் பாதுகாக்கப்பட்டுள்ளது.'},
 hi:{heading:'मशीनी अनुवाद',note:'व्यवस्थापक ने समीक्षा की है। मशीनी अनुवाद में त्रुटियाँ हो सकती हैं; ऊपर मूल रिपोर्ट सुरक्षित है।'}
};
export function MachineTranslation({id,locale,sourceLanguage}:{id:string;locale:Locale;sourceLanguage:string}){
 const [translation,setTranslation]=useState<{title:string;description:string|null}|null>(null);
 useEffect(()=>{
  let active=true;setTranslation(null);
  if(locale!==sourceLanguage)void fetch(`/api/reports/${id}/translation?language=${locale}`,{cache:'no-store'}).then(async r=>r.ok?r.json() as Promise<{translation:{title:string;description:string|null}|null}>:null).then(data=>{if(active)setTranslation(data?.translation||null)}).catch(()=>{});
  return()=>{active=false};
 },[id,locale,sourceLanguage]);
 if(!translation)return null;
 return <section className="report-form" lang={locale}><h2>{copy[locale].heading}</h2><p className="form-help">{copy[locale].note}</p><h3>{translation.title}</h3>{translation.description&&<p className="description">{translation.description}</p>}</section>;
}
