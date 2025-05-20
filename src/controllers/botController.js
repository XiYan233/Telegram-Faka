const { Product } = require('../models/productModel');
const { Order } = require('../models/orderModel');
const { Card } = require('../models/cardModel');
const stripeController = require('./stripeController');
const fs = require('fs');
const path = require('path');
const userMonitor = require('../utils/userMonitor');
const { Blacklist } = require('../models/blacklistModel');

let botInstance;

// 检查用户是否为管理员
function isAdmin(userId, adminUserIds) {
  return adminUserIds && adminUserIds.includes(userId.toString());
}

// 检查管理员权限，现在需要传入adminUserIds参数
async function checkAdmin(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  
  if (!isAdmin(userId, adminUserIds)) {
    await botInstance.sendMessage(chatId, '⚠️ 您没有权限访问管理员功能。');
    return false;
  }
  
  return true;
}

// 全部用户命令
const commands = [
  { command: 'start', description: '开始使用机器人' },
  { command: 'products', description: '查看可用产品列表' },
  { command: 'orders', description: '查看我的订单' },
  { command: 'help', description: '获取帮助信息' }
];

// 管理员命令
const adminCommands = [
  { command: 'admin', description: '管理员控制面板' },
  { command: 'addproduct', description: '添加新产品' },
  { command: 'editproduct', description: '编辑现有产品' },
  { command: 'importcards', description: '导入卡密' },
  { command: 'exportcards', description: '导出卡密' },
  { command: 'stats', description: '查看系统统计信息' }
];

const keyboard = {
  products: {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛒 查看商品列表', callback_data: 'view_products' }]
      ]
    }
  },
  admin: {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛒 管理产品', callback_data: 'manage_products' }],
        [{ text: '🔑 管理卡密', callback_data: 'manage_cards' }],
        [{ text: '📊 系统统计', callback_data: 'view_stats' }]
      ]
    }
  }
};

