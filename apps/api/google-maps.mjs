// Server credentials never appear in public configuration or upstream error messages.
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function createGoogleMaps({env,fetcher,validPoint,demo=false}){
 // Demo requests use only the explicitly public demo credential, never the server secret.
 const key=demo?env.GOOGLE_MAPS_BROWSER_KEY:env.GOOGLE_MAPS_API_KEY;
 if(!key||!env.GOOGLE_MAPS_BROWSER_KEY||!demo&&key===env.GOOGLE_MAPS_BROWSER_KEY)throw new Error('Google Maps requires separate server and browser keys (or a configured public demo key in google-demo mode)');
 const sessionToken=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,36}$/.test(value))fail(400,'أعد البحث عن المكان');
  return value;
 };
 async function request(url,{body,fields}={}){
  try{
   const response=await fetcher(url,{method:body?'POST':'GET',headers:{'X-Goog-Api-Key':key,...(body?{'Content-Type':'application/json'}:{}),...(fields?{'X-Goog-FieldMask':fields}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});
   const data=await response.json();
   if(demo&&response.status===429)fail(429,'وصلت خرائط Google التجريبية إلى حد الاستخدام. حاول لاحقًا.');
   if(!response.ok||data.error||data.status&& !['OK','ZERO_RESULTS'].includes(data.status))fail(503,'تعذر الاتصال بخرائط Google. تحقق من إعدادات الخدمة أو حاول مجددًا.');
   return data;
  }catch(e){if(e.status)throw e;fail(503,'تعذر الاتصال بخرائط Google. حاول مجددًا.');}
 }
 async function search(query,token){
  token=sessionToken(token);
  const data=await request('https://places.googleapis.com/v1/places:autocomplete',{body:{input:query,sessionToken:token,languageCode:'ar',includedRegionCodes:['sa']},fields:'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text'});
  return (data.suggestions||[]).filter(x=>x.placePrediction?.placeId&&x.placePrediction.text?.text).slice(0,5).map(({placePrediction:p})=>({id:p.placeId,placeId:p.placeId,label:p.text.text.slice(0,300),sessionToken:token,provider:'Google'}));
 }
 async function snap(body){
  if(body.placeId!==undefined){
   if(typeof body.placeId!=='string'||!body.placeId||body.placeId.length>256||! /^[A-Za-z0-9_-]+$/.test(body.placeId))fail(400,'اختر مكانًا صحيحًا من نتائج البحث');
   const token=sessionToken(body.sessionToken);
   const data=await request('https://places.googleapis.com/v1/places/'+encodeURIComponent(body.placeId)+'?'+new URLSearchParams({languageCode:'ar',sessionToken:token}),{fields:'location,formattedAddress'});
   return {point:validPoint({lat:data.location?.latitude,lng:data.location?.longitude}),distanceMeters:0,road:String(data.formattedAddress||'موقع محدد على الخريطة').slice(0,200),provider:'Google'};
  }
  // Reverse geocoding describes the chosen pin; it does not move the user's entrance.
  const point=validPoint(body.point);
  const data=demo?await request(`https://geocode.googleapis.com/v4/geocode/location/${point.lat},${point.lng}?languageCode=ar`,{fields:'results.formattedAddress'}):await request('https://maps.googleapis.com/maps/api/geocode/json?'+new URLSearchParams({latlng:`${point.lat},${point.lng}`,language:'ar',key}));
  return {point,distanceMeters:0,road:String((demo?data.results?.[0]?.formattedAddress:data.results?.[0]?.formatted_address)||'موقع محدد على الخريطة').slice(0,200),provider:'Google'};
 }
 async function route(from,to){
  from=validPoint(from);to=validPoint(to);
  const waypoint=p=>({location:{latLng:{latitude:p.lat,longitude:p.lng}}});
  const data=await request('https://routes.googleapis.com/directions/v2:computeRoutes',{body:{origin:waypoint(from),destination:waypoint(to),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false,languageCode:'ar',units:'METRIC',polylineEncoding:'GEO_JSON_LINESTRING'},fields:'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring'});
  const r=data.routes?.[0];if(!r)fail(422,'لا يوجد مسار متاح بين هذين الموقعين');
  return {distanceMeters:r.distanceMeters,durationSeconds:Number(String(r.duration).replace(/s$/,'')),geometry:r.polyline?.geoJsonLinestring,waypoints:[from,to],provider:'Google'};
 }
 return {search,snap,route};
}
