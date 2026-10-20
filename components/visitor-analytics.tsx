'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';

const measurementId='G-DMKCD18W0J';
const preferenceKey='puduvai-analytics-consent';
type Choice='accepted'|'declined'|null;
type AnalyticsWindow=Window & {dataLayer?:unknown[];gtag?:(...args:unknown[])=>void;'ga-disable-G-DMKCD18W0J'?:boolean};
const copy={
 en:{title:'Help improve Puduvai Voice',body:'Allow Google Analytics cookies to measure homepage visits? Google receives basic visit and device data. We do not send complaint content, contact details or photos. Your choice does not affect reporting.',accept:'Allow analytics',decline:'No thanks',settings:'Analytics preferences'},
 ta:{title:'புதுவை குரலை மேம்படுத்த உதவுங்கள்',body:'முகப்புப் பக்க வருகைகளை அளவிட Google Analytics குக்கீகளை அனுமதிக்கிறீர்களா? வருகை மற்றும் சாதனம் பற்றிய அடிப்படைத் தகவல்கள் Google-க்கு அனுப்பப்படும். புகார் விவரங்கள், தொடர்புத் தகவல்கள் அல்லது புகைப்படங்கள் அனுப்பப்படாது. உங்கள் தேர்வு புகார் பதிவைப் பாதிக்காது.',accept:'அனுமதிக்கிறேன்',decline:'வேண்டாம்',settings:'பகுப்பாய்வு விருப்பங்கள்'},
 hi:{title:'पुदुवै वॉइस को बेहतर बनाने में मदद करें',body:'मुखपृष्ठ पर आने वालों की संख्या मापने के लिए Google Analytics कुकी की अनुमति दें? Google को विज़िट और डिवाइस की बुनियादी जानकारी मिलती है। शिकायत का विवरण, संपर्क जानकारी या फ़ोटो नहीं भेजे जाते। आपकी पसंद से रिपोर्ट दर्ज करने पर असर नहीं पड़ेगा।',accept:'अनुमति दें',decline:'नहीं, धन्यवाद',settings:'एनालिटिक्स प्राथमिकताएँ'}
};

export function VisitorAnalytics(){
 const pathname=usePathname();
 const [choice,setChoice]=useState<Choice>(null);
 const [ready,setReady]=useState(false);
 const [editing,setEditing]=useState(false);
 const [locale,setLocale]=useState<keyof typeof copy>('en');
 useEffect(()=>{
  try{const saved=localStorage.getItem(preferenceKey);if(saved==='accepted'||saved==='declined')setChoice(saved)}catch{/* Consent remains optional when browser storage is unavailable. */}
  setReady(true);
  const syncLanguage=()=>{const lang=document.documentElement.lang;setLocale(lang==='ta'||lang==='hi'?lang:'en')};
  syncLanguage();const observer=new MutationObserver(syncLanguage);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const w=window as AnalyticsWindow;
  const enabled=ready&&choice==='accepted'&&pathname==='/'&&['puduvaivoice.online','www.puduvaivoice.online'].includes(location.hostname);
  w['ga-disable-G-DMKCD18W0J']=!enabled;
  if(!enabled)return;
  // Only the homepage is measured: report detail, account and administrator pages are excluded.
  // Explicit canonical values prevent query strings, fragments and referrer paths reaching GA.
  if(!w.gtag){
   w.dataLayer=w.dataLayer||[];
   w.gtag=function(){w.dataLayer!.push(arguments)};
   w.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
   w.gtag('js',new Date());
   let referrer='';try{referrer=document.referrer?new URL(document.referrer).origin:''}catch{/* Invalid referrers are omitted. */}
   w.gtag('config',measurementId,{send_page_view:false,page_location:'https://puduvaivoice.online/',page_title:'Puduvai Voice',page_referrer:referrer,allow_google_signals:false,allow_ad_personalization_signals:false});
   const script=document.createElement('script');script.async=true;script.src=`https://www.googletagmanager.com/gtag/js?id=${measurementId}`;script.id='puduvai-analytics';document.head.appendChild(script);
  }
  w.gtag('event','page_view',{page_location:'https://puduvaivoice.online/',page_title:'Puduvai Voice'});
  return()=>{w['ga-disable-G-DMKCD18W0J']=true};
 },[ready,choice,pathname]);
 function choose(value:Exclude<Choice,null>){
  if(value==='declined'){
   (window as AnalyticsWindow)['ga-disable-G-DMKCD18W0J']=true;
   // Remove this property's first-party cookies when permission is withdrawn.
   for(const cookie of document.cookie.split(';')){const name=cookie.trim().split('=')[0];if(name==='_ga'||name==='_ga_DMKCD18W0J'){for(const domain of ['',`; domain=${location.hostname}`,`; domain=.${location.hostname}`,'; domain=.puduvaivoice.online'])document.cookie=`${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`}}
  }
  try{localStorage.setItem(preferenceKey,value)}catch{/* The choice still applies for this page visit. */}
  setChoice(value);setEditing(false);
 }
 if(!ready||pathname!=='/')return null;
 const t=copy[locale];
 return <aside className="analytics-preferences" aria-label={t.settings}>
  {choice&&!editing?<button type="button" className="analytics-settings" onClick={()=>setEditing(true)}>{t.settings}</button>:<section className="analytics-choice" aria-labelledby="analytics-title">
   <h2 id="analytics-title">{t.title}</h2><p>{t.body}</p>
   <div><button type="button" onClick={()=>choose('declined')}>{t.decline}</button><button type="button" className="primary" onClick={()=>choose('accepted')}>{t.accept}</button></div>
  </section>}
 </aside>;
}
