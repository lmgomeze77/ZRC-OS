# ZRC OS

Página estática de acceso restringido para Zenith Rise Capital.

> **Repositorio público.** Todo lo que se añada aquí fuera del contenido
> cifrado es legible por cualquiera. No incluyas en claro el fuente del
> cuadro de mando, datos de expedientes, notas internas ni la clave.

## Contenido

| Fichero | Qué es |
|---|---|
| `index.html` | La página completa, autocontenida. Sin build ni dependencias. |
| `_headers` | Cabeceras para Netlify: `noindex`, `no-store`, `no-referrer`, `DENY` en frames. |
| `tools/build.js` | Regenera `index.html` a partir del fuente y una clave. |

## Protección

El contenido va cifrado dentro de `index.html` y se descifra en el navegador:

- **AES-256-GCM**, clave derivada con **PBKDF2-SHA256**, 300.000 iteraciones
- Sal e IV aleatorios en cada build
- Web Crypto del navegador. La clave no se envía a ningún servidor, no se
  almacena y no está en el repositorio

Sin la clave, el código fuente sólo contiene CSS de diseño y un blob base64.
GCM autentica además el contenido: una clave errónea falla, no devuelve datos
corruptos. En claro quedan únicamente el CSS y el rótulo de la firma.

Como el cifrado es lo único que protege el contenido, **la fuerza de la clave
es la fuerza del sistema**: el blob es descargable por cualquiera y se puede
atacar offline. Usa claves de alta entropía generadas al azar, nunca
palabras elegidas a mano.

## Requisito de despliegue

Web Crypto exige **contexto seguro**: la página funciona bajo HTTPS o en
`localhost`, y **no funciona sobre `file://` ni HTTP plano**. Netlify sirve
HTTPS por defecto.

## Desplegar en Netlify

*Add new site → Import an existing project →* este repositorio.

- Branch: `main`
- Build command: *(vacío)*
- Publish directory: `.`

El `_headers` debe quedar en la raíz publicada; si cambias el publish
directory, muévelo con él o las cabeceras se ignoran.

Comprobación tras desplegar:

```bash
curl -sI https://TU-SITIO.netlify.app | grep -i x-robots-tag
# esperado: x-robots-tag: noindex, nofollow, noarchive
```

## Rotar la clave

La clave está incorporada en el cifrado, así que no se edita a mano: hay que
regenerar la página.

```bash
node tools/build.js <fuente.html> '<clave-nueva>' index.html
```

`<fuente.html>` es el export del cuadro de mando en una sola pieza. Mantenlo
**fuera de este repositorio**. Genera la clave al azar, por ejemplo:

```bash
node -e "const c=require('crypto'),A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';\
console.log([...Array(5)].map(()=>[...Array(4)].map(()=>A[c.randomInt(A.length)]).join('')).join('-'))"
```

Tras regenerar, comprueba que no se ha escapado nada en claro:

```bash
grep -ci 'PALABRA_DE_PRUEBA' index.html   # debe devolver 0
```
