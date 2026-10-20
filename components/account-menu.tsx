'use client';
import {useEffect, useState} from 'react';
import {authMessages} from '@/lib/auth/messages';
import type {Locale} from '@/lib/domain';
export function AccountMenu({locale}: {locale: Locale}) {
 const [signedIn, setSignedIn] = useState<boolean|null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState(false);
 const t = authMessages[locale];
 useEffect(() => {const c = new AbortController(); fetch('/api/session', {signal:c.signal}).then(r => r.ok ? r.json() as Promise<{signedIn: boolean}> : Promise.reject()).then(v => setSignedIn(v.signedIn)).catch(() => {}); return () => c.abort();}, []);
 async function signOut() {setBusy(true); setError(false); try {const r = await fetch('/api/auth/signout', {method:'POST'}); if(!r.ok) throw Error(); window.location.assign('/?lang=' + locale);} catch {setError(true); setBusy(false);}}
 if (signedIn === null) return null;
 return <div className="account-menu">{signedIn ? <button disabled={busy} onClick={signOut}>{t.signOut}</button> : <a href={'/login?return_to=' + encodeURIComponent('/?lang=' + locale)} target="_top">{t.signIn}</a>}{error && <span role="alert">{t.signOutError}</span>}</div>;
}
