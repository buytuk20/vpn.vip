// ============================================
// B.T.C VPN — الخادم الاحترافي مع Firebase (نظام إدارة كامل)
// ============================================
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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
const TS = admin.firestore.FieldValue;
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'btc_vpn_secret_2026';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// البيانات الافتراضية
// ============================================
async function seedData() {
    try {
        const adminRef = db.collection('users').doc('admin');
        if (!(await adminRef.get()).exists) {
            console.log('🌱 إنشاء البيانات الافتراضية...');
            await adminRef.set({
                username: 'admin', password: bcrypt.hashSync('admin123', 10),
                role: 'admin', credits: 10000, referral_code: 'ADMIN001',
                status: 'active', created_at: TS.serverTimestamp()
            });
            await db.collection('users').doc('reseller1').set({
                username: 'reseller1', password: bcrypt.hashSync('reseller123', 10),
                role: 'reseller', credits: 500, parent_id: 'admin', referral_code: 'RES001',
                status: 'active', created_at: TS.serverTimestamp()
            });
        }

        const plansSnap = await db.collection('plans').get();
        if (plansSnap.empty) {
            const plans = [
                { name_ar: 'تجريبي', duration_days: 1, data_limit_mb: 100, price: 0, is_gaming: 0 },
                { name_ar: 'أسبوعي', duration_days: 7, data_limit_mb: 1000, price: 10, is_gaming: 0 },
                { name_ar: 'شهري', duration_days: 30, data_limit_mb: 5000, price: 30, is_gaming: 0 },
                { name_ar: '3 أشهر', duration_days: 90, data_limit_mb: 15000, price: 80, is_gaming: 0 },
                { name_ar: 'جيمنج أسبوعي', duration_days: 7, data_limit_mb: 999999, price: 20, is_gaming: 1 },
                { name_ar: 'جيمنج شهري', duration_days: 30, data_limit_mb: 999999, price: 50, is_gaming: 1 }
            ];
            for (const p of plans) await db.collection('plans').add(p);
        }

        const srvSnap = await db.collection('servers').get();
        if (srvSnap.empty) {
            const servers = [
                { display_name: 'فودافون 1', company_name: 'فودافون', host: 'vpn1.btc.com', port: 443, sni_hostname: 'web.vodafone.com.eg', payload: 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', is_gaming: 0, ping_ms: 45, is_active: 1 },
                { display_name: 'اورنج 1', company_name: 'اورنج', host: 'vpn3.btc.com', port: 443, sni_hostname: 'my.orange.eg', payload: 'GET / HTTP/1.1[crlf]Host: my.orange.eg[crlf][crlf]', is_gaming: 0, ping_ms: 55, is_active: 1 },
                { display_name: '🎮 PUBG Server', company_name: 'فودافون', host: 'gaming1.btc.com', port: 443, sni_hostname: 'web.vodafone.com.eg', payload: 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', is_gaming: 1, ping_ms: 25, is_active: 1 }
            ];
            for (const s of servers) await db.collection('servers').add(s);
        }
        console.log('✅ البيانات الافتراضية جاهزة');
    } catch (error) {
        console.error('❌ خطأ في seedData:', error.message);
    }
}

// ============================================
// Middleware
// ============================================
function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { return res.status(403).json({ success: false, message: 'انتهت الجلسة' }); }
}
function checkRole(roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, message: 'لا تملك صلاحية' });
        next();
    };
}
const onlyAdmin = checkRole(['admin']);
const staff = checkRole(['admin', 'reseller']);

