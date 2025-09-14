
require('dotenv').config(); 
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

// إعدادات CORS
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// الاتصال بقاعدة البيانات
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/redlight';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { 
    console.error('❌ MongoDB error:', err); 
   
  });

// نموذج البيانات
const feedbackSchema = new mongoose.Schema({
  institutionName: { type: String, required: true },
  timestamp: { type: Date, required: true },
  text: { type: String, required: true },
  aiAnalysis: {
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

// دالة تحليل النص بـ Gemini 
async function analyzeIntegrityWithGemini(text, institutionName) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  
  if (!GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY not found, using basic analysis');
    return {
      corruption_score: text.includes('واسطة') ? 70 : 20,
      fairness_score: text.includes('عدالة') ? 80 : 40,
      nepotism_score: text.includes('محسوبية') || text.includes('واسطة') ? 80 : 20,
      service_quality: text.includes('سيء') ? 30 : 60,
      sentiment: text.includes('سيء') || text.includes('واسطة') ? 'negative' : 'positive',
      main_issue: text.includes('واسطة') ? 'طلب واسطة' : 'تقييم عام',
      keywords: text.includes('واسطة') ? ['واسطة'] : ['تقييم'],
      confidence: 75
    };
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  
  const prompt = `أنت محلل نزاهة. حلل النص: "${text}" من "${institutionName}"
أعط JSON: {"corruption_score": رقم 0-100, "fairness_score": رقم 0-100, "nepotism_score": رقم 0-100, "service_quality": رقم 0-100, "sentiment": "positive/neutral/negative", "main_issue": "وصف المشكلة", "keywords": ["كلمة"], "confidence": رقم 0-100}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates[0].content.parts[0].text;
    
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('No JSON found in Gemini response');
    
  } catch (error) {
    console.error('❌ خطأ في Gemini API:', error.message);
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

// API تسجيل الدخول المبسط
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'integrity2025') {
     
      const simpleToken = Buffer.from(`admin:${Date.now()}`).toString('base64');
      
      return res.json({
        success: true,
        token: simpleToken,
        admin: {
          username: 'admin',
          role: 'admin',
          organization: 'هيئة النزاهة'
        }
      });
    }
    
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// middleware مبسط للتحقق من المصادقة
function authenticateAdmin(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    if (decoded.includes('admin:')) {
      req.admin = { username: 'admin', role: 'admin' };
      next();
    } else {
      throw new Error('Invalid token');
    }
  } catch (error) {
    res.status(400).json({ error: 'Invalid token.' });
  }
}

// API استقبال التغذية الراجعة
app.post('/api/feedback', async (req, res) => {
  try {
    const { institutionName, timestamp, text } = req.body;
    if (!institutionName || !timestamp || !text) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    console.log(`🤖 تحليل رسالة عن ${institutionName}...`);

    const aiAnalysis = await analyzeIntegrityWithGemini(text, institutionName);
    
    console.log('✅ تم التحليل:', JSON.stringify(aiAnalysis));

    const doc = await Feedback.create({ 
      institutionName, 
      timestamp, 
      text, 
      aiAnalysis
    });
    
    const integrityScore = Math.max(0, Math.min(100, 
      Math.round(((aiAnalysis.fairness_score + aiAnalysis.service_quality) / 2) - 
      ((aiAnalysis.corruption_score + aiAnalysis.nepotism_score) / 2) + 50)
    ));

    return res.json({ 
      success: true, 
      id: doc._id,
      analysis: aiAnalysis,
      integrityScore,
      message: `تم تحليل رسالتك بالذكاء الاصطناعي! مؤشر النزاهة: ${integrityScore}%`
    });
  } catch (e) {
    console.error('❌ خطأ في معالجة التغذية:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// API الإحصائيات العامة
app.get('/api/analytics/overview', async (req, res) => {
  try {
    console.log('📊 بدء تحليل الإحصائيات...');

    const institutions = await Feedback.aggregate([
      {
        $group: {
          _id: '$institutionName',
          totalFeedbacks: { $sum: 1 },
          avgCorruption: { $avg: { $ifNull: ['$aiAnalysis.corruption_score', 0] } },
          avgFairness: { $avg: { $ifNull: ['$aiAnalysis.fairness_score', 50] } },
          avgNepotism: { $avg: { $ifNull: ['$aiAnalysis.nepotism_score', 0] } },
          avgService: { $avg: { $ifNull: ['$aiAnalysis.service_quality', 50] } },
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
      const integrityScore = Math.max(0, Math.min(100, 
        Math.round(((inst.avgFairness + inst.avgService) / 2) - 
        ((inst.avgCorruption + inst.avgNepotism) / 2) + 50)
      ));
      
      return {
        name: inst._id,
        totalFeedbacks: inst.totalFeedbacks,
        integrityScore,
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

    const totalFeedbacks = institutions.reduce((sum, inst) => sum + inst.totalFeedbacks, 0) || 0;
    const avgIntegrity = processedInstitutions.length > 0 ? 
      Math.round(processedInstitutions.reduce((sum, inst) => sum + inst.integrityScore, 0) / processedInstitutions.length) : 0;
    
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
        positive: Math.round(processedInstitutions.reduce((sum, inst) => sum + (inst.positiveRatio * inst.totalFeedbacks / 100), 0)),
        negative: Math.round(processedInstitutions.reduce((sum, inst) => sum + (inst.negativeRatio * inst.totalFeedbacks / 100), 0)),
        neutral: Math.round(processedInstitutions.reduce((sum, inst) => sum + (inst.neutralRatio * inst.totalFeedbacks / 100), 0))
      }
    });

  } catch (error) {
    console.error('❌ خطأ في الإحصائيات:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API ملخص مؤسسة محددة (للمسؤولين)
app.get('/api/admin/institution/:name/summary', authenticateAdmin, async (req, res) => {
  try {
    const institutionName = decodeURIComponent(req.params.name);
    console.log(`📊 طلب ملخص لـ: ${institutionName}`);

    const feedbacks = await Feedback.find({ institutionName }).sort({ createdAt: -1 });
    
    if (feedbacks.length === 0) {
      return res.json({
        institution: institutionName,
        summary: 'لا توجد بيانات متاحة لهذه المؤسسة',
        totalFeedbacks: 0,
        scores: null
      });
    }

    const avgScores = {
      corruption: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.corruption_score || 0), 0) / feedbacks.length),
      fairness: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.fairness_score || 50), 0) / feedbacks.length),
      nepotism: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.nepotism_score || 0), 0) / feedbacks.length),
      service: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.service_quality || 50), 0) / feedbacks.length)
    };

    const integrityScore = Math.max(0, Math.min(100, 
      Math.round(((avgScores.fairness + avgScores.service) / 2) - ((avgScores.corruption + avgScores.nepotism) / 2) + 50)
    ));

    const issueFrequency = {};
    feedbacks.forEach(f => {
      const issue = f.aiAnalysis?.main_issue || 'غير محدد';
      issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
    });

    const topIssues = Object.entries(issueFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([issue, count]) => ({ 
        issue, 
        count, 
        percentage: Math.round((count / feedbacks.length) * 100) 
      }));

    let riskLevel = 'منخفض';
    let riskColor = '#27ae60';
    if (integrityScore < 30 || avgScores.corruption > 70) {
      riskLevel = 'عالي جداً';
      riskColor = '#e74c3c';
    } else if (integrityScore < 50 || avgScores.corruption > 50) {
      riskLevel = 'عالي';
      riskColor = '#f39c12';
    } else if (integrityScore < 70) {
      riskLevel = 'متوسط';
      riskColor = '#f39c12';
    }

    const summary = {
      institution: institutionName,
      reportDate: new Date().toISOString(),
      totalFeedbacks: feedbacks.length,
      dateRange: {
        from: feedbacks[feedbacks.length - 1].createdAt,
        to: feedbacks[0].createdAt
      },
      integrityScore,
      riskLevel,
      riskColor,
      scores: avgScores,
      sentiment: {
        positive: feedbacks.filter(f => f.aiAnalysis?.sentiment === 'positive').length,
        negative: feedbacks.filter(f => f.aiAnalysis?.sentiment === 'negative').length,
        neutral: feedbacks.filter(f => f.aiAnalysis?.sentiment === 'neutral').length
      },
      topIssues,
      aiGeneratedSummary: `تحليل تلقائي لـ ${feedbacks.length} تقييم. مؤشر النزاهة: ${integrityScore}%. أبرز المشاكل: ${topIssues.map(i => i.issue).join(', ')}.`,
      recentFeedbacks: feedbacks.slice(0, 3).map(f => ({
        text: f.text.substring(0, 100) + '...',
        sentiment: f.aiAnalysis?.sentiment || 'محايد',
        date: f.createdAt
      }))
    };

    console.log(`✅ تم إنشاء ملخص لـ ${institutionName} - مؤشر النزاهة: ${integrityScore}%`);
    
    res.json(summary);

  } catch (error) {
    console.error('خطأ في إنشاء الملخص:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// API قائمة المؤسسات (للمسؤولين)
app.get('/api/admin/institutions', authenticateAdmin, async (req, res) => {
  try {
    const institutions = await Feedback.aggregate([
      {
        $group: {
          _id: '$institutionName',
          totalFeedbacks: { $sum: 1 },
          avgCorruption: { $avg: { $ifNull: ['$aiAnalysis.corruption_score', 0] } },
          avgFairness: { $avg: { $ifNull: ['$aiAnalysis.fairness_score', 50] } },
          avgNepotism: { $avg: { $ifNull: ['$aiAnalysis.nepotism_score', 0] } },
          avgService: { $avg: { $ifNull: ['$aiAnalysis.service_quality', 50] } },
          lastFeedback: { $max: '$createdAt' }
        }
      }
    ]);

    const processedInstitutions = institutions.map(inst => {
      const integrityScore = Math.max(0, Math.min(100, 
        Math.round(((inst.avgFairness + inst.avgService) / 2) - 
        ((inst.avgCorruption + inst.avgNepotism) / 2) + 50)
      ));
      
      return {
        name: inst._id,
        totalFeedbacks: inst.totalFeedbacks,
        integrityScore,
        lastActivity: inst.lastFeedback,
        priority: integrityScore < 40 ? 'عالية' : integrityScore < 70 ? 'متوسطة' : 'منخفضة'
      };
    }).sort((a, b) => a.integrityScore - b.integrityScore); // الأسوأ أولاً

    res.json({
      institutions: processedInstitutions,
      summary: {
        total: processedInstitutions.length,
        highPriority: processedInstitutions.filter(inst => inst.priority === 'عالية').length,
        mediumPriority: processedInstitutions.filter(inst => inst.priority === 'متوسطة').length,
        lowPriority: processedInstitutions.filter(inst => inst.priority === 'منخفضة').length
      }
    });

  } catch (error) {
    console.error('خطأ في جلب المؤسسات:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// نقطة فحص الصحة
app.get('/health', (req, res) => res.json({ 
  ok: true, 
  timestamp: new Date().toISOString(),
  aiEnabled: !!process.env.GEMINI_API_KEY,
  mongoConnected: mongoose.connection.readyState === 1
}));

// بدء تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 RedLight AI API running on port ${PORT}`);
  console.log(`🤖 AI Analysis: ${process.env.GEMINI_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🗄️  Database: ${mongoose.connection.readyState === 1 ? 'CONNECTED' : 'CONNECTING...'}`);
});

// معالج الأخطاء العام
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});
