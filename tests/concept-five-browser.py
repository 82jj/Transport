"""Concept 5 browser regression tests. API fixtures are intercepted in-browser;
no test accounts, orders, or writes are sent to production. --live adds read-only
screenshots of the real guest pages. Run: python tests/concept-five-browser.py.
"""
import argparse, json, os, shutil, subprocess, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from maps_browser_support import map_assets,choose_point

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'concept-five'; OUT.mkdir(parents=True,exist_ok=True)
CATALOG={
 'light':[{'id':'pickup-s','name':'بيك أب صغير','base':35,'km':3.2},{'id':'pickup-d','name':'بيك أب غمارتين','base':45,'km':3.6},{'id':'pickup-l','name':'بيك أب حمولة كبيرة','base':55,'km':4}],
 'heavy':[{'id':'dyna','name':'دينا','base':90,'km':6},{'id':'flatbed','name':'سطحة','base':110,'km':7},{'id':'trailer','name':'تريلة','base':220,'km':10}],
 'home':[{'id':'gas','name':'غاز','base':25,'km':1.5},{'id':'sweet-water','name':'ماء حلو','base':30,'km':1.5},{'id':'water-s','name':'وايت ماء صغير','base':90,'km':2},{'id':'water-m','name':'وايت ماء متوسط','base':130,'km':2.5},{'id':'water-l','name':'وايت ماء كبير','base':180,'km':3}]}
ORDER={'id':'browser-test-001','serviceId':'pickup-s','service':'بيك أب صغير','category':'light','pickup':'نقطة استلام الاختبار','destination':'وجهة تسليم الاختبار','distanceKm':8.2,'price':62,'total':62,'status':'searching','createdAt':'2026-10-03T10:00:00Z','captainAssigned':False,'unaccompanied':True}
REPORT=[]

def check(label):
 REPORT.append(label); print('PASS',label,flush=True)

def no_overflow(page):
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'

