from pathlib import Path
import json,zipfile,sys
root=Path(__file__).resolve().parents[1]
plugin=root/'plugin'
manifest=json.loads((plugin/'manifest.json').read_text(encoding='utf8'))
if not (plugin/'native.dll').exists():
    raise SystemExit('Missing native.dll; build native host before producing installable .plugin. No JS-only stub will be shipped as a desktop host.')
assert manifest['native_plugin']=='native.dll'
assert (plugin/'FloatingCloudLyrics.exe').is_file(), 'Missing self-contained TBL lyric provider executable'
assert (plugin/'desktop.html').is_file()
name=root/'FloatingCloud-v0.4.12.plugin'
with zipfile.ZipFile(name,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for file in sorted(plugin.rglob('*')):
        if file.is_file() and file.name != 'native.dll.old':
            z.write(file,file.relative_to(plugin).as_posix())
print(f'packaged: {name} / {name.stat().st_size} bytes')
