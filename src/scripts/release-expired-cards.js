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
    
    // 查询所有已使用的卡密及其关联的订单
    const usedCardsDetails = await Card.find({ used: true }).select('orderId code');
    console.log('已使用卡密及关联订单:', JSON.stringify(usedCardsDetails, null, 2));

    // 查询其中没有关联订单的卡密
    const orphanedCards = await Card.find({ used: true, orderId: null }).count();
    console.log('已使用但未关联订单的卡密数量:', orphanedCards);
    
    // 重置没有关联订单的卡密
    const resetResult = await Card.updateMany(
      { used: true, orderId: null },
      { used: false }
    );
    console.log(`已重置 ${resetResult.modifiedCount} 个未关联订单的卡密`);
    
    // 释放订单多余的卡密
    const extraReleasedCount = await releaseExtraCards();
    console.log(`总共释放了 ${releasedCount + resetResult.modifiedCount + extraReleasedCount} 个卡密`);
    
    // 重新检查卡密数量
    const finalUsedCards = await Card.countDocuments({ used: true });
    console.log(`处理后卡密统计: 已使用 ${finalUsedCards}/${totalCards}`);
    
  } catch (error) {
    console.error('释放卡密时出错:', error);
  } finally {
    mongoose.disconnect();
    console.log('数据库连接已关闭');
  }
}

// 释放订单多余的卡密
async function releaseExtraCards() {
  try {
    console.log('开始检查订单多余卡密...');
    
    // 查询所有已使用的卡密
    const allUsedCards = await Card.find({ used: true }).select('orderId code _id');
    
    // 创建订单ID到卡密的映射
    const orderCardMap = new Map();
    
    // 填充映射
    for (const card of allUsedCards) {
      // 跳过没有关联订单的卡密
      if (!card.orderId) continue;
      
      const orderId = card.orderId.toString();
      if (!orderCardMap.has(orderId)) {
        orderCardMap.set(orderId, []);
      }
      orderCardMap.get(orderId).push(card);
    }
    
    console.log(`发现 ${orderCardMap.size} 个订单有关联卡密`);
    
    // 统计重复卡密数量
    let duplicateCount = 0;
    let releasedCount = 0;
    
    // 处理每个订单的卡密
    for (const [orderId, cards] of orderCardMap) {
      if (cards.length > 1) {
        duplicateCount++;
        console.log(`订单 ${orderId} 有 ${cards.length} 个关联卡密`);
        
        // 保留第一个卡密，释放其他卡密
        const cardsToRelease = cards.slice(1).map(card => card._id);
        
        // 批量释放多余卡密
        const updateResult = await Card.updateMany(
          { _id: { $in: cardsToRelease } },
          { used: false, orderId: null, usedAt: null }
        );
        
        console.log(`为订单 ${orderId} 释放了 ${updateResult.modifiedCount} 个多余卡密`);
        releasedCount += updateResult.modifiedCount;
        
        // 确保该订单的第一个卡密被正确关联
        const order = await Order.findById(orderId);
        if (order && (!order.cardId || order.cardId.toString() !== cards[0]._id.toString())) {
          order.cardId = cards[0]._id;
          await order.save();
          console.log(`已更新订单 ${orderId} 的cardId为 ${cards[0]._id}`);
        }
      }
    }
    
    console.log(`发现 ${duplicateCount} 个订单有多个卡密，共释放了 ${releasedCount} 个多余卡密`);
    
    return releasedCount;
  } catch (error) {
    console.error('释放多余卡密时出错:', error);
    return 0;
  }
}

// 处理订单和发送卡密
async function processOrder(order, session) {
  // 增加检查，确保订单没有已分配卡密
  const existingCard = await Card.findOne({ orderId: order._id });
  if (existingCard) {
    console.log(`订单 ${order._id} 已有关联卡密，跳过处理`);
    return;
  }
  
  // 原有逻辑继续...
}

// 执行函数
releaseExpiredCards(); 