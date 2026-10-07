"""Correct the pinned WebKit test driver's native geolocation override units.

Observed in CI 37139989027 with Playwright 1.57.0 / WebKit 2227; revalidated for Playwright 1.61.1:
 native position.timestamp = 1791048003973000; Date.now() = 1791048004339.
The driver sends milliseconds to a native override expecting seconds, producing
1000x epoch timestamps. Convert the PROTOCOL INPUT, not returned browser fixes.
Production JS, API freshness/consent checks and navigator callbacks stay intact.
Remove/re-evaluate this narrow compatibility patch when upgrading Playwright.
"""
import importlib.metadata,sys,time
from pathlib import Path
import playwright
from playwright.sync_api import sync_playwright

assert Path(sys.prefix).resolve()==Path('/tmp/transport-ui-env'), 'Patch is permitted only in the disposable CI browser venv'
assert importlib.metadata.version('playwright')=='1.61.1', 'Re-evaluate the clock patch for another Playwright version'
path=Path(playwright.__file__).parent/'driver/package/lib/server/webkit/wkBrowser.js'
old='const payload = geolocation ? { ...geolocation, timestamp: Date.now() } : void 0;'
new='const payload = geolocation ? { ...geolocation, timestamp: Date.now() / 1000 } : void 0;'
source=path.read_text()
if old in source:
 assert source.count(old)==1
 path.write_text(source.replace(old,new))
else:
 assert source.count(new)==1, 'Unexpected WebKit driver source; do not patch blindly'

with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=getattr(p,engine).launch(headless=True)
  context=browser.new_context(permissions=['geolocation'])
  context.route('http://127.0.0.1:8764/**',lambda r:r.fulfill(status=200,content_type='text/html',body='<title>Isolated geolocation clock fixture</title>'))
  page=context.new_page();page.goto('http://127.0.0.1:8764/');page.bring_to_front()
  last=0
  for latitude in [24.7136,24.717]:
   context.set_geolocation({'latitude':latitude,'longitude':46.6753,'accuracy':10})
   sample=page.evaluate("""() => new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({timestamp:p.timestamp,now:Date.now(),lat:p.coords.latitude}),e=>reject(new Error(e.message)),{maximumAge:0,timeout:10000}))""")
   assert abs(sample['now']-sample['timestamp'])<5000, (engine,sample)
   assert sample['timestamp']>=last and abs(sample['lat']-latitude)<0.00001,(engine,sample)
   last=sample['timestamp'];time.sleep(.05)
  print('PASS',engine,'native GeolocationPosition uses epoch milliseconds; acquisition timestamps not rewritten',flush=True)
  context.close();browser.close()