async function initBot(bot) {
  botInstance = bot;
  
  // 设置命令列表
  await bot.setMyCommands(commands);
  
  // 所有命令已在index.js中注册，此处不重复注册
  // bot.onText(/\/start/, handleStart);
  // bot.onText(/\/products/, handleProducts);
  // bot.onText(/\/orders/, handleOrders);
  // bot.onText(/\/help/, handleHelp);
  // bot.onText(/\/admin/, handleAdmin);
  // bot.onText(/\/addproduct/, handleAddProduct);
  // bot.onText(/\/editproduct/, handleEditProduct);
  // bot.onText(/\/importcards/, handleImportCards);
  // bot.onText(/\/exportcards/, handleExportCards);
  // bot.onText(/\/stats/, handleStats);
  
  // 注意: 回调查询处理已在入口文件中绑定，这里不重复绑定
  // bot.on('callback_query', handleCallbackQuery);
  
  // 处理文本消息 - 用于产品添加和卡密导入
  // 注意: 普通消息处理已在入口文件中绑定，这里不重复绑定
  // bot.on('message', (msg) => {
  //   if (msg.text && !msg.text.startsWith('/')) {
  //     onTextMessage(msg);
  //   }
  // });
  
  // 向 stripeController 注册发送卡密的回调函数
  try {
    stripeController.registerSendCardCallback(sendCardToUser);
    console.log('成功向 stripeController 注册卡密发送回调');
  } catch (error) {
    console.error('注册卡密发送回调失败:', error);
  }
  
  // 向 userMonitor 注册封禁通知回调
  try {
    userMonitor.registerNotificationCallback(async (userId, reason, hours) => {
      try {
        await botInstance.sendMessage(
          userId,
          `⚠️ *账户已被限制*\n\n` +
          `原因: ${reason}\n` +
          `限制时长: ${hours}小时\n\n` +
          `如有疑问，请联系管理员。`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('发送封禁通知失败:', error);
      }
    });
    console.log('成功向 userMonitor 注册封禁通知回调');
  } catch (error) {
    console.error('注册封禁通知回调失败:', error);
  }
  
  console.log('✅ Telegram Bot 初始化成功');
}

// 处理 /start 命令
async function handleStart(msg, adminUserIds) {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || '用户';
  const userId = msg.from.id.toString();
  
  let welcomeMessage = `👋 你好，${firstName}！欢迎使用自动发卡机器人。\n\n` +
    `🛒 使用 /products 查看可用商品\n` +
    `📋 使用 /orders 查看您的订单\n` +
    `❓ 使用 /help 获取帮助`;
  
  // 如果是管理员，添加额外信息
  if (isAdmin(userId, adminUserIds)) {
    welcomeMessage += '\n\n🔧 管理员功能:\n' +
      '/admin - 打开管理面板\n' +
      '/stats - 查看系统统计';
  }
  
  await botInstance.sendMessage(
    chatId,
    welcomeMessage,
    keyboard.products
  );
}

// 处理 /products 命令
async function handleProducts(msg) {
  const chatId = msg.chat.id;
  
  try {
    const products = await Product.find({ active: true });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '😢 目前没有可用商品。');
    }
    
    const inlineKeyboard = products.map(product => {
      return [{ text: `${product.name} - ¥${product.price}`, callback_data: `buy_${product._id}` }];
    });
    
    await botInstance.sendMessage(
      chatId,
      '🛒 可用商品列表：\n\n点击商品进行购买',
      {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取商品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取商品列表时出错，请稍后再试。');
  }
}

// 处理 /orders 命令
async function handleOrders(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  try {
    const orders = await Order.find({ userId }).populate('productId').sort({ createdAt: -1 }).limit(5);
    
    if (orders.length === 0) {
      return botInstance.sendMessage(chatId, '😊 您还没有订单记录。');
    }
    
    let message = '📋 您的最近订单：\n\n';
    
    for (const order of orders) {
      const status = getStatusEmoji(order.status);
      const productName = order.productId ? order.productId.name : '未知商品';
      
      message += `订单ID: ${order._id}\n`;
      message += `商品: ${productName}\n`;
      message += `金额: ¥${order.amount}\n`;
      message += `状态: ${status} ${order.status}\n`;
      message += `创建时间: ${formatDate(order.createdAt)}\n\n`;
    }
    
    await botInstance.sendMessage(chatId, message);
  } catch (error) {
    console.error('获取订单列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取订单列表时出错，请稍后再试。');
  }
}

// 处理 /help 命令
async function handleHelp(msg, adminUserIds) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  let helpMessage = '❓ *帮助信息*\n\n' +
    '本机器人提供自动发卡服务，您可以通过以下步骤购买商品：\n\n' +
    '1️⃣ 使用 /products 查看可用商品\n' +
    '2️⃣ 点击您想购买的商品\n' +
    '3️⃣ 通过提供的Stripe支付链接完成付款\n' +
    '4️⃣ 付款成功后，机器人会自动向您发送卡密\n\n' +
    '其他命令：\n' +
    '/orders - 查看您的订单历史\n' +
    '/start - 返回欢迎界面';
  
  // 如果是管理员，添加管理员帮助信息
  if (isAdmin(userId, adminUserIds)) {
    helpMessage += '\n\n🔧 *管理员命令*:\n' +
      '/admin - 管理员控制面板\n' +
      '/addproduct - 添加新产品\n' +
      '/editproduct - 编辑现有产品\n' +
      '/importcards - 导入卡密\n' +
      '/exportcards - 导出卡密\n' +
      '/stats - 查看系统统计信息\n' +
      '/cleanup - 清理超时未支付订单';
  }
  
  await botInstance.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
}

