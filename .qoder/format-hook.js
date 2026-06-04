const cp = require('child_process');
const fs = require('fs');
const path = require('path');

let data = '';
process.stdin.on('data', (chunk) => (data += chunk));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data);
    const filePath = input.tool_response?.filePath || input.tool_input?.file_path;
    if (!filePath || !fs.existsSync(filePath)) return;
    if (!/\.(ts|tsx|vue|md|json|js|jsx|css|scss)$/.test(filePath)) return;
    const absolutePath = path.resolve(filePath);
    cp.execSync(`cd backend && npx prettier --write --ignore-unknown "${absolutePath}"`, { stdio: 'ignore' });
  } catch (_) {}
});
