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
  assert await page.locator('#toolbar button').count()==5
  assert await page.locator('.fc-word').count()>0, 'YRC overlay missing'
  clip=await page.locator('.fc-word').first.evaluate('(el)=>el.style.getPropertyValue("--fc-word-progress")')
  print('word progress:',clip)
  await page.locator('#root').hover(force=True)
  await page.screenshot(path='/mnt/data/FloatingCloud-v0.4.0-desktop-preview.png',omit_background=True)
  assert not errors, errors
  print('page errors:',errors)
  await browser.close()
asyncio.run(run())
