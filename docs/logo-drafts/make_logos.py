import math, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT='/home/user/Soegi/docs/logo-drafts'
FD='/usr/share/fonts/opentype/inter/'
TEAL='#1A6D73'; INK='#1B2428'; RED='#B3243B'; LEAF='#2E7652'

class Font:
    def __init__(s,f):
        s.f=TTFont(FD+f); s.gs=s.f.getGlyphSet(); s.cmap=s.f.getBestCmap(); s.upm=s.f['head'].unitsPerEm
        s.cap=s.f['OS/2'].sCapHeight
    def glyph(s,ch,x,y,size):
        k=size/s.upm; name=s.cmap[ord(ch)]; g=s.gs[name]
        pen=SVGPathPen(s.gs); tp=TransformPen(pen,(k,0,0,-k,x,y)); g.draw(tp)
        return pen.getCommands(), g.width*k
    def text(s,t,x,y,size,track=0.0):
        """returns path d, total width (outlined)"""
        ds=[]; cx=x
        for ch in t:
            d,w=s.glyph(ch,cx,y,size); ds.append(d); cx+=w+track*size
        return ' '.join(ds), cx-x-track*size
SEMI=Font('Inter-SemiBold.otf'); MED=Font('Inter-Medium.otf')

def lockup(mark_svg, mark_w, label, fill=INK, sub=INK, size=44, stack_gap=14, mark_scale=1.0):
    """horizontal: mark + NODUS / CONSULTING; viewBox sized to content"""
    h=64*mark_scale
    nx=mark_w*mark_scale+22
    cap=SEMI.cap/SEMI.upm*size
    base1=(h-cap-stack_gap-0.0)/2+cap  # NODUS baseline
    d1,w1=SEMI.text('NODUS',nx,base1,size,0.10)
    ssize=size*0.30; scap=MED.cap/MED.upm*ssize
    d2,w2=MED.text('CONSULTING',nx,base1+stack_gap+scap,ssize,0.0)
    # stretch CONSULTING to the width of NODUS by tracking
    n=len('CONSULTING'); extra=(w1-w2)/(n-1)/ssize
    d2,w2=MED.text('CONSULTING',nx,base1+stack_gap+scap,ssize,extra)
    W=nx+max(w1,w2)+4
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 {W+4:.1f} {h+8:.1f}" width="{(W+4)*2:.0f}" height="{(h+8)*2:.0f}" role="img" aria-label="NODUS CONSULTING">'
            f'<g transform="scale({mark_scale})">{mark_svg}</g>'
            f'<path d="{d1}" fill="{fill}"/><path d="{d2}" fill="{sub}"/></svg>')

