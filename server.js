const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const initSql  = require('sql.js');

const app      = express();
const PORT     = process.env.PORT || 3000;
const PIN      = process.env.ADMIN_PIN || '8203';
const DB_PATH  = path.join(__dirname, 'db', 'data.json');
const CFG_PATH = path.join(__dirname, 'db', 'config.json');
const VIDEO_URL = 'https://e-volutionn.com/wp-content/uploads/2026/04/WhatsApp-Video-2026-04-03-at-22.21.37.mp4';

// ── CONFIG ──────────────────────────────────────────────────────────────────
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); }
  catch(e) { return { gallery_cta_url: '', gallery_popup: true }; }
}
function saveCfg(c) {
  if (!fs.existsSync(path.dirname(CFG_PATH))) fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
  fs.writeFileSync(CFG_PATH, JSON.stringify(c, null, 2));
}

// ── DATABASE ─────────────────────────────────────────────────────────────────
let db;
async function initDB() {
  if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const SQL = await initSql();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  db.run(`CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    slug       TEXT    UNIQUE NOT NULL,
    prompt     TEXT    NOT NULL,
    vsl_url    TEXT    NOT NULL DEFAULT '',
    subtitle   TEXT    NOT NULL DEFAULT '',
    images     TEXT    NOT NULL DEFAULT '[]',
    template   TEXT    NOT NULL DEFAULT 'dark',
    clicks     INTEGER NOT NULL DEFAULT 0,
    btn_clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // migrate older DBs gracefully
  ['subtitle TEXT NOT NULL DEFAULT \'\'',
   'clicks INTEGER NOT NULL DEFAULT 0',
   'btn_clicks INTEGER NOT NULL DEFAULT 0'
  ].forEach(col => {
    try { db.run(`ALTER TABLE pages ADD COLUMN ${col}`); } catch(e) {}
  });
  saveDB();
}
function saveDB() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function qAll(sql, p = []) {
  const r = db.exec(sql, p);
  if (!r.length) return [];
  return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]])));
}
function qOne(sql, p = []) { return qAll(sql, p)[0] || null; }

// ── MIDDLEWARE ───────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
      cb(null, path.join(__dirname, 'uploads'));
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, '_'))
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'directisca2025', resave: false, saveUninitialized: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

function auth(req, res, next) { req.session.auth ? next() : res.redirect('/admin/login'); }

// ── AUTH ─────────────────────────────────────────────────────────────────────
app.get('/admin/login',  (req, res) => res.send(loginPage()));
app.post('/admin/login', (req, res) => {
  if (req.body.pin === PIN) { req.session.auth = true; return res.redirect('/admin'); }
  res.send(loginPage('PIN incorreto'));
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ── DASHBOARD ────────────────────────────────────────────────────────────────
app.get('/admin', auth, (req, res) => {
  const pages = qAll('SELECT * FROM pages ORDER BY created_at DESC');
  res.send(dashPage(pages));
});

// ── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/admin/settings', auth, (req, res) => res.send(settingsPage(loadCfg())));
app.post('/admin/settings', auth, (req, res) => {
  const { gallery_cta_url, gallery_popup } = req.body;
  saveCfg({ gallery_cta_url: gallery_cta_url || '', gallery_popup: gallery_popup === 'on' });
  res.redirect('/admin/settings');
});

// ── PAGES CRUD ───────────────────────────────────────────────────────────────
app.get('/admin/pages/new', auth, (req, res) => res.send(formPage(null)));
app.get('/admin/pages/:id/edit', auth, (req, res) => {
  const p = qOne('SELECT * FROM pages WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin');
  res.send(formPage(p));
});
app.post('/admin/pages', auth, upload.array('images', 10), (req, res) => {
  const { title, prompt, vsl_url, template, subtitle } = req.body;
  const slugify = require('slugify');
  let slug = slugify(title, { lower: true, strict: true });
  if (qOne('SELECT id FROM pages WHERE slug=?', [slug])) slug += '-' + Date.now();
  const images = (req.files || []).map(f => '/uploads/' + f.filename);
  db.run('INSERT INTO pages (title,slug,prompt,vsl_url,subtitle,images,template) VALUES (?,?,?,?,?,?,?)',
    [title, slug, prompt, vsl_url || '', subtitle || '', JSON.stringify(images), template || 'dark']);
  saveDB(); res.redirect('/admin');
});
app.post('/admin/pages/:id/update', auth, upload.array('images', 10), (req, res) => {
  const { title, prompt, vsl_url, template, subtitle, keep_images } = req.body;
  const p = qOne('SELECT * FROM pages WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin');
  const kept = keep_images === 'on' ? JSON.parse(p.images) : [];
  const imgs = [...kept, ...(req.files || []).map(f => '/uploads/' + f.filename)];
  db.run('UPDATE pages SET title=?,prompt=?,vsl_url=?,subtitle=?,images=?,template=? WHERE id=?',
    [title, prompt, vsl_url || '', subtitle || '', JSON.stringify(imgs), template || 'dark', req.params.id]);
  saveDB(); res.redirect('/admin');
});
app.post('/admin/pages/:id/delete', auth, (req, res) => {
  db.run('DELETE FROM pages WHERE id=?', [req.params.id]); saveDB(); res.redirect('/admin');
});
app.post('/admin/pages/:id/duplicate', auth, (req, res) => {
  const p = qOne('SELECT * FROM pages WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin');
  const slugify = require('slugify');
  let slug = slugify(p.title + '-copia', { lower: true, strict: true });
  if (qOne('SELECT id FROM pages WHERE slug=?', [slug])) slug += '-' + Date.now();
  db.run('INSERT INTO pages (title,slug,prompt,vsl_url,subtitle,images,template) VALUES (?,?,?,?,?,?,?)',
    [p.title + ' (cópia)', slug, p.prompt, p.vsl_url, p.subtitle, p.images, p.template]);
  saveDB(); res.redirect('/admin');
});

// ── API ───────────────────────────────────────────────────────────────────────
app.post('/api/click/:slug', (req, res) => {
  db.run('UPDATE pages SET clicks=clicks+1 WHERE slug=?', [req.params.slug]);
  saveDB(); res.json({ ok: true });
});
app.post('/api/btnclick/:slug', (req, res) => {
  db.run('UPDATE pages SET btn_clicks=btn_clicks+1 WHERE slug=?', [req.params.slug]);
  saveDB(); res.json({ ok: true });
});

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/prompts'));
app.get('/prompts', (req, res) => {
  const pages = qAll('SELECT id,title,slug,images FROM pages ORDER BY created_at DESC');
  res.send(galleryPage(pages, loadCfg()));
});
app.get('/:slug/video', (req, res) => {
  if (req.params.slug === 'admin') return res.redirect('/admin');
  const p = qOne('SELECT * FROM pages WHERE slug=?', [req.params.slug]);
  if (!p) return res.status(404).send(notFound());
  res.send(videoPage(p));
});
app.get('/:slug', (req, res) => {
  if (req.params.slug === 'admin')   return res.redirect('/admin');
  if (req.params.slug === 'prompts') return res.redirect('/prompts');
  const p = qOne('SELECT * FROM pages WHERE slug=?', [req.params.slug]);
  if (!p) return res.status(404).send(notFound());
  res.send(publicPage(p));
});

initDB().then(() => app.listen(PORT, () => console.log(`✅ Direct Isca rodando em http://localhost:${PORT}`)));

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════
function notFound() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>404</title></head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0f;color:#9d9ab8;flex-direction:column;gap:12px">
<p style="font-size:48px">🔍</p><p style="font-size:18px">Página não encontrada</p>
<a href="/prompts" style="color:#a78bfa;font-size:14px">← Ver todos os prompts</a></body></html>`;
}

const TPL_META = {
  dark:   { label: 'Dark Violet', colors: ['#7c3aff','#ff3aad','#0a0a0f'] },
  neon:   { label: 'Neon Cyber',  colors: ['#3affe0','#00eeff','#020f0e'] },
  fire:   { label: 'Fire Gold',   colors: ['#ff6b35','#ffd700','#0f0800'] },
  brasil: { label: 'Brasil',      colors: ['#009c3b','#ffdf00','#002776'] },
};

const GF = `https://fonts.googleapis.com/css2?family=Anton&family=Syne:wght@700;800;900&family=Inter:wght@400;500;600&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap`;

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN CSS
// ════════════════════════════════════════════════════════════════════════════
const ADMIN_CSS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${GF}" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#07070f;--s1:#0f0f1c;--s2:#161626;--s3:#1c1c30;--b1:rgba(255,255,255,.07);--b2:rgba(255,255,255,.13);--ac:#7c3aff;--ac2:#ff3aad;--ac3:#3affe0;--tx:#f0eeff;--mu:#6b6888;--mu2:#9d9ab8;--ok:#22d3a0;--warn:#f59e0b;--err:#f43f5e}
html,body{height:100%}
body{background:var(--bg);color:var(--tx);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 60% 40% at 10% 0,rgba(124,58,255,.1),transparent 55%),radial-gradient(ellipse 40% 30% at 90% 95%,rgba(255,58,173,.07),transparent 50%);pointer-events:none;z-index:0}
a{text-decoration:none;color:inherit}
.nav{position:sticky;top:0;z-index:100;height:54px;background:rgba(7,7,15,.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between;padding:0 16px;gap:8px}
.nav-brand{display:flex;align-items:center;gap:7px;flex-shrink:0}
.nav-name{font-family:'Syne',sans-serif;font-weight:800;font-size:16px;background:linear-gradient(135deg,#fff,#c4b5fd,#f9a8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.nav-links{display:flex;gap:2px;overflow-x:auto}
.nav-a{padding:5px 10px;border-radius:8px;font-size:12px;font-weight:500;color:var(--mu2);transition:.15s;white-space:nowrap;flex-shrink:0}
.nav-a:hover{color:var(--tx);background:rgba(255,255,255,.05)}
.nav-a.on{color:#fff;background:rgba(124,58,255,.22)}
.nav-out{font-size:11px;color:var(--mu);padding:5px 8px;border-radius:8px;transition:.15s;flex-shrink:0}
.nav-out:hover{color:var(--mu2)}
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:20px 16px 80px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border-radius:10px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:.15s;text-decoration:none;white-space:nowrap;-webkit-appearance:none}
.btn:active{transform:scale(.97)}
.btn-sm{padding:6px 11px;font-size:12px;border-radius:8px}
.btn-p{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;box-shadow:0 2px 14px rgba(124,58,255,.3)}
.btn-p:hover{box-shadow:0 4px 22px rgba(124,58,255,.45)}
.btn-g{background:rgba(255,255,255,.06);color:var(--mu2);border:1px solid var(--b1)}
.btn-g:hover{background:rgba(255,255,255,.1);color:var(--tx)}
.btn-tl{background:rgba(58,255,224,.1);color:var(--ac3);border:1px solid rgba(58,255,224,.2)}
.btn-tl:hover{background:rgba(58,255,224,.18)}
.btn-yw{background:rgba(245,158,11,.1);color:var(--warn);border:1px solid rgba(245,158,11,.2)}
.btn-yw:hover{background:rgba(245,158,11,.18)}
.btn-rd{background:rgba(244,63,94,.1);color:var(--err);border:1px solid rgba(244,63,94,.2)}
.btn-rd:hover{background:rgba(244,63,94,.2)}
input,textarea,select{background:var(--s2);border:1px solid var(--b1);border-radius:10px;color:var(--tx);font-family:'Inter',sans-serif;font-size:14px;padding:11px 14px;width:100%;outline:none;transition:.15s;-webkit-appearance:none;appearance:none}
input:focus,textarea:focus,select:focus{border-color:rgba(124,58,255,.6);box-shadow:0 0 0 3px rgba(124,58,255,.12)}
input::placeholder,textarea::placeholder{color:var(--mu)}
label{display:block;font-size:11px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:var(--mu);margin-bottom:7px}
.field{margin-bottom:16px}
textarea{resize:vertical;min-height:110px;line-height:1.55}
select option{background:#1c1c30}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.stat{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:16px 18px;position:relative;overflow:hidden}
.stat::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;border-radius:2px}
.stat.s-pu::after{background:linear-gradient(90deg,var(--ac),var(--ac2))}
.stat.s-tl::after{background:linear-gradient(90deg,var(--ac3),#0ef)}
.stat.s-pk::after{background:linear-gradient(90deg,var(--ac2),#ff8c69)}
.stat-n{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#fff;line-height:1}
.stat-l{font-size:11px;color:var(--mu);margin-top:5px}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.pcard{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:16px;position:relative;overflow:hidden}
.pcard::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(124,58,255,.35),transparent)}
.pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.pc-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#fff;line-height:1.2}
.pc-slug{font-size:11px;color:var(--mu);margin-top:3px;font-family:monospace}
.pc-thumb{width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid var(--b1);flex-shrink:0}
.pc-thumb-ph{width:44px;height:44px;border-radius:8px;background:var(--s3);border:1px solid var(--b1);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.pc-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.pc-m{background:var(--s3);border-radius:8px;padding:8px 10px;text-align:center}
.pc-mn{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;line-height:1}
.pc-ml{font-size:10px;color:var(--mu);margin-top:2px}
.pc-m.cl .pc-mn{color:var(--ac3)}
.pc-m.bc .pc-mn{color:var(--ac2)}
.pc-foot{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pc-date{font-size:11px;color:var(--mu)}
.tpl-dot{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:600}
.pc-actions{display:flex;gap:6px;flex-wrap:wrap}
.card{background:var(--s1);border:1px solid var(--b1);border-radius:16px}
.sh{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.sh-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff}
.sh-sub{font-size:13px;color:var(--mu2);margin-top:2px}
.empty{text-align:center;padding:60px 20px}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);background:var(--s2);border:1px solid rgba(58,255,224,.3);border-radius:12px;padding:11px 20px;font-size:13px;color:var(--ac3);font-weight:500;z-index:999;opacity:0;transition:.3s;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.form-wrap{max-width:660px;margin:0 auto}
.fs{margin-bottom:26px}
.fs-title{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--mu);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--b1)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tpl-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.tpl-opt{border:2px solid var(--b1);border-radius:14px;padding:12px;cursor:pointer;transition:.15s}
.tpl-opt input{display:none}
.tpl-opt.sel{border-color:var(--ac);background:rgba(124,58,255,.08)}
.swatches{display:flex;gap:4px;margin-bottom:6px}
.sw{width:14px;height:14px;border-radius:50%}
.tpl-name{font-size:13px;font-weight:600;color:#fff;margin-bottom:2px}
.tpl-desc{font-size:11px;color:var(--mu);line-height:1.4}
.dropz{border:2px dashed var(--b1);border-radius:12px;padding:24px;text-align:center;cursor:pointer;transition:.15s;position:relative}
.dropz:hover{border-color:rgba(124,58,255,.5);background:rgba(124,58,255,.04)}
.dropz input{position:absolute;inset:0;opacity:0;cursor:pointer}
.prev-wrap{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.prev-img{width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--b1)}
@media(max-width:600px){
  .stats{grid-template-columns:1fr 1fr}
  .stats .stat:last-child{grid-column:span 2}
  .g2{grid-template-columns:1fr}
  .pgrid{grid-template-columns:1fr}
}
</style>`;

// ════════════════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════════════════
function loginPage(err) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Direct Isca · Login</title>${ADMIN_CSS}</head><body>
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;z-index:1">
  <div style="background:var(--s1);border:1px solid var(--b1);border-radius:20px;padding:36px 28px;width:100%;max-width:340px;text-align:center">
    <div style="font-size:28px;margin-bottom:10px">⚡</div>
    <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;background:linear-gradient(135deg,#fff,#c4b5fd,#f9a8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px">Direct Isca</div>
    <p style="font-size:13px;color:var(--mu);margin-bottom:28px">Painel de controle</p>
    ${err ? `<p style="color:var(--err);font-size:13px;margin-bottom:16px;background:rgba(244,63,94,.1);border-radius:8px;padding:8px">${err}</p>` : ''}
    <form method="POST" action="/admin/login">
      <div class="field" style="text-align:left">
        <label>PIN de acesso</label>
        <input type="password" name="pin" placeholder="••••" inputmode="numeric" autocomplete="current-password" autofocus style="text-align:center;font-size:24px;letter-spacing:10px">
      </div>
      <button type="submit" class="btn btn-p" style="width:100%;padding:14px;margin-top:4px">Entrar</button>
    </form>
  </div>
</div></body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  NAV
// ════════════════════════════════════════════════════════════════════════════
function nav(active) {
  return `<nav class="nav">
    <div class="nav-brand"><span style="font-size:18px">⚡</span><span class="nav-name">Direct Isca</span></div>
    <div class="nav-links">
      <a href="/admin" class="nav-a${active === 'p' ? ' on' : ''}">Páginas</a>
      <a href="/admin/settings" class="nav-a${active === 's' ? ' on' : ''}">Config</a>
      <a href="/prompts" target="_blank" class="nav-a">Galeria</a>
      <a href="/admin/logout" class="nav-out">Sair</a>
    </div>
  </nav>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function dashPage(pages) {
  const totalClicks = pages.reduce((a, p) => a + (p.clicks || 0), 0);
  const totalBtn    = pages.reduce((a, p) => a + (p.btn_clicks || 0), 0);
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Direct Isca · Painel</title>${ADMIN_CSS}</head><body>
${nav('p')}
<div class="wrap">
  <div class="stats">
    <div class="stat s-pu"><div class="stat-n">${pages.length}</div><div class="stat-l">Páginas criadas</div></div>
    <div class="stat s-tl"><div class="stat-n">${totalClicks}</div><div class="stat-l">Acessos totais</div></div>
    <div class="stat s-pk"><div class="stat-n">${totalBtn}</div><div class="stat-l">Cliques "Ganhar com IA"</div></div>
  </div>
  <div class="sh">
    <div><div class="sh-title">Suas páginas</div><div class="sh-sub">${pages.length} página${pages.length !== 1 ? 's' : ''}</div></div>
    <a href="/admin/pages/new" class="btn btn-p">+ Nova página</a>
  </div>
  ${pages.length === 0
    ? `<div class="card empty"><p style="font-size:36px;margin-bottom:10px">📄</p><p style="color:var(--mu2);margin-bottom:16px">Nenhuma página ainda.</p><a href="/admin/pages/new" class="btn btn-p">Criar primeira página</a></div>`
    : `<div class="pgrid">${pages.map(p => {
        const imgs = JSON.parse(p.images || '[]');
        const tpl  = TPL_META[p.template] || TPL_META.dark;
        const date = new Date(p.created_at).toLocaleDateString('pt-BR');
        return `<div class="pcard">
          <div class="pc-top">
            <div><div class="pc-title">${p.title}</div><div class="pc-slug">/${p.slug}</div></div>
            ${imgs[0] ? `<img src="${imgs[0]}" class="pc-thumb">` : `<div class="pc-thumb-ph">🖼</div>`}
          </div>
          <div class="pc-metrics">
            <div class="pc-m cl"><div class="pc-mn">${p.clicks || 0}</div><div class="pc-ml">acessos</div></div>
            <div class="pc-m bc"><div class="pc-mn">${p.btn_clicks || 0}</div><div class="pc-ml">cliques CTA</div></div>
          </div>
          <div class="pc-foot">
            <div class="tpl-dot" style="background:${tpl.colors[0]}22;border:1px solid ${tpl.colors[0]}44;color:${tpl.colors[0]}">
              <span style="width:6px;height:6px;border-radius:50%;background:${tpl.colors[0]};display:inline-block"></span>${tpl.label}
            </div>
            <div class="pc-date">${date}</div>
          </div>
          <div class="pc-actions">
            <button class="btn btn-sm btn-tl" onclick="cpLink('${p.slug}')">Copiar link</button>
            <a href="/${p.slug}" target="_blank" class="btn btn-sm btn-g">Ver</a>
            <a href="/admin/pages/${p.id}/edit" class="btn btn-sm btn-g">Editar</a>
            <form method="POST" action="/admin/pages/${p.id}/duplicate" style="display:inline">
              <button type="submit" class="btn btn-sm btn-yw">Duplicar</button>
            </form>
            <form method="POST" action="/admin/pages/${p.id}/delete" style="display:inline" onsubmit="return confirm('Deletar?')">
              <button type="submit" class="btn btn-sm btn-rd">Deletar</button>
            </form>
          </div>
        </div>`;
      }).join('')}</div>`
  }
</div>
<div class="toast" id="toast">Link copiado!</div>
<script>
function cpLink(slug) {
  navigator.clipboard.writeText(location.origin + '/' + slug).catch(() => {});
  var t = document.getElementById('toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
</script>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  FORM PAGE
// ════════════════════════════════════════════════════════════════════════════
function formPage(page) {
  const isEdit = !!page;
  const imgs   = page ? JSON.parse(page.images || '[]') : [];
  const cur    = page ? page.template : 'dark';
  const tpls   = [
    { id: 'dark',   label: 'Dark Violet', desc: 'Roxo/rosa escuro e futurista', colors: ['#7c3aff','#ff3aad','#0a0a0f'] },
    { id: 'neon',   label: 'Neon Cyber',  desc: 'Verde neon tecnológico',       colors: ['#3affe0','#00eeff','#020f0e'] },
    { id: 'fire',   label: 'Fire Gold',   desc: 'Laranja/dourado, urgência',    colors: ['#ff6b35','#ffd700','#0f0800'] },
    { id: 'brasil', label: 'Brasil',      desc: 'Verde/amarelo nacional',       colors: ['#009c3b','#ffdf00','#002776'] },
  ];
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isEdit ? 'Editar' : 'Nova'} Página · Direct Isca</title>${ADMIN_CSS}</head><body>
${nav('p')}
<div class="wrap"><div class="form-wrap">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap">
    <a href="/admin" class="btn btn-g btn-sm">← Voltar</a>
    <div class="sh-title">${isEdit ? 'Editar: ' + page.title : 'Nova página'}</div>
  </div>
  <form method="POST" action="${isEdit ? '/admin/pages/' + page.id + '/update' : '/admin/pages'}" enctype="multipart/form-data">
    <div class="fs">
      <div class="fs-title">Informações</div>
      <div class="g2">
        <div class="field"><label>Título *</label><input type="text" name="title" value="${isEdit ? page.title : ''}" required placeholder="Ex: Prompt 8K Ultra Realista"></div>
        <div class="field"><label>Link do botão "Quero Ganhar com IA"</label><input type="url" name="vsl_url" value="${isEdit ? page.vsl_url : ''}" placeholder="https://..."></div>
      </div>
      <div class="field"><label>Subtítulo (aparece no popup e na página)</label><input type="text" name="subtitle" value="${isEdit ? page.subtitle : ''}" placeholder="Ex: Use esse prompt com sua foto e veja a IA transformar em segundos"></div>
      <div class="field"><label>Prompt (texto que o cliente copia) *</label><textarea name="prompt" required placeholder="Cole o prompt aqui...">${isEdit ? page.prompt : ''}</textarea></div>
    </div>
    <div class="fs">
      <div class="fs-title">Template visual</div>
      <div class="tpl-grid">
        ${tpls.map(t => `<label class="tpl-opt${cur === t.id ? ' sel' : ''}" onclick="selT(this)">
          <input type="radio" name="template" value="${t.id}" ${cur === t.id ? 'checked' : ''}>
          <div class="swatches">${t.colors.map(c => `<div class="sw" style="background:${c}"></div>`).join('')}</div>
          <div class="tpl-name">${t.label}</div>
          <div class="tpl-desc">${t.desc}</div>
        </label>`).join('')}
      </div>
    </div>
    <div class="fs">
      <div class="fs-title">Imagens (1 = fixa · 2+ = carrossel automático)</div>
      ${isEdit && imgs.length ? `
        <div style="margin-bottom:12px">
          <p style="font-size:12px;color:var(--mu2);margin-bottom:8px">Imagens atuais:</p>
          <div class="prev-wrap">${imgs.map(i => `<img src="${i}" class="prev-img">`).join('')}</div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;text-transform:none;letter-spacing:0;color:var(--mu2);width:auto">
            <input type="checkbox" name="keep_images" checked style="width:auto;padding:0;accent-color:var(--ac)"> Manter imagens atuais
          </label>
        </div>` : ''}
      <div class="dropz">
        <input type="file" name="images" multiple accept="image/*" onchange="prevF(this)">
        <p style="font-size:14px;color:var(--mu2)">Toque aqui para adicionar imagens</p>
        <p style="font-size:12px;color:var(--mu);margin-top:4px">PNG · JPG · WEBP · máx 20MB</p>
      </div>
      <div class="prev-wrap" id="pv"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <a href="/admin" class="btn btn-g">Cancelar</a>
      <button type="submit" class="btn btn-p">${isEdit ? 'Salvar alterações' : 'Criar página'}</button>
    </div>
  </form>
</div></div>
<script>
function selT(el) {
  document.querySelectorAll('.tpl-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel'); el.querySelector('input').checked = true;
}
function prevF(inp) {
  var wrap = document.getElementById('pv'); wrap.innerHTML = '';
  Array.from(inp.files).forEach(f => {
    var r = new FileReader();
    r.onload = e => { var i = document.createElement('img'); i.src = e.target.result; i.className = 'prev-img'; wrap.appendChild(i); };
    r.readAsDataURL(f);
  });
}
</script>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ════════════════════════════════════════════════════════════════════════════
function settingsPage(cfg) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurações · Direct Isca</title>${ADMIN_CSS}</head><body>
${nav('s')}
<div class="wrap"><div class="form-wrap">
  <div class="sh-title" style="margin-bottom:22px">Configurações gerais</div>
  <form method="POST" action="/admin/settings">
    <div class="fs">
      <div class="fs-title">Galeria /prompts</div>
      <div class="field">
        <label>URL do botão "Desbloquear" (banner da galeria e popup)</label>
        <input type="url" name="gallery_cta_url" value="${cfg.gallery_cta_url || ''}" placeholder="https://...">
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:14px;cursor:pointer;width:auto">
          <input type="checkbox" name="gallery_popup" ${cfg.gallery_popup !== false ? 'checked' : ''} style="width:auto;padding:0;accent-color:var(--ac)">
          Mostrar popup na galeria (aparece após 4 segundos para novos visitantes)
        </label>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end">
      <button type="submit" class="btn btn-p">Salvar configurações</button>
    </div>
  </form>
</div></div>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC PAGE (prompt page)
// ════════════════════════════════════════════════════════════════════════════
function publicPage(page) {
  const images   = JSON.parse(page.images || '[]');
  const multi    = images.length > 1;
  const single   = images.length === 1;
  const subtitle = (page.subtitle && page.subtitle.trim())
    ? page.subtitle
    : 'Use esse prompt com qualquer foto sua e veja a IA transformar em segundos.';

  const T = {
    dark:   { bg:'#0a0a0f',bg2:'#12121a',g1:'rgba(124,58,255,.18)',g2:'rgba(255,58,173,.12)',g3:'rgba(58,255,224,.06)',a1:'#7c3aff',a2:'#ff3aad',a3:'#3affe0',btn:'linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad)',bsh:'rgba(124,58,255,.45)',bb:'rgba(124,58,255,.2)',bbd:'rgba(124,58,255,.35)',bbt:'#a78bfa',tx:'#f0eeff',mu:'#9d9ab8' },
    neon:   { bg:'#020f0e',bg2:'#041512',g1:'rgba(58,255,224,.15)',g2:'rgba(0,238,255,.1)',g3:'rgba(124,58,255,.05)',a1:'#3affe0',a2:'#00eeff',a3:'#7c3aff',btn:'linear-gradient(135deg,#3affe0,#00c8d4,#0099ff)',bsh:'rgba(58,255,224,.35)',bb:'rgba(58,255,224,.12)',bbd:'rgba(58,255,224,.3)',bbt:'#3affe0',tx:'#e0fffc',mu:'#7ab8b2' },
    fire:   { bg:'#0f0800',bg2:'#1a0f02',g1:'rgba(255,107,53,.18)',g2:'rgba(255,215,0,.1)',g3:'rgba(255,50,50,.06)',a1:'#ff6b35',a2:'#ffd700',a3:'#ffaa00',btn:'linear-gradient(135deg,#ff6b35,#ff3a00,#ffd700)',bsh:'rgba(255,107,53,.45)',bb:'rgba(255,107,53,.15)',bbd:'rgba(255,107,53,.3)',bbt:'#ffd700',tx:'#fff5e0',mu:'#b8956a' },
    brasil: { bg:'#011a0a',bg2:'#02250e',g1:'rgba(0,156,59,.2)',g2:'rgba(255,223,0,.1)',g3:'rgba(0,39,118,.1)',a1:'#00c04b',a2:'#ffdf00',a3:'#4da6ff',btn:'linear-gradient(135deg,#009c3b,#00c04b,#ffdf00)',bsh:'rgba(0,192,75,.4)',bb:'rgba(0,156,59,.15)',bbd:'rgba(0,156,59,.35)',bbt:'#4ade80',tx:'#f0fff4',mu:'#6b9e7a' },
  };
  const t = T[page.template] || T.dark;
  const carItems = multi ? [...images, ...images].map(s => `<img src="${s}" alt="" loading="eager">`).join('') : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${t.bg}">
<title>${page.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${GF}" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{overflow-x:hidden}
body{background:${t.bg};color:${t.tx};font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 90% 50% at 10% 5%,${t.g1},transparent 55%),radial-gradient(ellipse 70% 45% at 90% 85%,${t.g2},transparent 50%),radial-gradient(ellipse 60% 40% at 50% 50%,${t.g3},transparent 55%);pointer-events:none;z-index:0}
.pg{position:relative;z-index:1;width:100%;max-width:480px;margin:0 auto;padding:0 0 60px}
.badge-row{display:flex;justify-content:center;padding:24px 20px 0}
.badge-inner{background:${t.bb};border:1px solid ${t.bbd};border-radius:100px;padding:5px 16px;font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:${t.bbt}}
.hl{padding:16px 18px 0;text-align:center}
.hl h1{font-family:'Syne',sans-serif;font-size:clamp(28px,9vw,44px);font-weight:900;line-height:1.05;letter-spacing:-1px;background:linear-gradient(140deg,#fff 0%,${t.a1} 45%,${t.a2} 80%,${t.a3} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hl .sub{margin:10px auto 0;font-size:14px;line-height:1.6;color:${t.mu};max-width:340px}
.img-sec{margin:20px 14px 0;border-radius:20px;overflow:hidden;border:1px solid ${t.bb};box-shadow:0 4px 40px rgba(0,0,0,.5)}
.img-sec img.solo{width:100%;display:block;max-height:420px;object-fit:cover}
.car-outer{width:100%;overflow:hidden}
.car-track{display:flex;gap:10px;padding:6px;animation:carscroll 22s linear infinite}
.car-track img{height:280px;width:auto;flex-shrink:0;border-radius:14px;object-fit:cover}
.cta{margin:18px 14px 0}
.btn-copy{width:100%;padding:22px 16px;border:none;border-radius:18px;background:${t.btn};color:#fff;font-family:'Anton',sans-serif;font-size:18px;letter-spacing:.5px;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 4px 28px ${t.bsh},inset 0 0 0 1px rgba(255,255,255,.1);-webkit-appearance:none;transition:transform .15s;display:block;text-align:center}
.btn-copy:active{transform:scale(.97)}
.btn-copy::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:shimmer 2.5s ease-in-out infinite}
.copy-ok{text-align:center;margin-top:10px;font-size:13px;color:${t.a3};height:20px;opacity:0;transition:opacity .25s}
.copy-ok.show{opacity:1}

/* OVERLAY */
.ov{position:fixed;inset:0;background:rgba(4,4,12,.9);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .35s ease}
.ov.show{opacity:1;pointer-events:all}

/* POPUP — white, centered, animated gift */
.popup{width:100%;max-width:390px;background:#fff;border-radius:24px;padding:28px 22px 24px;position:relative;overflow:hidden;transform:scale(.9) translateY(24px);transition:transform .42s cubic-bezier(.34,1.4,.64,1);box-shadow:0 28px 80px rgba(0,0,0,.65)}
.ov.show .popup{transform:scale(1) translateY(0)}
.pop-bar{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,${t.a1},${t.a2})}

/* GIFT ANIMATION */
.gift-scene{display:flex;align-items:center;justify-content:center;height:88px;margin-bottom:16px;position:relative}
.gift-main{position:relative;animation:gBounce 2s ease-in-out infinite}
.g-lid{width:82px;height:26px;background:${t.btn};border-radius:5px;position:relative;display:flex;align-items:center;justify-content:center;margin-bottom:2px;overflow:visible;box-shadow:0 3px 12px ${t.bsh}}
.g-lid::before,.g-lid::after{content:'';position:absolute;top:-14px;width:22px;height:20px;border-radius:50%;border:4px solid #fbbf24}
.g-lid::before{left:14px;transform:rotate(-30deg)}
.g-lid::after{right:14px;transform:rotate(30deg)}
.g-lid-rib{width:11px;height:100%;background:rgba(251,191,36,.65);border-radius:2px;position:absolute;left:50%;transform:translateX(-50%)}
.g-body{width:76px;height:58px;background:${t.btn};border-radius:4px 4px 10px 10px;margin:0 auto;position:relative;overflow:hidden;box-shadow:0 8px 24px ${t.bsh}}
.g-body-rib{position:absolute;left:50%;top:0;bottom:0;width:11px;background:rgba(251,191,36,.55);transform:translateX(-50%)}
.g-sp{position:absolute;font-size:14px;color:#fbbf24;animation:spTw 2.2s ease-in-out infinite;font-style:normal}
.g-sp:nth-child(1){top:4px;left:2px;animation-delay:0s}
.g-sp:nth-child(2){top:0;right:0;animation-delay:.55s}
.g-sp:nth-child(3){bottom:8px;left:-4px;animation-delay:1.1s}
.g-sp:nth-child(4){bottom:4px;right:-2px;animation-delay:1.65s}

/* POPUP CONTENT */
.pop-title{font-family:'Anton',sans-serif;font-size:22px;letter-spacing:.3px;color:#1a1a2e;text-align:center;line-height:1.15;margin-bottom:8px}
.pop-sub{font-size:13px;color:#666;text-align:center;line-height:1.6;margin-bottom:16px}
.pop-img{border-radius:14px;overflow:hidden;border:1px solid #ebebeb;margin-bottom:18px}
.pop-img img{width:100%;display:block;max-height:180px;object-fit:cover}
.btn-pop{width:100%;padding:18px 16px;border:none;border-radius:14px;background:${t.btn};color:#fff;font-family:'Anton',sans-serif;font-size:16px;letter-spacing:.5px;cursor:pointer;box-shadow:0 4px 24px ${t.bsh};-webkit-appearance:none;transition:transform .15s;display:block;text-align:center}
.btn-pop:active{transform:scale(.97)}
.pop-close{display:block;text-align:center;margin-top:12px;font-size:12px;color:#bbb;cursor:pointer;padding:6px;-webkit-user-select:none;user-select:none}
.pop-close:active{color:#999}

/* PARTICLES */
.pts{position:fixed;inset:0;pointer-events:none;z-index:199;overflow:hidden}
.pt{position:absolute;border-radius:50%;animation:ptfall linear forwards}

@keyframes shimmer{0%{left:-100%}100%{left:200%}}
@keyframes carscroll{0%{transform:translateX(0)}100%{transform:translateX(var(--dist,0px))}}
@keyframes gBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes spTw{0%,100%{opacity:0;transform:scale(.4) rotate(-15deg)}50%{opacity:1;transform:scale(1.2) rotate(10deg)}}
@keyframes ptfall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(360deg);opacity:0}}
</style>
</head>
<body>
<div class="pg">
  <div class="badge-row"><div class="badge-inner">Exclusivo · TikTok Shop IA</div></div>
  <div class="hl">
    <h1>${page.title}</h1>
    <p class="sub">${subtitle}</p>
  </div>
  <div class="img-sec">
    ${single ? `<img class="solo" src="${images[0]}" alt="">` : ''}
    ${multi  ? `<div class="car-outer"><div class="car-track" id="carTrack">${carItems}</div></div>` : ''}
  </div>
  <div class="cta">
    <button class="btn-copy" id="btnCopy">CLIQUE AQUI PARA COPIAR O PROMPT</button>
    <div class="copy-ok" id="copyOk">Prompt copiado! ✓</div>
  </div>
</div>

<div class="pts" id="pts"></div>

<div class="ov" id="ov">
  <div class="popup">
    <div class="pop-bar"></div>
    <div class="gift-scene">
      <div class="gift-main">
        <div class="g-lid"><div class="g-lid-rib"></div></div>
        <div class="g-body"><div class="g-body-rib"></div></div>
      </div>
      <span class="g-sp">✦</span>
      <span class="g-sp">★</span>
      <span class="g-sp">✦</span>
      <span class="g-sp">★</span>
    </div>
    <div class="pop-title">Parabéns, você ganhou<br>um bônus surpresa!</div>
    <div class="pop-sub">O prompt que prometi já está garantido, mas se deseja destravar o presente misterioso, clique no botão abaixo.</div>
    ${images[0] ? `<div class="pop-img"><img src="${images[0]}" alt=""></div>` : ''}
    <button class="btn-pop" id="btnUnlock">DESBLOQUEAR BÔNUS</button>
    <span class="pop-close" id="btnClose">Não, obrigado — quero só o prompt</span>
  </div>
</div>

<script>
(function () {
  var PROMPT = ${JSON.stringify(page.prompt)};
  var SLUG   = ${JSON.stringify(page.slug)};
  var A1 = '${t.a1}', A2 = '${t.a2}', A3 = '${t.a3}';
  var dismissed = !!sessionStorage.getItem('pop_' + SLUG);

  // carousel
  ${multi ? `(function(){
    var track = document.getElementById('carTrack');
    function setup() {
      var imgs = track.querySelectorAll('img'), half = imgs.length / 2, w = 0;
      for (var i = 0; i < half; i++) w += imgs[i].offsetWidth + 10;
      if (w < 10) { setTimeout(setup, 300); return; }
      track.style.setProperty('--dist', '-' + w + 'px');
      track.style.width = (w * 2) + 'px';
    }
    var imgs = track.querySelectorAll('img'), loaded = 0;
    function onL() { loaded++; if (loaded >= imgs.length) setup(); }
    for (var i = 0; i < imgs.length; i++) { if (imgs[i].complete) onL(); else imgs[i].addEventListener('load', onL); }
    setTimeout(setup, 1500);
  })();` : ''}

  // page view tracking
  try { fetch('/api/click/' + SLUG, { method: 'POST' }); } catch (e) {}

  // copy button
  document.getElementById('btnCopy').addEventListener('click', function () {
    var copied = false;
    function showOk() {
      if (copied) return; copied = true;
      var el = document.getElementById('copyOk');
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(PROMPT).then(showOk).catch(fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = PROMPT; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove(); showOk();
    }
    if (!dismissed) { setTimeout(openPopup, 350); }
  });

  // popup
  var ov = document.getElementById('ov');
  function openPopup() { spawnPts(); ov.classList.add('show'); }
  function closePopup() { ov.classList.remove('show'); }

  document.getElementById('btnClose').addEventListener('click', function () {
    sessionStorage.setItem('pop_' + SLUG, '1');
    dismissed = true;
    closePopup();
  });
  document.getElementById('btnUnlock').addEventListener('click', function () {
    window.location.href = '/' + SLUG + '/video';
  });
  ov.addEventListener('click', function (e) { if (e.target === ov) closePopup(); });

  // particles
  function spawnPts() {
    var c = document.getElementById('pts');
    var cols = [A1, A2, A3, '#ffd700', '#fff'];
    for (var i = 0; i < 40; i++) {
      var p = document.createElement('div'); p.className = 'pt';
      var sz = 4 + Math.random() * 7;
      p.style.left = (Math.random() * 100) + '%';
      p.style.top = (-10 - Math.random() * 20) + 'px';
      p.style.background = cols[Math.floor(Math.random() * 5)];
      p.style.width = sz + 'px'; p.style.height = sz + 'px';
      p.style.animationDuration = (1.5 + Math.random() * 2) + 's';
      p.style.animationDelay = (Math.random() * 0.8) + 's';
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '3px';
      c.appendChild(p);
      setTimeout((function (el) { return function () { el.remove(); }; }(p)), 4500);
    }
  }
})();
</script>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  VIDEO PAGE
// ════════════════════════════════════════════════════════════════════════════
function videoPage(page) {
  const T = {
    dark:   { bg:'#0a0a0f',g1:'rgba(124,58,255,.18)',g2:'rgba(255,58,173,.12)',btn:'linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad)',bsh:'rgba(124,58,255,.45)',tx:'#f0eeff',mu:'#9d9ab8' },
    neon:   { bg:'#020f0e',g1:'rgba(58,255,224,.15)',g2:'rgba(0,238,255,.1)',btn:'linear-gradient(135deg,#3affe0,#00c8d4,#0099ff)',bsh:'rgba(58,255,224,.35)',tx:'#e0fffc',mu:'#7ab8b2' },
    fire:   { bg:'#0f0800',g1:'rgba(255,107,53,.18)',g2:'rgba(255,215,0,.1)',btn:'linear-gradient(135deg,#ff6b35,#ff3a00,#ffd700)',bsh:'rgba(255,107,53,.45)',tx:'#fff5e0',mu:'#b8956a' },
    brasil: { bg:'#011a0a',g1:'rgba(0,156,59,.2)',g2:'rgba(255,223,0,.1)',btn:'linear-gradient(135deg,#009c3b,#00c04b,#ffdf00)',bsh:'rgba(0,192,75,.4)',tx:'#f0fff4',mu:'#6b9e7a' },
  };
  const t   = T[page.template] || T.dark;
  const cta = page.vsl_url || '#';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${t.bg}">
<title>${page.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${GF}" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%;overflow-x:hidden}
body{background:${t.bg};color:${t.tx};font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 90% 50% at 10% 5%,${t.g1},transparent 55%),radial-gradient(ellipse 70% 45% at 90% 85%,${t.g2},transparent 50%);pointer-events:none;z-index:0}
.pg{position:relative;z-index:1;width:100%;max-width:560px;margin:0 auto;padding:28px 14px 60px;display:flex;flex-direction:column;align-items:center}
.vid-label{font-family:'Anton',sans-serif;font-size:14px;letter-spacing:2px;color:${t.tx};opacity:.65;margin-bottom:14px;text-align:center}
.vid-wrap{width:100%;border-radius:18px;overflow:hidden;position:relative;background:#000;border:1px solid rgba(255,255,255,.07);box-shadow:0 10px 50px rgba(0,0,0,.65)}
video{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}
.play-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;cursor:pointer;background:rgba(0,0,0,.3);transition:opacity .4s;-webkit-tap-highlight-color:transparent}
.play-ov.gone{opacity:0;pointer-events:none}
.play-btn{width:80px;height:80px;border-radius:50%;background:${t.btn};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 30px ${t.bsh};animation:pulse 1.8s ease-in-out infinite;flex-shrink:0}
.play-btn svg{width:32px;height:32px;fill:#fff;margin-left:6px}
.play-hint{font-size:12px;color:rgba(255,255,255,.6);letter-spacing:.5px}
.btns-wrap{width:100%;margin-top:22px;display:flex;flex-direction:column;gap:12px;opacity:0;pointer-events:none;transition:opacity .7s}
.btns-wrap.show{opacity:1;pointer-events:all}
.btn-main{width:100%;padding:20px 16px;border:none;border-radius:16px;background:${t.btn};color:#fff;font-family:'Anton',sans-serif;font-size:17px;letter-spacing:.5px;cursor:pointer;box-shadow:0 4px 28px ${t.bsh};-webkit-appearance:none;transition:transform .15s;display:block;text-align:center}
.btn-main:active{transform:scale(.97)}
.btn-subtle{display:block;text-align:center;font-size:13px;color:${t.mu};padding:10px;cursor:pointer;text-decoration:none;-webkit-tap-highlight-color:transparent}
.btn-subtle:active{opacity:.6}
@keyframes pulse{
  0%,100%{transform:scale(1);box-shadow:0 4px 30px ${t.bsh}}
  50%{transform:scale(1.1);box-shadow:0 6px 52px ${t.bsh},0 0 0 18px rgba(124,58,255,.08)}
}
</style>
</head>
<body>
<div class="pg">
  <p class="vid-label">ASSISTA O VÍDEO</p>
  <div class="vid-wrap">
    <video id="vid" playsinline webkit-playsinline preload="metadata" poster="">
      <source src="${VIDEO_URL}" type="video/mp4">
    </video>
    <div class="play-ov" id="playOv">
      <div class="play-btn">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </div>
      <span class="play-hint">▶ aperte aqui para assistir</span>
    </div>
  </div>
  <div class="btns-wrap" id="vslBtns">
    <button class="btn-main" id="btnCta">🚀 QUERO GANHAR DINHEIRO COM I.A</button>
    <a class="btn-subtle" href="/${page.slug}">Quero só os prompts</a>
  </div>
</div>
<script>
(function () {
  var SLUG = '${page.slug}';
  var CTA  = ${JSON.stringify(cta)};
  var vid     = document.getElementById('vid');
  var playOv  = document.getElementById('playOv');
  var btns    = document.getElementById('vslBtns');
  var shown   = false;

  function tryShow() {
    if (!shown) { shown = true; btns.classList.add('show'); }
  }

  playOv.addEventListener('click', function () {
    vid.play().then(function () {
      playOv.classList.add('gone');
    }).catch(function (e) { console.log(e); });
  });

  vid.addEventListener('timeupdate', function () {
    if (vid.currentTime >= 40) tryShow();
  });
  vid.addEventListener('ended', tryShow);

  document.getElementById('btnCta').addEventListener('click', function () {
    try { fetch('/api/btnclick/' + SLUG, { method: 'POST' }); } catch (e) {}
    if (CTA && CTA !== '#') window.location.href = CTA;
  });
})();
</script>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════════════
//  GALLERY PAGE
// ════════════════════════════════════════════════════════════════════════════
function galleryPage(pages, cfg) {
  const ctaUrl  = cfg.gallery_cta_url || '#';
  const showPop = cfg.gallery_popup !== false;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0f">
<title>Biblioteca de Prompts · IA Ultra Realista</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${GF}" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{overflow-x:hidden}
body{background:#0a0a0f;color:#f0eeff;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 40% at 20% 0,rgba(124,58,255,.12),transparent 55%),radial-gradient(ellipse 60% 35% at 80% 90%,rgba(255,58,173,.08),transparent 50%);pointer-events:none;z-index:0}
.top-banner{position:sticky;top:0;z-index:100;background:linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;box-shadow:0 2px 24px rgba(124,58,255,.4)}
.banner-text{font-size:12px;font-weight:500;color:#fff;line-height:1.45;flex:1}
.banner-text strong{font-family:'Anton',sans-serif;font-size:14px;letter-spacing:.3px}
.banner-btn{flex-shrink:0;background:#fff;color:#7c3aff;border:none;border-radius:10px;padding:11px 14px;font-family:'Anton',sans-serif;font-size:13px;letter-spacing:.5px;cursor:pointer;white-space:nowrap;-webkit-appearance:none;transition:transform .15s}
.banner-btn:active{transform:scale(.95)}
.inner{position:relative;z-index:1;max-width:560px;margin:0 auto;padding:20px 14px 60px}
.gal-head{text-align:center;margin-bottom:18px}
.gal-head h1{font-family:'Syne',sans-serif;font-size:20px;font-weight:900;color:#fff;margin-bottom:4px}
.gal-head p{font-size:13px;color:#9d9ab8}
.gal-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gal-card{background:rgba(255,255,255,.04);border:1px solid rgba(124,58,255,.2);border-radius:16px;overflow:hidden;cursor:pointer;display:block;text-decoration:none;transition:.15s;-webkit-tap-highlight-color:rgba(124,58,255,.15)}
.gal-card:active{transform:scale(.97);border-color:rgba(124,58,255,.5)}
.gal-card img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}
.gal-card-ph{width:100%;aspect-ratio:3/2;background:linear-gradient(135deg,rgba(124,58,255,.15),rgba(255,58,173,.1));display:flex;align-items:center;justify-content:center;font-size:28px}
.gal-card-body{padding:9px 11px 11px}
.gal-card-title{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#f0eeff;line-height:1.3}
.empty-state{text-align:center;padding:60px 20px;color:#9d9ab8}
.empty-state p:first-child{font-size:40px;margin-bottom:12px}

/* POPUP */
.pop-ov{position:fixed;inset:0;background:rgba(4,4,12,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .3s}
.pop-ov.show{opacity:1;pointer-events:all}
.gal-popup{background:#fff;border-radius:24px;padding:30px 22px 24px;max-width:370px;width:100%;position:relative;transform:scale(.9) translateY(20px);transition:transform .4s cubic-bezier(.34,1.4,.64,1)}
.pop-ov.show .gal-popup{transform:scale(1) translateY(0)}
.gal-popup::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#7c3aff,#ff3aad);border-radius:24px 24px 0 0}
.pop-lock{text-align:center;font-size:40px;margin-bottom:12px}
.pop-title{font-family:'Anton',sans-serif;font-size:20px;letter-spacing:.3px;color:#1a1a2e;text-align:center;margin-bottom:8px;line-height:1.15}
.pop-sub{font-size:13px;color:#555;text-align:center;line-height:1.65;margin-bottom:20px}
.pop-sub strong{color:#7c3aff}
.pop-btn{width:100%;padding:17px 16px;border:none;border-radius:13px;background:linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad);color:#fff;font-family:'Anton',sans-serif;font-size:15px;letter-spacing:.5px;cursor:pointer;-webkit-appearance:none;margin-bottom:10px;transition:transform .15s;display:block;text-align:center}
.pop-btn:active{transform:scale(.97)}
.pop-skip{display:block;text-align:center;font-size:12px;color:#bbb;cursor:pointer;padding:6px;-webkit-user-select:none;user-select:none}
.pop-skip:active{color:#999}
</style>
</head>
<body>

<div class="top-banner">
  <div class="banner-text">Desbloqueie agora mais de <strong>120 Prompts Ultra Realistas</strong> por R$19,90</div>
  <button class="banner-btn" onclick="goUnlock()">DESBLOQUEAR</button>
</div>

<div class="inner">
  <div class="gal-head">
    <h1>Biblioteca de Prompts</h1>
    <p>Clique em qualquer prompt e use gratuitamente</p>
  </div>
  ${pages.length === 0
    ? `<div class="empty-state"><p>🖼</p><p>Nenhum prompt publicado ainda.</p></div>`
    : `<div class="gal-grid">${pages.map(p => {
        const imgs = JSON.parse(p.images || '[]');
        const img  = imgs[0];
        return `<a class="gal-card" href="/${p.slug}">
          ${img ? `<img src="${img}" alt="" loading="lazy">` : `<div class="gal-card-ph">✨</div>`}
          <div class="gal-card-body"><div class="gal-card-title">${p.title}</div></div>
        </a>`;
      }).join('')}</div>`
  }
</div>

${showPop ? `
<div class="pop-ov" id="galPop">
  <div class="gal-popup">
    <div class="pop-lock">🔐</div>
    <div class="pop-title">Você está a 1 passo de 120+ prompts exclusivos</div>
    <div class="pop-sub">Esses prompts transformam qualquer foto comum em resultado de estúdio profissional. Hoje por apenas <strong>R$19,90</strong> — acesso imediato, sem mensalidade.</div>
    <button class="pop-btn" onclick="goUnlock()">QUERO ACESSAR POR R$19,90</button>
    <span class="pop-skip" id="popSkip">Continuar navegando grátis</span>
  </div>
</div>` : ''}

<script>
var CTA_URL = ${JSON.stringify(ctaUrl)};
function goUnlock() { if (CTA_URL && CTA_URL !== '#') window.location.href = CTA_URL; }

${showPop ? `
(function () {
  if (localStorage.getItem('gal_dismissed')) return;
  var pop = document.getElementById('galPop');
  setTimeout(function () { pop.classList.add('show'); }, 4000);
  document.getElementById('popSkip').addEventListener('click', function () {
    pop.classList.remove('show');
    localStorage.setItem('gal_dismissed', '1');
  });
  pop.addEventListener('click', function (e) {
    if (e.target === pop) {
      pop.classList.remove('show');
      localStorage.setItem('gal_dismissed', '1');
    }
  });
})();` : ''}
</script>
</body></html>`;
}
