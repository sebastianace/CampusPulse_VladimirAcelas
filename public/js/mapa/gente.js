// Profes y campers que caminan por el piso.
//
// - Un grupo "libre" pasea por las zonas comunes (Central 1 y 2, Hunters,
//   Bermedia, pasillos): se sienta un rato, va al baño, juega ping-pong…
// - Cada sala ocupada ahora (reserva en curso) tiene su clase: un profe al
//   frente y campers sentados. Si la reserva termina o la sala se inhabilita,
//   salen hacia los ascensores y desaparecen.
//
// Es decoración con sentido: refleja los datos, pero no los modifica.

import { ASCENSORES } from './plano.js';
import { BALDOSA } from './pixel.js';

const VELOCIDAD = 3.4;          // baldosas por segundo (~1,7 m/s)
const POBLACION_LIBRE = 38;     // personas paseando sin clase
const PROPORCION_PROFES = 0.15; // del grupo libre
const MAX_POR_CLASE = 60;       // tope de personas dibujadas por clase (rinde en el auditorio)
const LLEGADAS_POR_REVISION = 3; // cuántos salen del ascensor a la vez (llegan en fila, no en bloque)
const RECONCILIAR_CADA = 0.6;   // s entre revisiones de cuánta gente debería haber

// Zonas donde la gente pasa el rato sin reservar nada
const ZONAS_COMUNES = new Set(['central1', 'central2', 'pasilloEste', 'hunters',
  'sala113', 'recepcion', 'lobby', 'cabinas', 'clonai', 'houston', 'amarilla1', 'amarilla2', 'amarilla3', 'amarilla4', 'banosN', 'banosSO', 'banosSE']);

const PIELES = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d4a373'];
const PELOS = ['#1b1b1b', '#3b2a1a', '#6b4423', '#a0522d', '#d6b370', '#2b2b2b', '#5b3a29'];
const CAMISAS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#f1f5f9', '#0ea5e9', '#22c55e', '#f97316'];
const PANTALONES = ['#1e293b', '#334155', '#1e3a8a', '#3f3f46', '#57534e'];
const MOCHILAS = ['#0f172a', '#7c2d12', '#14532d', '#1e1b4b', '#713f12', '#374151'];
export const COLOR_PROFE = '#1fb5a6';  // cinta y escarapela de los profes

// Bettermedia: oficina privada de una empresa. Sus trabajadores llegan ya
// sentados y no salen de ahí; nadie más entra.
const ZONA_PRIVADA = 'bermedia';
const OCUPACION_PRIVADA = 0.85;        // parte de los puestos con alguien trabajando
const COLOR_TRABAJADOR = '#e8458b';    // cinta de Bettermedia
const CAMISAS_OFICINA = ['#e2e8f0', '#bfdbfe', '#cbd5e1', '#f8fafc', '#1e3a8a', '#334155'];

// Reunión permanente en la sala de juntas, presidida por Diego Tarazona (fundador de Campuslands)
const ASISTENTES_REUNION = 7;
const NOTA_REUNION = 'En reunión con Diego Tarazona';

const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];
const entre = (a, b) => a + Math.random() * (b - a);

