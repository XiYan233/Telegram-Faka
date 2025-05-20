const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
const { Order } = require('../models/orderModel');
const { Card } = require('../models/cardModel');

// 声明一个回调函数，用于发送卡密
let sendCardCallback = null;

// 注册发送卡密回调函数
function registerSendCardCallback(callback) {
  sendCardCallback = callback;
  console.log('卡密发送回调函数已注册');
}

// 创建 Stripe 结账会话
async function createCheckoutSession(orderId, productName, productPrice, userId) {
  try {
    console.log('准备创建Stripe会话:', {
      orderId,
      productName,
      productPrice,
      userId,
      stripeKeyConfigured: !!process.env.STRIPE_SECRET_KEY,
      environment: process.env.NODE_ENV || 'development'
    });
    
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
    console.log('使用服务器URL:', serverUrl);
    
    // 验证环境
    const isTestMode = process.env.NODE_ENV !== 'production';
    
    // 如果是测试模式且没有配置Stripe，返回测试会话
    if (isTestMode && !stripe) {
      console.log('测试模式: 使用模拟Stripe会话');
      return createTestSession(serverUrl, orderId);
    }
    
    // 验证Stripe初始化
    if (!stripe) {
      throw new Error('Stripe未初始化，密钥可能无效');
    }
    
    // 转换价格为整数
    const unitAmount = Math.round(productPrice * 100);
    console.log(`计算单价: ${productPrice} -> ${unitAmount}单位`);
    
    // 创建会话
    console.log('调用Stripe API创建会话...');
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cny',
            product_data: {
              name: productName,
              description: `购买 ${productName}`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        orderId
      },
      mode: 'payment',
      allow_promotion_codes: true,
      success_url: `${serverUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${serverUrl}/cancel`,
    });
    
    console.log('Stripe会话创建成功:', {
      sessionId: session.id,
      paymentUrl: session.url
    });
    
    return {
      sessionId: session.id,
      paymentUrl: session.url
    };
  } catch (error) {
    console.error('创建Stripe支付会话时出错:', error);
    
    // 尝试提供更有用的错误信息
    if (error.type && error.message) {
      console.error(`Stripe错误类型: ${error.type}, 消息: ${error.message}`);
    }
    
    // 对于测试环境，创建一个模拟会话
    if (process.env.NODE_ENV !== 'production') {
      console.log('在非生产环境中返回测试支付会话');
      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
      return createTestSession(serverUrl, orderId);
    }
    
    return null;
  }
}

// 创建测试会话（用于开发环境）
function createTestSession(serverUrl, orderId) {
  const sessionId = 'test_session_' + Date.now();
  // 使用本地测试支付URL
  const testPaymentUrl = `${serverUrl}/test-payment?session_id=${sessionId}&order_id=${orderId}`;
  
  console.log('创建测试支付会话:', {
    sessionId,
    paymentUrl: testPaymentUrl
  });
  
  return {
    sessionId,
    paymentUrl: testPaymentUrl
  };
}

// 处理 Stripe Webhook
async function handleWebhook(req, res) {
  let event;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  // 验证环境
  const isTestMode = process.env.NODE_ENV !== 'production';
  
  // 对于测试环境，可以直接从请求体中获取事件
  if (isTestMode && !webhookSecret) {
    console.log('测试环境: 跳过webhook签名验证');
    try {
      // 确保我们处理的是原始请求体
      const rawBody = req.body;
      if (typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) {
        // 如果是字符串或Buffer，解析它
        event = JSON.parse(rawBody);
      } else if (rawBody && typeof rawBody === 'object') {
        // 如果已经是对象，直接使用
        event = rawBody;
      } else {
        throw new Error('无法解析请求体');
      }
      
      console.log('测试环境webhook事件:', event);
    } catch (err) {
      console.error(`⚠️ 测试模式下解析webhook数据失败:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // 生产环境验证webhook签名
    const signature = req.headers['stripe-signature'];
    
    try {
      // 确保req.body是Buffer或字符串
      if (!Buffer.isBuffer(req.body) && typeof req.body !== 'string') {
        throw new Error('Webhook payload must be provided as a string or a Buffer instance representing the _raw_ request body.' +
                       'Payload was provided as a parsed JavaScript object instead. ' +
                       'Signature verification is impossible without access to the original signed material.');
      }
      
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret
      );
    } catch (err) {
      console.error(`⚠️ Webhook 签名验证失败:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
  
  // 处理事件
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case 'payment_intent.succeeded':
        console.log('💰 PaymentIntent 成功');
        break;
      default:
        console.log(`未处理的事件类型 ${event.type}`);
    }
    
    // 返回成功响应
    res.status(200).json({ received: true });
  } catch (err) {
    console.error(`处理webhook事件时出错:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// 处理结账会话完成
async function handleCheckoutSessionCompleted(session) {
  try {
    console.log(`处理支付成功: ${session.id}`);
    console.log('会话数据:', JSON.stringify(session, null, 2));
    
    // 查找对应订单
    const order = await Order.findOne({ stripeSessionId: session.id });
    
    if (!order) {
      console.error(`找不到对应会话ID的订单: ${session.id}`);
      // 尝试从元数据中查询
      if (session.metadata && session.metadata.orderId) {
        const orderFromMetadata = await Order.findById(session.metadata.orderId);
        if (orderFromMetadata) {
          console.log(`通过元数据找到订单: ${orderFromMetadata._id}`);
          processOrder(orderFromMetadata, session);
          return;
        }
      }
      return;
    }
    
    await processOrder(order, session);
  } catch (error) {
    console.error('处理支付成功时出错:', error);
  }
}

// 处理订单和发送卡密
async function processOrder(order, session) {
  console.log(`处理订单: ${order._id}, 状态: ${order.status}`);
  
  // 如果订单已经处理过，跳过
  if (order.status === 'delivered' || order.status === 'paid') {
    console.log(`订单 ${order._id} 已经处理过，状态: ${order.status}`);
    return;
  }
  
  // 检查是否已有卡密与此订单关联（防止重复分配）
  const existingCard = await Card.findOne({ orderId: order._id });
  if (existingCard) {
    console.log(`订单 ${order._id} 已关联卡密 ${existingCard._id}，跳过重复处理`);
    
    // 如果有卡密但订单状态不对，则更新订单状态
    if (order.status !== 'delivered') {
      order.status = 'delivered';
      order.cardId = existingCard._id;
      await order.save();
      console.log(`已更新订单 ${order._id} 状态为已发货`);
    }
    
    return;
  }
  
  // 先更新订单状态为已支付
  order.status = 'paid';
  order.paidAt = new Date();
  await order.save();
  
  // 找到一个未使用的卡密
  const card = await Card.findOneAndUpdate(
    { productId: order.productId, used: false },
    { used: true, orderId: order._id, usedAt: new Date() },
    { new: true }
  );
  
  if (!card) {
    console.error(`找不到可用的卡密，产品ID: ${order.productId}`);
    return;
  }
  
  // 更新订单状态为已发货
  order.status = 'delivered';
  order.cardId = card._id;
  await order.save();
  
  // 向用户发送卡密
  if (sendCardCallback) {
    await sendCardCallback(order.userId, order._id);
    console.log(`✅ 已成功向用户 ${order.userId} 发送卡密`);
  } else {
    console.error('sendCardCallback 未定义');
  }
  
  console.log(`✅ 已成功处理订单 ${order._id}`);
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
  handleCheckoutSessionCompleted,
  registerSendCardCallback
}; 