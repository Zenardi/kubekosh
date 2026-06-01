#!/usr/bin/env node
// KubeKosh PostToolUse hook (Write|Edit).
// If an edit leaves scenarios/scenarios.json or scenarios/bundles.json
// unparseable, exit 2 so the broken curriculum file is caught immediately
// instead of only failing at runtime. Any other file is ignored (exit 0).
const fs = require('fs');

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let filePath = '';
  try {
    filePath = (JSON.parse(raw).tool_input || {}).file_path || '';
  } catch {
    process.exit(0); // unreadable hook payload — not our concern
  }

  if (!/scenarios\/(scenarios|bundles)\.json$/.test(filePath)) process.exit(0);

  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`KubeKosh hook: ${filePath} is no longer valid JSON — ${e.message}`);
    process.exit(2);
  }
});
