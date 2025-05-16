require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const botController = require('./controllers/botController');
const adminController = require('./controllers/adminController');
const stripeController = require('./controllers/stripeController');
const { Product } = require('./models/productModel');
const { Order } = require('./models/orderModel');
const { Card } = require('./models/cardModel');
const { errorHandler } = require('./utils/errorHandler');
const { startCleanupSchedule } = require('./utils/orderCleanup');

// 装载管理员ID
const adminUserIds = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];

// 初始化Express应用
const app = express();

// 注意: 先注册Stripe webhook路由，确保它接收到原始请求体
// Stripe Webhook处理路由 - 必须在express.json()之前
app.post('/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

// 测试环境webhook模拟路由 - 用于开发测试
app.post('/test-webhook', express.json(), (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  
  console.log('收到测试webhook请求:', req.body);
  
  // 将请求转发到stripeController处理
  try {
    // 直接处理测试事件
    const event = req.body;
    if (event && event.type === 'checkout.session.completed' && event.data && event.data.object) {
      stripeController.handleCheckoutSessionCompleted(event.data.object)
        .then(() => {
          console.log('测试webhook处理成功');
          res.status(200).json({ received: true });
        })
        .catch(err => {
          console.error('测试webhook处理失败:', err);
          res.status(500).json({ error: err.message });
        });
    } else {
      res.status(400).json({ error: '无效的测试事件' });
    }
  } catch (err) {
    console.error('处理测试webhook时出错:', err);
    res.status(500).json({ error: err.message });
  }
});

// 然后才启用JSON解析中间件
app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 连接MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram-faka')
  .then(() => console.log('✅ MongoDB连接成功'))
  .catch(err => console.error('❌ MongoDB连接失败:', err));

// 初始化Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// 先初始化Bot控制器，再初始化管理员控制器，避免循环依赖问题
console.log('正在初始化机器人控制器...');
botController.initBot(bot);

// 初始化管理员控制器
console.log('正在初始化管理员控制器...');
adminController.initAdminController(bot);

// 处理Telegram消息
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    // 先尝试管理员处理
    const handled = await adminController.handleAdminTextMessage(msg, adminUserIds);
    if (!handled) {
      // 如果不是管理员操作，转给普通消息处理
      botController.onTextMessage && botController.onTextMessage(msg);
    }
  } else if (msg.document) {
    // 处理文件上传 - 主要用于卡密导入
    await adminController.processFileUpload(msg, adminUserIds);
  }
});

// 处理回调查询
bot.on('callback_query', async (callbackQuery) => {
  // 只有非buy_开头的操作才经过管理员判断
  if (!callbackQuery.data.startsWith('buy_') && !callbackQuery.data.startsWith('view_products')) {
    // 尝试管理员处理
    const handled = await adminController.handleAdminCallbacks(callbackQuery, adminUserIds);
    if (handled) {
      return; // 已由管理员控制器处理
    }
  }
  
  // 如果不是管理员操作，或是购买和查看商品操作，交给普通回调处理
  botController.handleCallbackQuery(callbackQuery, adminUserIds);
});

// 处理管理员命令
bot.onText(/\/admin/, (msg) => adminController.handleAdmin(msg, adminUserIds));
bot.onText(/\/addproduct/, (msg) => adminController.handleAddProduct(msg, adminUserIds));
bot.onText(/\/editproduct/, (msg) => adminController.handleEditProduct(msg, adminUserIds));
bot.onText(/\/importcards/, (msg) => adminController.handleImportCards(msg, adminUserIds));
bot.onText(/\/exportcards/, (msg) => adminController.handleExportCards(msg, adminUserIds));
bot.onText(/\/stats/, (msg) => adminController.handleStats(msg, adminUserIds));
bot.onText(/\/cleanup/, (msg) => adminController.handleCleanupOrders(msg, adminUserIds));

