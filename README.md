# Rail — Time Tracking

App para registrar la jornada laboral (entrada, pausa, salida y sitio de trabajo) y
enviar cada día como una fila del Excel del timesheet en OneDrive.

Todo es un único fichero HTML autocontenido (`src/index.html`). Envuelto en
[Electron](https://www.electronjs.org/) es una app de escritorio; publicado como
PWA se instala en el móvil. Tres formas de usarlo:

| Modo | Cómo | Datos | Sincronización con Excel |
|---|---|---|---|
| App de escritorio | `npm start` o el instalador generado | fichero JSON en la carpeta de datos de la app | sí |
| PWA (móvil y escritorio) | desde la URL de GitHub Pages, «Añadir a pantalla de inicio» / «Instalar» | `localStorage` del navegador | no |
| Navegador | abrir `src/index.html` directamente | `localStorage` del navegador | no |

Los datos **no se sincronizan entre dispositivos**: cada uno guarda los suyos. El
móvil sirve para fichar sobre la marcha; el Excel de OneDrive es el sitio donde todo
acaba junto, y ahí solo escribe la app de escritorio.

## Estructura

```
electron/main.cjs           proceso principal: ventana, almacenamiento en disco, llamada a la API
electron/preload.cjs        puente seguro entre el proceso principal y la interfaz
src/index.html              la app entera (UI + lógica), sin dependencias externas salvo las fuentes
src/manifest.webmanifest    metadatos de la PWA (nombre, iconos, modo standalone)
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

## Dónde se guardan los datos

En un único fichero `rail-data.json` dentro de la carpeta de datos de la app:

- macOS: `~/Library/Application Support/Rail/rail-data.json`
- Windows: `%APPDATA%\Rail\rail-data.json`
- Linux: `~/.config/Rail/rail-data.json`

Contiene dos claves: `entries` (los días registrados) y `settings` (configuración).
Copiar ese fichero es suficiente para llevarse el historial a otro equipo.

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
