// Mapa de ocupación estilo juego 2D: el Nivel 6 de la Torre Zenith en pixel art,
// visto desde arriba, con profes y campers caminando.
//
//   - Cada espacio de GET /api/espacios se pinta sobre su sala del plano
//     (verde disponible, ámbar ocupada ahora, rojo inhabilitada, gris inconsistente).
//   - Las salas ocupadas ahora se llenan con una clase; las inhabilitadas se vacían.
//   - Clic en una sala -> evento "espacio-seleccionado" (el formulario la preselecciona).
//   - Debajo del lienzo, una fila de botones con los mismos espacios para teclado y
//     lectores de pantalla, y para los espacios que no tienen sitio en el plano.

import { el } from './dom.js';
import { ESTADOS_RECURSO, etiqueta } from './catalogos.js';
import { ahoraBogota, hoyISO } from './estado.js';
import { construirPlano, SALA_POR_ESPACIO } from './mapa/plano.js';
import { pintarMundo, BALDOSA } from './mapa/pixel.js';
import { crearCamara } from './mapa/camara.js';
import { crearGente, COLOR_PROFE } from './mapa/gente.js';

const TEXTO_ESTADO = {
  disponible: 'Disponible',
  ocupada: 'Ocupada ahora',
  inhabilitado: 'Inhabilitada',
  inconsistente: 'Dato inconsistente',
};

// Por debajo de este zoom solo se ve el nombre de cada sala
const ZOOM_DETALLE = 0.55;

const reducirMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

let plano, mundo, camara, gente, lienzo, ctx, colores, rayas;
let salas = new Map();      // salaId -> { espacio, estado, equipos, abiertas, asistentes }
let caminos = new Map();    // salaId -> Path2D con la forma de la sala (px de mundo)
let encima = null;          // { tipo: 'sala' | 'zona' | 'persona', ... } bajo el puntero
let resaltadaDesdeLista = null;
let seleccionada = null;
let visible = true;

const contenedor = () => document.getElementById('mapa');

/** Prepara el lienzo, la cámara y la gente. Se llama una vez al cargar la página. */
export function iniciarMapa() {
  const juego = document.getElementById('mapa-juego');
  lienzo = juego.querySelector('canvas');
  ctx = lienzo.getContext('2d');

  plano = construirPlano();
  mundo = pintarMundo(plano);
  caminos = new Map(plano.areas.map((area) => [area.id, formaDe(area)]));
  colores = leerColores();
  rayas = crearRayas(colores.inhabilitado);
  gente = crearGente(plano, { movimiento: !reducirMovimiento });

  camara = crearCamara(lienzo, { ancho: mundo.width, alto: mundo.height }, {
    alClic: clicEn,
    alPasar: (sx, sy) => { encima = queHayEn(sx, sy); actualizarCursor(); },
    alSalir: () => { encima = null; actualizarCursor(); },
  });

  new ResizeObserver(() => redimensionar()).observe(lienzo);
  new IntersectionObserver(([entrada]) => { visible = entrada.isIntersecting; }).observe(lienzo);
  redimensionar();
  camara.encuadrar(false);

  juego.querySelector('[data-accion="acercar"]').addEventListener('click', () => camara.acercar());
  juego.querySelector('[data-accion="alejar"]').addEventListener('click', () => camara.alejar());
  juego.querySelector('[data-accion="encuadrar"]').addEventListener('click', () => camara.encuadrar());

  // Recién reservada: la cámara va a la sala y queda marcada
  document.addEventListener('reserva-creada', ({ detail }) => {
    const salaId = [...salas].find(([, info]) => info.espacio.id === detail.espacioId)?.[0];
    if (!salaId) return;
    seleccionada = salaId;
    camara.enfocar(cajaPx(areaDe(salaId)));
  });

  let anterior = performance.now();
  const cuadro = (ahora) => {
    requestAnimationFrame(cuadro);
    const dt = Math.min(0.1, (ahora - anterior) / 1000);
    anterior = ahora;
    if (!visible || document.hidden) return;
    camara.paso(dt);
    gente.paso(dt);
    pintar(ahora / 1000);
  };
  requestAnimationFrame(cuadro);
  setInterval(actualizarHud, 1000);
}

