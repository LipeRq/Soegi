import sys, os, math
sys.path.insert(0,'/tmp/claude-0/n')
from brand import Font, FD
from brand3 import glyph_fit
from brand4 import CORM6, CORM6I, PAL
from brand5 import glyph_box, letters
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
OUT='/home/user/Soegi/docs/logo-drafts/v8'; os.makedirs(OUT,exist_ok=True)
T0=PAL['P3-shu']
_n=[0]
def uid(): _n[0]+=1; return f'd{_n[0]}'

def pts_path(pts): return 'M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in pts)+' Z'

# ---------------- marks ----------------
def ring_plain(c,ac):
    return (f'<circle cx="32" cy="32" r="29.5" fill="none" stroke="{c}" stroke-width="1.8"/>'
            f'<circle cx="32" cy="32" r="26.3" fill="none" stroke="{c}" stroke-width=".7" stroke-opacity=".7"/>')

def ring_braid(c,ac):
    """double ring whose two lines swap places twice (a braided / tied ring)"""
    u=uid(); rm=28.2; h=1.55; pts=[]
    def f(th): s=math.sin(th); return s/math.sqrt(s*s+0.012)
    th0=math.radians(-45)
    A=[];B=[]
    for i in range(0,721):
        th=2*math.pi*i/720
        ff=f(th-th0); 
        A.append((32+(rm+h*ff)*math.cos(th),32+(rm+h*ff)*math.sin(th)))
        B.append((32+(rm-h*ff)*math.cos(th),32+(rm-h*ff)*math.sin(th)))
    cross=[(32+rm*math.cos(th0+k*math.pi),32+rm*math.sin(th0+k*math.pi)) for k in (0,1)]
    def pd(P): return 'M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in P)+' Z'
    def mask(i,pt): return (f'<mask id="{u}{i}" maskUnits="userSpaceOnUse" x="-5" y="-5" width="74" height="74"><rect x="-5" y="-5" width="74" height="74" fill="#fff"/>'
                            f'<circle cx="{pt[0]:.2f}" cy="{pt[1]:.2f}" r="2.7" fill="#000"/></mask>')
    sw=1.5
    return (f'<defs>{mask(0,cross[1])}{mask(1,cross[0])}</defs>'
            f'<g mask="url(#{u}0)"><path d="{pd(A)}" fill="none" stroke="{c}" stroke-width="{sw}"/></g>'
            f'<g mask="url(#{u}1)"><path d="{pd(B)}" fill="none" stroke="{c}" stroke-width="{sw}"/></g>')

def ring_hand(c,ac):
    return hand_o(32,32,29.0,c,wscale=0.30,start=-52)

def mark_ringN(T,dark,ring=ring_plain):
    c=T['dmark'] if dark else T['main']; ac=T['dacc'] if dark else T['seal']
    return ring(c,ac)+f'<path d="{glyph_fit(CORM6,"N",25,32,32.4)}" fill="{c}"/>'

