// =====================================================================
// DIBUJO DEL QR COMO SVG
// ---------------------------------------------------------------------
// La librería (js/vendor/qrcode.js) calcula la matriz de cuadritos del QR;
// aquí se dibuja como SVG. Un SVG es vectorial: al imprimirlo no se
// pixela, que es lo que importa en un cartel pegado en la pared.
// =====================================================================

import qrcode from '../vendor/qrcode.js';

/**
 * Nivel de corrección de errores: 'Q' deja leer el código aunque se dañe cerca del 25 %
 * (rayones, un borde despegado). Cuesta algunos cuadritos más, y con una dirección corta se nota poco.
 */
export const NIVEL_QR = 'Q';

/** Matriz del QR: {tamano, oscuro(fila, columna)}. La versión se elige sola según el largo del texto. */
export function matrizQR(texto, nivel = NIVEL_QR) {
  const qr = qrcode(0, nivel);
  qr.addData(String(texto));
  qr.make();
  return { tamano: qr.getModuleCount(), oscuro: (fila, columna) => qr.isDark(fila, columna) };
}

const escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * SVG del QR. `margen` es la "zona de silencio" en cuadritos: el estándar pide 4 y sin ella
 * algunos lectores no encuentran el código. Los cuadritos oscuros contiguos de una fila se
 * juntan en un solo rectángulo para que el archivo sea corto.
 * `titulo` es el texto para lectores de pantalla.
 */
export function qrSvg(texto, { margen = 4, titulo = 'Código QR', color = 'currentColor', fondo = '#fff' } = {}) {
  const { tamano, oscuro } = matrizQR(texto);
  const lado = tamano + margen * 2;
  let trazo = '';
  for (let fila = 0; fila < tamano; fila++) {
    let columna = 0;
    while (columna < tamano) {
      if (!oscuro(fila, columna)) { columna++; continue; }
      const inicio = columna;
      while (columna < tamano && oscuro(fila, columna)) columna++;
      trazo += `M${inicio + margen} ${fila + margen}h${columna - inicio}v1h-${columna - inicio}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" role="img" aria-label="${escapar(titulo)}" shape-rendering="crispEdges">`
    + `<title>${escapar(titulo)}</title>`
    + `<rect width="${lado}" height="${lado}" fill="${escapar(fondo)}"/>`
    + `<path d="${trazo}" fill="${escapar(color)}"/></svg>`;
}