/** Se llama con el estado cada vez que llegan datos nuevos de la API. */
export function dibujarMapa({ espacios, recursos, incidencias, reservas, fecha }) {
  const ubicados = new Map();
  const sinUbicar = [];
  const ahora = ahoraBogota();
  // Las reservas cargadas son del día que muestra la línea de tiempo: solo cuentan si es hoy
  const deHoy = fecha === hoyISO() ? reservas : [];

  for (const espacio of espacios) {
    const salaId = salaDe(espacio, ubicados);
    const info = {
      espacio,
      estado: estadoVisual(espacio),
      equipos: recursos.filter((r) => r.espacioId === espacio.id),
      abiertas: incidencias.filter((i) => i.espacioId === espacio.id && i.estado !== 'resuelta').length,
      activa: deHoy.find((r) => r.espacioId === espacio.id && r.inicio <= ahora && ahora < r.fin),
      proxima: deHoy.filter((r) => r.espacioId === espacio.id && r.inicio > ahora).sort((a, b) => a.inicio.localeCompare(b.inicio))[0],
    };
    info.asistentes = info.activa?.asistentes;
    if (salaId) ubicados.set(salaId, info);
    else sinUbicar.push(info);
  }

  salas = ubicados;
  gente.actualizarSalas(salas);
  dibujarLista(espacios, sinUbicar);
  actualizarHud();
}

// Estado visual: combina el estado del backend con "ocupado ahora"
export function estadoVisual(espacio) {
  if (espacio.estado === 'inhabilitado') return 'inhabilitado';
  if (espacio.estado === 'inconsistente') return 'inconsistente';
  if (espacio.ocupadoAhora) return 'ocupada';
  return 'disponible';
}

// Sala del plano para un espacio: por id conocido o por nombre; una sala por espacio
function salaDe(espacio, yaUbicados) {
  const normal = (texto) => String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const candidata = SALA_POR_ESPACIO[espacio.id]
    ?? plano.areas.find((a) => !a.esZona && (normal(a.nombre) === normal(espacio.nombre) || a.id === espacio.id))?.id;
  return candidata && !yaUbicados.has(candidata) ? candidata : null;
}

// ---------- Lista accesible bajo el mapa ----------

function dibujarLista(espacios, sinUbicar) {
  const lista = contenedor();
  if (!espacios.length) {
    lista.replaceChildren(el('p', { className: 'vacio' }, 'No hay espacios cargados. Revisa la pestaña Datos o restaura los datos iniciales.'));
    return;
  }

  const botones = [...salas].map(([salaId, info]) => botonSala(info, salaId));
  lista.replaceChildren(...botones, ...sinUbicar.map((info) => botonSala(info, null)));
}

function botonSala({ espacio, estado, abiertas }, salaId) {
  const area = salaId ? plano.areas.find((a) => a.id === salaId) : null;
  const detalle = !area ? 'Sin ubicar en el plano' : area.rotulo ? `${area.area ?? '¿?'} m²` : area.nombre;
  return el('button',
    {
      type: 'button',
      className: 'chip-sala',
      dataset: { estado, id: espacio.id },
      title: estado === 'inconsistente' ? 'Este espacio tiene datos inconsistentes y no se puede asignar.' : `Reservar ${espacio.nombre}`,
      'aria-label': `${espacio.nombre}, ${detalle}, aforo ${espacio.aforo ?? 'desconocido'}, ${TEXTO_ESTADO[estado]}${abiertas ? `, ${abiertas} incidencias abiertas` : ''}`,
      onClick: () => {
        if (area) camara.enfocar(cajaPx(area));
        seleccionar(espacio, salaId);
      },
      onMouseenter: () => { resaltadaDesdeLista = salaId; },
      onMouseleave: () => { resaltadaDesdeLista = null; },
      onFocus: () => { resaltadaDesdeLista = salaId; },
      onBlur: () => { resaltadaDesdeLista = null; },
    },
    el('span', { className: 'chip-sala__punto', 'aria-hidden': 'true' }),
    el('span', { className: 'chip-sala__nombre' }, nombreVisible(espacio)),
    el('span', { className: 'chip-sala__detalle' }, detalle),
    abiertas ? el('span', { className: 'chip-sala__alerta', 'aria-hidden': 'true' }, `!${abiertas}`) : null,
  );
}

