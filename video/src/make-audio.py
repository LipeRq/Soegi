"""BGMと効果音を一から合成して、動画1本ぶんの音声（WAV）をつくる。

外部の音源は使わない（すべてこのスクリプトで生成する。著作権・利用条件の問題が無い）。
使い方：python3 src/make-audio.py <cues.json> <out.wav>
  cues.json：{"duration": 秒, "sections": [{"from":0,"to":3,"mode":"intro"}, ...], "cues": [{"t":秒,"sfx":"pop"}, ...]}
  mode：intro（静か）／groove（キック・ハイハット・ベース）／full（全部）／break（落ち着く）／outro（最後の一打）
音の大きさの最終調整（-14 LUFS）は、動画にまとめるとき ffmpeg の loudnorm で行う。
"""
import json
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
BPM = 120
BEAT = 60 / BPM          # 0.5 秒
BAR = BEAT * 4           # 2 秒
RNG = np.random.default_rng(7)  # 毎回同じ音になるよう、乱数の種を固定する


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n, a, d, s, r, hold):
    """n サンプルぶんの包絡線（a,d,r は秒、s は持続の大きさ、hold は鳴らしている秒）"""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), 1.0)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / max(d, 1e-4), e)
    e = np.where((t >= a + d) & (t < hold), s, e)
    e = np.where(t >= hold, s * np.exp(-(t - hold) / max(r, 1e-4)), e)
    return e


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, f1, f2, order=2):
    return sosfilt(butter(order, [f1, f2], 'band', fs=SR, output='sos'), x)


def add(buf, start, sig, pan=0.0, gain=1.0):
    """buf（2×N）の start 秒から sig を足す。pan は -1（左）〜 1（右）"""
    i = int(round(start * SR))
    if i >= buf.shape[1] or i + len(sig) <= 0:
        return
    j0 = max(0, -i)
    sig = sig[j0:]
    i = max(0, i)
    n = min(len(sig), buf.shape[1] - i)
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + n] += sig[:n] * gain * l * 1.414
    buf[1, i:i + n] += sig[:n] * gain * r * 1.414


