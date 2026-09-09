require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const campaignRoutes = require('./routes/campaigns');
const paymentRoutes = require('./routes/payments');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// The Paystack webhook needs the raw request body to verify the signature,
// so it is mounted BEFORE the JSON body parser, with its own raw parser.
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/payments', paymentLimiter, paymentRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`FUNDme API running on port ${PORT}`));
