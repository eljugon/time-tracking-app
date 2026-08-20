/**
 * Rail — backend mínimo sobre Cloudflare Workers.
 *
 * Dos cosas que la PWA no puede hacer sola:
 *   1. Guardar los registros en un sitio común, para que el móvil y el portátil
 *      vean lo mismo.
 *   2. Escribir en el Excel de OneDrive sin que la clave de API acabe dentro de
 *      una página pública: la clave vive aquí, como secreto del Worker.
 *
 * Autenticación: cabecera `Authorization: Bearer <RAIL_ACCESS_TOKEN>`.
 * Es una app de un solo usuario, así que un token compartido es suficiente.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';
const MCP_URL = 'https://microsoft365.mcp.claude.com/mcp';
const MCP_NAME = 'microsoft-365';

const ENTRIES_KEY = 'entries';
const SETTINGS_KEY = 'settings';

/* El mismo mapa de sitios que la interfaz. Se duplica a propósito: así el
   cliente solo pide «sincroniza el día X» y nunca envía texto libre al modelo. */
const SITES = {
  home:      { workLocation: 'Home/Remote',        campus: 'Home/Remote' },
  stockholm: { workLocation: 'Stockholm',          campus: 'Regeringsgatan' },
  ersbo:     { workLocation: 'Gävle',              campus: 'Ersbo' },
  tuna:      { workLocation: 'Gävle',              campus: 'Tuna' },
  stackbo:   { workLocation: 'Gävle',              campus: 'Stackbo' },
  other:     { workLocation: 'Other MSFT location', campus: 'Dublin' },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- utilidades ---------- */

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allow = allowed.includes('*') || allowed.includes(origin) ? origin || '*' : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) },
  });
}

/** Comparación en tiempo constante, para no filtrar el token carácter a carácter. */
function tokenMatches(given, expected) {
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function toHHMM(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

async function readEntries(env) {
  return (await env.RAIL.get(ENTRIES_KEY, 'json')) || {};
}

async function readSettings(env) {
  return (await env.RAIL.get(SETTINGS_KEY, 'json')) || {};
}

/* ---------- sincronización con el Excel ---------- */

function buildPrompt(iso, entry, oneDrivePath) {
  const site = SITES[entry.site] || SITES.home;
  return `Add one new row to the Excel table on the "Timesheet" sheet (the table is named Table15) inside the OneDrive Excel file located at: "${oneDrivePath}" (this may be a file path or a OneDrive sharing link — resolve it to the actual file first).
Columns in order are: Date | Day of Week | Entry Time | Exit Time | Break Duration (hh:mm) | Vacation Day / Weekend / National Holiday | Work location | Campus/Office | Commute/Travel Time (hh:mm) | Regular Hours Worked | Overtime (hh:mm) | Notes.
"Day of Week", "Regular Hours Worked" and "Overtime (hh:mm)" are calculated columns with a formula already applied down the whole table — do NOT write literal values into those three columns, only write into the other columns and let the table's existing formulas auto-fill them (Excel tables auto-extend calculated-column formulas to new rows).
If a row for date ${iso} already exists in the table, update that row instead of adding a duplicate.
Values to write:
Date: ${iso}
Entry Time: ${entry.entryTime}
Exit Time: ${entry.exitTime || ''}
Break Duration (hh:mm): ${toHHMM(entry.breakMins)}
Vacation Day / Weekend / National Holiday: ${entry.vacation ? 'YES' : 'NO'}
Work location: ${site.workLocation}
Campus/Office: ${site.campus}
Commute/Travel Time (hh:mm): ${toHHMM(entry.commuteMins || 0)}
Notes: ${entry.notes || ''}
Reply with a single short confirmation line once the row has been written.`;
}

async function syncToExcel(env, iso) {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'El Worker no tiene ANTHROPIC_API_KEY configurada.' };
  }

  const entries = await readEntries(env);
  const entry = entries[iso];
  if (!entry || !entry.entryTime) return { ok: false, error: 'Ese día no tiene hora de entrada.' };

  const settings = await readSettings(env);
  const oneDrivePath = settings.oneDrivePath || env.ONEDRIVE_PATH || '';
  if (!oneDrivePath) return { ok: false, error: 'Falta la ruta del Excel en la configuración.' };

  const server = { type: 'url', url: MCP_URL, name: MCP_NAME };
  if (env.MS365_MCP_TOKEN) server.authorization_token = env.MS365_MCP_TOKEN;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['mcp-client-2025-11-20'],
    mcp_servers: [server],
    tools: [{ type: 'mcp_toolset', mcp_server_name: MCP_NAME }],
    messages: [{ role: 'user', content: buildPrompt(iso, entry, oneDrivePath) }],
  });

  const text = (res.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();

  if (res.stop_reason === 'refusal') return { ok: false, error: 'La API rechazó la petición.' };
  const toolErr = (res.content || []).find((b) => b.type === 'mcp_tool_result' && b.is_error);
  if (toolErr) {
    return { ok: false, error: text || 'El conector de Microsoft 365 devolvió un error.' };
  }

  entries[iso] = { ...entry, synced: true };
  await env.RAIL.put(ENTRIES_KEY, JSON.stringify(entries));
  return { ok: true, text };
}

