"""Package a tested Windows checkout; requires Electron and the compiled launcher."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import subprocess

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf8'))['version']
output = root / 'dist' / f'bluefish-desktop-v{version}-windows-x64.zip'
launcher = root / 'dist' / '蓝色肥鱼.exe'
runtime = root / 'node_modules'
assert launcher.is_file()
assert (runtime / 'electron/dist/electron.exe').is_file()
tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf8').split('\0')
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as package:
    for name in sorted(filter(None, tracked)):
        assert not name.startswith(('.env', '.test-output/'))
        package.write(root / name, 'bluefish-desktop/' + name)
    package.write(launcher, 'bluefish-desktop/蓝色肥鱼.exe')
    for file in sorted(runtime.rglob('*')):
        if file.is_file():
            package.write(file, 'bluefish-desktop/' + file.relative_to(root).as_posix())
with ZipFile(output) as package:
    assert package.testzip() is None
    for name in ['overlay.html', 'menu.html', 'desktop/dock.cjs', 'src/peek.mjs', 'src/hands.mjs', 'src/touch.mjs', 'src/ahoge.mjs']:
        assert 'bluefish-desktop/' + name in package.namelist()
print(output.name, output.stat().st_size, 'bytes')
