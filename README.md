# Rail — Time Tracking

App para registrar la jornada laboral (entrada, pausa, salida y sitio de trabajo) y
enviar cada día como una fila del Excel del timesheet en OneDrive.

Todo es un único fichero HTML autocontenido (`src/index.html`). Envuelto en
[Electron](https://www.electronjs.org/) es una app de escritorio; publicado como
PWA se instala en el móvil. Tres formas de usarlo:

| Modo | Cómo | Datos | Sincronización con Excel |
|---|---|---|---|
| App de escritorio | `npm start` o el instalador generado | fichero JSON local | sí, con clave propia |
| PWA (móvil y escritorio) | desde la URL de GitHub Pages, «Añadir a pantalla de inicio» / «Instalar» | `localStorage` | solo con backend |
| Navegador | abrir `src/index.html` directamente | `localStorage` | solo con backend |

Con el [backend opcional](#backend-opcional-cloudflare-workers) configurado, cualquiera
de los tres modos comparte los mismos registros y puede escribir en el Excel. Sin él,
cada dispositivo guarda lo suyo y solo la app de escritorio sincroniza.

## Estructura

```
electron/main.cjs           proceso principal: ventana, almacenamiento en disco, llamada a la API
electron/preload.cjs        puente seguro entre el proceso principal y la interfaz
src/index.html              la app entera (UI + lógica), sin dependencias externas salvo las fuentes
src/manifest.webmanifest    metadatos de la PWA (nombre, iconos, modo standalone)
server/src/worker.js        backend opcional: almacén compartido y escritura en el Excel
server/wrangler.toml        configuración del Worker (KV, orígenes permitidos)
src/sw.js                   service worker: la app funciona sin conexión
src/*.png                   iconos de la PWA
build/icon.png              icono de la aplicación de escritorio (512×512)
.github/workflows/pages.yml publica src/ en GitHub Pages
```

## Ejecutar en local

```bash
npm install
npm start
```

## Generar la app de escritorio

```bash
npm run dist          # instalador para el sistema actual
npm run dist:mac      # .dmg + .zip
npm run dist:win      # instalador NSIS
npm run dist:linux    # AppImage
```

Los resultados quedan en `dist/`. Cada sistema solo puede construir su propio
instalador de forma fiable: para el `.dmg` hace falta un Mac, y para el `.exe` un
Windows (o Wine). Los paquetes no van firmados, así que la primera vez macOS pedirá
abrir la app desde *Botón derecho → Abrir* y Windows mostrará el aviso de SmartScreen.

## Usarla desde el móvil (PWA)

`src/` es una PWA instalable: una vez publicada, se añade a la pantalla de inicio y se
abre en su propia ventana, sin barra del navegador, y funciona sin conexión.

**1. Publicarla** (una sola vez):

- Fusiona esta rama en `main`.
- En GitHub: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
- El workflow `pages.yml` se encarga del resto en cada push a `main`.
- Queda en `https://eljugon.github.io/time-tracking-app/`.

Ojo: el repositorio es público, así que esa dirección la puede abrir cualquiera. La
página no lleva ningún dato dentro — los registros viven en el navegador de cada
dispositivo — pero conviene tenerlo presente.

**2. Instalarla**:

- **iPhone / iPad**: abrir la URL en Safari (tiene que ser Safari) → botón *Compartir*
  → *Añadir a pantalla de inicio*.
- **Android**: abrir la URL en Chrome → menú *⋮* → *Instalar aplicación*.
- **Escritorio** (Chrome o Edge): icono de instalar en la barra de direcciones, o menú
  *⋮ → Enviar, guardar y compartir → Instalar página como aplicación*. Es la forma más
  rápida de tenerla en el portátil, aunque sin sincronización con Excel: para eso está
  la app de Electron.

## Backend opcional (Cloudflare Workers)

Sin backend hay dos límites: los registros no salen del dispositivo, y desde el móvil
no se puede escribir en el Excel (haría falta meter la clave de API en una página
pública). El Worker de `server/` resuelve las dos cosas: guarda los registros en KV y
es él quien llama a la API, con la clave como secreto suyo.

```
móvil / portátil  ──►  Worker  ──►  API de Claude  ──►  MCP de Microsoft 365  ──►  Excel
                        │
                        └─ KV: registros y ajustes compartidos
```

### Desplegarlo

```bash
cd server
npm install
npx wrangler login

# 1. Crear el almacén y pegar el id que imprime en wrangler.toml
npx wrangler kv namespace create RAIL

# 2. Secretos (nunca van en el repositorio)
npx wrangler secret put RAIL_ACCESS_TOKEN     # invéntate uno largo: openssl rand -hex 32
npx wrangler secret put ANTHROPIC_API_KEY     # sk-ant-...
npx wrangler secret put MS365_MCP_TOKEN       # token OAuth del conector, si lo tienes

# 3. Publicar
npx wrangler deploy
```

Queda en `https://rail-timesheet.<tu-cuenta>.workers.dev`. En la app, dentro de
**Configuración y sincronización**, se rellenan *URL del servidor* y *Token de acceso*
con ese `RAIL_ACCESS_TOKEN`. A partir de ahí todos los dispositivos ven lo mismo.

Si tu usuario de GitHub no es `eljugon`, ajusta `ALLOWED_ORIGINS` en `wrangler.toml`
con la URL de tus Pages. El valor `null` que ya viene es el origen que envía la app de
escritorio, que carga la página como `file://`.

### Qué expone

| Ruta | Para qué |
|---|---|
| `GET /api/health` | comprobar que responde y si tiene claves cargadas |
| `GET /api/entries` | todos los días registrados |
| `PUT /api/entries/{fecha}` | crear o actualizar un día |
| `DELETE /api/entries/{fecha}` | borrar un día |
| `GET`/`PUT /api/settings` | ajustes compartidos (ruta del Excel, horas reguladas) |
| `POST /api/sync` | escribir un día en el Excel |

Todo pide `Authorization: Bearer <RAIL_ACCESS_TOKEN>`. Detalles de diseño que importan:

- El cliente solo envía **una fecha** a `/api/sync`; el prompt lo construye el Worker
  a partir de lo que tiene guardado. Así el token de acceso no sirve para mandar texto
  libre al modelo con tu clave.
- Las escrituras son **por día**, con lectura-modificación-escritura en el servidor: un
  dispositivo con datos viejos solo puede tocar el día que está editando.
- Un dispositivo no publica ajustes compartidos hasta haber leído del servidor, para no
  pisar la configuración común con valores vacíos.
- Sin conexión se ficha igual: queda en una cola local que se vacía sola al volver la
  red.

### Alternativa sin modelo

Para lo que hace falta aquí — añadir una fila a una tabla — el camino directo es la API
de Microsoft Graph (`/workbook/tables/Table15/rows`), sin modelo de por medio: más
rápido, más barato y determinista. A cambio hay que registrar una aplicación en Entra
ID, cosa que en un tenant corporativo no siempre es posible. Por eso el Worker usa el
conector MCP, que reaprovecha lo que ya tenías montado.

## Dónde se guardan los datos

En un único fichero `rail-data.json` dentro de la carpeta de datos de la app:

- macOS: `~/Library/Application Support/Rail/rail-data.json`
- Windows: `%APPDATA%\Rail\rail-data.json`
- Linux: `~/.config/Rail/rail-data.json`

Contiene dos claves: `entries` (los días registrados) y `settings` (configuración).
Copiar ese fichero es suficiente para llevarse el historial a otro equipo.

Con backend configurado, ese fichero (y el `localStorage` en el móvil) pasa a ser una
caché: la copia buena está en KV y se vuelve a leer en cada arranque.

## Sincronización con el Excel de OneDrive

El botón **Enviar a Excel** pide a Claude, a través del conector MCP de
Microsoft 365, que escriba o actualice la fila de ese día en la tabla `Table15` de
la hoja *Timesheet*. Las columnas calculadas (día de la semana, horas regulares y
horas extra) se dejan en blanco a propósito para que las rellenen las fórmulas de la
tabla.

La llamada a la API se hace desde el proceso principal de Electron, no desde la
interfaz: así la clave nunca queda expuesta en la página y no hay problemas de CORS.

Para activarla, en **Configuración y sincronización** hay que rellenar:

1. **Ruta o enlace del Excel** en OneDrive. No viene rellenado por defecto: el
   repositorio es público y un enlace de compartición de OneDrive da acceso al fichero
   a quien lo tenga.
2. **Clave de API de Anthropic** (`sk-ant-...`). Alternativa: exportar
   `ANTHROPIC_API_KEY` antes de arrancar la app.
3. **Token del conector Microsoft 365**: el servidor MCP
   (`https://microsoft365.mcp.claude.com/mcp`) requiere autorización OAuth contra la
   cuenta de Microsoft. Sin ese token la llamada llega a la API pero el conector
   responde con un error de autenticación. También se puede pasar por entorno con
   `RAIL_MCP_TOKEN`.

Ambos valores se guardan en `rail-data.json` en texto plano, igual que el resto de la
configuración. Si eso no es aceptable, la alternativa es no escribirlos en la
interfaz y arrancar la app con las dos variables de entorno.

## Avisos

Los recordatorios de las 9:00 / 12:00 / 16:00 se lanzan mientras la app está abierta.
Para avisos fiables cuando está cerrada, lo razonable son eventos recurrentes en el
calendario de Outlook.
