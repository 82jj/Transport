import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TERMS_VERSION,TERMS} from '../apps/api/onboarding.mjs';
const roles=['user','captain','admin'];
const hosts={user:'https://transport-user-isolated-production.up.railway.app',captain:'https://transport-captain-isolated-production.up.railway.app',admin:'https://transport-admin-isolated-production.up.railway.app'};
const apiHost='https://transport-web-production-1ad1.up.railway.app';
const hash=b=>createHash('sha256').update(b).digest('hex');
const request=url=>fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
async function verifyTerms(base){
 const response=await request(base+'/api/captain/terms');assert.equal(response.status,200,'Live onboarding terms endpoint is missing');
 assert.deepEqual(await response.json(),{version:TERMS_VERSION,terms:TERMS});
}
async function verifyApi(){
 const response=await request(apiHost+'/healthz');assert.equal(response.status,200);
 const health=await response.json();assert.equal(health.app,'transport-api');assert.equal(health.version,'0.3.0');assert.equal(health.storage,'sqlite');
 if(process.env.EXPECTED_SHA){
  assert.match(health.commit,/^[a-f0-9]{40}$/,'API must identify its deployed Git revision');
  git('merge-base','--is-ancestor',health.commit,process.env.EXPECTED_SHA);
  assert.equal(git('rev-parse',`${health.commit}:apps/api`),git('rev-parse',`${process.env.EXPECTED_SHA}:apps/api`),'API: deployed application tree differs from expected revision');
 }
 await verifyTerms(apiHost);
 for(const path of ['/api/captain/application','/api/admin/captain-applications','/api/admin/files/not-a-real-file'])assert.equal((await request(apiHost+path)).status,401,path);
 const result=`PASS api: deployed API tree matches; onboarding terms ${TERMS_VERSION} reachable; private applications/documents require authentication.`;console.log(result);return result;
}
async function verify(role){
 const base=hosts[role],h=await request(base+'/healthz');assert.equal(h.status,200);const health=await h.json();assert.equal(health.app,`transport-${role}`);assert.equal(health.version,'0.3.0');
 // Independent apps need not all redeploy for a sibling's CSS change. Check the
 // entire deployed app tree against this revision, not only a global commit ID.
 if(process.env.EXPECTED_SHA&&health.commit!=='local'){
  assert.match(health.commit,/^[a-f0-9]{40}$/);
  git('merge-base','--is-ancestor',health.commit,process.env.EXPECTED_SHA);
  assert.equal(git('rev-parse',`${health.commit}:apps/${role}`),git('rev-parse',`${process.env.EXPECTED_SHA}:apps/${role}`),`${role}: deployed application tree differs from expected revision`);
 }
 const config=JSON.parse(await readFile(new URL(`../apps/${role}/app.json`,import.meta.url),'utf8'));
 for(const file of config.files){const path=file==='index.html'?'/':`/${file}?v=concept-5.1`;const response=await request(base+path);assert.equal(response.status,200,role+path);const received=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL(`../apps/${role}/public/${file}`,import.meta.url));assert.equal(hash(received),hash(expected),`${role}${path} differs from checked-out files`);if(file.endsWith('.css'))assert.match(response.headers.get('content-type'),/text\/css/);}
 for(const other of roles.filter(x=>x!==role))for(const path of [`/${other}.html`,`/${other}.js`,`/${other}`,`/apps/${other}/public/index.html`,`/api/${other}/orders`])assert.equal((await request(base+path)).status,404,role+path);
 for(const path of ['/app.js','/server.js','/package.json','/api/orders'])assert.equal((await request(base+path)).status,404,role+path);
 const choice=await (await request(base+'/?APP_MODE=admin&role=captain')).text();assert.match(choice,new RegExp(`data-app="transport-${role}"`));assert.doesNotMatch(choice,/ثلاث واجهات|اختر طريقة الدخول/);
 if(role!=='admin')assert.match(choice,/data-design="concept-5"/);
 if(role==='captain')await verifyTerms(base);
 assert.equal((await request(base+`/api/${role}/orders`)).status,401);
 const catalog=await request(base+'/api/services');assert.equal(catalog.status,200);assert.deepEqual(await catalog.json(),JSON.parse(await readFile(new URL('../apps/api/catalog.json',import.meta.url),'utf8')));
 const result=`PASS ${role}: full app tree and ${config.files.length} assets match; foreign pages/APIs 404; authenticated data 401; catalogue reachable.`;console.log(result);return result;
}
const deadline=Date.now()+17*60*1000;
while(true){try{const results=[await verifyApi()];for(const role of roles)results.push(await verify(role));const summary=`## Live application isolation verified\nTarget revision: ${process.env.EXPECTED_SHA||'working tree'}\n\n${results.map(s=>'- '+s).join('\n')}\n\nRead-only checks: no production accounts or orders were created.\n`;if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);console.log('LIVE ISOLATION VERIFIED');break;}catch(error){if(Date.now()>deadline)throw new Error('Live verification failed: '+error.message);console.log('Waiting for the tested deployment: '+error.message);await new Promise(r=>setTimeout(r,15000));}}
