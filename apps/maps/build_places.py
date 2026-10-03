"""Build a private OSM place-name index; never consumes public geocoder APIs."""
import re, sqlite3, sys, unicodedata
import osmium

def normalize(s):
    return re.sub(r'[^\w\s]', ' ', ''.join(c for c in unicodedata.normalize('NFKD', s.lower()) if not unicodedata.combining(c))).translate(str.maketrans('أإآىة', 'ااايه'))

class Places(osmium.SimpleHandler):
    def __init__(self, db):
        super().__init__(); self.db=db; self.count=0
    def add(self, obj, lat, lng, kind):
        if not (16<=lat<=33 and 34<=lng<=56): return
        tags=obj.tags
        name=tags.get('name:ar') or tags.get('name') or tags.get('name:en')
        address=' '.join(filter(None, (tags.get('addr:city'),tags.get('addr:street'),tags.get('addr:housenumber'))))
        if not name: name=address
        if not name: return
        names=' '.join(filter(None,[name,tags.get('name'),tags.get('name:en'),tags.get('alt_name'),address]))
        rank={'city':100,'town':50,'village':30,'suburb':20,'neighbourhood':10}.get(tags.get('place'),1)
        label=name + (' · '+tags.get('addr:city') if tags.get('addr:city') and tags.get('addr:city')!=name else '')
        self.db.execute('INSERT INTO places(osm_id,label,names,lat,lng,rank) VALUES(?,?,?,?,?,?)', (f'{kind}{obj.id}',label[:300],normalize(names)[:600],lat,lng,rank)); self.count+=1
    def node(self,n):
        if n.location.valid(): self.add(n,n.location.lat,n.location.lon,'n')
    def way(self,w):
        if not (w.tags.get('name') or w.tags.get('name:ar') or w.tags.get('name:en') or w.tags.get('addr:street')): return
        nodes=[n for n in w.nodes if n.location.valid()]
        if nodes: self.add(w,sum(n.lat for n in nodes)/len(nodes),sum(n.lon for n in nodes)/len(nodes),'w')

if __name__=='__main__':
    db=sqlite3.connect(sys.argv[2]);db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE places(id INTEGER PRIMARY KEY,osm_id TEXT,label TEXT,names TEXT,lat REAL,lng REAL,rank INTEGER);
    CREATE VIRTUAL TABLE names USING fts5(names,content=places,content_rowid=id,tokenize='unicode61',prefix='2 3 4');''')
    handler=Places(db);handler.apply_file(sys.argv[1],locations=True,idx='flex_mem')
    db.execute("INSERT INTO names(names) VALUES('rebuild')");db.commit();db.execute('VACUUM');db.close()
    print(f'Indexed {handler.count} named places/roads from OSM',flush=True)
