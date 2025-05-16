require('dotenv').config();
const mongoose = require('mongoose');
const { Product } = require('../models/productModel');
const { Card } = require('../models/cardModel');

// 连接数据库
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram-faka')
  .then(() => console.log('✅ MongoDB连接成功'))
  .catch(err => {
    console.error('❌ MongoDB连接失败:', err);
    process.exit(1);
  });

// 示例产品数据
const products = [
  {
    name: '网易云音乐会员',
    description: '网易云音乐黑胶VIP会员1个月',
    price: 15,
    active: true
  },
  {
    name: 'Spotify高级会员',
    description: 'Spotify Premium会员3个月',
    price: 45,
    active: true
  },
  {
    name: '腾讯视频VIP',
    description: '腾讯视频VIP会员1个月',
    price: 20,
    active: true
  }
];

// 示例卡密数据
async function generateCards(productId, count = 5) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const randomCode = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    cards.push({
      productId,
      code: randomCode,
      used: false
    });
  }
  return cards;
}

// 初始化数据
async function initializeData() {
  try {
    // 清空现有数据
    await Product.deleteMany({});
    await Card.deleteMany({});
    console.log('✅ 已清空现有数据');
    
    // 创建产品
    const createdProducts = await Product.insertMany(products);
    console.log('✅ 已创建产品数据');
    
    // 为每个产品创建卡密
    for (const product of createdProducts) {
      const cards = await generateCards(product._id);
      await Card.insertMany(cards);
      console.log(`✅ 已为产品 ${product.name} 创建 ${cards.length} 个卡密`);
    }
    
    console.log('✅ 数据初始化完成！');
    process.exit(0);
  } catch (error) {
    console.error('❌ 数据初始化失败:', error);
    process.exit(1);
  }
}

// 执行初始化
initializeData(); 