function seleccionar(espacio, salaId) {
  if (espacio.estado === 'inconsistente') return;
  seleccionada = salaId;
  document.dispatchEvent(new CustomEvent('espacio-seleccionado', { detail: espacio }));
}

// ---------- Interacción con el lienzo ----------

function queHayEn(sx, sy) {
  const { x, y } = camara.aMundo(sx, sy);
  const persona = gente.personaEn(x, y);
  if (persona) return { tipo: 'persona', persona, sx, sy };
  const area = plano.areaEn(Math.floor(x / BALDOSA), Math.floor(y / BALDOSA));
  if (!area) return null;
  if (salas.has(area.id)) return { tipo: 'sala', area, info: salas.get(area.id), sx, sy };
  if (area.nombre) return { tipo: 'zona', area, sx, sy };
  return null;
}

function clicEn(sx, sy) {
  const lugar = queHayEn(sx, sy);
  const objetivo = lugar?.tipo === 'persona' ? queHayDebajo(sx, sy) : lugar;
  if (objetivo?.tipo === 'sala') seleccionar(objetivo.info.espacio, objetivo.area.id);
}

// Al hacer clic sobre una persona dentro de una sala, cuenta como clic en la sala
function queHayDebajo(sx, sy) {
  const { x, y } = camara.aMundo(sx, sy);
  const area = plano.areaEn(Math.floor(x / BALDOSA), Math.floor(y / BALDOSA));
  return area && salas.has(area.id) ? { tipo: 'sala', area, info: salas.get(area.id) } : null;
}

function actualizarCursor() {
  const sala = encima?.tipo === 'sala' || (encima?.tipo === 'persona' && queHayDebajo(encima.sx, encima.sy));
  if (sala) lienzo.dataset.sobreSala = '';
  else delete lienzo.dataset.sobreSala;
  dibujarTooltip();
}

function dibujarTooltip() {
  const tooltip = document.getElementById('mapa-tooltip');
  if (!encima) { tooltip.hidden = true; return; }

  let contenido;
  if (encima.tipo === 'persona') {
    const { persona } = encima;
    const info = persona.clase ? salas.get(persona.clase) : null;
    const clase = info ? nombreVisible(info.espacio) : null;
    contenido = persona.rol === 'diego'
      ? [el('strong', {}, 'Diego Tarazona'), el('span', {}, 'Fundador de Campuslands · En reunión en la sala de juntas')]
      : persona.rol === 'trabajador'
      ? [el('strong', {}, 'Trabajador'), el('span', {}, 'Bettermedia · zona privada')]
      : persona.rol === 'trabajadora'
      ? [el('strong', {}, 'Trabajadora'), el('span', {}, 'En su puesto de Houston')]
      : [
        el('strong', {}, persona.rol === 'profe' ? 'Profe' : 'Camper'),
        el('span', {}, persona.nota ?? (clase ? `En clase en ${clase}` : persona.saliendo ? 'Saliendo del piso' : 'En zona común')),
      ];
  } else if (encima.tipo === 'zona') {
    const { area } = encima;
    contenido = [
      el('strong', {}, area.nombre),
      el('span', {}, [area.area ? `${area.area} m²` : null, area.privada ? 'Zona privada' : 'Zona común'].filter(Boolean).join(' · ')),
    ];
  } else {
    const { area, info } = encima;
    const { espacio, estado, equipos, abiertas } = info;
    contenido = [
      el('strong', {}, nombreVisible(espacio)),
      el('span', {}, [area.rotulo ? null : area.nombre, area.area ? `${area.area} m²` : null].filter(Boolean).join(' · ')),
      el('span', { className: 'dato' }, `Aforo ${Number.isFinite(espacio.aforo) ? espacio.aforo : '¿?'} · ${TEXTO_ESTADO[estado]}`),
      typeof espacio.computadores === 'boolean'
        ? el('span', {}, espacio.computadores ? 'Con computadores' : 'Sin computadores')
        : null,
      equipos.length ? el('ul', { className: 'mapa-tooltip__equipos' },
        equipos.map((equipo) => el('li', {},
          el('span', { className: 'equipo', dataset: { estado: equipo.estado } }),
          `${equipo.nombre}: ${etiqueta(ESTADOS_RECURSO, equipo.estado)}`))) : null,
      abiertas ? el('span', { className: 'mapa-tooltip__alerta' }, `${abiertas} incidencia${abiertas > 1 ? 's' : ''} abierta${abiertas > 1 ? 's' : ''}`) : null,
      estado !== 'inconsistente' ? el('span', { className: 'mapa-tooltip__pista' }, 'Clic para reservar') : null,
    ];
  }

  tooltip.replaceChildren(...contenido.filter(Boolean));
  tooltip.dataset.estado = encima.tipo === 'sala' ? encima.info.estado : '';
  tooltip.hidden = false;
  // Se pega al puntero sin salirse del recuadro del mapa
  const ancho = lienzo.clientWidth, alto = lienzo.clientHeight;
  const { offsetWidth: tw, offsetHeight: th } = tooltip;
  tooltip.style.left = `${Math.min(ancho - tw - 8, encima.sx + 14)}px`;
  tooltip.style.top = `${encima.sy + th + 20 > alto ? encima.sy - th - 10 : encima.sy + 16}px`;
}

