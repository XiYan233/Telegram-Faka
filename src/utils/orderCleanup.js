/**
 * 订单清理工具，处理超时的待支付订单
 */
const { Order } = require('../models/orderModel');

/**
 * 清理超时未支付的订单
 * @param {number} timeoutMinutes 超时时间（分钟）
 * @returns {Promise<{count: number, orders: Array}>} 处理结果
 */
async function cleanupPendingOrders(timeoutMinutes = 30) {
  try {
    console.log(`开始清理超时订单 (超时时间: ${timeoutMinutes}分钟)...`);
    
    // 计算截止时间点
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    
    // 查找所有超时的待支付订单
    const expiredOrders = await Order.find({
      status: 'pending',
      createdAt: { $lt: cutoffTime }
    });
    
    console.log(`找到 ${expiredOrders.length} 个超时订单`);
    
    if (expiredOrders.length === 0) {
      return { count: 0, orders: [] };
    }
    
    // 提取订单ID
    const orderIds = expiredOrders.map(order => order._id);
    
    // 批量更新为过期状态
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
    
    console.log(`已将 ${orderIds.length} 个订单标记为过期`);
    
    return {
      count: orderIds.length,
      orders: expiredOrders
    };
  } catch (error) {
    console.error('清理超时订单时出错:', error);
    throw error;
  }
}

/**
 * 启动定时清理任务
 * @param {number} intervalMinutes 执行间隔（分钟）
 * @param {number} timeoutMinutes 订单超时时间（分钟）
 * @returns {NodeJS.Timeout} 定时器句柄
 */
function startCleanupSchedule(intervalMinutes = 5, timeoutMinutes = 30) {
  console.log(`启动订单清理定时任务 (间隔: ${intervalMinutes}分钟, 超时: ${timeoutMinutes}分钟)`);
  
  // 立即执行一次
  cleanupPendingOrders(timeoutMinutes).catch(err => 
    console.error('首次清理订单失败:', err)
  );
  
  // 设置定时任务
  const interval = intervalMinutes * 60 * 1000; // 转换为毫秒
  const timer = setInterval(() => {
    cleanupPendingOrders(timeoutMinutes).catch(err => 
      console.error('定时清理订单失败:', err)
    );
  }, interval);
  
  return timer;
}

module.exports = {
  cleanupPendingOrders,
  startCleanupSchedule
}; 