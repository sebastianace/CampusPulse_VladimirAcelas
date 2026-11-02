// Cámara del mapa: arrastrar para moverse, rueda o pellizco para el zoom,
// flechas y +/− con el teclado. Distingue un clic de un arrastre para que
// soltar después de mover el mapa no reserve una sala sin querer.

const ZOOM_MAXIMO = 3;          // 3 px de pantalla por px de mundo (una baldosa = 48 px)
const UMBRAL_ARRASTRE = 5;      // px que hay que mover para que deje de ser clic
const PASO_TECLADO = 80;        // px de pantalla por pulsación de flecha

export function crearCamara(lienzo, mundo, { alClic, alPasar, alSalir }) {
  const cam = { x: 0, y: 0, zoom: 1, anchoVista: 1, altoVista: 1 };
  let zoomMinimo = 0.1;
  let animacion = null;           // destino de una transición suave
  const punteros = new Map();     // punteros activos (para pellizco)
  let inicioArrastre = null;
  let distanciaPellizco = 0;

  // ---------- Conversión de coordenadas ----------
  const aMundo = (sx, sy) => ({ x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom });

  function ajustarVista(ancho, alto) {
    const encuadrada = cam.zoom <= zoomMinimo * 1.001;
    cam.anchoVista = ancho;
    cam.altoVista = alto;
    zoomMinimo = Math.min(ancho / mundo.ancho, alto / mundo.alto) * 0.96;
    if (encuadrada) encuadrar(false);
    else limitar();
  }

  // Mantiene el edificio a la vista: si cabe entero se centra, si no, no deja salirse
  // (sirve para la cámara y para el destino de una transición)
  function limitar(c = cam) {
    c.zoom = Math.min(ZOOM_MAXIMO, Math.max(zoomMinimo, c.zoom));
    const anchoMundoVisible = cam.anchoVista / c.zoom;
    const altoMundoVisible = cam.altoVista / c.zoom;
    c.x = anchoMundoVisible >= mundo.ancho
      ? (mundo.ancho - anchoMundoVisible) / 2
      : Math.min(mundo.ancho - anchoMundoVisible, Math.max(0, c.x));
    c.y = altoMundoVisible >= mundo.alto
      ? (mundo.alto - altoMundoVisible) / 2
      : Math.min(mundo.alto - altoMundoVisible, Math.max(0, c.y));
    return c;
  }

  function irA(destino, suave) {
    limitar(destino);
    if (suave) animacion = destino;
    else { animacion = null; Object.assign(cam, destino); }
  }

  function zoomEn(factor, sx, sy) {
    animacion = null;
    const antes = aMundo(sx, sy);
    cam.zoom = Math.min(ZOOM_MAXIMO, Math.max(zoomMinimo, cam.zoom * factor));
    cam.x = antes.x - sx / cam.zoom;
    cam.y = antes.y - sy / cam.zoom;
    limitar();
  }

  /** Lleva la cámara a un rectángulo del mundo (en px de mundo). */
  function enfocar({ x, y, w, h }, suave = true) {
    const zoom = Math.min(ZOOM_MAXIMO, Math.max(zoomMinimo,
      Math.min(cam.anchoVista / (w * 1.8), cam.altoVista / (h * 1.8))));
    irA({ zoom, x: x + w / 2 - cam.anchoVista / zoom / 2, y: y + h / 2 - cam.altoVista / zoom / 2 }, suave);
  }

  // Todo el piso a la vista
  function encuadrar(suave = true) {
    irA({ zoom: zoomMinimo, x: 0, y: 0 }, suave);
  }

  // Avanza la transición suave; devuelve true si la cámara se movió
  function paso(dt) {
    if (!animacion) return false;
    const t = 1 - Math.exp(-dt * 9);
    cam.zoom += (animacion.zoom - cam.zoom) * t;
    cam.x += (animacion.x - cam.x) * t;
    cam.y += (animacion.y - cam.y) * t;
    limitar();
    if (Math.abs(animacion.zoom - cam.zoom) < 0.001 && Math.abs(animacion.x - cam.x) < 0.5 && Math.abs(animacion.y - cam.y) < 0.5) {
      animacion = null;
    }
    return true;
  }

  // ---------- Eventos ----------
  const posicion = (evento) => {
    const r = lienzo.getBoundingClientRect();
    return { sx: evento.clientX - r.left, sy: evento.clientY - r.top };
  };

  lienzo.addEventListener('wheel', (evento) => {
    evento.preventDefault();
    const { sx, sy } = posicion(evento);
    zoomEn(Math.exp(-evento.deltaY * (evento.ctrlKey ? 0.01 : 0.0015)), sx, sy);
  }, { passive: false });

  lienzo.addEventListener('pointerdown', (evento) => {
    lienzo.setPointerCapture(evento.pointerId);
    punteros.set(evento.pointerId, posicion(evento));
    animacion = null;
    if (punteros.size === 1) {
      const { sx, sy } = posicion(evento);
      inicioArrastre = { sx, sy, camX: cam.x, camY: cam.y, movido: false };
    } else if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      distanciaPellizco = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      if (inicioArrastre) inicioArrastre.movido = true; // un pellizco nunca es clic
    }
  });

  lienzo.addEventListener('pointermove', (evento) => {
    const actual = posicion(evento);
    if (!punteros.has(evento.pointerId)) {
      alPasar(actual.sx, actual.sy);
      return;
    }
    punteros.set(evento.pointerId, actual);

    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      const distancia = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      if (distanciaPellizco > 0) zoomEn(distancia / distanciaPellizco, (a.sx + b.sx) / 2, (a.sy + b.sy) / 2);
      distanciaPellizco = distancia;
      return;
    }

    if (!inicioArrastre) return;
    const dx = actual.sx - inicioArrastre.sx;
    const dy = actual.sy - inicioArrastre.sy;
    if (!inicioArrastre.movido && Math.hypot(dx, dy) < UMBRAL_ARRASTRE) return;
    inicioArrastre.movido = true;
    lienzo.dataset.arrastrando = '';
    cam.x = inicioArrastre.camX - dx / cam.zoom;
    cam.y = inicioArrastre.camY - dy / cam.zoom;
    limitar();
  });

  const soltar = (evento) => {
    if (!punteros.has(evento.pointerId)) return;
    punteros.delete(evento.pointerId);
    if (punteros.size > 0) return;
    if (evento.type === 'pointerup' && inicioArrastre && !inicioArrastre.movido) {
      const { sx, sy } = posicion(evento);
      alClic(sx, sy);
    }
    inicioArrastre = null;
    distanciaPellizco = 0;
    delete lienzo.dataset.arrastrando;
  };
  lienzo.addEventListener('pointerup', soltar);
  lienzo.addEventListener('pointercancel', soltar);
  lienzo.addEventListener('pointerleave', () => { if (!punteros.size) alSalir(); });

  lienzo.addEventListener('keydown', (evento) => {
    const centro = [cam.anchoVista / 2, cam.altoVista / 2];
    const movimientos = {
      ArrowLeft: [-PASO_TECLADO, 0], ArrowRight: [PASO_TECLADO, 0],
      ArrowUp: [0, -PASO_TECLADO], ArrowDown: [0, PASO_TECLADO],
    };
    if (movimientos[evento.key]) {
      const [dx, dy] = movimientos[evento.key];
      animacion = null;
      cam.x += dx / cam.zoom;
      cam.y += dy / cam.zoom;
      limitar();
    } else if (evento.key === '+' || evento.key === '=') zoomEn(1.25, ...centro);
    else if (evento.key === '-' || evento.key === '_') zoomEn(0.8, ...centro);
    else if (evento.key === '0') encuadrar();
    else return;
    evento.preventDefault();
  });

  return {
    estado: cam,
    aMundo,
    ajustarVista,
    paso,
    enfocar,
    encuadrar,
    acercar: () => zoomEn(1.4, cam.anchoVista / 2, cam.altoVista / 2),
    alejar: () => zoomEn(1 / 1.4, cam.anchoVista / 2, cam.altoVista / 2),
    get encuadrada() { return cam.zoom <= zoomMinimo * 1.01; },
  };
}
