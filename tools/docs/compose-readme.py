"""Compose README media from capture-readme.cjs; real renders, one visual grid."""
from pathlib import Path
import json, shutil, sys
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'tools/docs/.work/readme-v2'
BUILD=RAW/'build';BUILD.mkdir(parents=True,exist_ok=True)
META=json.loads((RAW/'manifest.json').read_text(encoding='utf8'))
L=Image.Resampling.LANCZOS
BG='#f6f8fa';INK='#1f2328';MUTED='#59636e';EDGE='#d8dee4';BAR='#eef1f5'
FONTS={}
def font(size,bold=False):
 key=(size,bold)
 if key not in FONTS:FONTS[key]=ImageFont.truetype('C:/Windows/Fonts/'+('msyhbd.ttc' if bold else 'msyh.ttc'),size)
 return FONTS[key]
def card(height,scale=1):
 im=Image.new('RGB',(800*scale,height*scale),BG)
 ImageDraw.Draw(im).rectangle((0,0,800*scale-1,height*scale-1),outline=EDGE,width=scale)
 return im
def text(im,xy,value,size=24,bold=False,scale=1,fill=INK,anchor='la'):
 ImageDraw.Draw(im).text(tuple(round(x*scale) for x in xy),value,font=font(size*scale,bold),fill=fill,anchor=anchor)
def taskbar(im,top,scale=1):
 d=ImageDraw.Draw(im);w,h=im.size;y=round(top*scale)
 d.rectangle((scale,y,w-2*scale,h-2*scale),fill=BAR);d.line((scale,y,w-scale,y),fill=EDGE,width=scale)
 cx,cy=400*scale,y+22*scale
 # Restrained taskbar landmarks; leave the character and paws unobstructed.
 for ox in [-36,0,36]:
  x=cx+ox*scale;r=6*scale
  if ox==-36:
   for dx in [-r,scale]:
    for dy in [-r,scale]:d.rectangle((x+dx,cy+dy,x+dx+5*scale,cy+dy+5*scale),fill='#8792a2')
  elif ox==0:
   d.ellipse((x-r,cy-r,x+r,cy+r),outline='#8792a2',width=2*scale);d.line((x+4*scale,cy+4*scale,x+9*scale,cy+9*scale),fill='#8792a2',width=2*scale)
  else:d.rounded_rectangle((x-r,cy-r,x+r,cy+r),radius=2*scale,outline='#8792a2',width=2*scale)
def raw(record):
 im=Image.open(RAW/record['file']).convert('RGBA')
 return im.resize((record.get('width',420),record.get('height',420)),L)
def paste(im,source,xy,size=None):
 if size:source=source.resize(tuple(round(v) for v in size),L)
 im.paste(source,tuple(round(v) for v in xy),source)
def cursor(im,x,y):
 d=ImageDraw.Draw(im);points=[(x,y),(x,y+18),(x+5,y+13),(x+8,y+20),(x+12,y+18),(x+9,y+11),(x+16,y+11)]
 d.polygon(points,fill=INK,outline='white',width=2)