// 处理回调查询
async function handleCallbackQuery(callbackQuery, adminUserIds) {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const userId = callbackQuery.from.id.toString();
  
  // 先应答回调查询，移除加载状态
  await botInstance.answerCallbackQuery(callbackQuery.id);
  
  try {
    // 直接处理用户购买和查看商品操作
    if (action.startsWith('buy_')) {
      const productId = action.split('_')[1];
      await handleBuyProduct(chatId, userId, productId);
      return;
    }
    
    if (action === 'view_products') {
      await handleProducts({ chat: { id: chatId }, from: { id: userId } });
      return;
    }
    
    // 管理员操作 - 这些应该已经在adminController中处理过了，这里作为备用
    if (action === 'manage_products' || 
        action === 'manage_cards' || 
        action === 'view_stats' || 
        action === 'add_product' || 
        action.startsWith('edit_product_') || 
        action.startsWith('manage_cards_') || 
        action.startsWith('import_cards_') || 
        action.startsWith('export_cards_') || 
        action.startsWith('toggle_product_') || 
        action === 'confirm_add_product' || 
        action === 'cancel_add_product') {
      
      if (!isAdmin(userId, adminUserIds)) {
        await botInstance.sendMessage(chatId, '⚠️ 您没有权限访问管理功能。');
      }
      return; // 这些操作应该已由adminController处理，这里不再重复处理
    }
  } catch (error) {
    console.error('处理回调查询时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 操作失败，请稍后再试。');
  }
}

// 处理文本消息
async function onTextMessage(msg) {
  if (!msg.text || msg.text.startsWith('/')) return; // 跳过命令消息
  
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  const userData = userStates[userId];
  
  if (!userData) return; // 没有进行中的操作
  
  // 处理添加产品的各个步骤
  if (userData.state === 'adding_product') {
    switch (userData.step) {
      case 'name':
        userData.productData.name = msg.text;
        userData.step = 'description';
        await botInstance.sendMessage(chatId, '请输入产品描述：');
        break;
      
      case 'description':
        userData.productData.description = msg.text;
        userData.step = 'price';
        await botInstance.sendMessage(chatId, '请输入产品价格（数字）：');
        break;
      
      case 'price':
        const price = parseFloat(msg.text);
        if (isNaN(price) || price <= 0) {
          await botInstance.sendMessage(chatId, '❌ 价格格式错误，请输入有效的数字：');
          return;
        }
        
        userData.productData.price = price;
        userData.step = 'confirm';
        
        await botInstance.sendMessage(
          chatId,
          `✅ *请确认产品信息*\n\n` +
          `名称: ${userData.productData.name}\n` +
          `描述: ${userData.productData.description}\n` +
          `价格: ¥${userData.productData.price}\n\n` +
          `是否添加该产品？`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ 确认添加', callback_data: 'confirm_add_product' },
                  { text: '❌ 取消', callback_data: 'cancel_add_product' }
                ]
              ]
            }
          }
        );
        break;
    }
  }
  
  // 处理导入卡密
  if (userData.state === 'importing_cards') {
    const productId = userData.productId;
    const cardLines = msg.text.split('\n').filter(line => line.trim() !== '');
    
    if (cardLines.length === 0) {
      await botInstance.sendMessage(chatId, '❌ 未检测到有效卡密，请重新发送。');
      return;
    }
    
    try {
      const product = await Product.findById(productId);
      
      if (!product) {
        await botInstance.sendMessage(chatId, '❌ 找不到关联产品，导入失败。');
        delete userStates[userId];
        return;
      }
      
      // 检查卡密是否已存在
      const existingCodes = new Set(
        (await Card.find({ code: { $in: cardLines } }).select('code')).map(card => card.code)
      );
      
      // 筛选出未存在的卡密
      const newCards = cardLines
        .filter(code => !existingCodes.has(code))
        .map(code => ({
          productId,
          code,
          used: false
        }));
      
      if (newCards.length === 0) {
        await botInstance.sendMessage(chatId, '❌ 所有卡密都已存在，未导入任何卡密。');
      } else {
        // 批量插入卡密
        await Card.insertMany(newCards);
        
        await botInstance.sendMessage(
          chatId,
          `✅ 卡密导入成功！\n\n` +
          `产品: ${product.name}\n` +
          `导入数量: ${newCards.length}/${cardLines.length}\n` +
          `已存在/跳过: ${cardLines.length - newCards.length}`
        );
      }
      
      // 清除状态
      delete userStates[userId];
      
      // 返回卡密管理
      return handleProductCards(chatId, userId, productId);
      
    } catch (error) {
      console.error('导入卡密时出错:', error);
      await botInstance.sendMessage(chatId, '❌ 导入卡密时出错，请稍后再试。');
      delete userStates[userId];
    }
  }
}

