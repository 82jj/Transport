// Local test-only maps fixture; NEVER deployed or used as a production fallback.
import http from 'node:http';
const a={lat:24.7136,lng:46.6753};
http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost'),q=u.searchParams;let d;
 if(u.pathname==='/healthz')d={ok:true,dataDate:'test-fixture'};
 else if(u.pathname==='/nearest')d={point:{lat:Number(q.get('lat')),lng:Number(q.get('lng'))},distanceMeters:10,road:'شارع اختبار'};
 else if(u.pathname==='/search')d={results:[{id:'test-place',label:q.get('q'),...a}]};
 else if(u.pathname==='/route'){const from={lat:Number(q.get('from_lat')),lng:Number(q.get('from_lng'))},to={lat:Number(q.get('to_lat')),lng:Number(q.get('to_lng'))};d={distanceMeters:8300,durationSeconds:900,geometry:{type:'LineString',coordinates:[[from.lng,from.lat],[46.69,24.72],[to.lng,to.lat]]},waypoints:[from,to],profile:'car',truckCertified:false};}
 else{res.writeHead(404);return res.end('{}');}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(d));
}).listen(Number(process.env.PORT||3999),'127.0.0.1');
