# Growvidya SaaS Platform Master Admin - API Specification & Integration Guide

Welcome to the backend API reference for the standalone SaaS Admin Portal. This documentation covers all endpoints, data structures, authentication requirements, and sample requests/responses.

---

## 1. General Architecture & Base URLs

* **Base URL:** `http://localhost:5001/api/v1/saas-admin`
* **Alternative Route Prefix:** `http://localhost:5001/api/saas-admin`
* **Public School Onboarding & Pricing Base URL:** `http://localhost:5001/api/v1/saas`
* **Data Format:** `application/json` for both requests and responses.
* **CORS Configured Origins:** `http://localhost:5173` and `http://localhost:5174` (Credentials supported).

### Standard Response Envelope
All API responses follow a uniform structure:

**Success Response (HTTP 200 / 201):**
```json
{
  "success": true,
  "message": "Action completed successfully.",
  "data": { ... }
}
```

**Error Response (HTTP 400 / 401 / 403 / 404 / 500):**
```json
{
  "success": false,
  "message": "Human-readable error description",
  "errors": null
}
```

---

## 2. Authentication & Authorization

All SaaS Admin endpoints (except `POST /login` and `POST /validate-coupon`) require a valid JWT session token.

### Header Requirement:
```http
Authorization: Bearer <JWT_TOKEN>
```
*(Alternatively, browser cookies `saas_admin_token` or `growvidya_saas_admin_session` are automatically set upon login with `httpOnly: true`).*

### Superadmin Default Credentials (Pre-seeded):
* **Email:** `superadmin@growvidya.com`
* **Password:** `Admin@1234`
* **Role:** `superadmin`

---

## 3. Endpoints Reference

### 3.1 Authentication & Profile

#### 1. Admin Login
* **Method & Path:** `POST /api/v1/saas-admin/login`
* **Access:** Public
* **Request Body:**
```json
{
  "email": "superadmin@growvidya.com",
  "password": "Admin@1234"
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "first_name": "Super",
      "last_name": "Administrator",
      "gender": "male",
      "profile_image": "upload/admin/profile_pic/admin_avatar.png",
      "phone_number": "9876543210",
      "email": "superadmin@growvidya.com",
      "role": "superadmin",
      "status": 1
    }
  }
}
```

#### 2. Get Current Authenticated Profile
* **Method & Path:** `GET /api/v1/saas-admin/profile`
* **Access:** Protected (`Bearer <token>`)
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Profile fetched successfully.",
  "data": {
    "id": 1,
    "first_name": "Super",
    "last_name": "Administrator",
    "gender": "male",
    "profile_image": "upload/admin/profile_pic/admin_avatar.png",
    "phone_number": "9876543210",
    "email": "superadmin@growvidya.com",
    "role": "superadmin",
    "status": 1,
    "created_at": "2026-09-23 14:42:38",
    "updated_at": "2026-09-23 18:46:08"
  }
}
```

#### 3. Update Admin Profile
* **Method & Path:** `PUT /api/v1/saas-admin/profile`
* **Access:** Protected (`Bearer <token>`)
* **Request Body:**
```json
{
  "first_name": "Super",
  "last_name": "Administrator",
  "gender": "male", // "male" | "female" | "other"
  "phone_number": "9876543210",
  "profile_image": "data:image/png;base64,iVBORw0KGgo...", // Base64 data string (auto-saved to disk) or URL
  "email": "superadmin@growvidya.com",
  "password": "NewSecurePassword123" // Optional: only if changing password
}
```
* **Success Response (200 OK):** Returns the updated profile object.

#### 4. Logout
* **Method & Path:** `POST /api/v1/saas-admin/logout`
* **Access:** Protected (`Bearer <token>`)
* **Success Response (200 OK):** Clears session cookies.

---

### 3.2 Dashboard & Analytics

#### 1. Get Dashboard Metrics & Insights
* **Method & Path:** `GET /api/v1/saas-admin/dashboard/stats`
* **Access:** Protected
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Dashboard statistics fetched successfully.",
  "data": {
    "schools": {
      "total": 5,
      "active": 5,
      "inactive": 0
    },
    "subscriptions": {
      "total": 7,
      "active": 2,
      "trial": 2,
      "expired": 3,
      "pendingPayments": 0,
      "totalRevenue": 11997.00
    },
    "packages": {
      "total": 4,
      "active": 4
    },
    "coupons": {
      "total": 2,
      "active": 2
    },
    "recentSchools": [
      {
        "id": 5,
        "school_name": "Delhi Public School",
        "school_code": "DPS-1001",
        "email": "admin@dps.edu.in",
        "phone_number": "9876543210",
        "status": 1,
        "subscription_status": "active",
        "payment_status": "completed",
        "plan_name": "Enterprise Plan"
      }
    ],
    "pendingSubscriptions": []
  }
}
```

