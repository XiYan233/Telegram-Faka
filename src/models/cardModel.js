const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  used: {
    type: Boolean,
    default: false
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },
  usedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Card = mongoose.model('Card', cardSchema);

module.exports = { Card }; 