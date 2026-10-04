// Contract fixture only. This is not a Google SDK or a production map fallback.
(()=>{
 class Events{
  constructor(){this.events=new Map();}
  addListener(name,fn){const set=this.events.get(name)||new Set();this.events.set(name,set);set.add(fn);return{remove:()=>set.delete(fn)};}
  emit(name,arg){for(const fn of [...(this.events.get(name)||[])])fn(arg);}
 }
 class LatLng{constructor(lat,lng){this.y=lat;this.x=lng;}lat(){return this.y;}lng(){return this.x;}}
 class Point{constructor(x,y){this.x=x;this.y=y;}}
 class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}}
 class NativeMap extends Events{
  constructor(element,options){super();this.element=element;this.center=options.center;this.zoom=options.zoom;this.overlay=document.createElement('div');this.overlay.className='gm-style';this.overlay.style.cssText='position:relative;height:100%;background:#e8e9eb';this.overlay.textContent='Google SDK contract fixture — not real map imagery';element.append(this.overlay);const tiles=()=>{if(element.clientWidth&&element.clientHeight)this.emit('tilesloaded');else this.tileTimer=setTimeout(tiles,50);};this.tileTimer=setTimeout(tiles,500);}
  getCenter(){return new LatLng(this.center.lat,this.center.lng);}
  setCenter(p){this.center=p instanceof LatLng?{lat:p.lat(),lng:p.lng()}:p;queueMicrotask(()=>this.emit('idle'));}
  getZoom(){return this.zoom;}
  setZoom(z){this.zoom=z;queueMicrotask(()=>this.emit('idle'));}
  fitBounds(bounds){this.element.dataset.mapFitPoints=String(bounds.points.length);if(bounds.points.length)this.setCenter(bounds.points[0]);}
 }
 class Overlay{
  setMap(map){if(this.map)this.onRemove();this.map=map;if(map){this.onAdd();this.draw();}}
  getPanes(){return{overlayLayer:this.map.overlay,overlayMouseTarget:this.map.overlay};}
  getProjection(){const map=this.map,scale=.0001;return{fromLatLngToDivPixel:p=>({x:map.element.clientWidth/2+(p.lng()-map.center.lng)/scale,y:map.element.clientHeight/2-(p.lat()-map.center.lat)/scale}),fromContainerPixelToLatLng:p=>new LatLng(map.center.lat-(p.y-map.element.clientHeight/2)*scale,map.center.lng+(p.x-map.element.clientWidth/2)*scale)};}
  static preventMapHitsAndGesturesFrom(){}
 }
 class Shape{constructor(options){this.map=options.map;}setMap(map){this.map=map;}}
 window.google={maps:{Map:NativeMap,Point,LatLng,LatLngBounds:Bounds,OverlayView:Overlay,Polyline:Shape,Circle:Shape,RenderingType:{RASTER:'RASTER'},ControlPosition:{LEFT_BOTTOM:'LEFT_BOTTOM'},event:{trigger:(map,name)=>map.emit(name),clearInstanceListeners:map=>{clearTimeout(map.tileTimer);map.events.clear();},addListenerOnce:(map,name,fn)=>{const listener=map.addListener(name,e=>{listener.remove();fn(e);});return listener;}}}};
 window.wasilGoogleReady();
})();
