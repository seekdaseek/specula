#!/usr/bin/env node
import { loadConfig } from './config.js';
import { start } from './run.js';
import { loadServiceConfig, startDaemon } from './daemon.js';
const [cmd, file] = process.argv.slice(2);
if ((cmd !== 'run' && cmd !== 'serve') || !file) { console.error('usage: specula run <config.toml> | specula serve <service.toml>'); process.exit(2); }
const s = cmd === 'serve' ? await startDaemon(loadServiceConfig(file)) : await start(loadConfig(file));
process.on('SIGINT', async () => { await s.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await s.stop(); process.exit(0); });
