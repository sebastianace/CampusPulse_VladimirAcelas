// Pinta en pixel art la capa fija del piso (pisos, muros, muebles) en un
// canvas fuera de pantalla. Se dibuja una sola vez; cada cuadro solo la copia.
// Paleta tomada del video del campus: madera clara, techo oscuro, vidrio
// con borde cian, escritorios blancos, sillas negras y jardineras verdes.

import { ARCO } from './plano.js';

export const BALDOSA = 16; // píxeles de mundo por baldosa

const C = {
  exterior: '#0b0f15',
  maderas: ['#c99862', '#c28e58', '#cfa06a', '#c5935d'],
  vetaMadera: '#a97a4b',
  luzMadera: '#d9b07c',
  alfombra: '#384050', alfombraPunto: ['#414a5c', '#323947'],
  baldosa: '#dde2e8', baldosaB: '#d0d6dd', junta: '#bcc3cb',
  concreto: '#7b838e', concretoPunto: ['#858d98', '#717983'],
  morado: '#5a3e8a', moradoPunto: ['#674b98', '#4f357c'],
  amarillo: '#d9b433', amarilloPunto: ['#e4c24a', '#c9a326'],
  balcon: '#262b33', rejilla: '#323844',
  muro: '#262b35', muroLuz: '#4a5263', sombra: 'rgba(0,0,0,0.22)',
  vidrio: 'rgba(130,220,255,0.38)', vidrioBorde: '#8be4ff',
  fachada: '#1d2533', ventana: '#5cc8ff',
  mesaBlanca: '#eef1f4', mesaSombra: '#a5aeb9',
  pantalla: '#151a22', brillo: '#3b8cff',
  silla: '#1b1e25', sillaAsiento: '#33373f',
  verde: ['#2f9e44', '#40c057', '#2b8a3e', '#51cf66'], maceta: '#6b4f3a',
  metal: '#9aa3ae', metalOscuro: '#6c7480',
  roja: '#e57373', rojaOscura: '#b94a4a', amarilla: '#f2e19a', amarillaOscura: '#c9b45e',
  sofa: '#cbbfae', sofaOscuro: '#a89a86',
  azulPing: '#1f5fd6', marca: '#1fb5a6',
};

/** Crea el canvas con todo el piso dibujado. */
export function pintarMundo(plano) {
  const lienzo = document.createElement('canvas');
  lienzo.width = plano.ancho * BALDOSA;
  lienzo.height = plano.alto * BALDOSA;
  const ctx = lienzo.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.fillStyle = C.exterior;
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);

  pintarPisos(ctx, plano);
  pintarGradas(ctx, plano);
  for (const m of plano.muebles) if (m.t !== 'silla') MUEBLES[m.t]?.(ctx, m);
  for (const m of plano.muebles) if (m.t === 'silla') MUEBLES.silla(ctx, m);
  pintarMuros(ctx, plano);
  pintarFachada(ctx, plano);
  return lienzo;
}

// Número pseudoaleatorio estable por baldosa (el piso no "parpadea" entre recargas)
const ruido = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------- Pisos ----------

function pintarPisos(ctx, plano) {
  const B = BALDOSA;
  for (let y = 0; y < plano.alto; y++) {
    for (let x = 0; x < plano.ancho; x++) {
      if (!plano.huella[y * plano.ancho + x]) continue;
      const piso = plano.areaEn(x, y)?.piso ?? 'concreto';
      PISOS[piso](ctx, x * B, y * B, x, y);
    }
  }
}