---

### 3.3 School Management

#### 1. List All Schools (with Filters & Pagination)
* **Method & Path:** `GET /api/v1/saas-admin/schools`
* **Access:** Protected
* **Query Parameters:**
  * `search` *(string, optional)*: Filter by school name, code, email, or phone.
  * `status` *(number, optional)*: `1` (Active), `0` (Inactive), or omit / `'all'`.
  * `subscriptionStatus` *(string, optional)*: `'active'`, `'trial'`, `'expired'`, `'suspended'`.
  * `page` *(number, optional, default: 1)*
  * `limit` *(number, optional, default: 10)*
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Schools retrieved successfully.",
  "data": {
    "schools": [
      {
        "id": 1,
        "school_name": "Apex International School",
        "school_code": "APEX-2024",
        "email": "contact@apexschool.com",
        "phone_number": "9876543210",
        "address": "123 Knowledge Park",
        "status": 1,
        "student_count": 450,
        "teacher_count": 28,
        "branch_count": 2,
        "subscription_status": "active",
        "payment_status": "completed",
        "plan_name": "Growth Plan",
        "subscription_start": "2026-01-01",
        "subscription_end": "2027-01-01"
      }
    ],
    "pagination": {
      "total": 5,
      "page": 1,
      "limit": 10,
      "totalPages": 1
    }
  }
}
```

#### 2. Get Single School Full Details
* **Method & Path:** `GET /api/v1/saas-admin/schools/:id`
* **Access:** Protected
* **Success Response (200 OK):**
  * Contains school info, admin account user, branch list, and complete subscription history with payment details and verified admin names.

#### 3. Activate / Deactivate School Status
* **Method & Path:** `PATCH /api/v1/saas-admin/schools/:id/status`
* **Access:** Protected
* **Request Body:**
```json
{
  "status": 0 // 1 for Active, 0 for Inactive / Suspended
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "School status successfully updated to Inactive."
}
```

#### 4. Update School Details
* **Method & Path:** `PUT /api/v1/saas-admin/schools/:id`
* **Access:** Protected
* **Request Body:**
```json
{
  "school_name": "Apex International Academy",
  "phone_number": "9123456780",
  "email": "admin@apex.edu",
  "website": "https://apex.edu",
  "address": "456 Learning Blvd",
  "postal_code": "700001",
  "status": 1
}
```

---

### 3.4 School Subscription & Payment Verification

#### 1. List Subscriptions
* **Method & Path:** `GET /api/v1/saas-admin/subscriptions`
* **Access:** Protected
* **Query Parameters:**
  * `search` *(string, optional)*: Search by school name, school code, transaction ID, or coupon code.
  * `status` *(string, optional)*: `'trial'`, `'active'`, `'expired'`, `'suspended'`.
  * `paymentStatus` *(string, optional)*: `'completed'`, `'pending'`, `'failed'`.
  * `planId` *(number, optional)*
  * `page` *(number, optional, default: 1)*
  * `limit` *(number, optional, default: 10)*

#### 2. Get Subscription Details
* **Method & Path:** `GET /api/v1/saas-admin/subscriptions/:id`
* **Access:** Protected

#### 3. Verify School Payment / Subscription Status
* **Method & Path:** `POST /api/v1/saas-admin/subscriptions/:id/verify`
* **Access:** Protected
* **Description:** Used by SaaS Admin to approve or reject a school's payment transaction. If verified as `paymentStatus: "completed"` and `status: "active"`, it automatically activates the school's account (`status = 1` in `school_master`).
* **Request Body:**
```json
{
  "paymentStatus": "completed", // "completed", "pending", or "failed"
  "status": "active", // "active", "suspended", "trial", "expired"
  "verificationNotes": "Payment verified via bank transfer NEFT ref #982341",
  "startDate": "2026-09-23", // Optional: override start date
  "endDate": "2027-09-23"    // Optional: override expiry date
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Subscription payment verification updated successfully.",
  "data": { ... }
}
```

#### 4. Update Subscription Status Directly
* **Method & Path:** `PATCH /api/v1/saas-admin/subscriptions/:id/status`
* **Access:** Protected
* **Request Body:**
```json
{
  "status": "suspended" // "trial" | "active" | "expired" | "suspended"
}
```

#### 5. Extend Subscription Expiry Date
* **Method & Path:** `POST /api/v1/saas-admin/subscriptions/:id/extend`
* **Access:** Protected
* **Request Body:**
```json
{
  "endDate": "2027-12-31",
  "notes": "Complimentary 3-month extension approved by management."
}
```

---

### 3.5 Package Management

#### 1. List All Packages / Plans
* **Method & Path:** `GET /api/v1/saas-admin/packages`
* **Access:** Protected
* **Query Parameters:**
  * `search` *(string, optional)*: Filter by plan name or plan code.
  * `status` *(number, optional)*: `1` (Active) or `0` (Inactive).
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Subscription packages retrieved successfully.",
  "data": [
    {
      "id": 1,
      "plan_name": "Starter Plan",
      "plan_code": "starter_annual",
      "description": "Essential features for small schools",
      "price": "2999.00",
      "billing_cycle": "annual",
      "max_students": 250,
      "max_teachers": 25,
      "features_json": ["Student Management", "Fee Collection", "Attendance"],
      "status": 1,
      "subscriber_count": 3
    }
  ]
}
```

