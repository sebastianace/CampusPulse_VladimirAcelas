// Plano del Nivel 6 de la Torre Zenith (Campuslands) convertido a baldosas de juego.
// 1 baldosa ≈ 0,5 m. Medidas tomadas de "Planta arquitectónica Nivel 6 – 2560 m²":
// ala oeste con los salones, núcleo de ascensores y baños, zona central de trabajo
// y, al este, Hunters y el auditorio bajo la fachada semicircular.
//
// Este módulo solo describe el piso: salas, muebles, asientos y qué baldosas se
// pueden caminar. No dibuja nada (eso lo hace pixel.js).

export const ANCHO = 192;
export const ALTO = 94;

// Sala del plano que corresponde a cada espacio de la API (por id).
// Si llega un espacio que no está aquí se busca por nombre; si tampoco
// aparece, se lista debajo del mapa como "sin ubicar".
// Las salas con rotulo: true se muestran en todo el tablero con su nombre del plano
// en vez del de la API (ver nombreEnPlano).
export const SALA_POR_ESPACIO = {
  auditorio: 'auditorio',
  spooki: 'salon2',
  apolo: 'salon3',
  artemis: 'salon4',
  cosmos: 'islas',
  skilab: 'salon1',
  blanca: 'reunionB',
  azul: 'reunionA',
  'amarillas-verdes': 'morado',
  'ping-pong-1': 'pingpong1',
  'ping-pong-2': 'pingpong2',
};

// Silueta del edificio: rectángulos [x, y, ancho, alto] más la fachada semicircular
const HUELLA = [
  [2, 28, 58, 33],   // ala oeste
  [60, 24, 46, 42],  // núcleo (con los balcones de condensadores)
  [90, 61, 22, 31],  // Bermedia
  [106, 29, 56, 20], // franja norte del centro
  [106, 49, 46, 43], // Central 1 y Central 2
  [152, 49, 10, 35], // cabinas, Clonai y sala de juntas
  [161, 28, 24, 32], // Hunters y salas amarillas
  [185, 47, 7, 13],  // escalera de emergencia
  [162, 60, 5, 24],  // condensadores del este
];

// Fachada de vidrio semicircular que cubre el auditorio y Hunters
export const ARCO = { cx: 161.5, cy: 29, r: 24.5 };
const enArco = (x, y) => y + 0.5 < ARCO.cy && (x + 0.5 - ARCO.cx) ** 2 + (y + 0.5 - ARCO.cy) ** 2 <= ARCO.r ** 2;

