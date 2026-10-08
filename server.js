'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

if (!process.env.FIREBASE_CONFIG) {
  console.error('[FATAL] FIREBASE_CONFIG is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} catch (err) {
  console.error('[FATAL] FIREBASE_CONFIG is not valid JSON.');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

const COLL_MEDS = 'medicines';
const COLL_HISTORY = 'history';
const COLL_META = 'meta';
const META_INIT_DOC = 'init';

const DEFAULT_STRIPS_PER_BOX = 3;
const ATOR_STRIPS_PER_BOX = 1;
const DEFAULT_LOW_STOCK_THRESHOLD = 2;

const SEED_DATA = [
  { person: 'علاج چون', medicines: ['دلتاڤيت', 'أزاثيوبرين', 'فوليك أسيد', 'براڤوتين'] },
  { person: 'علاج أم مينا', medicines: ['دافلون', 'كالسيترون', 'ليميتلس', 'أوسوفرتين D3', 'ميلوكام'] },
  { person: 'علاج لطيف', medicines: ['أزابريل', 'بانتوبي', 'كونكور', 'جوسبرين', 'أتور', 'بلاڤيكس'] }
];

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const COOKIE_NAME = 'tabibi_token';
const isProd = process.env.NODE_ENV === 'production';

if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET is not set.');
  process.exit(1);
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
  console.error('[FATAL] ADMIN_USERNAME / ADMIN_PASSWORD_HASH are not set.');
  process.exit(1);
}

function signToken(username) {
  return jwt.sign({ sub: username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function hasValidSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return false;
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  const token = req.cookies?.[COOKIE_NAME] || bearer;
  if (!token) return res.status(401).json({ error: 'غير مصرح' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

function isValidString(v, max = 200) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function isValidInt(v, { min = 0, max = 100000 } = {}) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function computeStatus(quantity, threshold) {
  if (quantity === null || quantity === undefined) return 'unregistered';
  if (quantity <= 0) return 'out';
  if (quantity <= threshold) return 'low';
  return 'available';
}

function statusLabelAr(status) {
  switch (status) {
    case 'available': return 'متوفر';
    case 'low': return 'مخزون قليل';
    case 'out': return 'خلص';
    case 'unregistered': return 'لم يتم تسجيل المخزون';
    default: return 'غير معروف';
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول لاحقًا' }
});

async function ensureSeedData() {
  const metaRef = db.collection(COLL_META).doc(META_INIT_DOC);
  const metaSnap = await metaRef.get();
  if (metaSnap.exists) return;

  const batch = db.batch();
  for (const group of SEED_DATA) {
    for (const name of group.medicines) {
      const ref = db.collection(COLL_MEDS).doc();
      const stripsPerBox = name === 'أتور' ? ATOR_STRIPS_PER_BOX : DEFAULT_STRIPS_PER_BOX;
      batch.set(ref, {
        name,
        person: group.person,
        quantity: null,
        stripsPerBox,
        lowStockThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
        archived: false,
        notes: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
  batch.set(metaRef, { initialized: true, initializedAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
}

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!isValidString(username, 100) || !isValidString(password, 200)) {
      return res.status(400).json({ error: 'بيانات غير صحيحة' });
    }
    if (username.trim() !== ADMIN_USERNAME) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!ok) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const token = signToken(ADMIN_USERNAME);
    setAuthCookie(res, token);
    res.json({ ok: true, token, user: { username: ADMIN_USERNAME } });
  } catch (err) {
    console.error('[login] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.sub, role: req.user.role } });
});

app.post('/api/init', requireAuth, async (req, res) => {
  try {
    await ensureSeedData();
    res.json({ ok: true });
  } catch (err) {
    console.error('[init] error', err.message);
    res.status(500).json({ error: 'خطأ في التهيئة' });
  }
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection(COLL_MEDS).where('archived', '==', false).get();
    let totalTypes = 0, totalStrips = 0, available = 0, low = 0, out = 0, unregistered = 0;

    snap.forEach((doc) => {
      const d = doc.data();
      totalTypes += 1;
      const status = computeStatus(d.quantity, d.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
      if (status === 'available') available += 1;
      else if (status === 'low') low += 1;
      else if (status === 'out') out += 1;
      else unregistered += 1;
      if (typeof d.quantity === 'number') totalStrips += d.quantity;
    });

    res.json({ totalTypes, totalStrips, available, low, out, unregistered });
  } catch (err) {
    console.error('[dashboard] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.get('/api/medicines', requireAuth, async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    let query = db.collection(COLL_MEDS);
    if (!includeArchived) query = query.where('archived', '==', false);
    const snap = await query.get();

    const items = snap.docs.map((doc) => {
      const d = doc.data();
      const status = computeStatus(d.quantity, d.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
      return {
        id: doc.id,
        name: d.name,
        person: d.person,
        quantity: d.quantity,
        stripsPerBox: d.stripsPerBox ?? DEFAULT_STRIPS_PER_BOX,
        lowStockThreshold: d.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
        notes: d.notes || '',
        archived: !!d.archived,
        status,
        statusLabel: statusLabelAr(status),
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null
      };
    });

    items.sort((a, b) => (a.person + a.name).localeCompare(b.person + b.name, 'ar'));
    res.json({ items });
  } catch (err) {
    console.error('[medicines:list] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/medicines', requireAuth, async (req, res) => {
  try {
    const { name, person, quantity, stripsPerBox, lowStockThreshold, notes } = req.body || {};
    if (!isValidString(name, 120)) return res.status(400).json({ error: 'اسم العلاج مطلوب' });
    if (!isValidString(person, 120)) return res.status(400).json({ error: 'الشخص مطلوب' });

    const spb = stripsPerBox === undefined ? DEFAULT_STRIPS_PER_BOX : stripsPerBox;
    const lst = lowStockThreshold === undefined ? DEFAULT_LOW_STOCK_THRESHOLD : lowStockThreshold;
    if (!isValidInt(spb, { min: 1, max: 1000 })) return res.status(400).json({ error: 'عدد الشرايط بالعلبة غير صحيح' });
    if (!isValidInt(lst, { min: 0, max: 1000 })) return res.status(400).json({ error: 'حد المخزون القليل غير صحيح' });

    let q = null;
    if (quantity !== undefined && quantity !== null && quantity !== '') {
      if (!isValidInt(quantity, { min: 0, max: 100000 })) {
        return res.status(400).json({ error: 'الكمية غير صحيحة' });
      }
      q = quantity;
    }

    const ref = await db.collection(COLL_MEDS).add({
      name: name.trim(),
      person: person.trim(),
      quantity: q,
      stripsPerBox: spb,
      lowStockThreshold: lst,
      notes: typeof notes === 'string' ? notes.slice(0, 500) : '',
      archived: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(201).json({ id: ref.id });
  } catch (err) {
    console.error('[medicines:create] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.put('/api/medicines/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const ref = db.collection(COLL_MEDS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'العلاج غير موجود' });

    const updates = {};
    const { name, person, stripsPerBox, lowStockThreshold, notes } = req.body || {};

    if (name !== undefined) {
      if (!isValidString(name, 120)) return res.status(400).json({ error: 'اسم غير صحيح' });
      updates.name = name.trim();
    }
    if (person !== undefined) {
      if (!isValidString(person, 120)) return res.status(400).json({ error: 'شخص غير صحيح' });
      updates.person = person.trim();
    }
    if (stripsPerBox !== undefined) {
      if (!isValidInt(stripsPerBox, { min: 1, max: 1000 })) return res.status(400).json({ error: 'عدد الشرايط بالعلبة غير صحيح' });
      updates.stripsPerBox = stripsPerBox;
    }
    if (lowStockThreshold !== undefined) {
      if (!isValidInt(lowStockThreshold, { min: 0, max: 1000 })) return res.status(400).json({ error: 'حد المخزون القليل غير صحيح' });
      updates.lowStockThreshold = lowStockThreshold;
    }
    if (notes !== undefined) {
      updates.notes = typeof notes === 'string' ? notes.slice(0, 500) : '';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'لا توجد تغييرات' });
    }
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error('[medicines:update] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/medicines/:id/archive', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const archived = req.body?.archived !== false;
    const ref = db.collection(COLL_MEDS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'العلاج غير موجود' });
    await ref.update({ archived, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ ok: true });
  } catch (err) {
    console.error('[medicines:archive] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.get('/api/medicines/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const snap = await db.collection(COLL_MEDS).doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'العلاج غير موجود' });
    const d = snap.data();

    const quantity = typeof d.quantity === 'number' ? d.quantity : null;
    const spb = d.stripsPerBox ?? DEFAULT_STRIPS_PER_BOX;
    const completeBoxes = quantity === null ? null : Math.floor(quantity / spb);
    const leftoverStrips = quantity === null ? null : quantity % spb;
    const status = computeStatus(quantity, d.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD);

    const historySnap = await db.collection(COLL_HISTORY)
      .where('medicineId', '==', id)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const history = historySnap.docs.map((h) => {
      const hd = h.data();
      return {
        id: h.id,
        type: hd.type,
        purchaseType: hd.purchaseType || null,
        quantityBefore: hd.quantityBefore,
        quantityChange: hd.quantityChange,
        quantityAfter: hd.quantityAfter,
        notes: hd.notes || '',
        createdAt: hd.createdAt?.toDate?.()?.toISOString() || null
      };
    });

    res.json({
      id,
      name: d.name,
      person: d.person,
      quantity,
      stripsPerBox: spb,
      lowStockThreshold: d.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
      notes: d.notes || '',
      archived: !!d.archived,
      status,
      statusLabel: statusLabelAr(status),
      completeBoxes,
      leftoverStrips,
      history
    });
  } catch (err) {
    console.error('[medicines:get] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

function historyRef() {
  return db.collection(COLL_HISTORY).doc();
}

app.post('/api/medicines/:id/use', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const count = req.body?.count === undefined ? 1 : req.body.count;
    if (!isValidInt(count, { min: 1, max: 1000 })) {
      return res.status(400).json({ error: 'عدد الشرايط غير صحيح' });
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 500) : '';
    const medRef = db.collection(COLL_MEDS).doc(id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(medRef);
      if (!snap.exists) throw { status: 404, message: 'العلاج غير موجود' };
      const d = snap.data();

      if (typeof d.quantity !== 'number') {
        throw { status: 400, message: 'لم يتم تسجيل المخزون لهذا العلاج، سجّل الكمية أولاً' };
      }
      if (d.quantity <= 0) {
        throw { status: 400, message: 'العلاج خلص، سجّل عملية شراء أولاً' };
      }
      if (count > d.quantity) {
        throw { status: 400, message: 'الكمية المطلوبة أكبر من المتاح' };
      }

      const before = d.quantity;
      const after = before - count;
      const now = admin.firestore.FieldValue.serverTimestamp();

      tx.update(medRef, { quantity: after, updatedAt: now });
      tx.set(historyRef(), {
        medicineId: id,
        medicineName: d.name,
        person: d.person,
        type: 'use',
        purchaseType: null,
        quantityBefore: before,
        quantityChange: -count,
        quantityAfter: after,
        notes,
        createdAt: now
      });

      return { before, after };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[use] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/medicines/:id/purchase', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { purchaseType, quantity, price, notes, purchaseDate } = req.body || {};

    if (purchaseType !== 'box' && purchaseType !== 'strips') {
      return res.status(400).json({ error: 'نوع الشراء غير صحيح' });
    }
    if (!isValidInt(quantity, { min: 1, max: 100000 })) {
      return res.status(400).json({ error: 'الكمية غير صحيحة' });
    }
    if (price !== undefined && price !== null && price !== '' && (typeof price !== 'number' || price < 0 || price > 1e9)) {
      return res.status(400).json({ error: 'السعر غير صحيح' });
    }
    const safeNotes = typeof notes === 'string' ? notes.slice(0, 500) : '';
    const safeDate = typeof purchaseDate === 'string' && purchaseDate.length <= 30 ? purchaseDate : null;
    const medRef = db.collection(COLL_MEDS).doc(id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(medRef);
      if (!snap.exists) throw { status: 404, message: 'العلاج غير موجود' };
      const d = snap.data();
      const spb = d.stripsPerBox ?? DEFAULT_STRIPS_PER_BOX;

      const stripsToAdd = purchaseType === 'box' ? quantity * spb : quantity;
      const before = typeof d.quantity === 'number' ? d.quantity : 0;
      const after = before + stripsToAdd;
      const now = admin.firestore.FieldValue.serverTimestamp();

      tx.update(medRef, { quantity: after, updatedAt: now });
      tx.set(historyRef(), {
        medicineId: id,
        medicineName: d.name,
        person: d.person,
        type: 'purchase',
        purchaseType,
        quantityBefore: before,
        quantityChange: stripsToAdd,
        quantityAfter: after,
        price: typeof price === 'number' ? price : null,
        purchaseDate: safeDate,
        notes: safeNotes,
        createdAt: now
      });

      return { before, after, stripsAdded: stripsToAdd };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[purchase] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/medicines/:id/adjust', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { newQuantity, notes } = req.body || {};
    if (!isValidInt(newQuantity, { min: 0, max: 100000 })) {
      return res.status(400).json({ error: 'الكمية الجديدة غير صحيحة' });
    }
    const safeNotes = typeof notes === 'string' ? notes.slice(0, 500) : '';
    const medRef = db.collection(COLL_MEDS).doc(id);

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(medRef);
      if (!snap.exists) throw { status: 404, message: 'العلاج غير موجود' };
      const d = snap.data();
      const before = typeof d.quantity === 'number' ? d.quantity : 0;
      const after = newQuantity;
      const change = after - before;
      const now = admin.firestore.FieldValue.serverTimestamp();

      tx.update(medRef, { quantity: after, updatedAt: now });
      tx.set(historyRef(), {
        medicineId: id,
        medicineName: d.name,
        person: d.person,
        type: 'adjust',
        purchaseType: null,
        quantityBefore: before,
        quantityChange: change,
        quantityAfter: after,
        notes: safeNotes,
        createdAt: now
      });

      return { before, after };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[adjust] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const { medicineId, person, type, from, to, limit } = req.query;
    let query = db.collection(COLL_HISTORY);

    if (medicineId) query = query.where('medicineId', '==', medicineId);
    if (person) query = query.where('person', '==', person);
    if (type && ['purchase', 'use', 'adjust'].includes(type)) {
      query = query.where('type', '==', type);
    }
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) query = query.where('createdAt', '>=', d);
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) query = query.where('createdAt', '<=', d);
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    query = query.orderBy('createdAt', 'desc').limit(lim);

    const snap = await query.get();
    const items = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        medicineId: d.medicineId,
        medicineName: d.medicineName,
        person: d.person,
        type: d.type,
        purchaseType: d.purchaseType || null,
        quantityBefore: d.quantityBefore,
        quantityChange: d.quantityChange,
        quantityAfter: d.quantityAfter,
        price: d.price ?? null,
        purchaseDate: d.purchaseDate || null,
        notes: d.notes || '',
        createdAt: d.createdAt?.toDate?.()?.toISOString() || null
      };
    });

    res.json({ items });
  } catch (err) {
    console.error('[history] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.get('/api/people', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection(COLL_MEDS).where('archived', '==', false).get();
    const set = new Set();
    snap.forEach((doc) => set.add(doc.data().person));
    res.json({ people: Array.from(set) });
  } catch (err) {
    console.error('[people] error', err.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get(['/dashboard.html', '/login.html'], (req, res) => {
  const target = req.path === '/dashboard.html' ? '/dashboard' : '/login';
  if (target === '/dashboard' && !hasValidSession(req)) return res.redirect('/login');
  if (target === '/login' && hasValidSession(req)) return res.redirect('/dashboard');
  return res.redirect(target);
});

app.get('/login', (req, res) => {
  if (hasValidSession(req)) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  if (!hasValidSession(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', (req, res) => {
  if (hasValidSession(req)) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'غير موجود' });
  if (!hasValidSession(req)) return res.redirect('/login');
  res.status(404).sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Tabibi Stock server listening on port ${PORT}`));
}

module.exports = app;
