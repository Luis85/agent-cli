#!/usr/bin/env node
'use strict';
require('node:module').enableCompileCache();
const runtime = require('node:path').join(__dirname, 'forge-runtime.js');
if (require('node:fs').existsSync(runtime)) require(runtime);
else {
  const message = `The runtime bundle ${runtime} is missing. bin/forge.js and bin/forge-runtime.js ship together; replace both from the same release.`;
  const error = { code: 'INVALID_SETUP', message, hint: "Repair the bin path named in the message, then run setup again.", retryable: false };
  process.stdout.write(JSON.stringify({ ok: false, error, events: [], warnings: [] }, null, 2) + '\n');
  process.exitCode = 2;
}