// Salas con muros. puertas: [lado, desplazamiento, ancho] sobre el borde de la sala.
// frente: hacia dónde miran los asientos de un salón (donde está la pantalla).
const SALAS = [
  // Ala oeste
  { id: 'salon3', nombre: 'Salón 3', area: 96, x: 2, y: 28, w: 26, h: 16, piso: 'alfombra', muro: 'solido', puertas: [['e', 13, 2]], tipo: 'computo', frente: 'n' },
  { id: 'salon4', nombre: 'Salón 4', area: 96, x: 2, y: 44, w: 26, h: 17, piso: 'alfombra', muro: 'solido', puertas: [['e', 1, 3]], tipo: 'computo', frente: 's' },
  { id: 'salon2', nombre: 'Sputnik', rotulo: true, area: 99.7, x: 28, y: 28, w: 26, h: 13, piso: 'alfombra', muro: 'solido', puertas: [['s', 11, 3]], tipo: 'computo', frente: 'n' },
  { id: 'comunicaciones', nombre: 'Comunicaciones', area: 7, x: 54, y: 28, w: 6, h: 10, piso: 'concreto', muro: 'solido', puertas: [['s', 2, 2]], tipo: 'rack' },
  { id: 'houston', nombre: 'Houston', area: 16.2, x: 28, y: 49, w: 7, h: 12, piso: 'alfombra', muro: 'vidrio', puertas: [['n', 2, 2]], tipo: 'reunionOval' },
  { id: 'salon1', nombre: 'Skylabs', rotulo: true, area: 55.2, x: 35, y: 49, w: 23, h: 12, piso: 'alfombra', muro: 'vidrio', puertas: [['n', 3, 3], ['n', 16, 3]], tipo: 'computo', frente: 'n' },
  // Núcleo
  { id: 'electrico', nombre: 'Cuarto eléctrico', x: 60, y: 28, w: 14, h: 4, piso: 'concreto', muro: 'solido', puertas: [], tipo: 'rack' },
  { id: 'banosN', nombre: 'Baños', area: 38.6, x: 90, y: 28, w: 16, h: 11, piso: 'baldosa', muro: 'solido', puertas: [['s', 7, 2]], tipo: 'banos', frente: 'n' },
  { id: 'banosSO', nombre: 'Baños', area: 38.6, x: 60, y: 50, w: 14, h: 11, piso: 'baldosa', muro: 'solido', puertas: [['n', 6, 2]], tipo: 'banos', frente: 's' },
  { id: 'banosSE', nombre: 'Baños', area: 38.6, x: 90, y: 50, w: 16, h: 11, piso: 'baldosa', muro: 'solido', puertas: [['n', 7, 2]], tipo: 'banos', frente: 's' },
  // Centro
  { id: 'sala113', nombre: 'Conexalab', area: 113.8, x: 106, y: 29, w: 31, h: 10, piso: 'madera', muro: 'vidrio', puertas: [['s', 14, 2]], tipo: 'mesasLargas' },
  { id: 'islas', nombre: 'Sala de islas', area: 44.3, x: 106, y: 49, w: 15, h: 11, piso: 'alfombra', muro: 'vidrio', puertas: [['n', 6, 2]], tipo: 'islas' },
  { id: 'bermedia', nombre: 'Bettermedia', privada: true, area: 166.3, x: 90, y: 61, w: 22, h: 31, piso: 'madera', muro: 'solido', puertas: [['e', 1, 3]], tipo: 'bermedia' },
  // Este
  { id: 'morado', nombre: 'Salón Morado', rotulo: true, area: 20.4, x: 137, y: 29, w: 8, h: 11, piso: 'morado', muro: 'vidrio', puertas: [['s', 5, 2]], tipo: 'cabinas' },
  { id: 'reunionA', nombre: 'Sala azul', rotulo: true, area: 25.5, x: 145, y: 29, w: 8, h: 11, piso: 'alfombra', muro: 'vidrio', puertas: [['s', 3, 2]], tipo: 'reunionRedonda' },
  { id: 'reunionB', nombre: 'Sala blanca', rotulo: true, area: 25.2, x: 153, y: 29, w: 8, h: 11, piso: 'alfombra', muro: 'vidrio', puertas: [['s', 3, 2]], tipo: 'reunionRedonda' },
  {
    id: 'auditorio', nombre: 'Auditorio', area: 151.2, piso: 'madera', muro: 'solido', tipo: 'auditorio',
    contiene: (x, y) => enArco(x, y) && x <= 160,
    puertasExtra: [[160, 21], [160, 22], [160, 23]],
  },
  {
    id: 'hunters', nombre: 'Hunters', area: 305.5, piso: 'madera', muro: 'solido', tipo: 'hunters',
    contiene: (x, y) => x >= 161 && x <= 184 && ((y >= 29 && y <= 54) || enArco(x, y)),
    puertasExtra: [
      ...[40, 41, 42, 43, 44, 45, 46, 47].map((y) => [161, y]), // abierta al pasillo
      [161, 21], [161, 22], [161, 23],                         // hacia el auditorio
      [163, 54], [164, 54], [169, 54], [170, 54],              // hacia las salas amarillas
      [175, 54], [176, 54], [181, 54], [182, 54],
    ],
  },
  // Mesas de ping-pong de Hunters: se reservan como una sala, pero sin muros
  // (van después de Hunters para que el clic y el color caigan sobre la mesa)
  ...[1, 2].map((n) => ({
    id: `pingpong${n}`, nombre: `Ping-pong ${n}`, x: n === 1 ? 164 : 176, y: 38, w: 5, h: 9,
    piso: 'madera', muro: 'ninguno', puertas: [], tipo: 'pingpong',
  })),
  // Donde el plano tiene los lockers (42,3 m²): cuatro salitas amarillas
  ...[1, 2, 3, 4].map((n) => ({
    id: `amarilla${n}`, nombre: `Amarilla ${n}`, area: 10.6, x: 161 + (n - 1) * 6, y: 55, w: 6, h: 5,
    piso: 'amarillo', muro: 'vidrio', puertas: [['n', 2, 2]], tipo: 'salaAmarilla',
  })),
  { id: 'cabinas', nombre: 'Cabinas', x: 152, y: 55, w: 9, h: 5, piso: 'alfombra', muro: 'vidrio', puertas: [['o', 2, 1]], tipo: 'cabinasDobles' },
  { id: 'clonai', nombre: 'Clonai', x: 152, y: 60, w: 9, h: 5, piso: 'alfombra', muro: 'vidrio', puertas: [['o', 2, 1]], tipo: 'clonai' },
  { id: 'juntas', nombre: 'Sala de juntas', x: 152, y: 65, w: 9, h: 18, piso: 'alfombra', muro: 'vidrio', puertas: [['o', 8, 2]], tipo: 'juntas' },
];

