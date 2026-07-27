// ============================================
// B.T.C VPN - الخادم الاحترافي الكامل
// Gaming + Referral + Cards + Auto-Delete
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
// 1. الإعدادات الأساسية
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
// ============================================
// 2. قاعدة البيانات SQLite
// ============================================
const db = new Database('btc_vpn.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    -- جدول المستخدمين (مديرين + موزعين)
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES users(id)
    );
    
    -- جدول الباقات
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
    
    -- جدول الحسابات المولدة (المستخدمين النهائيين)
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reseller_id) REFERENCES users(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id),
        FOREIGN KEY (referred_by) REFERENCES accounts(id)
    );
    
    -- جدول الجلسات (تتبع الاستهلاك الحقيقي)
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        duration_minutes REAL DEFAULT 0,
        data_used_mb REAL DEFAULT 0,
        server_id INTEGER,
        ip_address TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (server_id) REFERENCES servers(id)
    );
    
    -- جدول البطاقات
    CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_code TEXT UNIQUE NOT NULL,
        plan_id INTEGER,
        duration_days INTEGER,
        is_used INTEGER DEFAULT 0,
        used_by INTEGER,
        used_at DATETIME,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (plan_id) REFERENCES plans(id),
        FOREIGN KEY (used_by) REFERENCES accounts(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
    );
    
    -- جدول الشركات
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_ar TEXT NOT NULL,
        logo_url TEXT,
        is_active INTEGER DEFAULT 1
    );
    
    -- جدول السيرفرات
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
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY (company_id) REFERENCES companies(id)
    );
    
    -- جدول تحويلات الرصيد
    CREATE TABLE IF NOT EXISTS credit_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id INTEGER,
        to_user_id INTEGER,
        amount INTEGER,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (from_user_id) REFERENCES users(id),
        FOREIGN KEY (to_user_id) REFERENCES users(id)
    );
    
    -- جدول سجل الأنشطة
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    -- جدول الإحالات
    CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_account_id INTEGER,
        referred_account_id INTEGER UNIQUE,
        bonus_days INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (referrer_account_id) REFERENCES accounts(id),
        FOREIGN KEY (referred_account_id) REFERENCES accounts(id)
    );
