import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleAt(path, replacements = {}) {
 let source = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to).replaceAll("'" + from.slice(1, -1) + "'", to);
 return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
const pathsUrl = await moduleAt('../lib/auth/paths.ts');
const {safeReturnPath, signInPath} = await import(pathsUrl);
test('login destinations reject external origins, backslashes, control characters and auth loops', () => {
 for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\n/evil.test', '/login', '/login/x', '/auth/callback?code=x', '/api/auth/google', '/signin-with-chatgpt', '/callback']) assert.equal(safeReturnPath(value), '/', value);
 assert.equal(safeReturnPath('/reports/123?lang=ta#updates'), '/reports/123?lang=ta#updates');
 assert.equal(signInPath('//evil.test'), '/login?return_to=%2F');
});
const stub = 'data:text/javascript;base64,' + Buffer.from(`export async function authClient(){return {auth:{getUser:async()=>globalThis.authResult,signOut:async()=>({error:null}),exchangeCodeForSession:async()=>({error:globalThis.exchangeError})}}}`).toString('base64');
const userModule = await moduleAt('../app/auth.ts', {'"@/lib/auth/server"':JSON.stringify(stub), '"@/lib/auth/paths"':JSON.stringify(pathsUrl), '"next/navigation"':JSON.stringify('data:text/javascript,export function redirect(url){throw Error(url)}')});
const {getUser} = await import(userModule);
test('only verified, confirmed Supabase identities can own reports', async () => {
 globalThis.authResult = {data:{user:null}, error:{message:'missing'}};
 assert.equal(await getUser(), null);
 globalThis.authResult = {data:{user:{id:'id',email:'admin@example.test'}},error:null};
 assert.equal(await getUser(), null);
 globalThis.authResult = {data:{user:{id:'id',email:'resident@example.test',email_confirmed_at:'now',user_metadata:{full_name:'Resident',role:'admin'}}},error:null};
 assert.deepEqual(await getUser(), {userId:'supabase:id',email:'resident@example.test',displayName:'Resident',fullName:'Resident'});
 globalThis.authResult.error = {message:'revoked'};
 assert.equal(await getUser(), null);
});
const callbackUrl = await moduleAt('../app/auth/callback/route.ts', {'"@/lib/auth/server"':JSON.stringify(stub), '"@/lib/auth/paths"':JSON.stringify(pathsUrl)});
const callback = (await import(callbackUrl)).GET;
test('callbacks require successful PKCE exchange and never redirect off-site', async () => {
 globalThis.exchangeError = null;
 let response = await callback(new Request('https://site.test/auth/callback?code=valid&return_to=//evil.test'));
 assert.equal(response.headers.get('Location'), '/');
 assert.match(response.headers.get('Cache-Control'), /no-store/);
 response = await callback(new Request('https://site.test/auth/callback?code=valid&return_to=%2Fadmin'));
 assert.equal(response.headers.get('Location'), '/admin');
 globalThis.exchangeError = {message:'expired'};
 response = await callback(new Request('https://site.test/auth/callback?code=expired'));
 assert.match(response.headers.get('Location'), /error=callback/);
 response = await callback(new Request('https://site.test/auth/callback'));
 assert.match(response.headers.get('Location'), /error=callback/);
});