/** Nombre con que el campus conoce un espacio de la API, o null si se usa el de la API. */
export function nombreEnPlano(espacioId) {
  const sala = SALAS.find((s) => s.id === SALA_POR_ESPACIO[espacioId]);
  return sala?.rotulo ? sala.nombre : null;
}

// Zonas abiertas (sin muros): solo cambian el piso y dan nombre al lugar
const ZONAS = [
  { id: 'pasilloOeste', nombre: 'Pasillo', rects: [[28, 41, 32, 8], [54, 38, 6, 3], [58, 49, 2, 12]], piso: 'madera' },
  { id: 'lobby', nombre: 'Lobby', rects: [[60, 32, 30, 7], [60, 39, 46, 11]], piso: 'concreto' },
  { id: 'pasilloEste', nombre: 'Pasillo de las mesas', rects: [[106, 39, 55, 10]], piso: 'madera' },
  { id: 'recepcion', nombre: 'Cabinas y mesas', rects: [[112, 60, 9, 32]], piso: 'madera' },
  { id: 'central1', nombre: 'Coworking', area: 198, rects: [[121, 49, 16, 43]], piso: 'madera' },
  { id: 'central2', nombre: 'Central 2', area: 209.3, rects: [[137, 49, 15, 43], [152, 49, 9, 6]], piso: 'madera' },
  { id: 'balconN', rects: [[60, 24, 46, 4]], piso: 'balcon', bloquea: true },
  { id: 'balconS', rects: [[60, 61, 30, 5]], piso: 'balcon', bloquea: true },
  { id: 'balconE', rects: [[162, 60, 5, 24]], piso: 'balcon', bloquea: true },
];

// Puertas de los ascensores: por aquí llegan y se van las personas
export const ASCENSORES = [
  { x: 63, y: 37 }, { x: 69, y: 37 }, { x: 81, y: 37 }, { x: 86, y: 37 },
];

/**
 * Construye el plano completo: áreas, muebles, asientos, la grilla de
 * baldosas caminables y el índice "qué área hay en cada baldosa".
 */
