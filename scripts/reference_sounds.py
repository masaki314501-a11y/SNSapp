"""
手本の音から、効果音とBGMを切り出す(アプリの src/lib/exactCopy/referenceSounds.ts から呼ぶ)。

使い方: python reference_sounds.py <手本の音.wav> <出力先のフォルダー>

1. demucs(htdemucs)で、声(vocals)とそれ以外(no_vocals)に分ける
2. 声以外の音を0.05秒ごとの大きさ(dB)にし、ふだん(真ん中の値)より8dB以上大きくなった山を、効果音の候補にする
   (0.3秒以内の山は1つにまとめる)。始めは山から戻って、ふだん+4dBを切る所(0.5秒まで)、
   終わりは、ふだん+4dBを切る所(1秒まで)
   BGMの拍も山になるので、次のどちらかの時だけ効果音とする:
   - 曲の繰り返しの長さ(音の立ち上がりの並びから測る。1.2〜4.5秒)だけ前後にずらした同じ位置より、4dB以上大きい
   - 曲の中に、似た響きの所がほかに無い(1秒以上離れた所との響きの違いが0.6以上)
3. 候補を cand<番号>.wav に切り出す。BGMは声以外の音全体から、候補の所を下げた物(bgm.wav)
4. 音量は、手本の声が -20dB(生成の声のふだんの大きさ)になる倍率をかける(声と効果音・BGMの差を手本と同じにする)
5. 結果を標準出力に JSON で出す
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

HOP_SECONDS = 0.05
PEAK_DB = 8.0
EDGE_DB = 4.0
TARGET_VOICE_DB = -20.0
EXCESS_DB = 4.0
UNIQUE = 0.6


def to_db(mono, hop):
    n = len(mono) // hop
    return np.array([10 * np.log10(np.mean(mono[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])


def bands_at(mono, sr, t, dur=0.3, n=2048):
    """その所の響き(40の帯の大きさの対数)。"""
    seg = mono[int(t * sr):int((t + dur) * sr)]
    frames = [np.abs(np.fft.rfft(seg[i:i + n] * np.hanning(n))) for i in range(0, len(seg) - n, 512)]
    if not frames:
        return None
    s = np.mean(frames, 0)
    edges = np.geomspace(2, len(s) - 1, 40).astype(int)
    return np.log(np.array([s[edges[i]:edges[i + 1] + 1].mean() for i in range(39)]) + 1e-6)


def music_period(d):
    """音の立ち上がりの並びが繰り返す長さ(秒。1.2〜4.5秒の中で、いちばんよく重なる長さ)。"""
    e = np.maximum(0, np.diff(d))
    e = e - e.mean()
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    lags = np.arange(len(ac)) * HOP_SECONDS
    sel = (lags > 1.2) & (lags < 4.5)
    if not sel.any():
        return None
    return float(lags[np.argmax(np.where(sel, ac, -np.inf))])


def main():
    wav, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    work = tempfile.mkdtemp()
    subprocess.run(
        [sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-o", work, wav],
        check=True,
        capture_output=True,
    )
    name = os.path.splitext(os.path.basename(wav))[0]
    x, sr = sf.read(os.path.join(work, "htdemucs", name, "no_vocals.wav"))
    v, _ = sf.read(os.path.join(work, "htdemucs", name, "vocals.wav"))
    if x.ndim == 1:
        x = x[:, None]
    mono = x.mean(1)
    voice = v.mean(1) if v.ndim > 1 else v
    hop = int(sr * HOP_SECONDS)
    d = to_db(mono, hop)
    dv = to_db(voice, hop)
    base = float(np.median(d))
    # 話している所(声のいちばん大きい所から40dB以内)の真ん中の大きさ
    speaking = dv[dv > dv.max() - 40]
    voice_db = float(np.median(speaking)) if len(speaking) > 0 else TARGET_VOICE_DB
    gain_db = float(np.clip(TARGET_VOICE_DB - voice_db, -12, 18))
    gain = 10 ** (gain_db / 20)

    peaks = []
    for i in range(1, len(d) - 1):
        if d[i] > base + PEAK_DB and d[i] >= d[i - 1] and d[i] >= d[i + 1]:
            if peaks and i - peaks[-1][0] < 6:
                if d[i] > peaks[-1][1]:
                    peaks[-1] = (i, d[i])
            else:
                peaks.append((i, d[i]))

    duration = len(mono) / sr
    period = music_period(d)
    fine_hop = int(sr * 0.025)
    fine = to_db(mono, fine_hop)

    def level(t, w=0.25):
        a, b = max(0, int(t / 0.025)), min(len(fine), int((t + w) / 0.025))
        return fine[a:b].max() if b > a else -120.0

    def excess_of(t):
        if not period:
            return 0.0
        others = []
        for k in (-2, -1, 1, 2):
            u = t + k * period
            if 0 <= u < duration - 0.3:
                others.append(max(level(u + s) for s in np.arange(-0.1, 0.11, 0.025)))
        return float(level(t) - np.median(others)) if others else 0.0

    times = np.arange(0, max(0.0, duration - 0.4), HOP_SECONDS)
    spectra = [bands_at(mono, sr, t) for t in times]
    valid = [i for i, b in enumerate(spectra) if b is not None]
    table = np.array([spectra[i] for i in valid]) if valid else np.zeros((0, 39))
    table_times = times[valid] if valid else np.zeros(0)

    def unique_of(t):
        b = bands_at(mono, sr, t)
        if b is None or len(table) == 0:
            return 0.0
        dist = np.sqrt(((table - b) ** 2).mean(1))
        far = np.abs(table_times - t) > 1.0
        return float(dist[far].min()) if far.any() else 0.0

    sounds = []
    last_end = -1.0
    fade_in = int(0.005 * sr)
    fade_out = int(0.05 * sr)
    for n, (i, peak_level) in enumerate(peaks):
        j = i
        while j > 0 and d[j - 1] > base + EDGE_DB and i - j < 10:
            j -= 1
        k = i
        while k < len(d) - 1 and d[k + 1] > base + EDGE_DB and k - i < 20:
            k += 1
        start = j * HOP_SECONDS
        length = min(1.0, max(0.5, (k - j + 1) * HOP_SECONDS + 0.2))
        # 前の効果音と重なる山(同じ音の続き)は数えない
        if start < last_end:
            continue
        excess = excess_of(start)
        unique = unique_of(start)
        if excess < EXCESS_DB and unique < UNIQUE:
            continue
        last_end = start + length
        a = x[int(start * sr):int((start + length) * sr)].copy() * gain
        if len(a) <= fade_in + fade_out:
            continue
        a[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
        a[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
        peak = np.abs(a).max()
        if peak > 0.95:
            a *= 0.95 / peak
        file = "cand%02d.wav" % n
        sf.write(os.path.join(outdir, file), a, sr)
        sounds.append({"file": file, "start": round(start, 2), "length": round(length, 2), "db": round(float(peak_level - base), 1), "excess": round(excess, 1), "unique": round(unique, 2)})

    # BGM: 効果音の候補の所は下げる。頭と終わりは1秒かけて上げ下げし、繰り返してもつながるようにする
    b = x.copy()
    ramp = int(0.03 * sr)
    for sound in sounds:
        i0 = max(0, int((sound["start"] - 0.05) * sr))
        i1 = min(len(b), int((sound["start"] + sound["length"]) * sr))
        if i1 - i0 <= 2 * ramp:
            continue
        env = np.full(i1 - i0, 0.1)
        env[:ramp] = np.linspace(1, 0.1, ramp)
        env[-ramp:] = np.linspace(0.1, 1, ramp)
        b[i0:i1] *= env[:, None]
    b *= gain
    cross = min(int(1.0 * sr), len(b) // 4)
    if cross > 0:
        b[:cross] *= np.linspace(0, 1, cross)[:, None]
        b[-cross:] *= np.linspace(1, 0, cross)[:, None]
    sf.write(os.path.join(outdir, "bgm.wav"), b, sr)

    print(json.dumps({"sounds": sounds, "bgm": "bgm.wav", "baseDb": round(base, 1), "voiceDb": round(voice_db, 1), "gainDb": round(gain_db, 1), "periodSeconds": period}))


if __name__ == "__main__":
    main()
