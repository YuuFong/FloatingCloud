const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../plugin/core.js');

class FakeNode {
  constructor() {
    this.children=[];this.style={setProperty(name,value){this[name]=value;}};
    const classes=new Set();
    this.classList={add:name=>classes.add(name),remove:(...names)=>names.forEach(name=>classes.delete(name)),
      toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};
    this.offsetHeight=1;
  }
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
}

test('editing glow preserves the rendered lyric row and active roll state',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  assert.ok(start>0&&end>start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:()=>new FakeNode(),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const stage=new FakeNode(),view=new context.RollingView(stage);
  view.lines=[{time:0,duration:5000,text:'current',words:[]},
    {time:5000,duration:5000,text:'next',words:[]}];
  view.index=0;
  const initial=Core.normalizeSettings({chorusGlowEnabled:true,chorusGlowIntensity:30});
  view.applySettings(initial);
  const glyph=view.rows[0].children[0];
  const generation=view.generation;
  view.track.style.transform='translate3d(0,-20px,0)';
  view.setGlow(true);
  view.applySettings(Core.normalizeSettings({...initial,chorusGlowIntensity:80,chorusGlowStyle:'standard'}));
  assert.equal(view.rows[0].children[0],glyph);
  assert.equal(view.generation,generation);
  assert.equal(view.track.style.transform,'translate3d(0,-20px,0)');
  assert.equal(stage.classList.contains('fc-chorus-glow'),true);
  view.applySettings(Core.normalizeSettings({...initial,chorusGlowEnabled:false}));
  assert.equal(view.rows[0].children[0],glyph);
  assert.equal(view.generation,generation);
  assert.equal(stage.classList.contains('fc-chorus-glow'),false);
});

test('finishing a roll reuses the incoming row instead of rebuilding its glyphs',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:()=>new FakeNode(),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const view=new context.RollingView(new FakeNode());
  view.lines=Array.from({length:6},(_,i)=>({time:i*5000,duration:5000,text:'line '+i,words:[]}));
  view.index=0;
  view.applySettings(Core.normalizeSettings({}));
  const incomingGlyph=view.rows[1].children[0];
  const followingGlyph=view.rows[2].children[0];
  view.stage.classList.add('fc-rolling');
  view.promote(1,view.generation);
  assert.equal(view.rows[0].children[0],incomingGlyph);
  assert.equal(view.rows[1].children[0],followingGlyph);
  assert.equal(view.rows[0].className,'fc-line fc-line-primary');
  assert.equal(view.stage.classList.contains('fc-rolling'),false);
});

test('promotion commits the small glyph without animation before growing it',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  let nextFrame=null;
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{
      cancelTransition(){} setCurrentFrame(){}
      plan(){return {kind:'singleRoll',durationMs:300};}
      beginTransition(_plan,handlers){handlers.start({isCurrent:()=>true,
        listenTransitionEnd:()=>{},scheduleFallback:()=>{},requestFrame:fn=>{nextFrame=fn;}});}
    }
  }},el:()=>new FakeNode(),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const view=new context.RollingView(new FakeNode());
  view.lines=Array.from({length:5},(_,i)=>({time:i*3000,duration:3000,text:'line '+i,words:[]}));
  view.index=0;view.applySettings(Core.normalizeSettings({}));
  let committedWithoutAnimation=false;
  Object.defineProperty(view.track,'offsetHeight',{get(){
    committedWithoutAnimation=this.classList.contains('fc-no-anim');return 1;
  }});
  view.update(1,0,3000);
  assert.equal(committedWithoutAnimation,true);
  assert.equal(view.rows[1].style.transform,'scale(var(--fc-secondary-scale))');
  assert.equal(view.rows[1].style.fontSize,'var(--fc-font-size)');
  assert.equal(view.track.classList.contains('fc-no-anim'),false);
  assert.equal(typeof nextFrame,'function');
  nextFrame();
  assert.equal(view.rows[1].classList.contains('fc-promoting'),true);
  assert.equal(view.rows[1].style.transform,'');
});

test('preview toggle does not disable desktop lyric rendering',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:()=>new FakeNode(),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const stage=new FakeNode(),view=new context.RollingView(stage);
  view.lines=[{time:0,duration:5000,text:'visible',words:[]}];
  view.applySettings(Core.normalizeSettings({enabled:false,lineGap:20,chorusGlowEnabled:true}));
  view.update(0,0,0,true);
  assert.equal(stage.style.opacity,'1');
  assert.equal(stage.style['--fc-toolbar-gap'],'20px');
  assert.equal(Number(stage.style['--fc-secondary-scale']),25/30);
  assert.equal(stage.classList.contains('fc-chorus-glow'),true);
});

test('timed words remain in word mode when punctuation is absent from tokens',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:()=>new FakeNode(),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const view=new context.RollingView(new FakeNode());
  view.lines=[{time:0,duration:2000,text:'你好！',words:[{text:'你好',start:0,duration:1000}]}];
  view.index=0;
  view.applySettings(Core.normalizeSettings({}));
  assert.equal(view.scanRows[0].mode,'yrc');
  view.renderScan(0,500,view.scanRows[0]);
  assert.equal(view.scanRows[0].node.classList.contains('fc-feather-active'),true);
  view.renderScan(1,1000,view.scanRows[0]);
  assert.equal(view.scanRows[0].node.classList.contains('fc-feather-active'),false);
});

test('mixed-language track keeps TBL translation placeholder on missing lines and after promotion',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:(_tag,className,content)=>Object.assign(new FakeNode(),{className,textContent:content}),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const view=new context.RollingView(new FakeNode());
  view.lines=[
    {time:0,duration:3000,text:'中文 English',translation:'Chinese English',words:[]},
    {time:3000,duration:3000,text:'下一句',translation:'',words:[]},
    {time:6000,duration:3000,text:'再下一句',translation:'',words:[]}
  ];
  view.index=0;
  view.applySettings(Core.normalizeSettings({showTranslation:true}));
  assert.equal(view.pairMode,true);
  assert.equal(view.rows[1].className,'fc-line fc-line-translation');
  assert.equal(view.rows[3].className,'fc-line fc-line-translation fc-translation-placeholder');
  assert.equal(view.rows[3].children[0].children[0].textContent,'…');
  view.promote(1,view.generation);
  assert.equal(view.rows[1].className,'fc-line fc-line-translation fc-translation-placeholder');
  assert.equal(view.rows[1].children[0].children[0].textContent,'…');
});

test('mixed Chinese and English originals stay in current plus next layout without translation data',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../plugin/main.js'),'utf8');
  const start=source.indexOf('  class RollingView {');
  const end=source.indexOf('  plugin.onConfig(() =>',start);
  const context={Core,window:{matchMedia:()=>({matches:false}),taskbarLyricsPresentation:{
    PresentationCoordinator:class{cancelTransition(){} setCurrentFrame(){}}
  }},el:(_tag,className,content)=>Object.assign(new FakeNode(),{className,textContent:content}),clearTimeout};
  vm.runInNewContext(source.slice(start,end)+'\nthis.RollingView=RollingView;',context);
  const view=new context.RollingView(new FakeNode());
  view.lines=[
    {time:0,duration:3000,text:'我愿意改变',translation:'',words:[]},
    {time:3000,duration:3000,text:'What can I do',translation:'',words:[]}
  ];
  view.index=0;
  view.applySettings(Core.normalizeSettings({showTranslation:true}));
  assert.equal(view.pairMode,false);
  assert.equal(view.rows[1].className,'fc-line fc-line-secondary');
  assert.equal(view.rows[1].children[0].children[0].textContent,'What can I do');
});