export function construirPlano() {
  const areas = [...SALAS.map((s) => prepararSala(s)), ...ZONAS.map((z) => ({ ...z, esZona: true }))];
  const huella = new Uint8Array(ANCHO * ALTO);
  const areaPorBaldosa = new Int16Array(ANCHO * ALTO).fill(-1);

  // Silueta del edificio
  for (const [x, y, w, h] of HUELLA) rellenar(huella, x, y, w, h, 1);
  for (let y = 0; y < ALTO; y++) for (let x = 0; x < ANCHO; x++) if (enArco(x, y)) huella[y * ANCHO + x] = 1;

  // Zonas primero; las salas las pisan
  areas.forEach((area, i) => {
    if (!area.esZona) return;
    for (const [x, y, w, h] of area.rects) rellenar(areaPorBaldosa, x, y, w, h, i);
  });
  areas.forEach((area, i) => {
    if (area.esZona) return;
    recorrer(area, (x, y) => { areaPorBaldosa[y * ANCHO + x] = i; });
  });

  // Grilla caminable: 0 = libre, 1 = bloqueada
  const grilla = new Uint8Array(ANCHO * ALTO);
  for (let i = 0; i < grilla.length; i++) grilla[i] = huella[i] ? 0 : 1;
  areas.forEach((area) => {
    if (area.esZona && area.bloquea) for (const [x, y, w, h] of area.rects) rellenar(grilla, x, y, w, h, 1);
  });
  areas.forEach((area, i) => {
    if (area.esZona) return;
    area.indice = i;
    recorrer(area, (x, y) => {
      if (area.muro === 'ninguno') return;
      if (esBorde(area, x, y) && !area.puertas.has(y * ANCHO + x)) grilla[y * ANCHO + x] = 1;
    });
  });

  const muebles = [];
  const asientos = [];
  const puntos = [];   // lugares donde alguien se para un rato (baños, ping-pong, futbolín…)
  const amueblar = crearAmueblador(muebles, asientos, puntos);
  areas.forEach((area) => GENERADORES[area.tipo ?? area.id]?.(area, amueblar));

  for (const m of muebles) if (m.bloquea) rellenar(grilla, Math.floor(m.x), Math.floor(m.y), Math.ceil(m.w), Math.ceil(m.h), 1);

  // Asientos y puntos solo valen si quedaron en una baldosa libre
  const libre = (p) => p.x >= 0 && p.y >= 0 && p.x < ANCHO && p.y < ALTO && grilla[p.y * ANCHO + p.x] === 0;
  const etiquetar = (p) => ({ ...p, area: areas[areaPorBaldosa[p.y * ANCHO + p.x]]?.id ?? null });

  return {
    ancho: ANCHO,
    alto: ALTO,
    areas,
    huella,
    grilla,
    areaPorBaldosa,
    muebles,
    asientos: asientos.filter(libre).map(etiquetar),
    puntos: puntos.filter(libre).map(etiquetar),
    areaEn(x, y) {
      if (x < 0 || y < 0 || x >= ANCHO || y >= ALTO) return null;
      return areas[areaPorBaldosa[y * ANCHO + x]] ?? null;
    },
  };
}

// ---------- Geometría de las salas ----------

function prepararSala(sala) {
  const puertas = new Set();
  const contiene = sala.contiene ?? ((x, y) => x >= sala.x && x < sala.x + sala.w && y >= sala.y && y < sala.y + sala.h);

  for (const [lado, desde, ancho] of sala.puertas ?? []) {
    for (let k = 0; k < ancho; k++) {
      const [x, y] = {
        n: [sala.x + desde + k, sala.y],
        s: [sala.x + desde + k, sala.y + sala.h - 1],
        o: [sala.x, sala.y + desde + k],
        e: [sala.x + sala.w - 1, sala.y + desde + k],
      }[lado];
      puertas.add(y * ANCHO + x);
    }
  }
  for (const [x, y] of sala.puertasExtra ?? []) puertas.add(y * ANCHO + x);

  // Caja que encierra la sala (para centrar etiquetas y la cámara)
  let caja = sala.w ? { x: sala.x, y: sala.y, w: sala.w, h: sala.h } : null;
  if (!caja) {
    let x0 = ANCHO, y0 = ALTO, x1 = 0, y1 = 0;
    for (let y = 0; y < ALTO; y++) for (let x = 0; x < ANCHO; x++) {
      if (!contiene(x, y)) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    caja = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  return { ...sala, contiene, puertas, caja };
}

// Una baldosa es borde (muro) si algún vecino no pertenece a la sala
function esBorde(sala, x, y) {
  return !sala.contiene(x - 1, y) || !sala.contiene(x + 1, y) || !sala.contiene(x, y - 1) || !sala.contiene(x, y + 1);
}

function recorrer(sala, fn) {
  const { x: x0, y: y0, w, h } = sala.caja;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (sala.contiene(x, y)) fn(x, y);
}

function rellenar(arreglo, x, y, w, h, valor) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (i >= 0 && j >= 0 && i < ANCHO && j < ALTO) arreglo[j * ANCHO + i] = valor;
  }
}

