# Telegram 发卡系统

这是一个基于 Telegram Bot 的自动发卡系统，支持 Stripe 支付。

## 功能特点

- 🤖 通过 Telegram Bot 交互
- 💳 集成 Stripe 支付
- 🏪 自动化商品销售流程
- 🔑 自动发送卡密
- 📊 订单管理
- 👨‍💼 管理员权限控制
- 📥 批量导入/导出卡密

## 系统流程

1. 用户通过 Telegram Bot 发起支付请求
2. Bot 提供一个 Stripe 付款链接
3. 用户完成付款后，Stripe 自动回调到服务器
4. 服务器确认付款成功后，通过 Telegram Bot 向用户发送一个卡密

## 管理员功能

- 🔐 基于 Telegram 用户ID的管理员权限控制
- 🛒 产品管理 (添加、编辑、上架/下架)
- 🔑 卡密管理 (导入、导出、查看统计)
- 📊 系统统计信息查看

管理员命令：
- `/admin` - 管理员控制面板
- `/addproduct` - 添加新产品
- `/editproduct` - 编辑产品
- `/importcards` - 导入卡密
- `/exportcards` - 导出卡密
- `/stats` - 查看系统统计

## 安装步骤

### 前置条件

- Node.js 14+
- MongoDB
- Telegram Bot Token
- Stripe 账户与 API 密钥

### 安装

1. 克隆仓库
```
git clone https://github.com/XiYan233/Telegram-Faka.git
cd Telegram-Faka
```

2. 安装依赖
```
npm install
```

3. 配置环境变量
```
cp env.example .env
```
然后编辑 `.env` 文件，填入必要的配置信息，包括管理员 Telegram 用户 ID

4. 初始化数据库
```
node src/scripts/init-data.js
```

5. 启动服务
```
npm start
```

## 配置 Stripe Webhook

1. 注册 Stripe 账户并获取 API 密钥
2. 在 Stripe Dashboard 创建 Webhook
3. 设置 Webhook 端点为 `https://your-domain.com/webhook`
4. 添加 `checkout.session.completed` 事件
5. 将 Webhook Secret 添加到 `.env` 文件中

## 配置 Telegram Bot

1. 在 Telegram 上联系 [@BotFather](https://t.me/BotFather) 创建一个新的机器人
2. 获取机器人的 API Token
3. 将 Token 添加到 `.env` 文件中

## 设置管理员权限

1. 获取您的 Telegram 用户 ID (可以通过 [@userinfobot](https://t.me/userinfobot) 获取)
2. 将您的用户 ID 添加到 `.env` 文件的 `ADMIN_USER_IDS` 字段，多个管理员用逗号分隔

## 开发

```
npm run dev
```

## 注意事项

- 请确保您的服务器可以被公网访问，以便接收 Stripe Webhook
- 推荐使用 ngrok 或类似工具在本地开发时提供公网访问
- 确保在生产环境中使用 HTTPS
- 确保您的业务符合 [Stripe平台的相关规定](https://stripe.com/legal/restricted-businesses#prohibited-businesses)
