// scripts/census-lib.mjs: classify an upgrade authority and read its Squads multisig (R42, 16 Nov 2026).
//
// ROOT CAUSE of the Kamino Lend mistake (R41 census): the classifier looked at the authority's NEWEST transaction only. A vault PDA's newest transaction is not always a Squads transaction (Kamino Lend's
// newest, 12 Nov, is a loader instruction that does not invoke Squads; its 2nd to 5th newest, 26 Oct, do), so a Squads v4 vault was filed as "pda-other". Now: walk the authority's recent successful
// transactions (up to MAX_TX), and accept a Squads vault only on PROOF: a Squads-owned multisig account in the same transaction whose vault PDA re-derives to the authority.
import crypto from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import bs58 from 'bs58';

const PublicKey = anchor.web3.PublicKey;
export const SQ4 = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf', SQ3 = 'SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu';
export const SQUADS = { [SQ4]: 'squads-v4', [SQ3]: 'squads-v3' };
export const GOVERNANCE = { GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw: 'realms-governance' };
export const MAX_TX = 40;
const disc = (name) => crypto.createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const D4 = disc('Multisig'), D3 = disc('Ms');
const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, new PublicKey(prog))[0].toBase58();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** the multisig behind a vault PDA, found among `candidates` (account ids of one transaction) and ACCEPTED only when its vault/authority PDA equals `authority`. rpc(method, params). */
export async function squadsMultisigFor(rpc, authority, candidates, program) {
  const v4 = program === SQ4; const cand = [...new Set(candidates)].slice(0, 99);
  const accs = await rpc('getMultipleAccounts', [cand, { encoding: 'base64' }]);
  for (let k = 0; k < cand.length; k++) {
    const v = accs.value[k]; if (!v || v.owner !== program) continue; const d = Buffer.from(v.data[0], 'base64'); const ms = cand[k]; let proof = null;
    if (v4) { if (!d.subarray(0, 8).equals(D4)) continue; for (let i = 0; i < 4 && !proof; i++) if (pda([Buffer.from('multisig'), new PublicKey(ms).toBuffer(), Buffer.from('vault'), Buffer.from([i])], SQ4) === authority) proof = `vault index ${i}`; }
    else { if (!d.subarray(0, 8).equals(D3)) continue; for (let i = 1; i < 5 && !proof; i++) if (pda([Buffer.from('squad'), new PublicKey(ms).toBuffer(), u32(i), Buffer.from('authority')], SQ3) === authority) proof = `authority index ${i}`; }
    if (!proof) continue;
    let m;
    if (v4) {
      let p = 8 + 32; const cfg = bs58.encode(d.subarray(p, p + 32)); p += 32; const threshold = d.readUInt16LE(p); p += 2; const timeLock = d.readUInt32LE(p); p += 4; p += 16;
      const rc = d[p]; p += rc === 1 ? 33 : 1; p += 1; const n = d.readUInt32LE(p);
      m = { version: 'v4', multisig: ms, threshold, members: n, time_lock_seconds: timeLock, config_authority: cfg === '11111111111111111111111111111111' ? 'none (autonomous)' : cfg, proof_vault_pda: proof };
    } else {
      let p = 8; const threshold = d.readUInt16LE(p); p += 2; p += 2 + 4 + 4 + 1 + 32 + 1; const n = d.readUInt32LE(p);
      m = { version: 'v3', multisig: ms, threshold, members: n, time_lock_seconds: null, config_authority: 'n/a (v3: changes go through the multisig itself)', proof_vault_pda: proof };
    }
    m.sane = m.threshold >= 1 && m.threshold <= m.members && m.members >= 1 && m.members <= 100;
    return m;
  }
  return null;
}

/**
 * For an OFF-CURVE authority: walk its recent successful transactions newest first (up to maxTx). Returns { kind, evidence, squads? }:
 *  squads-v4-vault / squads-v3-vault (with the proven multisig), governance, pda-other (scanned, none invokes Squads or Realms), pda-unknown (no history).
 */
export async function classifyPda(rpc, authority, maxTx = MAX_TX) {
  const sigs = (await rpc('getSignaturesForAddress', [authority, { limit: maxTx, commitment: 'finalized' }])).filter((s) => !s.err);
  if (!sigs.length) return { kind: 'pda-unknown', evidence: 'off the ed25519 curve (a PDA) and no transaction history to say which program controls it' };
  let weak = null;
  for (let i = 0; i < sigs.length; i++) {
    const t = await rpc('getTransaction', [sigs[i].signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'finalized' }]); if (!t) continue;
    const m = t.transaction.message; const keys = [...(m.accountKeys || m.staticAccountKeys || []), ...(t.meta?.loadedAddresses?.writable ?? []), ...(t.meta?.loadedAddresses?.readonly ?? [])];
    const invoked = new Set([...(m.instructions || []).map((x) => keys[x.programIdIndex]), ...(t.meta?.innerInstructions || []).flatMap((g) => g.instructions.map((x) => keys[x.programIdIndex]))]);
    const sq = [...invoked].find((p) => SQUADS[p]);
    if (sq) {
      const ms = await squadsMultisigFor(rpc, authority, keys, sq);
      if (ms) return { kind: `${SQUADS[sq]}-vault`, squads: ms, evidence: `off the curve (a PDA); transaction ${sigs[i].signature.slice(0, 12)}... (${i + 1} of the ${sigs.length} newest) invokes ${SQUADS[sq]} and holds the multisig ${ms.multisig} whose ${ms.proof_vault_pda} derives to this authority` };
      weak = weak ?? { kind: 'pda-other', evidence: `off the curve (a PDA); transaction ${sigs[i].signature.slice(0, 12)}... invokes ${SQUADS[sq]} but no multisig account in it derives to this authority, so Squads control is NOT proven)` };
    }
    const gv = [...invoked].find((p) => GOVERNANCE[p]);
    if (gv) return { kind: 'governance', evidence: `off the curve (a PDA); transaction ${sigs[i].signature.slice(0, 12)}... invokes ${GOVERNANCE[gv]}` };
  }
  return weak ?? { kind: 'pda-other', evidence: `off the curve (a PDA); none of its ${sigs.length} newest successful transactions invokes Squads or Realms` };
}
