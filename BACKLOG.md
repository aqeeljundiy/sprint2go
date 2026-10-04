# Sprint2go backlog

## UI polish pass (asked 5 Oct 2026, review one by one)

**1. Fewer boxes, lines and grey**
- Home cards have a grey header bar + a line + an outlined card, with outlined boxes inside (pulse numbers, workload tiles). Too many nested frames.
- Pick one container per idea: a card OR a divider, not both. Remove grey header strips; use spacing and type weight for hierarchy.
- No box inside a box (e.g. the brain dump input inside a card with its own border; workload tiles inside a bordered card).

**2. Nested inputs**
- The channel name field shows a rounded input inside a rounded wrapper ("# supplements"). The `.field input` style is applied on top of `.chan-name`. One rounded field with the # inside, no inner border.
- Check every form for the same issue (guest add, add provider, connect calendar, onboarding).

**3. Dark mode colours, chosen on purpose**
- Today dark mode is mostly the light palette inverted, with saturated coral, red, green and orange on near-black, which is harsh.
- Define a real dark palette: softer surfaces with small elevation steps, desaturated accents, red only for real problems, green only for done.
- Review colour meaning across the app (colour psychology):
  - **Red** = late or danger only.
  - **Amber** = waiting or needs attention.
  - **Green** = done.
  - **Brand accent** = actions.
  - **Neutral** = everything else.
- Too many colours compete now: team colours, client colours, status colours and the workspace accent.
- Check contrast (WCAG AA) for text on tinted chips in both themes.

**4. Layout stability**
- When a panel opens or grows (thread panel, info panel, a new tab, the composer growing), the content behind it reflows or jumps.
- Reserve space or overlay panels; fix widths of sidebars and side panels; avoid layout shifts from scrollbars (scrollbar-gutter: stable); animate with transform rather than width.

**5. Responsive and neat**
- Tidy spacing scale (4/8/12/16/24), consistent radii (one for cards, one for controls, pills), consistent heading sizes.
- Check every screen at phone, tablet and desktop after the pass.
