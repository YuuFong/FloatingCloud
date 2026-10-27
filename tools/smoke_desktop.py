"""Check generated desktop page and embedded JS syntax without launching WebView2."""
import re, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
html=(root/'plugin'/'desktop.html').read_text(encoding='utf8')
assert 'id="drag"' not in html, 'old drag bar still present'
assert 'id="play-pause"' in html and 'seekForward' in html
assert 'controlsOpen' in html and 'fontSmaller' in html
assert html.count('class="fc-stage"')==1
scripts=re.findall(r'<script>([\s\S]*?)</script>',html)
assert len(scripts)==2, f'expected 2 inline scripts, got {len(scripts)}'
for script in scripts:
    with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf8',delete=False) as f:
        f.write(script)
        tmp=Path(f.name)
    try:
        subprocess.run(['node','--check',str(tmp)],check=True)
    finally:
        tmp.unlink(missing_ok=True)
print('Desktop HTML and both inline JS scripts pass syntax checks')
