// =====================================================================
// ENLACES DE LOS QR DE LAS SALAS (funciones puras)
// ---------------------------------------------------------------------
// El QR de cada sala guarda solo una dirección:
//     <sitio>/movil.html?sala=<id de la sala>
// Sin claves ni datos de nadie. Para reportar hay que tener sesión: si no la hay,
// el sitio manda al login y, al entrar, vuelve a esta misma dirección.
// El "sitio" (dominio o IP) todavía no está definido, por eso no va fijo en el código:
// la hoja de impresión lo toma de donde se abre y se puede cambiar.
// Se prueban en tests/qr.test.js.
// =====================================================================

export const PAGINA_REPORTE = 'movil.html';

/**
 * Deja la dirección del sitio en su forma limpia (sin barra final, sin query ni #) o devuelve null si
 * no sirve. Acepta "campuspulse.ejemplo.com" (asume https; una IP o localhost, http) y pegar una dirección con página al final
 * ("http://192.168.1.20:3000/login.html"): la página se quita.
 */
export function normalizarBase(texto) {
  let entrada = String(texto ?? '').trim();
  if (!entrada) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(entrada)) {
    // Sin esquema: un dominio se asume https, pero una IP o un nombre interno (localhost, equipo.local) casi
    // siempre se sirve por http: con https el QR quedaría roto.
    entrada = `${/^(localhost|[\d.]+|[^/]*\.local)(:\d+)?(\/|$)/i.test(entrada) ? 'http' : 'https'}://${entrada}`;
  }
  let url;
  try {
    url = new URL(entrada);
  } catch {
    return null;
  }
  // Solo http(s) y sin usuario:clave incrustados (un QR no debe llevar credenciales)
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  const ruta = url.pathname.replace(/\/[^/]*\.html?$/i, '').replace(/\/+$/, '');
  return `${url.origin}${ruta}`;
}

/**
 * ¿Desde dónde se puede abrir esa dirección?
 *   'local'   → solo desde el mismo computador (localhost, 127.0.0.1): el celular no la ve.
 *   'red'     → IP de red interna (192.168.x.x, 10.x.x.x, 172.16-31.x.x): solo con el Wi-Fi del campus.
 *   'publica' → cualquier otro dominio o IP: se abre desde cualquier lugar.
 */
export function alcanceDeLaDireccion(base) {
  let host;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return 'publica';
  }
  if (host === 'localhost' || host === '[::1]' || host === '0.0.0.0' || /^127\./.test(host)) return 'local';
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return 'red';
  }
  return host.endsWith('.local') ? 'red' : 'publica';
}

/** La dirección que lleva el QR de una sala. */
export function enlaceSala(base, espacioId) {
  return `${base}/${PAGINA_REPORTE}?sala=${encodeURIComponent(espacioId)}`;
}

/**
 * Lee ?sala= de la dirección de la página y la busca entre los espacios.
 * Devuelve {id, espacio}: id es lo que traía la dirección (o null si no traía nada);
 * espacio es la sala encontrada (o null si el código no corresponde a ninguna).
 */
export function leerSala(busqueda, espacios) {
  const id = new URLSearchParams(busqueda).get('sala')?.trim() || null;
  return { id, espacio: id ? espacios.find((e) => e.id === id) ?? null : null };
}