def mark_woven(T,dark):
    """a larger N whose serifs pass over / under the ring"""
    c=T['dmark'] if dark else T['main']; u=uid()
    H=40; d=glyph_fit(CORM6,'N',H,32,32.3)
    gg=CORM6.gs[CORM6.cmap[ord('N')]]; bp=BoundsPen(CORM6.gs); gg.draw(bp); gx0,gy0,gx1,gy1=bp.bounds
    kk=H/(gy1-gy0); tx=32-kk*(gx0+gx1)/2; ty=32.3+kk*(gy0+gy1)/2
    P=lambda x,y:(tx+kk*x,ty-kk*y)
    tl=P(30,619); tr=P(716,619); bl=P(36,6); br=P(627,-8)
    R=28.6; r=3.3
    def hole(i,pt): return (f'<mask id="{u}{i}" maskUnits="userSpaceOnUse" x="-5" y="-5" width="74" height="74"><rect x="-5" y="-5" width="74" height="74" fill="#fff"/>'
                            f'<circle cx="{pt[0]:.2f}" cy="{pt[1]:.2f}" r="{r}" fill="#000"/></mask>')
    # ring is cut at tl and br (N over ring) ; N is cut at tr and bl (ring over N)
    ringm=(f'<mask id="{u}r" maskUnits="userSpaceOnUse" x="-5" y="-5" width="74" height="74"><rect x="-5" y="-5" width="74" height="74" fill="#fff"/>'
           +''.join(f'<circle cx="{p[0]:.2f}" cy="{p[1]:.2f}" r="{r+0.6}" fill="#000"/>' for p in (tl,br))+'</mask>')
    nm=(f'<mask id="{u}n" maskUnits="userSpaceOnUse" x="-5" y="-5" width="74" height="74"><rect x="-5" y="-5" width="74" height="74" fill="#fff"/>'
        +''.join(f'<circle cx="{p[0]:.2f}" cy="{p[1]:.2f}" r="{r}" fill="#000"/>' for p in (tr,bl))+'</mask>')
    return (f'<defs>{ringm}{nm}</defs>'
            f'<g mask="url(#{u}r)"><circle cx="32" cy="32" r="{R}" fill="none" stroke="{c}" stroke-width="2.4"/></g>'
            f'<g mask="url(#{u}n)"><path d="{d}" fill="{c}"/></g>'
            f'<path d="{d}" fill="{c}" clip-path="none" mask="none" opacity="0"/>')

# ---------------- hand-written o ----------------
def hand_o(cx,cy,ro,col,wscale=1.0,start=-35):
    """a pen-drawn o: starts at the upper right, goes round, and overshoots its own start a little"""
    N=140; pts_o=[];pts_i=[]
    phi0=math.radians(start); turns=1.07
    r0=ro*0.86; dr=ro*0.16
    for i in range(N+1):
        t=i/N; phi=phi0-2*math.pi*turns*t
        r=r0+dr*t-ro*0.05*math.sin(math.pi*t)
        # calligraphic width: thick on the sides, thin at top/bottom, tapered at both ends
        side=abs(math.cos(phi)); w=wscale*ro*(0.10+0.21*side**1.2)*(0.25+0.75*math.sin(math.pi*min(1,t*1.0))**0.55)
        pts_o.append((cx+(r+w/2)*math.cos(phi)*1.0, cy+(r+w/2)*math.sin(phi)*1.0))
        pts_i.append((cx+(r-w/2)*math.cos(phi)*1.0, cy+(r-w/2)*math.sin(phi)*1.0))
    poly=pts_o+pts_i[::-1]
    return f'<path d="{pts_path(poly)}" fill="{col}"/>'

def nodus(x,base,size,track,tx,ac,o_mode):
    """draw 'Nodus'; the o is vermilion (font o, or a hand-written o)"""
    k=size/CORM6.upm; cx=x; out=''
    for i,ch in enumerate('Nodus'):
        g=CORM6.gs[CORM6.cmap[ord(ch)]]
        if ch=='o' and o_mode=='hand':
            bp=BoundsPen(CORM6.gs); g.draw(bp); x0,y0,x1,y1=bp.bounds
            ccx=cx+k*(x0+x1)/2; ccy=base-k*(y0+y1)/2
            out+=hand_o(ccx,ccy,k*(y1-y0)/2*1.02,ac)
        else:
            pen=SVGPathPen(CORM6.gs); g.draw(TransformPen(pen,(k,0,0,-k,cx,base)))
            out+=f'<path d="{pen.getCommands()}" fill="{ac if ch=="o" else tx}"/>'
        cx+=g.width*k+track*size
    return out, cx-x-track*size

