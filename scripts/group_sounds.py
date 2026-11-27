"""
切り出した効果音の候補(sounds.json)に、同じ響きの音どうしで同じ番号(group)を付ける。
手本の中で毎回同じに鳴らしている音(見出し・次の項目の音)を見つけるのに使う。

使い方: python group_sounds.py <切り出した音のフォルダー> [<フォルダー> ...]
- 鳴り始めの0.4秒を、24の帯 × 4つの時間に分けた響きにして、似かた(コサイン)の平均が0.8以上のまとまりにする
  (完成動画18本で、同じ効果音のファイルの使い回しが同じまとまりになった値)
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

THRESHOLD = 0.8


def feature(path):
    x, sr = sf.read(path)
    m = x.mean(1) if x.ndim > 1 else x
    m = m[: int(0.4 * sr)]
    n, hop = 1024, 512
    frames = [np.abs(np.fft.rfft(m[i:i + n] * np.hanning(n))) for i in range(0, max(1, len(m) - n), hop)]
    if not frames:
        return None
    F = np.array(frames)
    edges = np.geomspace(3, F.shape[1] - 1, 25).astype(int)
    B = np.log(np.array([[f[edges[i]:edges[i + 1] + 1].mean() for i in range(24)] for f in F]) + 1e-6)
    v = np.concatenate([s.mean(0) for s in np.array_split(B, 4)])
    v = np.nan_to_num(v - v.mean())
    norm = np.linalg.norm(v)
    return v / norm if norm > 1e-6 else None


def group(folder):
    path = os.path.join(folder, "sounds.json")
    data = json.load(open(path))
    feats = [feature(os.path.join(folder, s["file"])) for s in data["sounds"]]
    idx = [i for i, f in enumerate(feats) if f is not None]
    X = np.array([feats[i] for i in idx]) if idx else np.zeros((0, 1))
    sim = X @ X.T if len(idx) else np.zeros((0, 0))
    clusters = [[k] for k in range(len(idx))]
    while len(clusters) > 1:
        best = (-1.0, 0, 0)
        for a in range(len(clusters)):
            for b in range(a + 1, len(clusters)):
                link = float(sim[np.ix_(clusters[a], clusters[b])].mean())
                if link > best[0]:
                    best = (link, a, b)
        if best[0] < THRESHOLD:
            break
        _, a, b = best
        clusters[a] += clusters[b]
        del clusters[b]
    for g, members in enumerate(clusters):
        for k in members:
            data["sounds"][idx[k]]["group"] = g
    json.dump(data, open(path, "w"), ensure_ascii=False, indent=2)
    return len(clusters)


if __name__ == "__main__":
    for folder in sys.argv[1:]:
        print(folder, group(folder))
