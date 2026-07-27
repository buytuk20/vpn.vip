// ============================================
// B.T.C VPN - الخادم الاحترافي الكامل والمتكامل
// ============================================

const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'btc_vpn_ultra_secret_2026_change_in_production';

// ============================================
// 1. الإعدادات الأساسية و Middleware
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// 2. قاعدة البيانات SQLite
// ============================================
const db = new Database('btc_vpn.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        credits INTEGER DEFAULT 0,
        parent_id INTEGER,
        referral_code TEXT UNIQUE,
        referral_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        data_limit_mb INTEGER NOT NULL,
        price INTEGER NOT NULL,
        plan_type TEXT DEFAULT 'standard',
        is_gaming INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reseller_id INTEGER,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        plan_id INTEGER,
        data_used_mb REAL DEFAULT 0,
        session_hours REAL DEFAULT 0,
        last_session_start DATETIME,
        last_session_end DATETIME,
        total_sessions INTEGER DEFAULT 0,
        expiry_date DATETIME NOT NULL,
        status TEXT DEFAULT 'active',
        referred_by INTEGER,
        referral_bonus_days INTEGER DEFAULT 0,
        referral_claimed INTEGER DEFAULT 0,
        referral_code TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        duration_minutes REAL DEFAULT 0,
        data_used_mb REAL DEFAULT 0,
        server_id INTEGER,
        ip_address TEXT
    );
    
    CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_code TEXT UNIQUE NOT NULL,
        plan_id INTEGER,
        duration_days INTEGER,
        is_used INTEGER DEFAULT 0,
        used_by INTEGER,
        used_at DATETIME,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        logo_url TEXT,
        is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER,
        display_name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 443,
        protocol TEXT DEFAULT 'tcp',
        server_type TEXT DEFAULT 'premium',
        sni_hostname TEXT NOT NULL,
        payload TEXT NOT NULL,
        is_gaming INTEGER DEFAULT 0,
        ping_ms INTEGER DEFAULT 50,
        is_active INTEGER DEFAULT 1
    );
    
    CREATE TABLE IF NOT EXISTS credit_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER,
        to_user_id INTEGER,
        amount INTEGER,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_account_id INTEGER,
        referred_account_id INTEGER UNIQUE,
        bonus_days INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// ============================================
