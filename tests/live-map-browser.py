"""Read-only real public map rendering. No mocked responses or personal positions.
Only fixed-place map computations are allowed to use POST. No production writes.
"""
import json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(__file__).resolve().parents[1]/'artifacts'/'live-maps';OUT.mkdir(parents=True,exist_ok=True)
base='https://transport-user-isolated-production.up.railway.app'
MAP_COMPUTATIONS={base+'/api/maps/search',base+'/api/maps/snap',base+'/api/maps/route',base+'/api/quote',
 'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo'}
def read_only_request(method,url):
 return method in ['GET','HEAD','OPTIONS'] or method=='POST' and url.split('?',1)[0] in MAP_COMPUTATIONS
# Google's raster SDK reads viewport metadata with POST; no other SDK writes are allowed.
viewport='https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo'
assert read_only_request('POST',viewport)
assert not read_only_request('DELETE',viewport)
assert not read_only_request('POST',viewport+'/AcceptOrder')
assert not read_only_request('POST',viewport.replace('maps.googleapis.com','maps.googleapis.com.example.com'))
assert not read_only_request('POST',base+'/api/user/orders')
assert not read_only_request('POST',base+'/api/user/register')
assert not read_only_request('POST','https://maps.googleapis.com/other-rpc')
with sync_playwright() as p:
 for name in (['chromium','webkit'] if os.environ.get('TEST_WEBKIT')=='1' else ['chromium']):
  browser=getattr(p,name).launch(headless=True)
  context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];forbidden=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def guard(route):
   req=route.request
   if not read_only_request(req.method,req.url):
    forbidden.append(req.url.split('?',1)[0]);route.abort();return
   route.continue_()
  page.route('**/*',guard)
  page.goto(base,wait_until='domcontentloaded');page.locator('[data-category=light]').click()
  expect(page.locator('#request-map')).to_have_count(0)
  for field,label in [('pickup','الرياض'),('destination','الملك فهد')]:
   page.locator('#select-'+field).click();expect(page.locator('#picker-map')).to_have_attribute('data-map-provider',re.compile('^(Google|OpenStreetMap)$'),timeout=30000)
   # Real map tiles, with the native tile scale and a single confirmation.
   page.wait_for_function("() => [...document.querySelectorAll('#picker-map img')].some(i=>i.complete&&i.naturalWidth>0)",timeout=30000)
   page.locator('#edit-place').click()
   page.locator('#place-query').fill(label);page.locator('#place-search button').click();expect(page.locator('#place-results .place-result').first).to_be_visible(timeout=30000)
   page.locator('#place-results .place-result').first.click()
   try:expect(page.locator('#pick-confirm')).to_be_enabled(timeout=30000)
   except AssertionError:
    page.screenshot(path=str(OUT/(name+'-'+field+'-confirmation-failure.png')),full_page=True)
    print(json.dumps({'field':field,'searchStatus':page.locator('#place-search-status').inner_text(),'mapStatus':page.locator('#pick-status').inner_text(),'blockedRequests':[url.split('?',1)[0] for url in forbidden]},ensure_ascii=False),flush=True)
    raise
   page.locator('#pick-confirm').click();expect(page.locator('.map-picker')).to_have_count(0)
  expect(page.locator('#request-map')).to_have_attribute('data-map-provider',re.compile('^(Google|OpenStreetMap)$'),timeout=30000)
  page.wait_for_function("() => [...document.querySelectorAll('#request-map img')].some(i=>i.complete&&i.naturalWidth>0)",timeout=30000)
  expect(page.locator('.service-step')).to_be_visible()
  result=context.request.post(base+'/api/maps/snap',data={'point':{'lat':24.7136,'lng':46.6753}})
  assert result.ok,result.status
  assert result.json()['distanceMeters']<=250
  page.screenshot(path=str(OUT/(name+'-user-real-map.png')),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert not errors,errors
  assert not forbidden,forbidden
  (OUT/(name+'-report.json')).write_text(json.dumps({'provider':page.locator('#request-map').get_attribute('data-map-provider'),'realTilesLoaded':True,'arabicSearchVerified':True,'nearestRoadVerified':True,'productionWrites':0,'errors':errors}))
  print('PASS',name,'real production map tiles, Arabic search and nearest road; no accounts/orders/GPS writes',flush=True)
  context.close();browser.close()
