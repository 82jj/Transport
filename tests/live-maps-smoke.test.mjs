import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiveMaps} from './live-maps-smoke.mjs';
const quota='وصلت خرائط Google التجريبية إلى حد الاستخدام. حاول لاحقًا.';
function fixture(statuses,headers={}){
 const calls=[],delays=[],logs=[];
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname.split('/').at(-1);calls.push({path,body:options.body});
  if(path==='search'){
   const status=statuses.shift()??200;
   return new Response(JSON.stringify(status===200?{results:[{placeId:'real-result'}]}:{error:quota}),{status,headers});
  }
  const data=path==='config'?{routingReady:true,searchReady:true,provider:'Google',truckCertified:false,backgroundTracking:false}:path==='snap'?{point:{lat:24.7136,lng:46.6753},distanceMeters:0}:path==='route'?{geometry:{type:'LineString',coordinates:[[46,24],[46.1,24.1],[46.2,24.2]]},distanceMeters:800,durationSeconds:100,truckCertified:false}:{};
  return new Response(JSON.stringify(data),{status:['tracking','location'].includes(path)?401:200});
 };
 return {calls,delays,logs,run:()=>verifyLiveMaps('https://example.test',{fetcher,wait:async ms=>delays.push(ms),log:s=>logs.push(s)})};
}
test('transient throttling retries only search with backoff, preserving the session and all real checks',async()=>{
 const f=fixture([429,429,200]);assert.match(await f.run(),/PASS live maps/);
 assert.deepEqual(f.delays,[15000,30000]);assert.deepEqual(f.calls.map(x=>x.path),['config','search','search','search','snap','route','tracking','location']);
 assert.equal(new Set(f.calls.filter(x=>x.path==='search').map(x=>x.body)).size,1);assert.ok(f.logs.every(x=>x.includes('Google demo quota')));
});
test('persistent 429 fails after four attempts with a finite 105s delay budget',async()=>{
 const f=fixture([429,429,429,429]);await assert.rejects(f.run(),/429; Google demo quota; bounded retries exhausted/);
 assert.deepEqual(f.delays,[15000,30000,60000]);assert.equal(f.calls.length,5);assert.ok(!f.calls.some(x=>x.path==='route'));
});
test('Retry-After is respected within budget and longer waits fail without early retry',async()=>{
 const f=fixture([429,200],{'Retry-After':'45'});await f.run();assert.deepEqual(f.delays,[45000]);
 const long=fixture([429],{'Retry-After':'120'});await assert.rejects(long.run(),/Retry-After exceeds 60s/);assert.deepEqual(long.delays,[]);
});
test('permanent HTTP errors never retry or count as success',async()=>{
 for(const status of [400,403,503]){const f=fixture([status]);await assert.rejects(f.run(),/Map endpoint unavailable: search/);assert.deepEqual(f.delays,[]);assert.equal(f.calls.length,2);}
});
