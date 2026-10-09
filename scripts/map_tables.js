const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('../schema_audit.json', 'utf8'));

const schoolLevelTables = [];
const branchLevelTables = [];
const saasPlatformTables = [];
const lookupOrStaticTables = [];
const junctionOrChildTables = [];

for (const [tableName, info] of Object.entries(audit.tables)) {
  const cols = info.columns.map(c => c.COLUMN_NAME);

  if (
    tableName.startsWith('saas_') ||
    ['coupons', 'storage_master', 'subscription_items', 'subscription_plans', 'payment_webhook_logs'].includes(tableName)
  ) {
    saasPlatformTables.push(tableName);
  } else if (
    ['countries', 'states', 'cities', 'gender_master', 'blood_group_master', 'marital_master', 
     'parent_type_master', 'rfid_card_master', 'attendance_machine_master', 'capacity_unit_master'].includes(tableName)
  ) {
    lookupOrStaticTables.push(tableName);
  } else if (['school_master', 'branch_master', 'coupon_usages', 'school_subscriptions', 'school_rfid_orders', 'company_settings'].includes(tableName)) {
    schoolLevelTables.push(tableName);
  } else if (info.hasBranchId) {
    branchLevelTables.push(tableName);
  } else if (info.hasSchoolId && !info.hasBranchId) {
    schoolLevelTables.push(tableName);
  } else {
    junctionOrChildTables.push(tableName);
  }
}

console.log('=== TABLE CLASSIFICATION MAP ===');
console.log(`\n1. School-Level / Organization Tables (${schoolLevelTables.length}):`);
console.log(schoolLevelTables.join(', '));

console.log(`\n2. Branch-Level Tables (${branchLevelTables.length}):`);
console.log(branchLevelTables.join(', '));

console.log(`\n3. SaaS Platform / Multi-Tenant Root Tables (${saasPlatformTables.length}):`);
console.log(saasPlatformTables.join(', '));

console.log(`\n4. Global Master / Lookup Tables (${lookupOrStaticTables.length}):`);
console.log(lookupOrStaticTables.join(', '));

console.log(`\n5. Child / Junction / Other Tables (${junctionOrChildTables.length}):`);
console.log(junctionOrChildTables.join(', '));
