"""Read-only real public map rendering. No mocked responses or personal positions.
Only fixed-place map computations are allowed to use POST. No production writes.
"""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(__file__).resolve().parents[1]/'artifacts'/'live-maps';OUT.mkdir(parents=True,exist_ok=True)
base='https://transport-user-isolated-production.up.railway.app'
with sync_playwright() as p:
 for name in (['chromium','webkit'] if os.environ.get('TEST_WEBKIT')=='1' else ['chromium']):
  browser=getattr(p,name).launch(headless=True)
  context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];forbidden=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def guard(route):
   req=route.request
   if req.method not in ['GET','HEAD','OPTIONS'] and req.url.split('?',1)[0] not in [base+'/api/maps/search',base+'/api/maps/snap',base+'/api/maps/route',base+'/api/quote']:
    forbidden.append(req.url);route.abort();return
   route.continue_()
  page.route('**/*',guard)
  page.goto(base,wait_until='domcontentloaded');page.locator('[data-category=light]').click()
  expect(page.locator('#request-map')).to_have_count(0)
  for field,label in [('pickup','الرياض'),('destination','الملك فهد')]:
   page.locator('#select-'+field).click();expect(page.locator('.map-picker .leaflet-container')).to_be_visible(timeout=30000)
   # Real map tiles, with the native tile scale and a single confirmation.
   page.wait_for_function("() => [...document.querySelectorAll('#picker-map img.leaflet-tile')].some(i=>i.complete&&i.naturalWidth>0)",timeout=30000)
   page.locator('#edit-place').click()
   page.locator('#place-query').fill(label);page.locator('#place-search button').click();expect(page.locator('.place-result').first).to_be_visible(timeout=30000)
   page.locator('.place-result').first.click()
   expect(page.locator('#pick-confirm')).to_be_enabled(timeout=30000);page.locator('#pick-confirm').click();expect(page.locator('.map-picker')).to_have_count(0)
  expect(page.locator('#request-map.leaflet-container')).to_be_visible(timeout=30000)
  page.wait_for_function("() => [...document.querySelectorAll('#request-map img.leaflet-tile')].some(i=>i.complete&&i.naturalWidth>0)",timeout=30000)
  expect(page.locator('.service-step')).to_be_visible()
  result=context.request.post(base+'/api/maps/snap',data={'point':{'lat':24.7136,'lng':46.6753}})
  assert result.ok,result.status
  assert result.json()['distanceMeters']<=250
  page.screenshot(path=str(OUT/(name+'-user-real-map.png')),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  assert not errors,errors
  assert not forbidden,forbidden
  (OUT/(name+'-report.json')).write_text(json.dumps({'provider':'OpenStreetMap','realTilesLoaded':True,'arabicSearchVerified':True,'nearestRoadVerified':True,'productionWrites':0,'errors':errors}))
  print('PASS',name,'real production map tiles, Arabic search and nearest road; no accounts/orders/GPS writes',flush=True)
  context.close();browser.close()
