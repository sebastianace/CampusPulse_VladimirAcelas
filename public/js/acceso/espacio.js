// =====================================================================
// CIELO ANIMADO DEL LOGIN
// ---------------------------------------------------------------------
// Dos capas detrás de las tarjetas:
//   - Un <canvas> 2D (#cielo): estrellas en 3 capas que se desplazan a distinta
//     velocidad (paralaje) y titilan, estrellas fugaces y el resplandor de cada objeto.
//   - Un <canvas> WebGL encima (cristal.js): donas y esferas 3D lisas y brillantes,
//     con degradé iridiscente (azul, violeta, blanco y rosa), como de cristal.
// Este archivo decide dónde va cada objeto y cómo se mueve; cristal.js los dibuja.
// El mouse inclina un poco la escena. Es solo decoración: los canvas son
// aria-hidden y si algo falla (script o WebGL), el login funciona igual.
// Accesibilidad y rendimiento:
//   - Con "reducir movimiento" activado en el sistema se dibuja un solo
//     cuadro quieto.
//   - Se detiene cuando la pestaña no está visible.
// =====================================================================

import { aleatorio } from './geometria.js';
import { crearCristal } from './cristal.js';

// Colores de las estrellas (RGB)
const C = {
  oro: [245, 200, 76],
  lavanda: [196, 186, 255],
};

// Capas de estrellas: cuántas por cada 10 000 px², velocidad (px por segundo), tamaño, brillo y paralaje del mouse
const CAPAS = [
  { densidad: 1.6, velocidad: 4, tamano: 0.7, brillo: 0.55, paralaje: 6 },
  { densidad: 0.6, velocidad: 10, tamano: 1.1, brillo: 0.75, paralaje: 14 },
  { densidad: 0.18, velocidad: 22, tamano: 1.7, brillo: 0.95, paralaje: 26 },
];

// ---------- estado ----------

let lienzo;
let ctx;
let cristal = null; // null si el navegador no tiene WebGL
let ancho = 0;
let alto = 0;
let densidad = 1;
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

/** Resplandor suave detrás de un objeto, para que se mezcle con el cielo. */
function dibujarResplandor(cx, cy, radio, opacidad) {
  const halo = ctx.createRadialGradient(cx, cy, radio * 0.3, cx, cy, radio);
  halo.addColorStop(0, `rgb(98 88 255 / ${0.34 * opacidad})`);
  halo.addColorStop(1, 'rgb(98 88 255 / 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radio, 0, Math.PI * 2);
  ctx.fill();
}

/** Dónde va cada objeto, cómo gira y qué tan visible es en este instante. */
function objetos() {
  const celular = ancho < 760;
  const base = Math.min(ancho, alto);
  const { suaveX: mx, suaveY: my } = mouse;
  const lista = [
    // Dona grande abajo a la izquierda, inclinada para ver el hueco; se mece despacio
    {
      malla: 'dona',
      cx: ancho * (celular ? 0.1 : 0.11) + mx * 16,
      cy: alto * (celular ? 0.9 : 0.8) + my * 16,
      tamano: base * (celular ? 0.2 : 0.17),
      giro: [0.95 + Math.sin(reloj * 0.3) * 0.18 + my * 0.12, reloj * 0.16 + mx * 0.25, 0.35],
      fase: reloj * 0.02,
      opacidad: celular ? 0.55 : 1,
    },
    // Dona más chica arriba a la derecha, girando al revés
    {
      malla: 'dona',
      cx: ancho * (celular ? 0.92 : 0.89) + mx * 26,
      cy: alto * (celular ? 0.13 : 0.26) + my * 26,
      tamano: base * (celular ? 0.1 : 0.085),
      giro: [1.15 + Math.cos(reloj * 0.4) * 0.22, -reloj * 0.28 + mx * 0.3, -0.5],
      fase: 0.3 + reloj * 0.03,
      opacidad: celular ? 0.6 : 1,
    },
  ];
  // Dos perlas flotando en los bordes, lejos del título y de las tarjetas
  [[0.955, 0.66, 0.026], [0.74, 0.93, 0.02]].forEach(([x, y, tam], i) => {
    const flota = Math.sin(reloj * 0.5 + i * 2.1);
    lista.push({
      malla: 'esfera',
      cx: ancho * x + mx * 20 + flota * 5,
      cy: alto * y + my * 20 + flota * 9,
      tamano: base * tam,
      giro: [reloj * 0.3, reloj * 0.4, 0],
      fase: 0.55 + i * 0.25 + reloj * 0.02,
      opacidad: celular ? 0.5 : 0.95,
    });
  });
  return lista;
}

// ---------- cuadro completo ----------

function dibujar(dt) {
  ctx.clearRect(0, 0, ancho, alto);
  mouse.suaveX += (mouse.x - mouse.suaveX) * Math.min(1, dt * 3);
  mouse.suaveY += (mouse.y - mouse.suaveY) * Math.min(1, dt * 3);

  dibujarEstrellas(dt);
  dibujarFugaces(dt);

  const lista = objetos();
  for (const o of lista) dibujarResplandor(o.cx, o.cy, o.tamano * (o.malla === 'dona' ? 2.3 : 2.6), o.opacidad);
  // Los objetos son lisos y no tienen detalle fino: con 1.5 se ven igual de nítidos y cuesta menos en pantallas retina
  cristal?.dibujar(lista, ancho, alto, Math.min(densidad, 1.5));
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
  densidad = Math.min(window.devicePixelRatio || 1, 2);
  ancho = window.innerWidth;
  alto = window.innerHeight;
  lienzo.width = Math.round(ancho * densidad);
  lienzo.height = Math.round(alto * densidad);
  ctx.setTransform(densidad, 0, 0, densidad, 0, 0);
  crearEstrellas();
  if (quieto.matches) dibujar(0);
}

/** Pone en marcha el cielo en el canvas indicado (y crea encima el canvas WebGL de los objetos). */
export function iniciarEspacio(canvas) {
  lienzo = canvas;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.classList.add('acceso__cielo--vivo'); // quita las estrellas fijas de CSS: ahora las dibuja el canvas

  const encima = document.createElement('canvas');
  encima.className = 'acceso__objetos';
  encima.setAttribute('aria-hidden', 'true');
  canvas.after(encima);
  cristal = crearCristal(encima);
  if (!cristal) encima.remove(); // sin WebGL: solo estrellas

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
