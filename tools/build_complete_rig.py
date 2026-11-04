"""Source-preserving split + explicitly recorded occluded backing, all on a fixed 2K grid."""
from pathlib import Path
import json, hashlib, math, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'assets/master-source.png'
APP=ROOT
DEST=APP/'assets/layers'
DEST.mkdir(parents=True,exist_ok=True)
im=Image.open(SOURCE).convert('RGBA'); W,H=im.size; SCALE=2048/W
a=np.array(im); rgb=a[:,:,:3].astype(int); r,g,b=rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
# Keep the actual connected character, removing generation debris and one-pixel halos.
binary=Image.fromarray(np.uint8(a[:,:,3]>96)*255).copy()
ImageDraw.floodfill(binary,(600,1000),128)
connected=np.array(binary)==128
clean=Image.fromarray(np.uint8(connected)*255).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.45))
alpha=np.minimum(a[:,:,3],np.array(clean)); alpha[alpha<8]=0
# Generated alpha is about 253 even inside solid paint. Normalize interiors so
# backing plates do not show through nominally opaque original features.
alpha[alpha>=230]=255
a[:,:,3]=alpha
Y,X=np.mgrid[:H,:W]
def poly(points):
    m=Image.new('L',(W,H));ImageDraw.Draw(m).polygon(points,fill=255);return np.array(m)>0
def dilate(mask,n):return np.array(Image.fromarray(np.uint8(mask)*255).filter(ImageFilter.MaxFilter(2*n+1)))>0
def ellipse(cx,cy,rx,ry,angle=0):
    cs,sn=math.cos(angle),math.sin(angle);xx=(X-cx)*cs+(Y-cy)*sn;yy=-(X-cx)*sn+(Y-cy)*cs
    return (xx/rx)**2+(yy/ry)**2<=1
opaque=alpha>0
owners=np.full((H,W),'hair_back',dtype='U16')
skin=(r>215)&(g>185)&(b>165)&(r>g+2)&(r>b+6)&opaque
owners[skin]='face'
front_region=poly([(220,500),(350,350),(610,297),(827,375),(920,525),(942,799),(920,926),(808,980),(838,945),(857,835),(827,685),(782,585),(740,723),(676,798),(595,815),(540,800),(596,725),(556,681),(577,531),(500,609),(399,670),(329,685),(314,690),(313,770),(334,821),(311,810),(283,774),(267,839),(299,929),(340,980),(290,966),(252,933),(229,858),(220,740)])
blue=(b>r+25)&(b>g+5)&opaque
owners[front_region&blue]='hair_front'
ear_l_region=poly([(185,191),(251,224),(300,247),(387,267),(442,301),(443,359),(409,433),(325,456),(240,429),(194,373),(183,283)])
ear_r_region=poly([(962,460),(1034,468),(1094,510),(1193,521),(1200,583),(1169,639),(1113,681),(1016,700),(966,651)])
owners[ear_l_region&opaque]='ear_l';owners[ear_r_region&opaque]='ear_r'
lace_region=poly([(395,281),(412,230),(479,195),(525,191),(554,216),(576,222),(598,191),(629,178),(661,184),(690,209),(707,234),(750,228),(790,234),(841,265),(871,295),(870,326),(888,331),(913,328),(946,346),(977,391),(991,424),(980,463),(999,481),(1010,520),(999,560),(975,591),(944,591),(928,553),(910,510),(888,469),(866,432),(815,391),(761,360),(704,341),(639,328),(566,331),(512,344),(466,364),(429,385),(408,348),(393,326)])
lace=(lace_region|((r>145)&(g>155)&(b>=r-3)&(Y<340)&(X>375)&(X<890)))&opaque&~ear_l_region&~ear_r_region
owners[lace]='headdress'
# Ahoge is spatially separate; do not take the white lace behind its root.
ahoge_region=poly([(672,68),(969,46),(995,242),(771,259),(718,308),(680,317),(668,231)])
owners[ahoge_region&blue&(r<150)]='ahoge'
bow_color=(g>r+30)&(b>r+50)&(g>145)&opaque
bow_l_region=poly([(233,345),(438,336),(448,431),(389,441),(405,535),(329,546),(324,490),(297,540),(220,492),(268,437),(254,409)])
bow_r_region=poly([(884,538),(967,537),(1003,594),(1059,583),(1076,676),(1032,694),(1084,796),(1000,803),(979,752),(971,781),(909,733),(930,669),(882,650)])
owners[bow_l_region&bow_color]='bow_l';owners[bow_r_region&bow_color]='bow_r'
eye_specs=[]
for side,box in [('l',(376,650,488,862)),('r',(680,750,793,961))]:
    x0,y0,x1,y1=box
    color=(r<140)&(g>r+65)&(b>r+100)&(X>=x0)&(X<x1)&(Y>=y0)&(Y<y1)
    # Fill each enclosed white highlight while retaining the source silhouette.
    crop=Image.fromarray(np.uint8(~color[y0:y1,x0:x1])*255).copy();ImageDraw.floodfill(crop,(0,0),128)
    fill=np.array(crop)!=128;mask=np.zeros((H,W),bool);mask[y0:y1,x0:x1]=fill
    mask=dilate(mask,1)&opaque
    yy,xx=np.where(mask);pivot=[float(xx.mean()),float(yy.mean())]
    owners[mask]='eye_'+side+'_open'
    eye_specs.append({'side':side,'mask':mask,'center':pivot,'box':box})
