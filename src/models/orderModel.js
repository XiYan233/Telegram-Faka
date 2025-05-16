const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true  // Telegram userId
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  stripeSessionId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'delivered', 'expired'],
    default: 'pending'
  },
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    default: null
  },
  amount: {
    type: Number,
    required: true
  },
  paymentUrl: {
    type: String,
    required: true
  },
  paidAt: {
    type: Date,
    default: null
  },
  expiredAt: {
    type: Date,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Order = mongoose.model('Order', orderSchema);

module.exports = { Order }; 