`);

// ============================================
// 3. البيانات الافتراضية
// ============================================
const adminExists = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
if (adminExists.count === 0) {
    // المدير الرئيسي
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password, role, credits, referral_code) 
                VALUES ('admin', ?, 'admin', 10000, 'ADMIN001')`).run(adminPass);
    
    // موزع تجريبي
    const resellerPass = bcrypt.hashSync('reseller123', 10);
    db.prepare(`INSERT INTO users (username, password, role, credits, parent_id, referral_code) 
                VALUES ('reseller1', ?, 'reseller', 500, 1, 'RES001')`).run(resellerPass);
    
    // الباقات
    db.prepare(`INSERT INTO plans (name, name_ar, duration_days, data_limit_mb, price, plan_type, is_gaming) VALUES 
        ('trial', 'تجريبي', 1, 100, 0, 'trial', 0),
        ('weekly', 'أسبوعي', 7, 1000, 10, 'weekly', 0),
        ('monthly', 'شهري', 30, 5000, 30, 'monthly', 0),
        ('3months', '3 أشهر', 90, 15000, 80, 'premium', 0),
        ('gaming_weekly', 'جيمنج أسبوعي', 7, 999999, 20, 'gaming', 1),
        ('gaming_monthly', 'جيمنج شهري', 30, 999999, 50, 'gaming', 1)
    `).run();
    
    // الشركات
    db.prepare(`INSERT INTO companies (name, name_ar) VALUES 
        ('Vodafone', 'فودافون'), 
        ('Orange', 'اورنج'), 
        ('Etisalat', 'اتصالات'), 
        ('WE', 'وي')
    `).run();
    
    // السيرفرات العادية
    db.prepare(`INSERT INTO servers (company_id, display_name, host, port, sni_hostname, payload, is_gaming, ping_ms) VALUES 
        (1, 'فودافون 1', 'vpn1.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 0, 45),
        (1, 'فودافون 2', 'vpn2.btc.com', 8080, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 0, 50),
        (2, 'اورنج 1', 'vpn3.btc.com', 443, 'my.orange.eg', 'GET / HTTP/1.1[crlf]Host: my.orange.eg[crlf][crlf]', 0, 55),
        (3, 'اتصالات 1', 'vpn4.btc.com', 443, 'etisalat.eg', 'GET / HTTP/1.1[crlf]Host: etisalat.eg[crlf][crlf]', 0, 60),
        (4, 'وي 1', 'vpn5.btc.com', 443, 'we.com.eg', 'GET / HTTP/1.1[crlf]Host: we.com.eg[crlf][crlf]', 0, 65)
    `).run();
    
    // سيرفرات الألعاب (Gaming Mode) - Ping منخفض
    db.prepare(`INSERT INTO servers (company_id, display_name, host, port, sni_hostname, payload, is_gaming, ping_ms) VALUES 
        (1, '🎮 PUBG Server 1', 'gaming1.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 1, 25),
        (1, '🎮 PUBG Server 2', 'gaming2.btc.com', 443, 'web.vodafone.com.eg', 'GET / HTTP/1.1[crlf]Host: web.vodafone.com.eg[crlf][crlf]', 1, 30),
        (2, '🎮 Free Fire Server', 'gaming3.btc.com', 443, 'my.orange.eg', 'GET / HTTP/1.1[crlf]Host: my.orange.eg[crlf][crlf]', 1, 35),
        (3, '🎮 COD Mobile Server', 'gaming4.btc.com', 443, 'etisalat.eg', 'GET / HTTP/1.1[crlf]Host: etisalat.eg[crlf][crlf]', 1, 40)
    `).run();
    
    console.log('✅ تم إنشاء البيانات الافتراضية');
    console.log('👑 Admin: admin / admin123');
    console.log('👤 Reseller: reseller1 / reseller123');
}

// ============================================
// 4. دوال مساعدة
// ============================================

// توليد اسم مستخدم عشوائي بصيغة vip + 5 أرقام
function generateRandomUsername() {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    return `vip${randomNum}`;
}

// توليد كلمة مرور عشوائية
function generateRandomPassword() {
    return Math.random().toString(36).slice(-8);
}

// توليد كود بطاقة
function generateCardCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'BTC-';
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (i < 2) code += '-';
    }
    return code;
}

// توليد كود إحالة
function generateReferralCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ============================================
// 5. Middleware للمصادقة
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'غير مصرح - يرجى تسجيل الدخول' });
    }
    
    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'انتهت الجلسة - يرجى تسجيل الدخول مرة أخرى' });
    }
}

function checkRole(roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية لهذه العملية' });
        }
        next();
    };
}

// ============================================
// 6. API Endpoints
// ============================================

// --- تسجيل الدخول ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, message: 'بيانات ناقصة' });
    }
    
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND status = "active"').get(username);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
    
    db.prepare('INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)')
        .run(user.id, 'login', `تسجيل دخول`, req.ip);
    
    res.json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح',
        data: {
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                credits: user.credits,
                referral_code: user.referral_code
            }
        }
    });
});