// 处理普通用户命令
bot.onText(/\/start/, (msg) => botController.handleStart(msg, adminUserIds));
bot.onText(/\/help/, (msg) => botController.handleHelp(msg, adminUserIds));
bot.onText(/\/products/, (msg) => botController.handleProducts(msg));
bot.onText(/\/orders/, (msg) => botController.handleOrders(msg));

// 测试支付页面 - 仅在非生产环境中可用
app.get('/test-payment', (req, res) => {
  const sessionId = req.query.session_id;
  const orderId = req.query.order_id;
  
  console.log('测试支付页面被访问:', { sessionId, orderId });
  
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not found');
  }
  
  // 返回测试支付页面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>测试支付</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
          text-align: center;
        }
        .test-card {
          background-color: white;
          border-radius: 10px;
          padding: 30px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        .test-icon {
          color: #2196F3;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          margin-bottom: 15px;
        }
        p {
          color: #666;
          margin-bottom: 25px;
          line-height: 1.5;
        }
        .button {
          padding: 12px 20px;
          border-radius: 5px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
          margin: 0 10px;
          cursor: pointer;
        }
        .success-button {
          background-color: #4CAF50;
          color: white;
          border: none;
        }
        .cancel-button {
          background-color: #F44336;
          color: white;
          border: none;
        }
      </style>
    </head>
    <body>
      <div class="test-card">
        <div class="test-icon">🧪</div>
        <h1>测试支付环境</h1>
        <p>这是一个测试支付页面，用于开发环境测试支付流程。</p>
        <p>会话ID: ${sessionId}<br>订单ID: ${orderId}</p>
        <div>
          <a class="button success-button" href="/success?session_id=${sessionId}">模拟支付成功</a>
          <a class="button cancel-button" href="/cancel">模拟支付取消</a>
        </div>
      </div>
      <script>
        // 模拟成功点击时，发送webhook通知
        document.querySelector('.success-button').addEventListener('click', async () => {
          try {
            console.log('准备发送模拟Webhook...');
            
            // 构造webhook事件数据
            const webhookData = {
              type: 'checkout.session.completed',
              data: {
                object: {
                  id: '${sessionId}',
                  metadata: {
                    orderId: '${orderId}',
                    userId: 'test_user'
                  },
                  customer_details: {
                    email: 'test@example.com'
                  },
                  payment_status: 'paid'
                }
              }
            };
            
            console.log('Webhook数据:', JSON.stringify(webhookData, null, 2));
            
            // 发送模拟的webhook调用
            const response = await fetch('/test-webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Test-Event': 'true'
              },
              body: JSON.stringify(webhookData)
            });
            
            if (!response.ok) {
              const errorText = await response.text();
              console.error('Webhook发送失败:', response.status, errorText);
              alert('发送模拟Webhook失败: ' + errorText);
            } else {
              console.log('已成功发送模拟Webhook, 状态码:', response.status);
              // 继续跳转到成功页面
              window.location.href = '/success?session_id=${sessionId}';
            }
          } catch (error) {
            console.error('发送模拟Webhook失败:', error);
            alert('发送模拟Webhook失败: ' + error.message);
          }
        });
      </script>
    </body>
    </html>
  `);
});

// 支付成功页面
app.get('/success', (req, res) => {
  const sessionId = req.query.session_id;
  console.log('支付成功回调，会话ID:', sessionId);
  
  // 获取机器人用户名 - 优先从环境变量获取，其次从令牌中提取
  let botUsername = process.env.BOT_USERNAME || 'your_bot_username';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  
  // 如果未设置BOT_USERNAME，尝试从令牌中提取
  if (!process.env.BOT_USERNAME) {
    try {
      if (botToken && botToken.includes(':')) {
        const botInfo = botToken.split(':')[0];
        if (botInfo) {
          botUsername = 'bot' + botInfo;
          console.log('已从令牌中提取机器人用户名:', botUsername);
        }
      }
    } catch (err) {
      console.error('无法从令牌提取机器人用户名', err);
    }
  } else {
    console.log('使用环境变量中的BOT_USERNAME:', botUsername);
  }
  
  // 返回简单的成功页面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>支付成功</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
          text-align: center;
        }
        .success-card {
          background-color: white;
          border-radius: 10px;
          padding: 30px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        .success-icon {
          color: #4CAF50;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          margin-bottom: 15px;
        }
        p {
          color: #666;
          margin-bottom: 25px;
          line-height: 1.5;
        }
        .telegram-button {
          background-color: #0088cc;
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 5px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="success-card">
        <div class="success-icon">✅</div>
        <h1>支付成功！</h1>
        <p>您的订单已处理完成，卡密将通过Telegram机器人发送给您。</p>
        <p>如果您没有收到卡密，请联系客服。</p>
        <a class="telegram-button" href="https://t.me/${botUsername}">返回Telegram机器人</a>
      </div>
    </body>
    </html>
  `);
});