def saw_additive(f, dur, bright=1.0, detune_cents=0.0):
    """帯域を制限したのこぎり波（倍音を足して作る。折り返しの雑音が出ない）"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f * 2 ** (detune_cents / 1200)
    out = np.zeros(n)
    kmax = int(min(40, 9000 / f))
    ph = RNG.uniform(0, 2 * np.pi)
    for k in range(1, kmax + 1):
        out += np.sin(2 * np.pi * f * k * t + ph * k) / k * (bright ** (k - 1))
    return out * 0.6


def reverb_ir(seconds=1.8, decay=0.55):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([RNG.standard_normal(n), RNG.standard_normal(n)]) * np.exp(-t / decay)
    ir[:, :int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    ir = np.stack([lp(ir[0], 6000), lp(ir[1], 6000)])
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def reverb(buf, wet, ir):
    out = np.stack([fftconvolve(buf[0], ir[0])[:buf.shape[1]], fftconvolve(buf[1], ir[1])[:buf.shape[1]]])
    return out * wet


# ---- 曲（C の長調。Fmaj7 → G6 → Em7 → Am7 を1小節ずつ） ----------------------------------
CHORDS = [
    [53, 57, 60, 64],   # Fmaj7
    [55, 59, 62, 64],   # G6
    [52, 55, 59, 62],   # Em7
    [57, 60, 64, 67],   # Am7
]
ROOTS = [41, 43, 40, 45]  # F2 G2 E2 A2


def mode_at(sections, t):
    for s in sections:
        if s['from'] <= t < s['to']:
            return s['mode']
    return sections[-1]['mode']


def make_music(duration, sections):
    N = int(duration * SR) + SR * 2
    drums = np.zeros((2, N))
    bass = np.zeros((2, N))
    pad = np.zeros((2, N))
    pluck = np.zeros((2, N))
    fx = np.zeros((2, N))
    kicks = []

    nbars = int(np.ceil(duration / BAR)) + 1
    for bi in range(nbars):
        t0 = bi * BAR
        if t0 >= duration:
            break
        ch = CHORDS[bi % 4]
        root = ROOTS[bi % 4]
        # パッド（ゆっくり立ち上がる和音）。どの場面でも鳴らす
        for m in ch:
            for det, pan in ((-7, -0.6), (0, 0.0), (7, 0.6)):
                s = saw_additive(mtof(m), BAR + 0.6, bright=0.82, detune_cents=det)
                s *= env_adsr(len(s), 0.35, 0.4, 0.75, 0.35, BAR)
                add(pad, t0, s, pan, 0.055)
        # 拍ごとの楽器
        for b in range(8):            # 8分音符
            t = t0 + b * BEAT / 2
            if t >= duration:
                break
            md = mode_at(sections, t)
            on_beat = b % 2 == 0
            outro_end = md == 'outro' and t >= duration - 1.0
            if outro_end:
                continue
            # キック（4つ打ち）
            if on_beat and md in ('groove', 'full', 'outro'):
                n = int(0.45 * SR)
                tt = np.arange(n) / SR
                f = 46 + 95 * np.exp(-tt * 30)
                k = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7.5)
                k[:int(0.003 * SR)] += RNG.standard_normal(int(0.003 * SR)) * 0.4
                add(drums, t, k, 0, 0.9)
                kicks.append(t)
            # 裏拍のハイハット
            if not on_beat and md in ('groove', 'full', 'outro', 'break'):
                n = int(0.06 * SR)
                h = hp(RNG.standard_normal(n), 7500) * np.exp(-np.arange(n) / SR * 70)
                add(drums, t, h, 0.25, 0.22 if md != 'break' else 0.12)
            # 16分の細かいハイハット（full のときだけ）
            if md == 'full':
                n = int(0.03 * SR)
                h = hp(RNG.standard_normal(n), 9000) * np.exp(-np.arange(n) / SR * 120)
                add(drums, t + BEAT / 4, h, -0.3, 0.07)
            # クラップ（2拍目と4拍目）
            if b in (2, 6) and md in ('full', 'outro'):
                n = int(0.35 * SR)
                c = np.zeros(n)
                for o in (0, 0.011, 0.022):
                    i = int(o * SR)
                    m = int(0.012 * SR)
                    c[i:i + m] += RNG.standard_normal(m)
                tail = RNG.standard_normal(n) * np.exp(-np.arange(n) / SR * 14)
                c = bp(c + tail * 0.5, 900, 2600)
                add(drums, t, c, 0, 0.5)
            # ベース（8分で刻む）
            if md in ('groove', 'full', 'outro'):
                n = int(BEAT / 2 * SR)
                tt = np.arange(n) / SR
                f = mtof(root + (12 if b in (3, 7) else 0))
                s = np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(4 * np.pi * f * tt) + 0.15 * np.sin(6 * np.pi * f * tt)
                s *= np.minimum(1, tt / 0.005) * np.exp(-tt * 3.5) * np.minimum(1, (BEAT / 2 - tt) / 0.01)
                add(bass, t, s, 0, 0.42)
            # プラック（和音を上下に分けて弾く）
            if md in ('full', 'break', 'intro'):
                seq = [0, 2, 1, 3, 2, 1, 3, 2]
                m = ch[seq[b]] + 12
                n = int(0.5 * SR)
                tt = np.arange(n) / SR
                f = mtof(m)
                s = np.zeros(n)
                for k in range(1, 12, 2):
                    s += np.sin(2 * np.pi * f * k * tt) / k * np.exp(-tt * (5 + k * 3.5))
                s *= np.minimum(1, tt / 0.003)
                g = 0.16 if md == 'full' else (0.11 if md == 'break' else 0.07)
                add(pluck, t, s, 0.35 if b % 2 else -0.35, g)

    # 最後の一打（outro の終わり1秒前）
    for s in sections:
        if s['mode'] == 'outro':
            tf = duration - 1.0
            n = int(1.6 * SR)
            tt = np.arange(n) / SR
            boom = np.sin(2 * np.pi * np.cumsum(40 + 60 * np.exp(-tt * 12)) / SR) * np.exp(-tt * 3.0)
            add(fx, tf, boom, 0, 0.8)
            for m in CHORDS[0] + [72]:
                sw = saw_additive(mtof(m), 1.6, bright=0.85) * np.exp(-tt * 2.2)
                add(pad, tf, sw, 0, 0.07)

    # 盛り上がる前の、上がっていく音（full の始まりの前）
    prev = None
    for s in sections:
        if s['mode'] == 'full' and prev not in ('full',) and s['from'] >= 1.5:
            d = 1.4
            n = int(d * SR)
            tt = np.arange(n) / SR
            noise = RNG.standard_normal(n)
            # 時間とともに高い音へ（ブロックごとに帯域を上げる）
            out = np.zeros(n)
            blk = 2400
            for i in range(0, n, blk):
                fc = 300 * (12 ** (i / n))
                seg = bp(noise[max(0, i - 600):i + blk], fc, min(fc * 2.2, 18000))[-min(blk, n - i):]
                out[i:i + len(seg)] = seg
            out *= (tt / d) ** 2
            add(fx, s['from'] - d, out, 0, 0.35)
        prev = s['mode']

    # キックに合わせて、ほかの楽器を少し下げる（うねりを出す）
    duck = np.ones(N)
    for k in kicks:
        i = int(k * SR)
        n = int(0.4 * SR)
        tt = np.arange(n) / SR
        seg = 1 - 0.5 * np.exp(-tt / 0.11)
        j = min(N, i + n)
        duck[i:j] = np.minimum(duck[i:j], seg[:j - i])
    pad *= duck
    bass *= duck
    pluck *= duck

    pad = np.stack([lp(pad[0], 3200), lp(pad[1], 3200)])
    ir = reverb_ir()
    # プラックに付点8分のやまびこ（左右に振る）
    dly = int(BEAT * 0.75 * SR)
    pl = pluck.copy()
    for rep in range(1, 4):
        g = 0.38 ** rep
        side = 0 if rep % 2 else 1
        pl[side, dly * rep:] += pluck[side, :-dly * rep] * g + pluck[1 - side, :-dly * rep] * g * 0.3
    music = drums + bass + pad + pl + fx
    music += reverb(pad * 0.6 + pl * 0.7 + drums * 0.12, 0.35, ir)
    music = music[:, :int(duration * SR)]
    # 最後の0.5秒で消す
    n = int(0.5 * SR)
    music[:, -n:] *= np.linspace(1, 0, n) ** 2
    return music


# ---- 効果音 ------------------------------------------------------------------------------
def sfx_whoosh(d=0.5, f0=250, f1=3200):
    n = int(d * SR)
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    blk = 1200
    for i in range(0, n, blk):
        x = i / n
        fc = f0 * (f1 / f0) ** (np.sin(np.pi * x * 0.5))
        seg = bp(noise[max(0, i - 400):i + blk], fc, min(fc * 1.8, 18000))[-min(blk, n - i):]
        out[i:i + len(seg)] = seg
    t = np.arange(n) / SR
    out *= np.sin(np.pi * t / d) ** 2
    return out


def sfx_pop():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 520 + 520 * (1 - np.exp(-t * 40))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 32)
    s[:int(0.002 * SR)] += 0.3
    return s


def sfx_tap():
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    click = bp(RNG.standard_normal(n), 1500, 4500) * np.exp(-t * 160)
    thump = np.sin(2 * np.pi * 180 * t) * np.exp(-t * 45) * 0.6
    return click + thump


def sfx_tick():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return bp(RNG.standard_normal(n), 2500, 6000) * np.exp(-t * 300)


def sfx_ticks(d=1.35):
    out = np.zeros(int(d * SR) + SR // 10)
    times = [d * (1 - (1 - k / 14) ** 1.7) for k in range(14)]
    for i, tm in enumerate(times):
        s = sfx_tick() * (0.6 if i % 2 else 0.9)
        j = int(tm * SR)
        out[j:j + len(s)] += s
    return out


def sfx_impact():
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-t * 18)) / SR) * np.exp(-t * 4)
    crack = lp(RNG.standard_normal(n), 3000) * np.exp(-t * 30) * 0.6
    return boom + crack


def sfx_bell(freqs=(1046.5, 1318.5), d=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for i, f in enumerate(freqs):
        off = int(i * 0.07 * SR)
        tt = t[:n - off]
        v = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 6)) * np.exp(-tt * 4.5)
        s[off:] += v
    return s * 0.6


def sfx_stamp():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * np.cumsum(90 + 120 * np.exp(-t * 40)) / SR) * np.exp(-t * 14)
    paper = bp(RNG.standard_normal(n), 800, 3000) * np.exp(-t * 40) * 0.5
    return thump + paper


def sfx_drop():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 900 * np.exp(-t * 7) + 220
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.6
    thud = np.zeros(n)
    i = int(0.16 * SR)
    tt = t[:n - i]
    thud[i:] = np.sin(2 * np.pi * 110 * tt) * np.exp(-tt * 22)
    return tone + thud


def sfx_type(chars=12, d=0.55):
    out = np.zeros(int((d + 0.1) * SR))
    for k in range(chars):
        s = sfx_tick() * RNG.uniform(0.5, 0.9)
        j = int(d * k / chars * SR + RNG.uniform(0, 0.01) * SR)
        out[j:j + len(s)] += s
    return out


def sfx_click():
    c = sfx_tap() * 0.8
    b = sfx_bell((1318.5, 1760.0), 1.2)
    out = np.zeros(len(b) + int(0.05 * SR))
    out[:len(c)] += c
    out[int(0.05 * SR):] += b * 0.9
    return out


SFX = {
    'whoosh': (lambda: sfx_whoosh(), 0.55, 0.0),
    'pop': (sfx_pop, 0.42, 0.0),
    'tap': (sfx_tap, 0.6, 0.0),
    'zoom': (lambda: sfx_whoosh(0.6, 400, 2200), 0.32, 0.0),
    'rise': (lambda: sfx_whoosh(0.7, 150, 900), 0.3, 0.0),
    'ticks': (sfx_ticks, 0.5, 0.0),
    'slam': (sfx_impact, 0.95, 0.0),
    'stamp': (sfx_stamp, 0.75, 0.0),
    'check': (lambda: sfx_bell((1318.5, 1760.0), 0.7), 0.4, 0.0),
    'draw': (lambda: sfx_whoosh(1.0, 600, 1800), 0.18, 0.0),
    'drop': (sfx_drop, 0.55, 0.0),
    'type': (sfx_type, 0.5, 0.0),
    'click': (sfx_click, 0.65, 0.0),
    'scan': (lambda: sfx_whoosh(0.7, 900, 5000), 0.22, 0.0),
    'tick': (sfx_tick, 0.45, 0.2),
    'send': (lambda: sfx_whoosh(0.6, 700, 6000), 0.4, 0.3),
    'wave': (lambda: sfx_whoosh(1.2, 120, 700), 0.45, 0.0),
}


def make_sfx(duration, cues):
    N = int(duration * SR) + SR * 2
    buf = np.zeros((2, N))
    for c in cues:
        name = c['sfx']
        if name not in SFX:
            raise SystemExit(f'知らない効果音：{name}')
        fn, gain, pan = SFX[name]
        s = fn()
        if name == 'whoosh':
            # 左から右へ流す
            n = len(s)
            panv = np.linspace(-0.8, 0.8, n)
            i = int(c['t'] * SR)
            j = min(N, i + n)
            l = np.cos((panv + 1) * np.pi / 4)[:j - i]
            r = np.sin((panv + 1) * np.pi / 4)[:j - i]
            buf[0, i:j] += s[:j - i] * l * gain * 1.414
            buf[1, i:j] += s[:j - i] * r * gain * 1.414
        else:
            add(buf, c['t'], s, pan, gain)
    return buf[:, :int(duration * SR)]


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    d = spec['duration']
    music = make_music(d, spec['sections'])
    music /= np.max(np.abs(music)) + 1e-9
    sfx = make_sfx(d, spec['cues'])
    sfx /= max(np.max(np.abs(sfx)), 1.0)
    mix = music * 0.5 + sfx * 0.55
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 0.89  # -1 dBFS
    pcm = (mix.T * 32767).astype('<i2')
    import wave
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('audio ->', out, f'{d}s')


if __name__ == '__main__':
    main()
