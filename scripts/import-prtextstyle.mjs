// Premiere Proのテキストスタイル(.prtextstyle)を読み取り、remotion/shared/textStylePresets.ts を作り直す。
// 使い方: node scripts/import-prtextstyle.mjs <ファイル.prtextstyle> [<ファイル2> ...]
//
// .prtextstyle はXMLで、スタイル1つごとに「ソーステキスト」の値として、Premiereの文字の設定が
// FlatBuffers(型の定義が公開されていない形式)でbase64に詰められている。型の定義が無いので、
// 170種類を見比べて各数値の意味を割り出した(下のdecodeStyle)。主な対応:
//   文字の設定 r.0.0[0].1: .1=文字の大きさ .2=文字色 .4=縁取りの色 .5=縁取りあり .6=縁取りの太さ
//     .17=追加の縁取り[{.0色 .1あり .2太さ}] .20=グラデーションの種類 .21=グラデーション{.0角度 .1色の点[{.0色 .1位置}]}
//   全体 r.0: .10=影の色 .11=影あり .12=濃さ(%) .13=角度 .14=距離 .15=大きさ(広がり) .16=ぼかし
//     .17=背景の色 .18=背景あり .19=濃さ .20=余白  .37=2つ目以降の影[{.0色 .1あり .2濃さ .3角度 .4距離 .5大きさ .6ぼかし}]
//   縁取りの太さは輪郭をまたいで描く幅(外に見えるのは半分)。省いた値は初期値(影なら濃さ75%・角度135°・距離7・ぼかし40)。
//   どれもPremiereの画面のスクリーンショットと見比べて確かめた。
// 色は{.0赤 .1緑 .2青}で、省略された値は255(色ごと無ければ白)。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUTPUT = path.join(process.cwd(), "remotion", "shared", "textStylePresets.ts");

/** Premiereの書体を、アプリに同梱している書体に置き換える(源ノ角ゴ=Noto Sans JP、源ノ明朝=Noto Serif JPは同じ書体)。 */
const FONT_MAP = {
  "SourceHanSans-Heavy": ["Noto Sans JP", 900],
  "SourceHanSansJP-Heavy": ["Noto Sans JP", 900],
  "SourceHanSerif-Bold": ["Noto Serif JP", 700],
  "SourceHanSerif-Heavy": ["Noto Serif JP", 900],
  "TA-marugo": ["M PLUS Rounded 1c", 700],
  "VDL-LogoJrBlack-Black": ["Dela Gothic One", 400],
  appare: ["Yusei Magic", 400],
  kakugo: ["Zen Kaku Gothic New", 700],
};
const FONT_PATTERN = /(SourceHan[A-Za-z]*-[A-Za-z]+|TA-[a-z]+|VDL-[A-Za-z-]+|appare[A-Za-z-]*|kakugo[A-Za-z-]*)/;

/** FlatBuffersを型の定義なしで「パス → 値」の一覧にする。フィールドの大きさはvtableのオフセットの差から求める。 */
const flatten = (base64) => {
  const b = Buffer.from(base64, "base64").subarray(12);
  const u32 = (o) => b.readUInt32LE(o);
  const i32 = (o) => b.readInt32LE(o);
  const u16 = (o) => b.readUInt16LE(o);
  const isTable = (t) => {
    if (t < 0 || t + 4 > b.length) return false;
    const vt = t - i32(t);
    if (vt < 0 || vt + 4 > b.length) return false;
    const vs = u16(vt);
    const ts = u16(vt + 2);
    return vs >= 4 && vs % 2 === 0 && vs < 300 && ts >= 4 && ts < 2000 && vt + vs <= b.length;
  };
  const out = {};
  const table = (pos, key, depth) => {
    if (depth > 8) return;
    const vt = pos - i32(pos);
    const vs = u16(vt);
    const ts = u16(vt + 2);
    const offs = [];
    for (let f = 0; f < (vs - 4) / 2; f++) {
      const o = u16(vt + 4 + f * 2);
      if (o) offs.push([f, o]);
    }
    const sorted = [...offs].sort((x, y) => x[1] - y[1]);
    for (const [f, o] of offs) {
      const next = sorted.find((x) => x[1] > o);
      const size = (next ? next[1] : ts) - o;
      const p = pos + o;
      const k = `${key}.${f}`;
      if (size >= 4) {
        const v = u32(p);
        const t = p + v;
        if (v > 0 && t < b.length) {
          if (isTable(t)) {
            out[`${k}#t`] = true;
            table(t, k, depth + 1);
            continue;
          }
          const len = u32(t);
          if (len > 0 && len < 40 && t + 4 + len * 4 <= b.length) {
            const items = [];
            for (let i = 0; i < len; i++) {
              const ep = t + 4 + i * 4;
              if (isTable(ep + u32(ep))) items.push(ep + u32(ep));
            }
            if (items.length === len) {
              out[`${k}#len`] = len;
              items.forEach((it, i) => table(it, `${k}[${i}]`, depth + 1));
              continue;
            }
          }
        }
        out[k] = { float: b.readFloatLE(p), int: v };
      } else if (size === 1) out[k] = { byte: b[p] };
    }
  };
  table(u32(0), "r", 0);
  return out;
};

