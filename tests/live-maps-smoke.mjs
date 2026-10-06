import assert from 'node:assert/strict';
// Fixed, non-personal coordinates. These POST endpoints compute results only;
// no production user, captain, trip, consent or GPS record is ever created.
export async function verifyLiveMaps(base,{fetcher=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log}={}){
 // Retry only throttled requests, never the complete suite. A persistent quota
 // failure must not receive a fresh retry budget from deployment polling.
 const delays=[15000,30000,60000];
 const invoke=async(path,body)=>{
  let r;
  for(let attempt=0;;attempt++){
   r=await fetcher(base+'/api/maps/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
   if(r.status!==429)break;
   // Emit only known classifications, never raw provider text or credentials.
   const data=await r.json().catch(()=>({}));
   const source=data.error==='وصلت خرائط Google التجريبية إلى حد الاستخدام. حاول لاحقًا.'?'Google demo quota':data.error==='طلبات خرائط كثيرة. انتظر قليلًا.'?'application map limiter':'unclassified rate limit';
   const retryAfter=r.headers.get('retry-after');
   const seconds=retryAfter&&/^\d+$/.test(retryAfter)?Number(retryAfter):null;
   const date=retryAfter&&seconds===null?Date.parse(retryAfter):NaN;
   const requested=seconds!==null?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):0;
   const delay=Math.max(delays[attempt]||0,requested);
   if(attempt>=delays.length||delay>60000)throw new Error(`Map endpoint unavailable: ${path} (429; ${source}; bounded retries exhausted or Retry-After exceeds 60s)`);
   log(`Map ${path}: 429 (${source}); retry ${attempt+1}/${delays.length} in ${delay/1000}s`);
   await wait(delay);
  }
  assert.equal(r.status,200,'Map endpoint unavailable: '+path);
  const text=await r.text();const data=JSON.parse(text);const safe={...data};if(path==='config')delete safe.browserKey;assert.doesNotMatch(JSON.stringify(safe),/AIza[\w-]{30,}/,'A server API key leaked into a map response');return data;
 };
 const config=await invoke('config');assert.equal(config.routingReady,true);assert.equal(config.searchReady,true);assert.ok(['Google','OpenStreetMap'].includes(config.provider));assert.equal(config.truckCertified,false);assert.equal(config.backgroundTracking,false);
 const search=await invoke('search',{query:'الرياض',sessionToken:crypto.randomUUID()});assert.ok(search.results.length,'Arabic place search returned no results');
 const snap=await invoke('snap',{point:{lat:24.7136,lng:46.6753}});assert.ok(snap.distanceMeters>=0&&snap.distanceMeters<=250);
 const route=await invoke('route',{from:snap.point,to:{lat:24.711,lng:46.681}});assert.equal(route.geometry.type,'LineString');assert.ok(route.geometry.coordinates.length>2);assert.ok(route.distanceMeters>100);assert.ok(route.durationSeconds>0);assert.equal(route.truckCertified,false);
 for(const path of ['/api/user/orders/not-a-real-order/tracking','/api/captain/orders/not-a-real-order/location']){
 const r=await fetcher(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000)});assert.equal(r.status,401,path);
 }
 return `PASS live maps (${config.provider}): Arabic search, chosen point, road route/time, no leaked server key and private tracking requires authentication`;
}
