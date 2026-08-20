# Rail — Time Tracking

App de escritorio para registrar la jornada laboral (entrada, pausa, salida y sitio
de trabajo) y enviar cada día como una fila del Excel del timesheet en OneDrive.

La interfaz es un único fichero HTML autocontenido (`src/index.html`) envuelto en
[Electron](https://www.electronjs.org/), de modo que se puede usar de dos formas:

| Modo | Cómo | Datos | Sincronización con Excel |
|---|---|---|---|
| App de escritorio | `npm start` o el instalador generado | fichero JSON en la carpeta de datos de la app | sí |
| Navegador | abrir `src/index.html` directamente | `localStorage` del navegador | no (bloqueada por CORS) |

## Estructura

```
electron/main.cjs      proceso principal: ventana, almacenamiento en disco, llamada a la API
electron/preload.cjs   puente seguro entre el proceso principal y la interfaz
src/index.html         la app entera (UI + lógica), sin dependencias externas salvo las fuentes
build/icon.png         icono de la aplicación (512×512)
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

1. **Ruta o enlace del Excel** en OneDrive.
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
