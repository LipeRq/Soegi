import sys, os
sys.path.insert(0,'/tmp/claude-0/n')
from brand import Font, FD
from brand3 import glyph_fit
OUT4='/home/user/Soegi/docs/logo-drafts/v6'; os.makedirs(OUT4,exist_ok=True)
CORM6=Font(FD+'cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff')
CORM5I=Font(FD+'cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff')
CORM6I=Font(FD+'cormorant-garamond/files/cormorant-garamond-latin-600-italic.woff')

# name, main(mark), text, accent(for Consulting), paper(bg light), seal, dark: bg, text, accent
PAL={
 'P1-ai':     dict(name='藍 × 生成り',      main='#243B63', text='#1C2A40', accent='#9A7A3E', paper='#F6F1E6', seal='#243B63', dbg='#16233B', dtext='#F3EBDA', dacc='#D2B574', dmark='#F3EBDA'),
 'P2-moegi':  dict(name='深緑 × 銅',        main='#2B4A3C', text='#1D2B25', accent='#B0693A', paper='#F4F0E4', seal='#2B4A3C', dbg='#16291F', dtext='#F1EBDA', dacc='#D79A68', dmark='#F1EBDA'),
 'P3-shu':    dict(name='墨 × 朱',          main='#1E1E1E', text='#1E1E1E', accent='#B8382B', paper='#F7F3EA', seal='#BA3A2C', dbg='#1B1B1B', dtext='#F7F3EA', dacc='#E2705F', dmark='#F7F3EA'),
 'P4-beni':   dict(name='紅花（ワイン）× 墨', main='#7A2E3F', text='#2A2224', accent='#6B5B4B', paper='#F7F1EC', seal='#7A2E3F', dbg='#2A1A1F', dtext='#F7EEE8', dacc='#CBA89A', dmark='#F7EEE8'),
}

def N_plain(T,dark=False):
    c=T['dmark'] if dark else T['main']
    return f'<path d="{glyph_fit(CORM6,"N",44,32,32)}" fill="{c}"/>'
def N_seal(T,dark=False):
    fill=T['seal'] if not dark else T['dmark']; ink=T['paper'] if not dark else T['dbg']
    return (f'<rect x="4" y="4" width="56" height="56" rx="7" fill="{fill}"/>'
            f'<rect x="8.6" y="8.6" width="46.8" height="46.8" rx="4" fill="none" stroke="{ink}" stroke-width="1.1" stroke-opacity=".6"/>'
            f'<path d="{glyph_fit(CORM6,"N",31,32,32.3)}" fill="{ink}"/>')
def N_ring(T,dark=False):
    c=T['dmark'] if dark else T['main']
    return (f'<circle cx="32" cy="32" r="29.5" fill="none" stroke="{c}" stroke-width="1.8"/>'
            f'<circle cx="32" cy="32" r="26.3" fill="none" stroke="{c}" stroke-width=".7" stroke-opacity=".7"/>'
            f'<path d="{glyph_fit(CORM6,"N",25,32,32.4)}" fill="{c}"/>')
MARKS={'a-N':(N_plain,'Nだけ（活字）'),'b-seal':(N_seal,'印（はんこ）'),'c-ring':(N_ring,'輪のN')}

def lock(T,markfn,dark,layout):
    tx=T['dtext'] if dark else T['text']; ac=T['dacc'] if dark else T['accent']
    bg=T['dbg'] if dark else T['paper']; pad=8
    mk=lambda h: f'<g transform="scale({h/64})">{markfn(T,dark)}</g>'
    s1=56; s2=26
    d1,w1=CORM6.path('Nodus',0,0,s1,0.01); cap=CORM6.capH(s1)
    d2,w2=CORM6I.path('Consulting',0,0,s2,0.02)
    if layout=='h':
        mh=72; gx=24; x=mh+gx; Hb=cap+s2*1.3; base1=(mh-Hb)/2+cap
        a,_=CORM6.path('Nodus',x,base1,s1,0.01); b,_=CORM6I.path('Consulting',x+2,base1+s2*1.05,s2,0.02)
        W=x+max(w1,w2); H=mh; inner=mk(mh)+f'<path d="{a}" fill="{tx}"/><path d="{b}" fill="{ac}"/>'
    elif layout=='v':
        mh=84; W=max(w1,w2,mh); base1=mh+22+cap
        a,_=CORM6.path('Nodus',(W-w1)/2,base1,s1,0.01); b,_=CORM6I.path('Consulting',(W-w2)/2,base1+s2*1.15,s2,0.02)
        H=base1+s2*1.15+8; inner=f'<g transform="translate({(W-mh)/2})">{mk(mh)}</g><path d="{a}" fill="{tx}"/><path d="{b}" fill="{ac}"/>'
    else:  # one line
        mh=44; size=34; d1,w1=CORM6.path('Nodus',0,0,size,0.01); d2,w2=CORM6I.path('Consulting',0,0,size,0.01); cap=CORM6.capH(size)
        sp=size*.24; x=mh+14; base=(mh+cap)/2
        a,_=CORM6.path('Nodus',x,base,size,0.01); b,_=CORM6I.path('Consulting',x+w1+sp,base,size,0.01)
        W=x+w1+sp+w2; H=mh; inner=mk(mh)+f'<path d="{a}" fill="{tx}"/><path d="{b}" fill="{ac}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W+2*pad:.1f} {H+2*pad:.1f}" width="{(W+2*pad)*2:.0f}" height="{(H+2*pad)*2:.0f}" role="img" aria-label="Nodus Consulting">'
            f'<rect x="{-pad}" y="{-pad}" width="{W+2*pad:.1f}" height="{H+2*pad:.1f}" fill="{bg}"/>{inner}</svg>')

def icon(T,markfn):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256" role="img" aria-label="Nodus Consulting">{markfn(T,False)}</svg>'

if __name__=='__main__':
    for pk,T in PAL.items():
        for mk,(fn,_) in MARKS.items():
            for dark in (False,True):
                tn='dark' if dark else 'light'
                for lay,nm in (('h','twoline'),('v','stacked'),('o','oneline')):
                    open(f'{OUT4}/{pk}_{mk}_{tn}_{nm}.svg','w',encoding='utf-8').write(lock(T,fn,dark,lay))
            open(f'{OUT4}/{pk}_{mk}_mark.svg','w',encoding='utf-8').write(icon(T,fn))
    print(len(os.listdir(OUT4)))
