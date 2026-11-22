// =====================================================================
// TESTS DE LA GEOMETRÍA 3D DEL LOGIN (public/js/acceso/geometria.js)
// ---------------------------------------------------------------------
// El cielo del login dibuja un planeta y una dona en 3D sin librerías.
// Si una normal apunta hacia adentro, la cara se ve "al revés" o
// desaparece; si el orden de dibujo falla, lo de atrás tapa lo de adelante.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aleatorio, carasVisibles, icosfera, iluminacion, matrizRotacion, mezclar, normalDeCara, proyectar, punto, rotar, toro,
} from '../public/js/acceso/geometria.js';

const largo = (v) => Math.hypot(...v);
const centro = (pts) => pts.reduce((s, p) => s.map((c, i) => c + p[i] / pts.length), [0, 0, 0]);
const cerca = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('aleatorio con semilla', () => {
  test('la misma semilla da la misma secuencia (el planeta es igual en cada visita)', () => {
    const [a, b] = [aleatorio(2026), aleatorio(2026)];
    for (let i = 0; i < 5; i++) assert.equal(a(), b());
    const c = aleatorio(7);
    for (let i = 0; i < 100; i++) { const x = c(); assert.ok(x >= 0 && x < 1); }
  });
});

describe('icosfera', () => {
  test('cada división multiplica las caras por 4: 20, 80, 320', () => {
    assert.deepEqual([0, 1, 2].map((n) => icosfera(n).caras.length), [20, 80, 320]);
  });

  test('sin relieve todos los vértices están en la esfera de radio 1', () => {
    for (const v of icosfera(2).vertices) assert.ok(cerca(largo(v), 1, 1e-12));
  });

  test('las normales de todas las caras apuntan hacia afuera', () => {
    const { vertices, caras } = icosfera(2);
    for (const cara of caras) {
      const pts = cara.map((i) => vertices[i]);
      assert.ok(punto(normalDeCara(...pts), centro(pts)) > 0);
    }
  });

  test('el relieve mueve los vértices dentro del margen pedido', () => {
    for (const v of icosfera(1, { relieve: 0.1, semilla: 3 }).vertices) assert.ok(largo(v) >= 0.9 - 1e-9 && largo(v) <= 1.1 + 1e-9);
  });
});

describe('toro', () => {
  test('tiene segmentos × lados caras y sus normales apuntan hacia afuera del tubo', () => {
    const R = 1;
    const malla = toro(R, 0.4, 24, 10);
    assert.equal(malla.caras.length, 240);
    for (const cara of malla.caras) {
      const pts = cara.map((i) => malla.vertices[i]);
      const c = centro(pts);
      // Centro del tubo más cercano: el punto del círculo grande en la dirección de la cara
      const ang = Math.atan2(c[2], c[0]);
      const eje = [R * Math.cos(ang), 0, R * Math.sin(ang)];
      assert.ok(punto(normalDeCara(pts[0], pts[1], pts[2]), c.map((x, i) => x - eje[i])) > 0);
    }
  });
});

describe('rotación y proyección', () => {
  test('rotar no cambia el largo de un vector', () => {
    const m = matrizRotacion(0.7, -1.3, 2.1);
    for (const v of [[1, 0, 0], [0.3, -2, 5], [-1, 1, 1]]) assert.ok(cerca(largo(rotar(m, v)), largo(v)));
  });

  test('girar 90° en Y lleva el eje X al eje -Z', () => {
    const r = rotar(matrizRotacion(0, Math.PI / 2, 0), [1, 0, 0]);
    assert.ok(cerca(r[0], 0) && cerca(r[1], 0) && cerca(r[2], -1));
  });

  test('perspectiva: el centro cae en (cx, cy), lo lejano se ve más pequeño y la y de pantalla crece hacia abajo', () => {
    const vista = { cx: 100, cy: 50, tamano: 10, distancia: 4 };
    assert.deepEqual(proyectar([0, 0, 0], vista).slice(0, 2), [100, 50]);
    assert.ok(proyectar([1, 0, 2], vista)[0] - 100 < proyectar([1, 0, -2], vista)[0] - 100);
    assert.ok(proyectar([0, 1, 0], vista)[1] < 50);
  });
});

describe('luz y orden de dibujo', () => {
  test('la luz va de la luz ambiente (de espaldas) a 1 (de frente)', () => {
    assert.equal(iluminacion([0, 0, 1], [0, 0, 1]), 1);
    assert.equal(iluminacion([0, 0, -1], [0, 0, 1], 0.2), 0.2);
  });

  test('mezclar colores va de un extremo al otro', () => {
    assert.deepEqual(mezclar([0, 0, 0], [200, 100, 50], 0), [0, 0, 0]);
    assert.deepEqual(mezclar([0, 0, 0], [200, 100, 50], 0.5), [100, 50, 25]);
  });

  test('de una esfera se ve menos de la mitad, ordenada de atrás hacia adelante', () => {
    const malla = icosfera(2);
    const vista = { cx: 0, cy: 0, tamano: 100, distancia: 4 };
    const caras = carasVisibles(malla, matrizRotacion(0.3, 0.8, 0), vista, [0, 0, -1], () => [255, 255, 255]);
    assert.ok(caras.length > 100 && caras.length < 160, `${caras.length} caras visibles`);
    for (let i = 1; i < caras.length; i++) assert.ok(caras[i - 1].profundidad >= caras[i].profundidad);
    // Todas miran hacia la cámara (z negativa): ninguna es de la cara oculta
    assert.ok(caras.every((c) => c.profundidad < 0.35));
    assert.ok(caras.every((c) => c.brillo > 0 && c.brillo <= 1));
  });
});