// 确认添加产品
async function confirmAddProduct(chatId, userId, callbackQueryId) {
  const userData = userStates[userId];
  if (!userData || userData.state !== 'adding_product' || userData.step !== 'confirm') {
    return;
  }
  
  try {
    // 创建新产品
    const newProduct = new Product({
      name: userData.productData.name,
      description: userData.productData.description,
      price: userData.productData.price,
      active: true
    });
    
    await newProduct.save();
    
    // 清除用户状态
    delete userStates[userId];
    
    await botInstance.answerCallbackQuery(callbackQueryId, { text: '产品添加成功！' });
    await botInstance.sendMessage(
      chatId,
      `✅ 产品添加成功！\n\n` +
      `名称: ${newProduct.name}\n` +
      `价格: ¥${newProduct.price}`
    );
    
    // 返回产品管理
    return handleManageProducts(chatId, userId);
    
  } catch (error) {
    console.error('添加产品时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 添加产品时出错，请稍后再试。');
  }
}

// 取消添加产品
async function cancelAddProduct(chatId, userId, callbackQueryId) {
  // 清除用户状态
  delete userStates[userId];
  
  await botInstance.answerCallbackQuery(callbackQueryId, { text: '已取消添加产品' });
  await botInstance.sendMessage(chatId, '❌ 已取消添加产品。');
  
  // 返回产品管理
  return handleManageProducts(chatId, userId);
}

// 启动添加产品过程
async function startAddProduct(chatId, userId) {
  // 创建一个对话状态来收集产品信息
  const userData = userStates[userId] || {};
  userData.state = 'adding_product';
  userData.productData = {};
  userData.step = 'name';
  userStates[userId] = userData;
  
  await botInstance.sendMessage(
    chatId,
    '➕ *添加新产品*\n\n' +
    '请输入产品名称：',
    { parse_mode: 'Markdown' }
  );
}

// 根据ID编辑产品
async function handleEditProductById(chatId, userId, productId) {
  try {
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 找不到该产品。');
    }
    
    const activeStatus = product.active ? '✅ 活跃' : '❌ 停用';
    
    const editKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ 编辑名称', callback_data: `edit_name_${productId}` }],
          [{ text: '✏️ 编辑描述', callback_data: `edit_desc_${productId}` }],
          [{ text: '✏️ 编辑价格', callback_data: `edit_price_${productId}` }],
          [{ text: `${activeStatus}`, callback_data: `toggle_product_${productId}` }],
          [{ text: '⬅️ 返回产品管理', callback_data: 'manage_products' }]
        ]
      }
    };
    
    await botInstance.sendMessage(
      chatId,
      `✏️ *编辑产品*\n\n` +
      `产品ID: ${product._id}\n` +
      `名称: ${product.name}\n` +
      `描述: ${product.description}\n` +
      `价格: ¥${product.price}\n` +
      `状态: ${activeStatus}\n\n` +
      `选择要编辑的项目：`,
      {
        parse_mode: 'Markdown',
        ...editKeyboard
      }
    );
  } catch (error) {
    console.error('获取产品详情时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品详情时出错，请稍后再试。');
  }
}

// 切换产品状态
async function toggleProductStatus(chatId, userId, productId) {
  try {
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 找不到该产品。');
    }
    
    // 切换状态
    product.active = !product.active;
    await product.save();
    
    const statusText = product.active ? '✅ 已激活' : '❌ 已停用';
    await botInstance.sendMessage(chatId, `${statusText}产品: ${product.name}`);
    
    // 返回编辑页面
    return handleEditProductById(chatId, userId, productId);
    
  } catch (error) {
    console.error('切换产品状态时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 切换产品状态时出错，请稍后再试。');
  }
}

// 存储用户状态
const userStates = {};

