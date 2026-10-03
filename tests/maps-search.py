"""Fast regression test for the real FTS schema/query before downloading regional data."""
import ast,importlib.util,sqlite3,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
build=ast.parse((ROOT/'apps/maps/build_places.py').read_text())
schema=next(ast.literal_eval(n.value) for n in build.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCHEMA' for t in n.targets))
spec=importlib.util.spec_from_file_location('map_server',ROOT/'apps/maps/server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
with tempfile.TemporaryDirectory() as tmp:
 server.DATA=str(Path(tmp)/'places.sqlite');db=sqlite3.connect(server.DATA);db.executescript(schema)
 for i,(label,rank) in enumerate([('مدينة الرياض',100),('طريق الملك فهد الرياض',1),('الإقامة باتلية',1)],1):db.execute('INSERT INTO places VALUES(?,?,?,?,?,?,?)',(i,'n'+str(i),label,server.normalize(label),24.7136,46.6753,rank))
 db.execute("INSERT INTO place_search(place_search) VALUES('rebuild')");db.commit();db.close()
 assert len(server.search('الرياض'))==2
 assert server.search('طريق الملك')[0]['label']=='طريق الملك فهد الرياض'
 assert server.search('الإقامه باتليه')[0]['label']=='الإقامة باتلية'
 assert server.search('الرياض')[0]['label']=='مدينة الرياض'
 assert server.search('zznevermatched')==[]
 try:server.search('a');raise AssertionError('short query accepted')
 except ValueError:pass
print('PASS actual private geocoder schema, Arabic normalization and ranked search')
