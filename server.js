const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const initSql = require('sql.js');

const app  = express();
const PORT = process.env.PORT || 3000;
const PIN  = process.env.ADMIN_PIN || '8203';
const DB_PATH = path.join(__dirname, 'db', 'data.json');
const VIDEO_URL = 'https://e-volutionn.com/wp-content/uploads/2026/04/WhatsApp-Video-2026-04-03-at-22.21.37.mp4';
const GALLERY_CTA = process.env.GALLERY_CTA_URL || '#';

let db;
async function initDB() {
  const SQL = await initSql();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS pages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    slug       TEXT UNIQUE NOT NULL,
    prompt     TEXT NOT NULL,
    cta_url    TEXT NOT NULL DEFAULT '',
    subtitle   TEXT NOT NULL DEFAULT '',
    images     TEXT NOT NULL DEFAULT '[]',
    template   TEXT NOT NULL DEFAULT 'dark',
    clicks     INTEGER NOT NULL DEFAULT 0,
    cta_clicks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // safe migrations for existing installs
  ['cta_url TEXT NOT NULL DEFAULT ""',
   'subtitle TEXT NOT NULL DEFAULT ""',
   'clicks INTEGER NOT NULL DEFAULT 0',
   'cta_clicks INTEGER NOT NULL DEFAULT 0'
  ].forEach(col => { try { db.run(`ALTER TABLE pages ADD COLUMN ${col}`); } catch(e){} });
  // migrate old vsl_url → cta_url
  try { db.run(`UPDATE pages SET cta_url=vsl_url WHERE (cta_url IS NULL OR cta_url='') AND vsl_url IS NOT NULL AND vsl_url!=''`); } catch(e){}
  saveDB();
}

