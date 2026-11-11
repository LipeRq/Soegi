import math, itertools, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT='/home/user/Soegi/docs/logo-drafts/v3'; os.makedirs(OUT,exist_ok=True)
FD='/tmp/claude-0/fonts/node_modules/@fontsource/'
_uid=itertools.count(1)
def uid(): return f'u{next(_uid)}'

class Font:
    def __init__(s,path):
        s.f=TTFont(path); s.gs=s.f.getGlyphSet(); s.cmap=s.f.getBestCmap(); s.upm=s.f['head'].unitsPerEm
        bp=BoundsPen(s.gs); s.gs[s.cmap[ord('H')]].draw(bp); s.cap=bp.bounds[3]
    def adv(s,ch,size): return s.gs[s.cmap[ord(ch)]].width*size/s.upm
    def path(s,t,x,base,size,track=0.0):
        k=size/s.upm; cx=x; ds=[]
        for ch in t:
            g=s.gs[s.cmap[ord(ch)]]; pen=SVGPathPen(s.gs); g.draw(TransformPen(pen,(k,0,0,-k,cx,base))); ds.append(pen.getCommands()); cx+=g.width*k+track*size
        return ' '.join(ds), cx-x-track*size
    def width(s,t,size,track=0.0): return sum(s.adv(c,size) for c in t)+track*size*(len(t)-1)
    def capH(s,size): return s.cap*size/s.upm

JOST5=Font(FD+'jost/files/jost-latin-500-normal.woff'); JOST4=Font(FD+'jost/files/jost-latin-400-normal.woff')
SORA7=Font(FD+'sora/files/sora-latin-700-normal.woff'); SORA6=Font(FD+'sora/files/sora-latin-600-normal.woff')
CORM6=Font(FD+'cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff')

# ---------- colour themes ----------
LIGHT=dict(text='#1B2428',sub='#44525A',a=('#3DB4BB','#145C62'),b=('#56656D','#10171A'),hi='#FFFFFF',bg=None,rule='#B9C6C9',
           red=('#FF7587','#B3243B','#7A1626'),flat_a='#1A6D73',flat_b='#1B2428')
DARK =dict(text='#FFFFFF',sub='#B5C7CB',a=('#7FE0E5','#2A9199'),b=('#FFFFFF','#9FB4BA'),hi='#FFFFFF',bg='#14363A',rule='#3E6B70',
           red=('#FF8798','#D63A52','#8E1B2E'),flat_a='#5FC4C9',flat_b='#FFFFFF')

def grad(i,c0,c1,x1=0,y1=0,x2=1,y2=1): return f'<linearGradient id="{i}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{c0}"/><stop offset="1" stop-color="{c1}"/></linearGradient>'
def sphere(i,cols): return (f'<radialGradient id="{i}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="{cols[0]}"/><stop offset=".55" stop-color="{cols[1]}"/><stop offset="1" stop-color="{cols[2]}"/></radialGradient>')

