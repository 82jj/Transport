import assert from 'node:assert/strict';
// Fixed, non-personal coordinates. These POST endpoints compute results only;
// no production user, captain, trip, consent or GPS record is ever created.
export async function verifyLiveMaps(base){
 const invoke=async(path,body)=>{
  const r=await fetch(base+'/api/maps/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal(r.status,200,'Map endpoint unavailable: '+path);
  const text=await r.text();assert.doesNotMatch(text,/AIza[\w-]{30,}/,'A server API key leaked into a map response');return JSON.parse(text);
 };
 const config=await invoke('config');assert.equal(config.routingReady,true);assert.equal(config.searchReady,true);assert.equal(config.provider,'OpenStreetMap');assert.equal(config.truckCertified,false);assert.equal(config.backgroundTracking,false);
 const search=await invoke('search',{query:'الرياض'});assert.ok(search.results.length,'Arabic place search returned no results');
 const snap=await invoke('snap',{point:{lat:24.7136,lng:46.6753}});assert.ok(snap.distanceMeters>=0&&snap.distanceMeters<=250);
 const route=await invoke('route',{from:snap.point,to:{lat:24.711,lng:46.681}});assert.equal(route.geometry.type,'LineString');assert.ok(route.geometry.coordinates.length>2);assert.ok(route.distanceMeters>100);assert.ok(route.durationSeconds>0);assert.equal(route.truckCertified,false);
 for(const path of ['/api/user/orders/not-a-real-order/tracking','/api/captain/orders/not-a-real-order/location']){
  const r=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000)});assert.equal(r.status,401,path);
 }
 return 'PASS live maps: real Arabic search, nearest road, road route/time, no leaked server key and private tracking requires authentication';
}
