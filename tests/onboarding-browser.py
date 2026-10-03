"""End-to-end onboarding and foreground GPS on real isolated HTTP services.
No production reads, accounts, files or orders. Browser screenshots contain test data.
"""
import base64,json,os,subprocess,tempfile,time,urllib.request,socket
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from maps_browser_support import map_assets,choose_point
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'onboarding';OUT.mkdir(parents=True,exist_ok=True)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
def free_port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
def overflow(page):assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'horizontal overflow'
def foreground(page):
 page.bring_to_front()
 page.wait_for_function("document.visibilityState === 'visible'")
with tempfile.TemporaryDirectory(prefix='wasil-browser-') as data:
 processes=[];hosts={}
 maps_port=free_port();processes.append(subprocess.Popen(['node',str(ROOT/'tests/map-test-server.mjs')],env={**os.environ,'PORT':str(maps_port)},stdout=subprocess.DEVNULL));time.sleep(.3)
 try:
  for role in ['api','captain','user','admin']:
   port=free_port();hosts[role]=f'http://127.0.0.1:{port}'
   env={**os.environ,'PORT':str(port),'NODE_ENV':'test','DATA_DIR':data,'MAPS_ORIGIN':f'http://127.0.0.1:{maps_port}','ADMIN_EMAIL':'admin@example.test','ADMIN_PASSWORD':'AdminTestPassword2026!','API_ORIGIN':hosts['api'],'PUBLIC_ORIGIN':hosts[role]}
   p=subprocess.Popen(['node','server.js'],cwd=ROOT/f'apps/{role}',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);processes.append(p)
   for _ in range(100):
    try:urllib.request.urlopen(hosts[role]+'/healthz',timeout=1);break
    except Exception:time.sleep(.05)
   else:raise RuntimeError('startup failed')
  with sync_playwright() as pw:
   for n,engine in enumerate(['chromium','webkit'] if os.environ.get('TEST_WEBKIT')=='1' else ['chromium'],1):
    browser=getattr(pw,engine).launch(headless=True,**({'executable_path':os.environ['BROWSER_EXECUTABLE']} if engine=='chromium' and os.environ.get('BROWSER_EXECUTABLE') else {}))
    contexts=[browser.new_context(viewport={'width':390,'height':844}) for _ in range(3)]
    cc,ac,uc=contexts;cc.grant_permissions(['geolocation']);cc.set_geolocation({'latitude':24.7136,'longitude':46.6753,'accuracy':10});cp=cc.new_page();ap=ac.new_page();up=uc.new_page();errors=[]
    for p in [cp,ap,up]:
     map_assets(p);p.on('pageerror',lambda e:errors.append(str(e)))
    foreground(cp);cp.goto(hosts['captain']);cp.locator('.welcome-card [data-account]').click();cp.locator('#register-toggle').click()
    expect(cp.locator('#captain-application')).to_be_visible()
    cp.locator('[name=phone]').fill('050'+str(900+n).zfill(7));cp.locator('[name=email]').fill(f'captain{n}@example.test');cp.locator('[name=password]').fill('SecurePass1');cp.locator('[name=confirmPassword]').fill('Mismatch1');cp.locator('#application-next').click();expect(cp.locator('#application-error')).to_contain_text('غير مطابق')
    cp.locator('[name=confirmPassword]').fill('SecurePass1');cp.locator('#application-next').click()
    cp.locator('[name=fullName]').fill('أحمد محمد عبدالله التجريبي');cp.locator('[name=identityNumber]').fill('1'+str(900+n).zfill(9));cp.locator('[name=vehicleType]').fill('بيك أب');cp.locator('[name=vehicleModel]').fill('تويوتا هايلكس');cp.locator('[name=vehicleYear]').fill('2024');cp.locator('[name=vehicleVin]').fill('JT123456789012345');cp.locator('[name=categories][value=light]').check();cp.locator('#application-next').click()
    for name in ['licenseExpiry','registrationExpiry','insuranceExpiry']:cp.locator('[name='+name+']').fill('2090-01-01')
    for kind in ['license','registration','insurance','exterior','interior']:cp.locator('[data-file='+kind+']').set_input_files({'name':'fixture.png','mimeType':'image/png','buffer':PNG})
    cp.locator('#application-next').click();overflow(cp);cp.screenshot(path=str(OUT/f'{engine}-application-terms-fixture.png'),full_page=True)
    cp.locator('#terms-accepted').check();cp.locator('#application-next').click();expect(cp.locator('body')).to_contain_text('حسابك قيد المراجعة');expect(cp.locator('#online')).to_be_disabled()
    foreground(ap);ap.goto(hosts['admin']);ap.locator('#admin-login').click();ap.locator('[name=email]').fill('admin@example.test');ap.locator('[name=password]').fill('AdminTestPassword2026!');ap.locator('form [type=submit]').click();expect(ap.locator('[data-review]')).to_be_visible();ap.locator('[data-review]').first.click();expect(ap.locator('.review-data')).to_contain_text('تويوتا هايلكس');expect(ap.locator('.review-files article')).to_have_count(5)
    ap.locator('#review-form button[value=rejected]').click();expect(ap.locator('#review-error')).to_contain_text('سبب الرفض');ap.locator('[name=reason]').fill('يرجى توضيح بيانات المركبة');ap.on('dialog',lambda d:d.accept());ap.locator('#review-form button[value=rejected]').click()
    expect(ap.locator('.review-dialog .badge')).to_have_text('مرفوض');expect(ap.locator('.review-dialog')).to_contain_text('يرجى توضيح بيانات المركبة')
    foreground(cp);cp.locator('#refresh-approval').click();expect(cp.locator('body')).to_contain_text('تم رفض طلب التسجيل');cp.locator('#complete-application').click()
    for _ in range(3):cp.locator('#application-next').click()
    cp.locator('#terms-accepted').check();cp.locator('#application-next').click();expect(cp.locator('body')).to_contain_text('حسابك قيد المراجعة')
    foreground(ap);ap.locator('#close-review').click();ap.locator('#refresh').click();ap.locator('[data-review]').first.click();ap.locator('#review-form button[value=approved]').click();expect(ap.locator('.review-dialog')).to_contain_text('رسائل النتيجة');expect(ap.locator('.review-dialog .badge')).to_have_text('مقبول');ap.screenshot(path=str(OUT/f'{engine}-admin-decision-fixture.png'),full_page=True)
    foreground(cp);cp.locator('#refresh-approval').click();expect(cp.locator('#online')).to_be_enabled();expect(cp.locator('body')).to_contain_text('اسم المستخدم: WS');cp.locator('#online').click();expect(cp.locator('#online')).to_have_attribute('aria-pressed','true')
    for path,payload in [('register',{'name':'مستخدم اختبار','email':f'user{n}@example.test','password':'SecurePass1'}),('login',{'email':f'user{n}@example.test','password':'SecurePass1'})]:assert uc.request.post(hosts['user']+'/api/user/'+path,data=payload).ok
    foreground(up);up.goto(hosts['user']);up.get_by_role('button',name='طلباتي',exact=True).click();up.get_by_role('button',name='طلب مشوار جديد',exact=True).click();expect(up.locator('#request-form')).to_be_visible();choose_point(up,'pickup','نقطة اختبار');choose_point(up,'destination','وجهة اختبار');up.get_by_role('button',name='عرض السعر التجريبي',exact=True).click();up.locator('#confirm-order').click();expect(up.locator('[data-screen=track]')).to_be_visible()
    heavy=uc.request.post(hosts['user']+'/api/user/orders',data={'serviceId':'dyna','pickup':'أ','destination':'ب','distanceKm':8,'unaccompanied':False}).json()
    # Foreground and refresh the sensor mock after onboarding. WebKit correctly retains
    # the timestamp from set_geolocation, so the old onboarding fix must not be reused
    # after per-trip consent. Do not rewrite timestamps or weaken API freshness checks.
    foreground(cp);cp.locator('#refresh').click();expect(cp.locator('[data-order]')).to_have_count(1);cp.locator('[data-order]').click();expect(cp.locator('[data-screen=offer]')).to_be_visible();cc.set_geolocation({'latitude':24.7136,'longitude':46.6753,'accuracy':10});cp.locator('#accept-order').click();expect(cp.locator('[data-screen=trip]')).to_be_visible()
    response=cc.request.post(hosts['captain']+f"/api/captain/orders/{heavy['id']}/accept",data={});assert response.status==403
    trip=next(o for o in uc.request.get(hosts['user']+'/api/user/orders').json() if o['serviceId']=='pickup-s')
    tracking=hosts['user']+f"/api/user/orders/{trip['id']}/tracking"
    for _ in range(60):
     latest=uc.request.get(tracking).json()
     if latest.get('location'):break
     cp.wait_for_timeout(250)
    assert latest.get('location') and abs(latest['location']['lat']-24.7136)<.00001,{'tracking':latest,'gps':cp.locator('[data-gps-status]').inner_text(),'visibility':cp.evaluate('document.visibilityState')}
    foreground(up);expect(up.locator('.captain-map-marker')).to_be_visible(timeout=12000)
    foreground(cp);cp.wait_for_timeout(2200);cc.set_geolocation({'latitude':24.717,'longitude':46.679,'accuracy':12})
    for _ in range(60):
     latest=uc.request.get(tracking).json()
     if latest.get('location') and abs(latest['location']['lat']-24.717)<.00001:break
     cp.wait_for_timeout(250)
    assert latest.get('location') and abs(latest['location']['lat']-24.717)<.00001,latest
    assert latest['stage']=='pickup'
    cp.screenshot(path=str(OUT/f'{engine}-live-map-gps-fixture.png'),full_page=True)
    cp.locator('[data-gps-toggle]').click();expect(cp.locator('[data-gps-toggle]')).to_have_attribute('aria-pressed','false')
    for _ in range(20):
     if uc.request.get(tracking).json().get('location') is None:break
     cp.wait_for_timeout(100)
    assert uc.request.get(tracking).json()['location'] is None
    for _ in range(3):
     cp.locator('#progress-order').click();expect(cp.locator('#progress-order')).to_be_enabled()
    assert uc.request.get(tracking).json()['stage']=='destination'
    cp.locator('.screen-header [data-view=orders]').click();cp.locator('[data-view=home]').click();cp.locator('#online').click();expect(cp.locator('#online')).to_have_attribute('aria-pressed','false');expect(cp.locator('[data-order]')).to_have_count(1)
    for p in [cp,up]:overflow(p)
    assert not errors,errors
    for c in contexts:c.close()
    browser.close();print('PASS',engine,'real registration/upload/review/order and foreground geolocation/route-stage/stop',flush=True)
 finally:
  for p in processes:
   p.terminate()
   try:p.wait(timeout=4)
   except subprocess.TimeoutExpired:p.kill()
