/**
 * 管理员控制器，处理产品和卡密管理功能
 */
const { Product } = require('../models/productModel');
const { Card } = require('../models/cardModel');
const { Order } = require('../models/orderModel');
const { cleanupPendingOrders } = require('../utils/orderCleanup');
const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios');
// 为了支持文件下载，设置读取文件和创建临时目录的Promise
const writeFileAsync = util.promisify(fs.writeFile);
const mkdirAsync = util.promisify(fs.mkdir);
const readFileAsync = util.promisify(fs.readFile);
const unlinkAsync = util.promisify(fs.unlink);

// 存储用户状态
const userStates = {};
let botInstance = null;

/**
 * 初始化管理员控制器
 */
function initAdminController(bot) {
  botInstance = bot;
}

/**
 * 检查用户是否为管理员
 */
function isAdmin(userId, adminUserIds) {
  return adminUserIds.includes(userId.toString());
}

/**
 * 处理管理员权限检查
 */
async function checkAdmin(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  const chatId = msg.chat.id;
  
  if (!isAdmin(userId, adminUserIds)) {
    await botInstance.sendMessage(chatId, '⚠️ 您没有权限访问管理员功能。');
    return false;
  }
  
  return true;
}

/**
 * 处理 /admin 命令
 */
async function handleAdmin(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
  const chatId = msg.chat.id;
  await botInstance.sendMessage(
    chatId,
    '🔧 *管理员控制面板*\n\n' +
    '请选择一个操作：',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 管理产品', callback_data: 'manage_products' }],
          [{ text: '🔑 管理卡密', callback_data: 'manage_cards' }],
          [{ text: '📊 系统统计', callback_data: 'view_stats' }]
        ]
      }
    }
  );
}

/**
 * 处理管理产品请求
 */
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

/**
 * 处理管理卡密请求
 */
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

/**
 * 处理产品卡密管理
 */
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

/**
 * 启动导入卡密流程
 */
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
      `您可以通过以下两种方式导入卡密：\n\n` +
      `1️⃣ 直接发送文本消息，每行一个卡密\n` +
      `例如:\n` +
      `CARD-1234-5678\n` +
      `CARD-8765-4321\n\n` +
      `2️⃣ 上传TXT文本文件，每行一个卡密\n\n` +
      `注意：文本文件必须是UTF-8编码，每行一个卡密`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('启动导入卡密流程时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 操作失败，请稍后再试。');
  }
}

/**
 * 处理导出卡密
 */
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

/**
 * 启动添加产品过程
 */
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

/**
 * 根据ID编辑产品
 */
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

/**
 * 切换产品状态
 */
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

/**
 * 确认添加产品
 */
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

/**
 * 取消添加产品
 */
async function cancelAddProduct(chatId, userId, callbackQueryId) {
  // 清除用户状态
  delete userStates[userId];
  
  await botInstance.answerCallbackQuery(callbackQueryId, { text: '已取消添加产品' });
  await botInstance.sendMessage(chatId, '❌ 已取消添加产品。');
  
  // 返回产品管理
  return handleManageProducts(chatId, userId);
}

/**
 * 处理 /stats 命令
 */
