BondStats Bond Market Calendar — UI overlay

Short overlay for the standalone repo.

Changed:
- index.html
- styles.css
- app.js

Design change:
The calendar now reads more like a market diary / institutional agenda instead
of the same boxed dashboard engine used by several older tools. It still keeps
BondStats' dark, restrained, institutional visual language.

app.js also sends its live document height to a parent BondStats iframe so the
later site integration can resize cleanly without scrollbars.

Apply as a normal overlay to:
bondstats-bond-market-calendar
