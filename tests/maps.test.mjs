import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMaps,validPoint} from '../apps/api/maps.mjs';
import {createOnboarding} from '../apps/api/onboarding.mjs';
const a={lat:24.7136,lng:46.6753},b={lat:24.7301,lng:46.7001};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT,hash TEXT,role TEXT,approved INTEGER);CREATE TABLE orders(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),captain_id TEXT REFERENCES users(id),status TEXT,data TEXT,created_at TEXT);INSERT INTO users VALUES('u','U','u@example.test','','user',1),('c','C','c@example.test','','captain',1),('other','Other','o@example.test','','user',1),('other-c','Other C','oc@example.test','','captain',1);");
 const source=createOnboarding(db,{send:()=>{},passwordHash:()=>'',validPassword:()=>true,env:{NODE_ENV:'test'}});let time=Date.now(),output,requests=[];
 const data={pickupPoint:a,destinationPoint:b,category:'light'};db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)').run('o','u','c','accepted',JSON.stringify(data),new Date().toISOString());
 const fetcher=async url=>{requests.push(String(url));const x=new URL(url);const params=x.searchParams;return {ok:true,status:200,json:async()=>x.pathname==='/healthz'?{ok:true,dataDate:'2026-09-01'}:x.pathname==='/search'?{results:[{id:'n1',label:'شارع اختبار',...a}]}:x.pathname==='/nearest'?{point:a,distanceMeters:15,road:'طريق اختبار'}:{distanceMeters:8300,durationSeconds:900,geometry:{type:'LineString',coordinates:[[Number(params.get('from_lng')),Number(params.get('from_lat'))],[b.lng,b.lat]]},waypoints:[a,b],dataDate:'2026-09-01'}};};
 const maps=createMaps(db,{send:(res,status,body)=>{output={status,body};},seal:source.seal,decode:source.decode,fetcher,env:{MAPS_ORIGIN:'http://private-map:8080'},now:()=>time});
 return {db,maps,requests,get output(){return output;},advance:n=>time+=n,get time(){return time;},close:()=>{maps.stop();db.close();},public:async(path,body,method='POST')=>{await maps.handlePublic({method,socket:{remoteAddress:'test'}},null,'/api/maps/'+path,body);return output;},private:async(role,id,operation,body={},method='GET')=>{await maps.handlePrivate({method},null,role,'orders/o/'+operation,{id,approved:1},body);return output;}};
}
test('maps use private service, validate points, cache geocoding and compute distances on server',async()=>{const f=fixture();try{
 for(const point of [null,{}, {lat:'24',lng:46},{lat:NaN,lng:46},{lat:90,lng:46}])assert.throws(()=>validPoint(point));
 assert.equal((await f.public('config',{},'GET')).body.routingReady,true);
 await f.public('search',{query:'الرياض'});await f.public('search',{query:'الرياض'});assert.equal(f.requests.filter(p=>p.includes('/search')).length,1);
 assert.equal((await f.public('snap',{point:a})).body.distanceMeters,15);
 const geo=await f.maps.geometryQuote({pickupPoint:a,destinationPoint:b,distanceKm:1});assert.equal(geo.distanceKm,8.3);assert.equal(geo.route.truckCertified,false);
 assert.ok(f.requests.every(p=>p.startsWith('http://private-map:8080/')));
 await assert.rejects(()=>f.maps.geometryQuote({pickupPoint:a}),{status:400});
}finally{f.close();}});
test('only assigned captain can share; other users cannot read; consent, stale fixes and stop enforced',async()=>{const f=fixture();try{
 const fix={...a,accuracy:12,capturedAt:f.time};
 await assert.rejects(()=>f.private('user','other','tracking'),{status:404});
 await assert.rejects(()=>f.private('captain','other-c','location-sharing',{},'POST'),{status:404});
 await assert.rejects(()=>f.private('captain','c','location',fix,'POST'),{status:403});
 await f.private('captain','c','location-sharing',{},'POST');
 await assert.rejects(()=>f.private('captain','c','location',{...fix,accuracy:501},'POST'),{status:400});
 await assert.rejects(()=>f.private('captain','c','location',{...fix,capturedAt:f.time-61000},'POST'),{status:400});
 await assert.rejects(()=>f.private('captain','c','location',{...fix,capturedAt:f.time+11000},'POST'),{status:400});
 await f.private('captain','c','location',fix,'POST');
 const record=f.db.prepare('SELECT payload FROM order_live_locations').get();assert.equal(Buffer.from(record.payload).includes(Buffer.from(String(a.lat))),false);
 const tracking=(await f.private('user','u','tracking')).body;assert.equal(tracking.location.lat,a.lat);assert.equal(tracking.stale,false);assert.equal(tracking.stage,'pickup');
 f.advance(46000);const stale=(await f.private('user','u','tracking')).body;assert.equal(stale.stale,true);assert.equal(stale.route,null);
 await f.private('captain','c','location',{},'DELETE');assert.equal((await f.private('user','u','tracking')).body.location,null);
 await assert.rejects(()=>f.private('captain','c','location',{...fix,capturedAt:f.time},'POST'),{status:403});
}finally{f.close();}});
test('route switches to destination after start and completion removes live location',async()=>{const f=fixture();try{
 await f.private('captain','c','location-sharing',{},'POST');await f.private('captain','c','location',{...a,accuracy:5,capturedAt:f.time},'POST');
 await f.private('user','u','tracking');assert.ok(f.requests.at(-1).includes('to_lat='+a.lat));
 f.db.prepare("UPDATE orders SET status='in_transit' WHERE id='o'").run();const route=(await f.private('user','u','tracking')).body;assert.equal(route.stage,'destination');assert.ok(f.requests.at(-1).includes('to_lat='+b.lat));
 f.db.prepare("UPDATE orders SET status='delivered' WHERE id='o'").run();assert.equal((await f.private('user','u','tracking')).body.location,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM order_live_locations').get().n,0);
 await assert.rejects(()=>f.private('captain','c','location-sharing',{},'POST'),{status:403});
}finally{f.close();}});
