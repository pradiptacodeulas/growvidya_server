const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('../schema_audit.json', 'utf8'));

const uniqueIndexes = {};
for (const idx of audit.indexes) {
  if (idx.NON_UNIQUE === 0 && idx.INDEX_NAME !== 'PRIMARY') {
    if (!uniqueIndexes[idx.TABLE_NAME]) {
      uniqueIndexes[idx.TABLE_NAME] = {};
    }
    if (!uniqueIndexes[idx.TABLE_NAME][idx.INDEX_NAME]) {
      uniqueIndexes[idx.TABLE_NAME][idx.INDEX_NAME] = [];
    }
    uniqueIndexes[idx.TABLE_NAME][idx.INDEX_NAME].push(idx.COLUMN_NAME);
  }
}

console.log('Unique non-primary indexes on tables:');
for (const [table, indexes] of Object.entries(uniqueIndexes)) {
  console.log(`\nTable: ${table}`);
  for (const [idxName, cols] of Object.entries(indexes)) {
    console.log(`  - ${idxName}: (${cols.join(', ')})`);
  }
}
