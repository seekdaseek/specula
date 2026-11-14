// Derive Helius credits used by the live run from what we recorded (the Helius dashboard figure is the authority; this is the cross-check).
import fs from 'node:fs';
const log = fs.readFileSync('live/live.log', 'utf8').split('\n').filter((l) => / poll \[/.test(l));
let sigsCalls = 0, getTx = 0;
for (const l of log) { const arr = JSON.parse(l.slice(l.indexOf('poll [') + 5)); sigsCalls += arr.length; getTx += arr.reduce((a: number, x: any) => a + (x.p ?? 0), 0); }
const bodies = fs.readFileSync('live/raw-bodies.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(JSON.parse(l).body));
const events = bodies.reduce((a: number, b: any) => a + (Array.isArray(b) ? b.length : 1), 0);
const out = { polls: log.length, getSignaturesForAddress: sigsCalls, getTransaction: getTx, getAccountInfo_programdata: 2, webhook_deliveries: bodies.length, webhook_events: events, webhook_create_and_delete_api: 200 };
const credits = out.getSignaturesForAddress + out.getTransaction + out.getAccountInfo_programdata + out.webhook_events + out.webhook_create_and_delete_api;
console.log(JSON.stringify({ ...out, derived_credits_total: credits }, null, 1));