def fixture(page, role, logged=False, approved=True, orders=None, google=False, google_fail=False):
 map_assets(page)
 if google:page.route('https://maps.googleapis.com/maps/api/js**',lambda route:route.fulfill(content_type='text/javascript',body="window.gm_authFailure();" if google_fail else (ROOT/'tests/google-map-sdk-fixture.js').read_text()))
 state={'logged':logged,'approved':approved,'orders':list(orders or []),'writes':[],'fail_accept':False,'fail_create':False,'online':False,'pending_search':None,'hold_snap':False,'pending_snap':None,'fail_snap':False}
 def handle(route):
  req=route.request
  if not req.url.startswith('http://127.0.0.1:321'):route.fallback();return
  path=req.url.split('/api/',1)[1].split('?',1)[0]
  method=req.method
  if method!='GET':state['writes'].append((path,method,req.post_data_json))
  status=200; result={}
  if path=='maps/config':result={'provider':'Google' if google else 'OpenStreetMap','demo':bool(google),'browserKey':'browser-test-key','enabled':True,'routingReady':True,'tileUrl':'https://tile.openstreetmap.org/{z}/{x}/{y}.png','center':{'lat':24.7136,'lng':46.6753}}
  elif path=='maps/search':
   query=req.post_data_json['query']
   if query=='بحث متأخر':state['pending_search']=route;return
   if query=='بحث فاشل':status,result=503,{'error':'تعذر البحث الآن'}
   else:result={'results':[] if query=='بلا نتائج' else [{'id':'p','label':query,'lat':24.7136,'lng':46.6753}]}
   if google and result.get('results'):result['results']=[{'id':'google-fixture-place','placeId':'google-fixture-place','label':query,'sessionToken':req.post_data_json['sessionToken'],'provider':'Google'}]
  elif path=='maps/snap':
   if state['hold_snap']:state['pending_snap']=route;return
   if state['fail_snap']:status,result=503,{'error':'تعذر تحديد نقطة الوصول'}
   else:result={'point':req.post_data_json.get('point',{'lat':24.7136,'lng':46.6753}),'road':'شارع اختبار','distanceMeters':10}
  elif path=='maps/route':
   data=req.post_data_json;result={'distanceMeters':8200,'durationSeconds':600,'geometry':{'type':'LineString','coordinates':[[data['from']['lng'],data['from']['lat']],[data['to']['lng'],data['to']['lat']]]}}
  elif path=='services':result=CATALOG
  elif path=='quote':
   data=req.post_data_json; s=next(s for ss in CATALOG.values() for s in ss if s['id']==data['serviceId']); result={'serviceId':s['id'],'service':s['name'],'total':62,'currency':'SAR','distanceKm':data['distanceKm']}
  elif not path.startswith(role+'/'):status,result=404,{'error':'Role boundary crossed'}
  elif path==role+'/me':
   status=200 if state['logged'] else 401;result={'id':'fixture-account','name':'حساب اختبار','approved':state['approved'],'role':role,'applicationStatus':'approved' if state['approved'] else 'pending','documentsCurrent':True,'online':state['online'],'categories':['light'],'requestedCategories':['light'],'username':'WSFIXTURE'} if state['logged'] else {'error':'سجل الدخول أولاً'}
  elif path==role+'/login':state['logged']=True;result={'id':'fixture-account','name':'حساب اختبار','approved':state['approved'],'role':role,'online':state['online'],'applicationStatus':'approved','documentsCurrent':True,'categories':['light']}
  elif path=='captain/availability':state['online']=req.post_data_json['online'];result={'online':state['online']}
  elif path==role+'/register':result={'ok':True}
  elif path==role+'/logout':state['logged']=False;result={'ok':True}
  elif not state['logged']:status,result=401,{'error':'سجل الدخول أولاً'}
  elif path==role+'/orders' and method=='GET':result=state['orders']
  elif path=='user/orders' and method=='POST':
   if state['fail_create']:status,result=503,{'error':'خطأ تجريبي في الاتصال'}
   else:
    data=req.post_data_json;s=next(s for ss in CATALOG.values() for s in ss if s['id']==data['serviceId']);o={**ORDER,**data,'service':s['name']};state['orders']=[o];result=o
  elif path.endswith('/tracking'):result={**(state['orders'][0] if state['orders'] else {}),'location':None,'stale':False}
  elif path.endswith('/location-sharing'):result={'enabled':True}
  elif path.endswith('/location'):result={'ok':True}
  elif path.endswith('/accept'):
   if state['fail_accept']:status,result=409,{'error':'قبله كابتن آخر أو تغيرت حالته'}
   else:state['orders'][0].update(status='accepted',captainAssigned=True);result=state['orders'][0]
  elif path.endswith('/status'):state['orders'][0]['status']=req.post_data_json['status'];result=state['orders'][0]
  elif path.endswith('/cancel'):state['orders'][0]['status']='cancelled';result=state['orders'][0]
  else:status,result=404,{'error':'Unknown endpoint '+path}
  route.fulfill(status=status,content_type='application/json',body=json.dumps(result))
 page.route('**/api/**',handle)
 return state

