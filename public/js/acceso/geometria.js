// =====================================================================
// GEOMETRÍA 3D DEL LOGIN (sin librerías)
// ---------------------------------------------------------------------
// Funciones puras para dibujar objetos 3D en un <canvas> 2D:
//   1. Mallas: icosfera (planeta y asteroides) y toro (la dona).
//   2. Rotar cada vértice con matrices de rotación.
//   3. Proyectar en perspectiva: lo lejano se ve más pequeño.
//   4. Sombrear cada cara con la luz (ley de Lambert) y ordenarlas
//      de atrás hacia adelante (algoritmo del pintor).
// No tocan el DOM: se prueban en tests/acceso-geometria.test.js.
// =====================================================================

// ---------- números aleatorios con semilla ----------

/** Generador con semilla (mulberry32): la misma semilla da el mismo planeta en cada visita. */
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

// ---------- vectores ----------

const restar = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function normalizar(v) {
  const largo = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / largo, v[1] / largo, v[2] / largo];
}

// ---------- mallas ----------

/**
 * Icosfera: un icosaedro (20 triángulos) cuyas caras se dividen en 4, `divisiones` veces,
 * llevando cada vértice nuevo a la superficie de la esfera. 0 → 20 caras, 1 → 80, 2 → 320.
 * `relieve` mueve cada vértice hacia adentro o afuera (0 = esfera perfecta) para el aspecto low-poly.
 * Devuelve {vertices: [[x,y,z]], caras: [[i,j,k]], altura: [número por vértice]}.
 */
export function icosfera(divisiones = 2, { relieve = 0, semilla = 1 } = {}) {
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
  const azar = aleatorio(semilla);
  const altura = vertices.map(() => (azar() * 2 - 1) * relieve);
  return { vertices: vertices.map((v, i) => v.map((c) => c * (1 + altura[i]))), caras, altura };
}

/**
 * Toro (una dona): radio mayor R hasta el centro del tubo y radio menor r del tubo.
 * Las caras son cuadriláteros. `u` (0..1) dice en qué parte de la vuelta grande está cada cara,
 * para pintarla con un color distinto (efecto iridiscente).
 */
export function toro(R = 1, r = 0.4, segmentos = 28, lados = 12) {
  const vertices = [];
  for (let i = 0; i < segmentos; i++) {
    const a = (i / segmentos) * Math.PI * 2;
    for (let j = 0; j < lados; j++) {
      const b = (j / lados) * Math.PI * 2;
      vertices.push([(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)]);
    }
  }
  const caras = [];
  const u = [];
  for (let i = 0; i < segmentos; i++) {
    for (let j = 0; j < lados; j++) {
      const i2 = (i + 1) % segmentos;
      const j2 = (j + 1) % lados;
      // En este orden la normal apunta hacia afuera del tubo (lo comprueba un test)
      caras.push([i * lados + j, i * lados + j2, i2 * lados + j2, i2 * lados + j]);
      u.push(i / segmentos);
    }
  }
  return { vertices, caras, u };
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

/** Aplica la matriz m al punto v. */
export function rotar(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Perspectiva: la cámara mira hacia +z desde z = -distancia. Un punto más lejano (z mayor) se ve
 * más pequeño. Devuelve [x, y, z, escala] en píxeles, con (cx, cy) como centro del objeto en pantalla.
 * En pantalla la y crece hacia abajo, por eso se invierte.
 */
export function proyectar([x, y, z], { cx, cy, tamano, distancia = 4 }) {
  const escala = distancia / (distancia + z);
  return [cx + x * tamano * escala, cy - y * tamano * escala, z, escala];
}

// ---------- luz y orden de dibujo ----------

/** Normal de una cara (hacia afuera si sus vértices van en el orden de la malla). */
export function normalDeCara(a, b, c) {
  return normalizar(cruz(restar(b, a), restar(c, a)));
}

/**
 * Ley de Lambert: una cara iluminada de frente recibe toda la luz y una de lado, nada.
 * `ambiente` es la luz mínima para que la cara oscura no quede negra.
 */
export function iluminacion(normal, luz, ambiente = 0.22) {
  return Math.min(1, ambiente + (1 - ambiente) * Math.max(0, punto(normal, luz)));
}

/** Mezcla dos colores [r,g,b] (t = 0 → a, t = 1 → b). */
export function mezclar(a, b, t) {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
}

/**
 * Prepara una malla para dibujarla: rota los vértices, descarta las caras de espaldas a la cámara
 * y devuelve las visibles ordenadas de la más lejana a la más cercana (algoritmo del pintor),
 * cada una con sus puntos en pantalla y su brillo (0..1).
 * colorDeCara(indice) da el color base [r,g,b] de cada cara.
 */
export function carasVisibles(malla, matriz, vista, luz, colorDeCara) {
  const rotados = malla.vertices.map((v) => rotar(matriz, v));
  const resultado = [];
  malla.caras.forEach((cara, indice) => {
    const pts = cara.map((i) => rotados[i]);
    const normal = normalDeCara(pts[0], pts[1], pts[2]);
    // La cámara está en z = -distancia mirando hacia +z: la cara se ve si su normal apunta hacia la cámara
    const centro = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    const haciaCamara = [-centro[0], -centro[1], -vista.distancia - centro[2]];
    if (punto(normal, haciaCamara) <= 0) return;
    resultado.push({
      puntos: pts.map((p) => proyectar(p, vista)),
      profundidad: centro[2],
      brillo: iluminacion(normal, luz),
      color: colorDeCara(indice),
    });
  });
  return resultado.sort((a, b) => b.profundidad - a.profundidad);
}
