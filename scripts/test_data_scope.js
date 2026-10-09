const DataScope = require('../utils/dataScope.util');
const { pool } = require('../config/db.config');

async function test() {
  const mainBranch1 = await DataScope.getMainBranchId(1);
  console.log('Main branch for School 1:', mainBranch1);

  // Mock request for Super Admin
  const reqSuperAdmin = {
    user: { schoolId: 1, adminType: 1, roleName: 'Super Admin', registrationType: 'multiple' },
    query: {},
    body: {},
    headers: {}
  };
  const scope1 = DataScope.getDataScope(reqSuperAdmin);
  console.log('Scope 1 (Super Admin all):', scope1.scope, 'branchId:', scope1.branchId);

  // Mock request for Super Admin selecting branch 2
  const reqSuperAdminBranch2 = {
    user: { schoolId: 1, adminType: 1, roleName: 'Super Admin', registrationType: 'multiple' },
    query: { branch_id: '2' },
    body: {},
    headers: {}
  };
  const scope2 = DataScope.getDataScope(reqSuperAdminBranch2);
  console.log('Scope 2 (Super Admin Branch 2):', scope2.scope, 'branchId:', scope2.branchId);

  // Mock request for Branch Admin (user 2 in branch 2)
  const reqBranchAdmin = {
    user: { schoolId: 1, adminType: 2, roleName: 'Accountant', branchId: 2, registrationType: 'multiple' },
    query: { branch_id: '1' }, // attempting to sneakily override
    body: {},
    headers: { 'x-branch-id': '1' }
  };
  const scope3 = DataScope.getDataScope(reqBranchAdmin);
  console.log('Scope 3 (Branch Admin attempted override):', scope3.scope, 'branchId:', scope3.branchId, '(Should be 2!)');

  await pool.end();
}

test();
