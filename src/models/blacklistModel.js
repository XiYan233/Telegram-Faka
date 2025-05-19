const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true  // Telegram userId
  },
  reason: {
    type: String,
    required: true
  },
  banCount: {
    type: Number,
    default: 1
  },
  banUntil: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// 检查用户是否被拉黑
blacklistSchema.statics.isBlacklisted = async function(userId) {
  const blacklistEntry = await this.findOne({ userId });
  if (!blacklistEntry) return false;
  
  // 检查封禁时间是否已过
  if (blacklistEntry.banUntil <= new Date()) {
    // 如果已过期，删除黑名单条目
    await this.findByIdAndDelete(blacklistEntry._id);
    return false;
  }
  
  return blacklistEntry;
};

// 封禁用户
blacklistSchema.statics.banUser = async function(userId, reason, hours = 12) {
  const banUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  
  // 查找现有记录
  const existing = await this.findOne({ userId });
  
  if (existing) {
    // 更新现有记录
    existing.reason = reason;
    existing.banCount += 1;
    existing.banUntil = banUntil;
    existing.updatedAt = new Date();
    return await existing.save();
  } else {
    // 创建新记录
    return await this.create({
      userId,
      reason,
      banUntil,
      updatedAt: new Date()
    });
  }
};

// 解除封禁
blacklistSchema.statics.unbanUser = async function(userId) {
  return await this.findOneAndDelete({ userId });
};

const Blacklist = mongoose.model('Blacklist', blacklistSchema);

module.exports = { Blacklist }; 