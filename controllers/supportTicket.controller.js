const SupportTicketModel = require('../models/supportTicket.model');
const PushNotificationService = require('../services/pushNotification.service');
const { pool } = require('../config/db.config');
const ApiResponse = require('../utils/api.response');

class SupportTicketController {
  // =========================================================================
  // 1. SCHOOL ADMIN ENDPOINTS (/api/v1/admin/support-tickets)
  // =========================================================================

  /**
   * Resolve sender name for school admin from req.user or user_master
   */
  static async resolveSchoolAdminName(user) {
    const directName =
      user?.fullName ||
      user?.full_name ||
      user?.name ||
      [user?.firstName || user?.first_name, user?.lastName || user?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

    if (directName) return directName;

    const userId = user?.id || user?.userId;
    if (userId) {
      const [rows] = await pool.query(
        "SELECT TRIM(CONCAT_WS(' ', first_name, last_name)) AS full_name, email FROM user_master WHERE id = ? LIMIT 1",
        [Number(userId)]
      );
      if (rows[0]?.full_name) return rows[0].full_name;
      if (rows[0]?.email) return rows[0].email;
    }

    return user?.email || 'School Admin';
  }

  /**
   * Resolve school name by school_id
   */
  static async resolveSchoolName(schoolId) {
    if (!schoolId) return 'School';
    try {
      const [rows] = await pool.query('SELECT school_name FROM school_master WHERE id = ? LIMIT 1', [
        Number(schoolId),
      ]);
      return rows[0]?.school_name || 'School';
    } catch {
      return 'School';
    }
  }

  /**
   * GET /api/v1/admin/support-tickets
   */
  static async getSchoolTickets(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      if (!schoolId) {
        return ApiResponse.error(res, 'School context is required.', null, 400);
      }

      const { search = '', status = '', priority = '', category = '', page, limit } = req.query;
      const branchId = req.headers['x-branch-id'] || req.query.branch_id || req.user?.branchId || null;

      const { tickets, pagination, counts } = await SupportTicketModel.getSchoolTickets({
        school_id: schoolId,
        branch_id: branchId,
        search,
        status,
        priority,
        category,
        page,
        limit,
      });

      return ApiResponse.success(
        res,
        'Support tickets fetched successfully.',
        {
          total_tickets: counts.total,
          open_tickets: counts.open,
          in_progress_tickets: counts.in_progress,
          resolved_tickets: counts.resolved,
          closed_tickets: counts.closed,
          tickets,
        },
        200,
        pagination
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/support-tickets
   */
  static async createSchoolTicket(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const adminId = req.user?.id || req.user?.userId;
      if (!schoolId || !adminId) {
        return ApiResponse.error(res, 'School admin authentication required.', null, 401);
      }

      const { subject, category = 'technical', priority = 'medium', message, description } = req.body || {};
      const bodyMessage = message || description;

      if (!subject || !String(subject).trim()) {
        return ApiResponse.error(res, 'Ticket subject is required.', null, 400);
      }
      if (!bodyMessage || !String(bodyMessage).trim()) {
        return ApiResponse.error(res, 'Ticket description / message is required.', null, 400);
      }

      const senderName = await SupportTicketController.resolveSchoolAdminName(req.user);
      const branchId =
        req.body?.branch_id ||
        (req.headers['x-branch-id'] && req.headers['x-branch-id'] !== 'all' ? req.headers['x-branch-id'] : null) ||
        req.user?.branchId ||
        null;

      let attachmentUrl = null;
      let attachmentName = null;
      if (req.file) {
        attachmentUrl = `/upload/support_tickets/${req.file.filename}`;
        attachmentName = req.file.originalname || req.file.filename;
      }

      const ticket = await SupportTicketModel.createTicket({
        school_id: schoolId,
        branch_id: branchId && branchId !== 'all' ? Number(branchId) : null,
        created_by_admin_id: adminId,
        sender_name: senderName,
        subject: String(subject).trim(),
        category,
        priority,
        message: String(bodyMessage).trim(),
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
      });

      // Notify SaaS Super Admins & Support Agents via Web Push (non-blocking)
      if (ticket) {
        SupportTicketController.resolveSchoolName(schoolId)
          .then((schoolName) =>
            PushNotificationService.sendToSaasAdmins({
              school_id: Number(schoolId),
              title: `New Support Ticket [${ticket.ticket_number}] (${String(ticket.priority || 'medium').toUpperCase()})`,
              body: `${schoolName}: ${ticket.subject}`,
              data: {
                type: 'support_ticket',
                ticketId: ticket.id,
                ticketNumber: ticket.ticket_number,
                url: `/support-tickets/${ticket.id}`,
                tag: `support_ticket_${ticket.id}`,
              },
              category: 'support_ticket',
            })
          )
          .catch((err) => console.warn('[SupportTicket Push Error - create]:', err?.message));
      }

      return ApiResponse.success(res, 'Support ticket raised successfully.', ticket, 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/support-tickets/:id
   */
  static async getSchoolTicketById(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const ticketId = parseInt(req.params.id, 10);
      if (!schoolId || !ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID is required.', null, 400);
      }

      const ticket = await SupportTicketModel.getTicketByIdForSchool(ticketId, schoolId);
      if (!ticket) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }

      return ApiResponse.success(res, 'Support ticket details fetched successfully.', ticket);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/support-tickets/:id/reply
   */
  static async addSchoolReply(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const adminId = req.user?.id || req.user?.userId;
      const ticketId = parseInt(req.params.id, 10);

      if (!schoolId || !adminId || !ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID and authentication are required.', null, 400);
      }

      const { message } = req.body || {};
      if ((!message || !String(message).trim()) && !req.file) {
        return ApiResponse.error(res, 'Please enter a reply message or attach a file.', null, 400);
      }

      const existing = await SupportTicketModel.getTicketByIdForSchool(ticketId, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }
      if (existing.status === 'closed') {
        return ApiResponse.error(res, 'This ticket is closed. Please reopen it or raise a new ticket.', null, 400);
      }

      const senderName = await SupportTicketController.resolveSchoolAdminName(req.user);

      let attachmentUrl = null;
      let attachmentName = null;
      if (req.file) {
        attachmentUrl = `/upload/support_tickets/${req.file.filename}`;
        attachmentName = req.file.originalname || req.file.filename;
      }

      const cleanMsg = message && String(message).trim() ? String(message).trim() : 'Attached file';

      const updatedTicket = await SupportTicketModel.addSchoolReply({
        ticket_id: ticketId,
        school_id: schoolId,
        sender_id: adminId,
        sender_name: senderName,
        message: cleanMsg,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
      });

      // Notify SaaS Admins via Web Push
      const preview = cleanMsg.length > 100 ? `${cleanMsg.substring(0, 97)}...` : cleanMsg;
      const targetIds = existing.assigned_to_saas_admin_id
        ? [Number(existing.assigned_to_saas_admin_id)]
        : null;

      SupportTicketController.resolveSchoolName(schoolId)
        .then((schoolName) =>
          PushNotificationService.sendToSaasAdmins({
            targetAdminIds: targetIds,
            school_id: Number(schoolId),
            title: `New Reply on ${existing.ticket_number}`,
            body: `${schoolName}: ${preview}`,
            data: {
              type: 'support_ticket',
              ticketId: existing.id,
              ticketNumber: existing.ticket_number,
              url: `/support-tickets/${existing.id}`,
              tag: `support_ticket_${existing.id}`,
            },
            category: 'support_ticket',
          })
        )
        .catch((err) => console.warn('[SupportTicket Push Error - school reply]:', err?.message));

      return ApiResponse.success(res, 'Reply sent successfully.', updatedTicket);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/support-tickets/:id/status
   */
  static async updateSchoolTicketStatus(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const ticketId = parseInt(req.params.id, 10);
      if (!schoolId || !ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID is required.', null, 400);
      }

      const status = req.body?.status === 'open' ? 'open' : 'closed';
      const updatedTicket = await SupportTicketModel.updateStatusBySchool(ticketId, schoolId, status);
      if (!updatedTicket) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }

      const targetIds = updatedTicket.assigned_to_saas_admin_id
        ? [Number(updatedTicket.assigned_to_saas_admin_id)]
        : null;

      SupportTicketController.resolveSchoolName(schoolId)
        .then((schoolName) =>
          PushNotificationService.sendToSaasAdmins({
            targetAdminIds: targetIds,
            school_id: Number(schoolId),
            title: `Ticket ${status === 'open' ? 'Reopened' : 'Closed'}: ${updatedTicket.ticket_number}`,
            body: `${schoolName} marked "${updatedTicket.subject}" as ${status}.`,
            data: {
              type: 'support_ticket',
              ticketId: updatedTicket.id,
              ticketNumber: updatedTicket.ticket_number,
              url: `/support-tickets/${updatedTicket.id}`,
              tag: `support_ticket_${updatedTicket.id}`,
            },
            category: 'support_ticket',
          })
        )
        .catch((err) => console.warn('[SupportTicket Push Error - school status]:', err?.message));

      return ApiResponse.success(
        res,
        status === 'closed' ? 'Ticket closed successfully.' : 'Ticket reopened successfully.',
        updatedTicket
      );
    } catch (error) {
      next(error);
    }
  }

  // =========================================================================
  // 2. SAAS SUPER ADMIN ENDPOINTS (/api/v1/saas-admin/support-tickets)
  // =========================================================================

  /**
   * GET /api/v1/saas-admin/support-tickets
   */
  static async getSaasTickets(req, res, next) {
    try {
      const {
        search = '',
        status = '',
        priority = '',
        category = '',
        assigned_to = '',
        school_id = '',
        page,
        limit,
      } = req.query;

      const { tickets, pagination, counts } = await SupportTicketModel.getAllTicketsForSaas({
        search,
        status,
        priority,
        category,
        assigned_to,
        school_id,
        page,
        limit,
      });

      return ApiResponse.success(
        res,
        'Support tickets fetched successfully.',
        {
          ...counts,
          tickets,
        },
        200,
        pagination
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/saas-admin/support-tickets/assignees
   */
  static async getSaasAssignees(req, res, next) {
    try {
      const admins = await SupportTicketModel.getAssignableSaasAdmins();
      return ApiResponse.success(res, 'Assignable SaaS admins fetched successfully.', admins);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/saas-admin/support-tickets/:id
   */
  static async getSaasTicketById(req, res, next) {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (!ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID is required.', null, 400);
      }

      const ticket = await SupportTicketModel.getTicketByIdForSaas(ticketId);
      if (!ticket) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }

      return ApiResponse.success(res, 'Support ticket details fetched successfully.', ticket);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/saas-admin/support-tickets/:id/reply
   */
  static async addSaasReply(req, res, next) {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (!ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID is required.', null, 400);
      }

      const { message, is_internal_note = false, next_status = null } = req.body || {};
      if ((!message || !String(message).trim()) && !req.file) {
        return ApiResponse.error(res, 'Please enter a reply message or attach a file.', null, 400);
      }

      const admin = req.saasAdmin;
      const senderId = admin?.id || 1;
      const senderName =
        [admin?.first_name, admin?.last_name].filter(Boolean).join(' ').trim() ||
        admin?.email ||
        'Growvidya Support';

      let attachmentUrl = null;
      let attachmentName = null;
      if (req.file) {
        attachmentUrl = `/upload/support_tickets/${req.file.filename}`;
        attachmentName = req.file.originalname || req.file.filename;
      }

      const cleanMsg = message && String(message).trim() ? String(message).trim() : 'Attached file';
      const isInternal =
        is_internal_note === true ||
        String(is_internal_note) === 'true' ||
        Number(is_internal_note) === 1;

      const updatedTicket = await SupportTicketModel.addSaasReply({
        ticket_id: ticketId,
        sender_id: senderId,
        sender_name: senderName,
        message: cleanMsg,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        is_internal_note: isInternal,
        next_status,
      });

      if (!updatedTicket) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }

      // Send Web Push notification to School Admin ONLY for public replies (never internal notes)
      if (!isInternal && updatedTicket.created_by_admin_id) {
        const preview = cleanMsg.length > 100 ? `${cleanMsg.substring(0, 97)}...` : cleanMsg;
        PushNotificationService.sendToUser({
          school_id: Number(updatedTicket.school_id),
          user_id: Number(updatedTicket.created_by_admin_id),
          role: 'admin',
          title: `Support Reply on ${updatedTicket.ticket_number}`,
          body: `${senderName}: ${preview}`,
          data: {
            type: 'support_ticket',
            ticketId: updatedTicket.id,
            ticketNumber: updatedTicket.ticket_number,
            url: `/admin/help-support/${updatedTicket.id}`,
            tag: `support_ticket_${updatedTicket.id}`,
          },
          category: 'support_ticket',
        }).catch((err) => console.warn('[SupportTicket Push Error - saas reply]:', err?.message));
      }

      return ApiResponse.success(
        res,
        isInternal ? 'Internal note added successfully.' : 'Support reply sent successfully.',
        updatedTicket
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/saas-admin/support-tickets/:id
   */
  static async updateSaasTicket(req, res, next) {
    try {
      const ticketId = parseInt(req.params.id, 10);
      if (!ticketId) {
        return ApiResponse.error(res, 'Valid ticket ID is required.', null, 400);
      }

      const existing = await SupportTicketModel.getTicketByIdForSaas(ticketId);
      if (!existing) {
        return ApiResponse.error(res, 'Support ticket not found.', null, 404);
      }

      const { status, priority, assigned_to_saas_admin_id } = req.body || {};
      const updatedTicket = await SupportTicketModel.updateTicketBySaas(ticketId, {
        status,
        priority,
        assigned_to_saas_admin_id,
      });

      if (updatedTicket) {
        // 1. If status changed, notify the School Admin who raised the ticket
        if (status && updatedTicket.status !== existing.status && updatedTicket.created_by_admin_id) {
          const readableStatus = String(updatedTicket.status).replace('_', ' ').toUpperCase();
          PushNotificationService.sendToUser({
            school_id: Number(updatedTicket.school_id),
            user_id: Number(updatedTicket.created_by_admin_id),
            role: 'admin',
            title: `Ticket ${updatedTicket.ticket_number} Status Updated`,
            body: `Your ticket "${updatedTicket.subject}" is now marked as ${readableStatus}.`,
            data: {
              type: 'support_ticket',
              ticketId: updatedTicket.id,
              ticketNumber: updatedTicket.ticket_number,
              url: `/admin/help-support/${updatedTicket.id}`,
              tag: `support_ticket_${updatedTicket.id}`,
            },
            category: 'support_ticket',
          }).catch((err) => console.warn('[SupportTicket Push Error - status]:', err?.message));
        }

        // 2. If assigned to a SaaS Admin, notify that SaaS Admin
        if (
          updatedTicket.assigned_to_saas_admin_id &&
          Number(updatedTicket.assigned_to_saas_admin_id) !== Number(existing.assigned_to_saas_admin_id)
        ) {
          PushNotificationService.sendToSaasAdmins({
            targetAdminIds: [Number(updatedTicket.assigned_to_saas_admin_id)],
            school_id: Number(updatedTicket.school_id),
            title: `Support Ticket Assigned: ${updatedTicket.ticket_number}`,
            body: `You have been assigned to "${updatedTicket.subject}" (${updatedTicket.school_name || 'School'}).`,
            data: {
              type: 'support_ticket',
              ticketId: updatedTicket.id,
              ticketNumber: updatedTicket.ticket_number,
              url: `/support-tickets/${updatedTicket.id}`,
              tag: `support_ticket_${updatedTicket.id}`,
            },
            category: 'support_ticket',
          }).catch((err) => console.warn('[SupportTicket Push Error - assign]:', err?.message));
        }
      }

      return ApiResponse.success(res, 'Support ticket updated successfully.', updatedTicket);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SupportTicketController;
