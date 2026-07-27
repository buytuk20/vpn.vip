// ============================================
// B.T.C VPN - الخادم الاحترافي مع Firebase Firestore
// ============================================

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'btc_vpn_ultra_secret_2026';

// ============================================
// 1. تهيئة Firebase Admin SDK بأمان
// ============================================
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}
const db = admin.firestore();

// ============================================
// 2. الإعدادات الأساسية
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// 3. البيانات الافتراضية (تعمل مرة واحدة)
// ============================================
async function seedData() {
    const adminRef = db.collection('users').doc('admin');
    const adminDoc = await adminRef.get();
    
    if (!adminDoc.exists) {
        console.log('🌱 جاري إنشاء البيانات الافتراضية في Firebase...');
        
        const adminPass = bcrypt.hashSync('admin123', 10);
        await adminRef.set({
            username: 'admin',
            password: adminPass,
            role: 'admin',
            credits: 10000,
            referral_code: 'ADMIN001',
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        const resellerPass = bcrypt.hashSync('reseller123', 10);
        await db.collection('users').doc('reseller1').set({
            username: 'reseller1',
            password: resellerPass,
            role: 'reseller',
            credits: 500,
            parent_id: 'admin',
            referral_code: 'RES001',
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        // إضافة الباقات الافتراضية
        const plans = [
            { id: 'trial', name: 'تجريبي', name_ar: 'تجريبي', duration_days: 1, data_limit_mb: 100, price: 0, is_gaming: 0 },
            { id: 'weekly', name: 'أسبوعي', name_ar: 'أسبوعي', duration_days: 7, data_limit_mb: 1000, price: 10, is_gaming: 0 },
            { id: 'monthly', name: 'شهري', name_ar: 'شهري', duration_days: 30, data_limit_mb: 5000, price: 30, is_gaming: 0 },
            { id: 'gaming_monthly', name: 'جيمنج شهري', name_ar: 'جيمنج شهري', duration_days: 30, data_limit_mb: 999999, price: 50, is_gaming: 1 }
        ];

        for (const plan of plans) {
            await db.collection('plans').doc(plan.id).set(plan);
        }
        console.log('✅ تم إنشاء البيانات الافتراضية بنجاح!');
    }
}
seedData();

// ============================================
// 4. Middleware للمصادقة
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
    
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'انتهت الجلسة' });
    }
}

function checkRole(roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'لا تملك صلاحية' });
        next();
    };
}

// ============================================
// 5. API Endpoints
// ============================================

// --- تسجيل الدخول ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'بيانات ناقصة' });
        
        const snapshot = await db.collection('users').where('username', '==', username).where('status', '!=', 'blocked').get();
        if (snapshot.empty) return res.json({ success: false, message: 'بيانات خاطئة' });
        
        const user = snapshot.docs[0].data();
        user.id = snapshot.docs[0].id;
        
        if (!bcrypt.compareSync(password, user.password)) {
            return res.json({ success: false, message: 'بيانات خاطئة' });
        }
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({
            success: true,
            message: 'تم تسجيل الدخول بنجاح',
            data: { token, user: { id: user.id, username: user.username, role: user.role, credits: user.credits } }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, message: 'خطأ في الخادم' });
    }
});

// --- معلومات الحساب الحالي ---
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        if (!doc.exists) return res.json({ success: false, message: 'المستخدم غير موجود' });
        
        const user = doc.data();
        user.id = doc.id;
        delete user.password; // لا نرسل كلمة المرور
        
        res.json({ success: true, data: user });
    } catch (error) {
        res.json({ success: false, message: 'خطأ في جلب البيانات' });
    }
});