for side,box in [('l',(255,819,410,916)),('r',(680,949,829,1043))]:
    x0,y0,x1,y1=box
    mask=(r>225)&(r>g+30)&(g<225)&(b>160)&(X>=x0)&(X<x1)&(Y>=y0)&(Y<y1)&opaque
    owners[dilate(mask,1)&opaque]='blush_'+side

# Side locks inside the face backing must sit above that backing. Keep all their
# visible source colors, including the antialiased hair/skin boundary pixels.
face_plate=ellipse(574,784,319,349,.26)
owners[(owners=='hair_back')&face_plate&opaque]='hair_front'

names=['body','hair_back','face','ear_l','ear_r','eye_l_open','eye_l_half','eye_l_closed','eye_r_open','eye_r_half','eye_r_closed','blush_l','blush_r','mouth','hair_front','ahoge','headdress','bow_l','bow_r']
layers={name:np.zeros_like(a) for name in names}
for name in names:
    selected=owners==name;layers[name][selected]=a[selected]
# Full backing plates remain behind original pixels. They are completed geometry,
# not advertised as original source content. The 12px allowance is in final pixels.
padding=math.ceil(12/SCALE)
back_visible=owners=='hair_back'; front_visible=owners=='hair_front'
hair_plate=ellipse(601,740,419,445,-.12)&(alpha==255)
back_fill=hair_plate&~back_visible
hair_rgb=np.stack([60+20*(Y/H),100+28*(Y/H),211+24*(Y/H)],axis=2).astype('uint8')
layers['hair_back'][back_fill,:3]=hair_rgb[back_fill];layers['hair_back'][back_fill,3]=255
# Face backing: only put completed skin behind features or foreground hair, so
# neutral recomposition remains identical to the locked master.
features=np.isin(owners,['face','eye_l_open','eye_r_open','blush_l','blush_r'])
face_fill=(features|face_plate)&(alpha==255)
skin_rgb=np.zeros((H,W,3),dtype='uint8')
skin_rgb[:,:,0]=255;skin_rgb[:,:,1]=np.clip(244-9*(Y/H),0,255);skin_rgb[:,:,2]=np.clip(235-13*(Y/H),0,255)
layers['face'][face_fill,:3]=skin_rgb[face_fill];layers['face'][face_fill,3]=255
sel=owners=='face';layers['face'][sel]=a[sel]
# Original skin from each feature's row edges is interpolated under its removal.
for name in ['eye_l_open','eye_r_open','blush_l','blush_r']:
    mask=owners==name;ys=np.where(mask.any(1))[0]
    for y in ys:
        cols=np.where(mask[y])[0];left=max(0,int(cols[0])-5);right=min(W-1,int(cols[-1])+5)
        lefts=np.where((owners[y]=='face')&(np.arange(W)<cols[0])&(np.arange(W)>cols[0]-35))[0]
        rights=np.where((owners[y]=='face')&(np.arange(W)>cols[-1])&(np.arange(W)<cols[-1]+35))[0]
        if len(lefts):left=int(lefts[-1])
        elif len(rights):left=int(rights[0])
        if len(rights):right=int(rights[0])
        elif len(lefts):right=int(lefts[-1])
        lo=a[y,left,:3].astype(float);hi=a[y,right,:3].astype(float)
        if right==left:right=left+1
        f=(cols-left)/(right-left)
        layers['face'][y,cols,:3]=np.round(lo[None,:]*(1-f[:,None])+hi[None,:]*f[:,None]).astype('uint8')
        layers['face'][y,cols,3]=255
