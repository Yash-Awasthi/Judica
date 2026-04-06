const fs = require('fs');
const filesToFix = [
  'src/lib/deliberationPhases.ts',
  'src/middleware/limiter.ts'
];

for (const f of filesToFix) {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/catch \([^)]+\)\s*\{\s*\}/g, 'catch (e) { console.error(e); }');
  content = content.replace(/catch\s*\{\s*\}/g, 'catch { console.error("error"); }');
  fs.writeFileSync(f, content);
}
