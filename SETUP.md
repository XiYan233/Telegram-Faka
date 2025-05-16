# Telegram 发卡系统安装指南

## 准备工作

### 1. 获取 Telegram Bot Token

1. 在 Telegram 上打开 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 命令创建新机器人
3. 按照提示输入机器人名称和用户名
4. 得到 Bot Token，类似于 `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`

### 2. 设置 Stripe 账户

1. 注册 [Stripe](https://stripe.com/) 账户
2. 获取 API 密钥（在 Dashboard 的开发者选项中）
3. 配置 Webhook（详见下文）

### 3. 获取管理员用户 ID

1. 在 Telegram 上打开 [@userinfobot](https://t.me/userinfobot)
2. 机器人会返回您的 Telegram 用户 ID
3. 记录下这个 ID 用于配置管理员权限

### 4. 安装 MongoDB

- 本地安装 MongoDB，或
- 使用 [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) 云服务

## 安装步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在项目根目录中创建 `.env` 文件，参考 `env.example`，填入：

```
# Telegram Bot 令牌
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Stripe API密钥
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# MongoDB连接字符串
MONGODB_URI=mongodb://localhost:27017/telegram-faka

# 服务器URL (用于Stripe回调)
SERVER_URL=https://your-domain.com

# 管理员用户ID，多个管理员用逗号分隔
ADMIN_USER_IDS=123456789,987654321
```

### 3. 公网访问设置

要接收 Stripe 的回调，您的服务器需要有公网可访问的地址。

**开发环境：**

使用 [ngrok](https://ngrok.com/) 或类似工具创建隐藏通道：

```bash
ngrok http 3000
```

将生成的 HTTPS URL 作为 `SERVER_URL` 放入 `.env` 文件中。

**生产环境：**

设置您的常规域名和 SSL 证书。

### 4. 配置 Stripe Webhook

1. 登录 Stripe Dashboard
2. 前往 Developers > Webhooks
3. 点击 "Add endpoint"
4. 在 Endpoint URL 中输入 `https://your-domain.com/webhook`
5. 选择事件 `checkout.session.completed`
6. 创建后得到 Webhook Secret，放入 `.env` 文件

### 5. 初始化数据库

运行元数据初始化脚本：

```bash
node src/scripts/init-data.js
```

这将创建示例产品和卡密数据。

### 6. 启动服务

```bash
npm start
```

开发模式：

```bash
npm run dev
```

## 测试

1. 在 Telegram 中打开您的机器人
2. 发送 `/start` 命令
3. 使用 `/products` 查看商品列表
4. 点击产品进行购买
5. 使用测试支付卡完成支付（Stripe 测试模式下使用 `4242 4242 4242 4242`）
6. 确认可以收到卡密

## 管理员功能使用

1. 确保您的 Telegram 用户 ID 已在 `.env` 文件中配置为管理员
2. 在 Telegram 中向您的机器人发送 `/admin` 命令
3. 机器人将显示管理控制面板，您可以进行以下操作：
   - 管理产品（添加、编辑、上下架）
   - 管理卡密（导入、导出）
   - 查看系统统计信息

### 卡密导入格式

导入卡密时，每行一个卡密，例如：

```
Card-12345-ABCDE
Card-67890-FGHIJ
Card-54321-KLMNO
```

## 自定义商品和卡密

1. 修改 `src/scripts/init-data.js` 中的商品数据
2. 重新运行初始化脚本

您也可以通过 Bot 的管理界面来管理商品和卡密。

## 检查日志

如果您遇到问题，请检查控制台日志和 Stripe Dashboard 中的 Webhook 日志。 