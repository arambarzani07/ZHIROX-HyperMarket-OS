import{mkdtempSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
process.env.PORT='4173';process.env.ZHIROX_BIND='0.0.0.0';process.env.ZHIROX_PREVIEW='1';process.env.ZHIROX_DATA_DIR=mkdtempSync(join(tmpdir(),'zhirox-preview-'));
await import('../src/server.mjs');
