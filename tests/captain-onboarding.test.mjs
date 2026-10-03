import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createOnboarding,normalizePhone} from '../apps/api/onboarding.mjs';
import {sendNotification,startNotificationWorker} from '../apps/api/notifications.mjs';
import {captainData,PNG,TERMS} from './onboarding-fixture.mjs';
const password='Password1',adminPassword='Admin-Test-Password-2026!';
let directory,backend,frontends=[],hosts={},admin,user;
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function boot(role,extra={}){const p=await port();const child=spawn(process.execPath,['server.js'],{cwd:new URL(`../apps/${role}/`,import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(p),...extra},stdio:['ignore','pipe','pipe']});let logs='';child.stderr.on('data',b=>logs+=b);for(let i=0;i<100;i++){try{const r=await fetch(`http://127.0.0.1:${p}/healthz`);if(r.ok)return {child,host:`http://127.0.0.1:${p}`};}catch{}if(child.exitCode!==null)throw new Error(logs);await new Promise(r=>setTimeout(r,20));}throw new Error('startup timed out '+logs);}
async function call(role,path,method='GET',data,session){const r=await fetch(hosts[role]+`/api/${role}/`+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie}: {})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function captain(email,n,cats){const data=captainData(email,n,cats);let r=await call('captain','register','POST',{...data,password,confirmPassword:password});assert.equal(r.status,201,JSON.stringify(r.data));r=await call('captain','login','POST',{email,password});assert.equal(r.status,200);return {...r,profile:data};}
async function documents(c,except){for(const kind of ['license','registration','insurance','exterior','interior'])if(kind!==except){const r=await call('captain','application/files','POST',{kind,base64:PNG},c);assert.equal(r.status,201,JSON.stringify(r.data));}}
async function submit(c){return call('captain','application/submit','POST',{termsAccepted:true,termsVersion:TERMS},c);}
test.before(async()=>{directory=await mkdtemp(join(tmpdir(),'wasil-test-'));backend=await boot('api',{DATA_DIR:directory,ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:adminPassword});hosts.api=backend.host;for(const role of ['user','captain','admin']){const f=await boot(role,{API_ORIGIN:backend.host});frontends.push(f);hosts[role]=f.host;}admin=await call('admin','login','POST',{email:'admin@example.test',password:adminPassword});assert.equal(admin.status,200);await call('user','register','POST',{name:'صاحب الطلب',email:'owner@example.test',password});user=await call('user','login','POST',{email:'owner@example.test',password});});
test.after(async()=>{for(const p of [...frontends,backend].filter(Boolean)){p.child.kill();await new Promise(r=>p.child.exitCode!==null?r():p.child.once('exit',r));}await rm(directory,{force:true,recursive:true});});
test('registration validates every field, confirmation and document expiry; partial drafts are not review requests',async()=>{
 assert.equal(normalizePhone('٠٥٠١٢٣٤٥٦٧'),'+966501234567');
 const base={...captainData('invalid@example.test',50,['light']),password,confirmPassword:password};
 for(const invalid of [{confirmPassword:'Different1'},{fullName:'اسم واحد'},{identityNumber:'12'},{vehicle:{...base.vehicle,vin:'bad'}},{categories:[]},{licenseExpiry:'2020-01-01'},{phone:'123'}]){const r=await call('captain','register','POST',{...base,...invalid});assert.equal(r.status,400,JSON.stringify(invalid));}
 const c=await captain('draft@example.test',51,['light']);
 const list=await call('admin','captain-applications','GET',undefined,admin);assert.equal(list.data.some(x=>x.id===c.data.id),false);
 assert.equal((await call('captain','availability','POST',{online:true},c)).status,403);
 assert.equal((await call('captain','application/submit','POST',{termsAccepted:true,termsVersion:TERMS},c)).status,400);
 assert.equal((await call('captain','application/files','POST',{kind:'license',base64:Buffer.from('<script>alert(1)</script>').toString('base64')},c)).status,400);
 assert.equal((await call('captain','application/files','POST',{kind:'license',base64:PNG})).status,401);
 await documents(c,'interior');assert.equal((await submit(c)).status,400);
 await call('captain','application/files','POST',{kind:'interior',base64:PNG},c);
 assert.equal((await call('captain','application/submit','POST',{termsAccepted:false,termsVersion:TERMS},c)).status,400);
 assert.equal((await submit(c)).status,200);assert.equal((await submit(c)).data.revision,1);
 assert.equal((await call('captain','application','PATCH',c.profile,c)).status,409);
 assert.equal((await call('admin',`captains/${c.data.id}`,'PATCH',{approved:true},admin)).status,409);
 const detail=await call('admin',`captain-applications/${c.data.id}`,'GET',undefined,admin);assert.equal(detail.data.files.length,5);assert.equal(detail.data.data.identityNumber,c.profile.identityNumber);assert.ok(!JSON.stringify(detail.data).includes(password));
 const fid=detail.data.files[0].id;
 assert.equal((await fetch(hosts.admin+'/api/admin/files/'+fid)).status,401);
 const f=await fetch(hosts.admin+'/api/admin/files/'+fid,{headers:{Cookie:admin.cookie}});assert.equal(f.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await f.arrayBuffer()),Buffer.from(PNG,'base64'));
 const other=await captain('other-doc@example.test',52,['heavy']);assert.equal((await call('captain','files/'+fid,'GET',undefined,other)).status,404);
 const db=new DatabaseSync(join(directory,'transport.sqlite'));const record=db.prepare('SELECT payload FROM captain_applications WHERE user_id=?').get(c.data.id);assert.equal(Buffer.from(record.payload).includes(Buffer.from(c.profile.identityNumber)),false);const body=db.prepare('SELECT body FROM captain_files WHERE id=?').get(fid).body;assert.notDeepEqual(Buffer.from(body),Buffer.from(PNG,'base64'));db.close();
});
test('review, username linkage, service filtering, offline and expiry are enforced in API not just UI',async()=>{
 const c=await captain('light@example.test',61,['light']);await documents(c);await submit(c);
 assert.equal((await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'rejected',reason:'',revision:1},admin)).status,400);
 assert.equal((await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'approved',categories:['heavy'],revision:1},admin)).status,400);
 const result=await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'approved',categories:['light'],revision:1},admin);assert.equal(result.status,200);assert.match(result.data.application.username,/^WS[A-F0-9]{10}$/);assert.equal(result.data.notifications.length,2);
 assert.equal((await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'approved',revision:1},admin)).status,409);
 for(const identifier of [c.profile.phone,c.profile.email,result.data.application.username])assert.equal((await call('captain','login','POST',{identifier,password})).status,200);
 let light=await call('user','orders','POST',{serviceId:'pickup-s',pickup:'استلام',destination:'تسليم',distanceKm:8,unaccompanied:true},user);let heavy=await call('user','orders','POST',{serviceId:'dyna',pickup:'استلام',destination:'تسليم',distanceKm:8,unaccompanied:false},user);assert.equal(light.status,201);assert.equal(heavy.status,201);
 assert.equal((await call('captain','orders','GET',undefined,c)).data.length,0);
 assert.equal((await call('captain',`orders/${light.data.id}/accept`,'POST',{},c)).status,403);
 assert.equal((await call('captain','availability','POST',{online:true},c)).data.online,true);
 const offers=await call('captain','orders','GET',undefined,c);assert.deepEqual(offers.data.map(o=>o.id),[light.data.id]);
 assert.equal((await call('captain',`orders/${heavy.data.id}/accept`,'POST',{},c)).status,403);
 assert.equal((await call('captain',`orders/${light.data.id}/accept`,'POST',{},c)).status,200);
 assert.equal((await call('captain','availability','POST',{online:false},c)).data.online,false);
 assert.equal((await call('captain','heartbeat','POST',{},c)).data.online,false);
 assert.equal((await call('captain','orders','GET',undefined,c)).data[0].id,light.data.id);
 for(const status of ['to_pickup','arrived','in_transit','delivered'])assert.equal((await call('captain',`orders/${light.data.id}/status`,'PATCH',{status},c)).status,200);
 const db=new DatabaseSync(join(directory,'transport.sqlite'));const module=createOnboarding(db,{send:()=>{},passwordHash:()=>'',validPassword:()=>true,env:{NODE_ENV:'test'}});const r=module.get(c.data.id),data=module.decode(r.payload);data.insuranceExpiry='2020-01-01';db.prepare('UPDATE captain_applications SET payload=? WHERE user_id=?').run(module.seal(data),c.data.id);db.close();assert.equal((await call('captain','availability','POST',{online:true},c)).status,403);
});
test('rejection reason, resubmission revision, durable outbox and no false notification success',async()=>{
 const c=await call('captain','login','POST',{email:'other-doc@example.test',password});await documents(c);await submit(c);
 const decision=await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'rejected',reason:'الصورة غير واضحة',revision:1},admin);assert.equal(decision.status,200);assert.equal(decision.data.application.reason,'الصورة غير واضحة');assert.equal(decision.data.application.username,null);
 const own=await call('captain','me','GET',undefined,c);assert.equal(own.data.approved,false);assert.equal(own.data.rejectionReason,'الصورة غير واضحة');
 const draft=await call('captain','application','PATCH',captainData('other-doc@example.test',52,['heavy']),c);assert.equal(draft.data.revision,2);await submit(c);
 assert.equal((await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'approved',categories:['heavy'],revision:1},admin)).status,409);
 assert.equal((await call('admin',`captain-applications/${c.data.id}/decision`,'POST',{decision:'approved',categories:['heavy'],revision:2},admin)).status,200);
 const detail=await call('admin',`captain-applications/${c.data.id}`,'GET',undefined,admin);assert.equal(detail.data.history.length,2);assert.equal(detail.data.notifications.length,4);
 const db=new DatabaseSync(join(directory,'transport.sqlite'));const module=createOnboarding(db,{send:()=>{},passwordHash:()=>'',validPassword:()=>true,env:{NODE_ENV:'test'}});const worker=startNotificationWorker(db,module,{env:{}});await worker.run();worker.stop();assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE state='accepted'").get().n,0);assert.ok(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE state='blocked'").get().n>0);db.close();
 const notice=await call('admin','notification-status','GET',undefined,admin);assert.deepEqual(notice.data.configured,{sms:false,email:false});
});
test('provider adapters validate response, use idempotency/correlation, never expose credentials',async()=>{
 let captured;const fetcher=async(url,opts)=>{captured={url,opts};return {ok:true,status:200,json:async()=>({id:'mail-id'})};};
 const message={to:'test@example.test',body:'تم قبول الطلب WS123',subject:'واصل'};
 assert.equal((await sendNotification('email',message,'id',{env:{},fetcher})).state,'blocked');assert.equal(captured,undefined);
 const mail=await sendNotification('email',message,'id',{env:{RESEND_API_KEY:'test',EMAIL_FROM:'sender@example.test'},fetcher});assert.equal(mail.state,'accepted');assert.equal(captured.opts.headers['Idempotency-Key'],'wasil-captain-id');
 const sms=await sendNotification('sms',{...message,to:'+966500000001'},'sms-id',{env:{UNIFONIC_APPSID:'test',UNIFONIC_SENDER_ID:'WASIL'},fetcher:async(url,opts)=>{assert.equal(opts.body.get('Recipient'),'966500000001');assert.equal(opts.body.get('CorrelationID'),'sms-id');return {ok:true,status:200,json:async()=>({success:true,data:{MessageID:'SMS123'}})};}});assert.equal(sms.state,'accepted');
 const failure=await sendNotification('email',message,'id',{env:{RESEND_API_KEY:'secret',EMAIL_FROM:'sender'},fetcher:async()=>{throw new Error('secret included');}});assert.deepEqual(failure,{state:'unknown',error:'delivery_outcome_unknown'});
});
