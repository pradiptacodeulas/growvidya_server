# Growvidya Server API Endpoints Documentation

This document lists all REST API endpoints implemented in the `growvidya-server` backend, along with their HTTP methods, route paths, authentication requirements (Bearer Token), request parameters, and request payload schemas.

---

## Base Server Information

- **Base URL**: `http://localhost:5000/api/v1`
- **Health Check URL**: `http://localhost:5000/api/health`
- **Authentication Standards (Dual Hybrid Support)**:
  1. **Mobile Applications / External REST API**: HTTP `Authorization` Header
     ```http
     Authorization: Bearer <YOUR_JWT_ACCESS_TOKEN>
     ```
  2. **Web Browser Applications**: HTTP-Only True Session Cookie (`growvidya_session` or `token`)
     - Generated automatically on `POST /api/v1/admin/auth/login` as a **Browser Session Cookie** (`Expires/Max-Age: Session`).
     - **Session Lifecycle**: The session only persists while the browser session/window is open. Once the user closes the browser session, the cookie is automatically discarded, requiring a fresh login upon reopening.
     - Automatically attached by browsers on every request with `credentials: 'include'` (Fetch) or `withCredentials: true` (Axios)
     - Cleared explicitly on `POST /api/v1/admin/auth/logout`

---

## Summary of Endpoint Groups

| Module | Base Path | Auth Required |
| :--- | :--- | :---: |
| **System Health** | `/api/health` | No |
| **Admin Authentication** | `/api/v1/admin/auth` | Mixed |
| **Admin Dashboard** | `/api/v1/admin/dashboard` | Yes |
| **Academic Management** | `/api/v1/admin/academics` | Yes |
| **Teacher Management** | `/api/v1/admin/teachers` | Yes |
| **Student Management** | `/api/v1/admin/students` | Yes |
| **Parent Management** | `/api/v1/admin/parents` | Yes |
| **Attendance Management** | `/api/v1/admin/attendance` | Yes |
| **Leaves Management** | `/api/v1/admin/leaves` | Yes |
| **Transport Management** | `/api/v1/admin/transport` | Yes |
| **Roles & Permissions (RBAC)** | `/api/v1/admin/permissions` | Yes |

---

## 1. System Health

### `GET /api/health`
- **Description**: Returns server status and health check information.
- **Bearer Token**: Not Required (Public)
- **Request Payload**: None
- **Response Example**:
  ```json
  {
    "success": true,
    "message": "Growvidya REST API Server is online and healthy.",
    "data": {
      "timestamp": "2026-08-13T15:30:00.000Z",
      "environment": "development"
    }
  }
  ```

---

## 2. Admin Authentication (`/api/v1/admin/auth`)

### `POST /api/v1/admin/auth/login`
- **Description**: Authenticate Admin/Super Admin user and receive JWT access token.
- **Bearer Token**: Not Required (Public)
- **Request Body Payload**:
  ```json
  {
    "email": "admin@growvidya.com",
    "password": "yourPassword123"
  }
  ```
- **Required Fields**: `email`, `password`

### `GET /api/v1/admin/auth/me`
- **Description**: Get profile information of the currently authenticated admin user.
- **Bearer Token**: Required (`Authorization: Bearer <token>`)
- **Allowed Roles**: `Super Admin`, `Admin`
- **Request Payload**: None

### `POST /api/v1/admin/auth/logout`
- **Description**: Logout admin user (invalidates client session).
- **Bearer Token**: Required (`Authorization: Bearer <token>`)
- **Request Payload**: None

---

## 3. Admin Dashboard (`/api/v1/admin/dashboard`)

### `GET /api/v1/admin/dashboard/stats`
- **Description**: Get overview statistics (counts for active students, teachers, classes, sections, etc.).
- **Bearer Token**: Required (`Authorization: Bearer <token>`)
- **Allowed Roles**: `Super Admin`, `Admin`
- **Request Payload**: None

---

## 4. Academic Management (`/api/v1/admin/academics`)

*All routes in this module require `Authorization: Bearer <token>` and `Super Admin` or `Admin` role.*

### Overview

#### `GET /api/v1/admin/academics/overview`
- **Description**: Retrieve all academic master records (years, classes, sections, subjects, shifts, houses, periods) in a single request.
- **Bearer Token**: Required
- **Request Payload**: None

---

### Academic Years

#### `GET /api/v1/admin/academics/years`
- **Description**: Fetch all academic years.
- **Bearer Token**: Required
- **Request Payload**: None

