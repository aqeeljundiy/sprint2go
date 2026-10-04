#!/usr/bin/env python3
"""progress/update.py --done 5 --doing 6 --now "…" --log "…"   (step numbers are 1-based)"""
import json, sys, pathlib, datetime, subprocess
here = pathlib.Path(__file__).parent
d = json.loads((here / 'steps.json').read_text())
args = sys.argv[1:]
while args:
    k, v = args[0], args[1]; args = args[2:]
    if k in ('--done', '--doing', '--todo'):
        for i in v.split(','):
            d['steps'][int(i) - 1][0] = k[2:]
    elif k == '--now':
        d['now'] = v
    elif k == '--log':
        d.setdefault('log', []).append([datetime.datetime.now().strftime('%H:%M'), v])
    elif k == '--add':
        d['steps'].append(['todo', v])
(here / 'steps.json').write_text(json.dumps(d, indent=2, ensure_ascii=False))
subprocess.run([sys.executable, str(here / 'render.py')], check=True)
