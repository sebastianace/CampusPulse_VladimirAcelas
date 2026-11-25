// Hoja de impresión de los QR de las salas (qr.html). Solo administradores.
// Cada sala tiene su cartel con un QR que guarda <sitio>/movil.html?sala=<id>. El "sitio" todavía no
// está definido (hosting pendiente), así que se toma de donde se abrió esta hoja y se puede cambiar:
// cuando haya dominio, se abre la hoja desde ahí (o se escribe) y se vuelve a imprimir.
// Todo se dibuja en el navegador; no se guarda nada en el servidor.

import { pedir } from './api.js';
import { el } from './dom.js';
import { guardarSesion, puede } from './sesion.js';
import { alcanceDeLaDireccion, enlaceSala, normalizarBase } from './qr/enlaces.js';
import { qrSvg } from './qr/svg.js';
import * as toasts from './toasts.js';

const CLAVE_BASE = 'campuspulse:qr-base'; // la última dirección usada, para no escribirla cada vez
const campoBase = document.getElementById('qr-base');
const campoFiltro = document.getElementById('qr-filtro');
const estado = document.getElementById('qr-estado');
const hoja = document.getElementById('qr-hoja');
let espacios = [];

// localStorage puede fallar (ventana privada, datos bloqueados): la hoja funciona igual sin recordar
const recordar = {
  leer: () => { try { return localStorage.getItem(CLAVE_BASE); } catch { return null; } },
  guardar: (valor) => { try { localStorage.setItem(CLAVE_BASE, valor); } catch { /* sin recordar */ } },
  borrar: () => { try { localStorage.removeItem(CLAVE_BASE); } catch { /* sin recordar */ } },
};

function decirEstado(texto, nivel) {
  estado.textContent = texto;
  estado.dataset.nivel = nivel;
}

// Qué le espera a esa dirección cuando alguien escanee el código con el celular
function explicarDireccion(base) {
  const alcance = alcanceDeLaDireccion(base);
  if (alcance === 'local') {
    return ['Esta dirección (localhost) solo se abre en este computador: el celular no la va a encontrar. '
      + 'Abre esta hoja con la dirección que usa el celular (por ejemplo, la IP del computador) o con el dominio definitivo antes de imprimir.', 'aviso'];
  }
  if (alcance === 'red') {
    return ['Es una dirección de red interna: los códigos solo abren con el Wi-Fi del campus. Sirve para probar; '
      + 'cuando se defina el hosting, vuelve a imprimir con la dirección final.', 'aviso'];
  }
  return [base.startsWith('http://')
    ? 'Los celulares abren este enlace desde cualquier red, pero es http sin cifrar: con https las contraseñas viajan protegidas.'
    : 'Los celulares abren este enlace desde cualquier red.', base.startsWith('http://') ? 'aviso' : 'ok'];
}

// El SVG se convierte en un nodo con DOMParser (no se pega como HTML): así nada de lo que venga de la API se interpreta como código
function nodoSvg(texto) {
  return document.importNode(new DOMParser().parseFromString(texto, 'image/svg+xml').documentElement, true);
}

function cartel(espacio, base) {
  const enlace = enlaceSala(base, espacio.id);
  return el('article', { className: 'qr-cartel' },
    el('h3', { className: 'qr-cartel__sala' }, espacio.nombre),
    el('div', { className: 'qr-cartel__codigo' }, nodoSvg(qrSvg(enlace, { titulo: `Código QR para reportar un daño en ${espacio.nombre}`, color: '#000' }))),
    el('p', { className: 'qr-cartel__titulo' }, 'Reporta un daño en esta sala'),
    el('p', { className: 'qr-cartel__pasos' }, 'Escanea con la cámara del celular e inicia sesión con tu cuenta de Campus Pulse.'),
    el('p', { className: 'qr-cartel__enlace' }, enlace));
}

function dibujar() {
  const base = normalizarBase(campoBase.value);
  if (!base) {
    decirEstado('Escribe una dirección válida, por ejemplo https://campuspulse.tucampus.com o http://192.168.1.20:3000.', 'error');
    hoja.hidden = true;
    return;
  }
  const [mensaje, nivel] = explicarDireccion(base);
  decirEstado(mensaje, nivel);
  const elegidas = campoFiltro.value === 'todas' ? espacios : espacios.filter((e) => e.id === campoFiltro.value);
  hoja.replaceChildren(...elegidas.map((e) => cartel(e, base)));
  hoja.hidden = !elegidas.length;
}

function usarDireccionDeEstaPagina() {
  campoBase.value = location.origin;
  recordar.borrar();
  dibujar();
}

async function iniciar() {
  let yo;
  try {
    yo = await pedir('/api/auth/yo'); // sin sesión, pedir() ya lleva al inicio de sesión y vuelve aquí
  } catch (error) {
    if (error.codigo !== 'SESION_REQUERIDA') toasts.error(error);
    return;
  }
  if (yo.debeCambiarClave) { location.href = '/'; return; } // con contraseña temporal solo se puede cambiarla, en el tablero
  guardarSesion(yo);
  if (!puede('imprimirQR')) {
    document.getElementById('qr-sin-permiso').hidden = false;
    return;
  }

  try {
    espacios = await pedir('/api/espacios');
  } catch (error) {
    toasts.error(error);
    return;
  }
  campoFiltro.replaceChildren(
    el('option', { value: 'todas' }, `Todas (${espacios.length})`),
    ...espacios.map((e) => el('option', { value: e.id }, e.nombre)));
  campoBase.value = recordar.leer() ?? location.origin;
  document.getElementById('qr-controles').hidden = false;
  dibujar();
}

campoBase.addEventListener('input', () => {
  const base = normalizarBase(campoBase.value);
  if (base) recordar.guardar(campoBase.value.trim());
  dibujar();
});
campoFiltro.addEventListener('change', dibujar);
document.getElementById('qr-restablecer').addEventListener('click', usarDireccionDeEstaPagina);
document.getElementById('qr-imprimir').addEventListener('click', () => {
  if (hoja.hidden) { toasts.error('Escribe una dirección válida antes de imprimir.'); return; }
  window.print();
});

iniciar();