#### 2. Get Single Package
* **Method & Path:** `GET /api/v1/saas-admin/packages/:id`
* **Access:** Protected

#### 3. Create New Package
* **Method & Path:** `POST /api/v1/saas-admin/packages`
* **Access:** Protected
* **Request Body:**
```json
{
  "plan_name": "Premium Pro Plan",
  "plan_code": "premium_pro", // Optional: auto-generated from plan_name if omitted
  "description": "Full-fledged suite for large educational groups",
  "price": 12999.00,
  "billing_cycle": "annual", // "monthly" | "annual" | "trial"
  "max_students": 2000,
  "max_teachers": 150,
  "features_json": [
    "Student & Staff Management",
    "Fee Invoicing & Payment Gateway",
    "Exams & Report Cards",
    "Hostel & Transport",
    "Mobile Apps Access"
  ],
  "status": 1
}
```
* **Success Response (201 Created):** Returns the newly created package with ID.

#### 4. Update Package
* **Method & Path:** `PUT /api/v1/saas-admin/packages/:id`
* **Access:** Protected
* **Request Body:** Accepts any subset of package fields (`plan_name`, `price`, `description`, `features_json`, `status`, etc.).

#### 5. Delete Package
* **Method & Path:** `DELETE /api/v1/saas-admin/packages/:id`
* **Access:** Protected
* **Behavior:**
  * If the plan is currently linked to any existing school subscription, the server automatically executes a **safe soft-delete** (`status = 0`) to preserve foreign key integrity and reports: *"Package is in use by schools and has been deactivated (soft-deleted)."*
  * If the plan is not in use, it is hard-deleted.

#### 6. Toggle Package Active/Inactive Status
* **Method & Path:** `PATCH /api/v1/saas-admin/packages/:id/status`
* **Access:** Protected
* **Request Body:**
```json
{
  "status": 1 // 1 for active, 0 for inactive
}
```

---

### 3.6 Coupon Management

