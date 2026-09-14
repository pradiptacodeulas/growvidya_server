const { pool } = require('../config/db.config');

/**
 * Message Model
 * Handles database operations for real-time messaging between:
 * - Admin <-> Teacher
 * - Teacher <-> Parent
 * - Teacher <-> Student
 */
class MessageModel {
  /**
   * Ensure table columns and indexes exist
   */
  static async initTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS message (
          id INT(15) NOT NULL AUTO_INCREMENT PRIMARY KEY,
          school_id INT(11) NOT NULL DEFAULT 1,
          sender INT(11) NOT NULL,
          sender_role VARCHAR(20) NOT NULL DEFAULT 'admin',
          reciver INT(11) NOT NULL,
          receiver_role VARCHAR(20) NOT NULL DEFAULT 'teacher',
          type INT(5) NOT NULL DEFAULT 1 COMMENT '1 = user/admin, 2 = teacher, 3 = students, 4 = guardian/parent',
          message TEXT DEFAULT NULL,
          file TEXT DEFAULT NULL,
          file_type VARCHAR(255) DEFAULT NULL,
          time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          seen INT(5) NOT NULL DEFAULT 0,
          status INT(5) NOT NULL DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
      `);

      // Ensure necessary columns exist in case table was created previously without them
      const [columns] = await pool.query(`SHOW COLUMNS FROM message`);
      const colNames = columns.map((c) => c.Field);

      if (!colNames.includes('school_id')) {
        await pool.query(`ALTER TABLE message ADD COLUMN school_id INT(11) NOT NULL DEFAULT 1 AFTER id`);
      }
      if (!colNames.includes('sender_role')) {
        await pool.query(`ALTER TABLE message ADD COLUMN sender_role VARCHAR(20) NOT NULL DEFAULT 'admin' AFTER sender`);
      }
      if (!colNames.includes('receiver_role')) {
        await pool.query(`ALTER TABLE message ADD COLUMN receiver_role VARCHAR(20) NOT NULL DEFAULT 'teacher' AFTER reciver`);
      }

      // Ensure composite indexes exist for high-speed conversation and unread queries
      const [indexes] = await pool.query(`SHOW INDEX FROM message`);
      const indexNames = indexes.map((idx) => idx.Key_name);

      if (!indexNames.includes('idx_msg_conv')) {
        await pool.query(
          `ALTER TABLE message ADD INDEX idx_msg_conv (school_id, sender, sender_role, reciver, receiver_role)`
        );
      }
      if (!indexNames.includes('idx_msg_unread')) {
        await pool.query(
          `ALTER TABLE message ADD INDEX idx_msg_unread (school_id, reciver, receiver_role, seen, status)`
        );
      }
      if (!indexNames.includes('idx_msg_time')) {
        await pool.query(
          `ALTER TABLE message ADD INDEX idx_msg_time (school_id, time)`
        );
      }
    } catch (err) {
      console.error('[MessageModel] Error ensuring table schema:', err.message);
    }
  }

  /**
   * Save a new message
   */
  static async saveMessage({
    school_id = 1,
    sender,
    sender_role,
    reciver,
    receiver_role,
    message = '',
    file = null,
    file_type = null,
    type = 1,
  }) {
    // Map role to integer type (1 = user/admin, 2 = teacher, 3 = student, 4 = parent/guardian)
    let mappedType = type;
    if (sender_role === 'teacher') mappedType = 2;
    else if (sender_role === 'student') mappedType = 3;
    else if (sender_role === 'parent') mappedType = 4;
    else mappedType = 1;

    const sql = `
      INSERT INTO message (
        school_id, sender, sender_role, reciver, receiver_role, type, message, file, file_type, seen, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
    `;

    const [result] = await pool.execute(sql, [
      Number(school_id) || 1,
      Number(sender),
      String(sender_role).toLowerCase(),
      Number(reciver),
      String(receiver_role).toLowerCase(),
      mappedType,
      message ? String(message) : '',
      file || null,
      file_type || null,
    ]);

    return {
      id: result.insertId,
      school_id: Number(school_id) || 1,
      sender: Number(sender),
      sender_role: String(sender_role).toLowerCase(),
      reciver: Number(reciver),
      receiver_role: String(receiver_role).toLowerCase(),
      type: mappedType,
      message: message ? String(message) : '',
      file: file || null,
      file_type: file_type || null,
      time: new Date().toISOString(),
      seen: 0,
      status: 1,
    };
  }

  /**
   * Get chat history between two users
   */
  static async getConversation({
    school_id = 1,
    user1Id,
    user1Role,
    user2Id,
    user2Role,
    limit = 50,
    offset = 0,
  }) {
    const parsedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    // Count total messages for pagination
    const countSql = `
      SELECT COUNT(*) AS total
      FROM message
      WHERE school_id = ?
        AND (
          (sender = ? AND sender_role = ? AND reciver = ? AND receiver_role = ?)
          OR
          (sender = ? AND sender_role = ? AND reciver = ? AND receiver_role = ?)
        )
        AND status = 1
    `;

    const [countRows] = await pool.query(countSql, [
      Number(school_id),
      Number(user1Id),
      String(user1Role).toLowerCase(),
      Number(user2Id),
      String(user2Role).toLowerCase(),
      Number(user2Id),
      String(user2Role).toLowerCase(),
      Number(user1Id),
      String(user1Role).toLowerCase(),
    ]);

    const total = countRows[0]?.total || 0;

    // Fetch the most recent messages first (ORDER BY id DESC with limit/offset),
    // then sort ascending so the conversation renders chronologically top-to-bottom.
    const sql = `
      SELECT * FROM (
        SELECT 
          id,
          school_id,
          sender,
          sender_role,
          reciver,
          receiver_role,
          type,
          CAST(message AS CHAR) AS message,
          file,
          file_type,
          time,
          seen,
          status
        FROM message
        WHERE school_id = ?
          AND (
            (sender = ? AND sender_role = ? AND reciver = ? AND receiver_role = ?)
            OR
            (sender = ? AND sender_role = ? AND reciver = ? AND receiver_role = ?)
          )
          AND status = 1
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      ) sub
      ORDER BY sub.id ASC
    `;

    const [rows] = await pool.query(sql, [
      Number(school_id),
      Number(user1Id),
      String(user1Role).toLowerCase(),
      Number(user2Id),
      String(user2Role).toLowerCase(),
      Number(user2Id),
      String(user2Role).toLowerCase(),
      Number(user1Id),
      String(user1Role).toLowerCase(),
      parsedLimit,
      parsedOffset,
    ]);

    return { messages: rows, total };
  }

  /**
   * Mark messages as read between current user (as receiver) and sender
   */
  static async markMessagesAsRead({ school_id, currentUserId, currentUserRole, senderId, senderRole }) {
    const sql = `
      UPDATE message 
      SET seen = 1 
      WHERE school_id = ?
        AND reciver = ?
        AND receiver_role = ?
        AND sender = ?
        AND sender_role = ?
        AND seen = 0
    `;

    const [result] = await pool.execute(sql, [
      Number(school_id),
      Number(currentUserId),
      String(currentUserRole).toLowerCase(),
      Number(senderId),
      String(senderRole).toLowerCase(),
    ]);

    return result.affectedRows;
  }

  /**
   * Get all permitted contacts for a user based on their role
   */
  static async getContactsForUser({ school_id = 1, userId, role }) {
    const normalizedRole = String(role).toLowerCase();
    const parsedSchoolId = Number(school_id) || 1;
    const parsedUserId = Number(userId);

    let contacts = [];

    if (normalizedRole === 'admin') {
      // Admins can chat with Teachers
      const [teachers] = await pool.query(
        `SELECT 
          t.id,
          CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) AS name,
          'teacher' AS role,
          t.picture,
          t.email_address AS email,
          t.primary_contact_number AS phone,
          t.teacher_id AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM teacher_master t
        LEFT JOIN class_master cm ON t.class = cm.id
        LEFT JOIN section_master sec ON t.section = sec.id
        WHERE t.school_id = ? AND t.status = 1
        ORDER BY t.first_name ASC`,
        [parsedSchoolId]
      );

      contacts = teachers;
    } else if (normalizedRole === 'teacher') {
      // Teachers can chat with:
      // 1. Admins
      const [admins] = await pool.query(
        `SELECT 
          u.id,
          CONCAT(TRIM(COALESCE(u.first_name, '')), ' ', TRIM(COALESCE(u.last_name, ''))) AS name,
          'admin' AS role,
          u.picture,
          u.email,
          u.phone,
          CASE 
            WHEN u.admin_type = 1 THEN 'Super Admin'
            ELSE COALESCE(r.role_name, 'School Admin')
          END AS designation
        FROM user_master u
        LEFT JOIN role_master r ON u.role = r.id
        WHERE u.school_id = ? AND u.status = 1
        ORDER BY u.admin_type ASC, u.first_name ASC`,
        [parsedSchoolId]
      );

      // 2. Parents
      const [parents] = await pool.query(
        `SELECT 
          p.id,
          CONCAT(TRIM(COALESCE(p.first_name, '')), ' ', TRIM(COALESCE(p.last_name, ''))) AS name,
          'parent' AS role,
          p.picture,
          p.email,
          p.phone,
          (
            SELECT GROUP_CONCAT(DISTINCT CONCAT(s.first_name, ' ', s.last_name) SEPARATOR ', ')
            FROM student_to_parent stp
            JOIN student_master s ON stp.student_id = s.id
            WHERE (stp.father_id = p.id OR stp.mother_id = p.id OR stp.guardian_id = p.id)
              AND (s.status = 1 OR s.status = '1')
          ) AS child_name
        FROM parent_master p
        WHERE p.school_id = ? AND p.status = 1
        ORDER BY p.first_name ASC`,
        [parsedSchoolId]
      );

      // 3. Students
      const [students] = await pool.query(
        `SELECT 
          s.id,
          CONCAT(TRIM(COALESCE(s.first_name, '')), ' ', TRIM(COALESCE(s.last_name, ''))) AS name,
          'student' AS role,
          s.picture,
          s.email_address AS email,
          s.primary_contact_number AS phone,
          s.admission_number AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM student_master s
        LEFT JOIN class_master cm ON s.class = cm.id
        LEFT JOIN section_master sec ON s.section = sec.id
        WHERE s.school_id = ? AND (s.status = 1 OR s.status = '1')
        ORDER BY cm.class_name ASC, s.first_name ASC`,
        [parsedSchoolId]
      );

      contacts = [...admins, ...parents, ...students];
    } else if (normalizedRole === 'parent') {
      // Parents can chat with Teachers
      const [teachers] = await pool.query(
        `SELECT 
          t.id,
          CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) AS name,
          'teacher' AS role,
          t.picture,
          t.email_address AS email,
          t.primary_contact_number AS phone,
          t.teacher_id AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM teacher_master t
        LEFT JOIN class_master cm ON t.class = cm.id
        LEFT JOIN section_master sec ON t.section = sec.id
        WHERE t.school_id = ? AND t.status = 1
        ORDER BY t.first_name ASC`,
        [parsedSchoolId]
      );

      contacts = teachers;
    } else if (normalizedRole === 'student') {
      // Students can chat with Teachers
      const [teachers] = await pool.query(
        `SELECT 
          t.id,
          CONCAT(TRIM(COALESCE(t.first_name, '')), ' ', TRIM(COALESCE(t.last_name, ''))) AS name,
          'teacher' AS role,
          t.picture,
          t.email_address AS email,
          t.primary_contact_number AS phone,
          t.teacher_id AS code,
          COALESCE(cm.class_name, '') AS class_name,
          COALESCE(sec.section_name, '') AS section_name
        FROM teacher_master t
        LEFT JOIN class_master cm ON t.class = cm.id
        LEFT JOIN section_master sec ON t.section = sec.id
        WHERE t.school_id = ? AND t.status = 1
        ORDER BY t.first_name ASC`,
        [parsedSchoolId]
      );

      contacts = teachers;
    }

    // Now enrich each contact with last_message, last_message_time, and unread_count
    if (contacts.length === 0) return [];

    // 1. Query unread counts grouped by sender
    const [unreadRows] = await pool.query(
      `SELECT sender, sender_role, COUNT(*) AS unread_count
       FROM message
       WHERE school_id = ?
         AND reciver = ?
         AND receiver_role = ?
         AND seen = 0
         AND status = 1
       GROUP BY sender, sender_role`,
      [parsedSchoolId, parsedUserId, normalizedRole]
    );

    const unreadCountMap = new Map();
    for (const r of unreadRows) {
      unreadCountMap.set(`${r.sender_role}_${r.sender}`, Number(r.unread_count));
    }

    // 2. Query only the latest message for each conversation using MAX(id)
    const [latestMessages] = await pool.query(
      `SELECT 
        m.id,
        m.sender,
        m.sender_role,
        m.reciver,
        m.receiver_role,
        CAST(m.message AS CHAR) AS message,
        m.file,
        m.file_type,
        m.time,
        m.seen
      FROM message m
      INNER JOIN (
        SELECT MAX(id) AS max_id
        FROM message
        WHERE school_id = ?
          AND (
            (sender = ? AND sender_role = ?)
            OR 
            (reciver = ? AND receiver_role = ?)
          )
          AND status = 1
        GROUP BY 
          CASE 
            WHEN sender = ? AND sender_role = ? THEN CONCAT(receiver_role, '_', reciver)
            ELSE CONCAT(sender_role, '_', sender)
          END
      ) latest ON m.id = latest.max_id`,
      [
        parsedSchoolId,
        parsedUserId,
        normalizedRole,
        parsedUserId,
        normalizedRole,
        parsedUserId,
        normalizedRole,
      ]
    );

    const lastMessageMap = new Map();
    for (const msg of latestMessages) {
      const isOutgoing = msg.sender === parsedUserId && msg.sender_role === normalizedRole;
      const contactKey = isOutgoing
        ? `${msg.receiver_role}_${msg.reciver}`
        : `${msg.sender_role}_${msg.sender}`;

      lastMessageMap.set(contactKey, {
        message: msg.message || (msg.file ? '📎 Attachment' : ''),
        time: msg.time,
        seen: msg.seen,
        isOutgoing,
      });
    }

    // Attach enriched data to each contact
    const enrichedContacts = contacts.map((c) => {
      const key = `${c.role}_${c.id}`;
      const lastMsg = lastMessageMap.get(key) || null;
      const unreadCount = unreadCountMap.get(key) || 0;

      return {
        ...c,
        last_message: lastMsg?.message || null,
        last_message_time: lastMsg?.time || null,
        last_message_seen: lastMsg?.seen ?? null,
        last_message_is_outgoing: lastMsg?.isOutgoing ?? false,
        unread_count: unreadCount,
      };
    });

    // Sort contacts: those with recent messages first, then alphabetically
    enrichedContacts.sort((a, b) => {
      if (a.last_message_time && b.last_message_time) {
        return new Date(b.last_message_time) - new Date(a.last_message_time);
      }
      if (a.last_message_time) return -1;
      if (b.last_message_time) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return enrichedContacts;
  }

  /**
   * Get total unread count for current user
   */
  static async getTotalUnreadCount({ school_id = 1, userId, role }) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM message
      WHERE school_id = ?
        AND reciver = ?
        AND receiver_role = ?
        AND seen = 0
        AND status = 1
    `;

    const [rows] = await pool.query(sql, [
      Number(school_id) || 1,
      Number(userId),
      String(role).toLowerCase(),
    ]);

    return rows[0]?.total || 0;
  }
}

module.exports = MessageModel;
