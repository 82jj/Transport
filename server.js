import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const port = Number(process.env.PORT || 3000);
const root = new URL("./public/", import.meta.url).pathname;
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};

const services = {
  light: ["بيك أب صغير","بيك أب غمارتين","بيك أب حمولة كبيرة"],
  heavy: ["دينا","سطحة","تريلة"],
  home: ["غاز","ماء حلو","وايت ماء صغير","وايت ماء متوسط","وايت ماء كبير"]
};

const server=http.createServer(async(req,res)=>{
  if(req.url==="/healthz"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,service:"transport",version:"0.1.0"}));}
  if(req.url==="/api/services"){res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify(services));}
  let path=req.url==="/"?"index.html":req.url.replace(/^\//,"").split("?")[0];
  if(!["index.html","app.js","styles.css"].includes(path)){res.writeHead(404);return res.end("Not found");}
  try{const body=await readFile(join(root,path));res.writeHead(200,{"content-type":mime[extname(path)]||"application/octet-stream"});res.end(body);}
  catch{res.writeHead(404);res.end("Not found");}
});
server.listen(port,"0.0.0.0",()=>console.log(`Transport running on :${port}`));