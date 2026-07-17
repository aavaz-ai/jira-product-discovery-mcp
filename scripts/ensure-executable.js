#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const entryPoint = path.join(__dirname, '..', 'dist', 'index.js');
if (fs.existsSync(entryPoint)) {
	fs.chmodSync(entryPoint, 0o755);
}
