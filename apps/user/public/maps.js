import {loadGoogleMaps,GoogleMapView} from './google-map.js';
// Shared rendering utility; each independent frontend ships its own copy.
let library,configPromise;
export async function mapConfig(api){if(!configPromise)configPromise=api('/api/maps/config').catch(e=>{configPromise=null;throw e;});return configPromise;}
export function loadLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(!library)library=new Promise((resolve,reject)=>{
  let cssReady=false,jsReady=false;const done=()=>{if(cssReady&&jsReady)resolve(window.L);};
  const fail=()=>{script.remove();css.remove();library=null;reject(new Error('تعذر تحميل الخريطة. تحقق من الإنترنت ثم أعد المحاولة.'));};
  const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='anonymous';css.onload=()=>{cssReady=true;done();};css.onerror=fail;
  const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';script.crossOrigin='anonymous';script.onload=()=>{jsReady=true;done();};script.onerror=fail;document.head.append(css,script);
 });return library;
}
const coords=p=>[p.lat,p.lng];
const textNode=t=>{const s=document.createElement('span');s.textContent=t;return s;};
// A stationary single-pointer hold selects a point; dragging and pinch zoom do not.
function bindLongPress(element,pointAt,select,start){
 let press,timer;
 const cancel=()=>{clearTimeout(timer);press=null;};
 const another=e=>{if(press&&e.pointerId!==press.id)cancel();};
 const down=e=>{
  if(e.button!==0||!e.isPrimary){cancel();return;}
  const pin=e.target.closest('[data-location-pin]');
  if(!pin&&e.target.closest('button,a,input,[role="button"]'))return;
  const point=pin?null:pointAt(e.clientX,e.clientY);if(!pin&&!point)return;
  cancel();press={id:e.pointerId,x:e.clientX,y:e.clientY,field:pin?.dataset.locationPin,point};start?.();
  timer=setTimeout(()=>{if(!press)return;const p=press;press=null;
   if(p.field)select({field:p.field});else select({point:p.point});
  },600);
 };
 const move=e=>{if(press&&e.pointerId===press.id&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>12)cancel();};
 const up=e=>{if(press&&e.pointerId===press.id)cancel();};
 const context=e=>{if(!e.target.closest('a'))e.preventDefault();};
 const key=e=>{const pin=e.target.closest('[data-location-pin]');if(pin&&['Enter',' ','Delete','Backspace'].includes(e.key)){e.preventDefault();select({field:pin.dataset.locationPin});}};
 element.addEventListener('pointerdown',down,true);element.addEventListener('contextmenu',context);element.addEventListener('keydown',key);
 window.addEventListener('pointerdown',another,true);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('blur',cancel);
 return ()=>{cancel();element.removeEventListener('pointerdown',down,true);element.removeEventListener('contextmenu',context);element.removeEventListener('keydown',key);window.removeEventListener('pointerdown',another,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',cancel);};
}
export class MapView{
 constructor(element,api,{center,zoom=14}={}){
  this.element=element;this.dead=false;this.layers=[];this.fitted=false;
  this.ready=mapConfig(api).then(async c=>{
   if(this.dead||!element.isConnected)return;
   this.config=c;
   if(c.provider==='Google'){const G=await loadGoogleMaps(c.browserKey);if(this.dead||!element.isConnected)return;this.google=new GoogleMapView(element,G,{center:center||c.center,zoom});await this.google.ready;if(this.dead||!element.isConnected){this.google.destroy();return;}this.map=this.google.map;this.resize=new ResizeObserver(()=>this.map?.invalidateSize());this.resize.observe(element);return;}
   const L=await loadLeaflet();
   if(this.dead||!element.isConnected)return;
   element.dataset.mapProvider='OpenStreetMap';this.L=L;this.config=c;this.map=L.map(element,{zoomControl:false,attributionControl:true,scrollWheelZoom:false}).setView(coords(center||c.center),zoom);
   L.control.zoom({position:'bottomleft',zoomInTitle:'تكبير الخريطة',zoomOutTitle:'تصغير الخريطة'}).addTo(this.map);
   L.tileLayer(c.tileUrl,{maxZoom:19,minZoom:5,keepBuffer:1,updateWhenIdle:true,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).on('tileerror',()=>{element.setAttribute('aria-label','تعذر تحميل بعض مربعات الخريطة؛ تحقق من الإنترنت');}).addTo(this.map);
   this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
   this.resize=new ResizeObserver(()=>this.map?.invalidateSize({animate:false}));this.resize.observe(element);this.map.invalidateSize({animate:false});
  }).catch(e=>{if(!this.dead){element.replaceChildren(textNode(e.message));element.classList.add('map-error');}throw e;});
 }
 enableLongPress(select,start){
  this.stopPress?.();this.stopPress=bindLongPress(this.element,(x,y)=>{
   if(this.dead||!this.map)return null;const r=this.element.getBoundingClientRect();
   if(x<r.left||x>r.right||y<r.top||y>r.bottom)return null;
   if(this.google)return this.google.pointAt(x-r.left,y-r.top);
   const p=this.map.containerPointToLatLng([x-r.left,y-r.top]);return{lat:p.lat,lng:p.lng};
  },select,start);
 }
 async draw({pickupPoint,destinationPoint,route,location,stale=false,refit=false,interactivePins=false}={}){
  await this.ready;if(this.dead||!this.map)return;if(this.google)return this.google.draw({pickupPoint,destinationPoint,route,location,stale,refit,interactivePins});const {map,L}=this;this.layers.forEach(x=>x.remove());this.layers=[];const bounds=[];
  for(const [p,label,kind]of [[pickupPoint,'نقطة الالتقاء','pickup'],[destinationPoint,'الوجهة','destination']])if(p){const tag=interactivePins?'button':'span',attributes=interactivePins?' type="button" data-location-pin="'+kind+'" aria-label="إلغاء '+label+' بالضغط المطول"':'';bounds.push(coords(p));this.layers.push(L.marker(coords(p),{keyboard:!interactivePins,icon:L.divIcon({className:'location-map-marker',html:'<'+tag+attributes+' class="'+kind+'">'+(kind==='destination'?'٢':'١')+'</'+tag+'>',iconSize:[32,40],iconAnchor:[16,40]})}).bindTooltip(textNode(label)).addTo(map));}
  if(route?.geometry?.coordinates?.length){const line=L.polyline(route.geometry.coordinates.map(c=>[c[1],c[0]]),{color:'#0875ef',weight:5,opacity:.85}).addTo(map);this.layers.push(line);bounds.push(...line.getLatLngs());}
  if(location){bounds.push(coords(location));this.layers.push(L.circle(coords(location),{radius:Math.min(location.accuracy||10,500),color:stale?'#8995a3':'#00a787',weight:1,fillOpacity:.1}).addTo(map));this.layers.push(L.marker(coords(location),{icon:L.divIcon({className:'captain-map-marker'+(stale?' stale':''),html:'<span aria-label="موقع الكابتن">🚚</span>',iconSize:[34,34],iconAnchor:[17,17]})}).bindTooltip(textNode(stale?'آخر موقع معروف — متأخر':'موقع الكابتن')).addTo(map));}
  if(bounds.length&&(refit||!this.fitted&&!interactivePins)){map.fitBounds(L.latLngBounds(bounds),{padding:[28,28],maxZoom:16,animate:false});this.fitted=true;}
 }
 destroy(){this.dead=true;this.stopPress?.();this.resize?.disconnect();if(this.google)this.google.destroy();else this.map?.remove();this.map=null;}
}
export function routeShell(){return '<section class="real-map-panel"><div class="real-map" data-order-map role="region" aria-label="خريطة الطلب"></div><p class="map-live-status" data-map-status role="status">جاري تحميل الخريطة…</p></section>';}
export function mountOrderMap({element,api,role,order}){
 if(!element)return ()=>{};const status=element.parentElement.querySelector('[data-map-status]'),m=new MapView(element,api);let dead=false,pending=false,version=0;
 const note=t=>{if(!dead&&status)status.textContent=t;};
 async function update(){if(dead||pending||document.hidden)return;pending=true;const rev=++version;try{
  const assigned=role==='captain'&& !order.captainAssigned;
  const d=assigned?{...order,location:null,route:order.route}:await api(`/api/${role}/orders/${encodeURIComponent(order.id)}/tracking`);
  if(dead||rev!==version)return;await m.draw(d);
  const time=d.route?` · ${Math.max(1,Math.round(d.route.durationSeconds/60))} دقيقة تقديرية` : '';
  const label=!d.pickupPoint||!d.destinationPoint?'هذا الطلب القديم لا يحتوي نقطتين على الخريطة':d.stage==='finished'?'انتهت الرحلة — مشاركة الموقع متوقفة':d.location?d.stale?'آخر موقع معروف؛ لم يصل تحديث حديث':'موقع الكابتن محدث':assigned?'مسار الالتقاء إلى الوجهة':order.captainAssigned?'بانتظار مشاركة موقع الكابتن':'مسار الالتقاء إلى الوجهة';
  note(label+time+(order.category==='heavy'?' · مسار مرجعي: تحقق من قيود الشاحنات':'')+(d.routeError?' · '+d.routeError:''));
 }catch(e){note(e.message);}finally{pending=false;}}
 update();const timer=setInterval(update,5000);return ()=>{dead=true;version++;clearInterval(timer);m.destroy();};
}
