// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// خلال التطوير يمكن السماح للجميع، وفي الإنتاج قَيِّد origin إلى نطاق واجهتك
app.use(cors()); // راجع توثيق CORS في Express لضبط الخيارات لاحقًا
app.use(express.json());

// عدّل سلسلة الاتصال عند النشر (يفضَّل MongoDB Atlas عبر متغير بيئة)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/redlight';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });

// نموذج البيانات
const feedbackSchema = new mongoose.Schema({
  institutionName: { type: String, required: true },
  timestamp:      { type: Date,   required: true },
  text:           { type: String, required: true },
}, { timestamps: true });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// نقطة الاستقبال
app.post('/api/feedback', async (req, res) => {
  try {
    const { institutionName, timestamp, text } = req.body;
    if (!institutionName || !timestamp || !text) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    const doc = await Feedback.create({ institutionName, timestamp, text });
    return res.json({ success: true, id: doc._id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// نقطة الصحّة
app.get('/health', (req, res) => res.json({ ok: true }));

// مهم: الاستماع لمنفذ البيئة لتوافق منصّات النشر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on port ${PORT}`));
