import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
html=Path(__file__).resolve().parents[1]/'plugin'/'desktop.html'
async def run():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=await browser.new_page(viewport={'width':740,'height':220},device_scale_factor=1)
  errors=[]
  page.on('pageerror', lambda ex:errors.append(str(ex)))
  await page.set_content(html.read_text(encoding='utf8'))
  await page.wait_for_timeout(900)
  assert await page.locator('#toolbar button').count()==8
  assert await page.locator('.fc-text-highlight').count()>0, 'text mask missing'
  clip=await page.locator('.fc-text-box').first.evaluate('(el)=>el.style.getPropertyValue("--fc-progress")')
  print('word progress:',clip)
  await page.evaluate("document.querySelector('#root').classList.add('controls-open')")
  await page.screenshot(path='/mnt/data/FloatingCloud-v0.4.14-desktop-preview.png',omit_background=True)
  assert not errors, errors
  print('page errors:',errors)
  await browser.close()
asyncio.run(run())
