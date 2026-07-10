const Notification = require('../models/Notification');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * Create notification
   */
  async createNotification({ userId, type, title, message, data, actionUrl }) {
    const notification = new Notification({
      userId,
      type,
      title,
      message,
      data,
      actionUrl
    });

    await notification.save();

    logger.info('Notification created', {
      notificationId: notification._id,
      userId,
      type
    });

    // Future: Send email/push notification here

    return notification;
  }

  /**
   * Get notifications for user
   */
  async getUserNotifications(userId, status = null, limit = 50) {
    const query = { userId };

    if (status) {
      query.status = status;
    }

    return await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId) {
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.status = 'read';
    notification.readAt = new Date();

    await notification.save();

    return notification;
  }

  /**
   * Dismiss notification
   */
  async dismiss(notificationId) {
    const notification = await Notification.findById(notificationId);

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.status = 'dismissed';
    notification.dismissedAt = new Date();

    await notification.save();

    return notification;
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId) {
    return await Notification.countDocuments({
      userId,
      status: 'unread'
    });
  }
}

module.exports = new NotificationService();