// ---------- Muebles ----------
// Cada mueble: { t: tipo, x, y, w, h, bloquea, ...detalles }.
// Cada asiento: { x, y, mira } con mira = hacia dónde queda mirando quien se sienta.

function crearAmueblador(muebles, asientos, puntos) {
  const poner = (t, x, y, w = 1, h = 1, extra = {}) => {
    const mueble = { t, x, y, w, h, bloquea: true, ...extra };
    muebles.push(mueble);
    return mueble;
  };
  const decorar = (t, x, y, w = 1, h = 1, extra = {}) => poner(t, x, y, w, h, { ...extra, bloquea: false });
  const sentar = (x, y, mira, conSilla = true) => {
    asientos.push({ x, y, mira });
    if (conSilla) decorar('silla', x, y, 1, 1, { mira });
  };
  const parar = (x, y, mira = 's') => puntos.push({ x, y, mira });
  // Lugar reservable donde se está de pie (jugadores de ping-pong)
  const jugar = (x, y, mira) => asientos.push({ x, y, mira, dePie: true });

  // Escritorio de 2 baldosas con sus dos sillas al lado indicado
  const puesto = (x, y, ladoSillas, conMonitor = false) => {
    poner('escritorio', x, y, 2, 1, { monitor: conMonitor, mira: ladoSillas === 1 ? 'n' : 's' });
    sentar(x, y + ladoSillas, ladoSillas === 1 ? 'n' : 's');
    sentar(x + 1, y + ladoSillas, ladoSillas === 1 ? 'n' : 's');
  };

  // Mesa hexagonal con 6 puestos alrededor (centro en la esquina de 4 baldosas)
  const hexagonal = (cx, cy, color) => {
    poner('mesaHex', cx - 1, cy - 1, 2, 2, { color });
    sentar(cx - 1, cy - 2, 's'); sentar(cx, cy - 2, 's');
    sentar(cx - 1, cy + 1, 'n'); sentar(cx, cy + 1, 'n');
    sentar(cx - 2, cy, 'e'); sentar(cx + 1, cy - 1, 'o');
  };

  return { poner, decorar, sentar, parar, jugar, puesto, hexagonal };
}

const interior = (s) => ({ x0: s.x + 1, y0: s.y + 1, x1: s.x + s.w - 2, y1: s.y + s.h - 2 });

