'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {Mail, ArrowRight} from 'lucide-react';
import {Brand} from './brand';
import {useLocale} from '@/lib/use-locale';
import {authMessages} from '@/lib/auth/messages';
import {safeReturnPath} from '@/lib/auth/paths';
import type {Locale} from '@/lib/domain';
export function LoginForm({googleEnabled}: {googleEnabled: boolean}) {
 const {locale, setLocale} = useLocale();
 const t = authMessages[locale];
 const [email, setEmail] = useState('');
 const [sent, setSent] = useState(false);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<'error'|'rate'|'callback'|'googleError'|null>(null);
 const [returnTo, setReturnTo] = useState('/');
 const [cooldown, setCooldown] = useState(0);
 useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const destination = safeReturnPath(params.get('return_to'));
  setReturnTo(destination);
  const lang = params.get('lang') || new URL(destination, window.location.origin).searchParams.get('lang');
  if (lang === 'en' || lang === 'ta' || lang === 'hi') setLocale(lang);
  if (params.has('error')) setError(params.get('error') === 'google' ? 'googleError' : 'callback');
 }, [setLocale]);
 useEffect(() => {
  if (!cooldown) return;
  const timer = setTimeout(() => setCooldown(c => Math.max(0, c - 1)), 1000);
  return () => clearTimeout(timer);
 }, [cooldown]);
 async function send(event: FormEvent) {
  event.preventDefault(); setBusy(true); setError(null);
  try {
   const response = await fetch('/api/auth/email', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email, returnTo})});
   if (!response.ok) {setError(response.status === 429 ? 'rate' : 'error'); if(response.status === 429) setCooldown(60); return;}
   setSent(true); setCooldown(60);
  } catch {setError('error');} finally {setBusy(false);}
 }
 return <main className="auth-shell"><Brand/><section className="auth-card" aria-labelledby="login-title"><label className="auth-language"><span className="sr-only">Language / மொழி / भाषा</span><select value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="en">English</option><option value="ta">தமிழ்</option><option value="hi">हिन्दी</option></select></label><p className="eyebrow">PUDUVAI VOICE</p><h1 id="login-title">{sent ? t.sent : t.title}</h1><p>{sent ? t.sentHelp : t.help}</p>{error && <p className="form-error" role="alert">{t[error]}</p>}{!sent && <><form action={'/api/auth/google?return_to=' + encodeURIComponent(returnTo)} method="POST" target="_top"><button className="auth-google" type="submit" disabled={!googleEnabled || busy}><span aria-hidden="true">G</span>{t.google}</button></form>{!googleEnabled && <p className="auth-note">{t.googlePending}</p>}<div className="auth-divider"><span>{t.or}</span></div></>}<form onSubmit={send}>{!sent ? <label className="auth-email">{t.email}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy}/></label> : <p className="auth-address" role="status"><Mail size={18}/>{email}</p>}<button className="primary" type="submit" disabled={busy || cooldown > 0}>{busy ? t.sending : sent ? t.resend : t.send}{cooldown > 0 ? ` (${cooldown}s)` : <ArrowRight size={18}/>}</button></form>{sent && <button className="auth-change" disabled={busy} onClick={() => {setSent(false); setError(null);}}>{t.change}</button>}<p className="auth-note">{t.privacy}</p></section><a className="auth-back" href={returnTo}>{t.back}</a></main>;
}
