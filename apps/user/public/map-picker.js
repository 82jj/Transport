import {MapView} from './maps.js';
export const pointLabel=p=>p?'موقع محدد على الخريطة':'';
const pin='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
export function locationFields(d,esc){
 return `<div class="location-form itinerary-form">${[['pickup','نقطة الالتقاء','مكان الالتقاء'],['destination','الوجهة','إلى أين؟']].map(([field,title,hint])=>`<div class="location-field" data-location="${field}"><label for="${field}" class="visually-hidden">${title}</label><div class="location-input-row"><i class="location-dot ${field}" aria-hidden="true"></i><input id="${field}" name="${field}" value="${esc(d[field])}" placeholder="${hint}" autocomplete="off" maxlength="120" required aria-describedby="${field}-search-status" aria-controls="${field}-results" aria-expanded="false"><button type="button" class="map-select" id="select-${field}" aria-label="${field==='pickup'?'تحديد الالتقاء':'تحديد الوجهة'} على الخريطة">${pin}</button></div><p class="search-status" id="${field}-search-status" role="status" aria-live="polite"></p></div>`).join('')}<button type="button" class="text-button current-location" id="auto-pickup">⌖ <span>استخدام موقعي الحالي للالتقاء</span></button>${['pickup','destination'].map(field=>`<div class="location-results" id="${field}-results" hidden></div>`).join('')}</div><section class="request-map-panel"><div class="real-map" id="request-map" role="region" aria-label="تحديد الالتقاء والوجهة على الخريطة" tabindex="0" aria-describedby="request-map-hint"></div><p class="map-help map-hint" id="request-map-hint"></p><p class="map-help" id="request-route-status" role="status">جاري تحميل الخريطة…</p></section><input name="distance" type="hidden" value="${d.distanceKm||0}">`;
}
function bindSearch({input,results,status,api,onSelect,onEdit=()=>{},button,initialSearch=false}){
 let dead=false,seq=0,timer,places=[],active=-1,sessionToken=crypto.randomUUID();
 function clear(){places=[];active=-1;results.replaceChildren();results.hidden=true;input.setAttribute('aria-expanded','false');}
 async function search(){
  clearTimeout(timer);const query=input.value.trim(),token=++seq;clear();
  if(query.length<2){status.textContent='';return;}
  status.textContent='جاري البحث…';if(button)button.disabled=true;
  try{const d=await api('/api/maps/search',{method:'POST',body:JSON.stringify({query,sessionToken})});if(dead||token!==seq||input.value.trim()!==query)return;
   places=d.results||[];status.textContent=places.length?'':'لم نجد هذا المكان. جرّب اسم شارع أو حي، أو اختره على الخريطة.';
   for(const place of places){const b=document.createElement('button');b.type='button';b.className='place-result';const title=document.createElement('b'),detail=document.createElement('small');const [name,...rest]=place.label.split('،');title.textContent=name;detail.textContent=rest.join('،')||'اختيار هذا المكان';b.append(title,detail);b.onclick=()=>select(place);results.append(b);}
   if(places.some(p=>p.provider==='Google')){const credit=document.createElement('small');credit.className='maps-attribution';credit.translate=false;credit.textContent='Google Maps';results.append(credit);}
   results.hidden=!places.length;input.setAttribute('aria-expanded',String(!!places.length));
  }catch(e){if(!dead&&token===seq)status.textContent=e.message;}finally{if(button&&!dead&&token===seq)button.disabled=false;}
 }
 async function select(place){
  const token=++seq;clearTimeout(timer);status.textContent='جاري تحديد المكان…';for(const b of results.querySelectorAll('button'))b.disabled=true;
  const current=()=>!dead&&seq===token;
  try{await onSelect(place,current);if(current()){input.value=place.label;clear();status.textContent='';sessionToken=crypto.randomUUID();}}
  catch(e){if(current()){status.textContent=e.message;for(const b of results.querySelectorAll('button'))b.disabled=false;}}
 }
 input.addEventListener('input',()=>{seq++;clear();onEdit();status.textContent='';if(button)button.disabled=false;clearTimeout(timer);timer=setTimeout(search,350);});
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){seq++;clearTimeout(timer);clear();if(button)button.disabled=false;return;}
  if(['ArrowDown','ArrowUp'].includes(e.key)&&places.length){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+places.length)%places.length;[...results.children].forEach((b,i)=>b.classList.toggle('highlighted',i===active));results.children[active].scrollIntoView({block:'nearest'});}
  if(e.key==='Enter'){e.preventDefault();if(active>=0&&places[active])select(places[active]);else search();}
 });
 if(button)button.onclick=search;
 if(initialSearch&&input.value.trim().length>=2)timer=setTimeout(search,350);
 const cancel=()=>{seq++;clearTimeout(timer);clear();status.textContent='';sessionToken=crypto.randomUUID();if(button)button.disabled=false;};
 const stop=()=>{dead=true;cancel();};stop.cancel=cancel;return stop;
}
export function bindLocationFields({draft,api,onChange,toast}){
 const el=document.querySelector('#request-map'),map=el?new MapView(el,api):null;
 let dead=false,open=null,mapRevision=0,active='destination';const searches={},versions={pickup:0,destination:0},pending=new Set();
 const title=field=>field==='pickup'?'الالتقاء':'الوجهة';
 const target=()=>!draft.pickupPoint?'pickup':!draft.destinationPoint?'destination':active;
 function changed(invalidate=true){
  const field=target();el.dataset.selectionTarget=field;
  document.querySelector('#request-map-hint').textContent=`اضغط مطولًا على الخريطة لتحديد ${title(field)}. اضغط مطولًا على الدبوس لإلغائه.`;
  if(invalidate){document.querySelector('[name=distance]').value=0;onChange({pending:pending.size>0});}
 }
 async function refreshMap(refit=false,preview={}){
  if(!map)return;
  const revision=++mapRevision,status=document.querySelector('#request-route-status');
  const points={pickupPoint:draft.pickupPoint,destinationPoint:draft.destinationPoint,...preview};
  const ready=!!(draft.pickupPoint&&draft.destinationPoint)&&!pending.size;
  status.textContent=pending.size?'جاري تحديد المكان…':ready?'جاري عرض المسار…':points.pickupPoint?'نقطة الالتقاء محددة؛ اختر الوجهة لعرض المسار.':points.destinationPoint?'الوجهة محددة؛ اختر نقطة الالتقاء لعرض المسار.':'اختر نقطة الالتقاء والوجهة من البحث أو بالضغط المطول على الخريطة.';
  try{
   await map.draw({...points,refit,interactivePins:true});
   if(dead||revision!==mapRevision||!ready)return;
   const route=await api('/api/maps/route',{method:'POST',body:JSON.stringify({from:points.pickupPoint,to:points.destinationPoint})});
   if(dead||revision!==mapRevision)return;
   await map.draw({...points,route,refit,interactivePins:true});
   if(!dead&&revision===mapRevision)status.textContent=`${Math.max(1,Math.round(route.durationSeconds/60))} دقيقة · ${(route.distanceMeters/1000).toFixed(1)} كم`;
  }catch(e){if(!dead&&revision===mapRevision)status.textContent=e.message;}
 }
 function setPoint(field,point,label,refit=false){
  searches[field]?.cancel();pending.delete(field);draft[field+'Point']=point;draft[field]=label;draft.distanceKm=0;
  document.querySelector('#'+field).value=label;active=field;changed();refreshMap(refit);
 }
 async function manual({field,point}){
  if(dead)return;
  if(field){versions[field]++;setPoint(field,null,'');return;}
  field=target();const version=++versions[field];searches[field]?.cancel();
  if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||point.lat<16||point.lat>33||point.lng<34||point.lng>56){toast('حدد موقعًا داخل نطاق الخدمة');return;}
  point={lat:Number(point.lat.toFixed(6)),lng:Number(point.lng.toFixed(6))};
  const google=map.config?.provider==='Google',current=()=>!dead&&versions[field]===version;
  // Google reverse geocoding names the entrance, without moving the chosen pin.
  // A name lookup failure must not block a real point chosen on the map.
  if(google)setPoint(field,point,field==='pickup'?'نقطة الالتقاء على الخريطة':'الوجهة على الخريطة');
  else{pending.add(field);changed();refreshMap(false,{[field+'Point']:point});}
  try{
   const d=await api('/api/maps/snap',{method:'POST',body:JSON.stringify({point})});if(!current())return;
   if(google){draft[field]=d.road||draft[field];document.querySelector('#'+field).value=draft[field];changed();}
   else setPoint(field,d.point,d.road||pointLabel(d.point));
  }catch(e){if(!current())return;if(!google){pending.delete(field);changed();refreshMap();}toast(google?'تم تثبيت الدبوس؛ تعذر جلب اسم المكان.':e.message);}
 }
 function gps(){open?.close();const version=++versions.pickup;searches.pickup.cancel();if(pending.delete('pickup')){changed();refreshMap();}open=openPicker({api,point:draft.pickupPoint,label:draft.pickup,auto:true,title:'نقطة الالتقاء',onChoose:(point,label)=>{if(!dead&&versions.pickup===version)setPoint('pickup',point,label,true);}});}
 for(const field of ['pickup','destination']){
  searches[field]=bindSearch({input:document.querySelector('#'+field),results:document.querySelector('#'+field+'-results'),status:document.querySelector('#'+field+'-search-status'),api,initialSearch:!draft[field+'Point'],onSelect:async(place,current)=>{
   const version=++versions[field],d=await api('/api/maps/snap',{method:'POST',body:JSON.stringify(place.placeId?{placeId:place.placeId,sessionToken:place.sessionToken}:{point:{lat:place.lat,lng:place.lng}})});
   if(!current()||dead||version!==versions[field])return;setPoint(field,d.point,place.label,true);
  },onEdit:()=>{versions[field]++;pending.delete(field);draft[field+'Point']=null;draft.distanceKm=0;changed();refreshMap();}});
  document.querySelector('#select-'+field).onclick=()=>{active=field;changed(false);el.scrollIntoView({behavior:'smooth',block:'center'});el.focus({preventScroll:true});};
 }
 document.querySelector('#auto-pickup').onclick=gps;
 map?.enableLongPress(manual);changed(false);refreshMap();
 return ()=>{dead=true;Object.values(searches).forEach(stop=>stop());map?.destroy();open?.close();};
}
export function openPicker({api,point,label:initialLabel='',auto=false,title,onChoose}){
 const dialog=document.createElement('dialog');dialog.className='map-picker';dialog.dataset.mode='map';
 const confirmation=title==='الوجهة'?'تأكيد الوجهة':'تأكيد موقع الالتقاء';
 dialog.innerHTML=`<div class="picker-header"><button class="close" type="button" aria-label="إغلاق">‹</button><h2>حدد ${title}</h2><button type="button" class="picker-edit" id="edit-place" aria-label="البحث عن عنوان"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button></div><form id="place-search"><label for="place-query" class="visually-hidden">ابحث عن اسم المكان أو الشارع</label><div class="picker-search-row"><input id="place-query" minlength="2" maxlength="120" placeholder="ابحث عن مكان أو عنوان" autocomplete="off" aria-controls="place-results" aria-expanded="false"><button type="button" aria-label="بحث">بحث</button></div></form><div id="place-results" class="location-results" hidden></div><p id="place-search-status" class="search-status" role="status" aria-live="polite"></p><button type="button" class="picker-map-return" id="back-to-map">اختيار الموقع على الخريطة</button><div class="picker-map-wrap"><div class="real-map" id="picker-map" role="region" aria-label="حرّك الخريطة لاختيار الموقع"></div><span class="map-crosshair" aria-hidden="true">${pin}</span><span class="picker-map-tip">حرّك الخريطة لتحديد المكان</span><button type="button" id="gps-pick" aria-label="تحديد موقعي تلقائيًا">⌖</button></div><div class="picker-bottom"><small>${title}</small><b id="picked-name"></b><p id="pick-status" class="map-help" role="status">جاري تحميل الخريطة…</p><button type="button" class="primary" id="pick-confirm" disabled>${confirmation}</button></div>`;
 document.body.append(dialog);dialog.showModal();let dead=false,revision=0,snapped=null,label=initialLabel,candidate=null,lastCenter=null,movingByCode=false,timer;
 const map=new MapView(dialog.querySelector('#picker-map'),api,{center:point,zoom:point?17:15}),status=dialog.querySelector('#pick-status'),confirm=dialog.querySelector('#pick-confirm'),name=dialog.querySelector('#picked-name');
 function mode(value){dialog.dataset.mode=value;dialog.querySelector('.close').setAttribute('aria-label',value==='map'?'إغلاق':'رجوع للخريطة');if(value==='map'){dialog.querySelector('#place-query').blur();map.map?.invalidateSize({animate:false});}else dialog.querySelector('#place-query').focus();}
 async function snap(p,text=''){
  clearTimeout(timer);const rev=++revision;candidate=p;snapped=null;label=text;name.textContent=text||'المكان عند العلامة';confirm.disabled=true;confirm.textContent=confirmation;status.textContent='جاري تحديد نقطة الوصول…';
  try{const d=await api('/api/maps/snap',{method:'POST',body:JSON.stringify({point:p})});if(dead||rev!==revision)return;snapped=d.point;lastCenter=snapped;label=text||d.road||'موقع محدد على الخريطة';name.textContent=label;movingByCode=true;map.map.setView([snapped.lat,snapped.lng],map.map.getZoom(),{animate:false});movingByCode=false;status.textContent='تأكد أن العلامة عند المدخل المناسب.';confirm.disabled=false;}
  catch(e){if(!dead&&rev===revision){status.textContent=e.message;confirm.textContent='إعادة المحاولة';confirm.disabled=false;}}
 }
 const invalidate=()=>{if(movingByCode)return;const p=map.map.getCenter();if(lastCenter&&map.map.distance([lastCenter.lat,lastCenter.lng],[p.lat,p.lng])<1)return;revision++;snapped=null;confirm.disabled=true;name.textContent='المكان عند العلامة';status.textContent='جاري تحديد نقطة الوصول…';candidate={lat:p.lat,lng:p.lng};lastCenter=candidate;clearTimeout(timer);timer=setTimeout(()=>snap(candidate),300);};
 const setView=(p,text='',resolved=false)=>{movingByCode=true;lastCenter=p;map.map.setView([p.lat,p.lng],17,{animate:false});movingByCode=false;mode('map');if(resolved){clearTimeout(timer);revision++;candidate=p;snapped=p;label=text;name.textContent=text;status.textContent='تأكد أن العلامة عند المدخل المناسب.';confirm.textContent=confirmation;confirm.disabled=false;return;}return snap(p,text);};
 async function locate(){
  if(!navigator.geolocation){status.textContent='اختر المكان يدويًا؛ تحديد الموقع غير مدعوم.';return;}
  const rev=++revision;confirm.disabled=true;snapped=null;status.textContent='جاري تحديد موقعك…';
  navigator.geolocation.getCurrentPosition(p=>{if(dead||rev!==revision)return;if(p.coords.accuracy>500){status.textContent='دقة الموقع ضعيفة. حرّك الخريطة لتحديد المدخل.';confirm.textContent='إعادة المحاولة';confirm.disabled=false;return;}setView({lat:p.coords.latitude,lng:p.coords.longitude},'موقعي الحالي');},e=>{if(dead||rev!==revision)return;status.textContent=e.code===1?'لم يُسمح بالموقع. يمكنك اختيار المكان على الخريطة.':'تعذر تحديد موقعك. يمكنك اختيار المكان على الخريطة.';confirm.textContent='إعادة المحاولة';confirm.disabled=false;},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
 }
 const stopSearch=bindSearch({input:dialog.querySelector('#place-query'),results:dialog.querySelector('#place-results'),status:dialog.querySelector('#place-search-status'),api,onSelect:async(place,current)=>{await map.ready;if(!current())return;let p={lat:place.lat,lng:place.lng};if(place.placeId){const d=await api('/api/maps/snap',{method:'POST',body:JSON.stringify({placeId:place.placeId,sessionToken:place.sessionToken})});if(!current())return;p=d.point;}await setView(p,place.label,!!place.placeId);},button:dialog.querySelector('#place-search button')});
 dialog.querySelector('#place-search').onsubmit=e=>{e.preventDefault();dialog.querySelector('#place-search button').click();};
 dialog.querySelector('#edit-place').onclick=()=>mode('search');dialog.querySelector('#back-to-map').onclick=()=>mode('map');
 map.ready.then(()=>{if(dead)return;map.map.on('moveend',invalidate);map.map.on('click',e=>setView({lat:e.latlng.lat,lng:e.latlng.lng}));const p=map.map.getCenter();candidate={lat:p.lat,lng:p.lng};lastCenter=candidate;if(auto)locate();else snap(candidate,initialLabel);}).catch(e=>{status.textContent=e.message;});
 dialog.querySelector('#gps-pick').onclick=()=>map.ready.then(locate).catch(e=>{status.textContent=e.message;});
 confirm.onclick=()=>{if(!candidate||confirm.disabled)return;if(!snapped){snap(candidate,label);return;}const p=snapped,text=label;dialog.close();onChoose(p,text);};
 dialog.querySelector('.close').onclick=()=>{if(dialog.dataset.mode==='search')mode('map');else dialog.close();};
 dialog.addEventListener('close',()=>{dead=true;revision++;clearTimeout(timer);stopSearch();map.destroy();dialog.remove();},{once:true});return dialog;
}
