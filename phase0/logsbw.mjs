// measure logsSubscribe bytes/notification for a program over N seconds
const [prog, secs] = process.argv.slice(2);
const ws = new WebSocket('wss://api.mainnet-beta.solana.com');
let n = 0, bytes = 0, failed = 0;
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [prog] }, { commitment: 'confirmed' }] }));
ws.onmessage = (e) => { const s = typeof e.data === 'string' ? e.data : e.data.toString(); const j = JSON.parse(s); if (j.method === 'logsNotification') { n++; bytes += Buffer.byteLength(s); if (j.params.result.value.err) failed++; } };
setTimeout(() => { console.log(JSON.stringify({ prog, secs: +secs, notifications: n, failed, bytes, avg_bytes: n ? Math.round(bytes / n) : null })); process.exit(0); }, secs * 1000);
