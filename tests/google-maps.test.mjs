import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createMaps} from '../apps/api/maps.mjs';
const serverKey='server-test-key-never-public',browserKey='browser-test-key',token='12345678-1234-1234-1234-123456789abc',a={lat:24.7136,lng:46.6753},b={lat:24.7301,lng:46.7001};
function setup(extra={}){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT);');let output;const calls=[];
 const fetcher=async(url,options)=>{calls.push({url:String(url),options});const u=new URL(url);let data;
  if(u.pathname.endsWith(':autocomplete'))data={suggestions:[{placePrediction:{placeId:'test-place',text:{text:'مكان اختبار، الرياض'}}}]};
  else if(u.pathname==='/v1/places/test-place')data={location:{latitude:a.lat,longitude:a.lng},formattedAddress:'عنوان اختبار'};
  else if(u.pathname.endsWith('/geocode/json'))data={status:'OK',results:[{formatted_address:'شارع الاختبار',geometry:{location:{lat:24.9,lng:46.9}}}]};
  else if(u.pathname.endsWith(':computeRoutes'))data={routes:[{distanceMeters:8200,duration:'600s',polyline:{geoJsonLinestring:{type:'LineString',coordinates:[[a.lng,a.lat],[46.69,24.72],[b.lng,b.lat]]}}}]};
  else throw new Error('Unexpected endpoint');
  return {ok:true,status:200,json:async()=>data};
 };
 const env={MAPS_PROVIDER:'google',GOOGLE_MAPS_API_KEY:serverKey,GOOGLE_MAPS_BROWSER_KEY:browserKey,...extra.env};
 try{const maps=createMaps(db,{send:(res,status,body)=>{output={status,body};},seal:x=>x,decode:x=>x,env,fetcher:extra.fetcher||fetcher});return {maps,calls,call:async(path,body={},method='POST')=>{await maps.handlePublic({method,socket:{remoteAddress:'test'}},null,'/api/maps/'+path,body);return output;},close:()=>{maps.stop();db.close();}};}catch(e){db.close();throw e;}
}
test('Google configuration exposes only a separate browser key; an incomplete setup fails closed',async()=>{
 for(const env of [{GOOGLE_MAPS_BROWSER_KEY:''},{GOOGLE_MAPS_API_KEY:''},{GOOGLE_MAPS_BROWSER_KEY:serverKey}])assert.throws(()=>setup({env}),/separate server and browser keys/);
 const f=setup();try{const c=await f.call('config',{},'GET');assert.equal(c.body.provider,'Google');assert.equal(c.body.browserKey,browserKey);assert.equal(JSON.stringify(c).includes(serverKey),false);assert.equal(f.calls.length,0);}finally{f.close();}
});
test('Google autocomplete carries one session into place details and resolves coordinates only on selection',async()=>{
 const f=setup();try{
  const result=await f.call('search',{query:'الرياض',sessionToken:token});const place=result.body.results[0];assert.equal(place.placeId,'test-place');assert.equal(place.lat,undefined);
  const resolved=await f.call('snap',{placeId:place.placeId,sessionToken:place.sessionToken});assert.deepEqual(resolved.body.point,a);
  assert.equal(JSON.parse(f.calls[0].options.body).sessionToken,token);assert.equal(new URL(f.calls[1].url).searchParams.get('sessionToken'),token);
  assert.equal(JSON.parse(f.calls[0].options.body).languageCode,'ar');assert.deepEqual(JSON.parse(f.calls[0].options.body).includedRegionCodes,['sa']);
  assert.equal(f.calls[1].options.headers['X-Goog-FieldMask'],'location,formattedAddress');assert.ok(f.calls.every(c=>c.options.headers['X-Goog-Api-Key']===serverKey));
  await assert.rejects(()=>f.call('snap',{placeId:'../config',sessionToken:token}),{status:400});await assert.rejects(()=>f.call('search',{query:'الرياض',sessionToken:'invalid'}),{status:400});
 }finally{f.close();}
});
test('Google reverse lookup preserves the chosen entrance and Routes computes quote distance on the server',async()=>{
 const f=setup();try{
  const snap=await f.call('snap',{point:a});assert.deepEqual(snap.body.point,a);assert.equal(snap.body.distanceMeters,0);assert.equal(new URL(f.calls[0].url).searchParams.get('key'),serverKey);
  const quote=await f.maps.geometryQuote({pickupPoint:a,destinationPoint:b,distanceKm:1});assert.equal(quote.distanceKm,8.2);assert.equal(quote.route.provider,'Google');assert.equal(quote.route.geometry.type,'LineString');assert.equal(quote.route.truckCertified,false);
  const sent=JSON.parse(f.calls[1].options.body);assert.equal(sent.travelMode,'DRIVE');assert.equal(sent.polylineEncoding,'GEO_JSON_LINESTRING');assert.equal(f.calls[1].options.headers['X-Goog-FieldMask'],'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring');
 }finally{f.close();}
});
test('Google upstream failures do not leak credentials or silently switch providers',async()=>{
 const f=setup({fetcher:async()=>({ok:false,status:403,json:async()=>({error:{message:serverKey}})})});try{await assert.rejects(()=>f.call('search',{query:'الرياض',sessionToken:token}),e=>e.status===503&&!e.message.includes(serverKey));}finally{f.close();}
 const malformed=setup({fetcher:async()=>({ok:true,status:200,json:async()=>({routes:[{distanceMeters:5,duration:'no-duration',polyline:{geoJsonLinestring:{type:'LineString',coordinates:[[46,24],[47,25]]}}}]})})});try{await assert.rejects(()=>malformed.maps.route(a,b),{status:502});}finally{malformed.close();}
});