const PISOS = {
  // Tablas de madera horizontales de 4 px con juntas escalonadas
  madera(ctx, px, py, x, y) {
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = C.maderas[Math.floor(ruido(x, y, k) * C.maderas.length)];
      ctx.fillRect(px, py + k * 4, 16, 4);
      ctx.fillStyle = C.vetaMadera;
      ctx.fillRect(px, py + k * 4 + 3, 16, 1);
      if (ruido(x, y, k + 9) < 0.35) ctx.fillRect(px + Math.floor(ruido(x, y, k + 3) * 14) + 1, py + k * 4, 1, 3);
      if (ruido(x, y, k + 20) < 0.15) { ctx.fillStyle = C.luzMadera; ctx.fillRect(px + 3, py + k * 4 + 1, 5, 1); }
    }
  },
  alfombra: moteado(C.alfombra, C.alfombraPunto),
  concreto: moteado(C.concreto, C.concretoPunto),
  morado: moteado(C.morado, C.moradoPunto),
  amarillo: moteado(C.amarillo, C.amarilloPunto),
  baldosa(ctx, px, py) {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      ctx.fillStyle = (i + j) % 2 ? C.baldosa : C.baldosaB;
      ctx.fillRect(px + i * 8, py + j * 8, 8, 8);
    }
    ctx.fillStyle = C.junta;
    ctx.fillRect(px, py, 16, 1);
    ctx.fillRect(px, py, 1, 16);
  },
  balcon(ctx, px, py) {
    ctx.fillStyle = C.balcon;
    ctx.fillRect(px, py, 16, 16);
    ctx.fillStyle = C.rejilla;
    for (let k = 1; k < 16; k += 4) ctx.fillRect(px, py + k, 16, 1);
  },
};

function moteado(base, puntos) {
  return (ctx, px, py, x, y) => {
    ctx.fillStyle = base;
    ctx.fillRect(px, py, 16, 16);
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = puntos[k % puntos.length];
      ctx.fillRect(px + Math.floor(ruido(x, y, k) * 15), py + Math.floor(ruido(x, y, k + 7) * 15), 1, 1);
    }
  };
}

