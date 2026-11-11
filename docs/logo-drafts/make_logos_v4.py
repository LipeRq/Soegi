import sys, math
sys.path.insert(0,'/tmp/claude-0/n')
import brand as B
from brand import *

OUT2='/home/user/Soegi/docs/logo-drafts/v4'; os.makedirs(OUT2,exist_ok=True)

def circ_inter(c1,c2,r1,r2):
    d=math.dist(c1,c2); a=(r1*r1-r2*r2+d*d)/(2*d); h=math.sqrt(max(r1*r1-a*a,0))
    ux,uy=(c2[0]-c1[0])/d,(c2[1]-c1[1])/d; px,py=c1[0]+a*ux,c1[1]+a*uy
    return [(px+h*uy,py-h*ux),(px-h*uy,py+h*ux)]

def three_centers(cx=32,cy=33,dist=9.5):
    return [(cx+dist*math.cos(math.radians(a)),cy+dist*math.sin(math.radians(a))) for a in (-90,30,150)]

def borromean(T,sw=3.4,r=14.5,cols=None,gap=None,tube=False):
    p=uid(); C=three_centers(dist=9.2); cols=cols or [T['flat_a'],T['flat_b'],T['red'][1]]
    gap=gap or (sw/2+1.5)
    defs=''; out=''
    # pair (i, j=(i+1)%3): circle i is over circle j at both crossings => circle j gets holes
    holes=[[],[],[]]
    for i in range(3):
        j=(i+1)%3
        for pt in circ_inter(C[i],C[j],r,r): holes[j].append(pt)
    for i in range(3):
        m=f'<mask id="{p}{i}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="110" height="110"><rect x="-20" y="-20" width="110" height="110" fill="#fff"/>'+''.join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{gap}" fill="#000"/>' for x,y in holes[i])+'</mask>'
        defs+=m
        col=cols[i]
        if tube:
            gid=f'{p}g{i}'; defs+=grad(gid,*[T['a'],T['b'],(T['red'][0],T['red'][2])][i])
            col=f'url(#{gid})'
        out+=f'<g mask="url(#{p}{i})"><circle cx="{C[i][0]:.2f}" cy="{C[i][1]:.2f}" r="{r}" fill="none" stroke="{col}" stroke-width="{sw}"/></g>'
    return f'<defs>{defs}</defs>{out}'

def venn(T,sw=2.4,r=15,dist=10.5):
    C=three_centers(dist=dist); cols=[T['flat_a'],T['flat_b'],T['red'][1]]
    fills=''.join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="{c}" fill-opacity=".20"/>' for (x,y),c in zip(C,cols))
    strokes=''.join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r}" fill="none" stroke="{c}" stroke-width="{sw}"/>' for (x,y),c in zip(C,cols))
    # the shared centre = the "node"
    return fills+strokes+f'<circle cx="32" cy="33" r="3" fill="{T["red"][1]}"/>'

def trefoil(T,sw=4.6,tube=True):
    p=uid(); N=900; sc=8.6
    pts=[(32+sc*(math.sin(t)+2*math.sin(2*t)),32+sc*(math.cos(t)-2*math.cos(2*t)))
         for t in [2*math.pi*i/N for i in range(N)]]
    # self-intersections
    def seg(i): return pts[i],pts[(i+1)%N]
    def inter(a,b,c,d):
        x1,y1=a;x2,y2=b;x3,y3=c;x4,y4=d
        den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4)
        if abs(den)<1e-12: return None
        t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den; u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/den
        if 0<=t<1 and 0<=u<1: return (x1+t*(x2-x1),y1+t*(y2-y1))
    X=[]
    for i in range(N):
        a,b=seg(i)
        for j in range(i+3,N):
            if i==0 and j>=N-2: continue
            c,d=seg(j); q=inter(a,b,c,d)
            if q: X.append((i,j,q))
    assert len(X)==3,len(X)
    events=sorted([(i,k,q) for k,(i,j,q) in enumerate(X)]+[(j,k,q) for k,(i,j,q) in enumerate(X)])
    over={}  # event index -> True if this passage is over
    flag=True
    over_pieces=[]
    for idx,k,q in events:
        if flag: over_pieces.append((idx,q))
        flag=not flag
    def d_of(a,b):
        idxs=[(a+n)%N for n in range(0,(b-a)%N+1)]
        return 'M'+' L'.join(f'{pts[i][0]:.2f} {pts[i][1]:.2f}' for i in idxs)
    full='M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in pts)+' Z'
    gap=sw/2+1.7
    defs=f'<mask id="{p}m" maskUnits="userSpaceOnUse" x="-20" y="-20" width="110" height="110"><rect x="-20" y="-20" width="110" height="110" fill="#fff"/>'+''.join(f'<circle cx="{q[0]:.2f}" cy="{q[1]:.2f}" r="{gap}" fill="#000"/>' for _,_,q in X)+'</mask>'
    defs+=grad(p+'g',T['a'][0],T['b'][1] if T['text']!='#FFFFFF' else T['a'][1],0,0,1,1)
    if T['text']!='#FFFFFF': defs=defs.replace(f'<linearGradient id="{p}g"',f'<linearGradient id="{p}g"')
    stroke=f'url(#{p}g)'
    body=f'<g mask="url(#{p}m)"><path d="{full}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/></g>'
    span=22
    for idx,q in over_pieces:
        body+=f'<path d="{d_of((idx-span)%N,(idx+span)%N)}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="butt" stroke-linejoin="round"/>'
    if tube:
        body+=f'<path d="{full}" fill="none" stroke="#fff" stroke-opacity=".0" stroke-width="0"/>'
    return f'<defs>{defs}</defs>{body}'