// 处理产品卡密管理
async function handleProductCards(chatId, userId, productId) {
  try {
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 找不到该产品。');
    }
    
    // 获取该产品的卡密统计
    const totalCards = await Card.countDocuments({ productId });
    const usedCards = await Card.countDocuments({ productId, used: true });
    const unusedCards = await Card.countDocuments({ productId, used: false });
    
    const cardKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📥 导入卡密', callback_data: `import_cards_${productId}` }],
          [{ text: '📤 导出未使用卡密', callback_data: `export_cards_${productId}_unused` }],
          [{ text: '📤 导出全部卡密', callback_data: `export_cards_${productId}_all` }],
          [{ text: '⬅️ 返回卡密管理', callback_data: 'manage_cards' }]
        ]
      }
    };
    
    await botInstance.sendMessage(
      chatId,
      `🔑 *${product.name} 的卡密管理*\n\n` +
      `卡密总数: ${totalCards}\n` +
      `已使用: ${usedCards}\n` +
      `未使用: ${unusedCards}\n\n` +
      `选择操作：`,
      {
        parse_mode: 'Markdown',
        ...cardKeyboard
      }
    );
  } catch (error) {
    console.error('获取产品卡密信息时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品卡密信息时出错，请稍后再试。');
  }
}

// 启动导入卡密流程
async function startImportCards(chatId, userId, productId) {
  try {
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 找不到该产品。');
    }
    
    // 设置用户状态为导入卡密
    const userData = userStates[userId] || {};
    userData.state = 'importing_cards';
    userData.productId = productId;
    userStates[userId] = userData;
    
    await botInstance.sendMessage(
      chatId,
      `📥 *导入卡密到 ${product.name}*\n\n` +
      `请将卡密以文本形式发送，每行一个卡密。\n\n` +
      `例如:\n` +
      `CARD-1234-5678\n` +
      `CARD-8765-4321\n` +
      `...`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('启动导入卡密流程时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 操作失败，请稍后再试。');
  }
}

// 处理导出卡密
async function handleExportCardsByProduct(chatId, userId, productId, type = 'unused') {
  try {
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 找不到该产品。');
    }
    
    // 查询条件
    const query = { productId };
    if (type === 'unused') {
      query.used = false;
    }
    
    // 查找卡密
    const cards = await Card.find(query);
    
    if (cards.length === 0) {
      return botInstance.sendMessage(chatId, '📤 没有找到符合条件的卡密。');
    }
    
    // 生成卡密文本
    let cardText = `${product.name} 的卡密列表:\n\n`;
    cards.forEach(card => {
      cardText += `${card.code} | ${card.used ? '已使用' : '未使用'}\n`;
    });
    
    // 如果卡密太多，分批发送
    if (cardText.length > 4000) {
      const chunks = [];
      let currentChunk = `${product.name} 的卡密列表 (1/${Math.ceil(cardText.length / 3000)}):\n\n`;
      
      cards.forEach(card => {
        const cardLine = `${card.code} | ${card.used ? '已使用' : '未使用'}\n`;
        
        if (currentChunk.length + cardLine.length > 3000) {
          chunks.push(currentChunk);
          currentChunk = `${product.name} 的卡密列表 (${chunks.length + 1}/${Math.ceil(cardText.length / 3000)}):\n\n`;
        }
        
        currentChunk += cardLine;
      });
      
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      
      // 逐个发送分块
      for (const chunk of chunks) {
        await botInstance.sendMessage(chatId, chunk);
      }
    } else {
      await botInstance.sendMessage(chatId, cardText);
    }
    
    // 返回卡密管理页面
    return handleProductCards(chatId, userId, productId);
  } catch (error) {
    console.error('导出卡密时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 导出卡密时出错，请稍后再试。');
  }
}

// 添加新产品处理函数
async function handleAddProduct(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  // 启动添加产品过程
  startAddProduct(chatId, userId);
}

