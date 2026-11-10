const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { connect } = require('./db');

// Inside BuscadorEquipos.exe the page is an embedded asset; in dev it is read from public/.
const sea = (() => { try { const s = require('node:sea'); return s.isSea() ? s : null; } catch { return null; } })();
const EXE_URL = 'https://github.com/rodrigopedettitrabajos-hub/buscadorequipos/releases/latest/download/BuscadorEquipos.exe';

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.type('html').send(sea ? sea.getAsset('index.html', 'utf8') : fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8')));

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

// All order lines of a client: serials are free text with no fixed marker (e.g. "TABLET - r8YL425J26K").
// NUMPEDIDO is unique in PEDVENTACAB (checked in G001).
app.get('/api/clientes/:cod/series', auth, async (req, res) => {
  const cod = parseInt(req.params.cod, 10);
  if (!Number.isInteger(cod)) return res.status(400).json({ error: 'Código inválido' });
  try {
    const r = await req.db.request().input('cod', cod).query(`
      SELECT CAB.NUMPEDIDO, LIN.DESCRIPCION, LIN.UNID1, CAB.FECHACREACION
      FROM PEDVENTACAB CAB
      INNER JOIN PEDVENTALIN LIN ON CAB.NUMPEDIDO = LIN.NUMPEDIDO
      WHERE CAB.CODCLIENTE = @cod      ORDER BY CAB.FECHACREACION DESC`);
    res.json(r.recordset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

setInterval(() => {
  for (const [t, s] of sessions) if (Date.now() - s.last > TTL) { s.pool.close(); sessions.delete(t); }
}, 60000).unref();

// "Actualizar": download the latest released exe, swap it in place (Windows lets a running exe be renamed), relaunch.
app.post('/api/actualizar', auth, async (req, res) => {
  if (!sea) return res.status(400).json({ error: 'Actualizar solo funciona desde BuscadorEquipos.exe' });
  const exe = process.execPath, nuevo = exe + '.new', viejo = exe + '.old';
  try {
    const r = await fetch(EXE_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 20e6 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('el archivo descargado no es un .exe válido');
    fs.writeFileSync(nuevo, buf);
    fs.rmSync(viejo, { force: true });
    fs.renameSync(exe, viejo);
    fs.renameSync(nuevo, exe);
    res.json({ ok: true });
    server.close();
    for (const s of sessions.values()) s.pool.close();
    setTimeout(() => {
      spawn(exe, ['--actualizado'], { detached: true, stdio: 'ignore' }).unref();
      process.exit(0);
    }, 300);
  } catch (e) {
    fs.rmSync(nuevo, { force: true });
    res.status(500).json({ error: 'No se pudo actualizar: ' + e.message });
  }
});

if (sea) fs.rmSync(process.execPath + '.old', { force: true });

const port = process.env.PORT || 3000;
const url = `http://localhost:${port}`;
const abrir = () => { if (sea && !process.argv.includes('--actualizado')) execFile('cmd', ['/c', 'start', '', url]); };
const server = app.listen(port, () => { console.log(`Buscador Equipos en ${url}\nCerrá esta ventana para apagarlo.`); abrir(); });
// Already running (e.g. double-clicked twice): just open the browser on the running one.
server.on('error', e => { if (e.code === 'EADDRINUSE') { abrir(); setTimeout(() => process.exit(0), 500); } else throw e; });