# Fill a small occluded border for lace, ear roots and bows from neighboring colors.
# It stays beneath an opaque covering part, never bloats the exterior silhouette.
order=['hair_back','ear_l','ear_r','face','eye_l_open','eye_r_open','blush_l','blush_r','hair_front','headdress','bow_l','bow_r','ahoge']
completion_counts={}
for name in ['hair_front','ear_l','ear_r','headdress','bow_l','bow_r','ahoge']:
    mask=owners==name;idx=order.index(name);above=np.isin(owners,order[idx+1:])
    extend=dilate(mask,padding)&~mask&above&(alpha==255)
    completion_counts[name]=int(extend.sum())
    if extend.any():
        # Blur normalized colors: no black RGB bleeding from alpha-zero regions.
        blur_a=np.array(Image.fromarray(np.uint8(mask)*255).filter(ImageFilter.GaussianBlur(padding+1)),float)/255
        for c in range(3):
            numerator=np.array(Image.fromarray(np.uint8(a[:,:,c]*mask)).filter(ImageFilter.GaussianBlur(padding+1)),float)
            color=np.clip(numerator/np.maximum(blur_a,.001),0,255)
            layers[name][extend,c]=color[extend].astype('uint8')
        layers[name][extend,3]=255

# Eye half and closed PNGs share the same crop rectangle and pivot. Half is a
# down-moving upper lid with the original pupil pixels staying fixed.
for spec in eye_specs:
    side=spec['side'];cx,cy=spec['center'];a0=.26;cs,sn=math.cos(a0),math.sin(a0)
    xx=(X-cx)*cs+(Y-cy)*sn;yy=-(X-cx)*sn+(Y-cy)*cs
    half=layers['eye_'+side+'_open'].copy();half[yy<0]=0
    layers['eye_'+side+'_half']=half
    lid=Image.new('RGBA',(W,H));d=ImageDraw.Draw(lid)
    pts=[]
    for t in np.linspace(-1,1,61):
        lx=t*36;ly=6.5*(1-t*t);pts.append((cx+cs*lx-sn*ly,cy+sn*lx+cs*ly))
    d.line(pts,fill=(28,119,192,255),width=7,joint='curve')
    for px,py in [pts[0],pts[-1]]:d.ellipse((px-3.5,py-3.5,px+3.5,py+3.5),fill=(28,119,192,255))
    layers['eye_'+side+'_closed']=np.array(lid)

