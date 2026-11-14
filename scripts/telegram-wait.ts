// Long-poll getUpdates (timeout=50, no offset) for up to 5 min; on the first message append TELEGRAM_CHAT_ID to .env. Never prints the token.
import fs from 'node:fs';
const env = fs.readFileSync('.env', 'utf8');
const token = env.split('\n').find((l) => l.startsWith('TELEGRAM_BOT_TOKEN='))!.slice(19).trim();
if (/^TELEGRAM_CHAT_ID=/m.test(env)) { console.log('TELEGRAM_CHAT_ID already present'); process.exit(0); }
const end = Date.now() + 5 * 60_000;
while (Date.now() < end) {
  let j: any;
  try { j = await (await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=50`, { signal: AbortSignal.timeout(60_000) })).json(); } catch { continue; }
  const m = (j.result ?? []).map((u: any) => u.message ?? u.channel_post).filter((x: any) => x?.chat).pop();
  if (m) {
    const id = String(m.chat.id);
    fs.appendFileSync('.env', `${env.endsWith('\n') ? '' : '\n'}TELEGRAM_CHAT_ID=${id}\n`);
    console.log(`chat id appended (length ${id.length}, type ${m.chat.type})`); process.exit(0);
  }
}
console.log('no update within 5 minutes'); process.exit(3);