#### `POST /api/v1/admin/academics/years`
- **Description**: Create a new academic year.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "name": "2025-2026",
    "start_date": "2025-04-01",
    "end_date": "2026-03-31",
    "status": 1
  }
  ```
- **Required Fields**: `name`, `start_date`, `end_date`

#### `PUT /api/v1/admin/academics/years/:id`
- **Description**: Update an existing academic year by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "name": "2025-2026",
    "start_date": "2025-04-01",
    "end_date": "2026-03-31",
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/years/:id`
- **Description**: Delete an academic year by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Payload**: None

---

### Classes

#### `GET /api/v1/admin/academics/classes`
- **Description**: Fetch all active classes.
- **Bearer Token**: Required
- **Request Payload**: None

#### `POST /api/v1/admin/academics/classes`
- **Description**: Create a new class.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "class_name": "Class 10",
    "shift_id": 1,
    "sort_order": 10,
    "status": 1
  }
  ```
- **Required Fields**: `class_name`

#### `PUT /api/v1/admin/academics/classes/:id`
- **Description**: Update class details by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "class_name": "Class 10",
    "shift_id": 1,
    "sort_order": 10,
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/classes/:id`
- **Description**: Delete (soft delete status=4) a class by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Payload**: None

---

### Sections

#### `GET /api/v1/admin/academics/sections`
- **Description**: Fetch all active sections (optionally filtered by class).
- **Bearer Token**: Required
- **Query Params**: `classId` or `class_id` (Optional)

#### `GET /api/v1/admin/academics/sections/:classId`
- **Description**: Fetch active sections for a specific class ID.
- **Bearer Token**: Required
- **Request URL Params**: `classId` (integer)

#### `POST /api/v1/admin/academics/sections/by-class`
- **Description**: Fetch sections by class ID passed in request body.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "class_id": 1
  }
  ```

#### `POST /api/v1/admin/academics/sections`
- **Description**: Create a new section under a class.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "class_id": 1,
    "section_name": "Section A",
    "capacity": 40,
    "note": "Primary section",
    "sort_order": 1,
    "status": 1
  }
  ```
- **Required Fields**: `class_id`, `section_name`

#### `PUT /api/v1/admin/academics/sections/:id`
- **Description**: Update an existing section by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "class_id": 1,
    "section_name": "Section A",
    "capacity": 45,
    "note": "Updated section capacity",
    "sort_order": 1,
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/sections/:id`
- **Description**: Delete (soft delete status=4) a section by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Payload**: None

---

### Subjects

#### `GET /api/v1/admin/academics/subjects`
- **Description**: Fetch all active subjects.
- **Bearer Token**: Required
- **Request Payload**: None

#### `POST /api/v1/admin/academics/subjects`
- **Description**: Create a new subject.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "subject_name": "Mathematics",
    "subject_code": "MATH101",
    "type": "Theory",
    "status": 1
  }
  ```
- **Required Fields**: `subject_name`

#### `PUT /api/v1/admin/academics/subjects/:id`
- **Description**: Update a subject by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "subject_name": "Advanced Mathematics",
    "subject_code": "MATH102",
    "type": "Theory",
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/subjects/:id`
- **Description**: Delete (soft delete status=4) a subject by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Payload**: None

---

### Shifts

#### `GET /api/v1/admin/academics/shifts`
- **Description**: Fetch all shifts.
- **Bearer Token**: Required

#### `POST /api/v1/admin/academics/shifts`
- **Description**: Create a new shift.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "shift_name": "Morning Shift",
    "status": 1
  }
  ```
- **Required Fields**: `shift_name`

#### `PUT /api/v1/admin/academics/shifts/:id`
- **Description**: Update shift details.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "shift_name": "Evening Shift",
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/shifts/:id`
- **Description**: Delete a shift by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

---

### Houses

#### `GET /api/v1/admin/academics/houses`
- **Description**: Fetch all student houses.
- **Bearer Token**: Required

#### `POST /api/v1/admin/academics/houses`
- **Description**: Create a new house.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "house_name": "Red House",
    "status": 1
  }
  ```
- **Required Fields**: `house_name`

