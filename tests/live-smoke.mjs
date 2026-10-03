import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const roles=['user','captain','admin'];
const hosts={user:'https://transport-user-isolated-production.up.railway.app',captain:'https://transport-captain-isolated-production.up.railway.app',admin:'https://transport-admin-isolated-production.up.railway.app'};
const hash=b=>createHash('sha256').update(b).digest('hex');
const request=url=>fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
async function verify(role){
 const base=hosts[role];const h=await request(base+'/healthz');assert.equal(h.status,200);const health=await h.json();assert.equal(health.app,`transport-${role}`);assert.equal(health.version,'0.3.0');
 if(process.env.EXPECTED_SHA && health.commit!=='local')assert.equal(health.commit,process.env.EXPECTED_SHA);
 const assets={'/':'index.html',[`/${role}.js?v=0.3.0`]:`${role}.js`,'/styles.css?v=0.3.0':'styles.css','/base.css?v=0.3.0':'base.css','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg'};
 for(const [path,file] of Object.entries(assets)){const response=await request(base+path);assert.equal(response.status,200,role+path);const received=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL(`../apps/${role}/public/${file}`,import.meta.url));assert.equal(hash(received),hash(expected),`${role}${path} differs from checked-out commit`);if(file.endsWith('.css'))assert.match(response.headers.get('content-type'),/text\/css/);}
 for(const other of roles.filter(x=>x!==role))for(const path of [`/${other}.html`,`/${other}.js`,`/${other}`,`/apps/${other}/public/index.html`,`/api/${other}/orders`])assert.equal((await request(base+path)).status,404,role+path);
 for(const path of ['/app.js','/server.js','/package.json','/api/orders'])assert.equal((await request(base+path)).status,404,role+path);
 const choice=await (await request(base+'/?APP_MODE=admin&role=captain')).text();assert.match(choice,new RegExp(`data-app="transport-${role}"`));assert.doesNotMatch(choice,/ثلاث واجهات|اختر طريقة الدخول/);
 assert.equal((await request(base+`/api/${role}/orders`)).status,401);
 const catalog=await request(base+'/api/services');assert.equal(catalog.status,200);assert.deepEqual(await catalog.json(),JSON.parse(await readFile(new URL('../apps/api/catalog.json',import.meta.url),'utf8')));
 const result=`PASS ${role}: root/6 assets match commit; other applications and legacy paths return 404; private API returns 401; shared catalogue reachable.`;console.log(result);return result;
}
const deadline=Date.now()+17*60*1000;let lastError='';
while(true){try{const results=[];for(const role of roles)results.push(await verify(role));const summary=`## Live application isolation verified\nCommit: ${process.env.EXPECTED_SHA || 'working tree'}\n\n${results.map(s=>'- '+s).join('\n')}\n\nRead-only checks: no production accounts or orders were created.\n`;if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);console.log('LIVE ISOLATION VERIFIED');break;}catch(error){lastError=error.message;if(Date.now()>deadline)throw new Error('Live verification failed: '+lastError);console.log('Waiting for the tested deployment: '+lastError);await new Promise(r=>setTimeout(r,15000));}}
