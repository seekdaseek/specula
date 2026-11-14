// One-shot proof of Telegram delivery. Reads TELEGRAM_BOT_TOKEN (+ TELEGRAM_CHAT_ID) from .env, never prints either.
// If TELEGRAM_CHAT_ID is missing it calls getUpdates (needs a /start or any message sent to the bot), appends the chat id to .env, then sends
// ONE alert built from a real Jupiter Lend record of the live run. Prints the Bot API message_id only.
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { deliver } from '../src/channels.js';
const envText = fs.readFileSync('.env', 'utf8');
const get = (k: string) => envText.split('\n').filter((l) => l.startsWith(`${k}=`)).map((l) => l.slice(k.length + 1).trim())[0];
const token = get('TELEGRAM_BOT_TOKEN'); if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
let chat = get('TELEGRAM_CHAT_ID');
if (!chat) {
  const j: any = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates`)).json();
  const m = (j.result ?? []).map((u: any) => u.message ?? u.channel_post).filter((x: any) => x?.chat).pop();
  if (!m) { console.log('no updates for the bot yet: send /start to it, then rerun'); process.exit(3); }
  chat = String(m.chat.id);
  fs.appendFileSync('.env', `${envText.endsWith('\n') ? '' : '\n'}TELEGRAM_CHAT_ID=${chat}\n`);
  console.log(`TELEGRAM_CHAT_ID appended to .env (length ${chat.length}, chat type ${m.chat.type})`);
}
const dbFile = fs.readdirSync('live').filter((f) => /^live-\d+\.db$/.test(f)).sort().pop()!;
const db = new Database(`live/${dbFile}`, { readonly: true });
const r: any = db.prepare("SELECT signature, name, slot, data_json FROM records WHERE program_id='jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9' AND kind='program_instruction' AND failed=0 AND name='update_rate' ORDER BY slot DESC LIMIT 1").get();
const res = await deliver('telegram', { telegram: { chat_id: chat } }, {
  severity: 'info', kind: 'rule', tenant_id: 'live', program_id: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',
  title: `instruction ${r.name} on jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9`, text: `specula Phase 1b delivery test: real Jupiter Lend record from the live run\nslot ${r.slot}`,
  signature: r.signature, explorer_url: `https://explorer.solana.com/tx/${r.signature}`,
}, { TELEGRAM_BOT_TOKEN: token } as any);
console.log('delivered, Bot API message_id =', (res as any)?.message_id);