#### `PUT /api/v1/admin/academics/houses/:id`
- **Description**: Update house name or status by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "house_name": "Blue House",
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/houses/:id`
- **Description**: Delete a house record by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

---

### Periods

#### `GET /api/v1/admin/academics/periods`
- **Description**: Fetch all periods.
- **Bearer Token**: Required

#### `POST /api/v1/admin/academics/periods`
- **Description**: Create a new class period.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "period_name": "Period 1",
    "start_time": "09:00:00",
    "end_time": "09:45:00",
    "status": 1
  }
  ```
- **Required Fields**: `period_name`

#### `PUT /api/v1/admin/academics/periods/:id`
- **Description**: Update period times or name by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "period_name": "Period 1",
    "start_time": "09:15:00",
    "end_time": "10:00:00",
    "status": 1
  }
  ```

#### `DELETE /api/v1/admin/academics/periods/:id`
- **Description**: Delete a period by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

---

## 5. Teacher Management (`/api/v1/admin/teachers`)

*All routes require `Authorization: Bearer <token>` and `Super Admin` or `Admin` role.*

### `GET /api/v1/admin/teachers`
- **Description**: Retrieve list of all teachers for the authenticated school.
- **Bearer Token**: Required
- **Request Payload**: None

### `GET /api/v1/admin/teachers/:id`
- **Description**: Get details of a single teacher by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

### `POST /api/v1/admin/teachers`
- **Description**: Register a new teacher.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "teacher_id": "TCH100200",
    "first_name": "Ramesh",
    "last_name": "Kumar",
    "email_address": "ramesh.kumar@school.com",
    "primary_contact_number": "9876543210",
    "class_id": 1,
    "section_id": 2,
    "subject_id": 3,
    "qualification": "M.Sc B.Ed",
    "gender": 1,
    "status": 1
  }
  ```
- **Required Fields**: `first_name`, `last_name`, `email_address`, `primary_contact_number`

### `PUT /api/v1/admin/teachers/:id`
- **Description**: Update teacher details by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "teacher_id": "TCH100200",
    "first_name": "Ramesh",
    "last_name": "Kumar",
    "email_address": "ramesh.kumar@school.com",
    "primary_contact_number": "9876543210",
    "class_id": 1,
    "section_id": 2,
    "subject_id": 3,
    "qualification": "Ph.D Mathematics",
    "status": 1
  }
  ```

### `DELETE /api/v1/admin/teachers/:id`
- **Description**: Delete a teacher record by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

---

## 6. Student Management (`/api/v1/admin/students`)

*All routes require `Authorization: Bearer <token>`.*

### `GET /api/v1/admin/students`
- **Description**: Fetch paginated & filtered list of students.
- **Bearer Token**: Required
- **Query Parameters**:
  - `search` (string): Search by student first/last name, admission number, roll number, or phone.
  - `classId` / `class` (integer): Filter by class ID.
  - `sectionId` / `section` (integer): Filter by section ID.
  - `status` (integer): `1` (Active), `2` (Inactive).
  - `admissionDate` / `date` (string): Filter by admission date (`YYYY-MM-DD`).
  - `page` (integer): Page number (default: 1).
  - `limit` (integer): Page size (default: 12).

### `POST /api/v1/admin/students/filter` & `POST /api/v1/admin/students/search`
- **Description**: Alternate endpoints for filtering/searching students using request body parameters.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "search": "Rahul",
    "classId": 1,
    "sectionId": 2,
    "status": 1,
    "admissionDate": "2025-04-01",
    "page": 1,
    "limit": 12
  }
  ```

### `GET /api/v1/admin/students/:id`
- **Description**: Fetch detailed student profile including parent/guardian details.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

### `POST /api/v1/admin/students`
- **Description**: Register a new student.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "first_name": "Aarav",
    "last_name": "Patel",
    "class_id": 1,
    "section_id": 2,
    "admission_number": "ADM2025001",
    "admission_date": "2025-04-01",
    "roll_number": "101",
    "gender": "Male",
    "date_of_birth": "2012-08-10",
    "primary_contact_number": "9876500000",
    "email_address": "aarav.patel@email.com",
    "blood_group": "B+",
    "picture": null
  }
  ```
- **Required Fields**: `first_name`, `class_id`

### `PUT /api/v1/admin/students/:id`
- **Description**: Update student record by ID.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "first_name": "Aarav",
    "last_name": "Patel",
    "class_id": 1,
    "section_id": 2,
    "roll_number": "101",
    "gender": "Male",
    "date_of_birth": "2012-08-10",
    "primary_contact_number": "9876500000",
    "email_address": "aarav.patel@email.com",
    "blood_group": "B+",
    "status": 1
  }
  ```
