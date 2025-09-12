// إضافة في بداية server.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// إضافة متغيرات البيئة الجديدة
const JWT_SECRET = process.env.JWT_SECRET || 'redlight-secret-key';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

// نموذج بيانات المسؤولين (مبسط)
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'admin' },
  organization: { type: String, default: 'هيئة النزاهة' }
}, { timestamps: true });

const Admin = mongoose.model('Admin', adminSchema);

// middleware للتحقق من المصادقة
function authenticateAdmin(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid token.' });
  }
}

// API تسجيل الدخول للمسؤولين
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // مسؤول افتراضي مؤقت
    if (username === 'admin' && password === 'integrity2025') {
      const token = jwt.sign(
        { username: 'admin', role: 'admin', organization: 'هيئة النزاهة' },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      return res.json({
        success: true,
        token,
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

// API للحصول على ملخص ذكي لمؤسسة معينة
app.get('/api/admin/institution/:name/summary', authenticateAdmin, async (req, res) => {
  try {
    const institutionName = decodeURIComponent(req.params.name);
    console.log(`📊 طلب ملخص ذكي لـ: ${institutionName}`);

    const feedbacks = await Feedback.find({ institutionName }).sort({ createdAt: -1 });
    
    if (feedbacks.length === 0) {
      return res.json({
        institution: institutionName,
        summary: 'لا توجد بيانات متاحة لهذه المؤسسة',
        totalFeedbacks: 0,
        scores: null
      });
    }

    // حساب المتوسطات والإحصائيات
    const avgScores = {
      corruption: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.corruption_score || 0), 0) / feedbacks.length),
      fairness: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.fairness_score || 50), 0) / feedbacks.length),
      nepotism: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.nepotism_score || 0), 0) / feedbacks.length),
      service: Math.round(feedbacks.reduce((sum, f) => sum + (f.aiAnalysis?.service_quality || 50), 0) / feedbacks.length)
    };

    // تجميع النصوص لإنشاء ملخص ذكي
    const allTexts = feedbacks.map(f => f.text).join('\n\n---\n\n');
    
    // طلب ملخص من Gemini
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    
    const summaryPrompt = `أنت محلل نزاهة خبير. لديك ${feedbacks.length} رسائل من المواطنين عن "${institutionName}".

النصوص:
${allTexts}

قم بإنشاء تقرير تنفيذي شامل يتضمن:
1. ملخص الوضع العام للمؤسسة
2. أبرز المشاكل المتكررة
3. نقاط القوة (إن وجدت)
4. التوصيات العاجلة لهيئة النزاهة
5. مستوى الخطورة والأولوية

اكتب التقرير بشكل مهني واضح ومفيد لصناع القرار.`;

    let aiSummary = 'ملخص غير متوفر';
    try {
      const summaryResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: summaryPrompt }] }]
        })
      });

      const summaryData = await summaryResponse.json();
      aiSummary = summaryData.candidates[0].content.parts[0].text;
    } catch (summaryError) {
      console.error('خطأ في إنشاء الملخص الذكي:', summaryError);
    }

    // تحليل أنواع المشاكل
    const issueFrequency = {};
    feedbacks.forEach(f => {
      const issue = f.aiAnalysis?.main_issue || 'غير محدد';
      issueFrequency[issue] = (issueFrequency[issue] || 0) + 1;
    });

    const topIssues = Object.entries(issueFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([issue, count]) => ({ issue, count, percentage: Math.round((count / feedbacks.length) * 100) }));

    // حساب مؤشر النزاهة الإجمالي
    const integrityScore = Math.max(0, Math.min(100, 
      Math.round(((avgScores.fairness + avgScores.service) / 2) - ((avgScores.corruption + avgScores.nepotism) / 2) + 50)
    ));

    // تحديد مستوى المخاطر
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
      aiGeneratedSummary: aiSummary,
      recentFeedbacks: feedbacks.slice(0, 3).map(f => ({
        text: f.text.substring(0, 100) + '...',
        sentiment: f.aiAnalysis?.sentiment || 'محايد',
        date: f.createdAt
      }))
    };

    console.log(`✅ تم إنشاء ملخص ذكي لـ ${institutionName} - مؤشر النزاهة: ${integrityScore}%`);
    
    res.json(summary);

  } catch (error) {
    console.error('خطأ في إنشاء الملخص:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// API للحصول على قائمة المؤسسات للمسؤولين
app.get('/api/admin/institutions', authenticateAdmin, async (req, res) => {
  try {
    const institutions = await Feedback.aggregate([
      {
        $group: {
          _id: '$institutionName',
          totalFeedbacks: { $sum: 1 },
          avgCorruption: { $avg: '$aiAnalysis.corruption_score' },
          avgFairness: { $avg: '$aiAnalysis.fairness_score' },
          lastFeedback: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          name: '$_id',
          totalFeedbacks: 1,
          integrityScore: {
            $max: [0, {
              $min: [100, {
                $add: [
                  { $divide: [{ $add: ['$avgFairness', 50] }, 2] },
                  { $subtract: [50, { $divide: [{ $add: ['$avgCorruption', 0] }, 2] }] }
                ]
              }]
            }]
          },
          lastActivity: '$lastFeedback',
          _id: 0
        }
      },
      { $sort: { integrityScore: 1 } } // الأسوأ أولاً
    ]);

    res.json({
      institutions: institutions.map(inst => ({
        ...inst,
        integrityScore: Math.round(inst.integrityScore),
        priority: inst.integrityScore < 40 ? 'عالية' : inst.integrityScore < 70 ? 'متوسطة' : 'منخفضة'
      })),
      summary: {
        total: institutions.length,
        highPriority: institutions.filter(inst => inst.integrityScore < 40).length,
        mediumPriority: institutions.filter(inst => inst.integrityScore >= 40 && inst.integrityScore < 70).length,
        lowPriority: institutions.filter(inst => inst.integrityScore >= 70).length
      }
    });

  } catch (error) {
    console.error('خطأ في جلب المؤسسات:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
