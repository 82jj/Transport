// The old combined application is intentionally retired. Deploy one app directory.
import http from 'node:http';
http.createServer((req,res)=>{const healthy=req.url==='/healthz';res.writeHead(healthy?200:410,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(healthy?{ok:true,app:'transport-retired',version:'0.3.0'}:{error:'تم إيقاف الواجهة الجامعة. استخدم رابط التطبيق المستقل.'}));}).listen(Number(process.env.PORT||3000),'0.0.0.0');