- **Required Fields**: `first_name`, `class_id`

### `DELETE /api/v1/admin/students/:id`
- **Description**: Soft delete student (sets `status = 0`).
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

---

## 7. Parent Management (`/api/v1/admin/parents`)

*All routes require `Authorization: Bearer <token>` and `Super Admin` or `Admin` role.*

### `GET /api/v1/admin/parents`
- **Description**: Fetch list of parent/guardian profiles with pagination & search filter.
- **Bearer Token**: Required
- **Query Parameters**:
  - `search` (string): Search by parent first name, last name, phone, or email.
  - `page` (integer): Page number (default: 1).
  - `limit` (integer): Page size (default: 12).

### `POST /api/v1/admin/parents/filter` & `POST /api/v1/admin/parents/search`
- **Description**: Alternate endpoints for filtering/searching parents using request body parameters.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "search": "Rajesh",
    "page": 1,
    "limit": 12
  }
  ```

### `GET /api/v1/admin/parents/:id`
- **Description**: Fetch detailed parent profile including linked student wards.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

### `POST /api/v1/admin/parents`
- **Description**: Register a new parent or guardian profile.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "first_name": "Rajesh",
    "last_name": "Sharma",
    "email": "rajesh.sharma@email.com",
    "phone": "9876543210",
    "occupation": "Business",
    "relation": "Father",
    "parent_type": 1,
    "status": 1
  }
  ```
- **Required Fields**: `first_name`

### `PUT /api/v1/admin/parents/:id`
- **Description**: Update parent or guardian profile details.
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)
- **Request Body Payload**:
  ```json
  {
    "first_name": "Rajesh",
    "last_name": "Sharma",
    "email": "rajesh.sharma@email.com",
    "phone": "9876543210",
    "occupation": "Senior Manager",
    "relation": "Father",
    "parent_type": 1,
    "status": 1
  }
  ```
- **Required Fields**: `first_name`

### `DELETE /api/v1/admin/parents/:id`
- **Description**: Soft delete parent profile (sets `status = 0`).
- **Bearer Token**: Required
- **Request URL Params**: `id` (integer)

### `POST /api/v1/admin/parents/link-student`
- **Description**: Link or update parent relationships (`father_id`, `mother_id`, `guardian_id`) for a student.
- **Bearer Token**: Required
- **Request Body Payload**:
  ```json
  {
    "student_id": 10,
    "father_id": 1,
    "mother_id": 2,
    "guardian_id": 1
  }
  ```
- **Required Fields**: `student_id`

---

## 8. Roles & Permissions RBAC (`/api/v1/admin/permissions`)

### `GET /api/v1/admin/permissions/roles`
- **Description**: List all user roles with active status and assigned user counts.
- **Bearer Token**: Required (`Super Admin`, `Admin`)
- **Response**: Array of roles from `role_master`.

### `GET /api/v1/admin/permissions/roles/:roleId`
- **Description**: Fetch role details and complete grouped module permission matrix with access flags (`add_access`, `view_access`, `edit_access`, `delete_access`).
- **Bearer Token**: Required (`Super Admin`, `Admin`)
- **Request URL Params**: `roleId` (integer)

### `GET /api/v1/admin/permissions/modules`
- **Description**: Fetch all available system modules grouped by section (Academic, Ward, Staff, Attendance, Leaves, Transport, Examination, Fees, Hostel, Announcement, Reports, Settings).
- **Bearer Token**: Required (`Super Admin`, `Admin`)

### `POST /api/v1/admin/permissions/save`
- **Description**: Create or update a role and batch sync its module permissions.
- **Bearer Token**: Required (`Super Admin`, `Admin`)
- **Request Body Payload**:
  ```json
  {
    "roleId": 3,
    "role_name": "Accountant",
    "permissions": [
      {
        "module": "feesmanagement/invoices",
        "add_access": 1,
        "view_access": 1,
        "edit_access": 1,
        "delete_access": 0
      }
    ]
  }
  ```

### `DELETE /api/v1/admin/permissions/roles/:roleId`
- **Description**: Delete a role and its associated permissions (protected against Super Admin deletion).
- **Bearer Token**: Required (`Super Admin`, `Admin`)
- **Request URL Params**: `roleId` (integer)

### `GET /api/v1/admin/permissions/my-permissions`
- **Description**: Fetch current authenticated user's permission map to dynamically gate UI buttons and routes.
- **Bearer Token**: Required (Any authenticated user)


