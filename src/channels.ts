import { createHmac } from 'node:crypto';

export interface Alert {
  severity: 'critical' | 'error' | 'warning' | 'info';
  title: string;
  text: string;
  tenant_id: string;
  program_id: string;
  kind: string;            // rule | upgrade | silence | pipeline
  signature?: string;
  explorer_url?: string;
  fields?: Record<string, unknown>;
}

export interface TenantChannels {
  telegram?: { chat_id: string; token_env?: string; api_base?: string };
  discord?: { url: string };
  webhook?: { url: string; secret: string };
}

type Fetch = typeof fetch;

export function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/** Delivers to one named channel. Never logs the Telegram token or the webhook secret. */
export async function deliver(channel: string, cfg: TenantChannels, alert: Alert, env: NodeJS.ProcessEnv = process.env, f: Fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ message_id?: number } | void> {
  if (channel === 'webhook') {
    const c = cfg.webhook; if (!c) throw new Error('webhook channel not configured');
    const body = JSON.stringify(alert);
    const r = await f(c.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-specula-signature': sign(body, c.secret) }, body });
    if (!r.ok) throw new Error(`webhook responded ${r.status}`);
  } else if (channel === 'discord') {
    const c = cfg.discord; if (!c) throw new Error('discord channel not configured');
    const r = await f(c.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: format(alert).slice(0, 1900) }) });
    if (!r.ok) throw new Error(`discord responded ${r.status}`);
  } else if (channel === 'telegram') {
    const c = cfg.telegram; if (!c) throw new Error('telegram channel not configured');
    const token = env[c.token_env ?? 'TELEGRAM_BOT_TOKEN'];
    if (!token) throw new Error(`telegram token env ${c.token_env ?? 'TELEGRAM_BOT_TOKEN'} is not set`);
    const url = `${c.api_base ?? 'https://api.telegram.org'}/bot${token}/sendMessage`;
    const body = JSON.stringify({ chat_id: c.chat_id, text: format(alert).slice(0, 4000), disable_web_page_preview: true });
    // Telegram rate limit: HTTP 429 with parameters.retry_after seconds. Wait that long (capped) and retry; never echo the URL (it holds the token).
    for (let attempt = 0; ; attempt++) {
      const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && j.ok === true) return { message_id: j.result?.message_id };
      if (r.status === 429 && attempt < 3) {
        const wait = Number(j.parameters?.retry_after ?? r.headers.get('retry-after') ?? 1);
        await sleep(Math.min(Math.max(wait, 1), 60) * 1000);
        continue;
      }
      throw new Error(`telegram responded ${r.status}${j.description ? `: ${String(j.description).slice(0, 120)}` : ''}`);
    }
  } else throw new Error(`unknown channel ${channel}`);
}

export function format(a: Alert): string {
  return `[${a.severity.toUpperCase()}] ${a.title}\n${a.text}${a.explorer_url ? `\n${a.explorer_url}` : ''}`;
}