async function handleStats(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
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

/**
 * 添加新产品处理函数
 */
async function handleAddProduct(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
  // 启动添加产品过程
  startAddProduct(chatId, userId);
}

/**
 * 编辑产品处理函数
 */
async function handleEditProduct(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
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

/**
 * 导入卡密处理函数
 */
async function handleImportCards(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
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

/**
 * 导出卡密处理函数
 */
async function handleExportCards(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
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

/**
 * 处理管理员相关的回调查询
 */
async function handleAdminCallbacks(callbackQuery, adminUserIds) {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const userId = callbackQuery.from.id.toString();
  
  // 检查是否为管理员
  if (!isAdmin(userId, adminUserIds)) {
    await botInstance.answerCallbackQuery(callbackQuery.id, { text: '无权限' });
    await botInstance.sendMessage(chatId, '⚠️ 您没有权限访问管理功能。');
    return true; // 已处理
  }
  
  // 先应答回调查询，移除加载状态
  await botInstance.answerCallbackQuery(callbackQuery.id);
  
  try {
    // 处理管理产品
    if (action === 'manage_products') {
      await handleManageProducts(chatId, userId);
      return true;
    }
    
    // 处理管理卡密
    if (action === 'manage_cards') {
      await handleManageCards(chatId, userId);
      return true;
    }
    
    // 处理统计信息
    if (action === 'view_stats') {
      await handleStats({ chat: { id: chatId }, from: { id: userId } }, adminUserIds);
      return true;
    }
    
    // 处理添加产品
    if (action === 'add_product') {
      await startAddProduct(chatId, userId);
      return true;
    }
    
    // 处理编辑产品
    if (action.startsWith('edit_product_')) {
      const productId = action.split('_')[2];
      await handleEditProductById(chatId, userId, productId);
      return true;
    }
    
    // 处理切换产品状态
    if (action.startsWith('toggle_product_')) {
      const productId = action.split('_')[2];
      await toggleProductStatus(chatId, userId, productId);
      return true;
    }
    
    // 处理卡密管理
    if (action.startsWith('manage_cards_')) {
      const productId = action.split('_')[2];
      await handleProductCards(chatId, userId, productId);
      return true;
    }
    
    // 处理导入卡密
    if (action.startsWith('import_cards_')) {
      const productId = action.split('_')[2];
      await startImportCards(chatId, userId, productId);
      return true;
    }
    
    // 处理导出卡密
    if (action.startsWith('export_cards_')) {
      const parts = action.split('_');
      const productId = parts[2];
      const type = parts[3] || 'unused';
      await handleExportCardsByProduct(chatId, userId, productId, type);
      return true;
    }
    
    // 处理确认添加产品
    if (action === 'confirm_add_product') {
      await confirmAddProduct(chatId, userId, callbackQuery.id);
      return true;
    }
    
    // 处理取消添加产品
    if (action === 'cancel_add_product') {
      await cancelAddProduct(chatId, userId, callbackQuery.id);
      return true;
    }
    
    return false; // 不是管理员回调
  } catch (error) {
    console.error('处理管理员回调时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 操作失败，请稍后再试。');
    return true; // 已处理，避免进一步处理
  }
}

/**
 * 处理管理员文本消息
 */
async function handleAdminTextMessage(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  
  // 检查是否为管理员
  if (!isAdmin(userId, adminUserIds)) {
    return false;
  }
  
  const chatId = msg.chat.id;
  const userData = userStates[userId];
  
  if (!userData) return false; // 没有进行中的操作
  
  // 处理添加产品的各个步骤
  if (userData.state === 'adding_product') {
    switch (userData.step) {
      case 'name':
        userData.productData.name = msg.text;
        userData.step = 'description';
        await botInstance.sendMessage(chatId, '请输入产品描述：');
        return true;
      
      case 'description':
        userData.productData.description = msg.text;
        userData.step = 'price';
        await botInstance.sendMessage(chatId, '请输入产品价格（数字）：');
        return true;
      
      case 'price':
        const price = parseFloat(msg.text);
        if (isNaN(price) || price <= 0) {
          await botInstance.sendMessage(chatId, '❌ 价格格式错误，请输入有效的数字：');
          return true;
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
        return true;
    }
  }
  
  // 处理导入卡密 - 文本消息方式
  if (userData.state === 'importing_cards' && msg.text) {
    const productId = userData.productId;
    const cardLines = msg.text.split('\n').filter(line => line.trim() !== '');
    
    if (cardLines.length === 0) {
      await botInstance.sendMessage(chatId, '❌ 未检测到有效卡密，请重新发送。');
      return true;
    }
    
    try {
      const product = await Product.findById(productId);
      
      if (!product) {
        await botInstance.sendMessage(chatId, '❌ 找不到关联产品，导入失败。');
        delete userStates[userId];
        return true;
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
      
      // 返回卡密管理 - 这里不使用return，避免重复返回
      await handleProductCards(chatId, userId, productId);
      return true;
      
    } catch (error) {
      console.error('导入卡密时出错:', error);
      await botInstance.sendMessage(chatId, '❌ 导入卡密时出错，请稍后再试。');
      delete userStates[userId];
      return true;
    }
  }
  
  return false; // 不是管理员操作
}

/**
 * 处理文件上传 - 导入卡密
 */
async function processFileUpload(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  
  // 检查是否为管理员
  if (!isAdmin(userId, adminUserIds)) {
    return false;
  }
  
  const chatId = msg.chat.id;
  const userData = userStates[userId];
  
  if (!userData || userData.state !== 'importing_cards') {
    return false; // 不是在导入卡密状态
  }
  
  // 检查是否有文件
  if (!msg.document) {
    return false;
  }
  
  try {
    // 获取文件扩展名
    const fileName = msg.document.file_name;
    const fileExt = path.extname(fileName).toLowerCase();
    
    // 只接受txt文件
    if (fileExt !== '.txt') {
      await botInstance.sendMessage(
        chatId, 
        '❌ 不支持的文件格式，请上传TXT文本文件。'
      );
      return true;
    }
    
    await botInstance.sendMessage(chatId, '⏳ 正在处理文件，请稍候...');
    
    // 获取文件信息
    const fileId = msg.document.file_id;
    const fileInfo = await botInstance.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    
    // 创建临时目录（如果不存在）
    const tempDir = path.join(__dirname, '../../temp');
    try {
      await mkdirAsync(tempDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    
    // 下载文件到临时目录
    const tempFilePath = path.join(tempDir, `${userId}_${Date.now()}.txt`);
    
    // 下载文件
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'arraybuffer'
    });
    
    // 写入文件
    await writeFileAsync(tempFilePath, response.data);
    
    // 读取文件内容
    const fileContent = await readFileAsync(tempFilePath, 'utf8');
    
    // 删除临时文件
    try {
      await unlinkAsync(tempFilePath);
    } catch (error) {
      console.error('删除临时文件时出错:', error);
      // 继续执行，不中断流程
    }
    
    // 处理卡密导入
    const productId = userData.productId;
    const cardLines = fileContent.split('\n').filter(line => line.trim() !== '');
    
    if (cardLines.length === 0) {
      await botInstance.sendMessage(chatId, '❌ 文件中未检测到有效卡密，请检查文件内容。');
      return true;
    }
    
    const product = await Product.findById(productId);
    
    if (!product) {
      await botInstance.sendMessage(chatId, '❌ 找不到关联产品，导入失败。');
      delete userStates[userId];
      return true;
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
    await handleProductCards(chatId, userId, productId);
    return true;
    
  } catch (error) {
    console.error('处理文件上传时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 处理文件时出错，请稍后再试: ' + error.message);
    delete userStates[userId];
    return true;
  }
}

/**
 * 手动清理过期订单
 */
async function handleCleanupOrders(msg, adminUserIds) {
  const userId = msg.from.id.toString();
  if (!isAdmin(userId, adminUserIds)) return;
  
  const chatId = msg.chat.id;
  
  try {
    await botInstance.sendMessage(chatId, '🔄 正在清理超时订单...');
    
    // 默认超时时间为30分钟
    const result = await cleanupPendingOrders(30);
    
    if (result.count === 0) {
      await botInstance.sendMessage(chatId, '✅ 没有发现需要清理的超时订单。');
    } else {
      await botInstance.sendMessage(
        chatId,
        `✅ 清理完成，共处理 ${result.count} 个超时订单。\n\n` +
        `这些订单已被标记为"expired"状态。`
      );
    }
  } catch (error) {
    console.error('手动清理订单时出错:', error);
    await botInstance.sendMessage(chatId, '❌ 清理订单时出错，请稍后再试。');
  }
}

module.exports = {
  initAdminController,
  isAdmin,
  checkAdmin,
  handleAdmin,
  handleAddProduct,
  handleEditProduct,
  handleImportCards,
  handleExportCards,
  handleStats,
  handleAdminCallbacks,
  handleAdminTextMessage,
  handleCleanupOrders,
  processFileUpload
}; 