let library;
export function loadGoogleMaps(key){
 if(window.google?.maps?.Map)return Promise.resolve(window.google.maps);
 if(!library)library=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let settled=false;
  const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);script.remove();delete window.wasilGoogleReady;library=null;reject(new Error('تعذر تحميل خرائط Google. تحقق من تفعيل الخدمة وصلاحية المفتاح.'));};
  window.wasilGoogleReady=()=>{if(settled)return;settled=true;clearTimeout(timer);delete window.wasilGoogleReady;resolve(window.google.maps);};
  window.gm_authFailure=()=>{document.dispatchEvent(new Event('wasil-google-auth-failure'));fail();};
  const timer=setTimeout(fail,20000);
  script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,v:'quarterly',loading:'async',callback:'wasilGoogleReady',language:'ar',region:'SA'});
  const nonce=document.querySelector('script[nonce]')?.nonce||'';
  if(nonce&&!document.querySelector('style[nonce]')){const style=document.createElement('style');style.setAttribute('nonce',nonce);document.head.append(style);}
  script.async=true;script.setAttribute('nonce',nonce);script.onerror=fail;document.head.append(script);
 });return library;
}
const meters=(a,b)=>{const rad=x=>x*Math.PI/180,dlat=rad(b[0]-a[0]),dlng=rad(b[1]-a[1]);const v=Math.sin(dlat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(v),Math.sqrt(Math.max(0,1-v)));};
export class GoogleMapView{
 constructor(element,G,{center,zoom}){
  this.G=G;this.layers=[];this.listeners=[];this.fitted=false;
  this.native=new G.Map(element,{center,zoom,minZoom:5,maxZoom:20,mapTypeId:'roadmap',renderingType:G.RenderingType.RASTER,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,clickableIcons:false,gestureHandling:'greedy',zoomControl:true,zoomControlOptions:{position:G.ControlPosition.LEFT_BOTTOM}});
  element.dataset.mapProvider='Google';
  this.ready=new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(this.loadTimer);document.removeEventListener('wasil-google-auth-failure',authFailure);if(error)reject(error);else{element.dataset.mapReady='true';resolve();}};
   const authFailure=()=>finish(new Error('تعذر عرض خرائط Google. تحقق من تفعيل الخدمة وصلاحية المفتاح.'));
   document.addEventListener('wasil-google-auth-failure',authFailure);
   this.loadTimer=setTimeout(authFailure,20000);
   this.listeners.push(G.event.addListenerOnce(this.native,'tilesloaded',()=>finish()));
   this.cancelLoad=()=>finish(new Error('أُغلقت الخريطة'));
  });
  // Adapter keeps the same picker interactions for both supported map providers.
  const native=this.native;
  this.projection=new G.OverlayView();this.projection.onAdd=()=>{};this.projection.draw=()=>{};this.projection.onRemove=()=>{};this.projection.setMap(native);
  this.map={getCenter:()=>{const p=native.getCenter();return{lat:p.lat(),lng:p.lng()};},getZoom:()=>native.getZoom(),setView:(p,z)=>{native.setCenter({lat:p[0],lng:p[1]});native.setZoom(z);return this.map;},distance:meters,invalidateSize:()=>{const p=native.getCenter();G.event.trigger(native,'resize');if(p)native.setCenter(p);},on:(event,fn)=>{this.listeners.push(native.addListener(event==='moveend'?'idle':event,e=>{if(event==='click'&&e.latLng)fn({latlng:{lat:e.latLng.lat(),lng:e.latLng.lng()}});else fn(e);}));return this.map;}};
 }
 pointAt(x,y){const p=this.projection.getProjection()?.fromContainerPixelToLatLng(new this.G.Point(x,y));return p?{lat:p.lat(),lng:p.lng()}:null;}
 marker(point,label,kind,interactive=false){
  const G=this.G,native=this.native;
  class Pin extends G.OverlayView{
   onAdd(){this.node=document.createElement(interactive?'button':'span');this.node.className='google-location-marker '+kind;this.node.textContent=kind==='destination'?'٢':kind==='pickup'?'١':'●';this.node.setAttribute('role',interactive?'button':'img');this.node.setAttribute('aria-label',interactive?'إلغاء '+label+' بالضغط المطول':label);this.node.title=label;if(interactive){this.node.type='button';this.node.dataset.locationPin=kind;G.OverlayView.preventMapHitsAndGesturesFrom(this.node);this.getPanes().overlayMouseTarget.append(this.node);}else this.getPanes().overlayLayer.append(this.node);}
   draw(){const p=this.getProjection().fromLatLngToDivPixel(new G.LatLng(point.lat,point.lng));this.node.style.left=p.x+'px';this.node.style.top=p.y+'px';}
   onRemove(){this.node?.remove();}
  }
  const pin=new Pin();pin.setMap(native);this.layers.push(pin);
 }
 draw({pickupPoint,destinationPoint,route,location,stale=false,refit=false,interactivePins=false}={}){
  const G=this.G,native=this.native,bounds=new G.LatLngBounds();let count=0;
  this.layers.forEach(x=>x.setMap(null));this.layers=[];
  for(const [p,label,kind]of [[pickupPoint,'نقطة الالتقاء','pickup'],[destinationPoint,'الوجهة','destination']])if(p){this.marker(p,label,kind,interactivePins);bounds.extend(p);count++;}
  if(route?.geometry?.coordinates?.length){const path=route.geometry.coordinates.map(([lng,lat])=>({lat,lng}));const line=new G.Polyline({map:native,path,strokeColor:'#0875ef',strokeWeight:5,strokeOpacity:.9});this.layers.push(line);path.forEach(p=>bounds.extend(p));count+=path.length;}
  if(location){const color=stale?'#8995a3':'#00a787';this.layers.push(new G.Circle({map:native,center:location,radius:Math.min(location.accuracy||10,500),strokeColor:color,strokeWeight:1,fillColor:color,fillOpacity:.15}));this.marker(location,stale?'آخر موقع معروف — متأخر':'موقع الكابتن',stale?'captain stale':'captain');bounds.extend(location);count++;}
  const hasRoute=!!route?.geometry?.coordinates?.length;
  if(count&&(refit||!interactivePins&&(!this.fitted||hasRoute&&!this.fittedRoute))){native.fitBounds(bounds,48);this.listeners.push(G.event.addListenerOnce(native,'idle',()=>{if(native.getZoom()>16)native.setZoom(16);}));this.fitted=true;this.fittedRoute=hasRoute;}
 }
 destroy(){if(!this.native)return;this.cancelLoad();this.projection.setMap(null);this.layers.forEach(x=>x.setMap(null));this.listeners.forEach(x=>x.remove());this.G.event.clearInstanceListeners(this.native);this.native=null;}
}