def lock(variant,dark,layout):
    T=T0; V=VARIANTS[variant]
    tx=T['dtext'] if dark else T['text']; ac=T['dacc'] if dark else T['accent']
    bg=T['dbg'] if dark else T['paper']; pad=10
    mkf=V['mark']
    mk=lambda h:f'<g transform="scale({h/64})">{mkf(T,dark)}</g>'
    s1=56;s2=26;cap=CORM6.capH(s1)
    if layout=='h':
        mh=72;gx=24;x=mh+gx;Hb=cap+s2*1.3;base1=(mh-Hb)/2+cap
        a,w1=nodus(x,base1,s1,0.01,tx,ac,V['o'])
        b,w2=letters(CORM6I,'Consulting',x+2,base1+s2*1.05,s2,0.02,{},ac)
        W=x+max(w1,w2);H=mh;inner=mk(mh)+a+b
    elif layout=='v':
        mh=84;w1=CORM6.width('Nodus',s1,0.01);w2=CORM6I.width('Consulting',s2,0.02);W=max(w1,w2,mh);base1=mh+22+cap
        a,_=nodus((W-w1)/2,base1,s1,0.01,tx,ac,V['o'])
        b,_=letters(CORM6I,'Consulting',(W-w2)/2,base1+s2*1.15,s2,0.02,{},ac)
        H=base1+s2*1.15+8;inner=f'<g transform="translate({(W-mh)/2})">{mk(mh)}</g>'+a+b
    else:
        mh=44;size=34;cap=CORM6.capH(size);w1=CORM6.width('Nodus',size,0.01);x=mh+14;base=(mh+cap)/2;sp=size*.24
        a,_=nodus(x,base,size,0.01,tx,ac,V['o']);b,w2=letters(CORM6I,'Consulting',x+w1+sp,base,size,0.01,{},ac)
        W=x+w1+sp+w2;H=mh;inner=mk(mh)+a+b
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W+2*pad:.1f} {H+2*pad:.1f}" width="{(W+2*pad)*2:.0f}" height="{(H+2*pad)*2:.0f}" role="img" aria-label="Nodus Consulting">'
            f'<rect x="{-pad}" y="{-pad}" width="{W+2*pad:.1f}" height="{H+2*pad:.1f}" fill="{bg}"/>{inner}</svg>')

VARIANTS={
 'w0-base':   dict(label='基準（1：oを朱に）', desc='いまの案。二重の輪のN、oだけ朱の活字', mark=lambda T,d: mark_ringN(T,d), o='font'),
 'w1-braid':  dict(label='結ばれた二重の輪', desc='輪の内側と外側の線が、2か所で入れ替わる。組み紐のように結ばれた輪（Nodus＝結び目）', mark=lambda T,d: mark_ringN(T,d,ring_braid), o='font'),
 'w2-penring':dict(label='ペンで書いた輪', desc='輪を、ペンで一筆書きしたように。書き終わりが書き始めに少し重なる。活字のNとの対比', mark=lambda T,d: mark_ringN(T,d,ring_hand), o='font'),
 'w3-hand':   dict(label='手書きのo', desc='oを、ペンで書いたように（朱）。書き終わりが書き始めに少し重なる。活字の中の、人の手', mark=lambda T,d: mark_ringN(T,d), o='hand'),
 'w4-braid-hand':  dict(label='結ばれた輪＋手書きのo', desc='1と3の組み合わせ。輪は「結ぶ」、oは「手」', mark=lambda T,d: mark_ringN(T,d,ring_braid), o='hand'),
 'w5-onestroke':   dict(label='一筆の輪＋一筆のo', desc='2と3の組み合わせ。マークの輪もoも、同じペンの一筆。いちばん統一感がある', mark=lambda T,d: mark_ringN(T,d,ring_hand), o='hand'),
}
if __name__=='__main__':
    for k,V in VARIANTS.items():
        for dark in (False,True):
            tn='dark' if dark else 'light'
            for lay,nm in (('h','twoline'),('v','stacked'),('o','oneline')):
                open(f'{OUT}/{k}_{tn}_{nm}.svg','w',encoding='utf-8').write(lock(k,dark,lay))
        open(f'{OUT}/{k}_mark.svg','w',encoding='utf-8').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256" role="img" aria-label="Nodus Consulting">{V["mark"](T0,False)}</svg>')
    print(len(os.listdir(OUT)))