def gif(frames,durations,name):
 # Shared palette prevents color flicker; a flat backdrop keeps animation compact.
 samples=[]
 for i in range(0,len(frames),max(1,len(frames)//12)):
  f=frames[i].copy();f.thumbnail((400,180));samples.append(f)
 reference=Image.new('RGB',(400,180*len(samples)),BG)
 for i,f in enumerate(samples):reference.paste(f,(0,i*180))
 palette=reference.quantize(colors=255,method=Image.Quantize.MEDIANCUT)
 frames=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
 frames[0].save(BUILD/name,save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True,disposal=1)
 print(name,(BUILD/name).stat().st_size//1024,'KB',len(frames),'frames')
def hero():
 clip=META['clips']['hero'];frames=[]
 for frame in clip['frames']:
  im=card(320);taskbar(im,280)
  pet=Image.open(RAW/frame['file']).convert('RGBA').resize((clip['width'],clip['height']),L)
  paste(im,pet,(0,280-clip['ledge']))
  text(im,(32,24),'跟随鼠标，轻轻挪动',26,True)
  text(im,(32,66),'目光跟随 · 小手挪动 · 任务栏贴边',15,fill=MUTED)
  cursor(im,round(frame['x']),round(frame['y']+280-clip['ledge']))
  frames.append(im)
 gif(frames,[r['duration'] for r in clip['frames']],'hero.gif')
def petting():
 frames=[];names=[('sleepy','放松闭眼','20%'),('playful','开心晃头','50%'),('subtle','轻轻回应','30%')]
 for n in range(100):
  im=card(340);d=ImageDraw.Draw(im)
  for i,(key,label,chance) in enumerate(names):
   x=i*800/3
   if i:d.line((round(x),28,round(x),312),fill=EDGE,width=1)
   text(im,(x+32,24),label,22,True);text(im,(x+32,61),chance,16,fill=MUTED)
   source=raw({**META['clips'][key],**META['clips'][key]['frames'][n]})
   paste(im,source,(x+17,88),(232,232))
  frames.append(im)
 gif(frames,[90]*len(frames),'petting.gif')
def sleeping():
 S=2;im=card(340,S);taskbar(im,290,S);d=ImageDraw.Draw(im);d.line((400*S,28*S,400*S,270*S),fill=EDGE,width=S)
 for i,(key,label,desc) in enumerate([('droop','萎靡','停止注视，耳朵耷拉'),('sleep','睡眠','闭眼趴低，双手不动')]):
  text(im,(i*400+32,24),label,24,True,S);text(im,(i*400+32,64),desc,15,scale=S,fill=MUTED)
  source=raw(META['stills'][key]);k=.78*S
  paste(im,source,((i*400+(400-420*.78)/2)*S,(290-400*.78)*S),(source.width*k,source.height*k))
 im.save(BUILD/'sleep.png',optimize=True)
def sizes():
 S=2;im=card(320,S);taskbar(im,265,S)
 text(im,(32,24),'调到适合你的大小',24,True,S)
 for size,center in [(150,140),(240,338),(460,610)]:
  rec=META['stills']['size'+str(size)];source=raw(rec);k=.6*S
  paste(im,source,((center-rec['width']*.6/2)*S,(265-rec['ledge']*.6)*S),(source.width*k,source.height*k))
  text(im,(center,300),str(size)+' px',16,scale=S,fill=MUTED,anchor='mm')
 im.save(BUILD/'sizes.png',optimize=True)
def menu():
 S=2;im=card(400,S);taskbar(im,350,S)
 text(im,(32,24),'右键就能调整',26,True,S);text(im,(32,66),'大小 · 动作 · 显示',15,scale=S,fill=MUTED)
 rec=META['stills']['size240'];pet=raw(rec)
 paste(im,pet,((220-rec['width']/2)*S,(350-rec['ledge'])*S),(pet.width*S,pet.height*S))
 panel=Image.open(RAW/META['stills']['menu']['file']).convert('RGBA');box=panel.getchannel('A').getbbox();panel=panel.crop(box)
 k=min(300*S/panel.width,278*S/panel.height)
 target=(round(panel.width*k),round(panel.height*k));xy=(round(768*S-target[0]),round(338*S-target[1]))
 paste(im,panel,xy,target);im.save(BUILD/'menu.png',optimize=True)
def console():
 source=Image.open(RAW/META['stills']['console']['file']).convert('RGB');S=2;w=736*S;h=round(w*source.height/source.width)
 im=card(round(h/S)+64,S);im.paste(source.resize((w,h),L),(32*S,32*S))
 ImageDraw.Draw(im).rectangle((32*S,32*S,32*S+w-1,32*S+h-1),outline=EDGE,width=S)
 im.save(BUILD/'console.png',optimize=True)
hero();petting();sleeping();sizes();menu();console()
if '--install' in sys.argv:
 for name in ['hero.gif','petting.gif','sleep.png','sizes.png','menu.png','console.png']:shutil.copyfile(BUILD/name,ROOT/'docs'/name)
 print('Installed README media.')
