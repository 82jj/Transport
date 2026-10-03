"""Private OSM place search + OSRM roads. No user records, public domain or request logs."""
import json, math, os, re, signal, socket, sqlite3, subprocess, threading, unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import urlopen
DATA=os.environ.get('PLACES_DB','/maps/places.sqlite')
OSRM=os.environ.get('OSRM_ORIGIN','http://127.0.0.1:5000')
DATE=os.environ.get('OSM_DATA_DATE','2026-09-01')
def normalize(s):
    return re.sub(r'[^\w\s]', ' ', ''.join(c for c in unicodedata.normalize('NFKD',s.lower()) if not unicodedata.combining(c))).translate(str.maketrans('أإآىة','ااايه'))
def search(q):
    if not isinstance(q,str) or not 2<=len(q.strip())<=120: raise ValueError('عبارة البحث غير صالحة')
    tokens=normalize(q).split()[:8]
    if not tokens: return []
    query=' AND '.join('"'+t.replace('"','""')+'"*' for t in tokens)
    with sqlite3.connect('file:'+DATA+'?mode=ro',uri=True) as db:
        rows=db.execute('SELECT p.osm_id,p.label,p.lat,p.lng FROM names JOIN places p ON p.id=names.rowid WHERE names MATCH ? ORDER BY p.rank DESC,bm25(names) LIMIT 8',(query,)).fetchall()
    return [{'id':r[0],'label':r[1],'lat':r[2],'lng':r[3]} for r in rows]
def point(params,prefix=''):
    lat=float(params[prefix+'lat'][0]);lng=float(params[prefix+'lng'][0])
    if not (math.isfinite(lat) and math.isfinite(lng) and 16<=lat<=33 and 34<=lng<=56): raise ValueError('خارج النطاق')
    return lat,lng
def osrm(path):
    with urlopen(OSRM+path,timeout=12) as r:
        raw=r.read(4*1024*1024+1)
        if len(raw)>4*1024*1024: raise ValueError('المسار كبير')
        data=json.loads(raw)
    if data.get('code')!='Ok': raise ValueError('لا يوجد مسار')
    return data
class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args): pass
    def send(self,status,body):
        raw=json.dumps(body,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        try:
            u=urlparse(self.path);p=parse_qs(u.query)
            if len(self.path)>2000: return self.send(414,{'error':'طلب طويل'})
            if u.path=='/healthz':
                osrm('/nearest/v1/driving/46.6753,24.7136?number=1')
                if not os.path.isfile(DATA): raise RuntimeError('Index not ready')
                return self.send(200,{'ok':True,'app':'transport-maps','dataDate':DATE,'profile':'car','truckCertified':False})
            if u.path=='/search': return self.send(200,{'results':search(p.get('q',[''])[0]),'dataDate':DATE})
            if u.path=='/nearest':
                lat,lng=point(p);r=osrm(f'/nearest/v1/driving/{lng},{lat}?number=1')['waypoints'][0]
                if r['distance']>250: return self.send(422,{'error':'لا يوجد طريق قابل للوصول خلال 250 مترًا. حرّك النقطة إلى شارع قريب.'})
                return self.send(200,{'point':{'lat':r['location'][1],'lng':r['location'][0]},'distanceMeters':r['distance'],'road':r.get('name',''),'dataDate':DATE})
            if u.path=='/route':
                a,b=point(p,'from_'),point(p,'to_')
                data=osrm(f'/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson&steps=false&alternatives=false&generate_hints=false&radiuses=250;250')
                r=data['routes'][0]
                return self.send(200,{'distanceMeters':r['distance'],'durationSeconds':r['duration'],'geometry':r['geometry'],'waypoints':[{'lat':w['location'][1],'lng':w['location'][0]} for w in data['waypoints']],'dataDate':DATE,'profile':'car','truckCertified':False})
            return self.send(404,{'error':'المسار غير موجود'})
        except (KeyError,ValueError,IndexError): return self.send(422,{'error':'تعذر إيجاد طريق؛ حدد نقطتين أقرب إلى الشارع'})
        except Exception: return self.send(503,{'error':'خدمة المسار غير جاهزة؛ حاول مجددًا'})
    def do_POST(self): self.send(405,{'error':'طريقة غير مسموحة'})
class Server(ThreadingHTTPServer):
    address_family=socket.AF_INET6
    daemon_threads=True
if __name__=='__main__':
    child=None
    if not os.environ.get('OSRM_ORIGIN'):
        child=subprocess.Popen(['osrm-routed','--algorithm','mld','--threads','2','--ip','127.0.0.1','--port','5000','/maps/region.osrm'],stdout=subprocess.DEVNULL)
    server=Server(('::',int(os.environ.get('PORT','8080'))),Handler)
    def stop(*args):
        if child:child.terminate()
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    print('transport-maps private router starting',flush=True);server.serve_forever();server.server_close()
