const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't include password in queries by default
  },
  role: {
    type: String,
    enum: ['GP', 'LP', 'admin', 'analyst', 'compliance', 'viewer'],
    default: 'viewer',
    required: true
  },
  permissions: [{
    type: String,
    enum: Object.keys(config.PERMISSIONS)
  }],
  funds: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Fund'
  }],
  gmailConnections: [{
    type: mongoose.Schema.ObjectId,
    ref: 'GmailConnection'
  }],
  profile: {
    organization: String,
    title: String,
    phone: String,
    address: {
      street: String,
      city: String,
      state: String,
      zip: String,
      country: String
    }
  },
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      browser: { type: Boolean, default: true },
      documentUpdates: { type: Boolean, default: true },
      capitalCalls: { type: Boolean, default: true },
      distributions: { type: Boolean, default: true },
      performanceReports: { type: Boolean, default: true },
      investmentActivity: { type: Boolean, default: true },
      teamActivity: { type: Boolean, default: true },
      marketingMaterials: { type: Boolean, default: false },
      systemMaintenance: { type: Boolean, default: true }
    },
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'en' }
  },
  security: {
    lastLogin: Date,
    loginAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    emailVerified: { type: Boolean, default: false },
    emailVerificationToken: String,
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: String
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    lastActivity: { type: Date, default: Date.now }
  },
  isActive: { type: Boolean, default: true },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ 'security.lastLogin': 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Virtual to check if account is locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.security.lockedUntil && this.security.lockedUntil > Date.now());
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only run if password is modified
  if (!this.isModified('password')) return next();

  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(config.SECURITY.BCRYPT_ROUNDS);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to set permissions based on role
userSchema.pre('save', function(next) {
  if (!this.isModified('role')) return next();

  // Set permissions based on role
  this.permissions = [];
  Object.keys(config.PERMISSIONS).forEach(permission => {
    if (config.PERMISSIONS[permission].includes(this.role.toLowerCase())) {
      this.permissions.push(permission);
    }
  });

  next();
});

// Instance method to check password
userSchema.methods.matchPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.getSignedJwtToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      email: this.email,
      role: this.role,
      permissions: this.permissions
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRATION }
  );
};

// Instance method to generate refresh token
userSchema.methods.getRefreshToken = function() {
  return jwt.sign(
    { id: this._id, type: 'refresh' },
    config.JWT_SECRET,
    { expiresIn: config.REFRESH_TOKEN_EXPIRATION }
  );
};

// Instance method to handle failed login attempts
userSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.security.lockedUntil && this.security.lockedUntil < Date.now()) {
    return this.updateOne({
      $unset: { 'security.lockedUntil': 1 },
      $set: { 'security.loginAttempts': 1 }
    });
  }

  const updates = { $inc: { 'security.loginAttempts': 1 } };
  
  // Lock account after max attempts
  if (this.security.loginAttempts + 1 >= config.SECURITY.MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    updates.$set = { 'security.lockedUntil': Date.now() + config.SECURITY.LOCKOUT_DURATION };
  }

  return this.updateOne(updates);
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { 'security.loginAttempts': 1, 'security.lockedUntil': 1 }
  });
};

// Instance method to check permissions
userSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission);
};

// Instance method to check if user has access to fund
userSchema.methods.hasAccessToFund = function(fundId) {
  if (this.role === 'admin' || this.role === 'GP') return true;
  return this.funds.includes(fundId);
};

// Static method to get user permissions by role
userSchema.statics.getPermissionsByRole = function(role) {
  const permissions = [];
  Object.keys(config.PERMISSIONS).forEach(permission => {
    if (config.PERMISSIONS[permission].includes(role.toLowerCase())) {
      permissions.push(permission);
    }
  });
  return permissions;
};

// Static method for login with rate limiting
userSchema.statics.getAuthenticated = async function(email, password) {
  const user = await this.findOne({ email, isActive: true }).select('+password');
  
  if (!user) {
    return { success: false, reason: 'Invalid credentials' };
  }

  // Check if account is locked
  if (user.isLocked) {
    return { success: false, reason: 'Account temporarily locked' };
  }

  // Check password
  const isMatch = await user.matchPassword(password);
  
  if (!isMatch) {
    await user.incLoginAttempts();
    return { success: false, reason: 'Invalid credentials' };
  }

  // Reset login attempts on successful login
  if (user.security.loginAttempts > 0) {
    await user.resetLoginAttempts();
  }

  // Update last login
  await user.updateOne({
    'security.lastLogin': new Date(),
    'metadata.lastActivity': new Date()
  });

  return { success: true, user };
};

module.exports = mongoose.model('User', userSchema);