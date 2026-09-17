const ApiResponse = require('../utils/api.response');

function errorMiddleware(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  const errors = err.errors || null;

  // Handle MySQL ER_DUP_ENTRY duplicate key error
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 400;
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('email')) {
      message = 'An account with this email address already exists. Please use a different email.';
    } else if (msg.includes('phone') || msg.includes('primary_contact_number') || msg.includes('mobile')) {
      message = 'An account with this mobile/phone number already exists.';
    } else if (msg.includes('admission') || msg.includes('admission_no')) {
      message = 'A student with this admission number already exists. Please assign a unique admission number.';
    } else if (msg.includes('roll_no') || msg.includes('roll_number')) {
      message = 'A student with this roll number already exists in this class/section.';
    } else if (msg.includes('branch_code')) {
      message = 'A branch with this campus code already exists.';
    } else if (msg.includes('room_no') || msg.includes('room_number')) {
      message = 'A hostel room with this room number already exists.';
    } else if (msg.includes('route_name') || msg.includes('vehicle_number')) {
      message = 'A transport vehicle or route with this name/number already exists.';
    } else {
      message = 'A record with this duplicate information already exists. Please check your entries.';
    }
  } else if (
    err.code === 'ER_ROW_IS_REFERENCED' ||
    err.code === 'ER_ROW_IS_REFERENCED_2' ||
    String(err.message || '').includes('a foreign key constraint fails')
  ) {
    statusCode = 400;
    message = 'This item cannot be deleted or modified because other active records (such as students, classes, or fee records) are linked to it. Please reassign or delete the dependent records first.';
  } else if (
    err.code === 'ER_NO_REFERENCED_ROW' ||
    err.code === 'ER_NO_REFERENCED_ROW_2'
  ) {
    statusCode = 400;
    message = 'One or more referenced items (such as academic year, class, or section) could not be found.';
  } else if (
    err.code === 'ER_CANT_AGGREGATE_2COLLATIONS' ||
    String(err.message || '').includes('Illegal mix of collations')
  ) {
    statusCode = 400;
    message = 'One or more fields contain unsupported characters or symbols. Please check your text and try again.';
  } else if (
    err.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' ||
    err.code === 'ER_TRUNCATED_WRONG_VALUE' ||
    String(err.message || '').includes('Incorrect string value')
  ) {
    console.error('[Error Middleware] Truncated/Wrong value:', err.message);
    statusCode = 400;
    message = 'One or more fields contain an invalid format, date, or character value.';
  } else if (err.code === 'ER_DATA_TOO_LONG') {
    statusCode = 400;
    message = 'The entered text is too long for one or more fields. Please shorten your input and try again.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your session has expired. Please log in again to continue.';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication session. Please log in again.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    message = 'The uploaded file exceeds the allowed file size limit. Please upload a smaller file.';
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    message = 'Unexpected file uploaded. Please check the file attachment and try again.';
  } else if (statusCode >= 500) {
    // Sanitize any raw SQL leaks from reaching the user interface
    const rawMsg = String(err.message || '');
    if (
      rawMsg.includes('SELECT') ||
      rawMsg.includes('UPDATE') ||
      rawMsg.includes('INSERT') ||
      rawMsg.includes('DELETE') ||
      rawMsg.includes('COALESCE') ||
      rawMsg.includes('SQL syntax') ||
      rawMsg.includes('ER_')
    ) {
      message = 'An unexpected database error occurred while processing the request. Please verify entered details and try again.';
    }
  }

  if (statusCode >= 500) {
    console.error('[Unhandled Server Error]', err);
  } else {
    console.warn(`[Client/Operational Error ${statusCode}]`, message);
  }

  return ApiResponse.error(res, message, errors, statusCode);
}

module.exports = errorMiddleware;