export function crearGente(plano, { movimiento = true } = {}) {
  const { ancho } = plano;
  const personas = [];
  const asientosTomados = new Set();
  const clases = new Map();            // salaId -> { sala, objetivo }
  const ruta = crearBuscador(plano);
  let siguienteId = 1;
  let reloj = 0;
  // En la primera carga la gente aparece ya en su sitio; después llega por los ascensores
  let clasesListas = false;
  let libresListos = false;
  let privadaLista = false;

  const asientosComunes = plano.asientos.filter((a) => ZONAS_COMUNES.has(a.area));
  const puntosComunes = plano.puntos.filter((p) => ZONAS_COMUNES.has(p.area) || p.area === 'pasilloOeste');
  const asientosDe = (salaId) => plano.asientos.filter((a) => a.area === salaId);
  const clave = (p) => p.y * ancho + p.x;

  // ---------- Altas y bajas ----------

  function nacer(rol, lugar, clase = null) {
    const persona = {
      id: siguienteId++,
      rol,
      clase,
      sprite: crearSprite(rol),
      x: lugar.x + 0.5,
      y: lugar.y + 0.5,
      mira: lugar.mira ?? 's',
      estado: 'espera',
      espera: 0,
      camino: null,
      paso: 0,
      fase: Math.random() * 10,
      opacidad: lugar.desdeAscensor ? 0 : 1,
      destino: null,
      saliendo: false,
    };
    personas.push(persona);
    return persona;
  }

  // Manda a alguien a un lugar. Si no hay camino, devuelve false.
  function ir(persona, destino) {
    soltarAsiento(persona);
    const desde = Math.floor(persona.y) * ancho + Math.floor(persona.x);
    const camino = ruta(desde, clave(destino));
    if (!camino) return false;
    if (destino.tipo === 'asiento') asientosTomados.add(clave(destino));
    persona.destino = destino;
    persona.camino = camino;
    persona.paso = 1;
    persona.estado = 'camina';
    return true;
  }

  // Ubica a alguien directamente en su destino (carga inicial o sin animación)
  function ubicar(persona, destino) {
    soltarAsiento(persona);
    if (destino.tipo === 'asiento') asientosTomados.add(clave(destino));
    persona.destino = destino;
    persona.x = destino.x + 0.5;
    persona.y = destino.y + 0.5;
    llegar(persona);
  }

  function soltarAsiento(persona) {
    if (persona.destino?.tipo === 'asiento') asientosTomados.delete(clave(persona.destino));
  }

  function salir(persona) {
    persona.saliendo = true;
    const ascensor = azar(ASCENSORES);
    if (!movimiento || !ir(persona, { ...ascensor, tipo: 'salida' })) quitar(persona);
  }

  function quitar(persona) {
    soltarAsiento(persona);
    personas.splice(personas.indexOf(persona), 1);
  }

  function llegar(persona) {
    const { destino } = persona;
    persona.camino = null;
    if (destino.tipo === 'salida') { quitar(persona); return; }
    persona.mira = destino.mira ?? persona.mira;
    persona.estado = destino.tipo === 'asiento' && !destino.dePie ? 'sentada' : 'espera';
    // Los de una clase se quedan hasta que la clase termine
    persona.espera = persona.clase ? Infinity
      : destino.tipo === 'asiento' ? entre(10, 35) : entre(3, 9);
  }

  // ---------- Elegir destinos ----------

  function asientoLibre(lista) {
    for (let intento = 0; intento < 12; intento++) {
      const asiento = azar(lista);
      if (asiento && !asientosTomados.has(clave(asiento))) return { ...asiento, tipo: 'asiento' };
    }
    return null;
  }

  function paseo() {
    if (Math.random() < 0.25 && puntosComunes.length) return { ...azar(puntosComunes), tipo: 'punto' };
    return asientoLibre(asientosComunes);
  }

  function pasearOtraVez(persona) {
    if (Math.random() < 0.06) { salir(persona); return; } // a veces alguien se va del piso
    const destino = paseo();
    if (!destino || !ir(persona, destino)) persona.espera = entre(1, 3);
  }

  // ---------- Cuánta gente debería haber ----------

  /**
   * salas: Map salaId -> { estado, asistentes } para las salas ligadas a la API.
   * Solo cuenta 'ocupada' (con clase) e 'inhabilitado' (nadie adentro).
   */
  function actualizarSalas(salas) {
    for (const [salaId, info] of salas) {
      const sala = plano.areas.find((a) => a.id === salaId);
      if (!sala) continue;
      const lugares = asientosDe(salaId).length;
      // Una persona por asistente de la reserva (+ el profe), hasta llenar los puestos de la sala
      const asistentes = info.asistentes ?? Math.round(lugares * 0.6);
      const objetivo = info.estado === 'ocupada'
        ? Math.min(MAX_POR_CLASE, lugares + (sala.profe ? 1 : 0), Math.max(1, asistentes) + (sala.profe ? 1 : 0))
        : 0;
      clases.set(salaId, { sala, objetivo, inhabilitada: info.estado === 'inhabilitado' });
    }
    // Salas que ya no llegan en los datos: la clase termina
    for (const [salaId, clase] of clases) if (!salas.has(salaId)) clase.objetivo = 0;
    reconciliar();
    clasesListas = true;
  }

  function reconciliar() {
    const inicial = !clasesListas || !movimiento;

    for (const [salaId, { sala, objetivo, inhabilitada }] of clases) {
      const miembros = personas.filter((p) => p.clase === salaId && !p.saliendo);
      // Al inhabilitarse una sala salen también los que pasaban por ahí
      if (inhabilitada) {
        personas.filter((p) => !p.saliendo && p.destino?.area === salaId).forEach(salir);
      }
      if (miembros.length > objetivo) {
        // Primero se van los campers; el profe es el último. Si la sala se
        // inhabilitó, evacúan; si la clase terminó, vuelven a pasear por el piso.
        miembros.sort((a, b) => (a.rol === 'profe') - (b.rol === 'profe'));
        for (const persona of miembros.slice(0, miembros.length - objetivo)) {
          if (inhabilitada) { salir(persona); continue; }
          persona.clase = null;
          pasearOtraVez(persona);
        }
        continue;
      }
      let llegadas = 0;
      for (let k = miembros.length; k < objetivo; k++) {
        const tieneProfe = miembros.some((p) => p.rol === 'profe');
        const esProfe = !tieneProfe && sala.profe;
        const destino = esProfe ? { ...sala.profe, area: salaId, tipo: 'punto' } : asientoLibre(asientosDe(salaId));
        if (!destino) break;
        if (inicial) {
          const persona = nacer(esProfe ? 'profe' : 'camper', destino, salaId);
          miembros.push(persona);
          ubicar(persona, destino);
          continue;
        }
        // Primero va caminando quien esté paseando más cerca de la sala
        const cercano = masCercano(sala, esProfe ? 'profe' : 'camper');
        if (cercano) {
          cercano.clase = salaId;
          miembros.push(cercano);
          if (ir(cercano, destino)) continue;
          cercano.clase = null;
          miembros.pop();
        }
        // Si no hay nadie libre cerca, llega alguien por los ascensores (unos pocos por vez)
        if (llegadas >= LLEGADAS_POR_REVISION) break;
        llegadas++;
        const persona = nacer(esProfe ? 'profe' : 'camper', { ...azar(ASCENSORES), desdeAscensor: true }, salaId);
        miembros.push(persona);
        if (!ir(persona, destino)) ubicar(persona, destino);
      }
    }

    // Trabajadores de Bettermedia: se sientan una sola vez y no se mueven
    if (!privadaLista) {
      privadaLista = true;
      const puestos = asientosDe(ZONA_PRIVADA).sort(() => Math.random() - 0.5);
      for (const asiento of puestos.slice(0, Math.round(puestos.length * OCUPACION_PRIVADA))) {
        const destino = { ...asiento, tipo: 'asiento' };
        ubicar(nacer('trabajador', destino, ZONA_PRIVADA), destino);
      }
      // La trabajadora de Houston: siempre en el mismo puesto
      const puesto = asientosDe('houston').find((a) => !asientosTomados.has(clave(a)));
      if (puesto) {
        const destino = { ...puesto, tipo: 'asiento' };
        ubicar(nacer('trabajadora', destino, 'houston'), destino);
      }
      // Diego en la cabecera de la sala de juntas y su equipo alrededor
      const juntas = plano.areas.find((s) => s.id === 'juntas');
      if (juntas?.cabecera) {
        const cabecera = { ...juntas.cabecera, area: 'juntas', tipo: 'asiento' };
        ubicar(nacer('diego', cabecera, 'juntas'), cabecera);
        const sillas = asientosDe('juntas').filter((a) => !asientosTomados.has(clave(a)));
        for (const asiento of sillas.sort(() => Math.random() - 0.5).slice(0, ASISTENTES_REUNION)) {
          const destino = { ...asiento, tipo: 'asiento' };
          const persona = nacer('profe', destino, 'juntas');
          persona.nota = NOTA_REUNION;
          ubicar(persona, destino);
        }
      }
    }

    // Grupo libre
    const inicialLibres = !libresListos || !movimiento;
    libresListos = true;
    const libres = personas.filter((p) => !p.clase && !p.saliendo);
    // Si al terminar una clase sobra gente paseando, se van de a uno por los ascensores
    if (libres.length > POBLACION_LIBRE) salir(azar(libres));
    for (let k = libres.length, nuevos = 0; k < POBLACION_LIBRE && (inicialLibres || nuevos < LLEGADAS_POR_REVISION); k++, nuevos++) {
      const destino = paseo();
      if (!destino) break;
      const rol = Math.random() < PROPORCION_PROFES ? 'profe' : 'camper';
      const persona = nacer(rol, inicialLibres ? destino : { ...azar(ASCENSORES), desdeAscensor: true });
      if (inicialLibres || !ir(persona, destino)) ubicar(persona, destino);
      // Al empezar, que no todos se levanten al mismo tiempo
      if (inicialLibres) persona.espera = entre(0, 25);
    }
  }

  // Persona paseando (sin clase) más cerca del centro de una sala, del rol pedido
  function masCercano(sala, rol) {
    const cx = sala.caja.x + sala.caja.w / 2, cy = sala.caja.y + sala.caja.h / 2;
    let mejor = null, distancia = Infinity;
    for (const p of personas) {
      if (p.clase || p.saliendo || p.rol !== rol) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < distancia) { mejor = p; distancia = d; }
    }
    return mejor;
  }

  // ---------- Animación ----------

  function paso(dt) {
    reloj += dt;
    if (reloj >= RECONCILIAR_CADA) { reloj = 0; reconciliar(); }
    if (!movimiento) return;

    for (const persona of [...personas]) {
      persona.fase += dt;
      if (persona.opacidad < 1) persona.opacidad = Math.min(1, persona.opacidad + dt * 2.5);

      if (persona.estado === 'camina') {
        caminar(persona, dt);
      } else if (!persona.clase) {
        persona.espera -= dt;
        if (persona.espera <= 0) pasearOtraVez(persona);
      }
    }
  }

  function caminar(persona, dt) {
    let avance = VELOCIDAD * dt;
    while (avance > 0 && persona.camino) {
      const siguiente = persona.camino[persona.paso];
      const tx = (siguiente % ancho) + 0.5;
      const ty = Math.floor(siguiente / ancho) + 0.5;
      const dx = tx - persona.x, dy = ty - persona.y;
      const distancia = Math.hypot(dx, dy);
      if (distancia > 0.001) persona.mira = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'o') : (dy > 0 ? 's' : 'n');
      if (distancia <= avance) {
        persona.x = tx; persona.y = ty;
        avance -= distancia;
        persona.paso++;
        if (persona.paso >= persona.camino.length) llegar(persona);
      } else {
        persona.x += (dx / distancia) * avance;
        persona.y += (dy / distancia) * avance;
        avance = 0;
      }
    }
  }

  // ---------- Dibujo (en coordenadas de mundo) ----------

  function dibujar(ctx) {
    const orden = [...personas].sort((a, b) => a.y - b.y);
    for (const p of orden) {
      const sentada = p.estado === 'sentada';
      const cx = Math.round(p.x * BALDOSA);
      const cy = Math.round(p.y * BALDOSA);
      ctx.globalAlpha = p.opacidad;

      // Sombra
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(cx - 5, cy + (sentada ? 3 : 5), 10, 3);

      const fila = { s: 0, n: 1, e: 2, o: 2 }[p.mira] ?? 0;
      const jugando = p.clase && p.destino?.dePie; // en la mesa de ping-pong
      const cuadro = p.estado === 'camina' || jugando ? 1 + (Math.floor(p.fase * (jugando ? 5 : 8)) % 2) : 0;
      const alto = sentada ? 12 : 16;
      const y = sentada ? cy - 9 : cy - 10;
      if (p.mira === 'o') {
        ctx.save();
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(p.sprite, cuadro * 12, fila * 16, 12, alto, -6, y, 12, alto);
        ctx.restore();
      } else {
        ctx.drawImage(p.sprite, cuadro * 12, fila * 16, 12, alto, cx - 6, y, 12, alto);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Persona bajo un punto del mundo (px de mundo), para el tooltip. */
  function personaEn(wx, wy) {
    for (let k = personas.length - 1; k >= 0; k--) {
      const p = personas[k];
      if (Math.abs(p.x * BALDOSA - wx) < 7 && wy > p.y * BALDOSA - 11 && wy < p.y * BALDOSA + 7) return p;
    }
    return null;
  }

  return {
    actualizarSalas,
    paso,
    dibujar,
    personaEn,
    /** Personas con nombre propio (para dibujarles una etiqueta encima). */
    destacados: () => personas.filter((p) => p.rol === 'diego'),
    get total() { return personas.length; },
    contar: () => ({
      profes: personas.filter((p) => p.rol === 'profe').length,
      campers: personas.filter((p) => p.rol === 'camper').length,
      trabajadores: personas.filter((p) => p.rol === 'trabajador').length,
    }),
  };
}

// ---------- Caminos: búsqueda en anchura sobre la grilla ----------
// 8 direcciones sin cortar esquinas. Los arreglos se reutilizan entre búsquedas.

function crearBuscador({ ancho, alto, grilla }) {
  const previo = new Int32Array(ancho * alto);
  const visita = new Uint32Array(ancho * alto);
  const cola = new Int32Array(ancho * alto);
  const vecinos = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let marca = 0;

  return function buscar(desde, hasta) {
    if (grilla[hasta]) return null;
    marca++;
    let inicio = 0, fin = 0;
    cola[fin++] = desde;
    visita[desde] = marca;
    previo[desde] = -1;
    while (inicio < fin) {
      const c = cola[inicio++];
      if (c === hasta) break;
      const x = c % ancho, y = (c - x) / ancho;
      for (const [dx, dy] of vecinos) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
        const n = ny * ancho + nx;
        if (visita[n] === marca || grilla[n]) continue;
        if (dx && dy && (grilla[y * ancho + nx] || grilla[ny * ancho + x])) continue;
        visita[n] = marca;
        previo[n] = c;
        cola[fin++] = n;
      }
    }
    if (visita[hasta] !== marca) return null;
    const camino = [];
    for (let c = hasta; c !== -1; c = previo[c]) camino.push(c);
    return camino.reverse();
  };
}

// ---------- Sprites ----------
// Hoja de 3 cuadros (quieto, paso A, paso B) × 3 filas (de frente, de espaldas,
// de lado) de 12×16 px. De lado mirando a la izquierda se espeja al dibujar.

// Diego Tarazona: pelo negro corto, gafas de marco oscuro y camiseta azul de Campuslands
const ASPECTO_DIEGO = {
  piel: '#c68642', pelo: '#141414', camisa: '#1d2a4d', pantalon: '#2b2f3a',
  mochila: null, cinta: null, peloLargo: false, gafas: true, logo: true,
};

function crearSprite(rol) {
  const a = rol === 'diego' ? ASPECTO_DIEGO : {
    piel: azar(PIELES),
    pelo: azar(PELOS),
    camisa: rol === 'profe' ? '#161b26' : rol === 'trabajador' || rol === 'trabajadora' ? azar(CAMISAS_OFICINA) : azar(CAMISAS),
    pantalon: azar(PANTALONES),
    mochila: rol === 'camper' ? azar(MOCHILAS) : null,
    cinta: { profe: COLOR_PROFE, trabajador: COLOR_TRABAJADOR }[rol] ?? null,
    peloLargo: rol === 'trabajadora' || Math.random() < 0.4,
  };
  const lienzo = document.createElement('canvas');
  lienzo.width = 36;
  lienzo.height = 48;
  const ctx = lienzo.getContext('2d');
  ['s', 'n', 'e'].forEach((dir, fila) => {
    for (let cuadro = 0; cuadro < 3; cuadro++) figura(ctx, cuadro * 12, fila * 16, dir, cuadro, a);
  });
  return lienzo;
}

function figura(ctx, ox, oy, dir, cuadro, a) {
  const p = (color, x, y, w = 1, h = 1) => { ctx.fillStyle = color; ctx.fillRect(ox + x, oy + y, w, h); };
  const zapato = '#111318';

  if (dir === 'e') {
    // Piernas
    p(a.pantalon, 5, 11, 3, 3);
    if (cuadro === 0) { p(a.pantalon, 5, 14, 3, 1); p(zapato, 5, 15, 4, 1); }
    else if (cuadro === 1) { p(a.pantalon, 4, 14, 2, 1); p(a.pantalon, 7, 14, 2, 1); p(zapato, 3, 15, 2, 1); p(zapato, 8, 15, 2, 1); }
    else { p(a.pantalon, 5, 14, 3, 1); p(zapato, 6, 15, 3, 1); }
    // Cuerpo, mochila y brazo
    if (a.mochila) p(a.mochila, 2, 6, 3, 5);
    p(a.camisa, 4, 6, 5, 5);
    p(sombrear(a.camisa), cuadro === 1 ? 5 : 6, 7, 2, 4);
    p(a.piel, cuadro === 1 ? 5 : 6, 11, 2, 1);
    if (a.cinta) { p(a.cinta, 7, 6, 1, 3); p('#e5e7eb', 7, 9, 1, 1); }
    if (a.logo) p('#f1f5f9', 5, 8, 3, 1);
    // Cabeza
    p(a.piel, 4, 1, 5, 5);
    p(a.pelo, 4, 0, 5, 2);
    p(a.pelo, 4, 1, 2, a.peloLargo ? 6 : 4);
    p('#1f1f1f', 7, 3);
    if (a.gafas) { p('#0d0d0d', 6, 3, 3, 1); p('#8fb3c9', 7, 3); }
    return;
  }

  // Piernas (de frente o de espaldas)
  p(a.pantalon, 3, 11, 6, 3);
  const izq = cuadro === 2 ? 13 : 15, der = cuadro === 1 ? 13 : 15;
  p(a.pantalon, 3, 14, 2, izq - 14 + 1); p(zapato, 3, izq, 2, 1);
  p(a.pantalon, 7, 14, 2, der - 14 + 1); p(zapato, 7, der, 2, 1);

  // Torso y brazos (los brazos se balancean al caminar)
  p(a.camisa, 3, 6, 6, 1);
  p(a.camisa, 2, 7, 8, 4);
  const bi = cuadro === 1 ? -1 : cuadro === 2 ? 1 : 0;
  p(a.camisa, 1, 7 + bi, 1, 4); p(a.piel, 1, 11 + bi, 1, 1);
  p(a.camisa, 10, 7 - bi, 1, 4); p(a.piel, 10, 11 - bi, 1, 1);

  if (dir === 's') {
    if (a.mochila) { p(a.mochila, 3, 6, 1, 4); p(a.mochila, 8, 6, 1, 4); }
    if (a.cinta) { p(a.cinta, 5, 6, 2, 2); p('#e5e7eb', 5, 8, 2, 2); p(a.cinta, 5, 8, 1, 1); }
    // Cabeza
    p(a.piel, 3, 1, 6, 5);
    p(a.pelo, 3, 0, 6, 2);
    p(a.pelo, 2, 1, 1, a.peloLargo ? 6 : 3); p(a.pelo, 9, 1, 1, a.peloLargo ? 6 : 3);
    p('#1f1f1f', 4, 3); p('#1f1f1f', 7, 3);
    if (a.gafas) { p('#0d0d0d', 3, 3, 6, 1); p('#8fb3c9', 4, 3); p('#8fb3c9', 7, 3); }
    // Casco de astronauta de Campuslands en blanco sobre el pecho
    if (a.logo) { p('#f1f5f9', 5, 7, 2, 1); p('#f1f5f9', 4, 8, 4, 1); }
  } else {
    if (a.mochila) { p(a.mochila, 3, 6, 6, 5); p(sombrear(a.mochila, 1.4), 4, 7, 4, 1); }
    if (a.cinta) p(a.cinta, 4, 6, 4, 1);
    p(a.pelo, 3, 0, 6, 6);
    p(a.pelo, 2, 1, 1, a.peloLargo ? 6 : 3); p(a.pelo, 9, 1, 1, a.peloLargo ? 6 : 3);
    if (!a.peloLargo) p(a.piel, 4, 5, 4, 1);
  }
}

// Oscurece (factor < 1) o aclara (factor > 1) un color #rrggbb
function sombrear(hex, factor = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const canal = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `rgb(${canal(n >> 16)}, ${canal((n >> 8) & 255)}, ${canal(n & 255)})`;
}
