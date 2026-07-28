// ============================================
// B.T.C VPN — الخادم النهائي المتكامل (Firebase + V2Ray)
// نسخة مستقرة: فصل الموزّع + فرز داخلي + حماية الملكية
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
// أدوات مساعدة
// ============================================
function toMillis(t) {
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    const n = new Date(t).getTime();
    return isNaN(n) ? 0 : n;
}
function buildV2Config(s) {
    const engine = (s.engine || 'v2ray');
    if (engine !== 'v2ray') return { _engine: engine, _note: 'محرك غير مدعوم في المولّد الحالي' };
    const protocol = (s.protocol || 'vmess'), network = (s.network || 'ws'), security = (s.security || 'tls');
    const address = s.host || '', port = Number(s.port) || 443, uuid = s.uuid || '';
    const sni = s.sni_hostname || s.host || '', path = s.path || '/', hostHeader = s.ws_host || sni;
    const stream = { network, security: security === 'tls' ? 'tls' : 'none' };
    if (security === 'tls') stream.tlsSettings = { serverName: sni, allowInsecure: !!s.allow_insecure };
    if (network === 'ws') stream.wsSettings = { path, headers: hostHeader ? { Host: hostHeader } : {} };
    else if (network === 'grpc') stream.grpcSettings = { serviceName: s.grpc_service || 'TunService', multiMode: false };
    else if (network === 'h2') stream.h2Settings = { path, host: hostHeader ? [hostHeader] : [] };
    else if (network === 'tcp') stream.tcpSettings = { header: { type: s.tcp_type || 'none' } };
    let outbound;
    if (protocol === 'vmess') outbound = { protocol: 'vmess', settings: { vnext: [{ address, port, users: [{ id: uuid, alterId: Number(s.alter_id) || 0, security: s.vmess_security || 'auto' }] }] }, streamSettings: stream, tag: 'proxy' };
    else if (protocol === 'vless') { const u = { id: uuid, encryption: 'none' }; if (network === 'tcp' && security === 'tls' && s.flow) u.flow = s.flow; outbound = { protocol: 'vless', settings: { vnext: [{ address, port, users: [u] }] }, streamSettings: stream, tag: 'proxy' }; }
    else outbound = { protocol: 'trojan', settings: { servers: [{ address, port, password: uuid || s.password || '' }] }, streamSettings: Object.assign({}, stream, { security: 'tls', tlsSettings: stream.tlsSettings || { serverName: sni } }), tag: 'proxy' };
    return {
        log: { loglevel: s.loglevel || 'warning' },
        dns: { hosts: {}, servers: ['1.1.1.1', '8.8.8.8'] },
        inbounds: [
            { port: 10808, protocol: 'socks', listen: '127.0.0.1', settings: { auth: 'noauth', udp: true }, tag: 'socks-in' },
            { port: 10809, protocol: 'http', listen: '127.0.0.1', tag: 'http-in' }
        ],
        outbounds: [outbound, { protocol: 'freedom', tag: 'direct', settings: { domainStrategy: 'UseIP' } }, { protocol: 'blackhole', tag: 'block' }],
        routing: { domainStrategy: 'AsIs', rules: [{ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' }, { type: 'field', domain: ['geosite:private'], outboundTag: 'direct' }] }
    };
}

// ============================================
// البيانات الافتراضية
// ============================================
async function seedData() {
    try {
        const adminRef = db.collection('users').doc('admin');
        if (!(await adminRef.get()).exists) {
            console.log('🌱 إنشاء البيانات الافتراضية...');
            await adminRef.set({ username: 'admin', password: bcrypt.hashSync('admin123', 10), role: 'admin', credits: 10000, referral_code: 'ADMIN001', status: 'active', created_at: TS.serverTimestamp() });
            await db.collection('users').doc('reseller1').set({ username: 'reseller1', password: bcrypt.hashSync('reseller123', 10), role: 'reseller', credits: 500, parent_id: 'admin', referral_code: 'RES001', status: 'active', created_at: TS.serverTimestamp() });
        }
        if ((await db.collection('plans').get()).empty) {
            const plans = [
                { name_ar: 'تجريبي', duration_days: 1, data_limit_mb: 100, price: 0, retail_price: 0, is_gaming: 0 },
                { name_ar: 'أسبوعي', duration_days: 7, data_limit_mb: 1000, price: 10, retail_price: 15, is_gaming: 0 },
                { name_ar: 'شهري', duration_days: 30, data_limit_mb: 5000, price: 30, retail_price: 45, is_gaming: 0 },
                { name_ar: '3 أشهر', duration_days: 90, data_limit_mb: 15000, price: 80, retail_price: 110, is_gaming: 0 },
                { name_ar: 'جيمنج أسبوعي', duration_days: 7, data_limit_mb: 999999, price: 20, retail_price: 30, is_gaming: 1 },
                { name_ar: 'جيمنج شهري', duration_days: 30, data_limit_mb: 999999, price: 50, retail_price: 75, is_gaming: 1 }
            ];
            for (const p of plans) await db.collection('plans').add(p);
        }
        if ((await db.collection('servers').get()).empty) {
            const DEMO_UUID = 'a3482e88-686a-4a58-8126-99c9df64b7bf';
            const servers = [
                { display_name: 'فودافون WS/TLS', company_name: 'فودافون', engine: 'v2ray', protocol: 'vmess', uuid: DEMO_UUID, network: 'ws', security: 'tls', host: 'vpn1.btc.com', port: 443, sni_hostname: 'web.vodafone.com.eg', path: '/btc', ws_host: 'web.vodafone.com.eg', alter_id: 0, vmess_security: 'auto', allow_insecure: 0, is_gaming: 0, ping_ms: 45, is_active: 1 },
                { display_name: 'اورنج gRPC', company_name: 'اورنج', engine: 'v2ray', protocol: 'vless', uuid: DEMO_UUID, network: 'grpc', security: 'tls', host: 'vpn3.btc.com', port: 443, sni_hostname: 'my.orange.eg', grpc_service: 'TunService', allow_insecure: 0, is_gaming: 0, ping_ms: 55, is_active: 1 },
                { display_name: '🎮 PUBG Trojan', company_name: 'فودافون', engine: 'v2ray', protocol: 'trojan', uuid: 'trojan-pass-demo', network: 'ws', security: 'tls', host: 'gaming1.btc.com', port: 443, sni_hostname: 'web.vodafone.com.eg', path: '/game', ws_host: 'web.vodafone.com.eg', allow_insecure: 0, is_gaming: 1, ping_ms: 25, is_active: 1 }
            ];
            for (const s of servers) await db.collection('servers').add(s);
        }
        console.log('✅ البيانات الافتراضية جاهزة');
    } catch (error) { console.error('❌ خطأ في seedData:', error.message); }
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
// مصادقة اللوحة
// ============================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'بيانات ناقصة' });
        const snap = await db.collection('users').where('username', '==', username).get();
        if (snap.empty) return res.json({ success: false, message: 'بيانات خاطئة' });
        const doc = snap.docs[0], u = doc.data();
        if (u.status === 'blocked') return res.json({ success: false, message: 'الحساب موقوف من الإدارة' });
        if (!bcrypt.compareSync(password, u.password)) return res.json({ success: false, message: 'بيانات خاطئة' });
        const token = jwt.sign({ id: doc.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ success: true, message: 'تم تسجيل الدخول', data: { token, user: { id: doc.id, username: u.username, role: u.role, credits: u.credits } } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// مصادقة التطبيق
app.post('/api/user/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'بيانات ناقصة' });
        const snap = await db.collection('accounts').where('username', '==', username).get();
        if (snap.empty) return res.json({ success: false, message: 'بيانات خاطئة' });
        const doc = snap.docs[0], a = doc.data();
        if (a.status === 'frozen') return res.json({ success: false, message: '🔒 الحساب مجمّد' + (a.frozen_reason ? ': ' + a.frozen_reason : '') });
        if (a.status === 'blocked') return res.json({ success: false, message: 'الحساب محظور' });
        if (a.status === 'expired' || new Date(a.expiry_date) < new Date()) { await db.collection('accounts').doc(doc.id).update({ status: 'expired' }); return res.json({ success: false, message: '⏰ انتهت الصلاحية' }); }
        if (!bcrypt.compareSync(password, a.password)) return res.json({ success: false, message: 'بيانات خاطئة' });
        const pd = await db.collection('plans').doc(a.plan_id).get();
        const token = jwt.sign({ id: doc.id, username: a.username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, data: { token, account: { id: doc.id, username: a.username, plan_name: pd.exists ? pd.data().name_ar : '—', expiry_date: a.expiry_date, allow_hotspot: a.allow_hotspot || 0, max_hotspot_devices: a.max_hotspot_devices || 0 } } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// /api/me ذكي
app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'user') {
            const doc = await db.collection('accounts').doc(req.user.id).get();
            if (!doc.exists) return res.json({ success: false, message: 'الحساب غير موجود' });
            const a = doc.data();
            const pd = await db.collection('plans').doc(a.plan_id).get();
            const plan = pd.exists ? pd.data() : { name_ar: '—', data_limit_mb: 0 };
            const days = Math.max(0, Math.ceil((new Date(a.expiry_date) - new Date()) / 86400000));
            return res.json({ success: true, data: { username: a.username, plan_name: plan.name_ar, expiry_date: a.expiry_date, days_remaining: days, data_used_mb: Math.round(a.data_used_mb || 0), data_limit_mb: plan.data_limit_mb, data_remaining_mb: Math.max(0, Math.round((plan.data_limit_mb || 0) - (a.data_used_mb || 0))), session_hours: Math.round((a.session_hours || 0) * 10) / 10, total_sessions: a.total_sessions || 0, referral_code: a.referral_code || null, status: a.status, allow_hotspot: a.allow_hotspot || 0, max_hotspot_devices: a.max_hotspot_devices || 0 } });
        }
        const doc = await db.collection('users').doc(req.user.id).get();
        if (!doc.exists) return res.json({ success: false, message: 'غير موجود' });
        const u = doc.data(); delete u.password;
        res.json({ success: true, data: { ...u, id: doc.id } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الإحصائيات (مفصولة: الموزّع يرى نفسه فقط)
// ============================================
app.get('/api/stats', authenticateToken, staff, async (req, res) => {
    try {
        const snap = req.user.role === 'reseller'
            ? await db.collection('accounts').where('reseller_id', '==', req.user.id).get()
            : await db.collection('accounts').get();
        let total = 0, active = 0, expired = 0, frozen = 0; const now = new Date();
        snap.forEach(d => { const a = d.data(); total++; if (a.status === 'frozen') frozen++; else if (new Date(a.expiry_date) > now && a.status === 'active') active++; else expired++; });
        const u = (await db.collection('users').doc(req.user.id).get()).data();
        res.json({ success: true, stats: { total_accounts: total, active_accounts: active, expired_accounts: expired, frozen_accounts: frozen, available_credits: u.credits || 0 } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الحسابات (مفصولة + فرز داخلي آمن)
// ============================================
app.get('/api/accounts', authenticateToken, staff, async (req, res) => {
    try {
        const snap = req.user.role === 'reseller'
            ? await db.collection('accounts').where('reseller_id', '==', req.user.id).get()
            : await db.collection('accounts').get();
        let accounts = [];
        for (const d of snap.docs) { const a = d.data(); const pd = await db.collection('plans').doc(a.plan_id).get(); accounts.push({ id: d.id, ...a, plan_name: pd.exists ? pd.data().name_ar : '—' }); }
        accounts.sort((x, y) => toMillis(y.created_at) - toMillis(x.created_at));
        if (req.user.role !== 'reseller') accounts = accounts.slice(0, 300);
        res.json({ success: true, accounts });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

app.post('/api/account/create', authenticateToken, staff, async (req, res) => {
    try {
        const { username, password, plan_id, is_random } = req.body;
        const finalUsername = (is_random || !username) ? 'vip' + Math.floor(10000 + Math.random() * 90000) : username;
        const finalPassword = (is_random || !password) ? Math.random().toString(36).slice(-8) : password;
        if (!(await db.collection('accounts').where('username', '==', finalUsername).get()).empty) return res.json({ success: false, message: 'اسم المستخدم موجود' });
        const pd = await db.collection('plans').doc(plan_id).get();
        if (!pd.exists) return res.json({ success: false, message: 'الباقة غير موجودة' });
        const plan = pd.data();
        const ud = await db.collection('users').doc(req.user.id).get();
        if (ud.data().credits < plan.price) return res.json({ success: false, message: 'رصيد غير كافٍ' });
        const expiry_date = new Date(Date.now() + plan.duration_days * 86400000).toISOString();
        await db.collection('accounts').add({ reseller_id: req.user.id, username: finalUsername, password: bcrypt.hashSync(finalPassword, 10), plan_id, expiry_date, referral_code: Math.random().toString(36).substring(2, 8).toUpperCase(), data_used_mb: 0, session_hours: 0, total_sessions: 0, status: 'active', allow_hotspot: 0, max_hotspot_devices: 0, hotspot_active: 0, created_at: TS.serverTimestamp() });
        await db.collection('users').doc(req.user.id).update({ credits: TS.increment(-plan.price) });
        res.json({ success: true, message: 'تم الإصدار', data: { username: finalUsername, password: finalPassword, plan: plan.name_ar, duration_days: plan.duration_days, expiry_date, referral_code: '' } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// تعديل حساب — محمي: الموزّع لا يمسّ إلا حساباته
app.post('/api/accounts/update', authenticateToken, staff, async (req, res) => {
    try {
        const { id, status, frozen_reason, add_days, new_password, plan_id, allow_hotspot, max_hotspot_devices } = req.body;
        if (!id) return res.json({ success: false, message: 'معرف الحساب مطلوب' });
        const ref = db.collection('accounts').doc(id);
        const cur = await ref.get();
        if (!cur.exists) return res.json({ success: false, message: 'الحساب غير موجود' });
        const a = cur.data();
        if (req.user.role === 'reseller' && a.reseller_id !== req.user.id) return res.json({ success: false, message: 'هذا الحساب لا يخصّك' });
        const upd = {}; const notes = [];
        if (status && ['active', 'frozen', 'blocked', 'expired'].includes(status)) { upd.status = status; notes.push('الحالة ← ' + status); if (status === 'frozen') upd.frozen_reason = frozen_reason || 'مجمّد من الإدارة'; if (status === 'active') upd.frozen_reason = TS.delete(); }
        if (Number(add_days) > 0) { const base = Math.max(Date.now(), new Date(a.expiry_date).getTime()); upd.expiry_date = new Date(base + Number(add_days) * 86400000).toISOString(); if (a.status === 'expired') upd.status = 'active'; notes.push('تمديد +' + add_days + ' يوم'); }
        if (new_password) { upd.password = bcrypt.hashSync(String(new_password), 10); notes.push('إعادة ضبط كلمة السر'); }
        if (plan_id) { const pd = await db.collection('plans').doc(plan_id).get(); if (!pd.exists) return res.json({ success: false, message: 'الباقة غير موجودة' }); upd.plan_id = plan_id; notes.push('تغيير الباقة'); }
        if (allow_hotspot !== undefined) upd.allow_hotspot = allow_hotspot ? 1 : 0;
        if (max_hotspot_devices !== undefined) upd.max_hotspot_devices = Number(max_hotspot_devices) || 0;
        if (Object.keys(upd).length === 0) return res.json({ success: false, message: 'لا يوجد تعديل' });
        await ref.update(upd);
        res.json({ success: true, message: 'تم التحديث: ' + notes.join('، ') });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الباقات
// ============================================
app.get('/api/plans', authenticateToken, async (req, res) => {
    try { const snap = await db.collection('plans').get(); res.json({ success: true, plans: snap.docs.map(d => ({ id: d.id, ...d.data() })) }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/plans/save', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { id, name_ar, duration_days, data_limit_mb, price, retail_price, is_gaming } = req.body;
        if (!name_ar || !duration_days) return res.json({ success: false, message: 'الاسم والمدة مطلوبان' });
        const cost = Number(price) || 0;
        const data = { name_ar: String(name_ar).trim(), duration_days: Number(duration_days) || 1, data_limit_mb: Number(data_limit_mb) || 0, price: cost, retail_price: Number(retail_price) || cost, is_gaming: is_gaming ? 1 : 0 };
        if (id) await db.collection('plans').doc(id).set(data, { merge: true }); else await db.collection('plans').add(data);
        res.json({ success: true, message: id ? 'تم تعديل الباقة' : 'تمت إضافة الباقة' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.delete('/api/plans/:id', authenticateToken, onlyAdmin, async (req, res) => {
    try { await db.collection('plans').doc(req.params.id).delete(); res.json({ success: true, message: 'تم حذف الباقة' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// السيرفرات + مولّد V2Ray
// ============================================
app.get('/api/servers', authenticateToken, async (req, res) => {
    try { const snap = await db.collection('servers').get(); res.json({ success: true, servers: snap.docs.map(d => ({ id: d.id, ...d.data() })) }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.get('/api/servers/:id/v2config', authenticateToken, async (req, res) => {
    try {
        const doc = await db.collection('servers').doc(req.params.id).get();
        if (!doc.exists) return res.json({ success: false, message: 'السيرفر غير موجود' });
        const s = doc.data();
        if (s.is_active === 0 && req.user.role === 'user') return res.json({ success: false, message: 'السيرفر غير متاح' });
        const config = buildV2Config(s);
        res.json({ success: true, engine: s.engine || 'v2ray', config, configString: JSON.stringify(config) });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/servers/save', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const b = req.body;
        if (!b.display_name || !b.host || !b.sni_hostname) return res.json({ success: false, message: 'الاسم والمضيف و SNI مطلوبة' });
        const data = {
            display_name: String(b.display_name).trim(), company_name: String(b.company_name || 'عام').trim(),
            engine: String(b.engine || 'v2ray'), protocol: String(b.protocol || 'vmess'), uuid: String(b.uuid || '').trim(),
            network: String(b.network || 'ws'), security: String(b.security || 'tls'), host: String(b.host).trim(),
            port: Number(b.port) || 443, sni_hostname: String(b.sni_hostname).trim(), path: String(b.path || '/'),
            ws_host: String(b.ws_host || ''), grpc_service: String(b.grpc_service || 'TunService'), tcp_type: String(b.tcp_type || 'none'),
            alter_id: Number(b.alter_id) || 0, vmess_security: String(b.vmess_security || 'auto'), flow: String(b.flow || ''),
            allow_insecure: b.allow_insecure ? 1 : 0, is_gaming: b.is_gaming ? 1 : 0, ping_ms: Number(b.ping_ms) || 50,
            is_active: (b.is_active === 0 || b.is_active === false) ? 0 : 1
        };
        if (b.id) await db.collection('servers').doc(b.id).set(data, { merge: true }); else await db.collection('servers').add(data);
        res.json({ success: true, message: b.id ? 'تم تعديل السيرفر' : 'تمت إضافة السيرفر' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/servers/toggle', authenticateToken, onlyAdmin, async (req, res) => {
    try { const { id, is_active } = req.body; await db.collection('servers').doc(id).update({ is_active: is_active ? 1 : 0 }); res.json({ success: true, message: is_active ? 'تم التفعيل' : 'تم الإيقاف' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.delete('/api/servers/:id', authenticateToken, onlyAdmin, async (req, res) => {
    try { await db.collection('servers').doc(req.params.id).delete(); res.json({ success: true, message: 'تم حذف السيرفر' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// الموزّعون + الشحن الذاتي
// ============================================
app.get('/api/users', authenticateToken, onlyAdmin, async (req, res) => {
    try { const snap = await db.collection('users').get(); res.json({ success: true, users: snap.docs.map(d => { const u = d.data(); delete u.password; return { id: d.id, ...u }; }) }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/users/create', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { username, password, role, credits } = req.body;
        if (!username || !password) return res.json({ success: false, message: 'الاسم وكلمة المرور مطلوبان' });
        if (!(await db.collection('users').where('username', '==', username.trim()).get()).empty) return res.json({ success: false, message: 'اسم المستخدم مستخدم' });
        await db.collection('users').doc().set({ username: username.trim(), password: bcrypt.hashSync(password, 10), role: role === 'admin' ? 'admin' : 'reseller', credits: Number(credits) || 0, referral_code: Math.random().toString(36).substring(2, 8).toUpperCase(), status: 'active', created_at: TS.serverTimestamp() });
        res.json({ success: true, message: 'تمت إضافة الموزّع' });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/users/credit', authenticateToken, onlyAdmin, async (req, res) => {
    try { const { id, amount, mode } = req.body; const val = Math.abs(Number(amount) || 0); if (mode === 'set') await db.collection('users').doc(id).update({ credits: val }); else await db.collection('users').doc(id).update({ credits: TS.increment(val) }); res.json({ success: true, message: 'تم تحديث الرصيد' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/users/self-credit', authenticateToken, onlyAdmin, async (req, res) => {
    try {
        const { amount } = req.body; const val = Math.abs(Number(amount) || 0);
        if (val < 1) return res.json({ success: false, message: 'قيمة غير صالحة' });
        const ref = db.collection('users').doc(req.user.id);
        await ref.update({ credits: TS.increment(val) });
        const u = (await ref.get()).data();
        res.json({ success: true, message: 'تم شحن رصيدك بنجاح', data: { credits: u.credits } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/users/toggle', authenticateToken, onlyAdmin, async (req, res) => {
    try { const { id, status } = req.body; await db.collection('users').doc(id).update({ status: status === 'blocked' ? 'blocked' : 'active' }); res.json({ success: true, message: 'تم تحديث الحالة' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
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
// Hotspot (محمي + فرز داخلي)
// ============================================
app.get('/api/hotspot/:accountId', authenticateToken, staff, async (req, res) => {
    try {
        if (req.user.role === 'reseller') { const acc = await db.collection('accounts').doc(req.params.accountId).get(); if (!acc.exists || acc.data().reseller_id !== req.user.id) return res.json({ success: false, message: 'هذا الحساب لا يخصّك' }); }
        const snap = await db.collection('hotspot_devices').where('account_id', '==', req.params.accountId).limit(50).get();
        const devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        devices.sort((x, y) => toMillis(y.last_seen) - toMillis(x.last_seen));
        res.json({ success: true, devices });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/hotspot/link', authenticateToken, staff, async (req, res) => {
    try {
        const { device_id, plan_id } = req.body;
        const dev = await db.collection('hotspot_devices').doc(device_id).get();
        if (!dev.exists) return res.json({ success: false, message: 'الجهاز غير موجود' });
        const pd = await db.collection('plans').doc(plan_id).get();
        if (!pd.exists) return res.json({ success: false, message: 'الباقة غير موجودة' });
        const plan = pd.data();
        const ud = await db.collection('users').doc(req.user.id).get();
        if (ud.data().credits < plan.price) return res.json({ success: false, message: 'رصيد غير كافٍ' });
        const finalUsername = 'vip' + Math.floor(10000 + Math.random() * 90000);
        const finalPassword = Math.random().toString(36).slice(-8);
        const expiry_date = new Date(Date.now() + plan.duration_days * 86400000).toISOString();
        const newRef = await db.collection('accounts').add({ reseller_id: req.user.id, username: finalUsername, password: bcrypt.hashSync(finalPassword, 10), plan_id, expiry_date, referral_code: Math.random().toString(36).substring(2, 8).toUpperCase(), data_used_mb: 0, session_hours: 0, total_sessions: 0, status: 'active', allow_hotspot: 0, max_hotspot_devices: 0, hotspot_active: 0, created_at: TS.serverTimestamp() });
        await db.collection('hotspot_devices').doc(device_id).update({ linked_account_id: newRef.id, is_approved: 1 });
        await db.collection('users').doc(req.user.id).update({ credits: TS.increment(-plan.price) });
        res.json({ success: true, message: 'تم ربط الجهاز باشتراك', data: { username: finalUsername, password: finalPassword, plan: plan.name_ar, duration_days: plan.duration_days, expiry_date, referral_code: '' } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.delete('/api/hotspot/:id', authenticateToken, staff, async (req, res) => {
    try { await db.collection('hotspot_devices').doc(req.params.id).delete(); res.json({ success: true, message: 'تم حذف الجهاز' }); }
    catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});
app.post('/api/hotspot/report', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'user') return res.json({ success: false, message: 'غير مصرح' });
        const { devices } = req.body;
        const acc = await db.collection('accounts').doc(req.user.id).get();
        if (!acc.exists || !acc.data().allow_hotspot) return res.json({ success: false, message: 'الحساب لا يدعم Hotspot' });
        const max = acc.data().max_hotspot_devices || 0;
        if (Array.isArray(devices)) {
            for (const d of devices.slice(0, max)) {
                const q = await db.collection('hotspot_devices').where('account_id', '==', req.user.id).where('mac_address', '==', d.mac_address).get();
                const payload = { account_id: req.user.id, mac_address: d.mac_address, ip_address: d.ip_address || null, device_name: d.device_name || 'Unknown', last_seen: TS.serverTimestamp() };
                if (q.empty) await db.collection('hotspot_devices').add(payload); else await q.docs[0].ref.update(payload);
            }
        }
        res.json({ success: true, message: 'تم تسجيل الأجهزة', data: { max_allowed: max } });
    } catch (e) { res.json({ success: false, message: 'خطأ: ' + e.message }); }
});

// ============================================
// ملفات ثابتة + تشغيل
// ============================================
app.use(express.static(__dirname));
async function startServer() {
    await seedData();
    app.listen(PORT, () => { console.log('========================================'); console.log('🚀 B.T.C VPN Server Started (V2Ray layer ready)'); console.log(`📡 Port: ${PORT}`); console.log('========================================'); });
}
startServer().catch(err => { console.error('Fatal:', err); process.exit(1); });