args=argparse.ArgumentParser();args.add_argument('--live',action='store_true');args=args.parse_args()
processes=[]
try:
 for role,port in [('user',3211),('captain',3212)]:
  env={**os.environ,'PORT':str(port),'NODE_ENV':'test','API_ORIGIN':'http://127.0.0.1:3999','PUBLIC_ORIGIN':f'http://127.0.0.1:{port}'}
  p=subprocess.Popen(['node',str(ROOT/f'apps/{role}/server.js')],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE); processes.append(p)
  for _ in range(80):
   try:urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz',timeout=1);break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('Frontend failed: '+p.stderr.read().decode())
 with sync_playwright() as pw:
  for engine in ['chromium','webkit'] if os.environ.get('TEST_WEBKIT')=='1' else ['chromium']:
   options={'headless':True}
   if engine=='chromium' and os.environ.get('BROWSER_EXECUTABLE'):options['executable_path']=os.environ['BROWSER_EXECUTABLE']
   browser=getattr(pw,engine).launch(**options)
   for width in [320,390,430,1024]:
    ctx=browser.new_context(viewport={'width':width,'height':844},device_scale_factor=1)
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    fixture(page,'user');page.goto('http://127.0.0.1:3211/');expect(page.locator('.category-card')).to_have_count(3)
    images=page.locator('.category-card img.service-art')
    expect(images).to_have_count(3)
    assert images.evaluate_all('(items)=>items.map(image=>image.getAttribute("src"))')==['/pickup-side.webp','/flatbed-side.webp','/water-tanker-side.webp']
    page.wait_for_function('() => [...document.querySelectorAll(".category-card img.service-art")].every(image => image.complete && image.naturalWidth > 0)')
    no_overflow(page)
    assert 'ثلاث واجهات' not in page.inner_text('body')
    if width==390:page.screenshot(path=str(OUT/f'{engine}-user-home.png'),full_page=True)
    assert not errors,errors;ctx.close()
   check(engine+': user responsive 320/390/430/1024, three illustrated cards, no role chooser')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   st=fixture(page,'user');page.goto('http://127.0.0.1:3211/');page.locator('[data-category=home]').click()
   expect(page.locator('#service option')).to_have_count(5)
   expect(page.locator('.service-step')).not_to_be_visible();expect(page.locator('#request-map')).to_have_count(0)
   page.screenshot(path=str(OUT/f'{engine}-user-location-search.png'),full_page=True)
   # The destination is directly editable; search results select a real map point.
   expect(page.locator('#destination')).to_be_editable()
   page.locator('#destination').fill('عنوان الاختبار');expect(page.locator('#destination-results .place-result')).to_have_count(1)
   st['hold_snap']=True;page.locator('#destination').press('ArrowDown');page.locator('#destination').press('Enter')
   for _ in range(100):
    if st['pending_snap']:break
    page.wait_for_timeout(20)
   assert st['pending_snap'];page.locator('#pickup').fill('بحث أثناء الحفظ')
   st['hold_snap']=False;st['pending_snap'].fulfill(status=200,content_type='application/json',body=json.dumps({'point':{'lat':24.7136,'lng':46.6753},'road':'شارع','distanceMeters':10}))
   expect(page.locator('#pickup')).to_have_value('بحث أثناء الحفظ');expect(page.locator('#pickup-results .place-result')).to_contain_text('بحث أثناء الحفظ')
   expect(page.locator('#destination-results')).not_to_be_visible();expect(page.locator('.map-picker')).to_have_count(0)
   expect(page.locator('#destination')).to_have_value('عنوان الاختبار');expect(page.locator('.service-step')).not_to_be_visible()
   choose_point(page,'pickup','موقع خاص <img src=x onerror=alert(1)>');page.locator('#alone').check()
   expect(page.locator('.service-step')).to_be_visible();expect(page.locator('#request-route-status')).to_contain_text('10 دقيقة')
   # Editing the label must discard the selected point and any existing quote.
   page.get_by_role('button',name='عرض السعر التجريبي',exact=True).click();expect(page.locator('#confirm-order')).to_be_visible()
   page.locator('#destination').fill('بلا نتائج');expect(page.locator('#quote')).to_be_empty();expect(page.locator('#destination-search-status')).to_contain_text('لم نجد')
   expect(page.locator('.service-step')).not_to_be_visible();expect(page.locator('.request-map-panel')).not_to_be_visible()
   page.locator('#destination').fill('بحث فاشل');expect(page.locator('#destination-search-status')).to_contain_text('تعذر البحث الآن')
   page.locator('#destination').fill('بحث متأخر');expect(page.locator('#destination-search-status')).to_contain_text('جاري البحث')
   page.wait_for_function('document.querySelector("#destination-search-status").textContent.includes("جاري البحث")')
   # Wait for the intercepted request without blocking the browser event loop.
   for _ in range(100):
    if st['pending_search']:break
    page.wait_for_timeout(20)
   assert st['pending_search']
   page.locator('#destination').fill('نتيجة حديثة');expect(page.locator('#destination-results')).to_contain_text('نتيجة حديثة')
   st['pending_search'].fulfill(status=200,content_type='application/json',body=json.dumps({'results':[{'label':'بحث متأخر','lat':24.71,'lng':46.67}]}))
   expect(page.locator('#destination-results')).to_contain_text('نتيجة حديثة');expect(page.locator('#destination-results')).not_to_contain_text('بحث متأخر')
   page.locator('#select-destination').click();expect(page.locator('#pick-confirm')).to_be_enabled();page.locator('.map-picker .close').click()
   expect(page.locator('#destination')).to_have_value('نتيجة حديثة')
   # A road lookup finishing after the address is edited cannot commit an old choice.
   st['hold_snap']=True;page.locator('#destination-results .place-result').click()
   for _ in range(100):
    if st['pending_snap']:break
    page.wait_for_timeout(20)
   assert st['pending_snap'];page.locator('#destination').fill('عنوان جديد')
   st['hold_snap']=False;st['pending_snap'].fulfill(status=200,content_type='application/json',body=json.dumps({'point':{'lat':24.7136,'lng':46.6753},'road':'شارع قديم','distanceMeters':10}))
   expect(page.locator('#destination')).to_have_value('عنوان جديد');expect(page.locator('.service-step')).not_to_be_visible()
   choose_point(page,'destination','عنوان الاختبار')
   check(engine+': search-first locations, direct keyboard selection, one-tap map approval, route and services after both points, cleared quote/point on edit, stale search/snap ignored and cancel preserves draft')
   page.locator('[data-category=heavy]').click();expect(page.locator('#pickup')).to_have_value('موقع خاص <img src=x onerror=alert(1)>');expect(page.locator('#service option')).to_have_count(3)
   page.get_by_role('button',name='عرض السعر التجريبي',exact=True).click();expect(page.locator('#confirm-order')).to_be_visible()
   choose_point(page,'destination','وجهة أخرى');expect(page.locator('#quote')).to_be_empty()
   page.get_by_role('button',name='عرض السعر التجريبي',exact=True).click();page.locator('#confirm-order').click();expect(page.locator('#account')).to_be_visible()
   page.locator('#account [name=email]').fill('fixture@example.test');page.locator('#account [name=password]').fill('browser-test-password-not-production');page.locator('#account [type=submit]').click();expect(page.locator('#confirm-order')).to_be_visible()
   st['fail_create']=True;page.locator('#confirm-order').click();expect(page.locator('#toast')).to_contain_text('خطأ تجريبي');expect(page.locator('#confirm-order')).to_be_enabled();st['fail_create']=False
   page.locator('#confirm-order').click();expect(page.locator('[data-screen=track]')).to_be_visible();no_overflow(page);assert len(st['orders'])==1
   assert st['orders'][0]['unaccompanied'];assert page.locator('.locations img').count()==0
   expect(page.locator('#toast')).not_to_be_visible(timeout=6000)
   assert not page.locator('.concept-nav').is_visible()
   page.screenshot(path=str(OUT/f'{engine}-user-tracking-fixture.png'),full_page=True)
   assert page.locator('.contact-actions button:disabled').count()==2
   page.on('dialog',lambda dialog:dialog.accept());page.locator('#cancel-order').click();expect(page.locator('.screen-header h1')).to_have_text('ملغي')
   assert not errors,errors;ctx.close();check(engine+': request, preserved draft, quote invalidation, login, create failure/retry, escaped addresses, tracking and cancellation')
   ctx=browser.new_context(viewport={'width':390,'height':844},geolocation={'latitude':24.7136,'longitude':46.6753,'accuracy':10},permissions=['geolocation'])
   page=ctx.new_page();st=fixture(page,'user');page.goto('http://127.0.0.1:3211/');page.get_by_role('button',name='طلب جديد',exact=True).click()
   st['hold_snap']=True;page.locator('#select-pickup').click()
   for _ in range(100):
    if st['pending_snap']:break
    page.wait_for_timeout(20)
   assert st['pending_snap'];expect(page.locator('#pick-confirm')).to_be_disabled()
   page.locator('.map-picker .close').click();st['hold_snap']=False
   st['pending_snap'].fulfill(status=200,content_type='application/json',body=json.dumps({'point':{'lat':24.7136,'lng':46.6753},'road':'شارع قديم','distanceMeters':10}))
   expect(page.locator('#pickup')).to_have_value('');expect(page.locator('.service-step')).not_to_be_visible()
   st['fail_snap']=True;page.locator('#select-pickup').click();expect(page.locator('#pick-confirm')).to_have_text('إعادة المحاولة')
   st['fail_snap']=False;page.locator('#pick-confirm').click();expect(page.locator('#pick-confirm')).to_have_text('تأكيد موقع الالتقاء');expect(page.locator('#pick-confirm')).to_be_enabled()
   page.locator('.map-picker .close').click();page.locator('#auto-pickup').click()
   expect(page.locator('#picked-name')).to_have_text('موقعي الحالي');expect(page.locator('#pick-confirm')).to_be_enabled();no_overflow(page)
   page.screenshot(path=str(OUT/f'{engine}-user-pickup-confirmation.png'),full_page=True)
   page.locator('#pick-confirm').click();expect(page.locator('#pickup')).to_have_value('موقعي الحالي');expect(page.locator('.map-picker')).to_have_count(0)
   ctx.close();check(engine+': GPS pickup confirmed once, snap error retry, cancelled pending lookup cannot change draft')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   st=fixture(page,'user',google=True);sdk=[];page.on('request',lambda r:sdk.append(r.url) if r.url.startswith('https://maps.googleapis.com/maps/api/js?') else None)
   page.goto('http://127.0.0.1:3211/');expect(page.locator('[data-map-provider-label]')).to_have_text('Google (تجريبي)');page.locator('[data-category=light]').click()
   page.locator('#pickup').fill('مكان من Google');expect(page.locator('#pickup-results .maps-attribution')).to_have_text('Google Maps')
   page.locator('#pickup-results .place-result').click();expect(page.locator('#pickup-results')).not_to_be_visible()
   choose_point(page,'destination','وجهة Google')
   expect(page.locator('#request-map')).to_have_attribute('data-map-provider','Google');expect(page.locator('#request-map')).to_have_attribute('data-map-ready','true');expect(page.locator('.service-step')).to_be_visible()
   assert len(sdk)==1;assert 'language=ar' in sdk[0];assert 'region=SA' in sdk[0]
   assert page.evaluate("document.querySelector('style[nonce]').nonce===document.querySelector('script[nonce]').nonce")
   expect(page.locator('#request-route-status')).to_contain_text('10 دقيقة');expect(page.locator('#request-map')).to_have_attribute('data-map-fit-points','4')
   selections=[body for path,method,body in st['writes'] if path=='maps/snap' and 'placeId' in body];assert len(selections)==2;assert all('sessionToken' in body and 'point' not in body for body in selections)
   page.locator('#select-pickup').click();expect(page.locator('#pick-confirm')).to_be_enabled();page.locator('.map-picker .close').click();expect(page.locator('#pickup')).to_have_value('مكان من Google')
   assert not errors,errors;ctx.close();check(engine+': Google SDK contract fixture: Arabic loader once, place ID resolution, attribution, one-confirm map and preserved draft (not real Google imagery)')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();fixture(page,'user',google=True,google_fail=True)
   page.goto('http://127.0.0.1:3211/');page.locator('[data-category=light]').click();page.locator('#select-pickup').click()
   expect(page.locator('#picker-map.map-error')).to_contain_text('Google');expect(page.locator('#pick-confirm')).to_be_disabled();page.locator('.map-picker .close').click();expect(page.locator('#pickup')).to_have_value('')
   ctx.close();check(engine+': Google loader failure disables confirmation and does not save a false location')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();st=fixture(page,'captain',logged=True,approved=False);page.goto('http://127.0.0.1:3212/');expect(page.locator('#online')).to_be_disabled();expect(page.locator('body')).to_contain_text('حسابك قيد المراجعة');assert not st['writes'];ctx.close();check(engine+': unapproved captain cannot receive/accept requests')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   st=fixture(page,'captain',logged=True,approved=True,orders=[dict(ORDER)]);page.goto('http://127.0.0.1:3212/');page.locator('#online').click();page.locator('[data-order]').click();expect(page.locator('[data-screen=offer]')).to_be_visible();no_overflow(page);assert not page.locator('.concept-nav').is_visible();page.screenshot(path=str(OUT/f'{engine}-captain-offer-fixture.png'),full_page=True)
   page.locator('#decline-order').click();assert not any('/accept' in x[0] for x in st['writes']);expect(page.locator('body')).to_contain_text('لا توجد طلبات جديدة');check(engine+': decline only hides the offer; never accepts or mutates its status')
   page.reload();page.locator('[data-order]').click();page.locator('#accept-order').click();expect(page.locator('[data-screen=trip]')).to_be_visible();assert sum('/accept' in x[0] for x in st['writes'])==1
   for status in ['to_pickup','arrived','in_transit']:
    page.locator('#progress-order').click();expect(page.locator('#progress-order')).to_be_enabled();assert st['orders'][0]['status']==status
   page.screenshot(path=str(OUT/f'{engine}-captain-trip-fixture.png'),full_page=True)
   page.locator('.screen-header [data-view=orders]').click();page.locator('[data-view=home]').click();page.locator('#online').click();expect(page.locator('[data-order]')).to_have_count(1);page.locator('[data-order]').click()
   dismiss=lambda dialog:dialog.dismiss();page.on('dialog',dismiss);page.locator('#progress-order').click();assert st['orders'][0]['status']=='in_transit';page.remove_listener('dialog',dismiss)
   page.on('dialog',lambda dialog:dialog.accept());page.locator('#progress-order').click();expect(page.locator('.receipt')).to_be_visible();assert st['orders'][0]['status']=='delivered';no_overflow(page)
   assert not errors,errors;ctx.close();check(engine+': accept once, all trip transitions, active trip visible while offline, delivery confirmation and receipt')
   ctx=browser.new_context(viewport={'width':390,'height':844});page=ctx.new_page();st=fixture(page,'captain',logged=True,orders=[dict(ORDER)]);st['fail_accept']=True;page.goto('http://127.0.0.1:3212/');page.locator('#online').click();page.locator('[data-order]').click();page.locator('#accept-order').click();expect(page.locator('#toast')).to_contain_text('قبله كابتن آخر');assert st['orders'][0]['status']=='searching';ctx.close();check(engine+': competing acceptance is displayed without false success')
   if args.live:
    for role in ['user','captain']:
     ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
     page=ctx.new_page();map_assets(page);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
     mutations=[];page.on('request',lambda r:mutations.append(r.url) if r.method not in ['GET','HEAD','OPTIONS'] else None)
     page.goto(f'https://transport-{role}-isolated-production.up.railway.app/',wait_until='networkidle')
     expect(page.locator('html')).to_have_attribute('data-design','concept-5');expect(page.locator('.concept-five')).to_be_visible();no_overflow(page)
     assert 'ثلاث واجهات' not in page.inner_text('body');assert not errors,errors;assert not mutations,mutations
     page.screenshot(path=str(OUT/f'{engine}-{role}-live.png'),full_page=True);ctx.close()
    check(engine+': both real public pages rendered, no JS errors, no overflow and zero production mutations')
   browser.close()
 (OUT/'report.json').write_text(json.dumps({'checks':REPORT,'screenshots':'Fixtures are clearly identified in filenames; *-live.png are read-only production screenshots.'},ensure_ascii=False,indent=2))
finally:
 for p in processes:
  p.terminate()
  try:p.wait(timeout=4)
  except subprocess.TimeoutExpired:p.kill()
