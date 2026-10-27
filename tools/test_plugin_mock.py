import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
p=Path(__file__).resolve().parents[1]/'plugin'
core=(p/'core.js').read_text(encoding='utf8')
main=(p/'main.js').read_text(encoding='utf8')
MOCK='''window.__calls=[];window.__config={};window.plugin={getConfig:(key,def)=>window.__config[key]??def,setConfig:(key,val)=>{window.__config[key]=val;},onLoad:(cb)=>{window.__load=cb},onConfig:(cb)=>{window.__view=cb},onUnload:(cb)=>{window.__unload=cb}};
window.betterncm_native={native_plugin:{call(id,args){window.__calls.push([id,args]);if(id==='floatingcloud.ping')return 'native-loaded';if(id==='floatingcloud.open')return 'started';if(id==='floatingcloud.status')return 'ready';return 'ok';}}};
window.InfLinkApi={getCurrentSong:()=>({ncmId:123,songName:'测试歌曲',authorName:'测试歌手'}),getTimeline:()=>({currentTime:1000}),getPlaybackStatus:()=> 'Playing',addEventListener(){},removeEventListener(){}};
'''
async def run():
 async with async_playwright() as b:
  browser=await b.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await browser.new_page(viewport={'width':1100,'height':800})
  errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  escaped=lambda text: text.replace('</script','<\\/script')
  await page.set_content(f'<html><body><script>{MOCK}</script><script>{escaped(core)}</script><script>{escaped(main)}</script><script>window.__load();document.body.appendChild(window.__view());</script></body></html>')
  await page.wait_for_selector('.fc-panel')
  await page.get_by_text('打开桌面浮窗',exact=True).click()
  await page.wait_for_timeout(550)
  calls=await page.evaluate('window.__calls')
  ids=[c[0] for c in calls]
  for id in ['floatingcloud.open','floatingcloud.show','floatingcloud.settings','floatingcloud.lyrics','floatingcloud.timeline']:
   assert id in ids,(id,ids)
  await page.get_by_text('解除浮窗锁定',exact=True).click()
  assert ['floatingcloud.lock',['false']] in calls or 'floatingcloud.lock' in [c[0] for c in await page.evaluate('window.__calls')]
  print('native calls observed',sorted(set(ids)))
  print('panel headers',await page.locator('.fc-panel h2').all_text_contents())
  print('errors:',errors)
  assert not errors,errors
  await browser.close()
asyncio.run(run())
