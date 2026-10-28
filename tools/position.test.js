const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../plugin/main.js'), 'utf8');
const core = require('../plugin/core.js');

// No GUI needed: exercise the real BetterNCM plugin startup and 100ms bridge.
// Crucially validates that negative multi-monitor coordinates are preserved.
function boot(options={}) {
  const saved={ 'desktop-visible-v1':true, ...options };
  const calls=[], writes=[], timers=[];
  let onLoad, onUnload, beforeUnload, changed='', actualPosition='120,345';
  const plugin={
    getConfig:(k,d)=>saved[k]===undefined?d:saved[k],
    setConfig:(k,v)=>{saved[k]=v;writes.push({k,v})},
    onLoad:fn=>onLoad=fn,
    onUnload:fn=>onUnload=fn,
    onConfig:()=>{}
  };
  const api={
    call(id,args=[]) {
      calls.push({id,args});
      if(id==='floatingcloud.ping')return 'native-loaded';
      if(id==='floatingcloud.open')return 'started';
      if(id==='floatingcloud.getPosition')return actualPosition;
      if(id==='floatingcloud.movedPosition') {
        const value=changed; changed=''; return value;
      }
      if(id==='floatingcloud.poll')return '';
      return 'ok';
    }
  };
  const window={
    FloatingCloudCore:core,
    betterncm_native:{native_plugin:api},
    InfLinkApi:{
      getCurrentSong:()=>null,
      getTimeline:()=>({currentTime:0}),
      getPlaybackStatus:()=> 'Paused',
      addEventListener:()=>{},removeEventListener:()=>{}
    },
    addEventListener:(name,callback)=>{if(name==='beforeunload')beforeUnload=callback},
    matchMedia:()=>({matches:false})
  };
  const context={
    window,plugin,console,
    performance:{now:()=>0},AbortController,
    setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length},
    clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},
    fetch:async()=>{throw new Error('Unexpected internet call')}
  };
  vm.runInNewContext(main,context,{filename:'plugin/main.js'});
  assert.equal(typeof onLoad,'function');
  onLoad();
  const tick=()=>{const t=timers.find(t=>t.ms===100);assert.ok(t);t.fn()};
  return {saved,calls,writes,tick,
    move:(x,y)=>{actualPosition=x+','+y;changed=actualPosition;},
    repositionWithoutDrag:(x,y)=>{actualPosition=x+','+y;},
    unload:()=>onUnload?.(),
    beforeUnload:()=>beforeUnload?.()
  };
}
test('saved secondary-monitor coordinates are restored after size but before show',()=>{
 const h=boot({'desktop-position-v1':{x:-1250,y:340}});
 const ids=h.calls.map(c=>c.id);
 assert.ok(ids.indexOf('floatingcloud.setInitialPosition')<ids.indexOf('floatingcloud.open'));
 assert.equal(h.calls.find(c=>c.id==='floatingcloud.setInitialPosition').args[0],'-1250,340');
 assert.ok(ids.indexOf('floatingcloud.width')<ids.indexOf('floatingcloud.setPosition'));
 assert.ok(ids.indexOf('floatingcloud.height')<ids.indexOf('floatingcloud.setPosition'));
 assert.ok(ids.indexOf('floatingcloud.setPosition')<ids.indexOf('floatingcloud.show'));
 assert.equal(h.calls.find(c=>c.id==='floatingcloud.setPosition').args[0],'-1250,340');
});
test('drag end writes position once and survives closing/restarting',()=>{
 const h=boot();
 assert.equal(h.calls.some(c=>c.id==='floatingcloud.setPosition'),false);
 h.move(-830,510);h.tick();
 assert.equal(h.saved['desktop-position-v1'].x,-830);
 assert.equal(h.saved['desktop-position-v1'].y,510);
 const writes=h.writes.filter(w=>w.k==='desktop-position-v1').length;
 h.tick();
 assert.equal(h.writes.filter(w=>w.k==='desktop-position-v1').length,writes);
 h.unload();
 assert.equal(h.saved['desktop-position-v1'].x,-830);
 assert.equal(h.saved['desktop-position-v1'].y,510);
 const restarted=boot({...h.saved});
 assert.equal(restarted.calls.find(c=>c.id==='floatingcloud.setPosition').args[0],'-830,510');
});
test('malformed/offscale positions are ignored without breaking startup',()=>{
 for(const bad of [{x:NaN,y:5},{x:100001,y:0},{x:'200',y:100},'200,300']) {
   const h=boot({'desktop-position-v1':bad});
   assert.equal(h.calls.some(c=>c.id==='floatingcloud.setPosition'),false);
 }
});

test('startup/resize/OS-induced window coordinates never rewrite saved placement on shutdown',()=>{
 const h=boot({'desktop-position-v1':{x:-925,y:260}});
 // These are transient HWND coordinates, not user drags. Historically both
 // disable and shutdown persisted GetWindowRect and caused restart drift.
 h.repositionWithoutDrag(-925,322);
 h.unload();
 assert.equal(h.saved['desktop-position-v1'].x,-925);
 assert.equal(h.saved['desktop-position-v1'].y,260);
 assert.equal(h.writes.filter(w=>w.k==='desktop-position-v1').length,0);
 assert.equal(h.calls.filter(c=>c.id==='floatingcloud.getPosition').length,0);
 const restarted=boot({...h.saved});
 assert.equal(restarted.calls.find(c=>c.id==='floatingcloud.setPosition').args[0],'-925,260');
});
test('drag completion just before shutdown is flushed once to config',()=>{
 const h=boot({'desktop-position-v1':{x:120,y:150}});
 h.move(124,352);
 h.beforeUnload();
 assert.equal(h.saved['desktop-position-v1'].x,124);
 assert.equal(h.saved['desktop-position-v1'].y,352);
 assert.equal(h.writes.filter(w=>w.k==='desktop-position-v1').length,1);
 h.unload();
 assert.equal(h.writes.filter(w=>w.k==='desktop-position-v1').length,1);
});

test('dragged coordinate is staged BEFORE creating HWND on every restart',()=>{
 const first=boot();
 first.move(-700,206);
 first.tick();
 const expected=first.saved['desktop-position-v1'];
 assert.equal(expected.x,-700);
 assert.equal(expected.y,206);
 for(let i=0;i<4;i++){
   const restart=boot({'desktop-position-v1':expected});
   const events=restart.calls.map(x=>x.id);
   assert.ok(events.indexOf('floatingcloud.setInitialPosition')<events.indexOf('floatingcloud.open'));
   assert.equal(restart.calls.find(x=>x.id==='floatingcloud.setInitialPosition').args[0],'-700,206');
   assert.equal(restart.calls.find(x=>x.id==='floatingcloud.setPosition').args[0],'-700,206');
   restart.repositionWithoutDrag(-700,206+27*(i+1));
   restart.unload();
   assert.equal(restart.saved['desktop-position-v1'].y,206);
 }
});

test('settings panel describes saved and actual window coordinates for drift reports',()=>{
 const h=boot({'desktop-position-v1':{x:-400,y:212}});
 assert.equal(h.saved['desktop-position-v1'].y,212);
 const panel=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
 assert.ok(panel.includes('位置存档 '));
 assert.ok(panel.includes('当前窗口 '));
});
