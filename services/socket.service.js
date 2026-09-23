const { Server } = require('socket.io');
const { verifyToken } = require('../utils/jwt.util');
const MessageModel = require('../models/message.model');
const { isOriginAllowed } = require('../config/cors.config');

let io = null;

// Map to track online users: key = "${role}_${userId}" -> Set of socket.id strings
const onlineUsers = new Map();

/**
 * Check if communication is allowed between two roles
 */
function isCommunicationAllowed(senderRole, receiverRole) {
  const s = String(senderRole).toLowerCase();
  const r = String(receiverRole).toLowerCase();

  // Admin <-> Teacher
  if (s === 'admin' && r === 'teacher') return true;
  if (s === 'teacher' && r === 'admin') return true;

  // Teacher <-> Parent
  if (s === 'teacher' && r === 'parent') return true;
  if (s === 'parent' && r === 'teacher') return true;

  // Teacher <-> Student
  if (s === 'teacher' && r === 'student') return true;
  if (s === 'student' && r === 'teacher') return true;

  return false;
}

/**
 * Initialize Socket.IO Server
 */
function initSocket(server, config) {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Socket.IO CORS blocked for origin: ${origin}`));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Socket Authentication Middleware
  io.use((socket, next) => {
    try {
      let token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        socket.handshake.query?.token;

      // Also check cookies if passed in handshake headers
      if (!token && socket.handshake.headers?.cookie) {
        const cookieStr = socket.handshake.headers.cookie;
        const cookieMatch = cookieStr.match(/(?:growvidya_admin_session|growvidya_teacher_session|growvidya_parent_session|growvidya_student_session|growvidya_session|token)=([^;]+)/);
        if (cookieMatch) {
          token = decodeURIComponent(cookieMatch[1]);
        }
      }

      if (!token) {
        return next(new Error('Authentication failed: Missing token'));
      }

      const decoded = verifyToken(token);
      if (!decoded) {
        return next(new Error('Authentication failed: Invalid or expired token'));
      }

      // Normalize user role
      let role = 'admin';
      const rawRole = (decoded.roleName || decoded.portalType || '').toLowerCase();
      if (rawRole.includes('teacher')) role = 'teacher';
      else if (rawRole.includes('parent')) role = 'parent';
      else if (rawRole.includes('student')) role = 'student';
      else role = 'admin';

      const userId = Number(
        decoded.userId || decoded.teacherId || decoded.parentId || decoded.studentId || decoded.id
      );

      if (!userId) {
        return next(new Error('Authentication failed: Invalid user ID'));
      }

      socket.user = {
        userId,
        role,
        schoolId: Number(decoded.schoolId || decoded.school_id) || 1,
        email: decoded.email || decoded.email_address || '',
        name: `${decoded.firstName || decoded.first_name || ''} ${decoded.lastName || decoded.last_name || ''}`.trim(),
      };

      next();
    } catch (err) {
      console.error('[Socket Auth Error]:', err.message);
      next(new Error('Socket authentication error: ' + err.message));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role, schoolId } = socket.user;
    const userRoom = `user_${role}_${userId}`;
    const schoolRoom = `school_${schoolId}`;
    const userKey = `${role}_${userId}`;

    socket.join(userRoom);
    socket.join(schoolRoom);

    // Track online presence
    const userSockets = onlineUsers.get(userKey) || new Set();
    const isFirstConnection = userSockets.size === 0;
    userSockets.add(socket.id);
    onlineUsers.set(userKey, userSockets);

    // If first socket connection, notify others in the school
    if (isFirstConnection) {
      socket.to(schoolRoom).emit('user_online', { userId, role });
    }

    // Send current list of online users to the newly connected user
    const currentOnline = Array.from(onlineUsers.keys());
    socket.emit('online_users_list', currentOnline);

    // Event: send_message
    socket.on('send_message', async (payload, callback) => {
      try {
        const { receiverId, receiverRole, message, file, fileType } = payload || {};

        if (!receiverId || !receiverRole) {
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Recipient ID and role are required.' });
          }
          return;
        }

        if (!message && !file) {
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Message content or file attachment is required.' });
          }
          return;
        }

        const normalizedReceiverRole = String(receiverRole).toLowerCase();

        // Enforce communication matrix
        if (!isCommunicationAllowed(role, normalizedReceiverRole)) {
          const err = `Direct chat between ${role} and ${normalizedReceiverRole} is not permitted.`;
          if (typeof callback === 'function') {
            return callback({ success: false, error: err });
          }
          return socket.emit('chat_error', { message: err });
        }

        // Persist message to database
        const savedMessage = await MessageModel.saveMessage({
          school_id: schoolId,
          sender: userId,
          sender_role: role,
          reciver: Number(receiverId),
          receiver_role: normalizedReceiverRole,
          message: message ? String(message) : '',
          file: file || null,
          file_type: fileType || null,
        });

        // Attach sender name for client notification
        savedMessage.sender_name = socket.user?.name || `${role.charAt(0).toUpperCase() + role.slice(1)}`;

        // Target recipient room
        const receiverRoom = `user_${normalizedReceiverRole}_${Number(receiverId)}`;

        // Emit real-time message to recipient
        io.to(receiverRoom).emit('receive_message', savedMessage);

        // Also broadcast to other sockets of the sender (so other tabs update without echoing back to current socket)
        socket.to(userRoom).emit('message_sent', savedMessage);

        if (typeof callback === 'function') {
          callback({ success: true, data: savedMessage });
        }
      } catch (err) {
        console.error('[Socket send_message error]:', err);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Failed to send message: ' + err.message });
        }
      }
    });

    // Event: typing
    socket.on('typing', ({ receiverId, receiverRole }) => {
      if (!receiverId || !receiverRole) return;
      const receiverRoom = `user_${String(receiverRole).toLowerCase()}_${Number(receiverId)}`;
      socket.to(receiverRoom).emit('user_typing', {
        senderId: userId,
        senderRole: role,
      });
    });

    // Event: stop_typing
    socket.on('stop_typing', ({ receiverId, receiverRole }) => {
      if (!receiverId || !receiverRole) return;
      const receiverRoom = `user_${String(receiverRole).toLowerCase()}_${Number(receiverId)}`;
      socket.to(receiverRoom).emit('user_stop_typing', {
        senderId: userId,
        senderRole: role,
      });
    });

    // Event: mark_read
    socket.on('mark_read', async ({ senderId, senderRole }, callback) => {
      try {
        if (!senderId || !senderRole) return;
        const normalizedSenderRole = String(senderRole).toLowerCase();

        await MessageModel.markMessagesAsRead({
          school_id: schoolId,
          currentUserId: userId,
          currentUserRole: role,
          senderId: Number(senderId),
          senderRole: normalizedSenderRole,
        });

        // Notify the original sender that their messages were read
        const senderRoom = `user_${normalizedSenderRole}_${Number(senderId)}`;
        io.to(senderRoom).emit('messages_read', {
          readerId: userId,
          readerRole: role,
        });

        // Also notify reader's other tabs that unread count has changed
        socket.to(userRoom).emit('unread_count_updated', {
          senderId: Number(senderId),
          senderRole: normalizedSenderRole,
        });

        if (typeof callback === 'function') {
          callback({ success: true });
        }
      } catch (err) {
        console.error('[Socket mark_read error]:', err);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // Event: delete_message
    socket.on('delete_message', async ({ messageId }, callback) => {
      try {
        if (!messageId) {
          if (typeof callback === 'function') {
            return callback({ success: false, error: 'Message ID is required' });
          }
          return;
        }

        const result = await MessageModel.deleteMessage({
          school_id: schoolId,
          messageId,
          userId,
          role,
        });

        if (!result.success) {
          if (typeof callback === 'function') {
            return callback({ success: false, error: result.message });
          }
          return;
        }

        const { deletedMessage } = result;
        const senderRoom = `user_${String(deletedMessage.sender_role).toLowerCase()}_${Number(deletedMessage.sender)}`;
        const receiverRoom = `user_${String(deletedMessage.receiver_role).toLowerCase()}_${Number(deletedMessage.reciver)}`;

        const deletePayload = {
          messageId: deletedMessage.id,
          senderId: deletedMessage.sender,
          senderRole: deletedMessage.sender_role,
          receiverId: deletedMessage.reciver,
          receiverRole: deletedMessage.receiver_role,
        };

        io.to(senderRoom).emit('message_deleted', deletePayload);
        io.to(receiverRoom).emit('message_deleted', deletePayload);

        if (typeof callback === 'function') {
          callback({ success: true, data: deletePayload });
        }
      } catch (err) {
        console.error('[Socket delete_message error]:', err);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // Event: disconnect
    socket.on('disconnect', () => {
      const userSockets = onlineUsers.get(userKey);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userKey);
          socket.to(schoolRoom).emit('user_offline', { userId, role });
        }
      }
    });
  });

  return io;
}

/**
 * Get Socket.IO instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO is not initialized!');
  }
  return io;
}

/**
 * Check if a specific user is currently online
 */
function isUserOnline(role, userId) {
  const userKey = `${String(role).toLowerCase()}_${Number(userId)}`;
  return onlineUsers.has(userKey) && onlineUsers.get(userKey).size > 0;
}

module.exports = {
  initSocket,
  getIO,
  isUserOnline,
  isCommunicationAllowed,
};
