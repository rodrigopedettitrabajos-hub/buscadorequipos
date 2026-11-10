const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { connect } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(__dirname + '/public'));

// shortcut: sessions live in memory, lost on restart; fine for a LAN tool.
const sessions = new Map(); // token -> { pool, user, last }
const TTL = 30 * 60 * 1000;

const tokenOf = req => (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/)?.[1];

function auth(req, res, next) {
  const s = sessions.get(tokenOf(req));
  if (!s || Date.now() - s.last > TTL) return res.status(401).json({ error: 'Sesión expirada' });
  s.last = Date.now();
  req.db = s.pool;
  next();
}

app.post('/api/login', async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  try {
    const pool = await connect(String(user), String(password));
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { pool, user, last: Date.now() });
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`);
    res.json({ ok: true, user });
  } catch (e) {
    console.error('login fallido:', e.message);
    res.status(401).json({ error: 'Usuario o contraseña incorrectos, o servidor no disponible' });
  }
});

app.post('/api/logout', (req, res) => {
  const t = tokenOf(req), s = sessions.get(t);
  if (s) { s.pool.close(); sessions.delete(t); }
  res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/');
  res.json({ ok: true });
});

// Same search Rodrigo used by hand: by name, commercial name or NIF.
app.get('/api/clientes', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const r = await req.db.request().input('q', `%${q}%`).query(`
      SELECT TOP 50 CODCLIENTE, NOMBRECLIENTE, NOMBRECOMERCIAL, NIF20
      FROM CLIENTES
      WHERE NOMBRECLIENTE LIKE @q OR NOMBRECOMERCIAL LIKE @q OR NIF20 LIKE @q
      ORDER BY NOMBRECOMERCIAL`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serial numbers are typed into PEDVENTALIN.DESCRIPCION (e.g. "SN:...", "S/N: ...", "SERIE ...").
// Newest first: the latest order is where the equipment should be now.
app.get('/api/serie', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  try {
    const r = await req.db.request().input('q', `%${q}%`).query(`
      SELECT TOP 100 CAB.NUMPEDIDO, LIN.DESCRIPCION, LIN.UNID1, CAB.FECHACREACION,
             CLI.CODCLIENTE, CLI.NOMBRECLIENTE, CLI.NOMBRECOMERCIAL, CLI.NIF20
      FROM PEDVENTALIN LIN
      INNER JOIN PEDVENTACAB CAB ON CAB.NUMPEDIDO = LIN.NUMPEDIDO
      INNER JOIN CLIENTES CLI ON CAB.CODCLIENTE = CLI.CODCLIENTE
      WHERE LIN.DESCRIPCION LIKE @q
      ORDER BY CAB.FECHACREACION DESC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Order lines of a client that carry a serial number. NUMPEDIDO is unique in PEDVENTACAB (checked in G001).
// shortcut: detects serials by the markers seen in G001 (SN, S/N, SERIE); add more if they write it another way.
app.get('/api/clientes/:cod/series', auth, async (req, res) => {
  const cod = parseInt(req.params.cod, 10);
  if (!Number.isInteger(cod)) return res.status(400).json({ error: 'Código inválido' });
  try {
    const r = await req.db.request().input('cod', cod).query(`
      SELECT CAB.NUMPEDIDO, LIN.DESCRIPCION, LIN.UNID1, CAB.FECHACREACION
      FROM PEDVENTACAB CAB
      INNER JOIN PEDVENTALIN LIN ON CAB.NUMPEDIDO = LIN.NUMPEDIDO
      WHERE CAB.CODCLIENTE = @cod
        AND (LIN.DESCRIPCION LIKE '%SN%' OR LIN.DESCRIPCION LIKE '%S/N%' OR LIN.DESCRIPCION LIKE '%SERIE%')
      ORDER BY CAB.FECHACREACION DESC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// "Actualizar": pulls the app files from UPDATE_SOURCE (an https base URL or a folder path),
// then exits with code 3 so Iniciar.bat restarts it with the new code.
const APP_FILES = ['server.js', 'db.js', 'public/index.html'];
app.post('/api/actualizar', auth, async (req, res) => {
  const src = process.env.UPDATE_SOURCE;
  if (!src) return res.status(400).json({ error: 'No hay origen de actualizaciones configurado (UPDATE_SOURCE en .env)' });
  try {
    // Download everything first; only write if all files arrived, so a failed update never leaves a half-updated app.
    const nuevos = await Promise.all(APP_FILES.map(async f => {
      let txt;
      if (/^https?:\/\//.test(src)) {
        const r = await fetch(`${src.replace(/\/$/, '')}/${f}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        txt = await r.text();
      } else txt = fs.readFileSync(path.join(src, f), 'utf8');
      if (!txt.trim()) throw new Error(`${f} vino vacío`);
      return [f, txt];
    }));
    for (const [f, txt] of nuevos) fs.writeFileSync(path.join(__dirname, f), txt);
    res.json({ ok: true });
    setTimeout(() => process.exit(3), 300);
  } catch (e) { res.status(500).json({ error: 'No se pudo actualizar: ' + e.message }); }
});

setInterval(() => {
  for (const [t, s] of sessions) if (Date.now() - s.last > TTL) { s.pool.close(); sessions.delete(t); }
}, 60000).unref();

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Buscador Equipos en http://localhost:${port}`));
