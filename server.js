// ============================================
// B.T.C VPN - الخادم الاحترافي مع Firebase
// ============================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// تهيئة Firebase
let admin;
try {
    admin = require('firebase-admin');
    
    if (!admin.apps.length) {
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
        
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: privateKey
            })
        });
        console.log('✅ Firebase تم ربطه بنجاح');
    }
} catch (error) {
    console.error('❌ خطأ في Firebase:', error.message);
    process.exit(1);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'btc_vpn_secret_2026';

// ============================================
// الإعدادات
// ============================================
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// البيانات الافتراضية
// ============================================
async function seedData() {
    try {
        const adminRef = db.collection('users').doc('admin');
        const adminDoc = await adminRef.get();
        
        if (!adminDoc.exists) {
            console.log('🌱 إنشاء البيانات الافتراضية...');
            
            await adminRef.set({
                username: 'admin',
                password: bcrypt.hashSync('admin123', 10),
                role: 'admin',
                credits: 10000,
                referral_code: 'ADMIN001',
                status: 'active',
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });

            await db.collection('users').doc('reseller1').set({
                username: 'reseller1',
                password: bcrypt.hashSync('reseller123', 10),
                role: 'reseller',
                credits: 500,
                parent_id: 'admin',
                referral_code: 'RES001',
                status: 'active',
                created_at: admin.firestore.FieldValue.serverTimestamp()
            });

            const plans = [
                { id: 'trial', name_ar: 'تجريبي', duration_days: 1, data_limit_mb: 100, price: 0, is_gaming: 0 },
                { id: 'weekly', name_ar: 'أسبوعي', duration_days: 7, data_limit_mb: 1000, price: 10, is_gaming: 0 },
                { id: 'monthly', name_ar: 'شهري', duration_days: 30, data_limit_mb: 5000, price: 30, is_gaming: 0 },
                { id: '3months', name_ar: '3 أشهر', duration_days: 90, data_limit_mb: 15000, price: 80, is_gaming: 0 },
                { id: 'gaming_weekly', name_ar: 'جيمنج أسبوعي', duration_days: 7, data_limit_mb: 999999, price: 20, is_gaming: 1 },
                { id: 'gaming_monthly', name_ar: 'جيمنج شهري', duration_days: 30, data_limit_mb: 999999, price: 50, is_gaming: 1 }
            ];

            for (const plan of plans) {
                await db.collection('plans').doc(plan.id).set(plan);
            }
            console.log('✅ تم إنشاء البيانات الافتراضية');
        } else {
            console.log('✅ البيانات موجودة مسبقاً');
        }
    } catch (error) {
        console.error('❌ خطأ في إنشاء البيانات:', error.message);
    }
}

// ============================================
// Middleware
// ============================================
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
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
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية' });
        }
        next();
    };
}

// ============================================
// API Endpoints
// ============================================

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.json({ success: false, message: 'بيانات ناقصة' });
        }
        
        const snapshot = await db.collection('users').where('username', '==', username).get();
        if (snapshot.empty) {
            return res.json({ success: false, message: 'بيانات خاطئة' });
        }
        
        const userDoc = snapshot.docs[0];
        const user = userDoc.data();
        
        if (!bcrypt.compareSync(password, user.password)) {
            return res.json({ success: false, message: 'بيانات خاطئة' });
        }
        
        const token = jwt.sign(
            { id: userDoc.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'تم تسجيل الدخول',
            data: {
                token,
                user: {
                    id: userDoc.id,
                    username: user.username,
                    role: user.role,
                    credits: user.credits
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.json({ success: false, message: 'خطأ في الخادم: ' + error.message });
    }
});

// معلومات الحساب
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        if (!doc.exists) {
            return res.json({ success: false, message: 'المستخدم غير موجود' });
        }
        const user = doc.data();
        delete user.password;
        res.json({ success: true, data: { ...user, id: doc.id } });
    } catch (error) {
        res.json({ success: false, message: 'خطأ: ' + error.message });
    }
});

// الإحصائيات
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const accountsSnap = await db.collection('accounts').get();
        let total = 0, active = 0, expired = 0;
        const now = new Date();
        
        accountsSnap.forEach(doc => {
            const acc = doc.data();
            total++;
            if (new Date(acc.expiry_date) > now && acc.status === 'active') active++;
            else expired++;
        });
        
        const userDoc = await db.collection('users').doc(req.user.id).get();
        const user = userDoc.data();
        
        res.json({
            success: true,
            stats: {
                total_accounts: total,
                active_accounts: active,
                expired_accounts: expired,
                available_credits: user.credits || 0
            }
        });
    } catch (error) {
        res.json({ success: false, message: 'خطأ: ' + error.message });
    }
});

// قائمة الحسابات
app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('accounts').orderBy('created_at', 'desc').get();
        const accounts = [];
        for (const doc of snap.docs) {
            const acc = doc.data();
            const planDoc = await db.collection('plans').doc(acc.plan_id).get();
            accounts.push({
                id: doc.id,
                ...acc,
                plan_name: planDoc.exists ? planDoc.data().name_ar : 'غير محدد'
            });
        }
        res.json({ success: true, accounts });
    } catch (error) {
        res.json({ success: false, message: 'خطأ: ' + error.message });
    }
});

// إنشاء حساب
app.post('/api/account/create', authenticateToken, checkRole(['admin', 'reseller']), async (req, res) => {
    try {
        const { username, password, plan_id, is_random } = req.body;
        
        const finalUsername = (is_random || !username) ? 'vip' + Math.floor(10000 + Math.random() * 90000) : username;
        const finalPassword = (is_random || !password) ? Math.random().toString(36).slice(-8) : password;
        
        const existing = await db.collection('accounts').where('username', '==', finalUsername).get();
        if (!existing.empty) {
            return res.json({ success: false, message: 'اسم المستخدم موجود' });
        }
        
        const planDoc = await db.collection('plans').doc(plan_id).get();
        if (!planDoc.exists) {
            return res.json({ success: false, message: 'الباقة غير موجودة' });
        }
        const plan = planDoc.data();
        
        const userDoc = await db.collection('users').doc(req.user.id).get();
        const user = userDoc.data();
        
        if (user.credits < plan.price) {
            return res.json({ success: false, message: 'رصيد غير كافٍ' });
        }
        
        const expiry_date = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
        const referral_code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        await db.collection('accounts').add({
            reseller_id: req.user.id,
            username: finalUsername,
            password: bcrypt.hashSync(finalPassword, 10),
            plan_id,
            expiry_date,
            referral_code,
            data_used_mb: 0,
            session_hours: 0,
            total_sessions: 0,
            status: 'active',
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await db.collection('users').doc(req.user.id).update({
            credits: admin.firestore.FieldValue.increment(-plan.price)
        });
        
        res.json({
            success: true,
            message: 'تم إنشاء الحساب',
            data: {
                username: finalUsername,
                password: finalPassword,
                plan: plan.name_ar,
                duration_days: plan.duration_days,
                expiry_date,
                referral_code
            }
        });
    } catch (error) {
        console.error('Create error:', error);
        res.json({ success: false, message: 'خطأ: ' + error.message });
    }
});

// ============================================
// ملفات ثابتة
// ============================================
app.use(express.static(__dirname));

// ============================================
// تشغيل الخادم
// ============================================
async function startServer() {
    await seedData();
    app.listen(PORT, () => {
        console.log('========================================');
        console.log(' B.T.C VPN Server Started');
        console.log(`📡 Port: ${PORT}`);
        console.log('========================================');
    });
}

startServer().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
