"""Real Leaflet code, synthetic tiles, local coordinates: never query community map tiles in CI."""
import base64,hashlib,os,tempfile,urllib.request
from pathlib import Path
from playwright.sync_api import expect
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
P=Path(os.environ.get('LEAFLET_TEST_DIR',str(Path(tempfile.gettempdir())/'wasil-leaflet-test')))
def map_assets(page):
 P.mkdir(parents=True,exist_ok=True)
 for name,h in [('leaflet.js','20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='),('leaflet.css','p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=')]:
  f=P/name
  if not f.exists():f.write_bytes(urllib.request.urlopen('https://unpkg.com/leaflet@1.9.4/dist/'+name,timeout=30).read())
  assert base64.b64encode(hashlib.sha256(f.read_bytes()).digest()).decode()==h
 def asset(route):
  name=route.request.url.rsplit('/',1)[1];route.fulfill(body=(P/name).read_bytes(),content_type='text/javascript' if name.endswith('.js') else 'text/css',headers={'Access-Control-Allow-Origin':'*'})
 page.route('https://unpkg.com/leaflet@1.9.4/dist/*',asset)
 page.route('https://tile.openstreetmap.org/**',lambda r:r.fulfill(body=PNG,content_type='image/png'))
def choose_point(page,field,label):
 page.locator('#select-'+field).click();expect(page.locator('.map-picker .leaflet-container')).to_be_visible()
 page.locator('#edit-place').click()
 page.locator('#place-query').fill(label);page.locator('#place-search button').click();page.locator('#place-results .place-result').first.click()
 expect(page.locator('#pick-confirm')).to_be_enabled();page.locator('#pick-confirm').click();expect(page.locator('.map-picker')).to_have_count(0)
