import http from 'node:http';
import {createMaps} from './maps.mjs';
import {createOnboarding,TERMS_VERSION,TERMS} from './onboarding.mjs';
import {startNotificationWorker,notificationConfiguration} from './notifications.mjs';
import {readFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
const production=process.env.NODE_ENV==='production';
process.umask(0o077);
if(production && !process.env.DATA_DIR) throw new Error('DATA_DIR on a persistent volume is required');
const directory=process.env.DATA_DIR || './data';
await mkdir(directory,{recursive:true});
const db=new DatabaseSync(join(directory,'transport.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,role TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,approved INTEGER NOT NULL DEFAULT 0,UNIQUE(role,email));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),captain_id TEXT REFERENCES users(id),status TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
`);
const catalog=JSON.parse(await readFile(new URL('./catalog.json',import.meta.url),'utf8'));
const allServices=Object.entries(catalog).flatMap(([category,items])=>items.map(s=>({...s,category})));
const digest=s=>createHash('sha256').update(s).digest('hex');
const passwordHash=password=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');};
const passwordMatches=(password,hash)=>{const [salt,value]=hash.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(value,'hex'));};
const validAccountPassword=password=>password.length>=8&&/[A-Z]/.test(password)&&/[a-z]/.test(password)&&/[0-9]/.test(password);
if(process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD){
 if(!process.env.ADMIN_EMAIL || (process.env.ADMIN_PASSWORD || '').length<16) throw new Error('ADMIN_EMAIL and a strong ADMIN_PASSWORD are required together');
 const email=process.env.ADMIN_EMAIL.trim().toLowerCase();
 if(!db.prepare("SELECT id FROM users WHERE role='admin' AND email=?").get(email)) db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(randomUUID(),'admin',email,'مدير النظام',passwordHash(process.env.ADMIN_PASSWORD),1);
}
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
const send=(res,status,data,cookie)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(cookie?{'Set-Cookie':cookie}:{})});res.end(JSON.stringify(data));};
const fail=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
const text=(value,max=200)=>{if(typeof value!=='string' || !value.trim() || value.length>max) fail(400,'تحقق من الحقول المطلوبة');return value.trim();};
const cookieValue=(req,role)=>{const name=`transport_${role}_session=`;return (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name))?.slice(name.length) || '';};
const cookie=(role,value,age=86400)=>`transport_${role}_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production?'; Secure':''}`;
const safeUser=u=>({id:u.id,name:u.name,role:u.role,approved:!!u.approved,...(u.role==='captain'?onboarding.summary(u):{})});
const getUser=(req,role)=>{const value=cookieValue(req,role);const u=value?db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.role=?').get(digest(value),Date.now(),role):null;if(!u)fail(401,'سجّل الدخول أولاً');return u;};
const present=row=>({...JSON.parse(row.data),id:row.id,status:row.status,createdAt:row.created_at,captainAssigned:!!row.captain_id});
const quote=async b=>{const geo=b.pickupPoint||b.destinationPoint?await maps.geometryQuote(b):null;if(geo)b={...b,distanceKm:geo.distanceKm};const s=allServices.find(s=>s.id===b.serviceId);if(!s)fail(400,'الخدمة غير موجودة');if(typeof b.distanceKm!=='number'||!Number.isFinite(b.distanceKm)||b.distanceKm<0.1||b.distanceKm>2500)fail(400,'المسافة غير صالحة');return {serviceId:s.id,service:s.name,category:s.category,distanceKm:b.distanceKm,total:Math.ceil(s.base+s.km*b.distanceKm),currency:'SAR',pricingMode:'preview',...(geo||{})};};
const limiter=new Map();
function limit(req){const now=Date.now(),key=req.socket.remoteAddress || 'unknown';let r=limiter.get(key);if(!r || r.until<now){r={count:0,until:now+60000};limiter.set(key,r);}if(++r.count>30)fail(429,'محاولات كثيرة. انتظر دقيقة.');for(const [k,v] of limiter)if(v.until<now)limiter.delete(k);}
const onboarding=createOnboarding(db,{send,passwordHash,validPassword:validAccountPassword});
const notificationWorker=startNotificationWorker(db,onboarding);
const maps=createMaps(db,{send,seal:onboarding.seal,decode:onboarding.decode});
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
  if(path==='/healthz' && method==='GET')return send(res,200,{ok:true,app:'transport-api',version:'0.3.0',commit:process.env.RAILWAY_GIT_COMMIT_SHA || 'local',storage:'sqlite'});
  if(path==='/api/captain/application/files')getUser(req,'captain');
  let b={};
  if(['POST','PATCH','DELETE'].includes(method)){
   if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON مطلوب');
   let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>(path==='/api/captain/application/files'?5600000:32768))fail(413,'الطلب كبير جداً');chunks.push(c);}
   try{b=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'طلب غير صالح');}if(!b || typeof b!=='object' || Array.isArray(b))fail(400,'طلب غير صالح');
  }
  if(await maps.handlePublic(req,res,path,b))return;
  if(path==='/api/services' && method==='GET')return send(res,200,catalog);
  if(path==='/api/quote' && method==='POST')return send(res,200,await quote(b));
  const route=path.match(/^\/api\/(user|captain|admin)\/(.+)$/);if(!route)fail(404,'المسار غير موجود');
  const [,role,action]=route;
  if(role==='captain'&&action==='terms'&&method==='GET')return send(res,200,{version:TERMS_VERSION,terms:TERMS});
  if(action==='register' && method==='POST'){
   if(role==='admin')fail(403,'إنشاء حساب الإدارة من إعدادات الخادم فقط');limit(req);
   if(role==='captain')return send(res,201,onboarding.register(b));
   const name=text(b.name,80),email=text(b.email,160).toLowerCase(),password=text(b.password,128);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'أدخل بريداً إلكترونياً صحيحاً');if(!validAccountPassword(password))fail(400,'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف كبير وحرف صغير ورقم');
   if(db.prepare('SELECT id FROM users WHERE role=? AND email=?').get(role,email))fail(409,'الحساب موجود بالفعل');
   const id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,role,email,name,passwordHash(password),role==='user'?1:0);
   return send(res,201,{ok:true,pendingApproval:role==='captain'});
  }
  if(action==='login' && method==='POST'){
   limit(req);const email=text(b.identifier??b.email,160).toLowerCase(),password=role==='captain'&&typeof b.password==='string'&&b.password.length>0&&b.password.length<=128?b.password:text(b.password,128),u=role==='captain'?onboarding.resolve(email):db.prepare('SELECT * FROM users WHERE role=? AND email=?').get(role,email);
   if(!u || !passwordMatches(password,u.hash))fail(401,'بيانات الدخول غير صحيحة');
   const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,Date.now()+86400000);
   return send(res,200,safeUser(u),cookie(role,token));
  }
  const user=getUser(req,role);
  if(await maps.handlePrivate(req,res,role,action,user,b))return;
  if(await onboarding.handle(req,res,role,action,user,b))return;
  if(role==='admin'&&action==='notification-status'&&method==='GET')return send(res,200,{configured:notificationConfiguration(),states:db.prepare('SELECT channel,state,COUNT(*) AS count FROM notification_outbox GROUP BY channel,state').all()});
  if(action==='me' && method==='GET')return send(res,200,safeUser(user));
  if(action==='logout' && method==='POST'){if(role==='captain'){onboarding.offline(user.id);maps.clearCaptain(user.id);}db.prepare('DELETE FROM sessions WHERE token=?').run(digest(cookieValue(req,role)));return send(res,200,{ok:true},cookie(role,'',0));}
  if(role==='user' && action==='orders' && method==='POST'){
   const q=await quote(b),pickup=text(b.pickup),destination=text(b.destination);if(typeof b.unaccompanied!=='boolean')fail(400,'حدد خيار المرافقة');
   const id=randomUUID(),createdAt=new Date().toISOString(),data={...q,price:q.total,pickup,destination,unaccompanied:b.unaccompanied};
   db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run(id,user.id,null,'searching',JSON.stringify(data),createdAt);
   return send(res,201,present(db.prepare('SELECT * FROM orders WHERE id=?').get(id)));
  }
  if(action==='orders' && method==='GET'){
   if(role==='captain' && !user.approved)fail(403,'حساب الكابتن بانتظار موافقة الإدارة');
   const rows=role==='user'?db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id):role==='captain'?onboarding.listOrders(user):db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
   return send(res,200,rows.map(present));
  }
  if(role==='admin' && action==='captains' && method==='GET')return send(res,200,db.prepare("SELECT * FROM users WHERE role='captain' ORDER BY name LIMIT 100").all().map(safeUser));
  const approval=action.match(/^captains\/([\w-]+)$/);
  if(role==='admin' && approval && method==='PATCH'){if(typeof b.approved!=='boolean')fail(400,'قيمة تفعيل غير صالحة');if(b.approved){const target=db.prepare("SELECT * FROM users WHERE id=? AND role='captain'").get(approval[1]);if(!target||onboarding.get(target.id)?.status!=='approved'||!onboarding.application(target).documentsCurrent)fail(409,'اعتمد طلب التسجيل المكتمل أولاً');}else onboarding.offline(approval[1]);const result=db.prepare("UPDATE users SET approved=? WHERE id=? AND role='captain'").run(b.approved?1:0,approval[1]);if(!result.changes)fail(404,'الكابتن غير موجود');return send(res,200,{ok:true});}
  const orderAction=action.match(/^orders\/([\w-]+)\/(accept|status|cancel)$/);
  if(orderAction){
   const [,id,operation]=orderAction,row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!row)fail(404,'الطلب غير موجود');
   if(role==='captain' && operation==='accept' && method==='POST'){
    if(!user.approved)fail(403,'حساب الكابتن غير مفعّل');
    onboarding.assertAccept(user,row);
    const changed=db.prepare("UPDATE orders SET captain_id=?,status='accepted' WHERE id=? AND status='searching' AND captain_id IS NULL").run(user.id,id);if(!changed.changes)fail(409,'قبله كابتن آخر أو تغيرت حالته');
   }else if(role==='captain' && operation==='status' && method==='PATCH'){
    if(!user.approved || row.captain_id!==user.id)fail(403,'الطلب غير مسند إليك');
    const next={accepted:'to_pickup',to_pickup:'arrived',arrived:'in_transit',in_transit:'delivered'};
    if(next[row.status]!==b.status)fail(409,'انتقال حالة غير مسموح');db.prepare('UPDATE orders SET status=? WHERE id=? AND status=?').run(b.status,id,row.status);
   }else if(role==='user' && operation==='cancel' && method==='POST'){
    if(row.user_id!==user.id)fail(403,'هذا الطلب لا يخصك');if(row.status!=='searching')fail(409,'لا يمكن الإلغاء من هذه المرحلة');db.prepare("UPDATE orders SET status='cancelled' WHERE id=? AND status='searching'").run(id);
   }else fail(404,'المسار غير موجود');
   const updated=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(['delivered','cancelled'].includes(updated.status))maps.clear(id);
   return send(res,200,present(updated));
  }
  fail(404,'المسار غير موجود');
 }catch(error){send(res,error.status || 500,{error:error.status?error.message:'تعذر تنفيذ الطلب'});}
});
server.requestTimeout=90000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT || 3000),'::',()=>console.log('transport-api 0.3.0 ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{notificationWorker.stop();maps.stop();server.close(()=>{db.close();process.exit(0);});});
