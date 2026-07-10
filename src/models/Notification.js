const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['site_reassignment_nudge', 'budget_warning', 'budget_exceeded', 'site_request', 'system_alert'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed
  },
  actionUrl: {
    type: String
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'dismissed'],
    default: 'unread',
    index: true
  },
  readAt: Date,
  dismissedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
