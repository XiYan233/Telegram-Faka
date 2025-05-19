/**
 * 用户行为监控工具
 * 用于检测异常行为并自动处理
 */
const { Order } = require('../models/orderModel');
const { Blacklist } = require('../models/blacklistModel');

// 存储用户最近订单数据
const userRecentOrders = new Map();

// 配置项
const CONFIG = {
  // 监控时间窗口（分钟）
  TIME_WINDOW: 30,
  // 最大允许pending订单数
  MAX_PENDING_ORDERS: 3,
  // 自动封禁时间（小时）
  AUTO_BAN_HOURS: 12
};

/**
 * 检查用户是否在短时间内创建了过多pending订单
 * @param {String} userId 用户ID
 * @returns {Promise<Boolean>} 是否需要封禁
 */
async function checkUserPendingOrders(userId) {
  try {
    // 当前时间
    const now = Date.now();
    // 监控窗口的起始时间
    const windowStart = now - (CONFIG.TIME_WINDOW * 60 * 1000);
    
    // 查询用户在窗口时间内创建的pending订单
    const recentPendingOrders = await Order.find({
      userId,
      status: 'pending',
      createdAt: { $gt: new Date(windowStart) }
    }).sort({ createdAt: -1 });
    
    console.log(`用户 ${userId} 在过去 ${CONFIG.TIME_WINDOW} 分钟内有 ${recentPendingOrders.length} 个pending订单`);
    
    // 检查是否需要封禁
    if (recentPendingOrders.length >= CONFIG.MAX_PENDING_ORDERS) {
      // 执行自动封禁
      await autoBanUser(userId, recentPendingOrders);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('检查用户pending订单时出错:', error);
    return false;
  }
}

/**
 * 自动封禁异常用户
 * @param {String} userId 用户ID
 * @param {Array} pendingOrders 待处理订单列表
 */
async function autoBanUser(userId, pendingOrders) {
  try {
    // 检查用户是否已被拉黑
    const isBlacklisted = await Blacklist.isBlacklisted(userId);
    if (isBlacklisted) {
      console.log(`用户 ${userId} 已在黑名单中，跳过自动封禁`);
      return;
    }
    
    const reason = `系统检测到短时间内创建了${pendingOrders.length}个未支付订单，可能存在异常行为`;
    
    // 将用户添加到黑名单
    await Blacklist.banUser(userId, reason, CONFIG.AUTO_BAN_HOURS);
    
    console.log(`已自动将用户 ${userId} 加入黑名单，封禁 ${CONFIG.AUTO_BAN_HOURS} 小时`);
    
    // 标记这些订单为过期
    const orderIds = pendingOrders.map(order => order._id);
    
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { 
        $set: { 
          status: 'expired',
          updatedAt: new Date(),
          expiredAt: new Date()
        } 
      }
    );
    
    console.log(`已将用户 ${userId} 的 ${orderIds.length} 个pending订单标记为expired`);
    
    // 发送封禁通知
    if (sendBanNotification) {
      try {
        await sendBanNotification(userId, reason, CONFIG.AUTO_BAN_HOURS);
        console.log(`已向用户 ${userId} 发送封禁通知`);
      } catch (notifyError) {
        console.error('发送封禁通知时出错:', notifyError);
      }
    }
    
    return true;
  } catch (error) {
    console.error('自动封禁用户时出错:', error);
    return false;
  }
}

/**
 * 发送封禁通知
 * 注意：此函数需要在初始化时注入botInstance
 */
let sendBanNotification = null;

/**
 * 注册发送通知的回调函数
 * @param {Function} callback 
 */
function registerNotificationCallback(callback) {
  sendBanNotification = callback;
  console.log('已注册封禁通知回调函数');
}

module.exports = {
  checkUserPendingOrders,
  autoBanUser,
  registerNotificationCallback
}; 