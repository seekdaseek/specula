export interface RawTx {
  slot: number;
  blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[]; addressTableLookups?: unknown[] } };
  meta: {
    err: unknown;
    logMessages?: string[] | null;
    innerInstructions?: { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null }[] }[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
  version?: 'legacy' | number;
}

export interface DecodedRecord {
  kind: 'program_instruction' | 'program_event';
  name: string;
  data: unknown;
  program_id: string;
  signature: string;
  slot: number;
  block_time: number | null;
  failed: boolean;
  /** Microscope-style instruction path: "2" (top level) or "2.1" (inner) */
  instruction_path: string;
  /** primary-key component: path for instructions, path + ":ev" + n for events */
  ix_key: string;
  source?: 'log' | 'cpi';
  instruction?: string;
}
