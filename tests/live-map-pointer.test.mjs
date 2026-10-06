import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('live map hold resolves redrawn pins after scrolling and always releases the pointer', () => {
 const result=spawnSync('python3',['-c',String.raw`
import ast
from pathlib import Path
source=ast.parse(Path('tests/live-map-browser.py').read_text())
helper=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='hold')
events=[]
class Mouse:
 def move(self,x,y): events.append(('move',x,y))
 def down(self): events.append('down')
 def up(self): events.append('up')
class Locator:
 def __init__(self,page,selector):
  self.page,self.selector,self.version=page,selector,page.version
 def scroll_into_view_if_needed(self):
  assert self.selector=='#request-map', 'A replaceable overlay must not be scrolled'
  events.append('scroll-map')
  self.page.version+=1
 def bounding_box(self):
  assert self.version==self.page.version, 'Coordinates came from a removed pin'
  events.append('current-box')
  return None if self.page.missing else {'x':100,'y':200,'width':32,'height':40}
class Page:
 version=0
 missing=False
 fail_wait=False
 mouse=Mouse()
 def locator(self,selector): return Locator(self,selector)
 def wait_for_timeout(self,ms):
  assert ms==680
  if self.fail_wait: raise RuntimeError('page closed')
class Expected:
 def __init__(self,locator): self.locator=locator
 def to_be_visible(self,timeout):
  assert timeout==30000
  assert self.locator.version==self.locator.page.version
scope={'expect':Expected}
exec(compile(ast.Module(body=[helper],type_ignores=[]),'<live-map-hold>','exec'),scope)
page=Page()
scope['hold'](page,'#request-map [data-location-pin=pickup]',(.5,.5))
assert events==['scroll-map','current-box',('move',116,220),'down','up'],events
events.clear()
page.fail_wait=True
try: scope['hold'](page)
except RuntimeError: pass
else: raise AssertionError('Pointer error was swallowed')
assert events[-2:]==['down','up'],events
events.clear()
page.fail_wait=False
page.missing=True
try: scope['hold'](page)
except AssertionError: pass
else: raise AssertionError('Missing coordinates counted as a hold')
assert 'down' not in events
print('PASS redraw race, native hold, pointer cleanup and missing target')
`],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
