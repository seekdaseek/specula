// R42: the authority classifier (scripts/census-lib.mjs). Kamino Lend's REAL upgrade authority was filed "pda-other" because only the authority's newest transaction was looked at, and that one does not
// invoke Squads (its 2nd newest does). The fixture is the real mainnet RPC replies for that authority, replayed offline.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { classifyPda, squadsMultisigFor, SQ4 } from '../scripts/census-lib.mjs';

const fx = JSON.parse(fs.readFileSync('fixtures/census/kamino-lend-authority.json', 'utf8'));
const replay = (calls = []) => async (method, params) => { const k = `${method}|${JSON.stringify(params)}`; calls.push(method); if (!(k in fx.rpc)) throw new Error(`fixture has no reply for ${k.slice(0, 90)}`); return fx.rpc[k]; };

describe('classifyPda with the real Kamino Lend authority', () => {
  it('is a Squads v4 vault, 5 of 10, time lock 24 h, proven by re-deriving the vault PDA from the multisig', async () => {
    const c = await classifyPda(replay(), fx.authority);
    expect(c.kind).toBe('squads-v4-vault');
    expect(c.squads).toMatchObject({ version: 'v4', threshold: 5, members: 10, time_lock_seconds: 86400, sane: true });
    expect(c.squads.proof_vault_pda).toMatch(/^vault index \d$/);
    expect(c.evidence).toContain('derives to this authority');
  });
  it('the old behaviour is the bug: the NEWEST transaction alone does not invoke Squads (the second newest does), so it needed the wider scan', async () => {
    const sigs = fx.rpc[Object.keys(fx.rpc).find((k) => k.startsWith('getSignaturesForAddress'))].filter((s) => !s.err);
    const txKeys = Object.keys(fx.rpc).filter((k) => k.startsWith('getTransaction'));
    expect(txKeys).toHaveLength(2);                                                                // the scan stopped at the second transaction, where Squads is invoked
    const newest = fx.rpc[txKeys.find((k) => k.includes(sigs[0].signature))]; const m = newest.transaction.message;
    const keys = [...(m.accountKeys || m.staticAccountKeys), ...(newest.meta?.loadedAddresses?.writable ?? []), ...(newest.meta?.loadedAddresses?.readonly ?? [])];
    const invoked = new Set([...m.instructions.map((x) => keys[x.programIdIndex]), ...(newest.meta?.innerInstructions || []).flatMap((g) => g.instructions.map((x) => keys[x.programIdIndex]))]);
    expect(invoked.has(SQ4)).toBe(false);
    const second = fx.rpc[txKeys.find((k) => k.includes(sigs[1].signature))]; const m2 = second.transaction.message;
    const keys2 = [...(m2.accountKeys || m2.staticAccountKeys), ...(second.meta?.loadedAddresses?.writable ?? []), ...(second.meta?.loadedAddresses?.readonly ?? [])];
    expect(new Set([...m2.instructions.map((x) => keys2[x.programIdIndex])]).has(SQ4) || (second.meta?.innerInstructions || []).some((g) => g.instructions.some((x) => keys2[x.programIdIndex] === SQ4))).toBe(true);
  });
  it('a Squads vault is accepted only on PROOF: the same transaction with a different authority yields no multisig', async () => {
    const accountsKey = Object.keys(fx.rpc).find((k) => k.startsWith('getMultipleAccounts')); const ids = JSON.parse(accountsKey.slice(accountsKey.indexOf('|') + 1))[0];
    expect(await squadsMultisigFor(replay(), '11111111111111111111111111111111', ids, SQ4)).toBeNull();           // negative control
    expect((await squadsMultisigFor(replay(), fx.authority, ids, SQ4))?.threshold).toBe(5);                        // positive control
  });
  it('an authority with no successful history is pda-unknown; one whose transactions never touch Squads or Realms is pda-other', async () => {
    expect((await classifyPda(async () => [], 'x')).kind).toBe('pda-unknown');
    const rpc = async (m) => (m === 'getSignaturesForAddress' ? [{ signature: 'S1', err: null }] : { transaction: { message: { accountKeys: ['A', 'B'], instructions: [{ programIdIndex: 1, accounts: [0], data: '' }] } }, meta: {} });
    expect((await classifyPda(rpc, 'x')).kind).toBe('pda-other');
  });
});
