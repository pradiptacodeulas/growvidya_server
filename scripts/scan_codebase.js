const fs = require('fs');
const path = require('path');

const controllersDir = path.resolve(__dirname, '../controllers');
const modelsDir = path.resolve(__dirname, '../models');

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  const results = [];

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check for queries / SQL or functions
    const schoolIdMatches = (content.match(/school_id/gi) || []).length;
    const branchIdMatches = (content.match(/branch_id/gi) || []).length;
    const findOneMatches = (content.match(/findOne|findByPk|already exists|duplicate/gi) || []).length;

    // Extract SQL snippets or queries containing school_id
    const lines = content.split('\n');
    const suspiciousLines = [];

    lines.forEach((line, index) => {
      // Look for WHERE conditions or INSERT or UPDATE that mention school_id but NOT branch_id
      if (
        (line.includes('WHERE') || line.includes('AND') || line.includes('where') || line.includes('and')) &&
        line.includes('school_id') &&
        !line.includes('branch_id')
      ) {
        suspiciousLines.push({ lineNum: index + 1, text: line.trim() });
      }
    });

    results.push({
      file,
      fullPath,
      schoolIdCount: schoolIdMatches,
      branchIdCount: branchIdMatches,
      suspiciousLinesCount: suspiciousLines.length,
      suspiciousLines: suspiciousLines.slice(0, 10), // first 10
    });
  }

  return results;
}

console.log('--- CONTROLLERS SCAN ---');
const controllerResults = scanDir(controllersDir);
controllerResults.sort((a, b) => b.schoolIdCount - a.schoolIdCount);
for (const r of controllerResults) {
  console.log(`${r.file.padEnd(35)} school_id: ${r.schoolIdCount}, branch_id: ${r.branchIdCount}, suspicious: ${r.suspiciousLinesCount}`);
}

console.log('\n--- MODELS SCAN ---');
const modelResults = scanDir(modelsDir);
modelResults.sort((a, b) => b.schoolIdCount - a.schoolIdCount);
for (const r of modelResults) {
  console.log(`${r.file.padEnd(35)} school_id: ${r.schoolIdCount}, branch_id: ${r.branchIdCount}, suspicious: ${r.suspiciousLinesCount}`);
}
