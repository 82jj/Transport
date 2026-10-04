import {createGoogleMaps} from './google-maps.mjs';
// Explicit provider selection; no public demo router and no silent cross-provider fallback.
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const activeOrder=row=>!['delivered','cancelled'].includes(row.status);
export function validPoint(value){
 if(!value||typeof value.lat!=='number'||typeof value.lng!=='number'||!Number.isFinite(value.lat)||!Number.isFinite(value.lng)||value.lat<16||value.lat>33||value.lng<34||value.lng>56)fail(400,'حدد موقعًا صحيحًا داخل نطاق الخدمة على الخريطة');
 return {lat:Number(value.lat.toFixed(6)),lng:Number(value.lng.toFixed(6))};
}
export function createMaps(db,{send,seal,decode,env=process.env,fetcher=fetch,now=Date.now}){
 const origin=env.MAPS_ORIGIN;
 const provider=env.MAPS_PROVIDER||'osm';
 if(!['osm','google','google-demo'].includes(provider))throw new Error('Invalid MAPS_PROVIDER');
 const demo=provider==='google-demo';
 const google=provider==='google'||demo?createGoogleMaps({env,fetcher,validPoint,demo}):null;
 if(origin&&!/^https?:$/.test(new URL(origin).protocol))throw new Error('Invalid MAPS_ORIGIN');
 db.exec('CREATE TABLE IF NOT EXISTS order_live_locations(order_id TEXT PRIMARY KEY REFERENCES orders(id),captain_id TEXT NOT NULL REFERENCES users(id),payload BLOB NOT NULL,captured_at INTEGER NOT NULL,received_at INTEGER NOT NULL);');
 db.exec('CREATE TABLE IF NOT EXISTS order_geo_consent(order_id TEXT PRIMARY KEY REFERENCES orders(id),started_at INTEGER NOT NULL);');
 const cache=new Map(),inflight=new Map(),limits=new Map();
 async function upstream(path,ttl=0){
  if(!origin)fail(503,'خدمة الطرق غير متصلة بعد. لا يمكن حساب مسار وهمي.');
  const saved=cache.get(path);if(saved&&saved.until>now())return saved.data;
  if(inflight.has(path))return inflight.get(path);
  const request=(async()=>{try{
   const r=await fetcher(new URL(path,origin),{signal:AbortSignal.timeout(15000),redirect:'error'});
   const d=await r.json();if(!r.ok)fail(r.status===422?422:503,d.error||'تعذر حساب الطريق؛ جرّب موقعًا آخر');
   if(ttl){if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(path,{until:now()+ttl,data:d});}
   return d;
  }catch(e){if(e.status)throw e;fail(503,'تعذر الاتصال بخدمة الخرائط. حاول مجددًا.');}finally{inflight.delete(path);}})();
  inflight.set(path,request);return request;
 }
 function rate(req){const key=req.socket.remoteAddress||'proxy',t=now();let entry=limits.get(key);if(!entry||entry.until<t){entry={count:0,until:t+60000};limits.set(key,entry);}if(++entry.count>120)fail(429,'طلبات خرائط كثيرة. انتظر قليلًا.');for(const [k,v]of limits)if(v.until<t)limits.delete(k);}
 async function route(a,b){
  a=validPoint(a);b=validPoint(b);
  const data=google?await google.route(a,b):await upstream('/route?'+new URLSearchParams({from_lat:a.lat,from_lng:a.lng,to_lat:b.lat,to_lng:b.lng}),300000);
  if(!Number.isFinite(data.distanceMeters)||data.distanceMeters<0||data.distanceMeters>2500000||!Number.isFinite(data.durationSeconds)||data.durationSeconds<0||data.geometry?.type!=='LineString'||!Array.isArray(data.geometry.coordinates)||data.geometry.coordinates.length<2)fail(502,'استجابة مسار غير صالحة');
  const coordinates=data.geometry.coordinates;if(coordinates.length>50000)fail(422,'المسار طويل جدًا للعرض');
  for(const c of coordinates)if(!Array.isArray(c)||c.length!==2||!Number.isFinite(c[0])||!Number.isFinite(c[1]))fail(502,'إحداثيات مسار غير صالحة');
  return {distanceMeters:data.distanceMeters,durationSeconds:data.durationSeconds,geometry:data.geometry,waypoints:data.waypoints?.map(validPoint)||[a,b],dataDate:data.dataDate,provider:google?'Google':'OpenStreetMap',profile:'car',truckCertified:false};
 }
 async function geometryQuote(b){
  const pickup=validPoint(b.pickupPoint),destination=validPoint(b.destinationPoint),r=await route(pickup,destination);
  return {pickupPoint:r.waypoints[0],destinationPoint:r.waypoints[1],distanceKm:Math.max(.1,Math.round(r.distanceMeters/10)/100),route:r};
 }
 async function handlePublic(req,res,path,b){
  if(!path.startsWith('/api/maps/'))return false;
  if(path==='/api/maps/config'&&req.method==='GET'){
   if(google){send(res,200,{enabled:true,routingReady:true,searchReady:true,demo,center:{lat:24.7136,lng:46.6753},provider:'Google',browserKey:env.GOOGLE_MAPS_BROWSER_KEY,profile:'car',truckCertified:false,backgroundTracking:false});return true;}
   let ready=false,dataDate=null;try{const h=await upstream('/healthz',30000);ready=!!h.ok;dataDate=h.dataDate;}catch{}
   send(res,200,{enabled:true,routingReady:ready,searchReady:ready,tileUrl:env.MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',center:{lat:24.7136,lng:46.6753},dataDate,provider:'OpenStreetMap',profile:'car',truckCertified:false,backgroundTracking:false});return true;
  }
  if(req.method!=='POST')fail(405,'طريقة غير مسموحة');rate(req);
  if(path==='/api/maps/search'){
   if(typeof b.query!=='string'||b.query.trim().length<2||b.query.length>120)fail(400,'اكتب اسم مكان أو شارع للبحث');
   if(google){send(res,200,{results:await google.search(b.query.trim(),b.sessionToken)});return true;}
   const result=await upstream('/search?'+new URLSearchParams({q:b.query.trim()}),600000);send(res,200,{results:(result.results||[]).slice(0,8).map(x=>({id:String(x.id),label:String(x.label).slice(0,300),...validPoint(x)}))});return true;
  }
  if(path==='/api/maps/snap'){
   if(google){send(res,200,await google.snap(b));return true;}
   const point=validPoint(b.point),result=await upstream('/nearest?'+new URLSearchParams(point),300000);
   if(!Number.isFinite(result.distanceMeters)||result.distanceMeters<0||result.distanceMeters>250)fail(422,'حرّك النقطة إلى شارع قريب يمكن الوصول إليه');
   send(res,200,{point:validPoint(result.point),distanceMeters:result.distanceMeters,road:String(result.road||'').slice(0,200)});return true;
  }
  if(path==='/api/maps/route'){send(res,200,await route(b.from,b.to));return true;}
  fail(404,'المسار غير موجود');
 }
 function owned(user,id,role){
  const row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!row)fail(404,'الطلب غير موجود');
  if(role==='user'&&row.user_id!==user.id||role==='captain'&&row.captain_id!==user.id)fail(404,'الطلب غير موجود');
  return row;
 }
 function clear(id){db.prepare('DELETE FROM order_live_locations WHERE order_id=?').run(id);db.prepare('DELETE FROM order_geo_consent WHERE order_id=?').run(id);}
 function clearCaptain(id){for(const r of db.prepare('SELECT id FROM orders WHERE captain_id=?').all(id))clear(r.id);}
 function prune(){db.prepare("DELETE FROM order_live_locations WHERE received_at<? OR order_id IN(SELECT id FROM orders WHERE status IN ('delivered','cancelled'))").run(now()-900000);}
 async function handlePrivate(req,res,role,action,user,b){
  const match=action.match(/^orders\/([\w-]+)\/(location|tracking|location-sharing)$/);if(!match)return false;
  const row=owned(user,match[1],role),data=JSON.parse(row.data);
  if(match[2]==='location-sharing'){if(role!=='captain'||!user.approved||!activeOrder(row))fail(403,'مشاركة الموقع للرحلة المسندة الجارية فقط');if(req.method!=='POST')fail(405,'طريقة غير مسموحة');db.prepare('INSERT INTO order_geo_consent VALUES(?,?) ON CONFLICT(order_id) DO UPDATE SET started_at=excluded.started_at').run(row.id,now());send(res,200,{enabled:true});return true;}
  if(match[2]==='location'){
   if(role!=='captain'||!user.approved)fail(403,'مشاركة الموقع للكابتن المسند فقط');
   if(req.method==='DELETE'){clear(row.id);send(res,200,{ok:true});return true;}
   if(req.method!=='POST')fail(405,'طريقة غير مسموحة');
   if(!activeOrder(row))fail(409,'انتهت الرحلة؛ تم إيقاف مشاركة الموقع');
   const consent=db.prepare('SELECT started_at FROM order_geo_consent WHERE order_id=?').get(row.id);if(!consent)fail(403,'فعّل مشاركة الموقع لهذه الرحلة أولاً');
   const p=validPoint(b),timestamp=b.capturedAt;
   if(typeof b.accuracy!=='number'||!Number.isFinite(b.accuracy)||b.accuracy<0||b.accuracy>500)fail(400,'دقة الموقع ضعيفة؛ انتظر تحديدًا أدق');
   if(!Number.isSafeInteger(timestamp)||timestamp<Math.max(now()-60000,consent.started_at-10000)||timestamp>now()+10000)fail(400,'تحديد الموقع قديم. أعد تشغيل تحديد الموقع');
   const old=db.prepare('SELECT captured_at,received_at FROM order_live_locations WHERE order_id=?').get(row.id);
   if(old&&timestamp<=old.captured_at)fail(409,'تم تجاهل تحديث موقع أقدم');
   if(old&&now()-old.received_at<2000)fail(429,'انتظر قبل تحديث الموقع التالي');
   const fix={...p,accuracy:b.accuracy,capturedAt:timestamp};
   db.prepare('INSERT INTO order_live_locations VALUES(?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET captain_id=excluded.captain_id,payload=excluded.payload,captured_at=excluded.captured_at,received_at=excluded.received_at').run(row.id,user.id,seal(fix),timestamp,now());
   send(res,200,{ok:true,receivedAt:now()});return true;
  }
  if(req.method!=='GET')fail(405,'طريقة غير مسموحة');
  if(!activeOrder(row)){clear(row.id);send(res,200,{status:row.status,stage:'finished',location:null,stale:false,route:data.route||null,pickupPoint:data.pickupPoint||null,destinationPoint:data.destinationPoint||null});return true;}
  const record=db.prepare('SELECT * FROM order_live_locations WHERE order_id=? AND captain_id=?').get(row.id,row.captain_id);
  const location=record?decode(record.payload):null,stale=!!location&&now()-location.capturedAt>45000,stage=row.status==='in_transit'?'destination':'pickup';
  let currentRoute=null,routeError=null;
  if(location&&!stale&&data.pickupPoint&&data.destinationPoint){
   try{const from={lat:Math.round(location.lat*10000)/10000,lng:Math.round(location.lng*10000)/10000};currentRoute=await route(from,stage==='pickup'?data.pickupPoint:data.destinationPoint);}catch{routeError='تعذر تحديث خط الطريق؛ موقع الكابتن ظاهر دون مسار جديد';}
  }else if(!row.captain_id||stage==='destination'){
   currentRoute=data.route||null;
   if(google&&!currentRoute&&data.pickupPoint&&data.destinationPoint){try{currentRoute=await route(data.pickupPoint,data.destinationPoint);}catch{routeError='تعذر تحديث خط الطريق';}}
  }
  send(res,200,{status:row.status,stage,location,stale,serverTime:now(),route:currentRoute,routeError,pickupPoint:data.pickupPoint||null,destinationPoint:data.destinationPoint||null});return true;
 }
 prune();const timer=setInterval(prune,60000);timer.unref();
 return {handlePublic,handlePrivate,geometryQuote,route,clear,clearCaptain,stop:()=>clearInterval(timer)};
}
