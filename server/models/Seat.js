const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema({
  seatId: { type: String, required: true, unique: true }, // e.g., "A1"
  row: { type: String, required: true },
  number: { type: Number, required: true },
  price: { type: Number, required: true },
  tier: { type: String, enum: ['vip', 'premium', 'standard'], required: true },
  status: { type: String, enum: ['available', 'booked'], default: 'available' },
  userId: { type: String, default: null }, // Who owns it?
  version: { type: Number, default: 0 } // Concurrency Control 
});


module.exports = mongoose.model('Seat', seatSchema);