// ============================================
// المصادقة
// ============================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'بيانات ناقصة' });
        const snap = await db.collection('users').where('username', '==', username).get();
        if (snap.empty) return res.json({ success: false, message: 'بيانات خاطئة' });
        const doc = snap.docs[0], u = doc.data();
        if (u.status === 'blocked') return res.json({ success: false, message: 'الحساب موقوف' });
        if (!bcrypt.compareSync(password, u.password)) return res.json({ success: false, message: 'بيانات خاطئة' });
        const token = jwt.sign({ id: doc.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, message: 'تم تسجيل الدخول', data: { token, user: { id: doc.id, username: u.username, role: u.role, credits: u.credits } } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.user.id).get();
        if (!doc.exists) return res.json({ success: false, message: 'غير موجود' });
        const u = doc.data(); delete u.password;
        res.json({ success: true, data: { ...u, id: doc.id } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الإحصائيات
// ============================================
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('accounts').get();
        let total = 0, active = 0, expired = 0; const now = new Date();
        snap.forEach(d => { const a = d.data(); total++; if (new Date(a.expiry_date) > now && a.status === 'active') active++; else expired++; });
        const u = (await db.collection('users').doc(req.user.id).get()).data();
        res.json({ success: true, stats: { total_accounts: total, active_accounts: active, expired_accounts: expired, available_credits: u.credits || 0 } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الحسابات
// ============================================
app.get('/api/accounts', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('accounts').orderBy('created_at', 'desc').limit(200).get();
        const accounts = [];
        for (const d of snap.docs) {
            const a = d.data();
            const pd = await db.collection('plans').doc(a.plan_id).get();
            accounts.push({ id: d.id, ...a, plan_name: pd.exists ? pd.data().name_ar : '—' });
        }
        res.json({ success: true, accounts });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/account/create', authenticateToken, staff, async (req, res) => {
    try {
        const { username, password, plan_id, is_random } = req.body;
        const finalUsername = (is_random || !username) ? 'vip' + Math.floor(10000 + Math.random() * 90000) : username;
        const finalPassword = (is_random || !password) ? Math.random().toString(36).slice(-8) : password;
        if (!(await db.collection('accounts').where('username', '==', finalUsername).get()).empty)
            return res.json({ success: false, message: 'اسم المستخدم موجود' });
        const pd = await db.collection('plans').doc(plan_id).get();
        if (!pd.exists) return res.json({ success: false, message: 'الباقة غير موجودة' });
        const plan = pd.data();
        const ud = await db.collection('users').doc(req.user.id).get();
        if (ud.data().credits < plan.price) return res.json({ success: false, message: 'رصيد غير كافٍ' });
        const expiry_date = new Date(Date.now() + plan.duration_days * 86400000).toISOString();
        const referral_code = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db.collection('accounts').add({
            reseller_id: req.user.id, username: finalUsername, password: bcrypt.hashSync(finalPassword, 10),
            plan_id, expiry_date, referral_code, data_used_mb: 0, session_hours: 0, total_sessions: 0,
            status: 'active', created_at: TS.serverTimestamp()
        });
        await db.collection('users').doc(req.user.id).update({ credits: TS.increment(-plan.price) });
        res.json({ success: true, message: 'تم الإصدار', data: { username: finalUsername, password: finalPassword, plan: plan.name_ar, duration_days: plan.duration_days, expiry_date, referral_code } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الباقات (Plans) — إدارة
// ============================================
app.get('/api/plans', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('plans').get();
        const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ success: true, plans });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/plans/save', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, name_ar, duration_days, data_limit_mb, price, is_gaming } = req.body;
        if (!name_ar || !duration_days) return res.json({ success: false, message: 'الاسم والمدة مطلوبان' });
        const data = {
            name_ar: String(name_ar).trim(),
            duration_days: Number(duration_days) || 1,
            data_limit_mb: Number(data_limit_mb) || 0,
            price: Number(price) || 0,
            is_gaming: is_gaming ? 1 : 0
        };
        if (id) { await db.collection('plans').doc(id).set(data, { merge: true }); }
        else { await db.collection('plans').add(data); }
        res.json({ success: true, message: id ? 'تم تعديل الباقة' : 'تمت إضافة الباقة' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.delete('/api/plans/:id', authenticateToken, onlyAdmin, async (req, res) => {
    try { await db.collection('plans').doc(req.params.id).delete(); res.json({ success: true, message: 'تم حذف الباقة' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// السيرفرات (Servers) — إدارة
// ============================================
app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const snap = await db.collection('servers').get();
        const servers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.json({ success: true, servers });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/servers/save', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, display_name, company_name, host, port, sni_hostname, payload, is_gaming, ping_ms, is_active } = req.body;
        if (!display_name || !host || !sni_hostname) return res.json({ success: false, message: 'الاسم والمضيف و SNI مطلوبة' });
        const data = {
            display_name: String(display_name).trim(),
            company_name: String(company_name || 'عام').trim(),
            host: String(host).trim(),
            port: Number(port) || 443,
            sni_hostname: String(sni_hostname).trim(),
            payload: String(payload || ''),
            is_gaming: is_gaming ? 1 : 0,
            ping_ms: Number(ping_ms) || 50,
            is_active: (is_active === 0 || is_active === false) ? 0 : 1
        };
        if (id) { await db.collection('servers').doc(id).set(data, { merge: true }); }
        else { await db.collection('servers').add(data); }
        res.json({ success: true, message: id ? 'تم تعديل السيرفر' : 'تمت إضافة السيرفر' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/servers/toggle', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, is_active } = req.body;
        await db.collection('servers').doc(id).update({ is_active: is_active ? 1 : 0 });
        res.json({ success: true, message: is_active ? 'تم التفعيل' : 'تم الإيقاف' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.delete('/api/servers/:id', authenticateToken, onlyAdmin, async (req, res) => {
    try { await db.collection('servers').doc(req.params.id).delete(); res.json({ success: true, message: 'تم حذف السيرفر' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الموزّعون (Users) — إدارة
// ============================================
app.get('/api/users', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const snap = await db.collection('users').get();
        const users = snap.docs.map(d => { const u = d.data(); delete u.password; return { id: d.id, ...u }; });
        res.json({ success: true, users });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/users/create', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { username, password, role, credits } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'الاسم وكلمة المرور مطلوبان' });
        if (!(await db.collection('users').where('username', '==', username.trim()).get()).empty)
            return res.json({ success: false, message: 'اسم المستخدم مستخدم' });
        const ref = db.collection('users').doc();
        await ref.set({
            username: username.trim(), password: bcrypt.hashSync(password, 10),
            role: role === 'admin' ? 'admin' : 'reseller',
            credits: Number(credits) || 0,
            referral_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
            status: 'active', created_at: TS.serverTimestamp()
        });
        res.json({ success: true, message: 'تمت إضافة الموزّع' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/users/credit', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, amount, mode } = req.body;
        const val = Math.abs(Number(amount) || 0);
        if (mode === 'set') await db.collection('users').doc(id).update({ credits: val });
        else await db.collection('users').doc(id).update({ credits: TS.increment(val) });
        res.json({ success: true, message: 'تم تحديث الرصيد' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/users/toggle', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, status } = req.body;
        await db.collection('users').doc(id).update({ status: status === 'blocked' ? 'blocked' : 'active' });
        res.json({ success: true, message: 'تم تحديث الحالة' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.delete('/api/users/:id', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        if (req.params.id === req.user.id) return res.json({ success: false, message: 'لا يمكنك حذف نفسك' });
        const u = (await db.collection('users').doc(req.params.id).get()).data();
        if (!u) return res.json({ success: false, message: 'غير موجود' });
        if (u.role === 'admin') return res.json({ success: false, message: 'لا يمكن حذف مدير' });
        await db.collection('users').doc(req.params.id).delete();
        res.json({ success: true, message: 'تم حذف الموزّع' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// ملفات ثابتة + تشغيل
// ============================================
app.use(express.static(__dirname));

async function startServer() {
    await seedData();
    app.listen(PORT, () => {
        console.log('========================================');
        console.log('🚀 B.T.C VPN Server Started');
        console.log(`📡 Port: ${PORT}`);
        console.log('========================================');
    });
}
startServer().catch(err => { console.error('Fatal:', err); process.exit(1); });
