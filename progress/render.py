#!/usr/bin/env python3
"""Rebuilds progress/index.html from progress/steps.json (the live status page)."""
import json, html, datetime, pathlib
here = pathlib.Path(__file__).parent
d = json.loads((here / 'steps.json').read_text())
now = datetime.datetime.now().strftime('%d %b %Y, %H:%M')
done = sum(1 for s, _ in d['steps'] if s == 'done')
total = len(d['steps'])
icon = {'done': '✓', 'doing': '●', 'todo': ''}
rows = '\n'.join(f'<li class="{s}"><span class="b">{icon[s]}</span><span>{html.escape(t)}</span></li>' for s, t in d['steps'])
log = '\n'.join(f'<li><time>{html.escape(t)}</time>{html.escape(x)}</li>' for t, x in reversed(d.get('log', [])[-12:]))
page = f'''<title>Sprint2go Build Progress</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{{--bg:#f6f7f9;--card:#fff;--ink:#0d0f14;--muted:#6c7180;--line:#e1e4ea;--blue:#2448ff;--soft:#e7ebff;--go:#12a36a}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#0b0d12;--card:#12151c;--ink:#eef0f5;--muted:#8a90a0;--line:#252a35;--blue:#7d93ff;--soft:#1c2346;--go:#3fd39a;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0b0d12;--card:#12151c;--ink:#eef0f5;--muted:#8a90a0;--line:#252a35;--blue:#7d93ff;--soft:#1c2346;--go:#3fd39a;color-scheme:dark}}
body{{background:var(--bg);color:var(--ink);font:15px/1.55 "Plus Jakarta Sans",system-ui,sans-serif;padding:28px 16px}}
.w{{max-width:640px;margin:0 auto}}
.brand{{font-weight:800;font-size:20px;letter-spacing:-.04em}} .brand b{{color:var(--blue)}}
h1{{font-size:24px;letter-spacing:-.02em;margin:18px 0 4px}}
.meta{{color:var(--muted);font-size:13px}}
.bar{{height:8px;border-radius:9px;background:var(--line);overflow:hidden;margin:16px 0 6px}} .bar span{{display:block;height:100%;background:var(--blue);width:{round(done/total*100)}%}}
.now{{background:var(--soft);border-radius:14px;padding:12px 14px;margin:16px 0;font-weight:600}}
.now small{{display:block;color:var(--muted);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase}}
ul{{list-style:none;padding:0;margin:0;display:grid;gap:6px}}
li{{display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:9px 12px}}
.b{{flex:none;width:20px;height:20px;border-radius:7px;border:2px solid var(--line);display:grid;place-items:center;font-size:12px;font-weight:800;margin-top:1px}}
li.done .b{{background:var(--go);border-color:var(--go);color:#fff}} li.done span:last-child{{color:var(--muted)}}
li.doing{{border-color:var(--blue)}} li.doing .b{{border-color:var(--blue);color:var(--blue);animation:p 1.4s infinite}}
@keyframes p{{50%{{opacity:.35}}}}
h2{{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:24px 0 8px}}
.log li{{display:block;font-size:14px}} .log time{{color:var(--muted);font-size:12px;margin-right:8px}}
</style><div class="w">
<div class="brand">sprint<b>2</b>go</div>
<h1>{html.escape(d['phase'])}</h1>
<div class="meta">{done} of {total} steps done · updated {now} · updates live while I work</div>
<div class="bar"><span></span></div>
<div class="now"><small>Working on now</small>{html.escape(d['now'])}</div>
<ul>{rows}</ul>
{'<h2>Latest</h2><ul class="log">'+log+'</ul>' if log else ''}
</div>'''
(here / 'index.html').write_text(page)
