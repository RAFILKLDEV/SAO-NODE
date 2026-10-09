/* global process */
const fs = require('node:fs');
const source = fs.readFileSync('apps/api/src/routes/map-canvas.js', 'utf8');
if (!source.includes('Date.now() + 3000')) process.exit(1);
process.stdout.write('Ping TTL: 3000 ms\n');
