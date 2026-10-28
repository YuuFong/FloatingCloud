"""Check generated desktop page and embedded JS syntax without launching WebView2."""
import re, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
html=(root/'plugin'/'desktop.html').read_text(encoding='utf8')
assert 'id="drag"' not in html, 'old drag bar still present'
assert 'id="play-pause"' in html and 'seekForward' in html
assert 'id="music"' not in html, 'song information button should be removed'
assert 'grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)' in html, 'play button must be centered'
assert 'width:max-content;max-width:calc(100% - 24px)' in html, 'toolbar must stay compact and centered'
assert '#toolbar .fc-tools-left,#toolbar .fc-tools-right{justify-content:space-between}' in html, 'toolbar outer ends should be symmetric'
assert 'transform:translate(-50%,9px)' in html, 'toolbar must animate upward from below'
assert 'applySpectrumGeometry' in html and 'spectrumBarWidth' in html and 'spectrumGap' in html, 'independent real-time bar width/spacing missing'
assert '32*barWidth+31*gap' in html and 'available/total' in html, 'bar width and gap must fit narrow windows'
assert '--fc-spectrum-bar-width' in html, 'renderer must use adjusted bar width'
assert 'id="resize-guide"' in html, 'width guide div missing'
assert 'background:rgba(16,20,30,.58)' in html, 'dark translucent width guide missing'
assert "classList.toggle('width-adjusting'" in html, 'width guide must respond to setting payload'
assert 'fc-line-translation{color:var(--fc-translation);opacity:1' in html, 'translation should use dedicated alpha hierarchy'
assert 'lyricPalette(settings.foregroundMode' in html, 'theme-derived lyric palette missing'
assert 'top:calc(92px + var(--fc-line-pitch,53px) - 9px)' in html, 'spectrum center must align just above lyric-row midpoint'
assert "bar.style.height=Math.round(8+value*62)+'px'" in html, 'spectrum height increase missing'
assert "root.style.setProperty('--fc-line-pitch'" in html, 'spectrum center must update with lyric line pitch'
assert '--fc-color' in html and 'fc-line-translation' in html, 'TBL color hierarchy missing'
assert 'text-shadow:0 1px 2px rgba(0,0,0,.36)' in html, 'TBL soft text-shadow missing'
assert 'fc-scan-enabled' in html and 'fc-text-base{color:var(--fc-next)' in html, 'unplayed current lyric words must use TBL secondary tone'
assert 'mask-image:linear-gradient' in html and 'var(--fc-highlight)' in html, 'TBL layered word-scan overlay missing'
assert '#stage .fc-line{filter:drop-shadow' not in html, 'old over-dark FC shadow must not override TBL'

assert "length:32" in html, 'TaskbarLyrics 32-band renderer is missing'
assert 'controlsOpen' in html and 'fontSmaller' in html
assert 'id="spectrum"' in html and 'spectrumTargets' in html
assert "正在获取歌词" in html and 'p.searching' in html
assert 'top:49px' in html and 'top:92px' in html
assert 'background:rgba(21,26,34,.90)' not in html
assert html.count('class="fc-stage"')==1
scripts=re.findall(r'<script>([\s\S]*?)</script>',html)
assert len(scripts)==3, f'expected 3 inline scripts (core, TBL, renderer), got {len(scripts)}'
for script in scripts:
    with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf8',delete=False) as f:
        f.write(script)
        tmp=Path(f.name)
    try:
        subprocess.run(['node','--check',str(tmp)],check=True)
    finally:
        tmp.unlink(missing_ok=True)
print('Desktop HTML and three inline scripts pass syntax checks')
