// =====================================================================
// CIELO ANIMADO DEL LOGIN
// ---------------------------------------------------------------------
// Dibuja en un <canvas> detrás de las tarjetas:
//   - Estrellas en 3 capas que se desplazan a distinta velocidad (paralaje)
//     y titilan; de vez en cuando cruza una estrella fugaz.
//   - Un planeta low-poly en 3D con un anillo de partículas que pasa por
//     delante y por detrás de él.
//   - Una dona 3D iridiscente (la del diseño anterior, ahora con volumen)
//     y unos asteroides.
// El mouse inclina un poco la escena. Es solo decoración: el canvas es
// aria-hidden y si este script falla, el login funciona igual.
// Accesibilidad y rendimiento:
//   - Con "reducir movimiento" activado en el sistema se dibuja un solo
//     cuadro quieto.
//   - Se detiene cuando la pestaña no está visible.
// =====================================================================

import {
  aleatorio, carasVisibles, icosfera, matrizRotacion, mezclar, normalizar, proyectar, rotar, toro,
} from './geometria.js';

const LUZ = normalizar([-0.6, 0.55, -0.6]); // desde arriba a la izquierda, por delante
const SOMBRA = [22, 19, 52];                  // color de la cara sin luz: morado casi negro

// Colores de Campus Pulse (los mismos tokens --a-* del login, en RGB)
const C = {
  oceano: [58, 62, 168],
  morado: [108, 99, 255],
  lavanda: [196, 186, 255],
  cumbre: [236, 232, 255],
  oro: [245, 200, 76],
  iris: [[79, 110, 247], [157, 139, 255], [242, 201, 255], [111, 211, 247]],
  roca: [128, 122, 168],
};

// Capas de estrellas: cuántas por cada 10 000 px², velocidad (px por segundo), tamaño, brillo y paralaje del mouse
const CAPAS = [
  { densidad: 1.6, velocidad: 4, tamano: 0.7, brillo: 0.55, paralaje: 6 },
  { densidad: 0.6, velocidad: 10, tamano: 1.1, brillo: 0.75, paralaje: 14 },
  { densidad: 0.18, velocidad: 22, tamano: 1.7, brillo: 0.95, paralaje: 26 },
];

// ---------- mallas (se calculan una sola vez) ----------

const PLANETA = icosfera(2, { relieve: 0.045, semilla: 2026 });
const DONA = toro(1, 0.38, 32, 12);
const ROCAS = [11, 23, 37].map((semilla) => icosfera(1, { relieve: 0.28, semilla }));

// Color de cada cara del planeta según su altura: lo bajo es océano, lo alto lavanda y las cumbres casi blancas
const COLOR_PLANETA = PLANETA.caras.map((cara) => {
  const h = cara.reduce((s, i) => s + PLANETA.altura[i], 0) / cara.length / 0.045; // -1..1
  if (h < -0.1) return C.oceano;
  if (h < 0.55) return mezclar(C.morado, C.lavanda, (h + 0.1) / 0.65);
  return C.cumbre;
});

// Color de la dona según dónde está en la vuelta grande: recorre los 4 tonos iridiscentes y vuelve al primero
function colorIris(u) {
  const x = u * C.iris.length;
  const i = Math.floor(x) % C.iris.length;
  return mezclar(C.iris[i], C.iris[(i + 1) % C.iris.length], x - Math.floor(x));
}
const COLOR_DONA = DONA.u.map(colorIris);

// Partículas del anillo: radio entre 1.45 y 2.2 veces el planeta; las de adentro giran más rápido (como en Saturno)
const ANILLO = (() => {
  const azar = aleatorio(7);
  return Array.from({ length: 720 }, () => {
    const radio = 1.45 + azar() ** 1.6 * 0.75;
    return {
      radio,
      angulo: azar() * Math.PI * 2,
      velocidad: 0.16 / radio ** 1.5,
      altura: (azar() - 0.5) * 0.04,
      tamano: 0.8 + azar() * 1.5,
      dorada: azar() < 0.18,
    };
  });
})();
const INCLINACION_ANILLO = matrizRotacion(1.2, 0, -0.38);

// ---------- estado ----------

let lienzo;
let ctx;
let ancho = 0;
let alto = 0;
let estrellas = [];
let fugaces = [];
let proximaFugaz = 0;
const mouse = { x: 0, y: 0, suaveX: 0, suaveY: 0 };
let cuadro = 0;
let anterior = 0;
let reloj = 0;
const quieto = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- estrellas ----------