const GENERADORES = {
  // Salón de clase: pantalla al frente, escritorio del profe y filas de puestos
  salon(s, a, conMonitor = false) {
    const { x0, y0, x1, y1 } = interior(s);
    const cx = Math.floor((x0 + x1) / 2);
    const alNorte = s.frente === 'n';
    a.decorar('pantalla', cx - 2, alNorte ? s.y : s.y + s.h - 1, 5, 1, { lado: s.frente });
    a.poner('escritorio', cx - 1, alNorte ? y0 + 1 : y1 - 1, 2, 1, { monitor: true, mira: alNorte ? 's' : 'n' });
    s.profe = { x: cx + 2, y: alNorte ? y0 + 1 : y1 - 1, mira: alNorte ? 's' : 'n' };

    const filas = [];
    if (alNorte) for (let y = y0 + 3; y + 1 <= y1; y += 3) filas.push(y);
    else for (let y = y1 - 3; y - 1 >= y0; y -= 3) filas.push(y);
    for (const y of filas) {
      for (let x = x0 + 1; x + 1 <= x1 - 1; x += 2) {
        if (x + 1 >= cx - 1 && x <= cx) continue; // pasillo central
        a.puesto(x, y, alNorte ? 1 : -1, conMonitor);
      }
    }
  },

  computo(s, a) { GENERADORES.salon(s, a, true); },

  // Islas de computadores
  islas(s, a) {
    const { y0 } = interior(s);
    for (const x of [s.x + 3, s.x + 9]) {
      for (let k = 0; k < 4; k++) {
        a.poner('escritorio', x, y0 + 2 + k, 2, 1); // Cosmos no tiene computadores
        a.sentar(x - 1, y0 + 2 + k, 'e');
        a.sentar(x + 2, y0 + 2 + k, 'o');
      }
    }
    s.profe = { x: s.x + 7, y: y0 + 1, mira: 's' };
  },

  // Mesas largas verticales con sillas a ambos lados
  mesasLargas(s, a) {
    for (const x of [109, 114, 124, 129, 133]) {
      a.poner('mesaLarga', x, s.y + 2, 2, 5);
      for (let y = s.y + 2; y < s.y + 7; y++) {
        a.sentar(x - 1, y, 'e');
        if (x !== 133) a.sentar(x + 2, y, 'o');
      }
    }
  },

  reunionOval(s, a) {
    const { x0, y0 } = interior(s);
    a.poner('mesaOval', x0 + 1, y0 + 2, 2, 6);
    for (let k = 0; k < 5; k++) {
      a.sentar(x0, y0 + 2 + k, 'e');
      a.sentar(x0 + 3, y0 + 2 + k, 'o');
    }
    a.decorar('pantalla', x0, s.y + s.h - 1, 4, 1, { lado: 's' });
    s.profe = { x: x0 + 1, y: y0 + 9, mira: 'n' };
  },

  reunionRedonda(s, a) {
    const x = s.x + 3, y = s.y + 4;
    a.poner('mesaRedonda', x, y, 2, 2);
    a.sentar(x, y - 1, 's'); a.sentar(x + 1, y - 1, 's');
    a.sentar(x - 1, y, 'e'); a.sentar(x - 1, y + 1, 'e');
    a.sentar(x + 2, y, 'o'); a.sentar(x + 2, y + 1, 'o');
    a.sentar(x, y + 2, 'n'); a.sentar(x + 1, y + 2, 'n');
    a.decorar('pantalla', x - 1, s.y, 4, 1, { lado: 'n' });
  },

  // Salón Morado: tres cabinas individuales
  cabinas(s, a) {
    for (let k = 0; k < 3; k++) {
      const y = s.y + 1 + k * 3;
      a.poner('escritorio', s.x + 1, y, 2, 1, { mira: 'n' }); // sin computadores
      a.sentar(s.x + 1, y + 1, 'n');
      if (k < 2) a.poner('divisor', s.x + 1, y + 2, 4, 1);
    }
  },

  cabinasDobles(s, a) {
    a.poner('divisor', s.x + 5, s.y + 1, 1, 2); // deja pasar por la fila de abajo
    for (const x of [s.x + 2, s.x + 6]) {
      a.poner('escritorio', x, s.y + 1, 2, 1, { monitor: true, mira: 'n' });
      a.sentar(x, s.y + 2, 'n');
    }
  },

  clonai(s, a) {
    a.poner('escritorio', s.x + 2, s.y + 1, 6, 1, { mira: 'n' });
    for (let x = s.x + 2; x < s.x + 8; x++) a.sentar(x, s.y + 2, 'n');
  },

  juntas(s, a) {
    const { x0, y0 } = interior(s);
    a.poner('mesaOval', x0 + 2, y0 + 3, 3, 10);
    for (let k = 0; k < 6; k++) {
      a.sentar(x0 + 1, y0 + 5 + k, 'e');
      a.sentar(x0 + 5, y0 + 5 + k, 'o');
    }
    a.decorar('pantalla', x0 + 1, s.y, 5, 1, { lado: 'n' });
    // Cabecera de la mesa, junto a la pantalla
    a.sentar(x0 + 3, y0 + 2, 's');
    s.cabecera = { x: x0 + 3, y: y0 + 2, mira: 's' };
    s.profe = { x: x0 + 3, y: y0 + 1, mira: 's' };
  },

  // Auditorio: gradas en arco mirando a la tarima junto al eje del semicírculo
  auditorio(s, a) {
    a.decorar('tarima', 152, 24, 8, 4);
    a.decorar('pantalla', 153, 28, 6, 1, { lado: 's' });
    s.profe = { x: 155, y: 25, mira: 'o' };
    for (const r of [11, 14, 17, 20]) {
      const pasos = Math.round((Math.PI / 2) * r / 2);
      for (let k = 1; k < pasos; k++) {
        const ang = Math.PI + (k / pasos) * (Math.PI / 2);
        const x = Math.round(ARCO.cx + Math.cos(ang) * r - 0.5);
        const y = Math.round(ARCO.cy + Math.sin(ang) * r - 0.5);
        if (!s.contiene(x, y) || esBorde(s, x, y)) continue;
        const mira = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang)) ? 'e' : 's';
        a.decorar('puf', x, y, 1, 1);
        a.sentar(x, y, mira, false);
      }
    }
    s.gradas = [11, 14, 17, 20];
  },

  // Hunters: zona social con mesas, sala de estar, ping-pong y cocineta
  hunters(s, a) {
    a.poner('escalera', 185, 48, 6, 11); // escalera de emergencia, junto a Hunters
    const adentro = (x, y) => s.contiene(x, y) && !esBorde(s, x, y);
    for (const [y, xs] of [[13, [165, 171, 177]], [19, [164, 170, 176, 181]], [24, [164, 170, 176, 181]]]) {
      for (const x of xs) {
        if (!adentro(x, y - 1) || !adentro(x + 1, y - 1) || !adentro(x, y + 1) || !adentro(x + 1, y + 1)) continue;
        a.poner('mesa', x, y, 2, 1);
        a.sentar(x, y - 1, 's'); a.sentar(x + 1, y - 1, 's');
        a.sentar(x, y + 1, 'n'); a.sentar(x + 1, y + 1, 'n');
      }
    }
    // Sala de estar
    a.decorar('sofa', 170, 30, 6, 1, { mira: 's' });
    a.poner('mesaCentro', 171, 32, 4, 1);
    a.decorar('sofa', 170, 34, 6, 1, { mira: 'n' });
    for (let x = 170; x < 176; x += 2) { a.sentar(x, 30, 's', false); a.sentar(x + 1, 34, 'n', false); }
    a.decorar('pantalla', 184, 31, 1, 4, { lado: 'e' });
    // Juegos (las mesas de ping-pong son salas propias: ver pingpong)
    a.poner('futbolin', 171, 42, 3, 2);
    a.parar(170, 42, 'e');
    a.parar(174, 43, 'o');
    // Cocineta con taburetes
    a.poner('barra', 182, 37, 2, 12);
    for (let y = 38; y < 48; y += 2) {
      a.decorar('taburete', 181, y);
      a.sentar(181, y, 'e', false);
    }
    for (const x of [165, 169, 173]) {
      a.poner('mesaAlta', x, 51, 1, 1);
      a.sentar(x - 1, 51, 'e', false); a.decorar('taburete', x - 1, 51);
      a.sentar(x + 1, 51, 'o', false); a.decorar('taburete', x + 1, 51);
    }
  },

  // Mesa de ping-pong con dos jugadores por lado
  pingpong(s, a) {
    a.poner('pingpong', s.x + 1, s.y + 2, 3, 5);
    for (const x of [s.x + 1, s.x + 3]) {
      a.jugar(x, s.y + 1, 's');
      a.jugar(x, s.y + 7, 'n');
    }
  },

  // Salita con mesa de 4 puestos; la entrada (arriba) queda libre
  salaAmarilla(s, a) {
    const { x0, y1 } = interior(s);
    a.poner('mesa', x0 + 1, y1 - 1, 2, 1);
    a.sentar(x0, y1 - 1, 'e');
    a.sentar(x0 + 3, y1 - 1, 'o');
    a.sentar(x0 + 1, y1, 'n');
    a.sentar(x0 + 2, y1, 'n');
  },

  banos(s, a) {
    const { x0, y0, x1, y1 } = interior(s);
    const fondo = s.frente === 'n' ? y0 : y1;
    const cerca = s.frente === 'n' ? y1 - 1 : y0 + 1;
    const mitad = Math.floor((x0 + x1) / 2);
    a.poner('divisor', mitad, s.frente === 'n' ? y0 : y1 - 3, 1, 4); // separa mujeres y hombres
    for (let x = x0; x <= x1; x += 2) {
      if (x === mitad || x === mitad + 1) continue;
      a.poner('inodoro', x, fondo, 1, 1, { lado: s.frente });
      a.parar(x, fondo + (s.frente === 'n' ? 1 : -1), s.frente);
    }
    a.poner('lavamanos', x0, cerca, 3, 1);
    a.poner('lavamanos', x1 - 2, cerca, 3, 1);
  },

  rack(s, a) {
    if (s.id === 'comunicaciones') a.poner('rack', s.x + 1, s.y + 1, 2, 3);
    else a.poner('tablero', s.x + 1, s.y + 1, s.w - 2, 1);
  },

  bermedia(s, a) {
    for (const y of [66, 73, 80, 87]) {
      a.poner('mesaLarga', 93, y, 12, 1, { horizontal: true });
      for (let x = 93; x < 105; x += 2) { a.sentar(x, y - 1, 's'); a.sentar(x + 1, y + 1, 'n'); }
    }
    for (let y = 70; y < 86; y += 4) {
      a.poner('mesaAlta', 108, y, 1, 1);
      a.sentar(107, y, 'e', false); a.decorar('taburete', 107, y);
      a.sentar(109, y, 'o', false); a.decorar('taburete', 109, y);
    }
    s.profe = { x: 99, y: 63, mira: 's' };
  },

  // ---------- Zonas abiertas ----------
  pasilloOeste(z, a) {
    a.poner('jardinera', 43, 48, 7, 1);
  },

  lobby(z, a) {
    a.poner('ascensor', 61, 32, 5, 5);
    a.poner('ascensor', 67, 32, 5, 5);
    a.poner('escalera', 74, 28, 5, 11);
    a.poner('ducto', 79, 28, 11, 4);
    a.poner('ascensor', 79, 32, 5, 5);
    a.poner('ascensor', 84, 32, 5, 5);
    a.poner('escalera', 74, 50, 16, 11);
    a.poner('letrasCampus', 77, 46, 12, 2);
    for (const x of [64, 70, 92, 100]) {
      a.decorar('banca', x, 47, 3, 1);
      a.parar(x + 1, 46, 's');
    }
    a.parar(96, 42, 's'); a.parar(68, 43, 's');
  },

  pasilloEste(z, a) {
    a.poner('jardinera', 107, 39, 12, 1);
    a.poner('jardinera', 123, 39, 13, 1);
    for (const x of [111, 120, 129, 138, 147, 156]) a.hexagonal(x, 44, 'blanca');
  },

  recepcion(z, a) {
    a.poner('cabina', 113, 67, 4, 5);
    a.poner('cabina', 113, 73, 4, 5);
    for (let k = 0; k < 4; k++) {
      a.poner('escritorio', 118, 67 + k * 3, 2, 1, { monitor: true, mira: 'n' });
      a.sentar(118, 68 + k * 3, 'n');
    }
  },

  central1(z, a) {
    for (let y = 52; y <= 88; y += 4) {
      for (let x = 122; x < 134; x += 2) {
        a.poner('escritorio', x, y, 2, 1, { monitor: true, doble: true });
        a.sentar(x, y - 1, 's'); a.sentar(x + 1, y - 1, 's');
        a.sentar(x, y + 1, 'n'); a.sentar(x + 1, y + 1, 'n');
      }
    }
    for (const y of [57, 69, 81]) a.poner('columna', 121, y);
    a.poner('jardinera', 136, 51, 1, 29, { vertical: true });
  },

  central2(z, a) {
    const mesas = [[141, 53, 'roja'], [148, 57, 'roja'], [141, 61, 'amarilla'], [148, 65, 'amarilla'],
      [141, 69, 'amarilla'], [148, 73, 'amarilla'], [141, 77, 'amarilla'], [148, 81, 'amarilla'], [141, 85, 'roja'], [156, 52, 'roja']];
    for (const [x, y, color] of mesas) a.hexagonal(x, y, color);
    for (const x of [139, 145]) {
      a.poner('escritorio', x, 89, 2, 1, { monitor: true, mira: 'n' });
      a.sentar(x, 90, 'n'); a.sentar(x + 1, 90, 'n');
    }
  },

  balconN(z, a) { for (let x = 61; x < 104; x += 4) a.decorar('condensador', x, 25, 3, 2); },
  balconS(z, a) { for (let x = 61; x < 88; x += 4) a.decorar('condensador', x, 62, 3, 2); },
  balconE(z, a) { for (let y = 61; y < 82; y += 4) a.decorar('condensador', 163, y, 3, 3); },
};
