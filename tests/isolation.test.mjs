import {captainData,PNG,TERMS} from './onboarding-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
const password='Transport-Test-Password-2026!';
const paths={};let backend,frontends=[],directory,apiPort;
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function boot(role,extra={}){const port=extra.PORT || await freePort();let logs='';const process_=spawn(process.execPath,['server.js'],{cwd:new URL(`../apps/${role}/`,import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(port),...extra},stdio:['ignore','pipe','pipe']});process_.stdout.on('data',x=>logs+=x);process_.stderr.on('data',x=>logs+=x);const base=`http://127.0.0.1:${port}`;for(let i=0;i<100;i++){if(process_.exitCode!==null)throw new Error(logs);try{const r=await fetch(base+'/healthz');if(r.ok)return {process:process_,base,logs:()=>logs};}catch{}await new Promise(r=>setTimeout(r,30));}process_.kill();throw new Error('Startup timeout '+logs);}
async function stop(item){if(item.process.exitCode!==null)return;await new Promise(resolve=>{item.process.once('exit',resolve);item.process.kill('SIGTERM');});}
async function call(role,path,method='GET',body,cookie,extraHeaders={}){const response=await fetch(paths[role]+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function register(role,email){const created=await call(role,`/api/${role}/register`,'POST',{...(role==='captain'?captainData(email):{}),email,password,confirmPassword:password,name:role==='user'?'مستخدم اختبار':'كابتن اختبار',role:'admin'});assert.equal(created.status,201);const login=await call(role,`/api/${role}/login`,'POST',{email,password});assert.equal(login.status,200);assert.equal(login.data.role,role);if(role==='captain'){for(const kind of ['license','registration','insurance','exterior','interior'])assert.equal((await call(role,'/api/captain/application/files','POST',{kind,base64:PNG},login.cookie)).status,201);assert.equal((await call(role,'/api/captain/application/submit','POST',{termsAccepted:true,termsVersion:TERMS},login.cookie)).status,200);}return login;}
test.before(async()=>{directory=await mkdtemp(join(tmpdir(),'transport-isolation-'));apiPort=await freePort();backend=await boot('api',{PORT:String(apiPort),DATA_DIR:directory,ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:password});paths.api=backend.base;for(const role of ['user','captain','admin']){const item=await boot(role,{API_ORIGIN:backend.base,APP_MODE:'this-obsolete-value-must-have-no-effect'});frontends.push(item);paths[role]=item.base;}});
test.after(async()=>{await Promise.all(frontends.map(stop));if(backend)await stop(backend);if(directory)await rm(directory,{recursive:true,force:true});});
for(const role of ['user','captain','admin']){
 test(`${role}: independent HTML, script, stylesheet and install identity`,async()=>{
  const health=await call(role,'/healthz');assert.equal(health.data.app,`transport-${role}`);assert.equal(health.data.version,'0.3.0');
  const response=await fetch(paths[role]+'/'),html=await response.text();assert.equal(response.status,200);assert.match(html,new RegExp(`data-app="transport-${role}"`));
  const assetVersion=role==='admin'?'0.3.0':'concept-5.1';
  const scriptSources=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(scriptSources,[`/${role}.js?v=${assetVersion}`]);
  assert.ok(html.includes(`href="/styles.css?v=${assetVersion}"`));
  if(role!=='admin')assert.match(html,/data-design="concept-5"/);
  assert.doesNotMatch(html,/اختر طريقة الدخول|ثلاث واجهات|data-r=|src="\/app.js/);
  for(const asset of [`/${role}.js?v=${assetVersion}`,`/styles.css?v=${assetVersion}`,`/base.css?v=${assetVersion}`,'/manifest.webmanifest','/icon.svg']){const r=await fetch(paths[role]+asset);assert.equal(r.status,200,asset);assert.equal(r.headers.get('cache-control'),'no-store');}
  const manifest=await (await fetch(paths[role]+'/manifest.webmanifest')).json();assert.equal(manifest.id,`/${role}-application`);
  const files=await readdir(new URL(`../apps/${role}/public`,import.meta.url));assert.deepEqual(files.sort(),['base.css','icon.svg','index.html','manifest.webmanifest',`${role}.js`,'styles.css',...(role==='captain'?['onboarding.js','onboarding.css','gps.js','maps.js','maps.css']:role==='user'?['maps.js','maps.css','map-picker.js']:[])].sort());
 });
 test(`${role}: foreign files, query-mode switching and API paths are isolated`,async()=>{for(const other of ['user','captain','admin'].filter(x=>x!==role)){for(const path of [`/${other}.html`,`/${other}.js`,`/${other}`,`/apps/${other}/public/index.html`,`/api/${other}/orders`]){const r=await fetch(paths[role]+path);assert.equal(r.status,404,`${role}${path}`);}const body=await (await fetch(paths[role]+`/?APP_MODE=${other}&role=${other}`)).text();assert.match(body,new RegExp(`data-app="transport-${role}"`));}for(const path of ['/app.js','/server.js','/package.json','/.env','/app.json','/api/orders'])assert.equal((await fetch(paths[role]+path)).status,404,path);});
 test(`${role}: unauthenticated private reads and cross-origin writes blocked`,async()=>{assert.equal((await call(role,`/api/${role}/orders`)).status,401);const r=await call(role,'/api/quote','POST',{serviceId:'dyna',distanceKm:8},null,{Origin:'https://foreign.example'});assert.equal(r.status,403);});
}
test('API serves JSON only, validates prices and blocks public administrator creation',async()=>{for(const path of ['/','/index.html','/admin.js','/user.html'])assert.equal((await fetch(paths.api+path)).status,404);for(const distanceKm of [-1,0,2501,'8',null])assert.equal((await call('user','/api/quote','POST',{serviceId:'dyna',distanceKm})).status,400);const catalog=await call('user','/api/services');assert.equal(catalog.data.home.length,5);assert.equal(catalog.data.heavy.some(s=>s.id.startsWith('water')),false);assert.equal((await call('admin','/api/admin/register','POST',{name:'x',email:'x@example.test',password})).status,403);});
test('user and captain registration require 8+ chars with uppercase, lowercase and a digit',async()=>{
 const invalid=['Abcdef1','abcdefgh1','ABCDEFGH1','Abcdefgh'];
 for(const [index,password] of invalid.entries())assert.equal((await call('user','/api/user/register','POST',{name:'اختبار',email:`weak-${index}@example.test`,password})).status,400);
 assert.equal((await call('user','/api/user/register','POST',{name:'ثمانية',email:'eight@example.test',password:'Abcdefg1'})).status,201);
 assert.equal((await call('captain','/api/captain/register','POST',{...captainData('captain-eight@example.test',8),password:'Zyxwvut9',confirmPassword:'Zyxwvut9'})).status,201);
});
test('independent sessions, shared API, captain approval and order transitions',async()=>{
 const user=await register('user','user@example.test'),otherUser=await register('user','other@example.test'),captain=await register('captain','captain@example.test');
 assert.equal((await call('admin','/api/admin/me','GET',undefined,user.cookie.replace('transport_user_session','transport_admin_session'))).status,401);
 assert.equal((await call('captain','/api/captain/orders','GET',undefined,captain.cookie)).status,403);
 const admin=await call('admin','/api/admin/login','POST',{email:'admin@example.test',password});assert.equal(admin.status,200);
 assert.equal((await call('admin',`/api/admin/captain-applications/${captain.data.id}/decision`,'POST',{decision:'approved',revision:1,categories:['light','heavy']},admin.cookie)).status,200);
 assert.equal((await call('captain','/api/captain/availability','POST',{online:true},captain.cookie)).status,200);
 const created=await call('user','/api/user/orders','POST',{serviceId:'dyna',distanceKm:8,pickup:'نقطة اختبار',destination:'وجهة اختبار',unaccompanied:true,price:1,category:'home'},user.cookie);assert.equal(created.status,201);assert.equal(created.data.price,138);assert.equal(created.data.category,'heavy');const id=created.data.id;
 assert.equal((await call('user','/api/user/orders','GET',undefined,otherUser.cookie)).data.length,0);
 assert.equal((await call('captain','/api/captain/orders','GET',undefined,captain.cookie)).data[0].id,id);
 assert.equal((await call('admin','/api/admin/orders','GET',undefined,admin.cookie)).data[0].id,id);
 const results=await Promise.all([call('captain',`/api/captain/orders/${id}/accept`,'POST',{},captain.cookie),call('captain',`/api/captain/orders/${id}/accept`,'POST',{},captain.cookie)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await call('captain',`/api/captain/orders/${id}/status`,'PATCH',{status:'delivered'},captain.cookie)).status,409);
 for(const status of ['to_pickup','arrived','in_transit','delivered'])assert.equal((await call('captain',`/api/captain/orders/${id}/status`,'PATCH',{status},captain.cookie)).status,200);
 await stop(backend);backend=await boot('api',{PORT:String(apiPort),DATA_DIR:directory,ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:password});
 const persisted=await call('user','/api/user/orders','GET',undefined,user.cookie);assert.equal(persisted.data[0].status,'delivered');assert.equal(persisted.data[0].id,id);
 await call('user','/api/user/logout','POST',{},user.cookie);assert.equal((await call('user','/api/user/me','GET',undefined,user.cookie)).status,401);
 assert.equal((await call('captain','/api/captain/me','GET',undefined,captain.cookie)).status,200);
});
