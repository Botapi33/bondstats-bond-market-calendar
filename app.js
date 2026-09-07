(() => {
  const DATA_URL = './data/bond-market-calendar.json';
  let data = { events: [], sources: [] };
  let active = 'All';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const eventTs = (e) =>
    e.datetimeUtc ? new Date(e.datetimeUtc).getTime() : new Date(e.date + 'T12:00:00Z').getTime();

  const localTime = (e) =>
    e.datetimeUtc
      ? new Intl.DateTimeFormat(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
        }).format(new Date(e.datetimeUtc))
      : 'Date confirmed · release time varies';

  const dateLabel = (d) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }).format(new Date(d + 'T12:00:00Z'));

  function counts() {
    const now = Date.now();
    const d7 = now + 7 * 86400000;
    const d30 = now + 30 * 86400000;
    const future = data.events.filter((e) => eventTs(e) >= now - 12 * 3600000);

    $('stat7').textContent = future.filter((e) => eventTs(e) <= d7).length;
    $('statCB').textContent = future.filter((e) => e.category === 'Central Banks' && eventTs(e) <= d30).length;
    $('statMacro').textContent = future.filter((e) => ['Inflation', 'Labour'].includes(e.category) && eventTs(e) <= d30).length;
    $('statTreasury').textContent = future.filter((e) => e.category === 'Treasury' && eventTs(e) <= d30).length;

    const ok = (data.sources || []).filter((s) => s.status === 'ok').length;
    $('statHealth').textContent = `${ok}/${(data.sources || []).length}`;
  }

  function renderHealth() {
    $('sourceHealth').innerHTML =
      (data.sources || [])
        .map((s) =>
          `<div class="bmc-health-row">
            <span class="bmc-health-dot ${esc(s.status)}"></span>
            <span>${esc(s.name)}</span>
            <small>${esc(s.status)}</small>
          </div>`
        ).join('') || '<p>No source status available.</p>';
  }

  function render() {
    const horizon = Number($('windowSelect').value || 90);
    const now = Date.now();
    const max = now + horizon * 86400000;

    const events = (data.events || []).filter((e) =>
      eventTs(e) >= now - 12 * 3600000 &&
      eventTs(e) <= max &&
      (active === 'All' || e.category === active)
    );

    if (!events.length) {
      $('calendarList').innerHTML = '<div class="bmc-empty">No scheduled events in this filter window.</div>';
      return;
    }

    let last = '';
    const html = [];

    for (const e of events) {
      if (e.date !== last) {
        last = e.date;
        html.push(`<div class="bmc-date">${esc(dateLabel(e.date))}</div>`);
      }

      html.push(
        `<article class="bmc-event">
          <div class="bmc-event-time">
            ${esc(e.timeLabel || 'Time varies')}
            <small class="bmc-local">${esc(localTime(e))}</small>
          </div>
          <div class="bmc-cat" data-cat="${esc(e.category)}">
            <i></i>${esc(e.category)}<br><small>${esc(e.region || '')}</small>
          </div>
          <div>
            <h3>${esc(e.title)}</h3>
            <p class="bmc-why">${esc(e.whyItMatters || '')}</p>
            <a class="bmc-source" href="${esc(e.sourceUrl)}" target="_blank" rel="noopener">Official source ↗</a>
          </div>
          <span class="bmc-impact ${esc(e.impact)}">${esc(e.impact)}</span>
        </article>`
      );
    }

    $('calendarList').innerHTML = html.join('');
  }

  function updateNext() {
    const now = Date.now();
    const future = (data.events || [])
      .filter((e) => eventTs(e) >= now - 60000)
      .sort((a, b) => eventTs(a) - eventTs(b));

    const exact = future.find((e) => e.datetimeUtc) || future[0];

    if (!exact) {
      $('nextTitle').textContent = 'No upcoming event';
      $('countdown').textContent = '—';
      $('nextMeta').textContent = 'Awaiting the next official schedule.';
      return;
    }

    $('nextTitle').textContent = exact.title;
    $('nextMeta').textContent = `${dateLabel(exact.date)} · ${exact.timeLabel || 'Time varies'} · ${exact.region}`;

    if (!exact.datetimeUtc) {
      $('countdown').textContent = 'DATE CONFIRMED';
      return;
    }

    const ms = new Date(exact.datetimeUtc).getTime() - now;
    if (ms <= 0) {
      $('countdown').textContent = 'NOW';
      return;
    }

    const days = Math.floor(ms / 86400000);
    const hrs = Math.floor((ms % 86400000) / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    $('countdown').textContent = days ? `${days}d ${hrs}h ${mins}m` : `${hrs}h ${mins}m`;
  }


  function reportHeight() {
    if (window.parent === window) return;
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    window.parent.postMessage({ type: 'bondstats-bond-market-calendar-height', height }, '*');
  }

  async function load() {
    try {
      const r = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();

      $('liveStatus').textContent =
        `${data.status || 'live'} · refreshed ${new Date(data.generatedAt).toLocaleString()}`;

      counts();
      renderHealth();
      render();
      updateNext();
      requestAnimationFrame(reportHeight);
    } catch (error) {
      $('liveStatus').textContent = 'calendar data temporarily unavailable';
      $('calendarList').innerHTML =
        '<div class="bmc-empty">The live data file could not be loaded. Please retry shortly.</div>';
      console.error(error);
    }
  }

  document.querySelectorAll('.bmc-filter').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bmc-filter').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      active = btn.dataset.filter || 'All';
      render();
      requestAnimationFrame(reportHeight);
    })
  );

  $('windowSelect').addEventListener('change', () => { render(); requestAnimationFrame(reportHeight); });
  setInterval(updateNext, 30000);
  setInterval(load, 600000);
  load();
  window.addEventListener('load', reportHeight);
  window.addEventListener('resize', reportHeight);
  if ('ResizeObserver' in window) {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  }
})();