#### 1. List All Coupons
* **Method & Path:** `GET /api/v1/saas-admin/coupons`
* **Access:** Protected
* **Query Parameters:**
  * `search` *(string, optional)*: Filter by code or description.
  * `status` *(number, optional)*: `1` or `0`.
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Coupons retrieved successfully.",
  "data": [
    {
      "id": 1,
      "code": "WELCOME50",
      "description": "50% discount on first school registration",
      "discount_type": "percentage",
      "discount_value": "50.00",
      "min_order_amount": "0.00",
      "max_discount_amount": "5000.00",
      "start_date": "2026-01-01",
      "end_date": "2026-12-31",
      "max_uses": 100,
      "used_count": 4,
      "status": 1,
      "total_redemptions": 4,
      "total_discount_given": "18000.00"
    }
  ]
}
```

#### 2. Get Coupon Details & Usage History
* **Method & Path:** `GET /api/v1/saas-admin/coupons/:id` or `GET /api/v1/coupons/:id`
* **Access:** Protected (Requires `Authorization: Bearer <token>` or session cookie)
* **Identifier Parameter:** Supports passing the coupon ID in the path `/coupons/:id`, or as a query parameter `?id=1` / `?coupon_id=1`, or using the coupon promo code (e.g. `/coupons/WELCOME50`).
* **Response:** Returns only the data and redemption history for the specified coupon.

#### 3. Create Coupon
* **Method & Path:** `POST /api/v1/saas-admin/coupons`
* **Access:** Protected
* **Request Body:**
```json
{
  "code": "DIWALI30",
  "description": "Festival 30% off for new schools",
  "discount_type": "percentage", // "percentage" or "fixed"
  "discount_value": 30.00,
  "min_order_amount": 5000.00, // Optional minimum plan price
  "max_discount_amount": 3000.00, // Optional maximum discount cap for percentage discounts
  "start_date": "2026-10-01", // Optional
  "end_date": "2026-11-15",   // Optional
  "max_uses": 50,             // Optional redemption limit
  "status": 1
}
```
* **Success Response (201 Created):** Returns created coupon.

#### 4. Update Coupon
* **Method & Path:** `PUT /api/v1/saas-admin/coupons/:id`
* **Access:** Protected
* **Request Body:** Accepts any subset of coupon properties.

#### 5. Delete Coupon
* **Method & Path:** `DELETE /api/v1/saas-admin/coupons/:id`
* **Access:** Protected

#### 6. Toggle Coupon Active Status
* **Method & Path:** `PATCH /api/v1/saas-admin/coupons/:id/status`
* **Access:** Protected
* **Request Body:** `{"status": 1}` or `{"status": 0}`

---

### 3.7 Coupon Validation Engine (For Checkout & Testing)

Both the SaaS Admin Portal and the School Registration / Checkout interface can test and apply coupons.

#### Admin Testing Endpoint:
* **Method & Path:** `POST /api/v1/saas-admin/validate-coupon`
* **Access:** Public or Protected

#### School Checkout Endpoint (Public):
* **Method & Path:** `POST /api/v1/saas/validate-coupon`
* **Access:** Public (No auth required)

#### Request Body:
```json
{
  "code": "WELCOME50",
  "amount": 9999.00
}
```

#### Success Response (200 OK):
```json
{
  "success": true,
  "message": "Coupon applied successfully!",
  "data": {
    "id": 1,
    "code": "WELCOME50",
    "description": "50% discount on first school registration",
    "discountType": "percentage",
    "discountValue": 50,
    "discountAmount": 4999.50,
    "originalAmount": 9999,
    "finalAmount": 4999.50
  }
}
```

#### Error Response (e.g. expired, inactive, min order not met) (400 Bad Request):
```json
{
  "success": false,
  "message": "Minimum package amount of ₹5000.00 is required to use this coupon.",
  "errors": null
}
```

### 3.8 Storage Master Plan Management

#### 1. List All Storage Plans
* **Method & Path:** `GET /api/v1/saas-admin/storage-plans` (or `GET /api/v1/storage-plans`)
* **Access:** Protected (Admin) / Direct
* **Query Parameters:** `?search=...` & `?status=1|0`
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Storage plans retrieved successfully.",
  "data": [
    {
      "id": 1,
      "plan_name": "50 GB Plan",
      "storage_capacity": 50,
      "capacity_unit_id": 2,
      "unit_code": "GB",
      "unit_name": "Gigabyte",
      "factor_in_mb": 1024,
      "total_capacity_mb": 51200,
      "monthly_price": "299.00",
      "annual_price": "2999.00",
      "description": "50 GB additional cloud storage for documents, backups, and multimedia",
      "status": 1,
      "created_at": "2026-09-24T09:36:59.000Z",
      "updated_at": "2026-09-24T09:36:59.000Z"
    }
  ]
}
```

