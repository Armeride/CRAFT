// Semgrep rule fixtures for .semgrep/craft.yml. Not part of the app build.
// Run: semgrep --test .semgrep/

// ruleid: craft-no-shell-exec, craft-child-process-wrapper-only
import { exec } from 'node:child_process';
// ruleid: craft-child-process-wrapper-only
import * as cp from 'child_process';
// ok: craft-child-process-wrapper-only
import type { ChildProcess } from 'node:child_process';
// ruleid: craft-sqlite-adapter-only
import Database from 'better-sqlite3';
// ok: craft-sqlite-adapter-only
import type { Database as Db } from 'better-sqlite3';
// ruleid: craft-no-dynamic-code
import { runInNewContext } from 'node:vm';

declare const userInput: string;
declare const child: ChildProcess;
declare const db: Db;

exec(userInput);
// ruleid: craft-no-shell-exec
cp.execSync(userInput);
// ok: craft-no-shell-exec
cp.execFile('git', ['status'], { shell: false });
// ruleid: craft-no-spawn-shell-true
cp.spawn('git', ['status'], { shell: true, windowsHide: true });

// ruleid: craft-no-dynamic-code
eval(userInput);
// ruleid: craft-no-dynamic-code
const fn = new Function('a', userInput);
// ruleid: craft-no-dynamic-code
setTimeout('alert(1)', 10);
// ok: craft-no-dynamic-code
setTimeout(() => { fn(); }, 10);
runInNewContext(userInput);

// ruleid: craft-web-network-via-api-only
void fetch('/api/projects');
// ruleid: craft-web-network-via-api-only
const events = new EventSource('/api/events');

void [child, db, Database, events];