def constellation(T):
    cx=cy=32; R=24
    pts=[(cx+R*math.cos(math.radians(a)),cy+R*math.sin(math.radians(a))) for a in (-90,30,150)]
    ring=f'<circle cx="32" cy="32" r="{R}" fill="none" stroke="{T["flat_a"]}" stroke-width="1.8"/>'
    lines=''.join(f'<line x1="32" y1="32" x2="{x:.1f}" y2="{y:.1f}" stroke="{T["flat_a"]}" stroke-width="2.4" stroke-linecap="round"/>' for x,y in pts)
    nodes=''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.6" fill="{T["flat_b"]}"/>' for x,y in pts)
    return ring+lines+nodes+f'<circle cx="32" cy="32" r="6" fill="{T["red"][1]}"/>'

def tile(inner_fn,shape='squircle'):
    p=uid(); TT=dict(DARK,flat_a='#FFFFFF',flat_b='#BFE9EC',text='#FFFFFF',a=('#FFFFFF','#BFE9EC'),b=('#E3F3F4','#8FCBD0'))
    bg=grad(p+'bg','#2A8C93','#0E4A50')+f'<radialGradient id="{p}gl" cx=".3" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    shp=f'<rect width="64" height="64" rx="15" fill="url(#{p}bg)"/><rect width="64" height="64" rx="15" fill="url(#{p}gl)"/>'
    return f'<defs>{bg}</defs>{shp}<g transform="translate(32 32) scale(.72) translate(-32 -32)">{inner_fn(TT)}</g>'

HAIR=SPECS['hair']
MARKS={
 'K1-trefoil':   dict(mark=lambda T: trefoil(T),                 desc='三つ葉結び（トレフォイル）。1本の線が結ばれた形。Nodus＝結び目を、そのまま'),
 'K2-borromean': dict(mark=lambda T: borromean(T),               desc='ボロミアンリング。3つの輪が、どの2つも外れるのに、3つ揃うと外れない。3者を結ぶ'),
 'K3-venn':      dict(mark=lambda T: venn(T),                    desc='3つの輪の重なり（先のCの発展）。重なった中心が、接点'),
 'K4-hub':       dict(mark=lambda T: constellation(T),           desc='輪の中の3点が、中心の結び目に集まる。いちばん簡潔'),
}
if __name__=='__main__':
    for k,d in MARKS.items():
        for tn,T in (('light',LIGHT),('dark',DARK)):
            open(f'{OUT2}/{k}_{tn}_horizontal.svg','w',encoding='utf-8').write(lockup(d['mark'],HAIR,T,'h'))
            open(f'{OUT2}/{k}_{tn}_stacked.svg','w',encoding='utf-8').write(lockup(d['mark'],HAIR,T,'v',mark_h=96))
        open(f'{OUT2}/{k}_mark.svg','w',encoding='utf-8').write(mark_svg(d['mark'](LIGHT)))
        open(f'{OUT2}/{k}_icon.svg','w',encoding='utf-8').write(mark_svg(tile(d['mark'])))
    print(len(os.listdir(OUT2)))
