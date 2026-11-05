"""Build the runtime-only Windows payload; the developer editor stays in source."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,subprocess
root=Path(__file__).resolve().parent.parent
meta=json.loads((root/'package.json').read_text(encoding='utf-8'));version=meta['version'];manifest=json.loads((root/'desktop/runtime-files.json').read_text())
output=root/'dist'/f'bluefish-desktop-v{version}-windows-x64.zip';launcher=root/'dist/蓝色肥鱼.exe';runtime=root/'node_modules/electron/dist'
assert launcher.is_file() and (runtime/'electron.exe').is_file()
tracked=set(filter(None,subprocess.check_output(['git','ls-files','-z'],cwd=root).decode('utf-8').split('\0')))
files=set(manifest['files']+manifest['assetFiles'])
for folder in manifest['assetDirectories']:
 for file in (root/folder).iterdir():
  if file.is_file() and file.suffix in ['.png','.svg']:files.add(file.relative_to(root).as_posix())
assert files<=tracked,'Runtime manifest contains an untracked file'
package_meta={k:meta[k] for k in ['name','version','private','type','main']};package_meta['scripts']={'start':'electron .'};package_meta['runtimeOnly']=True
with ZipFile(output,'w',ZIP_DEFLATED,compresslevel=6) as archive:
 for name in sorted(files):
  assert not name.startswith(('.env','.test-output/'))
  if name=='package.json':archive.writestr('bluefish-desktop/package.json',json.dumps(package_meta,ensure_ascii=False,indent=2)+'\n')
  else:archive.write(root/name,'bluefish-desktop/'+name)
 archive.write(launcher,'bluefish-desktop/蓝色肥鱼.exe')
 for file in sorted(runtime.rglob('*')):
  if file.is_file():archive.write(file,'bluefish-desktop/'+file.relative_to(root).as_posix())
with ZipFile(output) as archive:
 assert archive.testzip() is None
 names=set(archive.namelist())
 for name in ['overlay.html','menu.html','src/eyes.mjs','desktop/main.cjs','desktop/menu-preload.cjs']:assert 'bluefish-desktop/'+name in names
 for name in ['index.html','style.css','src/app.mjs','src/preview.mjs','desktop/editor.cjs','desktop/control-preload.cjs']:assert 'bluefish-desktop/'+name not in names
 assert not any(n.startswith(('bluefish-desktop/tools/','bluefish-desktop/test/','bluefish-desktop/docs/','bluefish-desktop/examples/')) for n in names)
print(output.name,output.stat().st_size,'bytes; runtime only')