// 3. البيانات الافتراضية
// ============================================
const adminExists = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
if (adminExists.count === 0) {
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password, role, credits, referral_code) VALUES ('admin', ?, 'admin', 10000, 'ADMIN001')`).run(adminPass);
    
    const resellerPass = bcrypt.hashSync('reseller123', 10);
    db.prepare(`INSERT INTO users (username, password, role, credits, parent_id, referral_code) VALUES ('reseller1', ?, 'reseller', 500, 1, 'RES001')`).run(resellerPass);
    
    db.prepare(`INSERT INTO plans (name, name_ar, duration_days, data_limit_mb, price, plan_type, is_gaming) VALUES 
        ('trial', 'تجريبي', 1, 100, 0, 'trial', 0),
        ('weekly', 'أسبوعي', 7, 1000, 10, 'weekly', 0),
        ('monthly', 'شهري', 30, 5000, 30, 'monthly', 0),
        ('3months', '3 أشهر', 90, 15000, 80, 'premium', 0),
        ('gaming_weekly', 'جيمنج أسبوعي', 7, 999999, 20, 'gaming', 1),
        ('gaming_monthly', 'جيمنج شهري', 30, 999999, 50, 'gaming', 1)
    `).run();
    
    db.prepare(`INSERT INTO companies (name, name_ar) VALUES ('Vodafone', 'فودافون'), ('Orange', 'اورنج'), ('Etisalat', 'اتصالات'), ('WE', 'وي')`).run();
    
    db.prepare(`INSERT INTO servers (company_id, display_name, host, port, sni_hostname, payload, is_gaming, ping_ms) VALUES 
        (1, 'فودافون 1', 'vpn1.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 0, 45),
        (1, 'فودافون 2', 'vpn2.btc.com', 8080, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 0, 50),
        (2, 'اورنج 1', 'vpn3.btc.com', 443, 'my.orange.eg', 'GET / HTTP/1.1[crlf]Host: my.orange.eg[crlf][crlf]', 0, 55),
        (3, 'اتصالات 1', 'vpn4.btc.com', 443, 'etisalat.eg', 'GET / HTTP/1.1[crlf]Host: etisalat.eg[crlf][crlf]', 0, 60),
        (4, 'وي 1', 'vpn5.btc.com', 443, 'we.com.eg', 'GET / HTTP/1.1[crlf]Host: we.com.eg[crlf][crlf]', 0, 65),
        (1, '🎮 PUBG Server 1', 'gaming1.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 1, 25),
        (1, '🎮 PUBG Server 2', 'gaming2.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 1, 30)
    `).run();
    
    console.log('✅ تم إنشاء البيانات الافتراضية بنجاح');
}

// ============================================
// 4. دوال مساعدة
// ============================================
function generateRandomUsername() { return 'vip' + Math.floor(10000 + Math.random() * 90000); }
function generateRandomPassword() { return Math.random().toString(36).slice(-8); }
function generateCardCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'BTC-';
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        if (i < 2) code += '-';
    }
    return code;
}
function generateReferralCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

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
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'بيانات ناقصة' });
    
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND status = "active"').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    
    res.json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح',
        data: {
            token: token,
            user: { id: user.id, username: user.username, role: user.role, credits: user.credits, referral_code: user.referral_code }
        }
    });
});

// --- معلومات الحساب الحالي ---
app.get('/api/me', authenticateToken, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.json({ success: false, message: 'المستخدم غير موجود' });
    res.json({ success: true, data: user });
});

// --- إنشاء حساب جديد ---
app.post('/api/account/create', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const { username, password, plan_id, is_random, referral_code } = req.body;
    const reseller_id = req.user.id;
    
    let finalUsername = is_random || !username ? generateRandomUsername() : username;
    let finalPassword = is_random || !password ? generateRandomPassword() : password;
    
    if (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE username = ?').get(finalUsername).count > 0) {
        return res.json({ success: false, message: 'اسم المستخدم موجود مسبقاً' });
    }
    
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(plan_id);
    if (!plan) return res.json({ success: false, message: 'الباقة غير موجودة' });
    
    const reseller = db.prepare('SELECT credits FROM users WHERE id = ?').get(reseller_id);
    if (reseller.credits < plan.price) return res.json({ success: false, message: 'رصيد غير كافٍ' });
    
    const expiry_date = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const hashedPassword = bcrypt.hashSync(finalPassword, 10);
    const newReferralCode = generateReferralCode();
    
    try {
        const result = db.prepare(`INSERT INTO accounts (reseller_id, username, password, plan_id, expiry_date, referral_code) VALUES (?, ?, ?, ?, ?, ?)`).run(reseller_id, finalUsername, hashedPassword, plan_id, expiry_date, newReferralCode);
        
        if (plan.price > 0) db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(plan.price, reseller_id);
        
        res.json({
            success: true, message: 'تم إنشاء الحساب بنجاح',
            data: { username: finalUsername, password: finalPassword, plan: plan.name_ar, duration_days: plan.duration_days, expiry_date, referral_code: newReferralCode }
        });
    } catch (error) {
        res.json({ success: false, message: 'خطأ في إنشاء الحساب' });
    }
});

// --- الإحصائيات ---
app.get('/api/stats', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    const condition = role === 'admin' ? '' : `WHERE reseller_id = ${reseller_id}`;
    
    const totalAccounts = db.prepare(`SELECT COUNT(*) as count FROM accounts ${condition}`).get().count;
    const activeAccounts = db.prepare(`SELECT COUNT(*) as count FROM accounts ${condition ? condition + ' AND' : 'WHERE'} status = "active" AND expiry_date > datetime("now")`).get().count;
    const expiredAccounts = db.prepare(`SELECT COUNT(*) as count FROM accounts ${condition ? condition + ' AND' : 'WHERE'} expiry_date <= datetime("now") OR status = "expired"`).get().count;
    const totalDataUsed = db.prepare(`SELECT COALESCE(SUM(data_used_mb), 0) as total FROM accounts ${condition}`).get().total;
    const user = db.prepare('SELECT credits, referral_count FROM users WHERE id = ?').get(reseller_id);
    const totalCards = db.prepare(`SELECT COUNT(*) as count FROM cards ${condition ? condition.replace('reseller_id', 'created_by') : ''}`).get().count;
    const unusedCards = db.prepare(`SELECT COUNT(*) as count FROM cards ${condition ? condition.replace('reseller_id', 'created_by') + ' AND' : 'WHERE'} is_used = 0`).get().count;
    
    res.json({
        success: true, stats: {
            total_accounts: totalAccounts, active_accounts: activeAccounts, expired_accounts: expiredAccounts,
            total_data_used_mb: Math.round(totalDataUsed), available_credits: user.credits,
            referral_count: user.referral_count, total_cards: totalCards, unused_cards: unusedCards
        }
    });
});

// --- قائمة الحسابات ---
app.get('/api/accounts', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    const query = role === 'admin' 
        ? `SELECT a.*, p.name_ar as plan_name FROM accounts a LEFT JOIN plans p ON a.plan_id = p.id ORDER BY a.created_at DESC`
        : `SELECT a.*, p.name_ar as plan_name FROM accounts a LEFT JOIN plans p ON a.plan_id = p.id WHERE a.reseller_id = ? ORDER BY a.created_at DESC`;
    
    const accounts = role === 'admin' ? db.prepare(query).all() : db.prepare(query).all(reseller_id);
    res.json({ success: true, accounts });
});

// --- إنشاء بطاقات ---
app.post('/api/cards/generate', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const { plan_id, count } = req.body;
    const reseller_id = req.user.id;
    if (!plan_id || !count || count < 1 || count > 100) return res.json({ success: false, message: 'عدد البطاقات يجب أن يكون بين 1 و 100' });
    
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan_id);
    const totalCost = plan.price * count;
    const reseller = db.prepare('SELECT credits FROM users WHERE id = ?').get(reseller_id);
    if (reseller.credits < totalCost) return res.json({ success: false, message: 'رصيد غير كافٍ' });
    
    const cards = [];
    const insertCard = db.prepare('INSERT INTO cards (card_code, plan_id, duration_days, created_by) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((cardsData) => {
        for (const card of cardsData) insertCard.run(card.code, plan_id, plan.duration_days, reseller_id);
    });
    
    for (let i = 0; i < count; i++) cards.push({ code: generateCardCode() });
    insertMany(cards);
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(totalCost, reseller_id);
    
    res.json({ success: true, message: `تم إنشاء ${count} بطاقة`, data: { cards: cards.map(c => c.code), plan: plan.name_ar } });
});

// --- قائمة البطاقات ---
app.get('/api/cards', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    const query = role === 'admin'
        ? `SELECT c.*, p.name_ar as plan_name FROM cards c LEFT JOIN plans p ON c.plan_id = p.id ORDER BY c.created_at DESC`
        : `SELECT c.*, p.name_ar as plan_name FROM cards c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.created_by = ? ORDER BY c.created_at DESC`;
    
    const cards = role === 'admin' ? db.prepare(query).all() : db.prepare(query).all(reseller_id);
    res.json({ success: true, cards });
});

// ============================================
// 6. خدمة الملفات الثابتة (يجب أن يكون في النهاية)
// ============================================
app.use(express.static(__dirname));

// ============================================
// 7. تشغيل الخادم
// ============================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 B.T.C VPN Server Started Successfully');
    console.log('========================================');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`👑 Admin: admin / admin123`);
    console.log(`👤 Reseller: reseller1 / reseller123`);
    console.log('========================================');
});
