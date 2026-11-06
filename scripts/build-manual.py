"""
使い方マニュアル(docs/manual/*.md)から、アプリで開くページ(public/docs/manual/*.html)を作る。
マニュアルの文章を直したら、これを動かす:  python3 scripts/build-manual.py

- docs/manual/index.md   … トップ。「## ステップN …」ごとに1ページ(screen-N.html)に分ける。
                            「ステップ4のかわりに」はステップ4のページに入れる。
                            「AIを使わず…」「困ったとき」「用語集」も、それぞれ1ページにする。
- docs/manual/steps.md   … 工程ごとの編集の入口(steps.html)
- docs/manual/koutei/step-N.md … 工程1〜14(step-N.html。1工程1ページ)
画面写真は public/docs/manual/img/ に置き、文章からは img/〇〇.png で指す。人は写さない(動画の枠は灰色)。
書ける書き方: 見出し(# ## ###)、段落、**太字**、- 箇条書き、1. 番号付き、| 表 |、> 囲み、![説明](img/..)、[文字](ページ.html)
"""
import html
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "manual")
OUT = os.path.join(ROOT, "public", "docs", "manual")
BASE = "/docs/manual/"


def inline(text):
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)

    def link(m):
        href = m.group(2)
        if not href.startswith(("/", "http", "#")):
            href = BASE + href
        return f'<a href="{href}">{m.group(1)}</a>'

    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, t)