const round = (v) => Math.round(v * 1000) / 1000;

const decodeStyle = (base64, id) => {
  const o = flatten(base64);
  const c = "r.0.0[0].1";
  const num = (k) => o[k]?.float;
  const has = (k) => o[k] !== undefined;
  const hex = (k) =>
    "#" + [0, 1, 2].map((i) => (o[`${k}.${i}`]?.byte ?? 255).toString(16).padStart(2, "0")).join("");
  const font = (Buffer.from(base64, "base64").toString("latin1").match(FONT_PATTERN) ?? [])[0];
  const [fontFamily, fontWeight] = FONT_MAP[font] ?? ["Noto Sans JP", 900];
  const size = num(`${c}.1`) ?? 148;
  const k = 1 / size;

  const preset = { id, fontFamily, fontWeight };
  const stopCount = o[`${c}.21.1#len`];
  if (has(`${c}.20`) && stopCount) {
    preset.gradient = {
      // 角度の初期値は90(上→下)。0は左→右。
      angleDeg: round(num(`${c}.21.0`) ?? 90),
      stops: Array.from({ length: stopCount }, (_, i) => [hex(`${c}.21.1[${i}].0`), round(num(`${c}.21.1[${i}].1`) ?? 0)]),
    };
  } else {
    preset.color = hex(`${c}.2`);
  }

  // 縁取りの太さは輪郭の線をまたいで描く幅なので、文字の外に見えるのはその半分。
  preset.strokes = [];
  if (has(`${c}.6`) && has(`${c}.5`)) preset.strokes.push([hex(`${c}.4`), round((num(`${c}.6`) * k) / 2)]);
  for (let i = 0; i < (o[`${c}.17#len`] ?? 0); i++) {
    const s = `${c}.17[${i}]`;
    const width = num(`${s}.2`) ?? 0;
    if (has(`${s}.1`) && width > 0) preset.strokes.push([hex(`${s}.0`), round((width * k) / 2)]);
  }

  // 影(光)。1つ目は全体の設定、2つ目以降は影の一覧(.37)。省いた値はPremiereの初期値
  // (濃さ75%・角度135°・距離7・大きさ0・ぼかし40)。初期値と同じ値は書かれないため。
  const shadowAt = (prefix, fields) => {
    const angle = (((num(`${prefix}.${fields.angle}`) ?? 135) % 360) * Math.PI) / 180;
    const distance = num(`${prefix}.${fields.distance}`) ?? 7;
    return {
      color: hex(`${prefix}.${fields.color}`),
      opacity: round((num(`${prefix}.${fields.opacity}`) ?? 75) / 100),
      dx: round(Math.sin(angle) * distance * k),
      dy: round(-Math.cos(angle) * distance * k),
      // 広がりも縁取りと同じく、輪郭をまたぐ幅として書かれている(外へ広がるのは半分)。
      size: round(((num(`${prefix}.${fields.size}`) ?? 0) * k) / 2),
      blur: round((num(`${prefix}.${fields.blur}`) ?? 40) * k),
    };
  };
  const shadows = [];
  if (has("r.0.11")) shadows.push(shadowAt("r.0", { color: 10, opacity: 12, angle: 13, distance: 14, size: 15, blur: 16 }));
  for (let i = 0; i < (o["r.0.37#len"] ?? 0); i++) {
    const s = `r.0.37[${i}]`;
    if (has(`${s}.1`)) shadows.push(shadowAt(s, { color: 0, opacity: 2, angle: 3, distance: 4, size: 5, blur: 6 }));
  }
  if (shadows.length) preset.shadows = shadows;

  if (has("r.0.18")) {
    const pad = round((num("r.0.20") ?? 0) * k);
    preset.backgrounds = [{ color: hex("r.0.17"), opacity: round((num("r.0.19") ?? 100) / 100), padX: pad, padY: pad, radius: 0 }];
  }
  return preset;
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("使い方: node scripts/import-prtextstyle.mjs <ファイル.prtextstyle> [...]");
  process.exit(1);
}
const presets = [];
for (const file of files) {
  const xml = readFileSync(file, "utf8");
  // 部品(ObjectID付きの要素)を番号で引けるようにし、スタイル名 → 部品 → … → 文字の設定(ソーステキスト)を参照でたどる。
  // ファイル内の並び順に頼ると、名前と中身が食い違うおそれがあるため。
  const objects = new Map();
  for (const m of xml.matchAll(/<(\w+) ObjectID="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g)) objects.set(m[2], { tag: m[1], body: m[3] });
  const findSourceText = (startId) => {
    const queue = [startId];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const object = objects.get(id);
      if (!object) continue;
      if (object.tag === "ArbVideoComponentParam" && object.body.includes("<Name>ソーステキスト</Name>")) {
        return object.body.match(/<StartKeyframeValue[^>]*>([^<]*)<\/StartKeyframeValue>/)?.[1].trim();
      }
      for (const ref of object.body.matchAll(/ObjectRef="(\d+)"/g)) queue.push(ref[1]);
    }
    return undefined;
  };
  let count = 0;
  for (const m of xml.matchAll(/<StyleProjectItem [^>]*>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<Component ObjectRef="(\d+)"\/>/g)) {
    const blob = findSourceText(m[2]);
    if (!blob) continue;
    const id = m[1].trim().replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    presets.push(decodeStyle(blob, id));
    count++;
  }
  console.log(`${file}: ${count}個`);
}

const header = `import type { CaptionFontFamily } from "./schema";

/**
 * 文字のスタイル(見た目のひな形)。Premiere Proのテキストスタイル(.prtextstyle)を
 * scripts/import-prtextstyle.mjs で読み取って作った(手で直さず、スクリプトで作り直す)。
 * 長さ(縁取りの太さ・影のずれ・背景の余白など)はすべて「文字の大きさに対する割合」で持ち、どの大きさでも同じ見た目にする。
 * 描き方は StyledText.tsx。
 */
export type TextStylePreset = {
  id: string;
  fontFamily: CaptionFontFamily;
  fontWeight: number;
  /** 単色の文字色。gradientがあればそちらを使う。 */
  color?: string;
  /** 文字のグラデーション。angleDegはPremiereの角度(90で上→下、0で左→右)、stopsは[色, 位置0〜1]。 */
  gradient?: { angleDeg: number; stops: [string, number][] };
  /** 縁取り。[色, 文字の外側へ見える太さ]。太い物ほど後ろに描く。 */
  strokes: [string, number][];
  /** 影・光(いくつも重ねられる。先頭が一番上)。dx/dyはずれ、sizeは文字の外への広がり、blurはぼかしの幅。 */
  shadows?: { color: string; opacity: number; dx: number; dy: number; size: number; blur: number }[];
  /** 文字の後ろの箱。padX/padYは文字の周りの余白、radiusは角の丸み。 */
  backgrounds?: { color: string; opacity: number; padX: number; padY: number; radius: number }[];
};

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
`;
const footer = `];

export const findTextStylePreset = (id: string | undefined): TextStylePreset | undefined =>
  id ? TEXT_STYLE_PRESETS.find((preset) => preset.id === id) : undefined;
`;
writeFileSync(OUTPUT, header + presets.map((p) => `  ${JSON.stringify(p)},`).join("\n") + "\n" + footer);
console.log(`${presets.length}個のスタイルを ${path.relative(process.cwd(), OUTPUT)} に書きました`);