def rr(x,y,w,h,col,sw,extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="none" stroke="{col}" stroke-width="{sw}" stroke-linecap="round" {extra}/>'

def hole(i,cx,cy,r):
    return (f'<mask id="{i}" maskUnits="userSpaceOnUse" x="-30" y="-30" width="160" height="160"><rect x="-30" y="-30" width="160" height="160" fill="#fff"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#000"/></mask>')

def link_pair(T,style,rot=-35,ring_w=30,ring_h=20,sw=5.2,gap=6.4,node=True):
    """style: tube | hair | flat ; returns svg fragment in 64x64 box"""
    p=uid(); x1=8; x2=26  # ring1 8..38, ring2 26..56 (w=30)
    r=ring_h/2; c1=(x1+ring_w-r,32); c2=(x2+r,32)
    d=math.dist(c1,c2)/2; mx=(c1[0]+c2[0])/2; dy=math.sqrt(r*r-d*d)
    top=(mx,32-dy); bot=(mx,32+dy)
    defs=hole(p+'t',*top,gap)+hole(p+'b',*bot,gap)
    if style=='tube':
        defs+=grad(p+'a',*T['a'])+grad(p+'b2',*T['b'])
        defs+=grad(p+'al',T['a'][0],T['a'][0])  # placeholder
        defs+=sphere(p+'s',T['red'])
        def tube(col_id,lite,sw):
            return (rr(x1,22,ring_w,ring_h,f'url(#{col_id})',sw))
        def make(xx,gid,lite):
            return (rr(xx,22,ring_w,ring_h,f'url(#{gid})',sw)+
                    rr(xx-.6,22-.8,ring_w,ring_h,'#fff',sw*.16,'stroke-opacity=".55"').replace('stroke-linecap="round"','stroke-linecap="round"')+
                    rr(xx+.5,22+.7,ring_w,ring_h,'#000',sw*.18,'stroke-opacity=".18"'))
        a=make(x1,p+'a',T['a']); b=make(x2,p+'b2',T['b'])
    elif style=='hair':
        a=rr(x1,22,ring_w,ring_h,T['flat_a'],2.6); b=rr(x2,22,ring_w,ring_h,T['flat_b'],2.6)
    else:
        a=rr(x1,22,ring_w,ring_h,T['flat_a'],sw); b=rr(x2,22,ring_w,ring_h,T['flat_b'],sw)
    body=f'<g mask="url(#{p}t)">{a}</g><g mask="url(#{p}b)">{b}</g>'
    if node:
        if style=='tube':
            body+=f'<circle cx="32" cy="32" r="4.4" fill="url(#{p}s)"/><ellipse cx="30.7" cy="30.5" rx="1.3" ry=".9" fill="#fff" fill-opacity=".7"/>'
        elif style=='hair':
            body+=f'<circle cx="32" cy="32" r="2.6" fill="{T["red"][1]}"/>'
        else:
            body+=f'<circle cx="32" cy="32" r="3.2" fill="{T["red"][1]}"/>'
    return f'<defs>{defs}</defs><g transform="rotate({rot} 32 32)">{body}</g>'

def icon_tile(T,style,shape='squircle'):
    p=uid()
    bg=grad(p+'bg','#2A8C93','#0E4A50',0,0,1,1)+f'<radialGradient id="{p}gl" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    TT=dict(DARK); TT=dict(TT,a=('#FFFFFF','#BFE9EC'),b=('#E3F3F4','#8FCBD0'))
    inner=link_pair(TT,'tube' if style!='hair' else 'hair',node=True) if style!='hair' else link_pair(dict(DARK,flat_a='#fff',flat_b='#BFE9EC'),'hair')
    shp=('<rect width="64" height="64" rx="15" fill="url(#%sbg)"/><rect width="64" height="64" rx="15" fill="url(#%sgl)"/>'%(p,p)) if shape=='squircle' else ('<circle cx="32" cy="32" r="31.5" fill="url(#%sbg)"/><circle cx="32" cy="32" r="31.5" fill="url(#%sgl)"/><circle cx="32" cy="32" r="28.5" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".9"/>'%(p,p))
    return f'<defs>{bg}</defs>{shp}<g transform="translate(32 32) scale(.74) translate(-32 -32)">{inner}</g>'

def mark_svg(frag,size=256,vb='0 0 64 64'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{size}" height="{size}" role="img" aria-label="NODUS CONSULTING">{frag}</svg>'

def wordmark_block(spec,T,x0,y0,align='left'):
    """returns (svg fragments, width, height). spec: dict(f1,s1,t1,f2,s2,t2,justify,gap,rule)"""
    f1,s1,tr1=spec['f1'],spec['s1'],spec['t1']; f2,s2=spec['f2'],spec['s2']
    w1=f1.width('NODUS',s1,tr1); cap1=f1.capH(s1); cap2=f2.capH(s2)
    gap=spec['gap']; rule=spec.get('rule',False)
    d1,_=f1.path('NODUS',x0,y0+cap1,s1,tr1)
    tr2=spec.get('t2',0.0)
    if spec.get('justify',True):
        n=len('CONSULTING'); base_w=f2.width('CONSULTING',s2,0); tr2=(w1-base_w)/(n-1)/s2
    w2=f2.width('CONSULTING',s2,tr2)
    yb=y0+cap1+gap+(cap2+ (spec.get('rulegap',0)*2 if rule else 0))
    d2,_=f2.path('CONSULTING',x0+(w1-w2)/2 if not spec.get('justify',True) else x0,yb,s2,tr2)
    frag=f'<path d="{d1}" fill="{T["text"]}"/><path d="{d2}" fill="{T["sub"]}"/>'
    if rule:
        ry=y0+cap1+gap/2+ (spec.get('rulegap',0)/2)
        frag+=f'<rect x="{x0}" y="{y0+cap1+gap*0.55:.2f}" width="{w1:.1f}" height=".9" fill="{T["rule"]}"/>'
    H=yb-y0
    return frag,max(w1,w2),H

def lockup(markfn,spec,T,layout='h',mark_h=64,gapx=24,pad=6):
    frag=markfn(T)
    mark=f'<g transform="scale({mark_h/64})">{frag}</g>'
    # measure block
    _,wb,hb=wordmark_block(spec,T,0,0)
    if layout=='h':
        ty=(mark_h-hb)/2; tf,_,_=wordmark_block(spec,T,mark_h+gapx,ty)
        W=mark_h+gapx+wb; H=mark_h
        inner=mark+tf
    else:
        W=max(wb,mark_h); mx=(W-mark_h)/2
        tf,_,_=wordmark_block(spec,T,(W-wb)/2,mark_h+gapx*0.85)
        H=mark_h+gapx*0.85+hb
        inner=f'<g transform="translate({mx})">{mark}</g>'+tf
    bg=f'<rect x="{-pad}" y="{-pad}" width="{W+2*pad}" height="{H+2*pad}" fill="{T["bg"]}"/>' if T['bg'] else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W+2*pad:.1f} {H+2*pad:.1f}" width="{(W+2*pad)*2:.0f}" height="{(H+2*pad)*2:.0f}" role="img" aria-label="NODUS CONSULTING">{bg}{inner}</svg>'

SPECS={
 'tube': dict(f1=JOST5,s1=46,t1=0.16,f2=JOST4,s2=13.5,gap=10,justify=True),
 'crest':dict(f1=SORA7,s1=40,t1=0.07,f2=SORA6,s2=11,gap=11,justify=True),
 'hair': dict(f1=CORM6,s1=52,t1=0.20,f2=JOST4,s2=12.5,gap=14,justify=True,rule=True),
}
DIRS={
 '1-tube':  dict(mark=lambda T: link_pair(T,'tube'), spec='tube', icon=lambda T: icon_tile(T,'tube','squircle')),
 '2-crest': dict(mark=lambda T: icon_tile(T,'tube','circle'), spec='crest', icon=lambda T: icon_tile(T,'tube','circle')),
 '3-hair':  dict(mark=lambda T: link_pair(T,'hair'), spec='hair', icon=lambda T: icon_tile(T,'hair','squircle')),
}
if __name__=='__main__':
    for k,d in DIRS.items():
        for tn,T in (('light',LIGHT),('dark',DARK)):
            open(f'{OUT}/{k}_{tn}_horizontal.svg','w',encoding='utf-8').write(lockup(d['mark'],SPECS[d['spec']],T,'h'))
            open(f'{OUT}/{k}_{tn}_stacked.svg','w',encoding='utf-8').write(lockup(d['mark'],SPECS[d['spec']],T,'v',mark_h=96))
        open(f'{OUT}/{k}_mark.svg','w',encoding='utf-8').write(mark_svg(d['mark'](LIGHT)))
        open(f'{OUT}/{k}_icon.svg','w',encoding='utf-8').write(mark_svg(d['icon'](LIGHT)))
    print(sorted(os.listdir(OUT)))
