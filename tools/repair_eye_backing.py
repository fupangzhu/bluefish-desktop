"""Repair inferred skin backing and eye matte; preserve the fixed 2048 grid and face alpha."""
from pathlib import Path
import json,shutil,math
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parent.parent
# The workspace is nested in the project; backups remain in the same D: project tree.
BACKUP=ROOT.parents[2]/'.development/eyes-before-v0.6.10'
BACKUP.mkdir(parents=True,exist_ok=True)
rig=json.loads((ROOT/'assets/rig.json').read_text(encoding='utf-8'))
for name in ['face','eye_l_open','eye_r_open','eye_l_half','eye_r_half','eye_l_closed','eye_r_closed']:
 src=ROOT/'assets/layers'/f'{name}.png';saved=BACKUP/src.name
 if not saved.exists():shutil.copy2(src,saved)
face=np.asarray(Image.open(BACKUP/'face.png').convert('RGBA')).copy();original=face.copy();height,width=face.shape[:2]
def smooth(x):x=np.clip(x,0,1);return x*x*(3-2*x)
for eye in rig['eyes']:
 cx,cy=eye['center'];theta=eye['tilt'];cs,sn=math.cos(theta),math.sin(theta);box=eye['box'];rx=(box[2]-box[0])*.47+28;ry=(box[3]-box[1])*.47+28
 ex=int(math.ceil(rx*abs(cs)+ry*abs(sn)))+10;ey=int(math.ceil(rx*abs(sn)+ry*abs(cs)))+10;x0=int(cx)-ex;y0=int(cy)-ey;x1=int(cx)+ex+1;y1=int(cy)+ey+1
 size=(max(3,(x1-x0)//4),max(3,(y1-y0)//4));grid=np.asarray(Image.fromarray(face[y0:y1,x0:x1,:3]).resize(size,Image.Resampling.BICUBIC),dtype=np.float32).copy();gy,gx=np.mgrid[0:size[1],0:size[0]];sx=x0+(gx+.5)*(x1-x0)/size[0];sy=y0+(gy+.5)*(y1-y0)/size[1];dx=sx-cx;dy=sy-cy;r=((dx*cs+dy*sn)/rx)**2+((-dx*sn+dy*cs)/ry)**2;mask=r<1
 for _ in range(600):
  for parity in [0,1]:
   average=(grid[:-2,1:-1]+grid[2:,1:-1]+grid[1:-1,:-2]+grid[1:-1,2:])*.25;active=mask[1:-1,1:-1]&(((gx+gy)[1:-1,1:-1]%2)==parity);inner=grid[1:-1,1:-1];inner[active]+=1.6*(average[active]-inner[active])
 repaired=np.stack([np.asarray(Image.fromarray(grid[:,:,c],mode='F').resize((x1-x0,y1-y0),Image.Resampling.BICUBIC)) for c in range(3)],axis=-1)
 yy,xx=np.mgrid[y0:y1,x0:x1];dx=xx-cx;dy=yy-cy;radius=np.sqrt(((dx*cs+dy*sn)/rx)**2+((-dx*sn+dy*cs)/ry)**2);weight=1-smooth((radius-.9)/.1);noise=((np.sin(xx*12.9898+yy*78.233)*43758.5453)%1-.5)*.6
 rgb=face[y0:y1,x0:x1,:3].astype(float);rgb=rgb*(1-weight[:,:,None])+(repaired+noise[:,:,None])*weight[:,:,None];face[y0:y1,x0:x1,:3]=np.clip(np.round(rgb),0,255).astype('uint8')
assert np.array_equal(original[:,:,3],face[:,:,3]);Image.fromarray(face).save(ROOT/'assets/layers/face.png')
for eye in rig['eyes']:
 side=eye['side'];im=np.asarray(Image.open(BACKUP/f'eye_{side}_open.png').convert('RGBA')).copy();a=im[:,:,3].astype(float)/255;rgb=im[:,:,:3].astype(float);blue=(rgb[:,:,2]>rgb[:,:,0]+65)&(rgb[:,:,1]>rgb[:,:,0]+30)&(rgb[:,:,2]>145)&(a>.7);result=np.zeros_like(im)
 for y in np.where(blue.any(axis=1))[0]:
  xs=np.where(blue[y])[0];lo,hi=xs[0],xs[-1];result[y,lo:hi+1]=im[y,lo:hi+1]
  for x in np.where(a[y]>0)[0]:
   if lo<=x<=hi:continue
   nearest=lo if x<lo else hi;background=face[y,x,:3].astype(float);foreground=rgb[y,nearest];alpha=np.clip((background[0]-rgb[y,x,0])/max(1,background[0]-foreground[0]),0,1)
   if alpha<.01:continue
   color=np.clip((rgb[y,x]-(1-alpha)*background)/alpha,0,255);result[y,x,:3]=np.round(color);result[y,x,3]=round(a[y,x]*alpha*255)
 Image.fromarray(result).save(ROOT/f'assets/layers/eye_{side}_open.png')
 cx,cy=eye['center'];theta=eye['tilt'];cs,sn=math.cos(theta),math.sin(theta);yy,xx=np.mgrid[0:height,0:width];lx=(xx-cx)*cs+(yy-cy)*sn;ly=-(xx-cx)*sn+(yy-cy)*cs
 def lid(radius):
  pad=110;x0=int(cx)-pad;y0=int(cy)-pad;scale=4;tile=Image.new('RGBA',(pad*2*scale,pad*2*scale));d=ImageDraw.Draw(tile);pts=[]
  for x in np.linspace(-radius,radius,160):
   y=7.5*(1-x*x/(radius*radius));pts.append(((cx+cs*x-sn*y-x0)*scale,(cy+sn*x+cs*y-y0)*scale))
  d.line(pts,fill=(28,119,192,255),width=10*scale,joint='curve')
  for x,y in [pts[0],pts[-1]]:d.ellipse((x-5*scale,y-5*scale,x+5*scale,y+5*scale),fill=(28,119,192,255))
  full=Image.new('RGBA',(width,height));full.paste(tile.resize((pad*2,pad*2),Image.Resampling.LANCZOS),(x0,y0));return full
 half=result.copy();arc=7.5*(1-np.clip(lx/70,-1,1)**2);profile=1-np.clip(lx/70,-1,1)**2;bottom=arc+1.12*(eye['box'][3]-eye['box'][1])*.47*profile;mask=smooth((ly-arc+.75)/1.5)*(1-smooth((ly-bottom+.75)/1.5))*(1-smooth((np.abs(lx)-70+.75)/1.5));half[:,:,3]=np.round(half[:,:,3]*mask).astype('uint8');half_image=Image.fromarray(half);half_image.alpha_composite(lid(70));half_image.save(ROOT/f'assets/layers/eye_{side}_half.png');lid(64).save(ROOT/f'assets/layers/eye_{side}_closed.png')
rig['completion']['face']='Original face silhouette and alpha, with continuous harmonic skin repair beneath the eye cutouts; no row-wise striped fill.'
(ROOT/'assets/rig.json').write_text(json.dumps(rig,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
composite=Image.new('RGBA',(width,height))
for name in rig['drawOrder']:composite.alpha_composite(Image.open(ROOT/f'assets/layers/{name}.png'))
composite.save(ROOT/'assets/reconstructed.png');print(json.dumps({'repaired':True,'faceAlphaPreserved':True,'canvas':[width,height]}))