// 编辑产品处理函数
async function handleEditProduct(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '❌ 没有可编辑的产品，请先添加产品。');
    }
    
    const inlineKeyboard = products.map(product => {
      const status = product.active ? '✅' : '❌';
      return [{ text: `${status} ${product.name}`, callback_data: `edit_product_${product._id}` }];
    });
    
    await botInstance.sendMessage(
      chatId,
      '✏️ *编辑产品*\n\n请选择要编辑的产品：',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取产品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品列表时出错，请稍后再试。');
  }
}

// 导入卡密处理函数
async function handleImportCards(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '❌ 没有产品，请先添加产品。');
    }
    
    const inlineKeyboard = products.map(product => {
      return [{ text: product.name, callback_data: `import_cards_${product._id}` }];
    });
    
    await botInstance.sendMessage(
      chatId,
      '📥 *导入卡密*\n\n选择要导入卡密的产品：',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取产品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品列表时出错，请稍后再试。');
  }
}

// 导出卡密处理函数
async function handleExportCards(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '❌ 没有产品，请先添加产品。');
    }
    
    const inlineKeyboard = products.map(product => {
      return [{ text: product.name, callback_data: `export_cards_${product._id}_unused` }];
    });
    
    await botInstance.sendMessage(
      chatId,
      '📤 *导出卡密*\n\n选择要导出卡密的产品：',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取产品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品列表时出错，请稍后再试。');
  }
}

// 处理管理产品
async function handleManageProducts(chatId, userId) {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '🔍 暂无产品数据，请先添加产品。', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ 添加新产品', callback_data: 'add_product' }]
          ]
        }
      });
    }
    
    const inlineKeyboard = products.map(product => {
      const status = product.active ? '✅' : '❌';
      return [{ 
        text: `${status} ${product.name} - ¥${product.price}`, 
        callback_data: `edit_product_${product._id}` 
      }];
    });
    
    // 添加添加产品按钮
    inlineKeyboard.push([{ text: '➕ 添加新产品', callback_data: 'add_product' }]);
    
    await botInstance.sendMessage(
      chatId,
      '🛒 *产品管理*\n\n选择一个产品进行编辑或添加新产品：',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取产品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品列表时出错，请稍后再试。');
  }
}

// 处理管理卡密
async function handleManageCards(chatId, userId) {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    
    if (products.length === 0) {
      return botInstance.sendMessage(chatId, '🔍 暂无产品数据，请先添加产品。');
    }
    
    const inlineKeyboard = products.map(product => {
      return [{ 
        text: `${product.name}`, 
        callback_data: `manage_cards_${product._id}` 
      }];
    });
    
    await botInstance.sendMessage(
      chatId,
      '🔑 *卡密管理*\n\n选择一个产品进行卡密管理：',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );
  } catch (error) {
    console.error('获取产品列表时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取产品列表时出错，请稍后再试。');
  }
}

// 辅助函数：获取状态emoji
function getStatusEmoji(status) {
  switch (status) {
    case 'pending': return '⏳';
    case 'paid': return '💰';
    case 'failed': return '❌';
    case 'delivered': return '✅';
    case 'expired': return '⌛';
    default: return '❓';
  }
}

// 辅助函数：格式化日期
function formatDate(date) {
  return new Date(date).toLocaleString();
}

// 处理 /admin 命令
async function handleAdmin(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  await botInstance.sendMessage(
    chatId,
    '🔧 *管理员控制面板*\n\n' +
    '请选择一个操作：',
    {
      parse_mode: 'Markdown',
      ...keyboard.admin
    }
  );
}

// 处理 /stats 命令
async function handleStats(msg, adminUserIds) {
  if (!isAdmin(msg.from.id.toString(), adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
  try {
    const totalProducts = await Product.countDocuments();
    const activeProducts = await Product.countDocuments({ active: true });
    const totalCards = await Card.countDocuments();
    const usedCards = await Card.countDocuments({ used: true });
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ status: 'pending' });
    const expiredOrders = await Order.countDocuments({ status: 'expired' });
    const completedOrders = await Order.countDocuments({ status: 'delivered' });
    
    const statsMessage = 
      '📊 *系统统计信息*\n\n' +
      `🛒 产品数量：${activeProducts}/${totalProducts}\n` +
      `🔑 卡密数量：${usedCards}/${totalCards}\n` +
      `📃 订单总量：${totalOrders}\n` +
      `⏳ 待处理订单：${pendingOrders}\n` +
      `⌛ 已过期订单：${expiredOrders}\n` +
      `✅ 已完成订单：${completedOrders}`;
    
    await botInstance.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('获取统计信息时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 获取统计信息时出错，请稍后再试。');
  }
}

