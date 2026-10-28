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
