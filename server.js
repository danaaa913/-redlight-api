// server.js
require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch'); // ✅ إضافة للتعامل مع Gemini API

const app = express();

// خلال التطوير يمكن السماح للجميع، وفي الإنتاج قَيِّد origin إلى نطاق واجهتك
app.use(cors({
  origin: true, // يسمح لكل المواقع مؤقتاً
  credentials: true
}));

app.use(express.json());

// عدّل سلسلة الاتصال عند النشر (يفضَّل MongoDB Atlas عبر متغير بيئة)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/redlight';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

// ✅ نموذج البيانات المُحدَّث مع تحليل الذكاء الاصطناعي
const feedbackSchema = new mongoose.Schema({
  institutionName: { type: String, required: true },
  timestamp:      { type: Date,   required: true },
  text:           { type: String, required: true },
  aiAnalysis: {    // ✅ إضافة جديدة لحفظ تحليل الذكاء الاصطناعي
    corruption_score: Number,
    fairness_score: Number,
    nepotism_score: Number,
    service_quality: Number,
    sentiment: String,
    main_issue: String,
    keywords: [String],
    confidence: Number
  }
}, { timestamps: true });

const Feedback = mongoose.model('Feedback', feedbackSchema);

// ✅ دالة تحليل النص بـ Google Gemini API
async function analyzeIntegrityWithGemini(text, institutionName) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // ⚠️ تأكدي من إضافته في Render
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  
  const prompt = `أنت محلل نزاهة حكومية متخصص في المؤسسات الأردنية.

حلل هذا النص من مواطن عن "${institutionName}":
"${text}"

أعط تقييماً دقيقاً بصيغة JSON فقط:
{
  "corruption_score": رقم من 0-100,
  "fairness_score": رقم من 0-100,
  "nepotism_score": رقم من 0-100,
  "service_quality": رقم من 0-100,
  "sentiment": "positive/neutral/negative",
  "main_issue": "وصف موجز للمشكلة",
  "keywords": ["كلمة1", "كلمة2"],
  "confidence": رقم من 0-100
}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: prompt }] }
        ]
      })
    });

    const data = await response.json();
    const aiResponse = data.candidates[0].content.parts[0].text;
    
    // استخراج JSON من الاستجابة
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('لم يتم العثور على JSON في الاستجابة');
    
  } catch (error) {
    console.error('❌ خطأ في Gemini API:', error);
    return {
      corruption_score: 0,
      fairness_score: 50,
      nepotism_score: 0,
      service_quality: 50,
      sentiment: "neutral",
      main_issue: "فشل التحليل",
      keywords: [],
      confidence: 0
    };
  }
}

// ✅ نقطة الاستقبال المُحدَّثة مع التحليل الذكي
app.post('/api/feedback', async (req, res) => {
  try {
    const { institutionName, timestamp, text } = req.body;
    if (!institutionName || !timestamp || !text) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    console.log(`🤖 بدء تحليل رسالة عن ${institutionName}...`);

    // ✅ تحليل النص بالذكاء الاصطناعي
    const aiAnalysis = await analyzeIntegrityWithGemini(text, institutionName);

    console.log('✅ تم التحليل:', aiAnalysis);

    // حفظ البيانات مع التحليل
    const doc = await Feedback.create({ 
      institutionName, 
      timestamp, 
      text, 
      aiAnalysis  // ✅ إضافة التحليل
    });
    
    // حساب مؤشر النزاهة الإجمالي
    const integrityScore = Math.round(
      ((aiAnalysis.fairness_score + aiAnalysis.service_quality) / 2) - 
      ((aiAnalysis.corruption_score + aiAnalysis.nepotism_score) / 2) + 50
    );

    return res.json({ 
      success: true, 
      id: doc._id,
      analysis: aiAnalysis,
      integrityScore: Math.max(0, Math.min(100, integrityScore)),
      message: `تم تحليل رسالتك بالذكاء الاصطناعي! مؤشر النزاهة للمؤسسة: ${Math.max(0, Math.min(100, integrityScore))}%`
    });
  } catch (e) {
    console.error('❌ خطأ في معالجة التغذية:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ✅ API جديد للحصول على إحصائيات ذكية
app.get('/api/analytics/overview', async (req, res) => {
  try {
    console.log('📊 بدء تحليل الإحصائيات...');

    const institutions = await Feedback.aggregate([
      {
        $group: {
          _id: '$institutionName',
          totalFeedbacks: { $sum: 1 },
          avgCorruption: { $avg: '$aiAnalysis.corruption_score' },
          avgFairness: { $avg: '$aiAnalysis.fairness_score' },
          avgNepotism: { $avg: '$aiAnalysis.nepotism_score' },
          avgService: { $avg: '$aiAnalysis.service_quality' },
          positiveCount: {
            $sum: { $cond: [{ $eq: ['$aiAnalysis.sentiment', 'positive'] }, 1, 0] }
          },
          negativeCount: {
            $sum: { $cond: [{ $eq: ['$aiAnalysis.sentiment', 'negative'] }, 1, 0] }
          },
          neutralCount: {
            $sum: { $cond: [{ $eq: ['$aiAnalysis.sentiment', 'neutral'] }, 1, 0] }
          },
          lastUpdate: { $max: '$createdAt' }
        }
      }
    ]);

    const processedInstitutions = institutions.map(inst => {
      const integrityScore = Math.round(
        ((inst.avgFairness + inst.avgService) / 2) - 
        ((inst.avgCorruption + inst.avgNepotism) / 2) + 50
      );
      
      return {
        name: inst._id,
        totalFeedbacks: inst.totalFeedbacks,
        integrityScore: Math.max(0, Math.min(100, integrityScore)),
        corruptionLevel: Math.round(inst.avgCorruption || 0),
        fairnessLevel: Math.round(inst.avgFairness || 50),
        nepotismLevel: Math.round(inst.avgNepotism || 0),
        serviceQuality: Math.round(inst.avgService || 50),
        positiveRatio: Math.round((inst.positiveCount / inst.totalFeedbacks) * 100),
        negativeRatio: Math.round((inst.negativeCount / inst.totalFeedbacks) * 100),
        neutralRatio: Math.round((inst.neutralCount / inst.totalFeedbacks) * 100),
        lastUpdate: inst.lastUpdate
      };
    });

    const rankedInstitutions = processedInstitutions.sort((a, b) => b.integrityScore - a.integrityScore);

    const totalFeedbacks = institutions.reduce((sum, inst) => sum + inst.totalFeedbacks, 0);
    const avgIntegrity = Math.round(
      processedInstitutions.reduce((sum, inst) => sum + inst.integrityScore, 0) / processedInstitutions.length || 0
    );
    const criticalAlerts = processedInstitutions.filter(inst => 
      inst.integrityScore < 30 || inst.corruptionLevel > 70 || inst.nepotismLevel > 70
    ).length;

    console.log(`📈 تم تحليل ${institutions.length} مؤسسة بإجمالي ${totalFeedbacks} رسالة`);

    res.json({
      totalFeedbacks,
      totalInstitutions: institutions.length,
      avgIntegrity,
      alertsCount: criticalAlerts,
      rankedInstitutions,
      topPerforming: rankedInstitutions.slice(0, 5),
      needsAttention: rankedInstitutions.filter(inst => inst.integrityScore < 40),
      sentimentData: {
        positive: processedInstitutions.reduce((sum, inst) => sum + (inst.positiveRatio * inst.totalFeedbacks / 100), 0),
        negative: processedInstitutions.reduce((sum, inst) => sum + (inst.negativeRatio * inst.totalFeedbacks / 100), 0),
        neutral: processedInstitutions.reduce((sum, inst) => sum + (inst.neutralRatio * inst.totalFeedbacks / 100), 0)
      }
    });

  } catch (error) {
    console.error('❌ خطأ في الإحصائيات:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ API للحصول على تفاصيل مؤسسة معينة
app.get('/api/analytics/institution/:name', async (req, res) => {
  try {
    const institutionName = req.params.name;
    
    const feedbacks = await Feedback.find({ institutionName }).sort({ createdAt: -1 });
    
    if (feedbacks.length === 0) {
      return res.json({ error: 'لا توجد بيانات لهذه المؤسسة' });
    }

    const analysis = {
      institutionName,
      totalFeedbacks: feedbacks.length,
      avgScores: {
        corruption: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.corruption_score || 0), 0) / feedbacks.length),
        fairness: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.fairness_score || 50), 0) / feedbacks.length),
        nepotism: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.nepotism_score || 0), 0) / feedbacks.length),
        service: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.service_quality || 50), 0) / feedbacks.length)
      },
      recentFeedbacks: feedbacks.slice(0, 10).map(f => ({
        text: f.text,
        sentiment: f.aiAnalysis?.sentiment || 'neutral',
        mainIssue: f.aiAnalysis?.main_issue || 'غير محدد',
        date: f.createdAt
      }))
    };

    res.json(analysis);

  } catch (error) {
    console.error('❌ خطأ في تحليل المؤسسة:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// نقطة الصحّة
app.get('/health', (req, res) => res.json({ 
  ok: true, 
  timestamp: new Date().toISOString(),
  aiEnabled: !!process.env.GEMINI_API_KEY 
}));

// مهم: الاستماع لمنفذ البيئة لتوافق منصّات النشر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 RedLight AI API running on port ${PORT}`);
  console.log(`🤖 AI Analysis: ${process.env.GEMINI_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🗄️  Database: ${MONGO_URI.includes('mongodb.net') ? 'MongoDB Atlas' : 'Local MongoDB'}`);
});