// 向用户发送卡密
async function sendCardToUser(userId, orderId) {
  try {
    // 查找订单信息
    const order = await Order.findById(orderId).populate('productId');
    
    if (!order) {
      console.error(`找不到订单: ${orderId}`);
      return false;
    }
    
    // 检查订单是否已有关联的卡密
    if (order.cardId) {
      console.log(`订单 ${orderId} 已关联卡密 ${order.cardId}，查找卡密信息`);
      
      // 查找关联的卡密
      const existingCard = await Card.findById(order.cardId);
      if (existingCard) {
        console.log(`为订单 ${orderId} 找到已关联的卡密`);
        
        // 直接使用现有卡密发送给用户
        await botInstance.sendMessage(
          userId,
          `✅ *订单已完成*\n\n` +
          `商品: ${order.productId.name}\n` +
          `订单号: ${order._id}\n` +
          `卡密: \`${existingCard.code}\`\n\n` +
          `感谢您的购买！`,
          { parse_mode: 'Markdown' }
        );
        
        return true;
      }
    }
    
    // 检查是否已有卡密与此订单关联（通过orderId查询）
    const assignedCard = await Card.findOne({ orderId: order._id });
    if (assignedCard) {
      console.log(`订单 ${orderId} 已有关联卡密，直接发送`);
      
      // 确保订单状态正确
      if (order.status !== 'delivered' || !order.cardId) {
        order.status = 'delivered';
        order.cardId = assignedCard._id;
        await order.save();
      }
      
      // 发送卡密给用户
      await botInstance.sendMessage(
        userId,
        `✅ *订单已完成*\n\n` +
        `商品: ${order.productId.name}\n` +
        `订单号: ${order._id}\n` +
        `卡密: \`${assignedCard.code}\`\n\n` +
        `感谢您的购买！`,
        { parse_mode: 'Markdown' }
      );
      
      return true;
    }
    
    // 如果没有关联的卡密，查找新的可用卡密
    const card = await Card.findOneAndUpdate(
      { productId: order.productId._id, used: false },
      { used: true, orderId, userId },
      { new: true }
    );
    
    if (!card) {
      console.error(`无可用卡密: ${order.productId.name}`);
      await botInstance.sendMessage(
        userId,
        `❌ 抱歉，商品 ${order.productId.name} 暂时缺货，请联系管理员。`
      );
      return false;
    }
    
    // 更新订单状态为已发货
    order.status = 'delivered';
    order.cardId = card._id;
    await order.save();
    
    // 发送卡密给用户
    await botInstance.sendMessage(
      userId,
      `✅ *订单已完成*\n\n` +
      `商品: ${order.productId.name}\n` +
      `订单号: ${order._id}\n` +
      `卡密: \`${card.code}\`\n\n` +
      `感谢您的购买！`,
      { parse_mode: 'Markdown' }
    );
    
    return true;
  } catch (error) {
    console.error('发送卡密时出错:', error);
    return false;
  }
}

