"""Verify native geolocation timestamp units with the pinned Playwright version.

Playwright 1.57.0 / WebKit 2227 required a narrow CI-only driver patch because
native position timestamps were 1000x epoch milliseconds. Playwright 1.61.0
changes the packaged driver layout and adds Ubuntu 26.04 support, so validate
the browser behavior directly instead of patching private driver internals.
Production JS, API freshness/consent checks and navigator callbacks stay intact.
"""
import importlib.metadata,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright

assert Path(sys.prefix).resolve()==Path('/tmp/transport-ui-env'), 'Patch is permitted only in the disposable CI browser venv'
assert importlib.metadata.version('playwright')=='1.61.0', 'Re-evaluate the clock patch for another Playwright version'
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
