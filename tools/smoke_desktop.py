"""Check generated desktop page and embedded JS syntax without launching WebView2."""
import re, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
html=(root/'plugin'/'desktop.html').read_text(encoding='utf8')
assert 'id="drag"' not in html, 'old drag bar still present'
assert 'id="play-pause"' in html and 'seekForward' in html
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
