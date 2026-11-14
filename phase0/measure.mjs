// usage: node measure.mjs RPC_URL MAXPAGES id[:label] ...
const [rpc, maxPagesS, ...progs] = process.argv.slice(2);
const maxPages = +maxPagesS;
async function call(method, params) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (r.status === 429) { await new Promise(r => setTimeout(r, 1500 * (a + 1))); continue; }
    const j = await r.json();
    if (j.error) { if (/rate|limit|429/i.test(JSON.stringify(j.error))) { await new Promise(r => setTimeout(r, 1500 * (a + 1))); continue; } throw new Error(JSON.stringify(j.error)); }
    return j.result;
  }
  throw new Error('rate-limited');
}
const now = Math.floor(Date.now() / 1000), cut = now - 86400;
for (const p of progs) {
  const [id, label] = p.split(':');
  let before, n = 0, failed = 0, pages = 0, oldest = now, newest = null, done = false;
  while (pages < maxPages) {
    const sigs = await call('getSignaturesForAddress', [id, { limit: 1000, ...(before ? { before } : {}) }]);
    pages++;
    if (!sigs.length) { done = true; break; }
    for (const s of sigs) {
      if (newest === null) newest = s.blockTime;
      if (s.blockTime && s.blockTime < cut) { done = true; break; }
      n++; if (s.err) failed++; oldest = s.blockTime || oldest;
    }
    if (done) break;
    before = sigs[sigs.length - 1].signature;
  }
  const span = newest - oldest;
  const out = { id, label, rpc: new URL(rpc).host, pages, complete_24h: done, count: n, failed, span_s: span, per_day: done ? n : Math.round(n * 86400 / Math.max(span, 1)), extrapolated: !done };
  console.log(JSON.stringify(out));
}