function actualizarHud() {
  const hud = document.getElementById('mapa-hud');
  if (!hud || !gente) return;
  const { profes, campers, trabajadores } = gente.contar();
  const enClase = [...salas.values()].filter((s) => s.estado === 'ocupada').length;
  hud.textContent = `Nivel 6 · Torre Zenith  ·  ${profes} profes  ·  ${campers} campers  ·  ${trabajadores} en Bettermedia  ·  ${enClase} ${enClase === 1 ? 'clase' : 'clases'} en curso`;
}

// ---------- Dibujo de cada cuadro ----------

function redimensionar() {
  const dpr = window.devicePixelRatio || 1;
  const ancho = lienzo.clientWidth, alto = lienzo.clientHeight;
  lienzo.width = Math.round(ancho * dpr);
  lienzo.height = Math.round(alto * dpr);
  camara.ajustarVista(ancho, alto);
  pintar(performance.now() / 1000);
}

function pintar(t) {
  const dpr = window.devicePixelRatio || 1;
  const { x, y, zoom } = camara.estado;
  const escala = dpr * zoom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0f15';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);

  ctx.setTransform(escala, 0, 0, escala, -x * escala, -y * escala);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mundo, 0, 0);
  pintarSalas(t, zoom);
  gente.dibujar(ctx);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pintarEtiquetas(zoom);
  pintarNombres(zoom);
}

// Nombre sobre la cabeza de las personas con nombre propio (Diego Tarazona)
function pintarNombres(zoom) {
  if (zoom < 0.45) return;
  ctx.font = '700 10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const persona of gente.destacados()) {
    const sx = (persona.x * BALDOSA - camara.estado.x) * zoom;
    const sy = (persona.y * BALDOSA - 12 - camara.estado.y) * zoom - 10;
    const texto = 'DIEGO TARAZONA';
    const w = ctx.measureText(texto).width + 10;
    ctx.fillStyle = 'rgba(11, 15, 21, 0.9)';
    ctx.strokeStyle = COLOR_PROFE; // turquesa de Campuslands (el violeta es solo para la IA)
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(sx - w / 2, sy - 8, w, 16, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e7eaef';
    ctx.fillText(texto, sx, sy + 0.5);
  }
  ctx.textAlign = 'left';
}