// --- إنشاء حساب جديد ---
app.post('/api/account/create', authenticateToken, checkRole(['admin', 'reseller']), async (req, res) => {
    try {
        const { username, password, plan_id, is_random } = req.body;
        const reseller_id = req.user.id;
        
        const finalUsername = (is_random || !username) ? 'vip' + Math.floor(10000 + Math.random() * 90000) : username;
        const finalPassword = (is_random || !password) ? Math.random().toString(36).slice(-8) : password;
        
        const existing = await db.collection('accounts').where('username', '==', finalUsername).get();
        if (!existing.empty) return res.json({ success: false, message: 'اسم المستخدم موجود مسبقاً' });
        
        const planDoc = await db.collection('plans').doc(plan_id).get();
        if (!planDoc.exists) return res.json({ success: false, message: 'الباقة غير موجودة' });
        const plan = planDoc.data();
        
        const resellerDoc = await db.collection('users').doc(reseller_id).get();
        const reseller = resellerDoc.data();
        if (reseller.credits < plan.price) return res.json({ success: false, message: 'رصيد غير كافٍ' });
        
        const expiry_date = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
        const hashedPassword = bcrypt.hashSync(finalPassword, 10);
        const referral_code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // خصم الرصيد وإنشاء الحساب في عملية واحدة (Transaction)
        await db.runTransaction(async (t) => {
            t.update(db.collection('users').doc(reseller_id), { credits: reseller.credits - plan.price });
            t.set(db.collection('accounts').doc(), {
                reseller_id, username: finalUsername, password: hashedPassword, plan_id,
                expiry_date, referral_code, data_used_mb: 0, session_hours: 0, total_sessions: 0,
                status: 'active', created_at: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        
        res.json({
            success: true, message: 'تم إنشاء الحساب بنجاح',
            data: { username: finalUsername, password: finalPassword, plan: plan.name_ar, duration_days: plan.duration_days, expiry_date, referral_code }
        });
    } catch (error) {
        console.error('Create account error:', error);
        res.json({ success: false, message: 'خطأ في إنشاء الحساب' });
    }
});

// --- الإحصائيات ---
app.get('/api/stats', authenticateToken, checkRole(['admin', 'reseller']), async (req, res) => {
    try {
        const reseller_id = req.user.id;
        const role = req.user.role;
        
        let accountsQuery = db.collection('accounts');
        if (role !== 'admin') {
            accountsQuery = accountsQuery.where('reseller_id', '==', reseller_id);
        }
        
        const accountsSnapshot = await accountsQuery.get();
        let totalAccounts = 0, activeAccounts = 0, expiredAccounts = 0, totalDataUsed = 0;
        const now = new Date();
        
        accountsSnapshot.forEach(doc => {
            const acc = doc.data();
            totalAccounts++;
            totalDataUsed += (acc.data_used_mb || 0);
            if (new Date(acc.expiry_date) > now && acc.status === 'active') activeAccounts++;
            else expiredAccounts++;
        });
        
        const userDoc = await db.collection('users').doc(reseller_id).get();
        const user = userDoc.data();
        
        res.json({
            success: true, stats: {
                total_accounts: totalAccounts, active_accounts: activeAccounts, expired_accounts: expiredAccounts,
                total_data_used_mb: Math.round(totalDataUsed), available_credits: user.credits || 0,
                referral_count: user.referral_count || 0, total_cards: 0, unused_cards: 0 // يمكن تطويرها لاحقاً
            }
        });
    } catch (error) {
        res.json({ success: false, message: 'خطأ في جلب الإحصائيات' });
    }
});

// --- قائمة الحسابات ---
app.get('/api/accounts', authenticateToken, checkRole(['admin', 'reseller']), async (req, res) => {
    try {
        const reseller_id = req.user.id;
        const role = req.user.role;
        
        let query = db.collection('accounts').orderBy('created_at', 'desc');
        if (role !== 'admin') {
            query = query.where('reseller_id', '==', reseller_id);
        }
        
        const snapshot = await query.get();
        const accounts = [];
        
        for (const doc of snapshot.docs) {
            const acc = doc.data();
            const planDoc = await db.collection('plans').doc(acc.plan_id).get();
            accounts.push({ id: doc.id, ...acc, plan_name: planDoc.exists ? planDoc.data().name_ar : 'غير معروف' });
        }
        
        res.json({ success: true, accounts });
    } catch (error) {
        res.json({ success: false, message: 'خطأ في جلب الحسابات' });
    }
});

// ============================================
// 6. خدمة الملفات الثابتة (في النهاية)
// ============================================
app.use(express.static(__dirname));

// ============================================
// 7. تشغيل الخادم
// ============================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 B.T.C VPN Server (Firebase) Started');
    console.log('========================================');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`👑 Admin: admin / admin123`);
    console.log('========================================');
});
