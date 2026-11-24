"""
完全模倣の変更の樹形図(docs/change-tree.md)から、PDF(docs/change-tree.pdf)を作る。
樹形図を書き足したら、これを動かす:  python3 scripts/build-change-tree.py
できたPDFは、すぐ開けるようにダウンロードフォルダーにも置く(~/Downloads/完全模倣_変更の樹形図.pdf)。

書ける書き方: 見出し(# ## ### ####)、段落、**太字**、`文字`、- 箇条書き、| 表 |、> 囲み、```(枠で囲んだ文。指示文の全文・樹形図)
"""
import html
import os
import re
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "change-tree.md")
OUT = os.path.join(ROOT, "docs", "change-tree.pdf")
COPY = os.path.expanduser("~/Downloads/完全模倣_変更の樹形図.pdf")
CHROME = os.path.join(
    ROOT,
    "node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
)

CSS = """
body { font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1a1a1a; margin: 0; }
h1 { font-size: 18pt; border-bottom: 3px solid #1a1a1a; padding-bottom: 4px; }
h2 { font-size: 14pt; margin-top: 28px; border-left: 6px solid #0050b3; padding-left: 8px; }
h3 { font-size: 12pt; margin-top: 22px; background: #eef3fb; padding: 4px 8px; }
h4 { font-size: 11pt; margin-top: 14px; }
pre { background: #f6f6f6; border: 1px solid #ccc; padding: 8px 10px; white-space: pre-wrap; word-break: break-all; font-size: 9pt; line-height: 1.55;
      font-family: 'Hiragino Sans', 'Noto Sans JP', monospace; }
pre.tree { background: #fff; border: 2px solid #0050b3; font-size: 10pt; }
code { background: #f0f0f0; padding: 0 3px; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
th { background: #eee; }
blockquote { border-left: 4px solid #999; margin: 8px 0; padding: 2px 10px; color: #333; background: #fafafa; }
"""


def inline(text):
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    return t


def convert(md):
    out = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            kind = line[3:].strip()
            body = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            cls = ' class="tree"' if kind == "tree" else ""
            out.append(f"<pre{cls}>{html.escape(chr(10).join(body), quote=False)}</pre>")
            continue
        m = re.match(r"^(#{1,4}) (.*)", line)
        if m:
            n = len(m.group(1))
            out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
            i += 1
            continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            head, *rest = rows
            out.append("<table><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr>")
            out.extend("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rest)
            out.append("</table>")
            continue
        if line.startswith("> "):
            body = []
            while i < len(lines) and lines[i].startswith("> "):
                body.append(inline(lines[i][2:]))
                i += 1
            out.append("<blockquote>" + "<br>".join(body) + "</blockquote>")
            continue
        if re.match(r"^\s*- ", line):
            out.append("<ul>")
            while i < len(lines) and re.match(r"^\s*- ", lines[i]):
                depth = (len(lines[i]) - len(lines[i].lstrip())) // 2
                text = lines[i].strip()[2:]
                out.append(f'<li style="margin-left:{depth * 18}px">{inline(text)}</li>')
                i += 1
            out.append("</ul>")
            continue
        if line.strip():
            body = []
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||> |```|\s*- )", lines[i]):
                body.append(inline(lines[i]))
                i += 1
            out.append("<p>" + "<br>".join(body) + "</p>")
            continue
        i += 1
    return "\n".join(out)


def main():
    md = open(SRC, encoding="utf-8").read()
    page = f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>完全模倣 変更の樹形図</title><style>{CSS}</style></head><body>{convert(md)}</body></html>'
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "change-tree.html")
        open(src, "w", encoding="utf-8").write(page)
        subprocess.run(
            [CHROME, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={OUT}", "file://" + src],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    shutil.copyfile(OUT, COPY)
    print(f"樹形図のPDFを作りました: {OUT}(ダウンロードフォルダーにも置きました)")


if __name__ == "__main__":
    main()
