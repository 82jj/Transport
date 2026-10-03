import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// This server is copied into each application. Its only configuration is local.
const config = JSON.parse(await readFile(new URL('./app.json', import.meta.url), 'utf8'));
const root = new URL('./public/', import.meta.url);
const upstream = process.env.API_ORIGIN;
if (process.env.NODE_ENV === 'production' && !upstream) throw new Error('API_ORIGIN is required');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
const json = (res,status,data) => {res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
export const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/healthz' && req.method === 'GET') return json(res,200,{ok:true,app:config.id,version:'0.3.0',commit:process.env.RAILWAY_GIT_COMMIT_SHA || 'local'});
    if (url.pathname.startsWith('/api/')) {
      const allowed = url.pathname === '/api/services' || url.pathname === '/api/quote' || url.pathname.startsWith(config.apiPrefix + '/');
      if (!allowed) return json(res,404,{error:'المسار غير موجود'});
      if (!upstream) return json(res,503,{error:'خدمة الطلبات غير متصلة بعد'});
      const method = req.method || 'GET';
      if (!['GET','POST','PATCH','DELETE'].includes(method)) return json(res,405,{error:'طريقة غير مسموحة'});
      if (method !== 'GET') {
        const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expected) return json(res,403,{error:'مصدر الطلب غير مسموح'});
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res,415,{error:'JSON مطلوب'});
      }
      const chunks=[]; let size=0;
      for await (const chunk of req) {size += chunk.length;if (size > (config.apiPrefix==='/api/captain' && url.pathname==='/api/captain/application/files'?5600000:32768)) return json(res,413,{error:'الطلب كبير جداً'});chunks.push(chunk);}
      const cookie = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(config.cookie+'=')) || '';
      const response = await fetch(new URL(url.pathname + url.search,upstream),{method,headers:{'Content-Type':'application/json',cookie},body:method==='GET'?undefined:Buffer.concat(chunks),redirect:'error',signal:AbortSignal.timeout(10000)});
      const responseHeaders={...headers,'Content-Type':response.headers.get('content-type')||'application/json; charset=utf-8'};
      if(url.pathname.startsWith(config.apiPrefix+'/files/'))responseHeaders['Content-Disposition']=response.headers.get('content-disposition')||'attachment';
      const cookies=response.headers.getSetCookie();if(cookies.length) responseHeaders['Set-Cookie']=cookies;
      res.writeHead(response.status,responseHeaders);return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'طريقة غير مسموحة'});
    const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!config.files.includes(path)) return json(res,404,{error:'المسار غير موجود'});
    const content=await readFile(new URL(path,root));
    const extension=path.slice(path.lastIndexOf('.'));
    res.writeHead(200,{...headers,'Content-Type':types[extension] || 'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch (error) {if(!res.headersSent) json(res,502,{error:'تعذر الاتصال بالخدمة. حاول مرة أخرى.'});else res.end();}
});
server.requestTimeout=90000;server.headersTimeout=10000;
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log(`${config.id} 0.3.0 ready`));
