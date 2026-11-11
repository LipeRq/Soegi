import sys, os
sys.path.insert(0,'/tmp/claude-0/n')
from brand import *
from fontTools.pens.boundsPen import BoundsPen
OUT3='/home/user/Soegi/docs/logo-drafts/v5'; os.makedirs(OUT3,exist_ok=True)
NAME_LABEL='Nodus Consulting'
CORM5=Font(FD+'cormorant-garamond/files/cormorant-garamond-latin-500-normal.woff')

def glyph_fit(font,ch,height,cx,cy):
    gs=font.gs[font.cmap[ord(ch)]]; bp=BoundsPen(font.gs); gs.draw(bp); x0,y0,x1,y1=bp.bounds
    k=height/(y1-y0); pen=SVGPathPen(font.gs)
    # flip y; centre bounds on (cx,cy)
    tx=cx-k*(x0+x1)/2; ty=cy+k*(y0+y1)/2
    gs.draw(TransformPen(pen,(k,0,0,-k,tx,ty))); return pen.getCommands()

def N_circle(T):
    d=glyph_fit(CORM6,'N',25,32,32.5)
    return (f'<circle cx="32" cy="32" r="29.5" fill="none" stroke="{T["flat_a"]}" stroke-width="1.6"/>'
            f'<circle cx="32" cy="32" r="26.4" fill="none" stroke="{T["flat_a"]}" stroke-width=".6" stroke-opacity=".6"/>'
            f'<path d="{d}" fill="{T["text"]}"/><circle cx="32" cy="32.5" r="2.7" fill="{T["red"][1]}"/>')

def N_line(T):
    P=[(17,48),(17,16),(47,48),(47,16)]
    path='M'+' L'.join(f'{x} {y}' for x,y in P)
    nodes=''.join(f'<circle cx="{x}" cy="{y}" r="3.4" fill="{T["flat_b"]}"/>' for x,y in P)
    return (f'<path d="{path}" fill="none" stroke="{T["flat_a"]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
            +nodes+f'<circle cx="32" cy="32" r="3.6" fill="{T["red"][1]}"/>')

def N_serif(T):
    d=glyph_fit(CORM6,'N',36,32,32.5)
    return f'<path d="{d}" fill="{T["flat_a"]}"/><circle cx="32" cy="32.5" r="3.2" fill="{T["red"][1]}"/><circle cx="32" cy="32.5" r="3.2" fill="none" stroke="{T["bg"] or "#F4F7F6"}" stroke-width="1.2"/>'

def tile_N(T=None):
    p=uid()
    bg=grad(p+'bg','#2A8C93','#0E4A50')+f'<radialGradient id="{p}gl" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    d=glyph_fit(CORM6,'N',34,32,32.6)
    return (f'<defs>{bg}</defs><rect width="64" height="64" rx="15" fill="url(#{p}bg)"/><rect width="64" height="64" rx="15" fill="url(#{p}gl)"/>'
            f'<path d="{d}" fill="#fff"/><circle cx="32" cy="32.6" r="3.3" fill="#D63A52" stroke="#fff" stroke-width="1.4"/>')

def tile_line():
    p=uid()
    bg=grad(p+'bg','#2A8C93','#0E4A50')+f'<radialGradient id="{p}gl" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    P=[(20,46),(20,18),(44,46),(44,18)]; path='M'+' L'.join(f'{x} {y}' for x,y in P)
    return (f'<defs>{bg}</defs><rect width="64" height="64" rx="15" fill="url(#{p}bg)"/><rect width="64" height="64" rx="15" fill="url(#{p}gl)"/>'
            f'<path d="{path}" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>'
            +''.join(f'<circle cx="{x}" cy="{y}" r="3.6" fill="#BFE9EC"/>' for x,y in P)+'<circle cx="32" cy="32" r="3.6" fill="#D63A52" stroke="#fff" stroke-width="1.4"/>')

TWO=dict(f1=CORM6,s1=56,t1=0.015,f2=JOST4,s2=16,t2=0.34,gap=13,justify=False,rule=True,txt1='Nodus',txt2='Consulting')

def one_line(markfn,T,mark_h=52,size=40,pad=6,gapx=18):
    f=CORM6; fz=CORM5
    d1,w1=f.path('Nodus',0,0,size,0.01); d2,w2=fz.path('Consulting',0,0,size,0.01)
    sp=size*0.26; cap=f.capH(size)
    W=mark_h+gapx+w1+sp+w2; H=mark_h; base=(H+cap)/2
    a,_=f.path('Nodus',mark_h+gapx,base,size,0.01); b,_=fz.path('Consulting',mark_h+gapx+w1+sp,base,size,0.01)
    inner=f'<g transform="scale({mark_h/64})">{markfn(T)}</g><path d="{a}" fill="{T["text"]}"/><path d="{b}" fill="{T["text"]}" fill-opacity=".78"/>'
    bg=f'<rect x="{-pad}" y="{-pad}" width="{W+2*pad}" height="{H+2*pad}" fill="{T["bg"]}"/>' if T['bg'] else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W+2*pad:.1f} {H+2*pad:.1f}" width="{(W+2*pad)*2:.0f}" height="{(H+2*pad)*2:.0f}" role="img" aria-label="Nodus Consulting">{bg}{inner}</svg>'

MARKS={
 'N1-circle':dict(mark=N_circle,icon=lambda T: tile_N(),desc='細い二重の輪の中に、セリフ体のN。Nの斜め線の中央に赤い点（接点）'),
 'N2-serif': dict(mark=N_serif,icon=lambda T: tile_N(),desc='輪なしの、大きなセリフ体のN。斜め線の中央に赤い点。いちばん文字ロゴと一体'),
 'N3-line':  dict(mark=N_line,icon=lambda T: tile_line(),desc='Nを「線と点」で描く。4つの角が結び目、中央の赤い点が接点'),
}
if __name__=='__main__':
    for k,m in MARKS.items():
        for tn,T in (('light',LIGHT),('dark',DARK)):
            T2=dict(T)
            open(f'{OUT3}/{k}_{tn}_oneline.svg','w',encoding='utf-8').write(one_line(m['mark'],T2))
            open(f'{OUT3}/{k}_{tn}_twoline.svg','w',encoding='utf-8').write(lockup(m['mark'],TWO,T2,'h'))
            open(f'{OUT3}/{k}_{tn}_stacked.svg','w',encoding='utf-8').write(lockup(m['mark'],TWO,T2,'v',mark_h=88))
        open(f'{OUT3}/{k}_mark.svg','w',encoding='utf-8').write(mark_svg(m['mark'](LIGHT)))
        open(f'{OUT3}/{k}_icon.svg','w',encoding='utf-8').write(mark_svg(m['icon'](LIGHT)))
    print(len(os.listdir(OUT3)))
