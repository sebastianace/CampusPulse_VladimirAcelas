// Voz en el navegador (Web Speech API), sin servidor ni claves:
//   - Dictado (STT): un botón de micrófono convierte lo que se dice en texto dentro de un campo. La persona
//     revisa y envía como siempre: el dictado solo escribe, no manda nada.
//   - Lectura en voz alta (TTS): un botón "Escuchar" lee las respuestas de Pulse con speechSynthesis.
// Si el navegador no tiene la API (Firefox no tiene reconocimiento de voz, por ejemplo), los botones NO se crean y
// todo sigue funcionando por texto.
// Privacidad: en Chrome el reconocimiento lo hace el servicio de voz del navegador (el audio sale a un servidor del
// proveedor). No pasa por Campus Pulse ni se guarda aquí.

import { el } from './dom.js';
import * as toasts from './toasts.js';
import { IDIOMA_VOZ, elegirVoz, mensajeDeErrorDeVoz, unirDictado } from './voz-texto.js';

const Reconocimiento = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;

/** ¿Este navegador puede dictar? */
export const puedeDictar = typeof Reconocimiento === 'function';
/** ¿Este navegador puede leer en voz alta? */
export const puedeHablar = 'speechSynthesis' in globalThis && typeof globalThis.SpeechSynthesisUtterance === 'function';

// ---------- iconos (SVG en línea: no hay librerías de iconos) ----------

function icono(trazo) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const camino = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  camino.setAttribute('d', trazo);
  svg.append(camino);
  return svg;
}

const MICROFONO = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3';
const ALTAVOZ = 'M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';

// ---------- dictado ----------

let reconocimientoActivo = null; // solo se dicta en un campo a la vez

/**
 * Agrega un botón de micrófono que dicta dentro de `campo` (input o textarea) y lo deja justo después de
 * `anclaje`. Devuelve el botón, o null si el navegador no puede dictar.
 * `conTexto`: muestra "Dictar" junto al icono (en formularios amplios); si no, solo el icono.
 */
export function agregarDictado(campo, anclaje, { conTexto = false } = {}) {
  if (!puedeDictar) return null;

  const boton = el('button', {
    type: 'button',
    className: `btn btn--secundario btn--voz${conTexto ? '' : ' btn--voz-icono'}`,
    title: 'Dictar por voz',
    'aria-label': 'Dictar por voz',
    'aria-pressed': 'false',
  }, icono(MICROFONO), conTexto ? el('span', {}, 'Dictar por voz') : null);

  boton.addEventListener('click', () => {
    if (reconocimientoActivo?.boton === boton) reconocimientoActivo.reconocimiento.stop();
    else empezar(campo, boton);
  });
  anclaje.after(boton);
  return boton;
}

function empezar(campo, boton) {
  reconocimientoActivo?.reconocimiento.abort(); // si había otro dictado en marcha, se corta

  const reconocimiento = new Reconocimiento();
  reconocimiento.lang = IDIOMA_VOZ;
  reconocimiento.interimResults = true; // se ve lo que se va entendiendo mientras se habla
  reconocimiento.continuous = false;
  reconocimiento.maxAlternatives = 1;

  const textoInicial = campo.value;
  const marcarEstado = (escuchando) => {
    boton.setAttribute('aria-pressed', String(escuchando));
    boton.classList.toggle('btn--voz-activo', escuchando);
    boton.title = escuchando ? 'Detener el dictado' : 'Dictar por voz';
  };

  reconocimiento.onresult = (evento) => {
    const dictado = Array.from(evento.results).map((r) => r[0].transcript).join(' ');
    campo.value = unirDictado(textoInicial, dictado);
    campo.dispatchEvent(new Event('input', { bubbles: true })); // por si algo escucha el campo
  };
  reconocimiento.onerror = (evento) => {
    const mensaje = mensajeDeErrorDeVoz(evento.error);
    if (mensaje) toasts.error(mensaje);
  };
  reconocimiento.onend = () => {
    marcarEstado(false);
    if (reconocimientoActivo?.reconocimiento === reconocimiento) reconocimientoActivo = null;
    campo.focus();
  };

  try {
    reconocimiento.start();
    reconocimientoActivo = { reconocimiento, boton };
    marcarEstado(true);
  } catch (error) {
    toasts.error(mensajeDeErrorDeVoz(error?.name === 'NotAllowedError' ? 'not-allowed' : 'service-not-allowed'));
  }
}

// ---------- lectura en voz alta ----------

let hablando = null; // { boton } del que está leyendo ahora

function detener() {
  if (!puedeHablar) return;
  globalThis.speechSynthesis.cancel();
  hablando?.restaurar();
  hablando = null;
}

/** Detiene cualquier lectura en curso (por ejemplo, al cerrar el diálogo). */
export function detenerLectura() {
  detener();
}

/**
 * Crea un botón "Escuchar" que lee `obtenerTexto()` en voz alta; al pulsarlo de nuevo se detiene.
 * Devuelve null si el navegador no puede hablar.
 */
export function crearBotonEscuchar(obtenerTexto) {
  if (!puedeHablar) return null;

  const etiqueta = el('span', {}, 'Escuchar');
  const boton = el('button', {
    type: 'button',
    className: 'btn btn--secundario btn--chico btn--voz',
    'aria-pressed': 'false',
    title: 'Leer la respuesta en voz alta',
  }, icono(ALTAVOZ), etiqueta);

  const restaurar = () => {
    boton.setAttribute('aria-pressed', 'false');
    boton.classList.remove('btn--voz-activo');
    etiqueta.textContent = 'Escuchar';
  };

  boton.addEventListener('click', () => {
    if (hablando?.boton === boton) {
      detener();
      return;
    }
    detener();
    const texto = obtenerTexto();
    if (!texto) return;
    const lectura = new globalThis.SpeechSynthesisUtterance(texto);
    lectura.lang = IDIOMA_VOZ;
    lectura.voice = elegirVoz(globalThis.speechSynthesis.getVoices());
    lectura.onend = lectura.onerror = () => {
      if (hablando?.boton === boton) hablando = null;
      restaurar();
    };
    hablando = { boton, restaurar };
    boton.setAttribute('aria-pressed', 'true');
    boton.classList.add('btn--voz-activo');
    etiqueta.textContent = 'Detener';
    globalThis.speechSynthesis.speak(lectura);
  });
  return boton;
}
