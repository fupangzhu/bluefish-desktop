// Minimal QR Code encoder: byte mode, error correction level M, versions 1–40.
// Enough to show the WeChat login link without a third-party runtime dependency.
const ECC_PER_BLOCK=[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const NUM_BLOCKS=[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
const ECC_FORMAT_M=0;

function rawModules(ver){
  let r=(16*ver+128)*ver+64;
  if(ver>=2){const n=Math.floor(ver/7)+2;r-=(25*n-10)*n-55;if(ver>=7)r-=36;}
  return r;
}
const dataCodewords=ver=>Math.floor(rawModules(ver)/8)-ECC_PER_BLOCK[ver]*NUM_BLOCKS[ver];

function gfMul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z&0xff;}
function rsDivisor(degree){
  const r=new Array(degree).fill(0);r[degree-1]=1;let root=1;
  for(let i=0;i<degree;i++){for(let j=0;j<r.length;j++){r[j]=gfMul(r[j],root);if(j+1<r.length)r[j]^=r[j+1];}root=gfMul(root,2);}
  return r;
}
function rsRemainder(data,div){
  const r=div.map(()=>0);
  for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=gfMul(c,f);});}
  return r;
}
function alignmentPositions(ver){
  if(ver===1)return [];
  const n=Math.floor(ver/7)+2,size=ver*4+17,step=ver===32?26:Math.ceil((ver*4+4)/(n*2-2))*2;
  const r=[6];for(let pos=size-7;r.length<n;pos-=step)r.splice(1,0,pos);
  return r;
}

export function encodeQr(text,{mask=null}={}){
  const bytes=[...new TextEncoder().encode(String(text))];
  let ver=1;
  for(;ver<=40;ver++){const cc=ver<10?8:16;if(4+cc+bytes.length*8<=dataCodewords(ver)*8)break;}
  if(ver>40)throw Error('内容太长，无法生成二维码');
  // Data bits.
  const bits=[];const push=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push((v>>>i)&1);};
  push(4,4);push(bytes.length,ver<10?8:16);for(const b of bytes)push(b,8);
  const cap=dataCodewords(ver)*8;
  push(0,Math.min(4,cap-bits.length));push(0,(8-bits.length%8)%8);
  for(let pad=0xec;bits.length<cap;pad^=0xec^0x11)push(pad,8);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a<<1|b,0));
  // Error correction, split into blocks and interleaved.
  const nb=NUM_BLOCKS[ver],ecl=ECC_PER_BLOCK[ver],raw=Math.floor(rawModules(ver)/8),short=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDivisor(ecl);
  const blocks=[];
  for(let i=0,k=0;i<nb;i++){
    const dat=data.slice(k,k+shortLen-ecl+(i<short?0:1));k+=dat.length;
    const ecc=rsRemainder(dat,div);if(i<short)dat.push(0);blocks.push(dat.concat(ecc));
  }
  const codewords=[];
  for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-ecl||j>=short)codewords.push(b[i]);});
  // Matrix.
  const size=ver*4+17,m=Array.from({length:size},()=>new Array(size).fill(false)),fn=Array.from({length:size},()=>new Array(size).fill(false));
  const set=(x,y,dark)=>{m[y][x]=dark;fn[y][x]=true;};
  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  const finder=(x,y)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy)),xx=x+dx,yy=y+dy;if(xx>=0&&xx<size&&yy>=0&&yy<size)set(xx,yy,d!==2&&d!==4);}};
  finder(3,3);finder(size-4,3);finder(3,size-4);
  const al=alignmentPositions(ver),last=al.length-1;
  for(let i=0;i<al.length;i++)for(let j=0;j<al.length;j++){
    if((i===0&&j===0)||(i===0&&j===last)||(i===last&&j===0))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(al[i]+dx,al[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  const format=mk=>{
    const d=ECC_FORMAT_M<<3|mk;let rem=d;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
    const b=(d<<10|rem)^0x5412,bit=i=>((b>>>i)&1)===1;
    for(let i=0;i<=5;i++)set(8,i,bit(i));
    set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
    for(let i=9;i<15;i++)set(14-i,8,bit(i));
    for(let i=0;i<8;i++)set(size-1-i,8,bit(i));
    for(let i=8;i<15;i++)set(8,size-15+i,bit(i));
    set(8,size-8,true);
  };
  format(0);
  if(ver>=7){
    let rem=ver;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);
    const b=ver<<12|rem;
    for(let i=0;i<18;i++){const bit=((b>>>i)&1)===1,a=size-11+i%3,c=Math.floor(i/3);set(a,c,bit);set(c,a,bit);}
  }
  let i=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right=5;
    for(let v=0;v<size;v++)for(let j=0;j<2;j++){
      const x=right-j,up=((right+1)&2)===0,y=up?size-1-v:v;
      if(!fn[y][x]&&i<codewords.length*8){m[y][x]=((codewords[i>>>3]>>>(7-(i&7)))&1)===1;i++;}
    }
  }
  const MASKS=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
  const apply=mk=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fn[y][x]&&MASKS[mk](x,y))m[y][x]=!m[y][x];};
  let chosen=mask;
  if(chosen===null){
    let best=Infinity;
    for(let mk=0;mk<8;mk++){apply(mk);format(mk);const p=penalty(m);if(p<best){best=p;chosen=mk;}apply(mk);}
  }
  apply(chosen);format(chosen);
  return {size,version:ver,mask:chosen,modules:m};
}

// Standard mask penalty (rules 1–4).
function penalty(m){
  const n=m.length;let score=0;
  const lines=[];for(let i=0;i<n;i++){lines.push(m[i]);lines.push(m.map(r=>r[i]));}
  for(const line of lines){
    let run=1;
    for(let i=1;i<=n;i++){if(i<n&&line[i]===line[i-1])run++;else{if(run>=5)score+=3+run-5;run=1;}}
    const s='0000'+line.map(b=>b?'1':'0').join('')+'0000';
    for(let k=s.indexOf('1011101');k!==-1;k=s.indexOf('1011101',k+1)){if(s.slice(k-4,k)==='0000'||s.slice(k+7,k+11)==='0000')score+=40;}
  }
  let dark=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){if(m[y][x])dark++;if(x<n-1&&y<n-1&&m[y][x]===m[y][x+1]&&m[y][x]===m[y+1][x]&&m[y][x]===m[y+1][x+1])score+=3;}
  const total=n*n;score+=10*Math.max(0,Math.ceil(Math.abs(dark*20-total*10)/total)-1);
  return score;
}

// SVG markup with a 4-module quiet zone; one path for all dark modules.
export function qrSvg(text,{scale=4,dark='#161616',light='#fff'}={}){
  const {size,modules}=encodeQr(text),q=4,w=size+2*q;let d='';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(modules[y][x])d+=`M${x+q} ${y+q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" width="${w*scale}" height="${w*scale}" shape-rendering="crispEdges"><rect width="${w}" height="${w}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