function saveDB() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
function qAll(sql, p=[]) {
  const r = db.exec(sql, p);
  if (!r.length) return [];
  return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c,i) => [c, row[i]])));
}
function qOne(sql, p=[]) { return qAll(sql, p)[0] || null; }

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const d = path.join(__dirname, 'uploads');
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      cb(null, d);
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

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => res.send(loginPage()));
app.post('/admin/login', (req, res) => {
  if (req.body.pin === PIN) { req.session.auth = true; return res.redirect('/admin'); }
  res.send(loginPage('PIN incorreto'));
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────
app.get('/admin', auth, (req, res) => {
  const pages = qAll(`SELECT * FROM pages ORDER BY created_at DESC`);
  res.send(dashPage(pages));
});

// ── PAGES CRUD ────────────────────────────────────────────────────────────────
app.get('/admin/pages/new', auth, (req, res) => res.send(formPage(null)));
app.get('/admin/pages/:id/edit', auth, (req, res) => {
  const p = qOne('SELECT * FROM pages WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin');
  res.send(formPage(p));
});
app.post('/admin/pages', auth, upload.array('images', 10), (req, res) => {
  const { title, prompt, cta_url, template, subtitle } = req.body;
  const slugify = require('slugify');
  let slug = slugify(title, { lower: true, strict: true });
  if (qOne('SELECT id FROM pages WHERE slug=?', [slug])) slug += '-' + Date.now();
  const images = (req.files || []).map(f => '/uploads/' + f.filename);
  db.run('INSERT INTO pages (title,slug,prompt,cta_url,subtitle,images,template) VALUES (?,?,?,?,?,?,?)',
    [title, slug, prompt, cta_url || '', subtitle || '', JSON.stringify(images), template || 'dark']);
  saveDB(); res.redirect('/admin');
});
app.post('/admin/pages/:id/update', auth, upload.array('images', 10), (req, res) => {
  const { title, prompt, cta_url, template, subtitle, keep_images } = req.body;
  const p = qOne('SELECT * FROM pages WHERE id=?', [req.params.id]);
  if (!p) return res.redirect('/admin');
  const kept = keep_images === 'on' ? JSON.parse(p.images) : [];
  const imgs = [...kept, ...(req.files || []).map(f => '/uploads/' + f.filename)];
  db.run('UPDATE pages SET title=?,prompt=?,cta_url=?,subtitle=?,images=?,template=? WHERE id=?',
    [title, prompt, cta_url || '', subtitle || '', JSON.stringify(imgs), template || 'dark', req.params.id]);
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
  db.run('INSERT INTO pages (title,slug,prompt,cta_url,subtitle,images,template) VALUES (?,?,?,?,?,?,?)',
    [p.title + ' (cópia)', slug, p.prompt, p.cta_url, p.subtitle, p.images, p.template]);
  saveDB(); res.redirect('/admin');
});

// ── API ───────────────────────────────────────────────────────────────────────
app.post('/api/click/:slug', (req, res) => {
  db.run('UPDATE pages SET clicks=clicks+1 WHERE slug=?', [req.params.slug]);
  saveDB(); res.json({ ok: true });
});
app.post('/api/cta/:slug', (req, res) => {
  db.run('UPDATE pages SET cta_clicks=cta_clicks+1 WHERE slug=?', [req.params.slug]);
  saveDB(); res.json({ ok: true });
});

// ── PUBLIC ROUTES ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/prompts'));
app.get('/prompts', (req, res) => {
  const pages = qAll(`SELECT * FROM pages ORDER BY created_at DESC`);
  res.send(galleryPage(pages));
});
app.get('/video/:slug', (req, res) => {
  const p = qOne('SELECT * FROM pages WHERE slug=?', [req.params.slug]);
  if (!p) return res.redirect('/prompts');
  res.send(videoPage(p));
});
app.get('/:slug', (req, res) => {
  if (req.params.slug === 'admin') return res.redirect('/admin');
  const p = qOne('SELECT * FROM pages WHERE slug=?', [req.params.slug]);
  if (!p) return res.status(404).send(notFoundPage());
  res.send(publicPage(p));
});

initDB().then(() => app.listen(PORT, () => console.log(`✅ Direct Isca rodando em http://localhost:${PORT}`)));

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HEAD + ADMIN CSS
// ═══════════════════════════════════════════════════════════════════════════════

const HEAD = (title) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
`;

const ADMIN_CSS = `<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#07070f;--s1:#0f0f1c;--s2:#161626;--s3:#1c1c30;
  --b1:rgba(255,255,255,0.07);--b2:rgba(255,255,255,0.13);
  --ac:#7c3aff;--ac2:#ff3aad;--ac3:#3affe0;
  --tx:#f0eeff;--mu:#6b6888;--mu2:#9d9ab8;
  --ok:#22d3a0;--warn:#f59e0b;--err:#f43f5e;
}
html,body{height:100%}
body{background:var(--bg);color:var(--tx);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 60% 40% at 10% 0,rgba(124,58,255,.1),transparent 55%),radial-gradient(ellipse 40% 30% at 90% 95%,rgba(255,58,173,.07),transparent 50%);pointer-events:none;z-index:0}
a{text-decoration:none;color:inherit}
.nav{position:sticky;top:0;z-index:100;height:54px;background:rgba(7,7,15,.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:12px}
.nav-brand{display:flex;align-items:center;gap:8px;flex-shrink:0}
.nav-icon{font-size:20px}
.nav-name{font-family:'Syne',sans-serif;font-weight:800;font-size:17px;background:linear-gradient(135deg,#fff,#c4b5fd,#f9a8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.3px}
.nav-links{display:flex;gap:2px}
.nav-a{padding:5px 12px;border-radius:8px;font-size:13px;font-weight:500;color:var(--mu2);transition:.15s}
.nav-a:hover{color:var(--tx);background:rgba(255,255,255,.05)}
.nav-a.on{color:#fff;background:rgba(124,58,255,.22)}
.nav-out{font-size:12px;color:var(--mu);padding:5px 10px;border-radius:8px;transition:.15s}
.nav-out:hover{color:var(--mu2)}
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:24px 20px 80px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 18px;border-radius:10px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:.15s;text-decoration:none;white-space:nowrap;-webkit-appearance:none}
.btn:active{transform:scale(.97)}
.btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
.btn-p{background:linear-gradient(135deg,var(--ac),var(--ac2));color:#fff;box-shadow:0 2px 14px rgba(124,58,255,.3)}
.btn-p:hover{box-shadow:0 4px 22px rgba(124,58,255,.45);transform:translateY(-1px)}
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
.stat{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:18px 20px;position:relative;overflow:hidden}
.stat::after{content:'';position:absolute;top:0;left:0;right:0;height:2px;border-radius:2px}
.stat.s-pu::after{background:linear-gradient(90deg,var(--ac),var(--ac2))}
.stat.s-tl::after{background:linear-gradient(90deg,var(--ac3),#0ef)}
.stat.s-pk::after{background:linear-gradient(90deg,var(--ac2),#ff8c69)}
.stat-n{font-family:'Syne',sans-serif;font-size:30px;font-weight:800;color:#fff;line-height:1}
.stat-l{font-size:12px;color:var(--mu);margin-top:5px}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.pcard{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:18px;transition:.15s;position:relative;overflow:hidden}
.pcard::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(124,58,255,.35),transparent)}
.pcard:hover{border-color:var(--b2)}
.pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.pc-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#fff;line-height:1.2}
.pc-slug{font-size:11px;color:var(--mu);margin-top:3px;font-family:monospace}
.pc-thumb{width:46px;height:46px;border-radius:9px;object-fit:cover;border:1px solid var(--b1);flex-shrink:0}
.pc-thumb-ph{width:46px;height:46px;border-radius:9px;background:var(--s3);border:1px solid var(--b1);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.pc-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.pc-m{background:var(--s3);border-radius:8px;padding:8px 10px;text-align:center}
.pc-mn{font-family:'Syne',sans-serif;font-size:20px;font-weight:700;line-height:1}
.pc-ml{font-size:10px;color:var(--mu);margin-top:2px}
.pc-m.cl .pc-mn{color:var(--ac3)}
.pc-m.ct .pc-mn{color:var(--ac2)}
.pc-foot{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.pc-date{font-size:11px;color:var(--mu)}
.tpl-dot{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:600}
.pc-actions{display:flex;gap:6px;flex-wrap:wrap}
.card{background:var(--s1);border:1px solid var(--b1);border-radius:16px}
.sh{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.sh-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:#fff}
.sh-sub{font-size:13px;color:var(--mu2);margin-top:2px}
.empty{text-align:center;padding:60px 20px}
.badge{display:inline-flex;padding:2px 9px;border-radius:100px;font-size:11px;font-weight:600}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(16px);background:var(--s2);border:1px solid rgba(58,255,224,.3);border-radius:12px;padding:11px 20px;font-size:13px;color:var(--ac3);font-weight:500;z-index:999;opacity:0;transition:.3s;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.4)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.form-wrap{max-width:660px;margin:0 auto}
.fs{margin-bottom:26px}
.fs-title{font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--mu);margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid var(--b1)}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.tpl-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.tpl-opt{border:2px solid var(--b1);border-radius:14px;padding:13px;cursor:pointer;transition:.15s}
.tpl-opt input{display:none}
.tpl-opt.sel{border-color:var(--ac);background:rgba(124,58,255,.08)}
.swatches{display:flex;gap:4px;margin-bottom:7px}
.sw{width:14px;height:14px;border-radius:50%}
.tpl-name{font-size:13px;font-weight:600;color:#fff;margin-bottom:2px}
.tpl-desc{font-size:11px;color:var(--mu);line-height:1.4}
.dropz{border:2px dashed var(--b1);border-radius:12px;padding:26px;text-align:center;cursor:pointer;transition:.15s;position:relative}
.dropz:hover{border-color:rgba(124,58,255,.5);background:rgba(124,58,255,.04)}
.dropz input{position:absolute;inset:0;opacity:0;cursor:pointer}
.prev-wrap{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.prev-img{width:66px;height:66px;border-radius:8px;object-fit:cover;border:1px solid var(--b1)}
.info-box{background:rgba(124,58,255,.08);border:1px solid rgba(124,58,255,.2);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--mu2);line-height:1.6;margin-bottom:16px}
.info-box strong{color:var(--ac2)}
@media(max-width:600px){
  .nav{padding:0 14px}
  .wrap{padding:16px 14px 60px}
  .stats{grid-template-columns:1fr 1fr}
  .stats .stat:last-child{grid-column:span 2}
  .pgrid{grid-template-columns:1fr}
  .g2{grid-template-columns:1fr}
  .sh{flex-direction:column;align-items:flex-start}
  .sh .btn{width:100%;justify-content:center}
}
@media(max-width:360px){
  .stats{grid-template-columns:1fr}
  .stats .stat:last-child{grid-column:auto}
}
</style>`;

// ── NAV ──
function nav(active) {
  return `<nav class="nav">
    <div class="nav-brand">
      <span class="nav-icon">🎁</span>
      <span class="nav-name">Direct Isca</span>
    </div>
    <div class="nav-links">
      <a href="/admin" class="nav-a${active === 'p' ? ' on' : ''}">Páginas</a>
      <a href="/prompts" target="_blank" class="nav-a" style="background:rgba(124,58,255,.15);color:#a78bfa;border:1px solid rgba(124,58,255,.25);border-radius:8px">🗂 Ver Galeria</a>
    </div>
    <a href="/admin/logout" class="nav-out">Sair</a>
  </nav>`;
}

// ── LOGIN ──
function loginPage(err) {
  return HEAD('Direct Isca · Login') + ADMIN_CSS + `
  <style>
    body{display:flex;align-items:center;justify-content:center;min-height:100vh}
    .box{width:100%;max-width:340px;padding:20px}
    .logo-wrap{display:flex;align-items:center;gap:10px;margin-bottom:4px}
    .logo-icon{font-size:28px}
    .logo-txt{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;background:linear-gradient(135deg,#fff,#c4b5fd,#f9a8d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .sub{font-size:13px;color:var(--mu);margin-bottom:28px}
    .err{background:rgba(244,63,94,.1);border:1px solid rgba(244,63,94,.25);border-radius:10px;padding:10px 14px;color:#fca5a5;font-size:13px;margin-bottom:16px}
    .pin-in{text-align:center;font-size:22px;font-weight:700;letter-spacing:8px;font-family:'Syne',sans-serif}
  </style></head><body>
  <div class="box">
    <div class="logo-wrap"><span class="logo-icon">🎁</span><span class="logo-txt">Direct Isca</span></div>
    <p class="sub">Painel de gerenciamento</p>
    ${err ? `<div class="err">${err}</div>` : ''}
    <form method="POST" action="/admin/login">
      <div class="field"><label>PIN de acesso</label><input class="pin-in" type="password" name="pin" maxlength="8" autofocus autocomplete="off" placeholder="••••"></div>
      <button type="submit" class="btn btn-p" style="width:100%;padding:14px;font-size:14px">Entrar</button>
    </form>
  </div></body></html>`;
}

// ── DASHBOARD ──
const TPL_META = {
  dark:   { label: 'Dark Violet', colors: ['#7c3aff', '#ff3aad', '#0a0a0f'] },
  neon:   { label: 'Neon Cyber',  colors: ['#3affe0', '#0ef', '#020f0e'] },
  fire:   { label: 'Fire Gold',   colors: ['#ff6b35', '#ffd700', '#0f0800'] },
  brasil: { label: 'Brasil',      colors: ['#009c3b', '#ffdf00', '#002776'] },
};

function dashPage(pages) {
  const totalClicks  = pages.reduce((a, p) => a + (p.clicks || 0), 0);
  const totalCta     = pages.reduce((a, p) => a + (p.cta_clicks || 0), 0);
  return HEAD('Direct Isca · Painel') + ADMIN_CSS + `</head><body>
  ${nav('p')}
  <div class="wrap">
    <div class="stats">
      <div class="stat s-pu"><div class="stat-n">${pages.length}</div><div class="stat-l">Páginas criadas</div></div>
      <div class="stat s-tl"><div class="stat-n">${totalClicks}</div><div class="stat-l">Acessos totais</div></div>
      <div class="stat s-pk"><div class="stat-n">${totalCta}</div><div class="stat-l">Cliques no CTA</div></div>
    </div>
    <div class="sh">
      <div><div class="sh-title">Suas páginas</div><div class="sh-sub">${pages.length} página${pages.length !== 1 ? 's' : ''}</div></div>
      <a href="/admin/pages/new" class="btn btn-p">+ Nova página</a>
    </div>
    ${pages.length === 0
      ? `<div class="card empty"><p style="font-size:32px;margin-bottom:10px">📄</p><p style="color:var(--mu2);margin-bottom:16px">Nenhuma página ainda.</p><a href="/admin/pages/new" class="btn btn-p">Criar primeira página</a></div>`
      : `<div class="pgrid">
      ${pages.map(p => {
        const imgs = JSON.parse(p.images || '[]');
        const tpl  = TPL_META[p.template] || TPL_META.dark;
        const date = new Date(p.created_at).toLocaleDateString('pt-BR');
        const conv = p.clicks > 0 ? ((p.cta_clicks / p.clicks) * 100).toFixed(1) + '%' : '—';
        return `<div class="pcard">
          <div class="pc-top">
            <div><div class="pc-title">${p.title}</div><div class="pc-slug">/${p.slug}</div></div>
            ${imgs[0] ? `<img src="${imgs[0]}" class="pc-thumb">` : `<div class="pc-thumb-ph">🖼</div>`}
          </div>
          <div class="pc-metrics">
            <div class="pc-m cl"><div class="pc-mn">${p.clicks || 0}</div><div class="pc-ml">acessos</div></div>
            <div class="pc-m ct"><div class="pc-mn">${p.cta_clicks || 0}</div><div class="pc-ml">cliques CTA</div></div>
          </div>
          <div class="pc-foot">
            <div class="tpl-dot" style="background:${tpl.colors[0]}22;border:1px solid ${tpl.colors[0]}44;color:${tpl.colors[0]}">
              <span style="width:6px;height:6px;border-radius:50%;background:${tpl.colors[0]};display:inline-block"></span>${tpl.label}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
              <div class="pc-date">${date}</div>
              <div style="font-size:10px;color:var(--mu)">conv. ${conv}</div>
            </div>
          </div>
          <div class="pc-actions">
            <button class="btn btn-sm btn-tl" onclick="cpLink('${p.slug}')">Copiar link</button>
            <a href="/${p.slug}" target="_blank" class="btn btn-sm btn-g">Ver</a>
            <a href="/admin/pages/${p.id}/edit" class="btn btn-sm btn-g">Editar</a>
            <form method="POST" action="/admin/pages/${p.id}/duplicate" style="display:inline">
              <button type="submit" class="btn btn-sm btn-yw">Duplicar</button>
            </form>
            <form method="POST" action="/admin/pages/${p.id}/delete" style="display:inline" onsubmit="return confirm('Deletar página?')">
              <button type="submit" class="btn btn-sm btn-rd">Del</button>
            </form>
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>
  <div class="toast" id="toast">Link copiado!</div>
  <script>
    function cpLink(slug){
      navigator.clipboard.writeText(location.origin+'/'+slug).catch(()=>{});
      var t=document.getElementById('toast');
      t.classList.add('show');
      setTimeout(function(){t.classList.remove('show')},2200);
    }
  </script>
  </body></html>`;
}

// ── FORM ──
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
  return HEAD((isEdit ? 'Editar' : 'Nova') + ' Página · Direct Isca') + ADMIN_CSS + `</head><body>
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
          <div class="field"><label>Título *</label><input type="text" name="title" value="${isEdit ? page.title : ''}" required placeholder="Ex: Prompt 8K Ultra"></div>
          <div class="field"><label>Subtítulo</label><input type="text" name="subtitle" value="${isEdit ? page.subtitle : ''}" placeholder="Cole no Gemini com sua foto e veja a IA..."></div>
        </div>
        <div class="field"><label>Prompt (texto que o cliente copia) *</label><textarea name="prompt" required>${isEdit ? page.prompt : ''}</textarea></div>
        <div class="info-box">
          <strong>Link do botão "QUERO GANHAR DINHEIRO COM I.A"</strong> — aparece na página de vídeo após 40 segundos. Coloque a URL do seu produto, grupo ou checkout.
        </div>
        <div class="field"><label>Link do CTA principal</label><input type="url" name="cta_url" value="${isEdit ? page.cta_url : ''}" placeholder="https://..."></div>
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
        <div class="fs-title">Imagens (1 = fixa · 2+ = carrossel)</div>
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
        <button type="submit" class="btn btn-p">${isEdit ? 'Salvar' : 'Criar página'}</button>
      </div>
    </form>
  </div></div>
  <script>
    function selT(el){document.querySelectorAll('.tpl-opt').forEach(function(e){e.classList.remove('sel')});el.classList.add('sel')}
    function prevF(input){var g=document.getElementById('pv');g.innerHTML='';Array.from(input.files).forEach(function(f){var i=document.createElement('img');i.className='prev-img';i.src=URL.createObjectURL(f);g.appendChild(i)})}
  </script>
  </body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC PAGE — mobile-first
// ═══════════════════════════════════════════════════════════════════════════════
function publicPage(page) {
  const images  = JSON.parse(page.images || '[]');
  const multi   = images.length > 1;
  const single  = images.length === 1;
  const subtitle = (page.subtitle && page.subtitle.trim())
    ? page.subtitle
    : 'Cole esse prompt no Gemini com qualquer foto sua e veja a IA transformar em segundos — tenha esse resultado:';

  const T = {
    dark:   { bg:'#0a0a0f',bg2:'#12121a',g1:'rgba(124,58,255,.18)',g2:'rgba(255,58,173,.12)',g3:'rgba(58,255,224,.06)',a1:'#7c3aff',a2:'#ff3aad',a3:'#3affe0',btn:'linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad)',bsh:'rgba(124,58,255,.45)',pbtn:'linear-gradient(135deg,#ff3aad,#7c3aff)',bb:'rgba(124,58,255,.2)',bbd:'rgba(124,58,255,.35)',bbt:'#a78bfa',cb:'rgba(124,58,255,.2)',cg:'rgba(124,58,255,.12)',tx:'#f0eeff',mu:'#9d9ab8' },
    neon:   { bg:'#020f0e',bg2:'#041512',g1:'rgba(58,255,224,.15)',g2:'rgba(0,238,255,.1)',g3:'rgba(124,58,255,.05)',a1:'#3affe0',a2:'#00eeff',a3:'#7c3aff',btn:'linear-gradient(135deg,#3affe0,#00c8d4,#0099ff)',bsh:'rgba(58,255,224,.35)',pbtn:'linear-gradient(135deg,#00eeff,#3affe0)',bb:'rgba(58,255,224,.12)',bbd:'rgba(58,255,224,.3)',bbt:'#3affe0',cb:'rgba(58,255,224,.2)',cg:'rgba(58,255,224,.08)',tx:'#e0fffc',mu:'#7ab8b2' },
    fire:   { bg:'#0f0800',bg2:'#1a0f02',g1:'rgba(255,107,53,.18)',g2:'rgba(255,215,0,.1)',g3:'rgba(255,50,50,.06)',a1:'#ff6b35',a2:'#ffd700',a3:'#ffaa00',btn:'linear-gradient(135deg,#ff6b35,#ff3a00,#ffd700)',bsh:'rgba(255,107,53,.45)',pbtn:'linear-gradient(135deg,#ffd700,#ff6b35)',bb:'rgba(255,107,53,.15)',bbd:'rgba(255,107,53,.3)',bbt:'#ffd700',cb:'rgba(255,107,53,.2)',cg:'rgba(255,107,53,.08)',tx:'#fff5e0',mu:'#b8956a' },
    brasil: { bg:'#011a0a',bg2:'#02250e',g1:'rgba(0,156,59,.2)',g2:'rgba(255,223,0,.1)',g3:'rgba(0,39,118,.1)',a1:'#00c04b',a2:'#ffdf00',a3:'#4da6ff',btn:'linear-gradient(135deg,#009c3b,#00c04b,#ffdf00)',bsh:'rgba(0,192,75,.4)',pbtn:'linear-gradient(135deg,#ffdf00,#009c3b)',bb:'rgba(0,156,59,.15)',bbd:'rgba(0,156,59,.35)',bbt:'#4ade80',cb:'rgba(0,156,59,.2)',cg:'rgba(0,156,59,.1)',tx:'#f0fff4',mu:'#6b9e7a' },
  };
  const t = T[page.template] || T.dark;

  const carouselItems = multi
    ? [...images, ...images].map(src => `<img src="${src}" alt="" loading="eager">`).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<meta name="theme-color" content="${t.bg}">
<title>${page.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Syne:wght@700;800;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{overflow-x:hidden}
body{background:${t.bg};color:${t.tx};font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 90% 50% at 10% 5%,${t.g1},transparent 55%),radial-gradient(ellipse 70% 45% at 90% 85%,${t.g2},transparent 50%),radial-gradient(ellipse 60% 40% at 50% 50%,${t.g3},transparent 55%);pointer-events:none;z-index:0}
.pg{position:relative;z-index:1;width:100%;max-width:480px;margin:0 auto;padding-bottom:60px}
.badge-row{display:flex;justify-content:center;padding:24px 20px 0}
.badge-inner{background:${t.bb};border:1px solid ${t.bbd};border-radius:100px;padding:5px 16px;font-size:10px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:${t.bbt}}
.hl{padding:18px 20px 0;text-align:center}
.hl h1{font-family:'Syne',sans-serif;font-size:clamp(28px,8.5vw,42px);font-weight:900;line-height:1.06;letter-spacing:-1px;background:linear-gradient(140deg,#fff 0%,${t.a1} 45%,${t.a2} 80%,${t.a3} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hl .sub{margin:12px auto 0;font-size:14px;line-height:1.7;color:${t.mu};max-width:340px}
.img-sec{margin:22px 14px 0;border-radius:20px;overflow:hidden;border:1px solid ${t.cb};box-shadow:0 4px 40px rgba(0,0,0,.5),0 0 60px ${t.cg}}
.img-sec img.solo{width:100%;display:block;object-fit:cover;max-height:380px}
.car-outer{width:100%;overflow:hidden}
.car-track{display:flex;gap:10px;padding:6px;animation:carscroll 22s linear infinite}
.car-track img{height:260px;width:auto;flex-shrink:0;border-radius:14px;object-fit:cover;display:block}
.cta{margin:20px 14px 0}
.btn-copy{width:100%;padding:20px 24px;border:none;border-radius:18px;background:${t.btn};color:#fff;font-family:'Anton',sans-serif;font-size:18px;letter-spacing:.5px;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 4px 28px ${t.bsh},inset 0 0 0 1px rgba(255,255,255,.1);-webkit-appearance:none;touch-action:manipulation;transition:transform .15s}
.btn-copy:active{transform:scale(.97)}
.btn-copy::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:shimmer 2.5s ease-in-out infinite}
.copy-ok{text-align:center;margin-top:10px;font-size:13px;color:${t.a3};height:18px;opacity:0;transition:opacity .25s}
.copy-ok.show{opacity:1}

/* ─── OVERLAY ─── */
.ov{position:fixed;inset:0;background:rgba(4,4,12,.85);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .3s ease}
.ov.show{opacity:1;pointer-events:all}

/* ─── POPUP ─── */
.popup{width:100%;max-width:420px;background:#fff;border-radius:28px;padding:32px 24px 28px;position:relative;overflow:hidden;transform:scale(.92) translateY(16px);transition:transform .4s cubic-bezier(.34,1.5,.64,1);box-shadow:0 30px 80px rgba(0,0,0,.6)}
.ov.show .popup{transform:scale(1) translateY(0)}
.popup::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,${t.a1},${t.a2})}

/* ─── GIFT BOX ANIMATION ─── */
.gift-scene{display:flex;flex-direction:column;align-items:center;margin-bottom:18px}
.gift-wrap{width:90px;height:100px;position:relative;margin:0 auto 6px}
.g-glow{position:absolute;inset:-12px;background:radial-gradient(circle,${t.a1}33,transparent 70%);border-radius:50%;animation:glow-pulse 1.6s ease-in-out infinite}
.g-body{position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:76px;height:56px;background:${t.pbtn};border-radius:5px 5px 10px 10px;overflow:hidden;box-shadow:0 8px 24px ${t.bsh}}
.g-body-riv{position:absolute;left:50%;transform:translateX(-50%);top:0;bottom:0;width:14px;background:rgba(255,255,255,.3)}
.g-lid{position:absolute;top:0;left:50%;transform:translateX(calc(-50% - 0px));width:84px;height:26px;background:${t.btn};border-radius:6px;display:flex;align-items:center;justify-content:center;z-index:2;transform-origin:center bottom;animation:lid-lift 1.6s ease-in-out infinite}
.g-lid-rib{width:15px;height:100%;background:rgba(255,255,255,.3);border-radius:3px}
.g-bow{position:absolute;top:-10px;left:50%;transform:translateX(-50%);width:32px;height:16px}
.g-bow::before,.g-bow::after{content:'';position:absolute;width:14px;height:14px;border-radius:50% 50% 0 50%;background:rgba(255,255,255,.5);top:0}
.g-bow::before{left:0;transform:rotate(-45deg)}
.g-bow::after{right:0;transform:rotate(45deg) scaleX(-1)}

/* ─── POPUP TEXTS ─── */
.pop-title{font-family:'Anton',sans-serif;font-size:22px;letter-spacing:.3px;color:#1a1a2e;text-align:center;line-height:1.15;margin-bottom:8px}
.pop-sub{font-size:14px;color:#666;text-align:center;line-height:1.65;margin-bottom:22px}
.btn-unlock{width:100%;padding:18px;border:none;border-radius:15px;background:${t.pbtn};color:#fff;font-family:'Anton',sans-serif;font-size:17px;letter-spacing:.5px;cursor:pointer;box-shadow:0 4px 24px ${t.bsh};-webkit-appearance:none;touch-action:manipulation;transition:transform .15s}
.btn-unlock:active{transform:scale(.97)}
.pop-close{display:block;text-align:center;margin-top:14px;font-size:12px;color:#bbb;cursor:pointer;padding:6px;-webkit-tap-highlight-color:transparent}
.pop-close:hover{color:#999}

/* ─── PARTICLES ─── */
.pts{position:fixed;inset:0;pointer-events:none;z-index:199;overflow:hidden;opacity:0;transition:opacity .3s}
.pts.show{opacity:1}
.pt{position:absolute;border-radius:50%;animation:ptfall linear forwards}

/* ─── ANIMS ─── */
@keyframes lid-lift{0%,100%{transform:translateX(-50%) translateY(0) rotate(0deg)}30%{transform:translateX(-50%) translateY(-18px) rotate(-12deg)}60%{transform:translateX(-50%) translateY(-18px) rotate(12deg)}85%{transform:translateX(-50%) translateY(-6px) rotate(0deg)}}
@keyframes glow-pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}
@keyframes carscroll{0%{transform:translateX(0)}100%{transform:translateX(var(--dist,0px))}}
@keyframes shimmer{0%{left:-100%}100%{left:200%}}
@keyframes ptfall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(360deg);opacity:0}}
@keyframes fup{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="pg">
  <div class="badge-row"><div class="badge-inner">Exclusivo</div></div>

  <div class="hl" style="animation:fup .5s .05s ease both;opacity:0">
    <h1>${page.title}</h1>
    <p class="sub">${subtitle}</p>
  </div>

  <div class="img-sec" style="animation:fup .5s .12s ease both;opacity:0">
    ${single ? `<img class="solo" src="${images[0]}" alt="">` : ''}
    ${multi  ? `<div class="car-outer"><div class="car-track" id="carTrack">${carouselItems}</div></div>` : ''}
  </div>

  <div class="cta" style="animation:fup .5s .2s ease both;opacity:0">
    <button class="btn-copy" id="btnCopy">CLIQUE AQUI PARA COPIAR PROMPT</button>
    <div class="copy-ok" id="copyOk">✓ Prompt copiado!</div>
  </div>
</div>

<div class="pts" id="pts"></div>

<div class="ov" id="ov">
  <div class="popup">
    <div class="gift-scene">
      <div class="gift-wrap">
        <div class="g-glow"></div>
        <div class="g-lid">
          <div class="g-lid-rib"></div>
          <div class="g-bow"></div>
        </div>
        <div class="g-body"><div class="g-body-riv"></div></div>
      </div>
    </div>
    <div class="pop-title">Parabéns, você ganhou<br>um bônus surpresa!</div>
    <p class="pop-sub">O prompt que prometi já está garantido, mas se deseja destravar o presente misterioso, clique no botão abaixo.</p>
    <button class="btn-unlock" id="btnUnlock">DESBLOQUEAR BÔNUS</button>
    <span class="pop-close" id="btnClose">Não, obrigado</span>
  </div>
</div>

<script>
(function(){
  var PROMPT = ${JSON.stringify(page.prompt)};
  var SLUG   = ${JSON.stringify(page.slug)};
  var A1='${t.a1}',A2='${t.a2}',A3='${t.a3}';

  // ── CAROUSEL ──
  ${multi ? `
  var track = document.getElementById('carTrack');
  function setupCar(){
    var imgs = track.querySelectorAll('img');
    var half = imgs.length/2, w=0;
    for(var i=0;i<half;i++) w += imgs[i].offsetWidth+10;
    if(w<10){setTimeout(setupCar,300);return}
    track.style.setProperty('--dist','-'+w+'px');
    track.style.width=(w*2)+'px';
  }
  var imgs=track.querySelectorAll('img'),loaded=0;
  function onL(){loaded++;if(loaded>=imgs.length)setupCar();}
  for(var i=0;i<imgs.length;i++){if(imgs[i].complete)onL();else imgs[i].addEventListener('load',onL);}
  setTimeout(setupCar,1500);` : ''}

  // ── PAGE ACCESS TRACKING ──
  try{fetch('/api/click/'+SLUG,{method:'POST'});}catch(e){}

  // ── COPY + POPUP ──
  var ov    = document.getElementById('ov');
  var popupShown = false;

  document.getElementById('btnCopy').addEventListener('click', function(){
    // Copy the prompt
    function doShow(){
      var el=document.getElementById('copyOk');
      el.classList.add('show');
      setTimeout(function(){el.classList.remove('show');},2500);
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(PROMPT).then(doShow).catch(fallback);
    } else { fallback(); }
    function fallback(){
      var ta=document.createElement('textarea');
      ta.value=PROMPT;ta.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta);ta.focus();ta.select();
      try{document.execCommand('copy');}catch(e){}
      ta.remove();doShow();
    }
    // Open popup only if user hasn't dismissed it
    if(!sessionStorage.getItem('noPopup')&&!popupShown){
      popupShown=true;
      spawnPts();
      ov.classList.add('show');
    }
  });

  // ── POPUP CLOSE (Não obrigado) ──
  document.getElementById('btnClose').addEventListener('click', function(){
    ov.classList.remove('show');
    sessionStorage.setItem('noPopup','1'); // won't show again this session
  });

  // ── POPUP UNLOCK → video page ──
  document.getElementById('btnUnlock').addEventListener('click', function(){
    window.location.href='/video/'+SLUG;
  });

  // ── PARTICLES ──
  function spawnPts(){
    var c=document.getElementById('pts');
    var cols=[A1,A2,A3,'#ffd700','#fff'];
    c.innerHTML='';
    c.classList.add('show');
    for(var i=0;i<50;i++){
      var p=document.createElement('div');
      p.className='pt';
      var sz=4+Math.random()*7;
      p.style.left=(Math.random()*100)+'%';
      p.style.top=(-10-Math.random()*20)+'px';
      p.style.background=cols[Math.floor(Math.random()*5)];
      p.style.width=sz+'px';p.style.height=sz+'px';
      p.style.animationDuration=(1.5+Math.random()*2)+'s';
      p.style.animationDelay=(Math.random()*.6)+'s';
      p.style.borderRadius=Math.random()>.5?'50%':'3px';
      p.style.opacity=0.6+Math.random()*.4;
      c.appendChild(p);
      setTimeout((function(el){return function(){el.remove();};})(p),4000);
    }
    setTimeout(function(){c.classList.remove('show');},3500);
  }
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function videoPage(page) {
  const T = {
    dark:   { bg:'#0a0a0f',a1:'#7c3aff',a2:'#ff3aad',a3:'#3affe0',btn:'linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad)',bsh:'rgba(124,58,255,.5)',tx:'#f0eeff',mu:'#9d9ab8',bb:'rgba(124,58,255,.2)',bbd:'rgba(124,58,255,.35)',bbt:'#a78bfa' },
    neon:   { bg:'#020f0e',a1:'#3affe0',a2:'#00eeff',a3:'#7c3aff',btn:'linear-gradient(135deg,#3affe0,#0099ff)',bsh:'rgba(58,255,224,.4)',tx:'#e0fffc',mu:'#7ab8b2',bb:'rgba(58,255,224,.12)',bbd:'rgba(58,255,224,.3)',bbt:'#3affe0' },
    fire:   { bg:'#0f0800',a1:'#ff6b35',a2:'#ffd700',a3:'#ffaa00',btn:'linear-gradient(135deg,#ff6b35,#ffd700)',bsh:'rgba(255,107,53,.5)',tx:'#fff5e0',mu:'#b8956a',bb:'rgba(255,107,53,.15)',bbd:'rgba(255,107,53,.3)',bbt:'#ffd700' },
    brasil: { bg:'#011a0a',a1:'#00c04b',a2:'#ffdf00',a3:'#4da6ff',btn:'linear-gradient(135deg,#009c3b,#ffdf00)',bsh:'rgba(0,192,75,.4)',tx:'#f0fff4',mu:'#6b9e7a',bb:'rgba(0,156,59,.15)',bbd:'rgba(0,156,59,.35)',bbt:'#4ade80' },
  };
  const t = T[page.template] || T.dark;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<meta name="theme-color" content="${t.bg}">
<title>${page.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{overflow-x:hidden}
body{background:${t.bg};color:${t.tx};font-family:'DM Sans',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased;display:flex;align-items:flex-start;justify-content:center}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 50% at 50% 0%,${t.a1}18,transparent 60%);pointer-events:none;z-index:0}
.pg{position:relative;z-index:1;width:100%;max-width:420px;padding:28px 16px 60px}

/* VIDEO TITLE */
.vid-label{text-align:center;font-family:'Anton',sans-serif;font-size:16px;letter-spacing:2px;color:${t.mu};margin-bottom:14px;text-transform:uppercase}

/* VIDEO WRAPPER — portrait 3:4 */
.vid-wrap{width:100%;border-radius:18px;overflow:hidden;background:#000;position:relative;border:1px solid ${t.bb};box-shadow:0 8px 50px rgba(0,0,0,.6);aspect-ratio:3/4}
video{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;object-fit:cover}
.play-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,.35);cursor:pointer;transition:background .2s}
.play-overlay.hidden{opacity:0;pointer-events:none}
.play-circle{width:76px;height:76px;border-radius:50%;background:${t.btn};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 30px ${t.bsh};animation:pulse-play 1.8s ease-in-out infinite;flex-shrink:0}
.play-circle svg{width:30px;height:30px;fill:#fff;margin-left:5px}
.play-hint{font-size:13px;color:rgba(255,255,255,.7);letter-spacing:.5px}
@keyframes pulse-play{0%,100%{transform:scale(1);box-shadow:0 4px 30px ${t.bsh}}50%{transform:scale(1.1);box-shadow:0 4px 50px ${t.bsh},0 0 0 16px ${t.a1}18}}

/* BUTTONS */
.btns{margin-top:28px;display:none;flex-direction:column;gap:14px;opacity:0;transition:opacity .6s ease}
.btns.visible{display:flex;opacity:1}
.btn-main{width:100%;padding:20px 24px;border:none;border-radius:18px;background:${t.btn};color:#fff;font-family:'Anton',sans-serif;font-size:17px;letter-spacing:.5px;cursor:pointer;box-shadow:0 4px 28px ${t.bsh},inset 0 0 0 1px rgba(255,255,255,.1);-webkit-appearance:none;touch-action:manipulation;transition:transform .15s;position:relative;overflow:hidden}
.btn-main:active{transform:scale(.97)}
.btn-main::before{content:'';position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:shimmer 2.5s ease-in-out infinite}
.btn-subtle{display:block;text-align:center;font-size:13px;color:${t.mu};cursor:pointer;padding:8px;-webkit-tap-highlight-color:transparent;opacity:.7}
.btn-subtle:hover{opacity:1}
@keyframes shimmer{0%{left:-100%}100%{left:200%}}
@keyframes fup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="pg">
  <p class="vid-label" style="animation:fup .4s ease both">ASSISTA O VÍDEO</p>

  <div class="vid-wrap" style="animation:fup .4s .08s ease both;opacity:0">
    <video id="vid" playsinline preload="metadata">
      <source src="${VIDEO_URL}" type="video/mp4">
    </video>
    <div class="play-overlay" id="playOv">
      <div class="play-circle">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </div>
      <span class="play-hint">aperte aqui para assistir</span>
    </div>
  </div>

  <div class="btns" id="btns">
    <button class="btn-main" id="btnCta">🚀 QUERO GANHAR DINHEIRO COM I.A</button>
    <a class="btn-subtle" href="/prompts">Quero só os prompts</a>
  </div>
</div>

<script>
(function(){
  var SLUG   = ${JSON.stringify(page.slug)};
  var CTA    = ${JSON.stringify(page.cta_url || '#')};
  var vid    = document.getElementById('vid');
  var playOv = document.getElementById('playOv');
  var btns   = document.getElementById('btns');
  var shown  = false;
  var timer  = null;

  // play / pause via overlay
  playOv.addEventListener('click', function(){
    vid.play();
    playOv.classList.add('hidden');
  });
  vid.addEventListener('pause', function(){
    if(!vid.ended) playOv.classList.remove('hidden');
  });
  vid.addEventListener('ended', function(){
    playOv.classList.remove('hidden');
    showBtns();
  });

  // show buttons after 40s of watch time
  vid.addEventListener('timeupdate', function(){
    if(!shown && vid.currentTime >= 40){ showBtns(); }
  });
  function showBtns(){
    if(shown) return;
    shown = true;
    btns.style.display = 'flex';
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ btns.classList.add('visible'); });
    });
  }

  // CTA click tracking + redirect
  document.getElementById('btnCta').addEventListener('click', function(){
    try{ fetch('/api/cta/'+SLUG,{method:'POST'}); }catch(e){}
    setTimeout(function(){ window.location.href = CTA; }, 150);
  });
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GALLERY PAGE — /prompts
// ═══════════════════════════════════════════════════════════════════════════════
function galleryPage(pages) {
  const cards = pages.map(p => {
    const imgs = JSON.parse(p.images || '[]');
    const thumb = imgs[0] || '';
    return `<a href="/${p.slug}" class="gal-card">
      ${thumb
        ? `<div class="gal-thumb" style="background-image:url('${thumb}')"></div>`
        : `<div class="gal-thumb gal-thumb-ph"><span>🖼</span></div>`}
      <div class="gal-body">
        <div class="gal-title">${p.title}</div>
        ${p.subtitle ? `<div class="gal-sub">${p.subtitle.substring(0,60)}${p.subtitle.length>60?'…':''}</div>` : ''}
      </div>
    </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<meta name="theme-color" content="#0a0a0f">
<title>Biblioteca de Prompts · TikTok Shop IA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Syne:wght@800;900&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{overflow-x:hidden}
body{background:#0a0a0f;color:#f0eeff;font-family:'DM Sans',sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 40% at 10% 0,rgba(124,58,255,.14),transparent 55%),radial-gradient(ellipse 50% 35% at 90% 90%,rgba(255,58,173,.08),transparent 50%);pointer-events:none;z-index:0}
a{text-decoration:none;color:inherit}

/* BANNER */
.banner{position:sticky;top:0;z-index:100;background:linear-gradient(135deg,#7c3aff,#c026d3,#ff3aad);padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.banner-txt{font-size:13px;font-weight:500;color:#fff;line-height:1.4;flex:1}
.banner-txt strong{display:block;font-size:14px}
.banner-btn{flex-shrink:0;background:#fff;color:#7c3aff;border:none;border-radius:10px;padding:11px 16px;font-family:'Anton',sans-serif;font-size:13px;letter-spacing:.5px;cursor:pointer;white-space:nowrap;-webkit-appearance:none;touch-action:manipulation}

/* INNER */
.inner{position:relative;z-index:1;max-width:560px;margin:0 auto;padding:24px 14px 80px}
.gal-header{text-align:center;margin-bottom:24px}
.gal-header h1{font-family:'Syne',sans-serif;font-size:clamp(22px,6vw,30px);font-weight:900;color:#fff;margin-bottom:6px;line-height:1.1}
.gal-header p{font-size:13px;color:#9d9ab8}

/* GRID */
.gal-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gal-card{background:rgba(255,255,255,.04);border:1px solid rgba(124,58,255,.2);border-radius:16px;overflow:hidden;transition:border-color .15s;display:block}
.gal-card:active{border-color:rgba(124,58,255,.5);transform:scale(.98)}
.gal-thumb{width:100%;aspect-ratio:4/3;background-size:cover;background-position:center;display:block}
.gal-thumb-ph{display:flex;align-items:center;justify-content:center;background:rgba(124,58,255,.08)}
.gal-thumb-ph span{font-size:32px}
.gal-body{padding:10px 12px 14px}
.gal-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#f0eeff;line-height:1.3}
.gal-sub{font-size:11px;color:#9d9ab8;margin-top:4px;line-height:1.4}

/* EMPTY */
.empty-state{text-align:center;padding:60px 20px;color:#9d9ab8}
.empty-state a{display:inline-block;margin-top:16px;padding:10px 20px;background:rgba(124,58,255,.2);border:1px solid rgba(124,58,255,.35);border-radius:10px;color:#a78bfa;font-size:13px}

/* POPUP */
.pop-ov{position:fixed;inset:0;background:rgba(4,4,12,.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .3s ease}
.pop-ov.show{opacity:1;pointer-events:all}
.pop-box{width:100%;max-width:400px;background:#fff;border-radius:28px;padding:32px 24px 28px;position:relative;overflow:hidden;transform:scale(.92);transition:transform .4s cubic-bezier(.34,1.5,.64,1)}
.pop-ov.show .pop-box{transform:scale(1)}
.pop-box::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#7c3aff,#ff3aad)}
.pop-emoji{font-size:46px;text-align:center;margin-bottom:14px}
.pop-title{font-family:'Anton',sans-serif;font-size:21px;letter-spacing:.3px;color:#1a1a2e;text-align:center;line-height:1.15;margin-bottom:8px}
.pop-sub{font-size:16px;color:#555;text-align:center;line-height:1.6;margin-bottom:22px}
.pop-sub strong{color:#7c3aff}
.pop-btn{width:100%;padding:18px;border:none;border-radius:15px;background:linear-gradient(135deg,#7c3aff,#ff3aad);color:#fff;font-family:'Anton',sans-serif;font-size:16px;letter-spacing:.5px;cursor:pointer;-webkit-appearance:none;touch-action:manipulation;transition:transform .15s}
.pop-btn:active{transform:scale(.97)}
.pop-close{display:block;text-align:center;margin-top:14px;font-size:12px;color:#bbb;cursor:pointer;padding:6px}
</style>
</head>
<body>

<div class="banner">
  <div class="banner-txt">
    <strong>Mais de 120 Prompts Ultra Realistas</strong>
    Desbloqueie todos agora por R$19,90
  </div>
  <button class="banner-btn" onclick="window.location.href='${GALLERY_CTA}'">DESBLOQUEAR</button>
</div>

<div class="inner">
  <div class="gal-header">
    <h1>Biblioteca de Prompts</h1>
    <p>Clique em qualquer prompt e use gratuitamente</p>
  </div>

  ${pages.length === 0
    ? `<div class="empty-state"><p style="font-size:32px;margin-bottom:10px">📭</p><p>Nenhum prompt disponível ainda.</p></div>`
    : `<div class="gal-grid">${cards}</div>`}
</div>

<!-- POPUP -->
<div class="pop-ov" id="popOv">
  <div class="pop-box">
    <div class="pop-emoji">🔐</div>
    <div class="pop-title">Quer acessar os prompts secretos?</div>
    <p class="pop-sub">Mais de 120 prompts Ultra-Realistas para copiar e colar! de R$97,90 por apenas <strong>R$19,90</strong></p>
    <button class="pop-btn" onclick="window.location.href='${GALLERY_CTA}'">QUERO ACESSAR POR R$19,90</button>
    <span class="pop-close" id="popClose">Não, continuar navegando grátis</span>
  </div>
</div>

<script>
(function(){
  var ov = document.getElementById('popOv');
  // Show popup after 4 seconds, only once per session
  if(!sessionStorage.getItem('galPopSeen')){
    setTimeout(function(){
      ov.classList.add('show');
      sessionStorage.setItem('galPopSeen','1');
    }, 10000);
  }
  document.getElementById('popClose').addEventListener('click',function(){
    ov.classList.remove('show');
  });
})();
</script>
</body>
</html>`;
}

// ── 404 ──
function notFoundPage() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página não encontrada</title></head>
  <body style="background:#07070f;color:#f0eeff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px">
  <div><p style="font-size:48px;margin-bottom:16px">🔍</p><h1 style="font-size:22px;margin-bottom:8px">Página não encontrada</h1><p style="color:#6b6888;font-size:14px">Verifique o link e tente novamente.</p><a href="/prompts" style="display:inline-block;margin-top:20px;padding:10px 22px;background:rgba(124,58,255,.2);border:1px solid rgba(124,58,255,.4);border-radius:10px;color:#a78bfa;text-decoration:none;font-size:14px">Ver todos os prompts</a></div>
  </body></html>`;
}