// Gradas del auditorio: arcos concéntricos de madera más oscura
function pintarGradas(ctx, plano) {
  const auditorio = plano.areas.find((a) => a.id === 'auditorio');
  if (!auditorio?.gradas) return;
  const B = BALDOSA;
  ctx.save();
  ctx.beginPath();
  ctx.rect(auditorio.caja.x * B, auditorio.caja.y * B, (160 - auditorio.caja.x + 1) * B, auditorio.caja.h * B);
  ctx.clip();
  for (const r of auditorio.gradas) {
    ctx.strokeStyle = 'rgba(90,55,25,0.45)';
    ctx.lineWidth = B * 1.2;
    ctx.beginPath();
    ctx.arc(ARCO.cx * B, ARCO.cy * B, r * B, Math.PI, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,190,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ARCO.cx * B, ARCO.cy * B, (r - 0.6) * B, Math.PI, Math.PI * 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Muros ----------
// Un muro se dibuja en el lado de la baldosa que da hacia fuera de su sala.
// Las salas vecinas pintan cada una su lado, así el muro queda centrado.

function pintarMuros(ctx, plano) {
  const B = BALDOSA;
  const vecinos = [[0, -1, 'n'], [0, 1, 's'], [-1, 0, 'o'], [1, 0, 'e']];
  for (let y = 0; y < plano.alto; y++) {
    for (let x = 0; x < plano.ancho; x++) {
      const i = y * plano.ancho + x;
      if (!plano.huella[i]) continue;
      const area = plano.areaEn(x, y);
      for (const [dx, dy, lado] of vecinos) {
        const nx = x + dx, ny = y + dy;
        const fuera = nx < 0 || ny < 0 || nx >= plano.ancho || ny >= plano.alto || !plano.huella[ny * plano.ancho + nx];
        if (fuera) {
          if (!enFachadaCurva(x, y)) muroExterior(ctx, x * B, y * B, lado, x + y);
          continue;
        }
        if (!area || area.esZona || area.muro === 'ninguno' || area.puertas.has(i)) continue;
        if (area.contiene(nx, ny)) continue;
        if (area.muro === 'vidrio') muroVidrio(ctx, x * B, y * B, lado);
        else muroSolido(ctx, x * B, y * B, lado);
      }
    }
  }
}

const enFachadaCurva = (x, y) => y < ARCO.cy && x >= ARCO.cx - ARCO.r - 1;

function franja(lado, px, py, grosor) {
  return {
    n: [px, py, 16, grosor],
    s: [px, py + 16 - grosor, 16, grosor],
    o: [px, py, grosor, 16],
    e: [px + 16 - grosor, py, grosor, 16],
  }[lado];
}

function muroSolido(ctx, px, py, lado) {
  ctx.fillStyle = C.muro;
  ctx.fillRect(...franja(lado, px, py, 5));
  ctx.fillStyle = C.muroLuz;
  const [fx, fy, fw, fh] = franja(lado, px, py, 5);
  if (lado === 'n' || lado === 's') ctx.fillRect(fx, fy, fw, 1);
  else ctx.fillRect(fx, fy, 1, fh);
  // Sombra sobre el piso al pie de los muros horizontales (vista 3/4)
  if (lado === 'n') { ctx.fillStyle = C.sombra; ctx.fillRect(px, py + 5, 16, 3); }
}

function muroVidrio(ctx, px, py, lado) {
  ctx.fillStyle = C.vidrio;
  ctx.fillRect(...franja(lado, px, py, 3));
  ctx.fillStyle = C.vidrioBorde;
  const [fx, fy, fw, fh] = franja(lado, px, py, 3);
  if (lado === 'n' || lado === 's') ctx.fillRect(fx, fy + 1, fw, 1);
  else ctx.fillRect(fx + 1, fy, 1, fh);
}

// Fachada: muro oscuro con ventanales cian
function muroExterior(ctx, px, py, lado, semilla) {
  ctx.fillStyle = C.fachada;
  ctx.fillRect(...franja(lado, px, py, 6));
  ctx.fillStyle = C.ventana;
  const [fx, fy, fw, fh] = franja(lado, px, py, 6);
  if (semilla % 3 === 0) return; // marco entre ventanas
  if (lado === 'n' || lado === 's') ctx.fillRect(fx + 2, fy + 2, fw - 4, 2);
  else ctx.fillRect(fx + 2, fy + 2, 2, fh - 4);
}

// La fachada semicircular de vidrio se dibuja como una curva continua
function pintarFachada(ctx) {
  const B = BALDOSA;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = C.fachada;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(ARCO.cx * B, ARCO.cy * B, ARCO.r * B - 3, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.ventana;
  ctx.lineWidth = 2;
  ctx.setLineDash([22, 6]);
  ctx.beginPath();
  ctx.arc(ARCO.cx * B, ARCO.cy * B, ARCO.r * B - 3, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------- Muebles ----------

const px = (v) => Math.round(v * BALDOSA);

function caja(ctx, m, relleno, sombra, margen = 1) {
  const x = px(m.x) + margen, y = px(m.y) + margen, w = px(m.w) - margen * 2, h = px(m.h) - margen * 2;
  ctx.fillStyle = sombra;
  ctx.fillRect(x, y + 2, w, h);
  ctx.fillStyle = relleno;
  ctx.fillRect(x, y, w, h - 2);
  return { x, y, w, h };
}

const MUEBLES = {
  escritorio(ctx, m) {
    const r = caja(ctx, m, C.mesaBlanca, C.mesaSombra);
    if (!m.monitor) return;
    // Un monitor por cada puesto de 1 baldosa
    for (let k = 0; k < m.w; k++) {
      const mx = r.x + k * 16 + 3;
      const lados = m.doble ? ['n', 's'] : [m.mira === 'n' ? 'n' : 's'];
      for (const lado of lados) {
        const my = lado === 'n' ? r.y + (m.doble ? 6 : 2) : r.y + r.h - (m.doble ? 10 : 7);
        ctx.fillStyle = C.pantalla;
        ctx.fillRect(mx, my, 9, 3);
        ctx.fillStyle = C.brillo;
        ctx.fillRect(mx + 1, lado === 'n' ? my + 2 : my, 7, 1);
      }
    }
  },

  mesaLarga(ctx, m) { caja(ctx, m, C.mesaBlanca, C.mesaSombra); },
  mesa(ctx, m) { caja(ctx, m, C.mesaBlanca, C.mesaSombra); },
  mesaCentro(ctx, m) { caja(ctx, m, '#7c5a3c', '#5a3f29', 2); },
  mesaAlta(ctx, m) { redondo(ctx, m, C.mesaBlanca, C.mesaSombra, 6); },

  silla(ctx, m) {
    const x = px(m.x) + 4, y = px(m.y) + 4;
    ctx.fillStyle = C.silla;
    ctx.fillRect(x, y, 8, 8);
    ctx.fillStyle = C.sillaAsiento;
    ctx.fillRect(x + 1, y + 1, 6, 6);
    // Espaldar del lado contrario a donde mira quien se sienta
    ctx.fillStyle = C.silla;
    const espaldar = { n: [x, y + 6, 8, 3], s: [x, y - 1, 8, 3], e: [x - 1, y, 3, 8], o: [x + 6, y, 3, 8] }[m.mira];
    if (espaldar) ctx.fillRect(...espaldar);
  },

  mesaHex(ctx, m) {
    const colores = { roja: [C.roja, C.rojaOscura], amarilla: [C.amarilla, C.amarillaOscura], blanca: [C.mesaBlanca, C.mesaSombra] };
    const [relleno, borde] = colores[m.color] ?? colores.blanca;
    const cx = px(m.x + 1), cy = px(m.y + 1), r = 15;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    hexagono(ctx, cx, cy + 2, r);
    ctx.fill();
    ctx.fillStyle = borde;
    hexagono(ctx, cx, cy, r);
    ctx.fill();
    ctx.fillStyle = relleno;
    hexagono(ctx, cx, cy, r - 2);
    ctx.fill();
    ctx.fillStyle = borde;
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  },

  mesaRedonda(ctx, m) { redondo(ctx, m, C.mesaBlanca, C.mesaSombra, 2); },

  mesaOval(ctx, m) {
    const x = px(m.x) + 2, y = px(m.y) + 2, w = px(m.w) - 4, h = px(m.h) - 4;
    ctx.fillStyle = C.mesaSombra;
    redondeado(ctx, x, y + 2, w, h, Math.min(w, h) / 2);
    ctx.fill();
    ctx.fillStyle = C.mesaBlanca;
    redondeado(ctx, x, y, w, h - 1, Math.min(w, h) / 2);
    ctx.fill();
  },

  pantalla(ctx, m) {
    const horizontal = m.lado === 'n' || m.lado === 's';
    const x = px(m.x), y = px(m.y);
    ctx.fillStyle = C.pantalla;
    if (horizontal) {
      const yy = m.lado === 'n' ? y + 4 : y + 8;
      ctx.fillRect(x + 2, yy, px(m.w) - 4, 4);
      ctx.fillStyle = C.brillo;
      ctx.fillRect(x + 4, m.lado === 'n' ? yy + 3 : yy, px(m.w) - 8, 1);
    } else {
      ctx.fillRect(x + 6, y + 2, 4, px(m.h) - 4);
      ctx.fillStyle = C.brillo;
      ctx.fillRect(x + 6, y + 4, 1, px(m.h) - 8);
    }
  },

  divisor(ctx, m) { caja(ctx, m, '#b8c0ca', '#8a93a0', 5); },

  jardinera(ctx, m) {
    caja(ctx, m, C.maceta, '#4d3828', 2);
    const pasos = Math.max(m.w, m.h);
    for (let k = 0; k < pasos; k++) {
      const cx = px(m.x) + (m.w >= m.h ? k * 16 + 8 : 8);
      const cy = px(m.y) + (m.w >= m.h ? 6 : k * 16 + 6);
      arbusto(ctx, cx, cy, k);
    }
  },

  columna(ctx, m) {
    const x = px(m.x) + 2, y = px(m.y) + 2;
    ctx.fillStyle = '#2e333d';
    ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = '#4b525f';
    ctx.fillRect(x, y, 12, 2);
  },

  ascensor(ctx, m) {
    const x = px(m.x) + 2, y = px(m.y) + 2, w = px(m.w) - 4, h = px(m.h) - 2;
    ctx.fillStyle = '#3a414d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.metal;
    ctx.fillRect(x + 4, y + h - 8, w - 8, 8);
    ctx.fillStyle = C.metalOscuro;
    ctx.fillRect(x + w / 2, y + h - 8, 1, 8);
    ctx.fillStyle = '#7dffb0';
    ctx.fillRect(x + w / 2 - 1, y + h - 12, 2, 2);
  },

  escalera(ctx, m) {
    const x = px(m.x) + 1, y = px(m.y) + 1, w = px(m.w) - 2, h = px(m.h) - 2;
    const vertical = m.h >= m.w;
    for (let k = 0; k < (vertical ? h : w); k += 4) {
      ctx.fillStyle = (k / 4) % 2 ? '#5d6572' : '#717a87';
      if (vertical) ctx.fillRect(x, y + k, w, 4);
      else ctx.fillRect(x + k, y, 4, h);
    }
    ctx.fillStyle = '#2b3039';
    if (vertical) ctx.fillRect(x + w / 2 - 1, y, 2, h);
    else ctx.fillRect(x, y + h / 2 - 1, w, 2);
  },

  ducto(ctx, m) { caja(ctx, m, '#3a404b', '#2b3039', 0); },

  inodoro(ctx, m) {
    const x = px(m.x) + 4, y = px(m.y) + (m.lado === 'n' ? 2 : 4);
    ctx.fillStyle = '#c3cad3';
    ctx.fillRect(x, m.lado === 'n' ? y : y + 7, 8, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 1, m.lado === 'n' ? y + 3 : y, 6, 7);
  },

  lavamanos(ctx, m) {
    const r = caja(ctx, m, '#e4e8ec', '#9aa3ad', 2);
    ctx.fillStyle = '#b8c4cf';
    for (let k = 0; k < m.w; k++) ctx.fillRect(r.x + k * 16 + 4, r.y + 3, 6, 5);
  },

  rack(ctx, m) {
    const r = caja(ctx, m, '#15181e', '#0b0d10', 2);
    for (let k = 4; k < r.h - 4; k += 4) {
      ctx.fillStyle = '#2a2f38';
      ctx.fillRect(r.x + 2, r.y + k, r.w - 4, 2);
      ctx.fillStyle = k % 8 ? '#3ee08a' : '#3b8cff';
      ctx.fillRect(r.x + r.w - 5, r.y + k, 1, 1);
    }
  },

  tablero(ctx, m) { caja(ctx, m, '#5b636f', '#3c424c', 3); },

  barra(ctx, m) {
    const r = caja(ctx, m, '#2d3340', '#1c2029', 1);
    ctx.fillStyle = '#9aa3ae';
    ctx.fillRect(r.x + 4, r.y + 10, r.w - 8, 8);   // lavaplatos
    ctx.fillStyle = '#d9534f';
    ctx.fillRect(r.x + 6, r.y + 40, 8, 10);        // cafetera
  },

  taburete(ctx, m) {
    ctx.fillStyle = C.silla;
    ctx.beginPath();
    ctx.arc(px(m.x) + 8, px(m.y) + 8, 4, 0, Math.PI * 2);
    ctx.fill();
  },

  puf(ctx, m) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px(m.x) + 3, px(m.y) + 5, 10, 9);
    ctx.fillStyle = m.x % 3 ? '#2563eb' : '#1fb5a6';
    ctx.fillRect(px(m.x) + 3, px(m.y) + 3, 10, 9);
  },

  tarima(ctx, m) {
    const x = px(m.x), y = px(m.y), w = px(m.w), h = px(m.h);
    ctx.fillStyle = '#2b2f38';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#3a404b';
    ctx.fillRect(x, y, w, 2);
  },

  sofa(ctx, m) {
    const x = px(m.x), y = px(m.y) + 1, w = px(m.w);
    ctx.fillStyle = C.sofaOscuro;
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = C.sofa;
    ctx.fillRect(x + 2, m.mira === 's' ? y + 5 : y + 1, w - 4, 8);
    ctx.fillStyle = C.sofaOscuro;
    for (let k = 32; k < w; k += 32) ctx.fillRect(x + k, y + 2, 1, 10);
  },

  pingpong(ctx, m) {
    const r = caja(ctx, m, C.azulPing, '#123a85', 1);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 5);
    ctx.fillRect(r.x + r.w / 2, r.y + 2, 1, r.h - 6);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(r.x - 1, r.y + r.h / 2 - 2, r.w + 2, 2);   // malla
  },

  futbolin(ctx, m) {
    const r = caja(ctx, m, '#3aa35a', '#245f36', 1);
    ctx.fillStyle = '#c3cad3';
    for (let k = 6; k < r.w - 2; k += 8) ctx.fillRect(r.x + k, r.y - 2, 1, r.h + 2);
  },

  cabina(ctx, m) {
    const r = caja(ctx, m, '#2a303b', '#1b1f27', 1);
    ctx.fillStyle = C.vidrio;
    ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 8);
    ctx.fillStyle = C.vidrioBorde;
    ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, 1);
  },

  banca(ctx, m) { caja(ctx, m, '#8a6340', '#5f4329', 3); },

  condensador(ctx, m) {
    const r = caja(ctx, m, '#a5adb8', '#6d7581', 2);
    ctx.fillStyle = '#4b525e';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 1, Math.min(r.w, r.h) / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#a5adb8';
    ctx.fillRect(r.x + r.w / 2 - 1, r.y + 4, 2, r.h - 10);
  },

  // Letras gigantes "campus" sobre base verde, como en la entrada del piso
  letrasCampus(ctx, m) {
    const r = caja(ctx, m, '#2f9e44', '#1f6e2f', 0);
    const escala = 4;
    escribirPixel(ctx, 'campus', r.x + (r.w - anchoPixel('campus', escala)) / 2, r.y + 4, escala, '#ffffff');
  },
};

function redondo(ctx, m, relleno, sombra, margen) {
  const cx = px(m.x + m.w / 2), cy = px(m.y + m.h / 2), r = px(Math.min(m.w, m.h) / 2) - margen;
  ctx.fillStyle = sombra;
  ctx.beginPath();
  ctx.arc(cx, cy + 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = relleno;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function hexagono(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k + Math.PI / 6;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function arbusto(ctx, cx, cy, semilla) {
  const hojas = [[0, 0, 6], [-4, 2, 4], [4, 2, 4], [-2, -3, 4], [3, -2, 3]];
  hojas.forEach(([dx, dy, r], k) => {
    ctx.fillStyle = C.verde[(k + semilla) % C.verde.length];
    ctx.fillRect(cx + dx - r / 2, cy + dy - r / 2, r, r);
  });
  ctx.fillStyle = '#8ce99a';
  ctx.fillRect(cx - 1, cy - 3, 2, 1);
}

// Fuente de 3×5 píxeles solo con las letras que se usan en el piso
const GLIFOS = {
  c: ['111', '100', '100', '100', '111'],
  a: ['111', '101', '111', '101', '101'],
  m: ['10001', '11011', '10101', '10001', '10001'],
  p: ['111', '101', '111', '100', '100'],
  u: ['101', '101', '101', '101', '111'],
  s: ['111', '100', '111', '001', '111'],
};

const anchoPixel = (texto, escala) => [...texto].reduce((t, l) => t + ((GLIFOS[l]?.[0].length ?? 0) + 1) * escala, -escala);

function escribirPixel(ctx, texto, x, y, escala, color) {
  ctx.fillStyle = color;
  let cursor = x;
  for (const letra of texto) {
    const glifo = GLIFOS[letra];
    if (!glifo) continue;
    glifo.forEach((fila, j) => [...fila].forEach((bit, i) => {
      if (bit === '1') ctx.fillRect(cursor + i * escala, y + j * escala, escala, escala);
    }));
    cursor += (glifo[0].length + 1) * escala;
  }
}