// 处理购买产品
async function handleBuyProduct(chatId, userId, productId) {
  try {
    console.log(`开始处理购买请求: 用户=${userId}, 产品=${productId}`);
    
    // 检查用户是否被拉黑
    try {
      const isBlacklisted = await Blacklist.isBlacklisted(userId);
      if (isBlacklisted) {
        const remainingTime = Math.max(0, Math.floor((isBlacklisted.banUntil - new Date()) / (1000 * 60 * 60)));
        return botInstance.sendMessage(
          chatId,
          `⚠️ *暂时无法购买*\n\n` +
          `您的账户因异常行为被暂时限制，剩余时间: ${remainingTime}小时\n` +
          `原因: ${isBlacklisted.reason}\n\n` +
          `如有疑问，请联系管理员。`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (blacklistError) {
      console.error('检查用户黑名单状态时出错:', blacklistError);
      // 继续执行，不中断购买流程
    }
    
    const product = await Product.findById(productId);
    
    if (!product) {
      return botInstance.sendMessage(chatId, '❌ 产品不存在或已下架。');
    }
    
    console.log(`找到产品: ${product.name}, 价格: ${product.price}`);
    
    if (!product.active) {
      return botInstance.sendMessage(chatId, '❌ 该产品已下架，暂不可购买。');
    }
    
    // 检查库存
    const stockCount = await Card.countDocuments({ productId, used: false });
    if (stockCount <= 0) {
      return botInstance.sendMessage(chatId, `❌ 抱歉，${product.name} 已售罄，请选择其他商品。`);
    }
    
    console.log(`产品库存充足: ${stockCount}张卡密可用`);
    
    // 检查用户是否在短时间内创建了过多pending订单
    try {
      await userMonitor.checkUserPendingOrders(userId);
    } catch (monitorError) {
      console.error('检查用户pending订单时出错:', monitorError);
      // 继续执行，不中断购买流程
    }
    
    try {
      // 检查Stripe配置
      console.log('Stripe密钥配置: ', process.env.STRIPE_SECRET_KEY ? '已设置' : '未设置');
      
      // 创建支付会话
      console.log('正在创建Stripe支付会话...');
      const paymentInfo = await stripeController.createCheckoutSession(
        'temp_' + new Date().getTime(), // 临时ID
        product.name,
        product.price,
        userId
      );
      
      console.log('Stripe支付会话创建结果: ', paymentInfo ? '成功' : '失败');
      
      if (!paymentInfo || !paymentInfo.sessionId || !paymentInfo.paymentUrl) {
        throw new Error('创建支付链接失败: ' + JSON.stringify(paymentInfo));
      }
      
      // 先创建一个临时订单
      console.log('创建订单记录...');
      const order = new Order({
        userId,
        productId: product._id,
        amount: product.price,
        status: 'pending',
        stripeSessionId: paymentInfo.sessionId,
        paymentUrl: paymentInfo.paymentUrl
      });
      
      // 保存订单
      await order.save();
      console.log(`订单创建成功: ${order._id}`);
      
      // 创建订单后再次检查是否超过限制
      try {
        const isRestricted = await userMonitor.checkUserPendingOrders(userId);
        if (isRestricted) {
          // 用户已被限制，提前结束
          return botInstance.sendMessage(
            chatId,
            `⚠️ *系统提醒*\n\n` +
            `检测到您短时间内创建了多个未支付的订单，为防止滥用，您的账户已被临时限制使用。\n` +
            `请12小时后再试，或联系管理员解除限制。`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (recheckError) {
        console.error('二次检查用户pending订单时出错:', recheckError);
      }
      
      // 只发送一条包含完整信息的消息
      await botInstance.sendMessage(
        chatId,
        `🛒 *商品订单*\n\n` +
        `商品: ${product.name}\n` +
        `价格: ¥${product.price}\n` +
        `订单ID: ${order._id}\n\n` +
        `请在30分钟内完成支付，超时订单将自动取消。\n` +
        `请点击下方按钮完成支付:`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 点击支付', url: paymentInfo.paymentUrl }]
            ]
          }
        }
      );
      
      console.log('成功向用户发送支付链接');
      
    } catch (stripeError) {
      console.error('Stripe处理错误:', stripeError);
      throw stripeError;
    }
    
  } catch (error) {
    console.error('处理购买请求时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 创建订单失败，请稍后再试。');
  }
}

module.exports = {
  initBot,
  sendCardToUser,
  handleCallbackQuery,
  onTextMessage,
  handleAdmin,
  handleAddProduct,
  handleEditProduct,
  handleImportCards,
  handleExportCards,
  handleStats,
  handleStart,
  handleHelp,
  handleProducts,
  handleOrders
};