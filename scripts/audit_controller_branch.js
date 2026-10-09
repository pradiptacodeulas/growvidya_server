const fs = require('fs');
const path = require('path');

const controllersDir = path.resolve(__dirname, '../controllers');
const files = fs.readdirSync(controllersDir).filter(f => f.endsWith('.controller.js'));

console.log('Controller audit for branchId extraction:');
for (const f of files) {
  const content = fs.readFileSync(path.join(controllersDir, f), 'utf8');
  const hasBranch = content.includes('branchId') || content.includes('branch_id');
  const hasReqBranch = content.includes('req.branchId') || content.includes('req.user.branchId') || content.includes('req.user.branch_id');
  
  // Extract lines where branch is referenced
  const lines = content.split('\n');
  const branchLines = [];
  lines.forEach((l, i) => {
    if (l.includes('branchId') || l.includes('branch_id')) {
      if (l.includes('const ') || l.includes('let ') || l.includes('branch_id:') || l.includes('branchId:')) {
        branchLines.push({ line: i + 1, text: l.trim() });
      }
    }
  });

  console.log(`\n--- ${f} (hasBranch: ${hasBranch}, hasReqBranch: ${hasReqBranch}) ---`);
  if (branchLines.length === 0) {
    console.log('  [NO BRANCH ID EXTRACTION FOUND]');
  } else {
    branchLines.slice(0, 5).forEach(b => console.log(`  L${b.line}: ${b.text}`));
  }
}
