import bs58 from 'bs58';
import type { RawTx } from './types.js';

export const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
export interface UpgradeEvent { action: 'upgrade' | 'set_authority'; signature: string; slot: number; block_time: number | null; failed: boolean; ix_key: string; programdata: string; buffer?: string; authority?: string; new_authority?: string | null }

/** BPF Upgradeable Loader instruction tags (bincode u32 LE): 3 Upgrade, 4 SetAuthority, 7 SetAuthorityChecked. */
export function findUpgrades(tx: RawTx, programdata: string): UpgradeEvent[] {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const failed = !!tx.meta && tx.meta.err !== null && tx.meta.err !== undefined;
  const out: UpgradeEvent[] = [];
  const all: { path: string; programIdIndex: number; accounts: number[]; data: string }[] = [];
  tx.transaction.message.instructions.forEach((ix, i) => {
    all.push({ path: String(i), ...ix });
    tx.meta?.innerInstructions?.find((g) => g.index === i)?.instructions.forEach((c, k) => all.push({ path: `${i}.${k}`, ...c }));
  });
  for (const ix of all) {
    if (keys[ix.programIdIndex] !== LOADER) continue;
    const d = Buffer.from(bs58.decode(ix.data));
    if (d.length < 4) continue;
    const tag = d.readUInt32LE(0);
    const acc = ix.accounts.map((a) => keys[a]!);
    if (tag === 3 && acc[0] === programdata) out.push({ action: 'upgrade', signature: tx.transaction.signatures[0]!, slot: tx.slot, block_time: tx.blockTime, failed, ix_key: `upgrade:${ix.path}`, programdata, buffer: acc[2], authority: acc[6] });
    else if ((tag === 4 || tag === 7) && acc[0] === programdata) out.push({ action: 'set_authority', signature: tx.transaction.signatures[0]!, slot: tx.slot, block_time: tx.blockTime, failed, ix_key: `upgrade:${ix.path}`, programdata, authority: acc[1], new_authority: tag === 7 ? acc[2] : (acc[2] ?? null) });
  }
  return out;
}
