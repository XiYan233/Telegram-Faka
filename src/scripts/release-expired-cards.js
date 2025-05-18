/**
 * 释放已过期订单占用的卡密
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orderModel');
const { Card } = require('../models/cardModel');

// 连接数据库
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('数据库连接成功'))
  .catch(err => {
    console.error('数据库连接失败:', err);
    process.exit(1);
  });

async function releaseExpiredCards() {
  try {
    console.log('开始检查过期订单占用的卡密...');
    
    // 查找所有状态为expired的订单
    const expiredOrders = await Order.find({ status: 'expired' });
    
    console.log(`找到 ${expiredOrders.length} 个过期订单`);
    
    if (expiredOrders.length === 0) {
      console.log('没有过期订单需要处理');
      return;
    }
    
    const orderIds = expiredOrders.map(order => order._id);
    let releasedCount = 0;
    
    // 释放直接关联到订单的卡密
    for (const order of expiredOrders) {
      if (order.cardId) {
        await Card.findByIdAndUpdate(
          order.cardId,
          { used: false, orderId: null, usedAt: null }
        );
        console.log(`已释放订单 ${order._id} 关联的卡密 ${order.cardId}`);
        releasedCount++;
      }
    }
    
    // 释放通过orderId关联的卡密
    const cardsResult = await Card.updateMany(
      { orderId: { $in: orderIds } },
      { used: false, orderId: null, usedAt: null }
    );
    
    console.log(`通过orderId找到并释放了 ${cardsResult.modifiedCount} 个卡密`);
    releasedCount += cardsResult.modifiedCount;
    
    console.log(`操作完成，共释放了 ${releasedCount} 个卡密`);
    
    // 检查卡密数量
    const totalCards = await Card.countDocuments();
    const usedCards = await Card.countDocuments({ used: true });
    console.log(`当前卡密统计: 已使用 ${usedCards}/${totalCards}`);
    
  } catch (error) {
    console.error('释放卡密时出错:', error);
  } finally {
    mongoose.disconnect();
    console.log('数据库连接已关闭');
  }
}

// 执行函数
releaseExpiredCards(); 