master=Image.fromarray(a).resize((2048,2048),Image.Resampling.LANCZOS)
master.save(APP/'assets/master.png')
metadata=[]
pivots={'hair_back':[620,680],'hair_front':[608,440],'face':[590,800],'ear_l':[374,386],'ear_r':[998,626],'headdress':[636,371],'bow_l':[346,411],'bow_r':[976,646],'ahoge':[700,308],'blush_l':[337,868],'blush_r':[753,999]}
depths={'hair_back':.05,'ear_l':.095,'ear_r':.095,'face':.09,'hair_front':.10,'headdress':.10,'bow_l':.10,'bow_r':.10,'ahoge':.10,'blush_l':.091,'blush_r':.091}
for spec in eye_specs:
    for state in ['open','half','closed']:
        name='eye_'+spec['side']+'_'+state;pivots[name]=spec['center'];depths[name]=.092
for name in names:
    image=Image.fromarray(layers[name]).resize((2048,2048),Image.Resampling.LANCZOS);image.save(DEST/(name+'.png'))
    is_eye=name.startswith('eye_');spec=next((s for s in eye_specs if is_eye and name.startswith('eye_'+s['side']+'_')),None)
    box=[round(v*SCALE) for v in spec['box']] if spec else (list(image.getbbox()) if image.getbbox() else [0,0,0,0])
    pivot=[round(v*SCALE,3) for v in pivots.get(name,[W/2,H/2])]
    metadata.append({'name':name,'file':'assets/layers/'+name+'.png','box':box,'pivot':pivot,'depth':depths.get(name,0),'empty':image.getbbox() is None,'eyeSide':spec['side'] if spec else None,'visibleAtRest':name in order,'overlapPx':12 if completion_counts.get(name,0)>0 else 0})
rig={'version':2,'format':'bluefish-layer-mesh-2d','size':[2048,2048],'master':'assets/master.png',
     'sourceSize':[W,H],'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
     'limits':{'yaw':18,'pitch':12,'roll':10},'drawOrder':order,'layers':metadata,
     'eyes':[{'side':s['side'],'center':[round(v*SCALE,3) for v in s['center']],'box':[round(v*SCALE) for v in s['box']],'tilt':.26} for s in eye_specs],
     'completion':{'face':'Original visible skin; local interpolation under eyes/blush; inferred skin backing under bangs.','hair_back':'Original visible pixels plus inferred occluded blue backing.','body':'Empty: complete head portrait has no body.','mouth':'Empty: approved expression has no drawn mouth.','overlap':'12px at occluded attachment edges where geometrically possible; never outward over the silhouette.','nativeResolution':'1254 source resampled with Lanczos onto 2048 fixed grid; not native 2048 generation.'}}
(APP/'assets/rig.json').write_text(json.dumps(rig,ensure_ascii=False,indent=2),encoding='utf8')
# Recomposition test on the delivered PNGs, not intermediate masks.
composite=Image.new('RGBA',(2048,2048))
for name in order:composite.alpha_composite(Image.open(DEST/(name+'.png')))
composite.save(APP/'assets/reconstructed.png')
diff=np.abs(np.array(master).astype(int)-np.array(composite).astype(int));report={'pngCount':len(names),'size':[2048,2048],'empty':['body','mouth'],'meanAbsRgbaError':float(diff.mean()),'pixelsRgbaErrorOver8':int((diff.max(2)>8).sum()),'completionCountsNative':completion_counts,'canvasEdgeAlphaMax':max(int(np.array(composite)[0,:,3].max()),int(np.array(composite)[-1,:,3].max()),int(np.array(composite)[:,0,3].max()),int(np.array(composite)[:,-1,3].max()))}
(APP/'assets/split-validation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
# Review contact sheet, expressly not a requested PNG part.
sheet=Image.new('RGB',(1200,math.ceil(len(names)/5)*280),(36,43,56));d=ImageDraw.Draw(sheet)
for idx,name in enumerate(names):
    layer=Image.open(DEST/(name+'.png'));layer.thumbnail((230,240));x=(idx%5)*240;y=(idx//5)*280;sheet.paste(layer,(x+(240-layer.width)//2,y+25),layer);d.text((x+8,y+7),name,fill=(230,235,245))
sheet.save(ROOT/'assets/parts-contact.jpg')
print(json.dumps(report))
