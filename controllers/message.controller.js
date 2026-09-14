const MessageModel = require('../models/message.model');
const ApiResponse = require('../utils/api.response');
const { getIO, isUserOnline, isCommunicationAllowed } = require('../services/socket.service');

class MessageController {
  /**
   * Helper to normalize user payload from req.user
   */
  static extractUserInfo(req) {
    const user = req.user || {};
    let role = 'admin';
    const rawRole = (user.roleName || user.portalType || '').toLowerCase();
    if (rawRole.includes('teacher')) role = 'teacher';
    else if (rawRole.includes('parent')) role = 'parent';
    else if (rawRole.includes('student')) role = 'student';
    else role = 'admin';

    const userId = Number(
      user.userId || user.teacherId || user.parentId || user.studentId || user.id
    );
    const schoolId = Number(user.schoolId || user.school_id) || 1;

    return { userId, role, schoolId };
  }

  /**
   * Get all permitted contacts for the current user
   */
  static async getContacts(req, res, next) {
    try {
      const { userId, role, schoolId } = MessageController.extractUserInfo(req);

      const contacts = await MessageModel.getContactsForUser({
        school_id: schoolId,
        userId,
        role,
      });

      // Enrich with real-time online status
      const enrichedContacts = contacts.map((c) => ({
        ...c,
        is_online: isUserOnline(c.role, c.id),
      }));

      return ApiResponse.success(res, 'Contacts retrieved successfully.', enrichedContacts);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get chat history with a specific contact
   */
  static async getConversation(req, res, next) {
    try {
      const { userId, role, schoolId } = MessageController.extractUserInfo(req);
      const contactId = Number(req.params.contactId || req.query.contactId);
      const contactRole = String(req.params.contactRole || req.query.contactRole || '').toLowerCase();
      const limit = Number(req.query.limit) || 100;
      const offset = Number(req.query.offset) || 0;

      if (!contactId || !contactRole) {
        return ApiResponse.error(res, 'Contact ID and contact role are required.', null, 400);
      }

      if (!isCommunicationAllowed(role, contactRole)) {
        return ApiResponse.error(
          res,
          `Communication between ${role} and ${contactRole} is not permitted.`,
          null,
          403
        );
      }

      const { messages, total } = await MessageModel.getConversation({
        school_id: schoolId,
        user1Id: userId,
        user1Role: role,
        user2Id: contactId,
        user2Role: contactRole,
        limit,
        offset,
      });

      // Mark incoming unread messages as read
      const affected = await MessageModel.markMessagesAsRead({
        school_id: schoolId,
        currentUserId: userId,
        currentUserRole: role,
        senderId: contactId,
        senderRole: contactRole,
      });

      // If any messages were marked as read, notify sender over socket
      if (affected > 0) {
        try {
          const io = getIO();
          io.to(`user_${contactRole}_${contactId}`).emit('messages_read', {
            readerId: userId,
            readerRole: role,
          });
        } catch (_) {
          // Socket might not be active in some test environments
        }
      }

      return ApiResponse.success(res, 'Conversation fetched successfully.', {
        messages,
        total,
        hasMore: offset + messages.length < total,
        contact: {
          id: contactId,
          role: contactRole,
          is_online: isUserOnline(contactRole, contactId),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Send a new message (REST endpoint fallback or direct call)
   */
  static async sendMessage(req, res, next) {
    try {
      const { userId, role, schoolId } = MessageController.extractUserInfo(req);
      const { receiverId, receiverRole, message, file, fileType } = req.body;

      if (!receiverId || !receiverRole) {
        return ApiResponse.error(res, 'receiverId and receiverRole are required.', null, 400);
      }

      if (!message && !file && !req.file) {
        return ApiResponse.error(res, 'Message text or attachment is required.', null, 400);
      }

      const normalizedReceiverRole = String(receiverRole).toLowerCase();

      if (!isCommunicationAllowed(role, normalizedReceiverRole)) {
        return ApiResponse.error(
          res,
          `Communication between ${role} and ${normalizedReceiverRole} is not permitted.`,
          null,
          403
        );
      }

      let fileUrl = file || null;
      let finalFileType = fileType || null;

      if (req.file) {
        fileUrl = `upload/messages/${req.file.filename}`;
        finalFileType = req.file.mimetype;
      }

      const savedMessage = await MessageModel.saveMessage({
        school_id: schoolId,
        sender: userId,
        sender_role: role,
        reciver: Number(receiverId),
        receiver_role: normalizedReceiverRole,
        message: message ? String(message) : '',
        file: fileUrl,
        file_type: finalFileType,
      });

      const senderName = req.user?.firstName
        ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim()
        : (req.user?.name || `${role.charAt(0).toUpperCase() + role.slice(1)}`);
      savedMessage.sender_name = senderName;

      // Emit to recipient and sender via Socket.IO
      try {
        const io = getIO();
        io.to(`user_${normalizedReceiverRole}_${Number(receiverId)}`).emit('receive_message', savedMessage);
        io.to(`user_${role}_${userId}`).emit('message_sent', savedMessage);
      } catch (_) {}

      return ApiResponse.success(res, 'Message sent successfully.', savedMessage, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark messages as read
   */
  static async markAsRead(req, res, next) {
    try {
      const { userId, role, schoolId } = MessageController.extractUserInfo(req);
      const { senderId, senderRole } = req.body;

      if (!senderId || !senderRole) {
        return ApiResponse.error(res, 'senderId and senderRole are required.', null, 400);
      }

      const affected = await MessageModel.markMessagesAsRead({
        school_id: schoolId,
        currentUserId: userId,
        currentUserRole: role,
        senderId: Number(senderId),
        senderRole: String(senderRole).toLowerCase(),
      });

      try {
        const io = getIO();
        io.to(`user_${String(senderRole).toLowerCase()}_${Number(senderId)}`).emit('messages_read', {
          readerId: userId,
          readerRole: role,
        });
      } catch (_) {}

      return ApiResponse.success(res, 'Messages marked as read.', { affectedRows: affected });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get total unread count for current user
   */
  static async getUnreadCount(req, res, next) {
    try {
      const { userId, role, schoolId } = MessageController.extractUserInfo(req);
      const count = await MessageModel.getTotalUnreadCount({
        school_id: schoolId,
        userId,
        role,
      });
      return ApiResponse.success(res, 'Unread count fetched.', { unreadCount: count });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = MessageController;