/* ---------- enrutado ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Rail API', { status: 404, headers: cors });
    }

    const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!tokenMatches(given, env.RAIL_ACCESS_TOKEN)) {
      return json({ error: 'No autorizado.' }, 401, cors);
    }

    const path = url.pathname.slice('/api/'.length);
    const method = request.method;

    try {
      if (path === 'health') {
        return json({ ok: true, excel: !!env.ANTHROPIC_API_KEY, mcp: !!env.MS365_MCP_TOKEN }, 200, cors);
      }

      if (path === 'entries' && method === 'GET') {
        return json({ entries: await readEntries(env) }, 200, cors);
      }

      if (path.startsWith('entries/')) {
        const date = path.slice('entries/'.length);
        if (!ISO_DATE.test(date)) return json({ error: 'Fecha inválida.' }, 400, cors);

        // Leer-modificar-escribir en el servidor: un dispositivo con datos viejos
        // solo puede pisar el día que está tocando, nunca el resto.
        if (method === 'PUT') {
          const entry = await request.json();
          if (!entry || typeof entry !== 'object') return json({ error: 'Cuerpo inválido.' }, 400, cors);
          const entries = await readEntries(env);
          entries[date] = { ...entry, date };
          await env.RAIL.put(ENTRIES_KEY, JSON.stringify(entries));
          return json({ ok: true }, 200, cors);
        }
        if (method === 'DELETE') {
          const entries = await readEntries(env);
          delete entries[date];
          await env.RAIL.put(ENTRIES_KEY, JSON.stringify(entries));
          return json({ ok: true }, 200, cors);
        }
      }

      if (path === 'settings' && method === 'GET') {
        return json({ settings: await readSettings(env) }, 200, cors);
      }
      if (path === 'settings' && method === 'PUT') {
        const body = await request.json();
        // Solo se comparten estos dos campos; las claves nunca se guardan en KV.
        const settings = {
          oneDrivePath: String((body && body.oneDrivePath) || ''),
          regulatedHours: String((body && body.regulatedHours) || '07:45'),
        };
        await env.RAIL.put(SETTINGS_KEY, JSON.stringify(settings));
        return json({ ok: true, settings }, 200, cors);
      }

      if (path === 'sync' && method === 'POST') {
        const body = await request.json();
        const date = body && body.date;
        if (!ISO_DATE.test(String(date))) return json({ error: 'Fecha inválida.' }, 400, cors);
        const result = await syncToExcel(env, date);
        return json(result, result.ok ? 200 : 502, cors);
      }

      return json({ error: 'Ruta no encontrada.' }, 404, cors);
    } catch (err) {
      return json({ error: (err && err.message) || 'Error interno.' }, 500, cors);
    }
  },
};