function crearEstrellas() {
  const azar = aleatorio(Math.round(ancho * 7 + alto));
  estrellas = CAPAS.flatMap((capa, nivel) => Array.from(
    { length: Math.round((ancho * alto) / 10000 * capa.densidad) },
    () => {
      const tono = azar();
      return {
        nivel,
        x: azar() * ancho,
        y: azar() * alto,
        fase: azar() * Math.PI * 2,
        ritmo: 0.6 + azar() * 1.8,
        // la mayoría blancas; algunas lavanda y unas pocas doradas
        color: tono < 0.12 ? C.oro : tono < 0.35 ? C.lavanda : [255, 255, 255],
      };
    },
  ));
}

function dibujarEstrellas(dt) {
  for (const e of estrellas) {
    const capa = CAPAS[e.nivel];
    // Se mueven hacia la izquierda y un poco hacia abajo; al salir de la pantalla vuelven por el otro lado
    e.x -= capa.velocidad * dt;
    e.y += capa.velocidad * 0.25 * dt;
    if (e.x < -4) e.x += ancho + 8;
    if (e.y > alto + 4) e.y -= alto + 8;
    const x = e.x + mouse.suaveX * capa.paralaje;
    const y = e.y + mouse.suaveY * capa.paralaje;
    const titileo = 0.65 + 0.35 * Math.sin(reloj * e.ritmo + e.fase);
    ctx.fillStyle = `rgb(${e.color[0]} ${e.color[1]} ${e.color[2]} / ${capa.brillo * titileo})`;
    ctx.beginPath();
    ctx.arc(x, y, capa.tamano, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- estrellas fugaces ----------

function dibujarFugaces(dt) {
  if (reloj > proximaFugaz) {
    const azar = Math.random;
    fugaces.push({ x: ancho * (0.25 + azar() * 0.7), y: alto * azar() * 0.35, vida: 0, duracion: 0.9 + azar() * 0.5 });
    proximaFugaz = reloj + 6 + Math.random() * 7; // una cada 6 a 13 segundos
  }
  fugaces = fugaces.filter((f) => f.vida < f.duracion);
  for (const f of fugaces) {
    f.vida += dt;
    const avance = f.vida / f.duracion;
    const largo = Math.min(ancho, 900) * 0.32;
    const cabeza = [f.x - avance * largo, f.y + avance * largo * 0.42];
    const cola = [cabeza[0] + 110, cabeza[1] - 46];
    const opacidad = Math.sin(avance * Math.PI); // aparece y se apaga suave
    const degradado = ctx.createLinearGradient(cabeza[0], cabeza[1], cola[0], cola[1]);
    degradado.addColorStop(0, `rgb(255 255 255 / ${0.9 * opacidad})`);
    degradado.addColorStop(1, 'rgb(196 186 255 / 0)');
    ctx.strokeStyle = degradado;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cabeza[0], cabeza[1]);
    ctx.lineTo(cola[0], cola[1]);
    ctx.stroke();
  }
}

// ---------- objetos 3D ----------

/** Pinta caras ya proyectadas y ordenadas. El borde del mismo color tapa las rendijas entre caras. */
function pintarCaras(caras, opacidad = 1) {
  ctx.globalAlpha = opacidad;
  ctx.lineWidth = 0.7;
  ctx.lineJoin = 'round';
  for (const cara of caras) {
    const [r, g, b] = mezclar(SOMBRA, cara.color, cara.brillo);
    ctx.fillStyle = ctx.strokeStyle = `rgb(${r} ${g} ${b})`;
    ctx.beginPath();
    cara.puntos.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function dibujarAnillo(vista, rotacionY, delante) {
  for (const p of ANILLO) {
    const a = p.angulo + reloj * p.velocidad;
    // Punto en el plano del anillo, luego inclinado y girado junto con el planeta
    const local = [Math.cos(a) * p.radio, p.altura, Math.sin(a) * p.radio];
    const [x, y, z, escala] = proyectar(rotar(rotacionY, rotar(INCLINACION_ANILLO, local)), vista);
    if ((z < 0) !== delante) continue; // primero se dibuja la mitad de atrás, después la de adelante
    const color = p.dorada ? C.oro : C.lavanda;
    ctx.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]} / ${0.35 + 0.5 * escala * (delante ? 1 : 0.6)})`;
    ctx.beginPath();
    ctx.arc(x, y, p.tamano * escala, 0, Math.PI * 2);
    ctx.fill();
  }
}

function dibujarPlaneta(vista, opacidad) {
  // Halo de atmósfera detrás del planeta
  const halo = ctx.createRadialGradient(vista.cx, vista.cy, vista.tamano * 0.7, vista.cx, vista.cy, vista.tamano * 1.9);
  halo.addColorStop(0, `rgb(108 99 255 / ${0.42 * opacidad})`);
  halo.addColorStop(1, 'rgb(108 99 255 / 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(vista.cx, vista.cy, vista.tamano * 1.9, 0, Math.PI * 2);
  ctx.fill();

  const giro = matrizRotacion(0.32 + mouse.suaveY * 0.12, reloj * 0.12 + mouse.suaveX * 0.25, -0.38);
  const giroAnillo = matrizRotacion(mouse.suaveY * 0.12, mouse.suaveX * 0.25, 0);
  ctx.globalAlpha = opacidad;
  dibujarAnillo(vista, giroAnillo, false);
  ctx.globalAlpha = 1;
  pintarCaras(carasVisibles(PLANETA, giro, vista, LUZ, (i) => COLOR_PLANETA[i]), opacidad);
  ctx.globalAlpha = opacidad;
  dibujarAnillo(vista, giroAnillo, true);
  ctx.globalAlpha = 1;
}

function dibujarDona(vista, opacidad) {
  const giro = matrizRotacion(1.05 + Math.sin(reloj * 0.35) * 0.25, reloj * 0.4, 0.5 + mouse.suaveX * 0.3);
  pintarCaras(carasVisibles(DONA, giro, vista, LUZ, (i) => COLOR_DONA[i]), opacidad);
}

function dibujarRocas(base, opacidad) {
  ROCAS.forEach((roca, i) => {
    const flota = Math.sin(reloj * 0.5 + i * 2.1);
    const vista = {
      // En los bordes, lejos del título y de las tarjetas
      cx: ancho * [0.05, 0.8, 0.96][i] + mouse.suaveX * 18 + flota * 6,
      cy: alto * [0.32, 0.9, 0.62][i] + mouse.suaveY * 18 + flota * 10,
      tamano: base * [0.07, 0.05, 0.035][i],
      distancia: 4,
    };
    const giro = matrizRotacion(reloj * (0.3 + i * 0.1), reloj * (0.45 - i * 0.08), i);
    pintarCaras(carasVisibles(roca, giro, vista, LUZ, () => C.roca), opacidad * 0.85);
  });
}

// ---------- cuadro completo ----------

function dibujar(dt) {
  ctx.clearRect(0, 0, ancho, alto);
  mouse.suaveX += (mouse.x - mouse.suaveX) * Math.min(1, dt * 3);
  mouse.suaveY += (mouse.y - mouse.suaveY) * Math.min(1, dt * 3);

  dibujarEstrellas(dt);
  dibujarFugaces(dt);

  const celular = ancho < 760;
  const base = Math.min(ancho, alto);
  dibujarRocas(base, celular ? 0.5 : 1);
  dibujarDona({
    cx: ancho * (celular ? 0.92 : 0.88) + mouse.suaveX * 24,
    cy: alto * (celular ? 0.14 : 0.3) + mouse.suaveY * 24,
    tamano: base * (celular ? 0.11 : 0.1),
    distancia: 4,
  }, celular ? 0.55 : 0.95);
  dibujarPlaneta({
    cx: ancho * (celular ? 0.08 : 0.13) + mouse.suaveX * 14,
    cy: alto * (celular ? 0.9 : 0.76) + mouse.suaveY * 14,
    tamano: base * (celular ? 0.26 : 0.2),
    distancia: 4,
  }, celular ? 0.6 : 1);
}

function animar(ahora) {
  const dt = Math.min(0.05, (ahora - (anterior || ahora)) / 1000); // si la pestaña estuvo quieta, no dar un salto
  anterior = ahora;
  reloj += dt;
  dibujar(dt);
  cuadro = requestAnimationFrame(animar);
}

function arrancar() {
  cancelAnimationFrame(cuadro);
  anterior = 0;
  if (quieto.matches) {
    // Sin movimiento: un solo cuadro, con el reloj en un momento en que todo se ve bien
    reloj = 4;
    dibujar(0);
  } else if (!document.hidden) {
    cuadro = requestAnimationFrame(animar);
  }
}

function ajustarTamano() {
  const densidad = Math.min(window.devicePixelRatio || 1, 2);
  ancho = window.innerWidth;
  alto = window.innerHeight;
  lienzo.width = Math.round(ancho * densidad);
  lienzo.height = Math.round(alto * densidad);
  ctx.setTransform(densidad, 0, 0, densidad, 0, 0);
  crearEstrellas();
  if (quieto.matches) dibujar(0);
}

/** Pone en marcha el cielo en el canvas indicado. */
export function iniciarEspacio(canvas) {
  lienzo = canvas;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.classList.add('acceso__cielo--vivo'); // quita las estrellas fijas de CSS: ahora las dibuja el canvas
  ajustarTamano();
  proximaFugaz = 2.5;

  let pendiente = false;
  window.addEventListener('resize', () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; ajustarTamano(); });
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return; // en el celular el dedo no mueve la escena
    mouse.x = (e.clientX / ancho) * 2 - 1;
    mouse.y = (e.clientY / alto) * 2 - 1;
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(cuadro) : arrancar()));
  quieto.addEventListener('change', arrancar);
  arrancar();
}