// --- إنشاء حساب جديد (يدوي أو عشوائي vip + 5 أرقام) ---
app.post('/api/account/create', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const { username, password, plan_id, is_random, referral_code } = req.body;
    const reseller_id = req.user.id;
    
    let finalUsername = username;
    let finalPassword = password;
    
    // توليد عشوائي بصيغة vip + 5 أرقام
    if (is_random || !finalUsername) {
        // محاولة التوليد حتى نجد اسماً غير مستخدم
        let attempts = 0;
        do {
            finalUsername = generateRandomUsername();
            attempts++;
            if (attempts > 100) {
                return res.json({ success: false, message: 'فشل في توليد اسم مستخدم فريد' });
            }
        } while (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE username = ?').get(finalUsername).count > 0);
        
        finalPassword = generateRandomPassword();
    }
    
    // التحقق من عدم التكرار (للإدخال اليدوي)
    const exists = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE username = ?').get(finalUsername);
    if (exists.count > 0) {
        return res.json({ success: false, message: 'اسم المستخدم موجود مسبقاً - اختر اسماً آخر' });
    }
    
    // التحقق من الباقة
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND is_active = 1').get(plan_id);
    if (!plan) {
        return res.json({ success: false, message: 'الباقة غير موجودة أو غير متاحة' });
    }
    
    // التحقق من الرصيد
    const reseller = db.prepare('SELECT credits FROM users WHERE id = ?').get(reseller_id);
    if (reseller.credits < plan.price) {
        return res.json({ success: false, message: `رصيد غير كافٍ - تحتاج ${plan.price} رصيد` });
    }
    
    const expiry_date = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
    const hashedPassword = bcrypt.hashSync(finalPassword, 10);
    
    // البحث عن الحساب المحيل (إن وجد)
    let referred_by = null;
    let referrer_account = null;
    
    if (referral_code) {
        referrer_account = db.prepare('SELECT * FROM accounts WHERE referral_code = ? AND status = "active"').get(referral_code);
        if (referrer_account) {
            referred_by = referrer_account.id;
        }
    }
    
    try {
        const result = db.prepare(`INSERT INTO accounts 
            (reseller_id, username, password, plan_id, expiry_date, referred_by, referral_code) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(reseller_id, finalUsername, hashedPassword, plan_id, expiry_date, referred_by, generateReferralCode());
        
        const newAccountId = result.lastInsertRowid;
        
        // خصم الرصيد من الموزع
        if (plan.price > 0) {
            db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(plan.price, reseller_id);
        }
        
        // نظام الإحالة: الصديق يحصل على 31 يوم (30 + 1 بونص) والمضيف يحصل على يوم إضافي
        if (referrer_account && !referrer_account.referral_claimed) {
            // تمديد حساب الصديق بيوم إضافي (يصبح 31 يوم بدلاً من 30)
            const friendNewExpiry = new Date(new Date(referrer_account.expiry_date).getTime() + (1 * 24 * 60 * 60 * 1000)).toISOString();
            db.prepare('UPDATE accounts SET expiry_date = ?, referral_bonus_days = referral_bonus_days + 1, referral_claimed = 1 WHERE id = ?')
                .run(friendNewExpiry, referrer_account.id);
            
            // تمديد حساب المضيف بيوم واحد
            const referrerNewExpiry = new Date(new Date(referrer_account.expiry_date).getTime() + (1 * 24 * 60 * 60 * 1000)).toISOString();
            // نستخدم الحساب الأصلي للمضيف (نبحث عنه)
            const referrerUser = db.prepare('SELECT * FROM accounts WHERE id = ?').get(referrer_account.id);
            if (referrerUser) {
                const hostNewExpiry = new Date(new Date(referrerUser.expiry_date).getTime() + (1 * 24 * 60 * 60 * 1000)).toISOString();
                db.prepare('UPDATE accounts SET expiry_date = ?, referral_bonus_days = referral_bonus_days + 1 WHERE id = ?')
                    .run(hostNewExpiry, referrer_account.id);
            }
            
            // تسجيل الإحالة
            db.prepare('INSERT INTO referrals (referrer_account_id, referred_account_id, bonus_days, status) VALUES (?, ?, 1, "completed")')
                .run(referrer_account.id, newAccountId);
            
            // زيادة عداد الإحالات للموزع
            db.prepare('UPDATE users SET referral_count = referral_count + 1 WHERE id = ?')
                .run(reseller_id);
        }
        
        // تسجيل النشاط
        db.prepare('INSERT INTO activity_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)')
            .run(reseller_id, 'create_account', `إنشاء حساب: ${finalUsername} - باقة: ${plan.name_ar}`, req.ip);
        
        res.json({
            success: true,
            message: 'تم إنشاء الحساب بنجاح',
            data: {
                username: finalUsername,
                password: finalPassword,
                plan: plan.name_ar,
                duration_days: plan.duration_days,
                expiry_date,
                referral_code: db.prepare('SELECT referral_code FROM accounts WHERE id = ?').get(newAccountId).referral_code
            }
        });
    } catch (error) {
        console.error('Error creating account:', error);
        res.json({ success: false, message: 'خطأ في إنشاء الحساب - اسم المستخدم قد يكون مستخدماً' });
    }
});

// --- استخدام بطاقة ---
app.post('/api/card/use', (req, res) => {
    const { card_code, username, password } = req.body;
    
    if (!card_code || !username || !password) {
        return res.json({ success: false, message: 'بيانات ناقصة' });
    }
    
    const card = db.prepare('SELECT * FROM cards WHERE card_code = ? AND is_used = 0').get(card_code.toUpperCase());
    if (!card) {
        return res.json({ success: false, message: 'البطاقة غير صالحة أو مستخدمة مسبقاً' });
    }
    
    const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
    if (!account || !bcrypt.compareSync(password, account.password)) {
        return res.json({ success: false, message: 'بيانات الحساب خاطئة' });
    }
    
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(card.plan_id);
    const newExpiry = new Date(new Date(account.expiry_date).getTime() + (plan.duration_days * 24 * 60 * 60 * 1000)).toISOString();
    
    db.prepare('UPDATE accounts SET expiry_date = ? WHERE id = ?').run(newExpiry, account.id);
    db.prepare('UPDATE cards SET is_used = 1, used_by = ?, used_at = datetime("now") WHERE id = ?')
        .run(account.id, card.id);
    
    res.json({
        success: true,
        message: 'تم تفعيل البطاقة بنجاح',
        data: {
            new_expiry: newExpiry,
            added_days: plan.duration_days,
            plan_name: plan.name_ar
        }
    });
});

// --- بدء جلسة (عند اتصال المستخدم بالـ VPN) ---
app.post('/api/session/start', authenticateToken, (req, res) => {
    const { server_id } = req.body;
    const username = req.user.username;
    
    const account = db.prepare('SELECT * FROM accounts WHERE username = ? AND status = "active"').get(username);
    if (!account) {
        return res.json({ success: false, message: 'الحساب غير موجود' });
    }
    
    // التحقق من انتهاء الباقة
    if (new Date(account.expiry_date) < new Date()) {
        db.prepare('UPDATE accounts SET status = "expired" WHERE id = ?').run(account.id);
        return res.json({ success: false, message: 'انتهت صلاحية الحساب - يرجى تجديد الباقة' });
    }
    
    // التحقق من حد البيانات
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(account.plan_id);
    if (account.data_used_mb >= plan.data_limit_mb) {
        return res.json({ success: false, message: 'تم استهلاك حد البيانات - يرجى تجديد الباقة' });
    }
    
    const session = db.prepare(`INSERT INTO sessions (account_id, start_time, server_id, ip_address) 
        VALUES (?, datetime("now"), ?, ?)`).run(account.id, server_id, req.ip);
    
    db.prepare('UPDATE accounts SET last_session_start = datetime("now"), total_sessions = total_sessions + 1 WHERE id = ?')
        .run(account.id);
    
    const daysRemaining = Math.ceil((new Date(account.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
    const dataRemaining = plan.data_limit_mb - account.data_used_mb;
    
    res.json({
        success: true,
        message: 'تم بدء الجلسة',
        data: {
            session_id: session.lastInsertRowid,
            account_id: account.id,
            username: account.username,
            plan: plan.name_ar,
            data_remaining_mb: Math.round(dataRemaining),
            days_remaining: daysRemaining
        }
    });
});

// --- إنهاء جلسة (عند انقطاع المستخدم) ---
app.post('/api/session/end', authenticateToken, (req, res) => {
    const { session_id, data_used_mb } = req.body;
    const username = req.user.username;
    
    const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
    if (!account) {
        return res.json({ success: false, message: 'الحساب غير موجود' });
    }
    
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND account_id = ? AND end_time IS NULL')
        .get(session_id, account.id);
    
    if (!session) {
        return res.json({ success: false, message: 'الجلسة غير موجودة' });
    }
    
    const duration_minutes = (Date.now() - new Date(session.start_time).getTime()) / (1000 * 60);
    const finalDataUsed = data_used_mb || 0;
    
    db.prepare('UPDATE sessions SET end_time = datetime("now"), duration_minutes = ?, data_used_mb = ? WHERE id = ?')
        .run(duration_minutes, finalDataUsed, session_id);
    
    db.prepare('UPDATE accounts SET data_used_mb = data_used_mb + ?, session_hours = session_hours + ?, last_session_end = datetime("now") WHERE id = ?')
        .run(finalDataUsed, duration_minutes / 60, account.id);
    
    res.json({
        success: true,
        message: 'تم إنهاء الجلسة',
        data: {
            duration_minutes: Math.round(duration_minutes),
            data_used_mb: finalDataUsed,
            total_data_used_mb: Math.round(account.data_used_mb + finalDataUsed)
        }
    });
});

// --- الحذف التلقائي للحسابات المنتهية ---
app.post('/api/cleanup/expired', authenticateToken, checkRole(['admin']), (req, res) => {
    // حذف الحسابات المنتهية
    const deletedAccounts = db.prepare('DELETE FROM accounts WHERE expiry_date <= datetime("now") AND status = "active"').run();
    
    // حذف الجلسات القديمة (أكثر من 30 يوم)
    const deletedSessions = db.prepare('DELETE FROM sessions WHERE end_time IS NOT NULL AND end_time <= datetime("now", "-30 days")').run();
    
    // تحديث حالة الحسابات المنتهية
    const updatedAccounts = db.prepare('UPDATE accounts SET status = "expired" WHERE expiry_date <= datetime("now") AND status = "active"').run();
    
    db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)')
        .run(req.user.id, 'cleanup', `حذف ${deletedAccounts.changes} حساب منتهي`);
    
    res.json({
        success: true,
        message: 'تم الحذف التلقائي بنجاح',
        data: {
            deleted_accounts: deletedAccounts.changes,
            updated_accounts: updatedAccounts.changes,
            deleted_sessions: deletedSessions.changes
        }
    });
});

// --- جلب السيرفرات (حسب نوع الباقة) ---
app.get('/api/servers', authenticateToken, (req, res) => {
    const username = req.user.username;
    const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
    
    let servers;
    if (account) {
        const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(account.plan_id);
        if (plan && plan.is_gaming) {
            // باقة الألعاب: عرض سيرفرات الألعاب فقط
            servers = db.prepare('SELECT * FROM servers WHERE is_gaming = 1 AND is_active = 1 ORDER BY ping_ms ASC').all();
        } else {
            // الباقات العادية: عرض كل السيرفرات عدا الألعاب
            servers = db.prepare('SELECT * FROM servers WHERE is_gaming = 0 AND is_active = 1 ORDER BY company_id, display_name').all();
        }
    } else {
        // للمدير: عرض كل السيرفرات
        servers = db.prepare('SELECT * FROM servers WHERE is_active = 1 ORDER BY company_id, display_name').all();
    }
    
    const companies = db.prepare('SELECT * FROM companies WHERE is_active = 1').all();
    
    res.json({ success: true, companies, servers });
});

// --- إنشاء بطاقات ---
app.post('/api/cards/generate', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const { plan_id, count } = req.body;
    const reseller_id = req.user.id;
    
    if (!plan_id || !count || count < 1 || count > 100) {
        return res.json({ success: false, message: 'عدد البطاقات يجب أن يكون بين 1 و 100' });
    }
    
    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan_id);
    if (!plan) {
        return res.json({ success: false, message: 'الباقة غير موجودة' });
    }
    
    const totalCost = plan.price * count;
    const reseller = db.prepare('SELECT credits FROM users WHERE id = ?').get(reseller_id);
    
    if (reseller.credits < totalCost) {
        return res.json({ success: false, message: `رصيد غير كافٍ - تحتاج ${totalCost} رصيد لإنشاء ${count} بطاقة` });
    }
    
    const cards = [];
    const insertCard = db.prepare('INSERT INTO cards (card_code, plan_id, duration_days, created_by) VALUES (?, ?, ?, ?)');
    
    const insertMany = db.transaction((cardsData) => {
        for (const card of cardsData) {
            insertCard.run(card.code, plan_id, plan.duration_days, reseller_id);
        }
    });
    
    for (let i = 0; i < count; i++) {
        cards.push({ code: generateCardCode() });
    }
    
    insertMany(cards);
    
    // خصم الرصيد
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(totalCost, reseller_id);
    
    db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)')
        .run(reseller_id, 'generate_cards', `إنشاء ${count} بطاقة من نوع ${plan.name_ar}`);
    
    res.json({
        success: true,
        message: `تم إنشاء ${count} بطاقة بنجاح`,
        data: { 
            cards: cards.map(c => c.code), 
            plan: plan.name_ar,
            total_cost: totalCost
        }
    });
});

// --- قائمة البطاقات ---
app.get('/api/cards', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    
    let cards;
    if (role === 'admin') {
        cards = db.prepare(`SELECT c.*, p.name_ar as plan_name, u.username as created_by_username 
            FROM cards c 
            LEFT JOIN plans p ON c.plan_id = p.id 
            LEFT JOIN users u ON c.created_by = u.id 
            ORDER BY c.created_at DESC`).all();
    } else {
        cards = db.prepare(`SELECT c.*, p.name_ar as plan_name 
            FROM cards c 
            LEFT JOIN plans p ON c.plan_id = p.id 
            WHERE c.created_by = ? 
            ORDER BY c.created_at DESC`).all(reseller_id);
    }
    
    res.json({ success: true, cards });
});

// --- الإحصائيات ---
app.get('/api/stats', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    
    let totalAccounts, activeAccounts, expiredAccounts, totalDataUsed;
    
    if (role === 'admin') {
        totalAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
        activeAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE status = "active" AND expiry_date > datetime("now")').get().count;
        expiredAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE expiry_date <= datetime("now") OR status = "expired"').get().count;
        totalDataUsed = db.prepare('SELECT COALESCE(SUM(data_used_mb), 0) as total FROM accounts').get().total;
    } else {
        totalAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE reseller_id = ?').get(reseller_id).count;
        activeAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE reseller_id = ? AND status = "active" AND expiry_date > datetime("now")').get(reseller_id).count;
        expiredAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE reseller_id = ? AND (expiry_date <= datetime("now") OR status = "expired")').get(reseller_id).count;
        totalDataUsed = db.prepare('SELECT COALESCE(SUM(data_used_mb), 0) as total FROM accounts WHERE reseller_id = ?').get(reseller_id).total;
    }
    
    const user = db.prepare('SELECT credits, referral_count FROM users WHERE id = ?').get(reseller_id);
    const totalCards = db.prepare('SELECT COUNT(*) as count FROM cards WHERE created_by = ?').get(reseller_id).count;
    const unusedCards = db.prepare('SELECT COUNT(*) as count FROM cards WHERE created_by = ? AND is_used = 0').get(reseller_id).count;
    
    res.json({
        success: true,
        stats: {
            total_accounts: totalAccounts,
            active_accounts: activeAccounts,
            expired_accounts: expiredAccounts,
            total_data_used_mb: Math.round(totalDataUsed),
            available_credits: user.credits,
            referral_count: user.referral_count,
            total_cards: totalCards,
            unused_cards: unusedCards
        }
    });
});

// --- قائمة الحسابات ---
app.get('/api/accounts', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const reseller_id = req.user.id;
    const role = req.user.role;
    
    let accounts;
    if (role === 'admin') {
        accounts = db.prepare(`SELECT a.*, p.name_ar as plan_name, u.username as reseller_username 
            FROM accounts a 
            LEFT JOIN plans p ON a.plan_id = p.id 
            LEFT JOIN users u ON a.reseller_id = u.id 
            ORDER BY a.created_at DESC`).all();
    } else {
        accounts = db.prepare(`SELECT a.*, p.name_ar as plan_name 
            FROM accounts a 
            LEFT JOIN plans p ON a.plan_id = p.id 
            WHERE a.reseller_id = ? 
            ORDER BY a.created_at DESC`).all(reseller_id);
    }
    
    res.json({ success: true, accounts });
});

// --- تحويل Credits بين الموزعين ---
app.post('/api/transfer', authenticateToken, checkRole(['admin', 'reseller']), (req, res) => {
    const { to_username, amount } = req.body;
    const from_user_id = req.user.id;
    
    if (!to_username || !amount || amount <= 0) {
        return res.json({ success: false, message: 'بيانات ناقصة' });
    }
    
    const from_user = db.prepare('SELECT credits FROM users WHERE id = ?').get(from_user_id);
    if (from_user.credits < amount) {
        return res.json({ success: false, message: 'رصيد غير كافٍ' });
    }
    
    const to_user = db.prepare('SELECT id FROM users WHERE username = ?').get(to_username);
    if (!to_user) {
        return res.json({ success: false, message: 'المستلم غير موجود' });
    }
    
    if (to_user.id === from_user_id) {
        return res.json({ success: false, message: 'لا يمكنك التحويل لنفسك' });
    }
    
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(amount, from_user_id);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, to_user.id);
    
    db.prepare('INSERT INTO credit_transfers (from_user_id, to_user_id, amount) VALUES (?, ?, ?)')
        .run(from_user_id, to_user.id, amount);
    
    db.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)')
        .run(from_user_id, 'transfer', `تحويل ${amount} رصيد إلى ${to_username}`);
    
    res.json({ success: true, message: 'تم التحويل بنجاح' });
});

// --- معلومات الحساب الحالي (للتطبيق) ---
app.get('/api/me', authenticateToken, (req, res) => {
    const username = req.user.username;
    const account = db.prepare(`SELECT a.*, p.name_ar as plan_name, p.data_limit_mb, p.duration_days
        FROM accounts a 
        LEFT JOIN plans p ON a.plan_id = p.id 
        WHERE a.username = ?`).get(username);
    
    if (!account) {
        return res.json({ success: false, message: 'الحساب غير موجود' });
    }
    
    const daysRemaining = Math.max(0, Math.ceil((new Date(account.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)));
    const dataRemaining = Math.max(0, account.data_limit_mb - account.data_used_mb);
    
    res.json({
        success: true,
        data: {
            username: account.username,
            plan_name: account.plan_name,
            expiry_date: account.expiry_date,
            days_remaining: daysRemaining,
            data_used_mb: Math.round(account.data_used_mb),
            data_limit_mb: account.data_limit_mb,
            data_remaining_mb: Math.round(dataRemaining),
            session_hours: Math.round(account.session_hours * 10) / 10,
            total_sessions: account.total_sessions,
            referral_code: account.referral_code,
            referral_bonus_days: account.referral_bonus_days
        }
    });
});

// --- صفحة تسجيل دخول المستخدم (للاستخدام البطاقة) ---
app.get('/api/user/login', (req, res) => {
    const { username, password } = req.query;
    
    if (!username || !password) {
        return res.json({ success: false, message: 'بيانات ناقصة' });
    }
    
    const account = db.prepare(`SELECT a.*, p.name_ar as plan_name 
        FROM accounts a 
        LEFT JOIN plans p ON a.plan_id = p.id 
        WHERE a.username = ? AND a.status = "active"`).get(username);
    
    if (!account || !bcrypt.compareSync(password, account.password)) {
        return res.json({ success: false, message: 'بيانات خاطئة' });
    }
    
    if (new Date(account.expiry_date) < new Date()) {
        return res.json({ success: false, message: 'انتهت صلاحية الحساب' });
    }
    
    const token = jwt.sign(
        { id: account.id, username: account.username, role: 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
    
    const daysRemaining = Math.max(0, Math.ceil((new Date(account.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)));
    
    res.json({
        success: true,
        data: {
            token,
            username: account.username,
            plan_name: account.plan_name,
            days_remaining: daysRemaining
        }
    });
});

// ============================================
// 7. تشغيل الخادم
// ============================================
app.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 B.T.C VPN Server Started Successfully');
    console.log('========================================');
    console.log(` Server: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔑 Admin: admin / admin123`);
    console.log(`👤 Reseller: reseller1 / reseller123`);
    console.log('========================================');
});
