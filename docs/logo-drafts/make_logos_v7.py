import sys, os, math
sys.path.insert(0,'/tmp/claude-0/n')
from brand import Font, FD
from brand3 import glyph_fit
from brand4 import CORM6, CORM6I, PAL
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
OUT='/home/user/Soegi/docs/logo-drafts/v7'; os.makedirs(OUT,exist_ok=True)
T0=PAL['P3-shu']
_n=[0]
def uid(): _n[0]+=1; return f'c{_n[0]}'

def glyph_box(font,ch,height,cx,cy):
    g=font.gs[font.cmap[ord(ch)]]; bp=BoundsPen(font.gs); g.draw(bp); x0,y0,x1,y1=bp.bounds
    k=height/(y1-y0); return k,(cx-k*(x1-x0)/2, cy-height/2, k*(x1-x0), height)  # left, top, w, h

def N_ring(T,dark=False,diag=False,bead=False,ringcol=None):
    c=T['dmark'] if dark else T['main']; ac=T['dacc'] if dark else T['seal']
    out=(f'<circle cx="32" cy="32" r="29.5" fill="none" stroke="{c}" stroke-width="1.8"/>'
         f'<circle cx="32" cy="32" r="26.3" fill="none" stroke="{c}" stroke-width=".7" stroke-opacity=".7"/>')
    d=glyph_fit(CORM6,'N',25,32,32.4)
    out+=f'<path d="{d}" fill="{c}"/>'
    if diag:
        k,(L,Tp,W,H)=glyph_box(CORM6,'N',25,32,32.4)
        u=uid()
        # diagonal band: between the two stems (measured on the glyph shape)
        gg=CORM6.gs[CORM6.cmap[ord('N')]]; bp=BoundsPen(CORM6.gs); gg.draw(bp); gx0,gy0,gx1,gy1=bp.bounds
        kk=25/(gy1-gy0); tx=32-kk*(gx0+gx1)/2; ty=32.4+kk*(gy0+gy1)/2
        poly=[(152,640),(232,640),(606,170),(606,-25),(152,505)]   # font units: only the diagonal stroke
        pts=' '.join(f'{tx+kk*x:.2f},{ty-kk*y:.2f}' for x,y in poly)
        out+=(f'<clipPath id="{u}"><polygon points="{pts}"/></clipPath>'
              f'<path d="{d}" fill="{ac}" clip-path="url(#{u})"/>')
    if bead:
        a=math.radians(-48); x=32+29.5*math.cos(a); y=32+29.5*math.sin(a)
        out+=f'<circle cx="{x:.2f}" cy="{y:.2f}" r="4.4" fill="{ac}"/>'
    return out

def letters(font,text,x,base,size,track,colors,default):
    k=size/font.upm; cx=x; parts=[]
    for i,ch in enumerate(text):
        g=font.gs[font.cmap[ord(ch)]]; pen=SVGPathPen(font.gs); g.draw(TransformPen(pen,(k,0,0,-k,cx,base)))
        parts.append(f'<path d="{pen.getCommands()}" fill="{colors.get(i,default)}"/>'); cx+=g.width*k+track*size
    return ''.join(parts), cx-x-track*size

