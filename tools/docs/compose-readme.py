"""Compose text-free README visuals from real application frames."""
from pathlib import Path
import json, shutil, sys
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2];RAW=ROOT/'tools/docs/.work/readme-v2';BUILD=RAW/'build';BUILD.mkdir(parents=True,exist_ok=True)
META=json.loads((RAW/'manifest.json').read_text(encoding='utf8'));L=Image.Resampling.LANCZOS
BG='#f6f8fa';EDGE='#d8dee4';BAR='#eef1f5'
def card(height,scale=1):
 im=Image.new('RGB',(800*scale,height*scale),BG);ImageDraw.Draw(im).rectangle((0,0,800*scale-1,height*scale-1),outline=EDGE,width=scale);return im
def taskbar(im,top,scale=1):
 d=ImageDraw.Draw(im);w,h=im.size;y=round(top*scale);d.rectangle((scale,y,w-2*scale,h-2*scale),fill=BAR);d.line((scale,y,w-scale,y),fill=EDGE,width=scale)
 for offset in [-36,0,36]:
  x,yc=400*scale+offset*scale,y+20*scale;r=6*scale
  if offset==-36:
   for dx in [-r,scale]:
    for dy in [-r,scale]:d.rectangle((x+dx,yc+dy,x+dx+5*scale,yc+dy+5*scale),fill='#8792a2')
  elif offset==0:d.ellipse((x-r,yc-r,x+r,yc+r),outline='#8792a2',width=2*scale);d.line((x+4*scale,yc+4*scale,x+9*scale,yc+9*scale),fill='#8792a2',width=2*scale)
  else:d.rounded_rectangle((x-r,yc-r,x+r,yc+r),radius=2*scale,outline='#8792a2',width=2*scale)
def raw(rec):return Image.open(RAW/rec['file']).convert('RGBA').resize((rec.get('width',420),rec.get('height',420)),L)
def paste(im,source,xy,size=None):
 if size:source=source.resize(tuple(round(v) for v in size),L)
 im.paste(source,tuple(round(v) for v in xy),source)
def cursor(im,x,y,click=None):
 d=ImageDraw.Draw(im)
 if click is not None:
  radius=5+click*15;d.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#6083dc',width=2)
 d.polygon([(x,y),(x,y+18),(x+5,y+13),(x+8,y+20),(x+12,y+18),(x+9,y+11),(x+16,y+11)],fill='#1f2328',outline='white',width=2)
def gif(frames,durations,name):
 samples=[]
 for i in range(0,len(frames),max(1,len(frames)//12)):
  im=frames[i].copy();im.thumbnail((400,180));samples.append(im)
 ref=Image.new('RGB',(400,180*len(samples)),BG)
 for i,im in enumerate(samples):ref.paste(im,(0,i*180))
 palette=ref.quantize(colors=255,method=Image.Quantize.MEDIANCUT);frames=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
 frames[0].save(BUILD/name,save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True,disposal=1)
 print(name,(BUILD/name).stat().st_size//1024,'KB',len(frames),'frames')
def scene_clip(key,name):
 clip=META['clips'][key];frames=[]
 for frame in clip['frames']:
  im=card(280);taskbar(im,240);source=raw({**clip,**frame});paste(im,source,(0,240-clip['ledge']));cursor(im,round(frame['x']),round(frame['y']+240-clip['ledge']),frame.get('click'));frames.append(im)
 gif(frames,[f['duration'] for f in clip['frames']],name)
def petting():
 frames=[]
 for n in range(100):
  im=card(280)
  for i,key in enumerate(['sleepy','playful','subtle']):paste(im,raw({**META['clips'][key],**META['clips'][key]['frames'][n]}),(i*800/3+5,8),(256,256))
  frames.append(im)
 gif(frames,[90]*100,'petting.gif')
def sleeping():
 S=2;im=card(280,S);taskbar(im,240,S)
 for i,key in enumerate(['droop','sleep']):
  source=raw(META['stills'][key]);k=.78*S;paste(im,source,((i*400+(400-420*.78)/2)*S,(240-400*.78)*S),(source.width*k,source.height*k))
 im.save(BUILD/'sleep.png',optimize=True)
def sizes():
 S=2;im=card(280,S);taskbar(im,240,S)
 for size,center in [(150,140),(240,338),(460,610)]:
  rec=META['stills']['size'+str(size)];source=raw(rec);k=.6*S;paste(im,source,((center-rec['width']*.6/2)*S,(240-rec['ledge']*.6)*S),(source.width*k,source.height*k))
 im.save(BUILD/'sizes.png',optimize=True)
def menu():
 S=2;im=card(360,S);taskbar(im,310,S);rec=META['stills']['size240'];pet=raw(rec);paste(im,pet,((220-rec['width']/2)*S,(310-rec['ledge'])*S),(pet.width*S,pet.height*S))
 panel=Image.open(RAW/META['stills']['menu']['file']).convert('RGBA');panel=panel.crop(panel.getchannel('A').getbbox());k=min(300*S/panel.width,270*S/panel.height);target=(round(panel.width*k),round(panel.height*k));paste(im,panel,(768*S-target[0],298*S-target[1]),target);im.save(BUILD/'menu.png',optimize=True)
def console():
 source=Image.open(RAW/META['stills']['console']['file']).convert('RGB');S=2;w=736*S;h=round(w*source.height/source.width);im=card(round(h/S)+64,S);im.paste(source.resize((w,h),L),(32*S,32*S));ImageDraw.Draw(im).rectangle((32*S,32*S,32*S+w-1,32*S+h-1),outline=EDGE,width=S);im.save(BUILD/'console.png',optimize=True)
scene_clip('hero','hero.gif');scene_clip('interaction','interaction.gif');petting();sleeping();sizes();menu();console()
if '--install' in sys.argv:
 for name in ['hero.gif','interaction.gif','petting.gif','sleep.png','sizes.png','menu.png','console.png']:shutil.copyfile(BUILD/name,ROOT/'docs'/name)
 print('Installed text-free README media.')