def convert(md):
    out, lines, i = [], md.split("\n"), 0
    block_start = re.compile(r"^(#|\||- |\d+\. |> |!\[)")
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        m = re.match(r"^!\[(.*)\]\((.+)\)$", ln.strip())
        if m:
            alt, src = m.groups()
            out.append(f'<figure><img src="{BASE}{src}" alt="{html.escape(alt)}" loading="lazy"><figcaption>{html.escape(alt)}</figcaption></figure>')
            i += 1
            continue
        m = re.match(r"^(#{1,3}) (.+)$", ln)
        if m:
            lv = len(m.group(1))
            out.append(f"<h{lv}>{inline(m.group(2))}</h{lv}>")
            i += 1
            continue
        if ln.startswith("> "):
            box = []
            while i < len(lines) and lines[i].startswith("> "):
                box.append(lines[i][2:])
                i += 1
            out.append('<div class="note">' + "".join(f"<p>{inline(x)}</p>" for x in box) + "</div>")
            continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            t = '<div class="tbl"><table><thead><tr>' + "".join(f"<th>{inline(c)}</th>" for c in rows[0]) + "</tr></thead><tbody>"
            t += "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[2:])
            out.append(t + "</tbody></table></div>")
            continue
        if ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(lines[i][2:])
                i += 1
            out.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>")
            continue
        if re.match(r"^\d+\. ", ln):
            start = int(ln.split(".")[0])
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(re.sub(r"^\d+\. ", "", lines[i]))
                i += 1
            st = f' style="counter-reset:n {start - 1}"' if start != 1 else ""
            out.append(f'<ol class="steps"{st}>' + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not block_start.match(lines[i]):
            para.append(lines[i])
            i += 1
        out.append("<p>" + "<br>".join(inline(p) for p in para) + "</p>")
    return "\n".join(out)


CSS = """
:root { --bg:#F6F7F5; --surface:#fff; --fg:#1D2321; --muted:#5C6662; --line:#DCE1DE; --accent:#0F6B5C; --soft:#E3F1ED; --warm:#FFF6E5; --warm-line:#F0D9A8; }
@media (prefers-color-scheme: dark) { :root { --bg:#141917; --surface:#1C2220; --fg:#E6ECE9; --muted:#A2ADA8; --line:#2F3835; --accent:#6CC9B5; --soft:#1E3A33; --warm:#2E2717; --warm-line:#5A4A26; color-scheme:dark; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; font-size:16px; line-height:1.85; }
.wrap { max-width:760px; margin:0 auto; padding:16px 16px 72px; }
nav.top { display:flex; flex-wrap:wrap; gap:4px 16px; font-size:14px; padding-bottom:10px; border-bottom:1px solid var(--line); margin-bottom:16px; }
a { color:var(--accent); }
h1 { font-size:25px; line-height:1.45; margin:6px 0 14px; }
h2 { font-size:20px; margin:32px 0 10px; padding-bottom:5px; border-bottom:2px solid var(--accent); }
h3 { font-size:17px; margin:22px 0 8px; }
p { margin:0 0 12px; }
ul, ol { margin:0 0 16px; padding-left:1.5em; } li { margin:4px 0; }
ol.steps { list-style:none; padding:0; counter-reset:n; }
ol.steps li { counter-increment:n; position:relative; padding:8px 0 8px 40px; border-bottom:1px dashed var(--line); margin:0; }
ol.steps li::before { content:counter(n); position:absolute; left:0; top:8px; width:28px; height:28px; border-radius:50%; background:var(--accent); color:var(--bg); font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center; line-height:1; }
figure { margin:12px 0 20px; } figure img { display:block; max-width:min(100%, 360px); height:auto; border:1px solid var(--line); border-radius:12px; }
figcaption { font-size:13px; color:var(--muted); margin-top:4px; }
.tbl { overflow-x:auto; margin:0 0 16px; background:var(--surface); border:1px solid var(--line); border-radius:10px; }
table { border-collapse:collapse; width:100%; font-size:15px; }
th, td { text-align:left; vertical-align:top; padding:8px 12px; border-bottom:1px solid var(--line); }
th { background:var(--soft); font-size:14px; white-space:nowrap; } tr:last-child td { border-bottom:0; }
.note { background:var(--warm); border:1px solid var(--warm-line); border-radius:10px; padding:12px 14px 2px; margin:0 0 16px; }
.cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:10px; margin:0 0 20px; }
.cards a { display:block; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:12px 14px; text-decoration:none; color:var(--fg); }
.cards a:hover { border-color:var(--accent); }
.cards small { display:block; color:var(--accent); font-weight:700; font-size:13px; }
.dots { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 6px; font-size:13px; }
.dots a, .dots span { display:inline-block; min-width:30px; text-align:center; padding:2px 8px; border-radius:999px; border:1px solid var(--line); text-decoration:none; }
.dots span { background:var(--accent); color:var(--bg); border-color:var(--accent); font-weight:700; }
.pager { display:flex; justify-content:space-between; gap:12px; margin-top:36px; padding-top:16px; border-top:1px solid var(--line); }
.pager a { display:inline-block; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--surface); text-decoration:none; font-weight:700; }
"""

NAV = (
    '<nav class="top"><a href="/">← アプリへ戻る</a><a href="/docs/manual/index.html">マニュアルのトップ</a>'
    '<a href="/docs/manual/trouble.html">困ったとき</a><a href="/docs/manual/glossary.html">用語集</a></nav>'
)


def write(name, title, body):
    doc = (
        '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head>\n"
        f'<body><div class="wrap">{NAV}\n{body}\n</div></body></html>\n'
    )
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(doc)


def pager(prev, nxt):
    left = f'<a href="{BASE}{prev[0]}">← {html.escape(prev[1])}</a>' if prev else "<span></span>"
    right = f'<a href="{BASE}{nxt[0]}">{html.escape(nxt[1])} →</a>' if nxt else "<span></span>"
    return f'<div class="pager">{left}{right}</div>'


def read(path):
    with open(os.path.join(SRC, path), encoding="utf-8") as f:
        return f.read()


def main():
    # ---- トップ(index.md)を、## ごとに分ける ----
    text = read("index.md")
    parts = re.split(r"^## ", text, flags=re.M)
    head, sections = parts[0], [("## " + p).split("\n", 1) for p in parts[1:]]
    sections = [(h[3:].strip(), body) for h, body in sections]

    top, screens, extra = [], {}, {}
    for title, body in sections:
        m = re.match(r"ステップ(\d)(のかわりに)?", title)
        if m and m.group(2):
            n = int(m.group(1))
            screens[n] = (screens[n][0], screens[n][1] + f"\n## {title}\n{body}")
        elif m:
            screens[int(m.group(1))] = (title, body)
        elif title.startswith("AIを使わず"):
            extra["self.html"] = (title, body)
        elif title == "困ったとき":
            extra["trouble.html"] = (title, body)
        elif title == "用語集":
            extra["glossary.html"] = (title, body)
        else:
            top.append((title, body))

    screen_pages = [(f"screen-{n}.html", screens[n][0]) for n in sorted(screens)]
    others = [("steps.html", "工程ごとに編集する(ステップ4のかわり)"), ("self.html", "AIを使わず自分で編集する"),
              ("trouble.html", "困ったとき"), ("glossary.html", "用語集")]

    body = convert(head)
    for title, sec in top:
        body += f"\n<h2>{inline(title)}</h2>\n" + convert(sec)
    body += "\n<h2>画面ごとの説明</h2>\n<p>アプリは7つの画面を順に進みます。知りたい画面を押してください。</p>\n<div class=\"cards\">"
    for f, t in screen_pages:
        short = re.sub(r"^ステップ\d ", "", t)
        body += f'<a href="{BASE}{f}"><small>ステップ{f[7]}</small>{html.escape(short)}</a>'
    body += "</div>\n<h2>そのほか</h2>\n<div class=\"cards\">"
    body += "".join(f'<a href="{BASE}{f}">{html.escape(t)}</a>' for f, t in others)
    body += "</div>"
    write("index.html", "Clipcraft 使い方マニュアル", body)

    for k, (fname, title) in enumerate(screen_pages):
        n = k + 1
        dots = '<div class="dots">' + "".join(
            f"<span>ステップ{j}</span>" if j == n else f'<a href="{BASE}screen-{j}.html">ステップ{j}</a>' for j in range(1, len(screen_pages) + 1)
        ) + "</div>"
        prev = screen_pages[k - 1] if k > 0 else ("index.html", "マニュアルのトップ")
        nxt = screen_pages[k + 1] if k + 1 < len(screen_pages) else ("index.html", "マニュアルのトップ")
        sec_body = screens[n][1].replace("\n## ", "\n### ")
        write(fname, title, dots + f"<h1>{inline(title)}</h1>\n" + convert(sec_body) + pager(prev, nxt))

    for fname, (title, sec) in extra.items():
        write(fname, title, f"<h1>{inline(title)}</h1>\n" + convert(sec) + pager(("index.html", "マニュアルのトップ"), None))

    # ---- 工程ごとの編集 ----
    write("steps.html", "工程ごとに編集する", convert(read("steps.md")) + pager(("screen-4.html", "ステップ4"), ("step-1.html", "工程1")))
    for n in range(1, 15):
        md = read(f"koutei/step-{n}.md")
        title = re.match(r"^# (.+)$", md, re.M).group(1)
        dots = '<div class="dots"><a href="' + BASE + 'steps.html">一覧</a>' + "".join(
            f"<span>{j}</span>" if j == n else f'<a href="{BASE}step-{j}.html">{j}</a>' for j in range(1, 15)
        ) + "</div>"
        prev = (f"step-{n-1}.html", f"工程{n-1}") if n > 1 else ("steps.html", "工程の一覧")
        nxt = (f"step-{n+1}.html", f"工程{n+1}") if n < 14 else ("steps.html", "工程の一覧")
        write(f"step-{n}.html", title, dots + convert(md) + pager(prev, nxt))

    print("マニュアルのページを作りました:", len(screen_pages), "画面 +", len(extra), "ページ + 工程14ページ")


if __name__ == "__main__":
    main()
