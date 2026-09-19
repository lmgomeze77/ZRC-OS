const fs = require('fs');
const crypto = require('crypto');

// Uso: node tools/build.js <fuente.html> <clave> [salida.html]
//   <fuente.html>  export del cuadro de mando ZRC OS (HTML de una sola pieza)
//   <clave>        clave de acceso; NO se guarda en ningun fichero del repo
const [, , SRC, PASS, OUT = 'index.html'] = process.argv;
if (!SRC || !PASS) {
  console.error('Uso: node tools/build.js <fuente.html> <clave> [salida.html]');
  process.exit(1);
}

let raw = fs.readFileSync(SRC, 'utf8');
// Descartar el envoltorio del host (primera linea: doctype + reset propio del visor)
raw = raw.slice(raw.indexOf('\n') + 1);

const cssA = raw.indexOf('<style>'), cssB = raw.indexOf('</style>');
const jsA  = raw.indexOf('<script>'), jsB = raw.indexOf('</script>');
if ([cssA, cssB, jsA, jsB].some(i => i < 0)) throw new Error('No se localizan los bloques style/script');

const css  = raw.slice(cssA + 7, cssB).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n');   // se queda en claro: solo diseno, sin comentarios
const html = raw.slice(cssB + 8, jsA);                     // marcado -> cifrado
const js   = raw.slice(jsA + 8, jsB);                      // logica + datos -> cifrado

const payload = Buffer.from(JSON.stringify({ html, js }), 'utf8');

const ITER = 300000;
const salt = crypto.randomBytes(16);
const iv   = crypto.randomBytes(12);
const key  = crypto.pbkdf2Sync(PASS, salt, ITER, 32, 'sha256');
const ci   = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct   = Buffer.concat([ci.update(payload), ci.final()]);
const blob = Buffer.concat([ct, ci.getAuthTag()]).toString('base64');

const page = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>ZRC OS</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Source+Serif+4:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
${css}
/* ── PUERTA DE ACCESO ──────────────────────────────────────────────────── */
#gate { position: fixed; inset: 0; z-index: 999; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: radial-gradient(circle at 50% 12%, rgba(201,168,76,.07), transparent 42%), var(--bg); }
.gbox { width: min(430px, 100%); border: 1px solid var(--line); background: var(--panel); padding: 30px 28px; }
.gbox .eyebrow { display: block; margin-bottom: 14px; }
.gbox h1 { color: var(--cream); font-family: var(--display); font-weight: 600; font-size: 38px; line-height: 1; letter-spacing: -.5px; margin-bottom: 10px; }
.gbox h1 span { color: var(--gold); }
.gbox p { color: var(--muted); font-size: 12.5px; line-height: 1.6; margin-bottom: 20px; }
.gbox input { width: 100%; padding: 12px 13px; background: var(--bg); border: 1px solid var(--line);
  color: var(--cream); font-family: var(--mono); font-size: 13px; letter-spacing: .5px; margin-bottom: 11px; }
.gbox input:focus { outline: none; border-color: rgba(201,168,76,.5); }
.gbox button { width: 100%; padding: 12px; background: var(--gold); color: var(--bg); font-family: var(--mono);
  font-size: 10px; font-weight: 700; letter-spacing: 1.6px; cursor: pointer; border: none; }
.gbox button[disabled] { opacity: .55; cursor: progress; }
.gerr { margin-top: 12px; font-family: var(--mono); font-size: 10px; letter-spacing: .6px; color: var(--red); min-height: 13px; }
.gnote { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line-2);
  font-family: var(--mono); font-size: 8.5px; letter-spacing: .5px; color: var(--faint); line-height: 1.8; }
</style>
</head>
<body>

<div id="gate">
  <div class="gbox">
    <span class="eyebrow">Zenith Rise Capital · Calesius Global, S.L.</span>
    <h1>ZRC <span>OS</span></h1>
    <p>Capa de mando del Intelligence Officer. Acceso restringido. El contenido de esta página está cifrado y solo se descifra en tu navegador con la clave correcta.</p>
    <input id="pw" type="password" placeholder="Clave de acceso" autocomplete="current-password" spellcheck="false" />
    <button id="go">DESCIFRAR Y ENTRAR</button>
    <div class="gerr" id="err"></div>
    <div class="gnote">AES-256-GCM · PBKDF2-SHA256 · ${ITER.toLocaleString('es-ES')} iteraciones<br />La clave no viaja ni se almacena. Sin ella no hay contenido que leer.</div>
  </div>
</div>

<div id="app"></div>

<script>
(function () {
  'use strict';
  var BLOB = "${blob}";
  var SALT = "${salt.toString('base64')}";
  var IV   = "${iv.toString('base64')}";
  var ITER = ${ITER};

  var gate = document.getElementById('gate'), app = document.getElementById('app'),
      pw = document.getElementById('pw'), go = document.getElementById('go'), err = document.getElementById('err');

  function b2a(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  if (!window.crypto || !window.crypto.subtle) {
    err.textContent = 'ESTE NAVEGADOR NO SOPORTA EL DESCIFRADO. USA HTTPS Y UN NAVEGADOR ACTUAL.';
    go.disabled = true;
  }

  function unlock() {
    var pass = pw.value;
    if (!pass) { err.textContent = 'INTRODUCE LA CLAVE.'; return; }
    go.disabled = true; err.textContent = 'DESCIFRANDO...';

    crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b2a(SALT), iterations: ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b2a(IV) }, key, b2a(BLOB));
      })
      .then(function (buf) {
        var data = JSON.parse(new TextDecoder().decode(buf));
        app.innerHTML = data.html;
        // innerHTML no ejecuta scripts: se recrea el elemento para que corra.
        var s = document.createElement('script');
        s.textContent = data.js;
        document.body.appendChild(s);
        gate.remove();
      })
      .catch(function () {
        go.disabled = false;
        err.textContent = 'CLAVE INCORRECTA.';
        pw.value = ''; pw.focus();
      });
  }

  go.addEventListener('click', unlock);
  pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
  pw.focus();
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, page);
console.log('css  ', css.length, 'bytes (en claro)');
console.log('html ', html.length, 'bytes (cifrado)');
console.log('js   ', js.length, 'bytes (cifrado)');
console.log('pagina', fs.statSync(OUT).size, 'bytes');
console.log('escrito en', OUT);
