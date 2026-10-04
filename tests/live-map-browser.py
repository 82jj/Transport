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
def hold(page,selector='#request-map',position=(.3,.35)):
 locator=page.locator(selector);locator.scroll_into_view_if_needed();box=locator.bounding_box()
 assert box
 page.mouse.move(box['x']+box['width']*position[0],box['y']+box['height']*position[1]);page.mouse.down();page.wait_for_timeout(680);page.mouse.up()

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
  expect(page.locator('#request-map')).to_be_visible()
  expect(page.locator('#request-map')).to_have_attribute('data-map-provider',re.compile('^(Google|OpenStreetMap)$'),timeout=30000)
  page.wait_for_function("() => [...document.querySelectorAll('#request-map img')].some(i=>i.complete&&i.naturalWidth>0)",timeout=30000)
  # Real SDK/container projection and native pointer holds, independent of autocomplete quota.
  hold(page);expect(page.locator('#request-map [data-location-pin=pickup]')).to_be_visible(timeout=30000)
  hold(page,position=(.7,.65));expect(page.locator('#request-map [data-location-pin=destination]')).to_be_visible(timeout=30000)
  expect(page.locator('.service-step')).to_be_visible()
  hold(page,'#request-map [data-location-pin=pickup]',(.5,.5));expect(page.locator('#request-map [data-location-pin=pickup]')).to_have_count(0)
  expect(page.locator('#request-map [data-location-pin=destination]')).to_be_visible()
  expect(page.locator('#request-map')).to_have_attribute('data-selection-target','pickup')
  hold(page,position=(.35,.3));expect(page.locator('#request-map [data-location-pin=pickup]')).to_be_visible(timeout=30000)
  page.screenshot(path=str(OUT/(name+'-manual-pins-real-map.png')),full_page=True)
  print('PASS',name,'real production map hold sets pickup then destination; holding pickup removes only it; missing pickup restored; no production writes',flush=True)
  for field in ['pickup','destination']:
   hold(page,'#request-map [data-location-pin='+field+']',(.5,.5));expect(page.locator('#request-map [data-location-pin='+field+']')).to_have_count(0)
  for field,label in [('pickup','الفيصلية الرياض'),('destination','برج المملكة الرياض')]:
   page.locator('#'+field).fill(label)
   try:expect(page.locator('#'+field+'-results .place-result').first).to_be_visible(timeout=30000)
   except AssertionError:
    page.screenshot(path=str(OUT/(name+'-'+field+'-search-failure.png')),full_page=True)
    print(json.dumps({'field':field,'searchStatus':page.locator('#'+field+'-search-status').inner_text(),'blockedRequests':forbidden},ensure_ascii=False),flush=True)
    raise
   page.locator('#'+field+'-results .place-result').first.click()
   expect(page.locator('#request-map [data-location-pin='+field+']')).to_be_visible(timeout=30000)
   expect(page.locator('#request-map')).to_be_visible()
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