function pintarSalas(t, zoom) {
  const grosor = 2 / zoom; // 2 px de pantalla, sin importar el zoom
  const resaltada = resaltadaDesdeLista ?? (encima?.tipo === 'sala' ? encima.area.id : null);

  for (const [salaId, { estado }] of salas) {
    const forma = caminos.get(salaId);
    const color = colores[estado];
    const activa = salaId === resaltada;

    ctx.globalAlpha = { disponible: 0.1, ocupada: 0.16, inhabilitado: 0.12, inconsistente: 0.5 }[estado] + (activa ? 0.12 : 0);
    ctx.fillStyle = estado === 'inconsistente' ? '#10141a' : color;
    ctx.fill(forma);
    if (estado === 'inhabilitado') {
      ctx.globalAlpha = reducirMovimiento ? 0.35 : 0.25 + 0.2 * Math.sin(t * 4);
      ctx.fillStyle = rayas;
      ctx.fill(forma);
    }

    ctx.globalAlpha = activa ? 1 : 0.85;
    ctx.strokeStyle = activa ? '#ffffff' : color;
    ctx.lineWidth = grosor * (activa ? 1.5 : 1);
    ctx.setLineDash(estado === 'inconsistente' ? [6 / zoom, 4 / zoom] : []);
    ctx.stroke(forma);

    if (salaId === seleccionada) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colores.ia;
      ctx.lineWidth = grosor * 1.5;
      ctx.setLineDash([8 / zoom, 6 / zoom]);
      ctx.lineDashOffset = reducirMovimiento ? 0 : -t * 20 / zoom;
      ctx.stroke(forma);
      ctx.lineDashOffset = 0;
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Nombres en coordenadas de pantalla (no se pixelan con el zoom).
// Si dos etiquetas se pisan, gana la que se dibujó primero.
function pintarEtiquetas(zoom) {
  const ocupadas = [];
  const libre = (r) => !ocupadas.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  const aPantalla = (wx, wy) => ({ x: (wx - camara.estado.x) * zoom, y: (wy - camara.estado.y) * zoom });
  const resaltada = resaltadaDesdeLista ?? (encima?.tipo === 'sala' ? encima.area.id : null);
  const detalle = zoom >= ZOOM_DETALLE;

  // Salas de la API: de la resaltada a la más grande
  const orden = [...salas].sort(([a], [b]) => (b === resaltada) - (a === resaltada)
    || areaDe(b).caja.w * areaDe(b).caja.h - areaDe(a).caja.w * areaDe(a).caja.h);

  for (const [salaId, info] of orden) {
    const area = areaDe(salaId);
    const caja = cajaPx(area);
    const centro = aPantalla(caja.x + caja.w / 2, caja.y + caja.h / 2);
    const nombre = nombreVisible(info.espacio).toUpperCase();
    // Las salas con reserva hoy siempre muestran cuándo, aunque el zoom sea bajo
    const segunda = info.estado === 'ocupada' && info.activa
      ? `Ocupada hasta ${info.activa.fin.slice(11, 16)}`
      : info.proxima && info.estado !== 'inhabilitado'
        ? `Reservada ${info.proxima.inicio.slice(11, 16)}–${info.proxima.fin.slice(11, 16)}`
        : detalle || salaId === resaltada
          ? `${Number.isFinite(info.espacio.aforo) ? info.espacio.aforo : '¿?'} puestos · ${TEXTO_ESTADO[info.estado]}`
          : null;

    ctx.font = '700 13px "IBM Plex Mono", monospace';
    const anchoNombre = ctx.measureText(nombre).width;
    ctx.font = '500 11px "IBM Plex Mono", monospace';
    const anchoSegunda = segunda ? ctx.measureText(segunda).width : 0;
    const w = Math.max(anchoNombre + (info.abiertas ? 26 : 0), anchoSegunda) + 16;
    const h = segunda ? 36 : 22;
    // Pegada al muro de arriba para no tapar la clase (el auditorio, con su arco, va al centro)
    const arriba = area.w ? aPantalla(0, caja.y).y + h / 2 + 8 : centro.y;
    const r = { x: centro.x - w / 2, y: Math.min(centro.y, arriba) - h / 2, w, h };
    if (salaId !== resaltada && !libre(r)) continue;
    ocupadas.push(r);

    ctx.fillStyle = 'rgba(11, 15, 21, 0.86)';
    ctx.strokeStyle = colores[info.estado];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '700 13px "IBM Plex Mono", monospace';
    ctx.fillStyle = info.estado === 'inconsistente' ? colores.tenue : '#e7eaef';
    ctx.fillText(nombre, r.x + 8, r.y + 11);
    if (info.abiertas) {
      const bx = r.x + 8 + anchoNombre + 6;
      ctx.fillStyle = colores.inhabilitado;
      ctx.beginPath();
      ctx.roundRect(bx, r.y + 4, 20, 14, 7);
      ctx.fill();
      ctx.fillStyle = '#10141a';
      ctx.font = '700 10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`!${info.abiertas}`, bx + 10, r.y + 11.5);
      ctx.textAlign = 'left';
    }
    if (segunda) {
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = colores[info.estado];
      ctx.fillText(segunda, r.x + 8, r.y + 26);
    }
  }

  // Zonas comunes y salas que no son de la API: texto tenue, solo si cabe
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 11px "IBM Plex Mono", monospace';
  for (const area of plano.areas) {
    if (!area.nombre || salas.has(area.id)) continue;
    const caja = cajaPx(area);
    const texto = area.nombre.toUpperCase();
    const w = ctx.measureText(texto).width + 10;
    if (caja.w * zoom < w || caja.h * zoom < 16) continue;
    const centro = aPantalla(caja.x + caja.w / 2, caja.y + caja.h / 2);
    const r = { x: centro.x - w / 2, y: centro.y - 8, w, h: 16 };
    if (!libre(r)) continue;
    ocupadas.push(r);
    ctx.fillStyle = 'rgba(11, 15, 21, 0.55)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(231, 234, 239, 0.8)';
    ctx.fillText(texto, centro.x, centro.y + 1);
  }
  ctx.textAlign = 'left';
}

// ---------- Utilidades ----------

const areaDe = (id) => plano.areas.find((a) => a.id === id);

// estado.js ya traduce los nombres de las salas renombradas; esto solo cubre datos sin nombre
const nombreVisible = (espacio) => String(espacio.nombre ?? espacio.id);

// Caja de un área en px de mundo (las zonas usan su rectángulo principal)
function cajaPx(area) {
  const c = area.caja ?? { x: area.rects[0][0], y: area.rects[0][1], w: area.rects[0][2], h: area.rects[0][3] };
  return { x: c.x * BALDOSA, y: c.y * BALDOSA, w: c.w * BALDOSA, h: c.h * BALDOSA };
}

// Forma de un área como Path2D: tramos horizontales de baldosas
function formaDe(area) {
  const forma = new Path2D();
  if (area.esZona) {
    for (const [x, y, w, h] of area.rects) forma.rect(x * BALDOSA, y * BALDOSA, w * BALDOSA, h * BALDOSA);
    return forma;
  }
  if (area.w) {
    forma.rect(area.x * BALDOSA, area.y * BALDOSA, area.w * BALDOSA, area.h * BALDOSA);
    return forma;
  }
  const { x: x0, y: y0, w, h } = area.caja;
  for (let y = y0; y < y0 + h; y++) {
    let inicio = null;
    for (let x = x0; x <= x0 + w; x++) {
      const dentro = x < x0 + w && area.contiene(x, y);
      if (dentro && inicio === null) inicio = x;
      if (!dentro && inicio !== null) {
        forma.rect(inicio * BALDOSA, y * BALDOSA, (x - inicio) * BALDOSA, BALDOSA);
        inicio = null;
      }
    }
  }
  return forma;
}

// Los colores de estado salen de los tokens de styles.css
function leerColores() {
  const css = getComputedStyle(document.documentElement);
  const token = (nombre, respaldo) => css.getPropertyValue(nombre).trim() || respaldo;
  return {
    disponible: token('--disponible', '#3fb68b'),
    ocupada: token('--ocupada', '#e8a33d'),
    inhabilitado: token('--inhabilitado', '#ef5350'),
    inconsistente: token('--inconsistente', '#6c7482'),
    tenue: token('--tenue', '#8d97a6'),
    ia: token('--ia', '#9a8cff'),
  };
}

// Rayas diagonales para las salas fuera de servicio
function crearRayas(color) {
  const muestra = document.createElement('canvas');
  muestra.width = muestra.height = 16;
  const c = muestra.getContext('2d');
  c.strokeStyle = color;
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(-4, 20); c.lineTo(20, -4);
  c.moveTo(-4, 4); c.lineTo(4, -4);
  c.moveTo(12, 20); c.lineTo(20, 12);
  c.stroke();
  return ctx.createPattern(muestra, 'repeat');
}