#### 2. Get Available Capacity Units (For Dropdowns)
* **Method & Path:** `GET /api/v1/saas-admin/capacity-units` (or `GET /api/v1/storage-plans/units`)
* **Access:** Public / Admin
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Capacity units retrieved successfully.",
  "data": [
    { "id": 1, "unit_name": "Megabyte", "unit_code": "MB", "factor_in_mb": 1, "status": 1 },
    { "id": 2, "unit_name": "Gigabyte", "unit_code": "GB", "factor_in_mb": 1024, "status": 1 },
    { "id": 3, "unit_name": "Terabyte", "unit_code": "TB", "factor_in_mb": 1048576, "status": 1 }
  ]
}
```

#### 3. Get Public / Active Storage Plans (For Schools)
* **Method & Path:** `GET /api/v1/saas/storage-plans` (or `GET /api/v1/storage-plans/active`)
* **Access:** Public

#### 4. Get Single Storage Plan
* **Method & Path:** `GET /api/v1/saas-admin/storage-plans/:id` (or `GET /api/v1/storage-plans/:id`)
* **Access:** Protected (Admin) / Direct

#### 5. Create New Storage Plan
* **Method & Path:** `POST /api/v1/saas-admin/storage-plans` (or `POST /api/v1/storage-plans`)
* **Access:** Protected (Admin)
* **Request Body:**
```json
{
  "plan_name": "250 GB Plan",
  "storage_capacity": 250,
  "capacity_unit_id": 2,
  "monthly_price": 999.00,
  "annual_price": 9999.00,
  "description": "250 GB expanded cloud storage for large institutions",
  "status": 1
}
```
*(Note: `capacity_unit` code e.g. `"GB"` is also accepted as a convenience fallback).*

#### 5. Update Storage Plan
* **Method & Path:** `PUT /api/v1/saas-admin/storage-plans/:id` (or `PUT /api/v1/storage-plans/:id`)
* **Access:** Protected (Admin)
* **Request Body:** Pass any field(s) to update.

#### 6. Toggle Status (Active / Inactive)
* **Method & Path:** `PATCH /api/v1/saas-admin/storage-plans/:id/status` (or `PATCH /api/v1/storage-plans/:id/status`)
* **Access:** Protected (Admin)
* **Request Body:**
```json
{
  "status": 0
}
```

#### 7. Delete Storage Plan
* **Method & Path:** `DELETE /api/v1/saas-admin/storage-plans/:id` (or `DELETE /api/v1/storage-plans/:id`)
* **Access:** Protected (Admin)

---

## 4. Integration with School Registration & Razorpay

When a new school registers and pays using a coupon:
1. **Frontend calls** `POST /api/v1/saas/validate-coupon` to verify code and get `final_price` and `discount_amount`.
2. **Frontend creates Razorpay Order** via `POST /api/v1/saas/create-order` passing `{ "plan_id": 2, "coupon_code": "WELCOME50" }`. The server automatically calculates the discounted amount in paise and initiates the Razorpay order.
3. **Frontend registers the school** via `POST /api/v1/saas/register-school` including:
```json
{
  "plan_id": 2,
  "coupon_code": "WELCOME50",
  "school": { ... },
  "admin": { ... },
  "razorpay_order_id": "...",
  "razorpay_payment_id": "...",
  "razorpay_signature": "..."
}
```
The server automatically stores `coupon_id`, `original_amount`, and `discount_amount` in `school_subscriptions`, records an entry in `coupon_usages`, and increments `coupons.used_count`.

---

## 5. Summary Checklist for the Client Developer

| Feature | Routes to Consume |
|---|---|
| **Login & Logout** | `POST /login`, `GET /profile`, `POST /logout` |
| **Profile Management** | `GET /profile`, `PUT /profile` |
| **Dashboard** | `GET /dashboard/stats` |
| **Schools Directory** | `GET /schools`, `GET /schools/:id` |
| **Activate / Deactivate School** | `PATCH /schools/:id/status` |
| **Edit School Info** | `PUT /schools/:id` |
| **Subscriptions & Payment Verification** | `GET /subscriptions`, `GET /subscriptions/:id`, `POST /subscriptions/:id/verify`, `PATCH /subscriptions/:id/status`, `POST /subscriptions/:id/extend` |
| **Package Management (CRUD)** | `GET /packages`, `POST /packages`, `PUT /packages/:id`, `DELETE /packages/:id`, `PATCH /packages/:id/status` |
| **Coupon Management (CRUD)** | `GET /coupons`, `POST /coupons`, `PUT /coupons/:id`, `DELETE /coupons/:id`, `PATCH /coupons/:id/status` |
| **Coupon Validation** | `POST /validate-coupon` |
| **Storage Plan Management (CRUD)** | `GET /storage-plans`, `POST /storage-plans`, `PUT /storage-plans/:id`, `DELETE /storage-plans/:id`, `PATCH /storage-plans/:id/status` |

All endpoints have been tested against the live MySQL database and are ready for frontend integration.
