// @speculaDaBot: Telegram long-poll + self-serve commands. The token only ever lives in the request URL, never in logs or errors.
import type { Service } from './service.js';
import { Rpc } from './ingest.js';
import { fetchOnchainIdl, inspectIdl, isPubkey, MAX_IDL_BYTES, type IdlInfo } from './idl-fetch.js';
import { parseAlertsToml, type AlertRule } from './rules.js';
import type { Billing } from './billing.js';

export interface Button { text: string; callback_data: string }
export interface TgApi {
  sendMessage(chatId: string, text: string, buttons?: Button[][]): Promise<number | undefined>;
  getFile(fileId: string): Promise<{ path: string; size?: number } | null>;
  download(path: string, maxBytes: number): Promise<Buffer>;
  answerCallback?(id: string, text?: string): Promise<void>;
  sendPhoto?(chatId: string, png: Buffer, caption: string): Promise<number | undefined>;
}
export class Tg implements TgApi {
  constructor(private token: string, private f: typeof fetch = fetch, private base = 'https://api.telegram.org') {}
  async call(method: string, params: unknown, timeoutMs = 20_000): Promise<any> {
    let r: Response;
    try { r = await this.f(`${this.base}/bot${this.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new Error(`telegram ${method}: network error (${(e as Error).name})`); }
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429) { await new Promise((res) => setTimeout(res, Math.min(60, Number(j.parameters?.retry_after ?? 1)) * 1000)); return this.call(method, params, timeoutMs); }
    if (!r.ok || j.ok !== true) throw new Error(`telegram ${method}: ${r.status} ${String(j.description ?? '').slice(0, 100)}`);
    return j.result;
  }
  async sendMessage(chatId: string, text: string, buttons?: Button[][]) {
    const r = await this.call('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
    return r?.message_id as number | undefined;
  }
  async getFile(fileId: string) { const r = await this.call('getFile', { file_id: fileId }); return r?.file_path ? { path: r.file_path as string, size: r.file_size as number | undefined } : null; }
  async download(path: string, maxBytes: number): Promise<Buffer> {
    const r = await this.f(`${this.base}/file/bot${this.token}/${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`telegram download: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('file too large');
    return buf;
  }
  async sendPhoto(chatId: string, png: Buffer, caption: string) {
    const f = new FormData(); f.append('chat_id', chatId); f.append('caption', caption.slice(0, 1000)); f.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'pay.png');
    const r = await this.f(`${this.base}/bot${this.token}/sendPhoto`, { method: 'POST', body: f, signal: AbortSignal.timeout(30_000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || j.ok !== true) throw new Error(`telegram sendPhoto: ${r.status} ${String(j.description ?? '').slice(0, 100)}`);
    return j.result?.message_id as number | undefined;
  }
  async answerCallback(id: string, text?: string) { await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {}); }
  getUpdates(offset: number | undefined, timeout: number): Promise<any[]> { return this.call('getUpdates', { timeout, ...(offset !== undefined ? { offset } : {}), allowed_updates: ['message', 'callback_query'] }, (timeout + 15) * 1000); }
}

export interface Parsed { cmd: string; arg: string; rest: string; text: string }
/** "/watch@speculaDaBot  PID\nextra" -> {cmd:'watch', arg:'PID', rest:'extra'}; null when the text is not a command. */
export function parseCommand(text: string): Parsed | null {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:[ \t]+([^\n]*))?(?:\r?\n([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  const line = (m[2] ?? '').trim();
  return { cmd: m[1]!.toLowerCase(), arg: line.split(/\s+/)[0] ?? '', rest: (m[3] ?? '').trim(), text: line };
}

export const HELP = `Commands
/watch PROGRAM_ID  start monitoring a Solana program
/rules PROGRAM_ID  list rules (buttons remove them); paste a Microscope [[alerts]] block under the command to add rules
/list  your programs
/remove PROGRAM_ID  stop monitoring one
/status  plan, usage, trial days left
/plans  plans and prices
/upgrade PLAN  pay in USDC (Solana Pay)
/billing  your plan, expiry and payments
/support TEXT  message the operator
/help  this message`;

export interface BotOpts { rpc: Pick<Rpc, 'account' | 'getAccountData'>; tg: TgApi; log?: (m: string) => void; onProgramsChanged?: () => void; fetchIdl?: typeof fetchOnchainIdl; billing?: Billing; ownerChatId?: string }

export class Bot {
  constructor(readonly svc: Service, readonly o: BotOpts) {}
  private log(m: string) { this.o.log?.(m); }
  private say(chat: string, text: string, buttons?: Button[][]) { return this.o.tg.sendMessage(chat, text, buttons); }

  async handleUpdate(u: any): Promise<void> {
    try {
      if (u.callback_query) return await this.onCallback(u.callback_query);
      const m = u.message; if (!m?.chat || !m.from) return;
      if (m.chat.type !== 'private') return;                     // private chats only: alerts never go to a group
      const tid = String(m.from.id), chat = String(m.chat.id);
      if (m.document) return await this.onDocument(tid, chat, m);
      const c = parseCommand(m.text ?? ''); if (!c) { await this.say(chat, 'Send /help for the commands.'); return; }
      await this.onCommand(tid, chat, c);
    } catch (e) { this.log(`update error: ${(e as Error).message}`); }
  }

  async onCommand(tid: string, chat: string, c: Parsed) {
    const svc = this.svc;
    switch (c.cmd) {
      case 'start': {
        svc.ensureUser(tid, chat);
        return void await this.say(chat, `specula watches Solana programs and messages you here when something happens: an upgrade or authority change, a quiet program, or any instruction or event you pick.\n\nFree trial: ${svc.cfg.trial.days} days, ${svc.cfg.trial.maxPrograms} program, ${svc.cfg.plans[svc.cfg.trial.plan]!.txPerMonth.toLocaleString('en-US')} transactions a month. The clock starts at your first /watch.\n\n${HELP}`);
      }
      case 'help': return void await this.say(chat, HELP);
      case 'watch': return await this.watch(tid, chat, c.arg);
      case 'list': return await this.list(tid, chat);
      case 'remove': return await this.remove(tid, chat, c.arg);
      case 'rules': return await this.rules(tid, chat, c.arg, c.rest);
      case 'status': return await this.status(tid, chat);
      case 'plans': return await this.plans(tid, chat);
      case 'upgrade': return await this.upgrade(tid, chat, c.arg);
      case 'billing': return await this.billingInfo(tid, chat);
      case 'support': return await this.support(tid, chat, [c.text, c.rest].filter(Boolean).join('\n').trim());
      default: return void await this.say(chat, 'Unknown command. Send /help.');
    }
  }

  private async watch(tid: string, chat: string, pid: string) {
    const svc = this.svc; const u = svc.ensureUser(tid, chat);
    if (!isPubkey(pid)) return void await this.say(chat, 'Usage: /watch PROGRAM_ID (a base58 program address).');
    if (!svc.watchAllowed(tid)) return void await this.say(chat, 'Slow down: at most 5 /watch per hour. Try again later.');
    const lim = svc.limits(u);
    if (!lim) return void await this.say(chat, 'Your trial has ended. /plans shows the plans; /upgrade PLAN pays in USDC.');
    if (svc.engine.getEntry(u.tenant_id, pid)) return void await this.say(chat, 'You already watch that program. /rules to manage it.');
    if (svc.programCount(u.tenant_id) >= lim.maxPrograms) return void await this.say(chat, `Your plan allows ${lim.maxPrograms} program${lim.maxPrograms === 1 ? '' : 's'}. /remove one first.`);
    let acc; try { acc = await this.o.rpc.account(pid); } catch { return void await this.say(chat, 'Could not reach Solana RPC right now. Try again in a minute.'); }
    if (!acc) return void await this.say(chat, 'That account does not exist on mainnet.');
    if (!acc.executable) return void await this.say(chat, 'That account exists but is not an executable program.');
    let idl: any = null;
    try { idl = await (this.o.fetchIdl ?? fetchOnchainIdl)(this.o.rpc, pid); } catch { /* fall through to upload */ }
    if (idl) {
      try { const info = inspectIdl(idl, pid); return await this.activate(tid, chat, pid, idl, info, 'on-chain Anchor IDL'); }
      catch (e) { this.log(`onchain idl rejected ${pid}: ${(e as Error).message}`); idl = null; }
    }
    svc.db.prepare('INSERT OR REPLACE INTO pending_idl (telegram_id, program_id, created_at) VALUES (?,?,?)').run(tid, pid, svc.now());
    await this.say(chat, `No usable on-chain Anchor IDL for ${pid}. Send me the IDL as a .json file (Anchor or Codama, up to 1 MB) in this chat.`);
  }

  private async onDocument(tid: string, chat: string, m: any) {
    const svc = this.svc; const u = svc.ensureUser(tid, chat);
    const p = svc.db.prepare('SELECT program_id FROM pending_idl WHERE telegram_id=?').get(tid) as { program_id: string } | undefined;
    if (!p) return void await this.say(chat, 'Send /watch PROGRAM_ID first, then the IDL file.');
    const d = m.document;
    if ((d.file_size ?? 0) > MAX_IDL_BYTES) return void await this.say(chat, 'That file is larger than 1 MB.');
    const f = await this.o.tg.getFile(d.file_id);
    if (!f || (f.size ?? 0) > MAX_IDL_BYTES) return void await this.say(chat, 'Could not read that file (or it is larger than 1 MB).');
    let idl: any, info: IdlInfo;
    try { idl = JSON.parse((await this.o.tg.download(f.path, MAX_IDL_BYTES)).toString('utf8')); } catch (e) { return void await this.say(chat, (e as Error).message === 'file too large' ? 'That file is larger than 1 MB.' : 'That file is not valid JSON.'); }
    try { info = inspectIdl(idl, p.program_id); } catch (e) { return void await this.say(chat, (e as Error).message); }
    if (svc.engine.getEntry(u.tenant_id, p.program_id)) return void await this.say(chat, 'You already watch that program.');
    svc.db.prepare('DELETE FROM pending_idl WHERE telegram_id=?').run(tid);
    await this.activate(tid, chat, p.program_id, idl, info, 'the IDL you sent');
  }

  private async activate(tid: string, chat: string, pid: string, idl: any, info: IdlInfo, source: string) {
    const svc = this.svc; const u = svc.ensureUser(tid, chat);
    const lim = svc.limits(u);
    if (!lim || svc.programCount(u.tenant_id) >= lim.maxPrograms) return void await this.say(chat, 'Your plan does not allow another program.');
    svc.engine.addProgram({ tenantId: u.tenant_id, programId: pid, idl, idlKind: info.kind, rules: [], silenceHours: 24, upgradeAlerts: true });
    await svc.engine.resolveProgramdata(this.o.rpc).catch((e) => this.log(`programdata ${pid}: ${(e as Error).message}`));
    svc.startTrialIfNeeded(tid);
    this.o.onProgramsChanged?.();
    const rowid = (svc.db.prepare('SELECT rowid r FROM programs WHERE tenant_id=? AND program_id=?').get(u.tenant_id, pid) as { r: number }).r;
    const fresh = svc.user(tid)!;
    await this.say(chat, `Watching ${pid} (${info.kind} IDL from ${source}). On by default: upgrade / authority-change alerts and a 24 h silence alert. Trial: ${svc.trialDaysLeft(fresh)} days left.\n\nTap a name to add an alert for it:`, this.buttons(rowid, info));
  }

  private buttons(rowid: number, info: IdlInfo): Button[][] {
    const items = [...info.instructions.map((n) => ({ k: 'i', n })), ...info.events.map((n) => ({ k: 'e', n }))].filter((x) => `a:${rowid}:${x.k}:${x.n}`.length <= 64).slice(0, 40);
    const rows: Button[][] = [];
    for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2).map((x) => ({ text: `${x.k === 'i' ? 'ix' : 'ev'} ${x.n}`.slice(0, 40), callback_data: `a:${rowid}:${x.k}:${x.n}` })));
    return rows;
  }

  private async onCallback(q: any) {
    const svc = this.svc; const tid = String(q.from.id); const chat = String(q.message?.chat?.id ?? '');
    const u = svc.user(tid); const ack = (t?: string) => this.o.tg.answerCallback?.(q.id, t);
    if (!u || u.chat_id !== chat) return void await ack('Not yours.');
    const parts = String(q.data ?? '').split(':');
    if (parts[0] === 'a') {
      const prog = svc.db.prepare('SELECT program_id FROM programs WHERE rowid=? AND tenant_id=?').get(Number(parts[1]), u.tenant_id) as { program_id: string } | undefined;
      if (!prog) return void await ack('Program not found.');
      const kind = parts[2] === 'e' ? 'event' : 'instruction'; const name = parts.slice(3).join(':');
      if (svc.engine.rulesOf(u.tenant_id, prog.program_id).some((r) => r.rule.kind === kind && r.rule.name === name)) return void await ack('Already added.');
      const rule: AlertRule = { kind, name, match: 'all', conditions: [], severity: 'info', channels: ['telegram'], unsupportedChannels: [] };
      svc.engine.addRule(u.tenant_id, prog.program_id, rule);
      return void await ack(`Alert added: ${kind} ${name}`);
    }
    if (parts[0] === 'r') {
      const row = svc.db.prepare('SELECT program_id FROM rules WHERE id=? AND tenant_id=?').get(Number(parts[1]), u.tenant_id) as { program_id: string } | undefined;
      if (!row) return void await ack('Rule not found.');
      svc.engine.removeRule(u.tenant_id, row.program_id, Number(parts[1]));
      return void await ack('Rule removed.');
    }
    await ack();
  }

  private async list(tid: string, chat: string) {
    const u = this.svc.user(tid);
    const rows = u ? this.svc.db.prepare('SELECT program_id FROM programs WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id) as { program_id: string }[] : [];
    await this.say(chat, rows.length ? `Your programs:\n${rows.map((r) => `${r.program_id} (${this.svc.engine.rulesOf(u!.tenant_id, r.program_id).length} rules)`).join('\n')}` : 'You are not watching anything yet. /watch PROGRAM_ID');
  }

  private async remove(tid: string, chat: string, pid: string) {
    const u = this.svc.user(tid);
    if (!u || !this.svc.engine.removeProgram(u.tenant_id, pid)) return void await this.say(chat, 'You do not watch that program.');
    this.o.onProgramsChanged?.();
    await this.say(chat, `Stopped watching ${pid}.`);
  }

  private async rules(tid: string, chat: string, pid: string, toml: string) {
    const svc = this.svc; const u = svc.user(tid);
    if (!u || !svc.engine.getEntry(u.tenant_id, pid)) return void await this.say(chat, 'Usage: /rules PROGRAM_ID (a program you watch).');
    if (toml) {
      let rules: AlertRule[];
      try { rules = parseAlertsToml(toml); } catch (e) { return void await this.say(chat, `Could not use that [[alerts]] block: ${(e as Error).message.slice(0, 300)}`); }
      if (!rules.length) return void await this.say(chat, 'No [[alerts]] found in that block.');
      for (const r of rules) svc.engine.addRule(u.tenant_id, pid, { ...r, channels: ['telegram'] });   // customers only get Telegram
      return void await this.say(chat, `Added ${rules.length} rule${rules.length === 1 ? '' : 's'}. Channels are set to Telegram.`);
    }
    const rs = svc.engine.rulesOf(u.tenant_id, pid);
    const text = rs.length ? `Rules for ${pid}:\n${rs.map((r) => `#${r.id} ${r.rule.kind} ${r.rule.name} (${r.rule.conditions.length} conditions)`).join('\n')}` : `No rules yet for ${pid}. Upgrade and silence alerts are always on. Paste a Microscope [[alerts]] block under /rules ${pid} to add rules.`;
    await this.say(chat, text, rs.length ? rs.slice(0, 20).map((r) => [{ text: `remove #${r.id} ${r.rule.name}`.slice(0, 40), callback_data: `r:${r.id}` }]) : undefined);
  }

  private async status(tid: string, chat: string) {
    const svc = this.svc; const u = svc.user(tid);
    if (!u) return void await this.say(chat, 'Send /start first.');
    const st = svc.state(u); const lim = svc.limits(u); const planName = st === 'expired' ? 'trial ended' : st === 'none' ? 'free trial (starts at your first /watch)' : st === 'trial' ? `free trial on ${lim!.plan.name} limits, ${svc.trialDaysLeft(u)} days left` : lim!.plan.name;
    const progs = svc.db.prepare('SELECT program_id FROM programs WHERE tenant_id=? ORDER BY created_at').all(u.tenant_id) as { program_id: string }[];
    const quota = lim?.plan.txPerMonth ?? 0;
    const lines = progs.map((p) => { const n = svc.usage(u.tenant_id, p.program_id); return `${p.program_id}: ${n.toLocaleString('en-US')} / ${quota.toLocaleString('en-US')} tx this month (${quota ? Math.round((n / quota) * 100) : 0}%)${quota && n >= quota ? ' PAUSED' : ''}`; });
    await this.say(chat, `Plan: ${planName}\nPrograms: ${progs.length} / ${lim?.maxPrograms ?? 0}\n${lines.join('\n') || 'No programs yet.'}${st === 'expired' ? '\nAlerts are paused. /plans, then /upgrade PLAN.' : ''}`);
  }

  private async plans(tid: string, chat: string) {
    const b = this.o.billing; if (!b) return void await this.say(chat, 'Billing is not enabled.');
    const days = this.svc.cfg.billing.periodDays;
    const lines = b.visiblePlans(tid).map((p) => `${p.name}: $${p.priceUsd} per ${days} days, ${p.txPerMonth.toLocaleString('en-US')} tx per program per month, up to ${p.maxPrograms} programs  ->  /upgrade ${p.id}`);
    await this.say(chat, `Plans (pay in USDC on Solana):\n${lines.join('\n')}\n\nThe free trial is ${this.svc.cfg.trial.days} days on Starter limits with ${this.svc.cfg.trial.maxPrograms} program.`);
  }

  private async upgrade(tid: string, chat: string, planId: string) {
    const b = this.o.billing; if (!b) return void await this.say(chat, 'Billing is not enabled.');
    const u = this.svc.ensureUser(tid, chat);
    const plan = b.plan(planId.toLowerCase(), tid);
    if (!plan) return void await this.say(chat, `Unknown plan. Choose one of: ${b.visiblePlans(tid).map((p) => p.id).join(', ')} (see /plans).`);
    let made; try { made = b.createOrder(u, plan); } catch (e) { return void await this.say(chat, (e as Error).message); }
    await this.say(chat, `${plan.name}: send exactly ${plan.priceUsd} USDC (Solana) within ${this.svc.cfg.billing.orderTtlMinutes} minutes. Open this link in a Solana Pay wallet (Phantom, Solflare, Seeker wallet) or scan the QR below:\n\n${made.link}\n\nIt activates automatically once the payment is finalized (about 15 seconds after you send it). A payment that arrives late is still honoured.`);
    if (this.o.tg.sendPhoto) await this.o.tg.sendPhoto(chat, await b.qr(made.link), `${plan.name} ${plan.priceUsd} USDC`).catch((e) => this.log(`qr failed: ${(e as Error).message}`));
  }

  private async billingInfo(tid: string, chat: string) {
    const b = this.o.billing; const svc = this.svc; const u = svc.user(tid);
    if (!b || !u) return void await this.say(chat, 'Send /start first.');
    const phase = svc.paidPhase(u); const plan = u.paid_plan ? svc.cfg.plans[u.paid_plan] : undefined;
    const st = svc.state(u);
    const head = phase && plan ? `Plan: ${plan.name} (${phase === 'grace' ? 'EXPIRED, in the ' + svc.cfg.billing.graceDays + '-day grace period' : 'active'}), until ${new Date(u.paid_until!).toISOString().slice(0, 10)}` : `Plan: ${st === 'trial' ? 'free trial' : st === 'none' ? 'free trial (not started)' : 'none (trial ended)'}`;
    const hist = b.history(tid).map((h) => `${new Date(h.created_at).toISOString().slice(0, 10)} ${h.plan_id} ${(Number(h.amount_raw) / 10 ** svc.cfg.billing.decimals).toString()} USDC ${h.status} ${h.signature}`);
    await this.say(chat, `${head}\n\nPayments:\n${hist.join('\n') || 'none yet'}`);
  }

  private async support(tid: string, chat: string, text: string) {
    if (!text) return void await this.say(chat, 'Usage: /support your message. It goes to the operator, who answers by hand.');
    if (!this.o.ownerChatId) return void await this.say(chat, 'Support is not configured.');
    if (!this.svc.watchAllowed(`support:${tid}`, 5)) return void await this.say(chat, 'Too many support messages this hour.');
    this.svc.ensureUser(tid, chat);
    const mid = await this.say(this.o.ownerChatId, `SUPPORT from Telegram id ${tid}:\n${text.slice(0, 1500)}`);
    this.log(`support forwarded message_id=${mid}`);
    await this.say(chat, 'Sent. The operator will reply here by hand.');
  }

  /** Long-poll loop. Offset advances only after an update was handled. */
  async run(signal: { stopped: boolean }): Promise<void> {
    const tg = this.o.tg as Tg; let offset: number | undefined;
    while (!signal.stopped) {
      try {
        const ups = await tg.getUpdates(offset, 30);
        for (const u of ups) { await this.handleUpdate(u); offset = u.update_id + 1; }
        for (const n of this.svc.tick()) await this.say(n.chatId, n.text).catch((e) => this.log(`notice failed: ${(e as Error).message}`));
      } catch (e) { this.log(`poll error: ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 5000)); }
    }
  }
}
