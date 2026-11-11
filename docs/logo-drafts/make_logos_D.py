import sys; sys.path.insert(0,'/tmp/claude-0/n')
import math
import logo as L
from logo import TEAL, INK, RED, OUT, lockup, svg_mark

SW=5.2
def ring(x,y,w,h,col,sw=SW):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="none" stroke="{col}" stroke-width="{sw}"/>'
def msk(i,cx,cy,r=6.4):
    return (f'<mask id="m{i}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#000"/></mask>')
def gradient(i,a,b): return f'<linearGradient id="g{i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'

def pair(prefix,rot,c1,c2,node=False,lens=None):
    # ring1 x8..38, ring2 x26..56, y22..42 ; crossings (32,22.8) top, (32,41.2) bottom
    defs=msk(prefix+'1',32,22.8)+msk(prefix+'2',32,41.2)
    body=''
    if lens:
        body+=f'<clipPath id="{prefix}c"><circle cx="28" cy="32" r="10"/></clipPath><circle cx="36" cy="32" r="10" fill="{lens}" clip-path="url(#{prefix}c)"/>'
    body+=f'<g mask="url(#m{prefix}1)">{ring(8,22,30,20,c1)}</g><g mask="url(#m{prefix}2)">{ring(26,22,30,20,c2)}</g>'
    if node: body+=f'<circle cx="32" cy="32" r="3.2" fill="{RED}"/>'
    return f'<defs>{defs}</defs><g transform="rotate({rot} 32 32)">{body}</g>'

# D1 diagonal link, gradient rings, red node at the join
def d1():
    g=gradient('1a','#2A8C93','#1A6D73')+gradient('1b','#2B363B','#1B2428')
    return f'<defs>{g}</defs>'+pair('p',-35,'url(#g1a)','url(#g1b)',node=True)
# D2 overlap area filled (the 接点 is highlighted)
def d2():
    return pair('q',-35,TEAL,INK,lens=RED)
# D3 chain of three links: 現場・データ・AI
def d3():
    w,h,r=28,18,9; xs=[4,24,44]; cols=[TEAL,INK,RED]
    # crossings between ring i and i+1
    defs=''; body=''
    tops=[(xs[i]+w-r+ (xs[i+1]+r-(xs[i]+w-r))/2, 32-math.sqrt(r*r-((xs[i+1]+r-(xs[i]+w-r))/2)**2)) for i in range(2)]
    bots=[(x, 64-y) for x,y in tops]
    # ring0 hidden at bottom of pair0 ; ring1 hidden at top of pair0 and bottom of pair1 ; ring2 hidden at top of pair1
    hid=[[bots[0]],[tops[0],bots[1]],[tops[1]]]
    for i in range(3):
        m=f'<mask id="r{i}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/>'+''.join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5.6" fill="#000"/>' for x,y in hid[i])+'</mask>'
        defs+=m
        body+=f'<g mask="url(#r{i})">{ring(xs[i],23,w,h,cols[i],4.6)}</g>'
    return f'<defs>{defs}</defs><g transform="translate(2.2 3.5) scale(.9)">{body}</g>'
# D4 emblem: circle badge with the white link pair
def d4():
    inner=pair('b',-35,'#fff','#BFE9EB',node=False)
    return f'<circle cx="32" cy="32" r="31" fill="{TEAL}"/>'+f'<g transform="translate(32 32) scale(.78) translate(-32 -32)">{inner}</g>'+f'<circle cx="32" cy="32" r="3.4" fill="{RED}" stroke="{TEAL}" stroke-width="1.6" transform="rotate(0)"/>'

marks={'D1-diagonal':(d1(),64),'D2-lens':(d2(),64),'D3-chain3':(d3(),64),'D4-badge':(d4(),64)}
import os
for k,(m,w) in marks.items():
    open(f'{OUT}/{k}_mark.svg','w',encoding='utf-8').write(svg_mark(m))
    open(f'{OUT}/{k}_lockup.svg','w',encoding='utf-8').write(lockup(m,w,k))
print('ok')
