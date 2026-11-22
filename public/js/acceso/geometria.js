// =====================================================================
// GEOMETRÍA 3D DEL LOGIN (sin librerías)
// ---------------------------------------------------------------------
// Funciones puras que preparan los datos que la tarjeta gráfica dibuja
// (js/acceso/cristal.js):
//   1. Mallas: una icosfera (la esfera) y un toro (la dona). Cada vértice
//      trae su normal, que sirve para calcular la luz píxel por píxel.
//   2. Matrices de rotación 3x3 para girar los objetos.
//   3. Ayudas para convertirlo todo al formato de WebGL.
// No tocan el DOM: se prueban en tests/acceso-geometria.test.js.
// =====================================================================

// ---------- números aleatorios con semilla ----------

/** Generador con semilla (mulberry32): la misma semilla da la misma secuencia. */
export function aleatorio(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vector de largo 1 con la misma dirección. */
export function normalizar(v) {
  const largo = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / largo, v[1] / largo, v[2] / largo];
}

// ---------- mallas ----------

/**
 * Icosfera: un icosaedro (20 triángulos) cuyas caras se dividen en 4, `divisiones` veces,
 * llevando cada vértice nuevo a la superficie de la esfera. 0 → 20 caras, 1 → 80, 2 → 320, 3 → 1280.
 * En una esfera de radio 1 la normal de cada vértice es el propio vértice.
 * Devuelve {vertices: [[x,y,z]], normales: [[x,y,z]], caras: [[i,j,k]]}.
 */
export function icosfera(divisiones = 3) {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalizar);
  let caras = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let n = 0; n < divisiones; n++) {
    const medios = new Map(); // un punto medio por arista, compartido por las dos caras que la usan
    const medio = (a, b) => {
      const clave = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!medios.has(clave)) {
        const [va, vb] = [vertices[a], vertices[b]];
        vertices.push(normalizar([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
        medios.set(clave, vertices.length - 1);
      }
      return medios.get(clave);
    };
    caras = caras.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [medio(a, b), medio(b, c), medio(c, a)];
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  return { vertices, normales: vertices.map((v) => [...v]), caras };
}

/**
 * Toro (una dona): radio mayor R hasta el centro del tubo y radio menor r del tubo.
 * `a` es el ángulo en la vuelta grande y `b` el de la vuelta del tubo. Cada vértice es
 *   ((R + r·cos b)·cos a,  r·sin b,  (R + r·cos b)·sin a)
 * y su normal apunta del centro del tubo hacia el vértice: (cos b·cos a, sin b, cos b·sin a).
 * `uv` guarda (a, b) de cada vértice como fracciones de vuelta para dar ondulaciones al color.
 * La última fila y la última columna repiten la primera (con uv = 1 en vez de 0): si no, en la
 * costura el uv volvería de 0.99 a 0 y se vería una línea. Hay (segmentos+1)·(lados+1) vértices.
 * Las caras son cuadriláteros que recorren esa cuadrícula.
 */
export function toro(R = 1, r = 0.4, segmentos = 96, lados = 48) {
  const vertices = [];
  const normales = [];
  const uv = [];
  for (let i = 0; i <= segmentos; i++) {
    const a = (i / segmentos) * Math.PI * 2;
    for (let j = 0; j <= lados; j++) {
      const b = (j / lados) * Math.PI * 2;
      const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
      vertices.push([(R + r * cb) * ca, r * sb, (R + r * cb) * sa]);
      normales.push([cb * ca, sb, cb * sa]);
      uv.push([i / segmentos, j / lados]);
    }
  }
  const ancho = lados + 1;
  const caras = [];
  for (let i = 0; i < segmentos; i++) {
    for (let j = 0; j < lados; j++) {
      caras.push([i * ancho + j, i * ancho + j + 1, (i + 1) * ancho + j + 1, (i + 1) * ancho + j]);
    }
  }
  return { vertices, normales, uv, caras };
}

/**
 * Lista plana de índices de triángulos (lo que pide la tarjeta gráfica): los triángulos pasan tal cual
 * y cada cuadrilátero [a,b,c,d] se parte en dos, [a,b,c] y [a,c,d].
 */
export function triangulos(caras) {
  const indices = [];
  for (const cara of caras) {
    for (let k = 1; k < cara.length - 1; k++) indices.push(cara[0], cara[k], cara[k + 1]);
  }
  return indices;
}

// ---------- transformaciones ----------

/** Matriz de rotación 3x3: primero en X, luego en Y, luego en Z (ángulos en radianes). */
export function matrizRotacion(ax, ay, az) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  // Rz · Ry · Rx
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/** WebGL lee las matrices por columnas; aquí van por filas. Devuelve los 9 números en el orden de WebGL. */
export function matrizParaGL(m) {
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
}
