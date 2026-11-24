import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createWebApp } from '../apps/server/app.js';

const { values } = parseArgs({ options: {
  'app-data': { type: 'string' }, port: { type: 'string', default: '4173' },
} });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535');
if (values['app-data'] !== undefined && !values['app-data'].trim()) throw new Error('App data requires a directory');
const defaultDirectory = process.platform === 'win32'
  ? process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
  : process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
const appData = resolve(values['app-data'] ?? join(defaultDirectory, 'CRAFT'));
const webRoot = resolve('dist/web');
await access(join(webRoot, 'index.html'));
const app = await createWebApp({ appData, port, webRoot });
try {
  const address = await app.listen({ port, host: '127.0.0.1' });
  console.log(`CRAFT: ${address}\nApp data: ${appData}`);
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch((error: unknown) => { console.error(error); process.exitCode = 1; }); });
}