def svg_mark(inner,vb='0 0 64 64'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="256" height="256" role="img" aria-label="NODUS CONSULTING mark">{inner}</svg>'

# ---- marks (64x64, no wrapper) ----
def markA():  # hub: three points joined at one node
    cx,cy=32,34; R=21; pts=[(cx+R*math.cos(math.radians(a)),cy+R*math.sin(math.radians(a))) for a in (-90,30,150)]
    ln=''.join(f'<line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" stroke="{TEAL}" stroke-width="4" stroke-linecap="round"/>' for x,y in pts)
    outer=''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="6" fill="#fff" stroke="{TEAL}" stroke-width="4"/>' for x,y in pts)
    return ln+outer+f'<circle cx="{cx}" cy="{cy}" r="8.5" fill="{RED}"/>'
def markB():  # N drawn as a line graph with nodes
    P=[(14,50),(14,14),(50,50),(50,14)]
    path='M'+' L'.join(f'{x} {y}' for x,y in P)
    nodes=''.join(f'<circle cx="{x}" cy="{y}" r="6" fill="{TEAL}"/>' for x,y in P)
    return f'<path d="{path}" fill="none" stroke="{TEAL}" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>'+nodes+f'<circle cx="32" cy="32" r="5" fill="{RED}"/>'
def markC():  # three rings joined
    c=[(32,21,TEAL),(22.5,38,INK),(41.5,38,RED)]
    return ''.join(f'<circle cx="{x}" cy="{y}" r="14" fill="none" stroke="{col}" stroke-width="4"/>' for x,y,col in c)
def markD(uid='d'):  # two interlinked chain links (結び)
    r1='<rect x="8" y="22" width="30" height="20" rx="10" fill="none" stroke="%s" stroke-width="4.6"/>'%TEAL
    r2='<rect x="26" y="22" width="30" height="20" rx="10" fill="none" stroke="%s" stroke-width="4.6"/>'%INK
    defs=(f'<defs><mask id="{uid}1" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><circle cx="32" cy="22.8" r="5.6" fill="#000"/></mask>'
          f'<mask id="{uid}2" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><circle cx="32" cy="41.2" r="5.6" fill="#000"/></mask></defs>')
    return defs+f'<g mask="url(#{uid}1)">{r1}</g><g mask="url(#{uid}2)">{r2}</g>'
def markE():  # tile N with junction dot (favicon-ready)
    return (f'<rect width="64" height="64" rx="14" fill="{TEAL}"/>'
            '<path d="M19 47V17L45 47V17" fill="none" stroke="#fff" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<circle cx="32" cy="32" r="5.6" fill="{RED}" stroke="#fff" stroke-width="2.6"/>')
def markF_ring():  # ring with a dot (node)
    return f'<circle cx="32" cy="32" r="20" fill="none" stroke="{TEAL}" stroke-width="8"/><circle cx="32" cy="32" r="6.5" fill="{RED}"/>'

def wordF(fill=INK, size=64):
    """NODUS with the O replaced by a node ring; CONSULTING under, justified"""
    x=0; base=size*0.74; parts=[]
    d,w=SEMI.glyph('N',x,base,size); parts.append(('p',d)); x+=w+0.10*size
    # O slot: use real O width
    dO,wO=SEMI.glyph('O',0,0,size)
    capH=SEMI.cap/SEMI.upm*size; r=capH/2+size*0.012; cx=x+wO/2; cy=base-capH/2
    sw=size*0.125
    parts.append(('c',cx,cy,r-sw/2,sw)); x+=wO+0.10*size
    for ch in 'DUS':
        d,w=SEMI.glyph(ch,x,base,size); parts.append(('p',d)); x+=w+(0.10*size if ch!='S' else 0)
    W=x
    ssize=size*0.30; scap=MED.cap/MED.upm*ssize; gy=base+size*0.17+scap
    d2,w2=MED.text('CONSULTING',0,gy,ssize,0)
    extra=(W-w2)/9/ssize; d2,w2=MED.text('CONSULTING',0,gy,ssize,extra)
    body=''.join(f'<path d="{p[1]}" fill="{fill}"/>' if p[0]=='p' else f'<circle cx="{p[1]:.1f}" cy="{p[2]:.1f}" r="{p[3]:.1f}" fill="none" stroke="{TEAL}" stroke-width="{p[4]:.1f}"/><circle cx="{p[1]:.1f}" cy="{p[2]:.1f}" r="{size*0.085:.1f}" fill="{RED}"/>' for p in parts)
    H=gy+size*0.08
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 {base-capH-8:.1f} {W+12:.1f} {H-(base-capH)+14:.1f}" width="{(W+12)*1.6:.0f}" role="img" aria-label="NODUS CONSULTING">{body}<path d="{d2}" fill="{INK}"/></svg>')

marks={'A-hub':(markA(),64),'B-N-graph':(markB(),64),'C-rings':(markC(),64),'D-link':(markD(),64),'E-tile':(markE(),64)}
files={}
for k,(m,w) in marks.items():
    files[f'{k}_mark.svg']=svg_mark(m)
    files[f'{k}_lockup.svg']=lockup(m,w,k)
files['F-node-O_lockup.svg']=wordF()
files['F-node-O_mark.svg']=svg_mark(markF_ring())
for f,c in files.items(): open(f'{OUT}/{f}','w',encoding='utf-8').write(c)
print(len(files),'files')