// 支付取消页面
app.get('/cancel', (req, res) => {
  console.log('支付取消回调');
  
  // 获取机器人用户名 - 优先从环境变量获取，其次从令牌中提取
  let botUsername = process.env.BOT_USERNAME || 'your_bot_username';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  
  // 如果未设置BOT_USERNAME，尝试从令牌中提取
  if (!process.env.BOT_USERNAME) {
    try {
      if (botToken && botToken.includes(':')) {
        const botInfo = botToken.split(':')[0];
        if (botInfo) {
          botUsername = 'bot' + botInfo;
          console.log('已从令牌中提取机器人用户名:', botUsername);
        }
      }
    } catch (err) {
      console.error('无法从令牌提取机器人用户名', err);
    }
  } else {
    console.log('使用环境变量中的BOT_USERNAME:', botUsername);
  }
  
  // 返回简单的取消页面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>支付取消</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #f5f5f5;
          margin: 0;
          padding: 20px;
          text-align: center;
        }
        .cancel-card {
          background-color: white;
          border-radius: 10px;
          padding: 30px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        .cancel-icon {
          color: #F44336;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          margin-bottom: 15px;
        }
        p {
          color: #666;
          margin-bottom: 25px;
          line-height: 1.5;
        }
        .telegram-button {
          background-color: #0088cc;
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 5px;
          text-decoration: none;
          font-weight: bold;
          display: inline-block;
        }
      </style>
    </head>
    <body>
      <div class="cancel-card">
        <div class="cancel-icon">❌</div>
        <h1>支付已取消</h1>
        <p>您已取消本次支付，您的订单未完成。</p>
        <p>您可以返回机器人重新选择商品进行购买。</p>
        <a class="telegram-button" href="https://t.me/${botUsername}">返回Telegram机器人</a>
      </div>
    </body>
    </html>
  `);
});

// 检查Stripe配置
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeKey) {
  console.warn('⚠️ 警告: STRIPE_SECRET_KEY 未配置，支付功能将不可用');
} else {
  console.log('✅ Stripe API密钥已配置');
}

if (!stripeWebhookSecret) {
  console.warn('⚠️ 警告: STRIPE_WEBHOOK_SECRET 未配置，webhook回调将不可用');
} else {
  console.log('✅ Stripe Webhook密钥已配置');
}

// 检查Telegram机器人配置
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const botUsername = process.env.BOT_USERNAME;

if (!botToken) {
  console.warn('⚠️ 警告: TELEGRAM_BOT_TOKEN 未配置，机器人功能将不可用');
} else {
  console.log('✅ Telegram Bot Token已配置');
}

if (!botUsername) {
  console.warn('⚠️ 警告: BOT_USERNAME 未配置，将尝试从令牌中提取，但可能不准确');
} else {
  console.log('✅ Telegram Bot Username已配置:', botUsername);
}

// 错误处理中间件
app.use(errorHandler);

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器运行在端口 ${PORT}`);
  
  // 启动订单清理任务 - 每5分钟检查一次，30分钟未支付视为超时
  const orderCleanupTimer = startCleanupSchedule(5, 30);
  console.log('✅ 订单自动清理任务已启动');
});

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('未处理的Promise拒绝:', error);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
}); 