def lock(variant,dark,layout):
    T=T0; V=VARIANTS[variant]
    tx=T['dtext'] if dark else T['text']; ac=T['dacc'] if dark else T['accent']
    bg=T['dbg'] if dark else T['paper']; pad=10
    cons=ac if not V.get('cons_ink') else tx
    mk=lambda h:f'<g transform="scale({h/64})">{N_ring(T,dark,diag=V.get("diag"),bead=V.get("bead"))}</g>'
    s1=56;s2=26; cap=CORM6.capH(s1)
    cm={1:ac} if V.get('o') else {}
    if layout=='h':
        mh=72;gx=24;x=mh+gx;Hb=cap+s2*1.3;base1=(mh-Hb)/2+cap-(7 if V.get('swash') else 0)
        a,w1=letters(CORM6,'Nodus',x,base1,s1,0.01,cm,tx)
        b,w2=letters(CORM6I,'Consulting',x+2,base1+s2*1.05,s2,0.02,{},cons)
        W=x+max(w1,w2); H=mh; extra=''
        if V.get('swash'): extra=swash(x+2,base1+s2*1.05+10,w2,ac)
        inner=mk(mh)+a+b+extra
    elif layout=='v':
        mh=84; w1=CORM6.width('Nodus',s1,0.01); w2=CORM6I.width('Consulting',s2,0.02); W=max(w1,w2,mh); base1=mh+22+cap
        a,_=letters(CORM6,'Nodus',(W-w1)/2,base1,s1,0.01,cm,tx)
        b,_=letters(CORM6I,'Consulting',(W-w2)/2,base1+s2*1.15,s2,0.02,{},cons)
        extra=swash((W-w2)/2,base1+s2*1.15+10,w2,ac) if V.get('swash') else ''
        H=base1+s2*1.15+(20 if V.get('swash') else 8); inner=f'<g transform="translate({(W-mh)/2})">{mk(mh)}</g>'+a+b+extra
    else:
        mh=44;size=34;cap=CORM6.capH(size);w1=CORM6.width('Nodus',size,0.01);x=mh+14;base=(mh+cap)/2;sp=size*.24
        a,_=letters(CORM6,'Nodus',x,base,size,0.01,cm,tx); b,w2=letters(CORM6I,'Consulting',x+w1+sp,base,size,0.01,{},cons)
        W=x+w1+sp+w2;H=mh;inner=mk(mh)+a+b
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W+2*pad:.1f} {H+2*pad:.1f}" width="{(W+2*pad)*2:.0f}" height="{(H+2*pad)*2:.0f}" role="img" aria-label="Nodus Consulting">'
            f'<rect x="{-pad}" y="{-pad}" width="{W+2*pad:.1f}" height="{H+2*pad:.1f}" fill="{bg}"/>{inner}</svg>')

def swash(x,y,w,col):
    # a tapered hand-drawn underline: thin at the left, swelling, flicking up at the right end
    p=(f'M{x:.1f} {y:.1f} C{x+w*.30:.1f} {y+4.5:.1f} {x+w*.70:.1f} {y+5.5:.1f} {x+w:.1f} {y-2.2:.1f} '
       f'C{x+w*.72:.1f} {y+8.2:.1f} {x+w*.30:.1f} {y+7.4:.1f} {x:.1f} {y:.1f}Z')
    return f'<path d="{p}" fill="{col}"/>'

VARIANTS={
 'v0-base':    dict(label='いまの案（基準）', desc='輪のN、Consultingだけ朱のイタリック'),
 'v1-o':       dict(label='o を朱に', desc='NodusのoだけをÕ朱に。「結び目（node）」の輪になるので、文字の中のチャームポイント'),
 'v2-diag':    dict(label='Nの斜め線を朱に', desc='Nの斜め線＝2本の柱を結ぶ線だけを朱に。輪のNの中に、「結ぶ」を一筆'),
 'v3-bead':    dict(label='輪に朱の玉', desc='輪の右上に、朱の玉をひとつ。数珠や結び玉のように。Nの中の点とは別の位置'),
 'v4-swash':   dict(label='朱の筆の下線', desc='Consultingの下に、細くなる朱の筆の線。手書きの署名のような温かさ'),
 'v5-combo':   dict(label='斜め線＋o', desc='Nの斜め線とoの2か所だけを朱に。色が響き合う'),
}
VARIANTS['v1-o']['desc']='NodusのoだけをÕ朱に。「結び目」の輪になる'.replace('Õ','')
VARIANTS['v0-base']['o']=False
VARIANTS['v1-o']['o']=True
VARIANTS['v2-diag']['diag']=True
VARIANTS['v3-bead']['bead']=True
VARIANTS['v4-swash']['swash']=True
VARIANTS['v5-combo'].update(diag=True,o=True)

if __name__=='__main__':
    for k in VARIANTS:
        for dark in (False,True):
            tn='dark' if dark else 'light'
            for lay,nm in (('h','twoline'),('v','stacked'),('o','oneline')):
                open(f'{OUT}/{k}_{tn}_{nm}.svg','w',encoding='utf-8').write(lock(k,dark,lay))
        V=VARIANTS[k]
        open(f'{OUT}/{k}_mark.svg','w',encoding='utf-8').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256" role="img" aria-label="Nodus Consulting">{N_ring(T0,False,diag=V.get("diag"),bead=V.get("bead"))}</svg>')
    print(len(os.listdir(OUT)))
