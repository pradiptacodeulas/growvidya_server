/**
 * Verification Suite: Payment Gateway & Email Delivery RBAC Separation
 * 
 * Verifies:
 * 1. SaasRoleModel permission normalization and evaluation (dot-notation & aliases).
 * 2. Unauthenticated requests return HTTP 401.
 * 3. Cross-module authorization isolation (Payment Gateway vs Email Delivery).
 * 4. View vs Update privilege boundaries (GET allowed, POST/PUT/DELETE rejected with 403).
 * 5. Masking of sensitive credentials (secrets are not exposed in plaintext).
 * 6. Super Admin full-access bypass.
 * 7. Clean DB rollback of test accounts & roles.
 */

const http = require('http');
const express = require('express');
const { pool } = require('../config/db.config');
const { generateToken } = require('../utils/jwt.util');
const SaasRoleModel = require('../models/saasRole.model');

// Load express routes
const apiRoutes = require('../routes');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiRoutes);

async function runRbacVerification() {
  console.log('===============================================================');
  console.log('STARTING PAYMENT GATEWAY & EMAIL DELIVERY RBAC VERIFICATION');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // Spin up test server on an ephemeral port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/saas-admin`;

  const createdRoleIds = [];
  const createdUserIds = [];

  try {
    // -------------------------------------------------------------
    // TEST 1: SaasRoleModel Normalization & Permission Check
    // -------------------------------------------------------------
    console.log('TEST 1: SaasRoleModel.checkPermission Unit Logic');

    // Super Admin role (id=1)
    const superViewPay = await SaasRoleModel.checkPermission(1, 'payment_gateway', 'can_view');
    const superEditPay = await SaasRoleModel.checkPermission(1, 'payment_gateway.update');
    const superViewEmail = await SaasRoleModel.checkPermission(1, 'email_delivery.view');
    const superEditEmail = await SaasRoleModel.checkPermission(1, 'email_delivery.update');

    assert(superViewPay === true, 'Super Admin has payment_gateway.view');
    assert(superEditPay === true, 'Super Admin has payment_gateway.update (dot notation)');
    assert(superViewEmail === true, 'Super Admin has email_delivery.view (dot notation)');
    assert(superEditEmail === true, 'Super Admin has email_delivery.update (dot notation)');

    // -------------------------------------------------------------
    // TEST 2: Unauthenticated Access Enforcement (HTTP 401)
    // -------------------------------------------------------------
    console.log('\nTEST 2: Unauthenticated Access Protection (HTTP 401)');

    const unauthRazorpay = await fetch(`${baseUrl}/settings/razorpay`);
    assert(unauthRazorpay.status === 401, 'GET /settings/razorpay returns 401 without token');

    const unauthEmail = await fetch(`${baseUrl}/settings/email`);
    assert(unauthEmail.status === 401, 'GET /settings/email returns 401 without token');

    const unauthPayGate = await fetch(`${baseUrl}/settings/payment-gateway`);
    assert(unauthPayGate.status === 401, 'GET /settings/payment-gateway returns 401 without token');

    const unauthEmailDel = await fetch(`${baseUrl}/settings/email-delivery`);
    assert(unauthEmailDel.status === 401, 'GET /settings/email-delivery returns 401 without token');

    // -------------------------------------------------------------
    // TEST 3: Super Admin Access & Credential Masking
    // -------------------------------------------------------------
    console.log('\nTEST 3: Super Admin Access & Credential Masking');

    // Get an existing superadmin user
    const [superUsers] = await pool.query("SELECT id, email FROM saas_admin_users WHERE role = 'superadmin' AND status = 1 LIMIT 1");
    if (superUsers.length === 0) {
      throw new Error('No active superadmin user found in saas_admin_users');
    }
    const superAdmin = superUsers[0];
    const superToken = generateToken({ userId: superAdmin.id, id: superAdmin.id, portalType: 'SaaSAdminPortal', role: 'superadmin' });

    const superResPay = await fetch(`${baseUrl}/settings/razorpay`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    assert(superResPay.status === 200, 'Super Admin GET /settings/razorpay returns 200');
    const payData = await superResPay.json();
    if (payData.data && payData.data.key_secret) {
      assert(payData.data.key_secret.includes('••••') || payData.data.is_masked === true, 'Razorpay key_secret is masked in response');
    }

    const superResEmail = await fetch(`${baseUrl}/settings/email`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    assert(superResEmail.status === 200, 'Super Admin GET /settings/email returns 200');

    // -------------------------------------------------------------
    // TEST 4: View-Only Payment Gateway Role (Cross-Module & Mutation Guard)
    // -------------------------------------------------------------
    console.log('\nTEST 4: Role with ONLY Payment Gateway View Permission');

    // Create custom role with ONLY payment_gateway view
    const [rolePayRes] = await pool.query(
      `INSERT INTO saas_roles (role_name, slug, is_system, status, created_at, updated_at) 
       VALUES ('Test PG View Only', 'test_pg_view_only', 0, 1, NOW(), NOW())`
    );
    const rolePayId = rolePayRes.insertId;
    createdRoleIds.push(rolePayId);

    // Give payment_gateway can_view=1, others=0
    await pool.query(
      `INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage, created_at, updated_at)
       VALUES (?, 'payment_gateway', 1, 0, 0, 0, 0, NOW(), NOW())`,
      [rolePayId]
    );

    // Create subadmin user linked to rolePayId
    const [userPayRes] = await pool.query(
      `INSERT INTO saas_admin_users (first_name, last_name, email, role, role_id, status, created_at, updated_at)
       VALUES ('PGView', 'Tester', 'test_pg_view@growvidya.test', 'subadmin', ?, 1, NOW(), NOW())`,
      [rolePayId]
    );
    const userPayId = userPayRes.insertId;
    createdUserIds.push(userPayId);

    const userPayToken = generateToken({ userId: userPayId, id: userPayId, portalType: 'SaaSAdminPortal', role: 'subadmin' });

    // 4a. Can view Payment Gateway
    const pgGetRes = await fetch(`${baseUrl}/settings/razorpay`, {
      headers: { Authorization: `Bearer ${userPayToken}` },
    });
    assert(pgGetRes.status === 200, 'View-Only PG role GET /settings/razorpay returns 200');

    // 4b. CANNOT mutate Payment Gateway (Update/Delete) -> 403
    const pgPostRes = await fetch(`${baseUrl}/settings/razorpay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userPayToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: 'rzp_test_123', key_secret: 'dummy_secret' }),
    });
    assert(pgPostRes.status === 403, 'View-Only PG role POST /settings/razorpay returns 403 Forbidden');

    const pgPutStatusRes = await fetch(`${baseUrl}/settings/razorpay/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userPayToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 1 }),
    });
    assert(pgPutStatusRes.status === 403, 'View-Only PG role PUT /settings/razorpay/status returns 403 Forbidden');

    const pgDeleteRes = await fetch(`${baseUrl}/settings/razorpay/999`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userPayToken}` },
    });
    assert(pgDeleteRes.status === 403, 'View-Only PG role DELETE /settings/razorpay/999 returns 403 Forbidden');

    // 4c. Cross-Module Isolation: CANNOT view Email Settings -> 403
    const crossEmailRes = await fetch(`${baseUrl}/settings/email`, {
      headers: { Authorization: `Bearer ${userPayToken}` },
    });
    assert(crossEmailRes.status === 403, 'View-Only PG role GET /settings/email returns 403 (Cross-Module Isolation)');

    // -------------------------------------------------------------
    // TEST 5: View-Only Email Delivery Role (Cross-Module & Mutation Guard)
    // -------------------------------------------------------------
    console.log('\nTEST 5: Role with ONLY Email Delivery View Permission');

    const [roleEmailRes] = await pool.query(
      `INSERT INTO saas_roles (role_name, slug, is_system, status, created_at, updated_at) 
       VALUES ('Test Email View Only', 'test_email_view_only', 0, 1, NOW(), NOW())`
    );
    const roleEmailId = roleEmailRes.insertId;
    createdRoleIds.push(roleEmailId);

    // Give email_delivery can_view=1, others=0
    await pool.query(
      `INSERT INTO saas_role_permissions (role_id, module_key, can_view, can_add, can_edit, can_delete, can_manage, created_at, updated_at)
       VALUES (?, 'email_delivery', 1, 0, 0, 0, 0, NOW(), NOW())`,
      [roleEmailId]
    );

    const [userEmailRes] = await pool.query(
      `INSERT INTO saas_admin_users (first_name, last_name, email, role, role_id, status, created_at, updated_at)
       VALUES ('EmailView', 'Tester', 'test_email_view@growvidya.test', 'subadmin', ?, 1, NOW(), NOW())`,
      [roleEmailId]
    );
    const userEmailId = userEmailRes.insertId;
    createdUserIds.push(userEmailId);

    const userEmailToken = generateToken({ userId: userEmailId, id: userEmailId, portalType: 'SaaSAdminPortal', role: 'subadmin' });

    // 5a. Can view Email Settings
    const emailGetRes = await fetch(`${baseUrl}/settings/email`, {
      headers: { Authorization: `Bearer ${userEmailToken}` },
    });
    assert(emailGetRes.status === 200, 'View-Only Email role GET /settings/email returns 200');

    // 5b. CANNOT mutate Email Settings -> 403
    const emailPostRes = await fetch(`${baseUrl}/settings/email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userEmailToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailer_type: 'smtp' }),
    });
    assert(emailPostRes.status === 403, 'View-Only Email role POST /settings/email returns 403 Forbidden');

    const emailTestRes = await fetch(`${baseUrl}/settings/email/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userEmailToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_email: 'test@growvidya.test' }),
    });
    assert(emailTestRes.status === 403, 'View-Only Email role POST /settings/email/test returns 403 Forbidden');

    // 5c. Cross-Module Isolation: CANNOT view Payment Gateway -> 403
    const crossPgRes = await fetch(`${baseUrl}/settings/razorpay`, {
      headers: { Authorization: `Bearer ${userEmailToken}` },
    });
    assert(crossPgRes.status === 403, 'View-Only Email role GET /settings/razorpay returns 403 (Cross-Module Isolation)');

    // -------------------------------------------------------------
    // TEST 6: Role with Full Email Delivery (View + Update), but NO Payment Gateway
    // -------------------------------------------------------------
    console.log('\nTEST 6: Role with Full Email Delivery Permissions');

    // Update roleEmailId to have can_edit=1
    await pool.query(
      `UPDATE saas_role_permissions SET can_edit = 1 WHERE role_id = ? AND module_key = 'email_delivery'`,
      [roleEmailId]
    );

    // Can test email? (Should pass permission check; returns 400 or 500 or 200 from controller, NOT 403 Forbidden)
    const emailEditTestRes = await fetch(`${baseUrl}/settings/email/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userEmailToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_email: 'invalid-email-format' }),
    });
    assert(emailEditTestRes.status !== 403, 'Updated Email role can call POST /settings/email/test (status: ' + emailEditTestRes.status + ' != 403)');

    // Still CANNOT view or edit Razorpay
    const emailToPgRes = await fetch(`${baseUrl}/settings/razorpay`, {
      headers: { Authorization: `Bearer ${userEmailToken}` },
    });
    assert(emailToPgRes.status === 403, 'Full Email role still returns 403 on GET /settings/razorpay');

    console.log('\n===============================================================');
    console.log(`VERIFICATION COMPLETE: ${passed} passed, ${failed} failed`);
    console.log('===============================================================\n');

  } finally {
    // Clean up created test data
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM saas_admin_users WHERE id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
    }
    if (createdRoleIds.length > 0) {
      await pool.query(`DELETE FROM saas_role_permissions WHERE role_id IN (${createdRoleIds.map(() => '?').join(',')})`, createdRoleIds);
      await pool.query(`DELETE FROM saas_roles WHERE id IN (${createdRoleIds.map(() => '?').join(',')})`, createdRoleIds);
    }
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRbacVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
