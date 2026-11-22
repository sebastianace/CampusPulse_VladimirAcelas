// =====================================================================
// TESTS DE LA GEOMETRÍA 3D DEL LOGIN (public/js/acceso/geometria.js)
// ---------------------------------------------------------------------
// El cielo del login dibuja donas y esferas de cristal con WebGL. La luz se
// calcula con la normal de cada vértice: si una normal apunta hacia adentro
// el objeto se ve oscuro o "al revés", y si el uv no cubre 0..1 aparece una
// línea en la costura. Estos tests comprueban esos datos sin abrir un navegador.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aleatorio, icosfera, matrizParaGL, matrizRotacion, normalizar, toro, triangulos,
} from '../public/js/acceso/geometria.js';

const largo = (v) => Math.hypot(...v);
const cerca = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const producto = (m, v) => m.map((fila) => fila[0] * v[0] + fila[1] * v[1] + fila[2] * v[2]);

describe('aleatorio con semilla', () => {
  test('la misma semilla da la misma secuencia y todo queda en [0, 1)', () => {
    const [a, b] = [aleatorio(2026), aleatorio(2026)];
    for (let i = 0; i < 5; i++) assert.equal(a(), b());
    const c = aleatorio(7);
    for (let i = 0; i < 100; i++) { const x = c(); assert.ok(x >= 0 && x < 1); }
  });
});

describe('icosfera', () => {
  test('cada división multiplica las caras por 4: 20, 80, 320, 1280', () => {
    assert.deepEqual([0, 1, 2, 3].map((n) => icosfera(n).caras.length), [20, 80, 320, 1280]);
  });

  test('todos los vértices están en la esfera de radio 1 y la normal de cada uno es el propio vértice', () => {
    const { vertices, normales } = icosfera(3);
    assert.equal(normales.length, vertices.length);
    vertices.forEach((v, i) => {
      assert.ok(cerca(largo(v), 1, 1e-12));
      assert.deepEqual(normales[i], v);
    });
  });

  test('cabe en los índices de 16 bits que usa WebGL', () => {
    assert.ok(icosfera(4).vertices.length < 65536);
  });
});

describe('toro', () => {
  const R = 1;
  const r = 0.4;
  const malla = toro(R, r, 24, 10);

  test('tiene (segmentos+1)·(lados+1) vértices y segmentos·lados caras', () => {
    assert.equal(malla.vertices.length, 25 * 11);
    assert.equal(malla.normales.length, 25 * 11);
    assert.equal(malla.uv.length, 25 * 11);
    assert.equal(malla.caras.length, 240);
  });

  test('cada normal es unitaria y apunta del centro del tubo hacia el vértice', () => {
    malla.vertices.forEach((v, i) => {
      const n = malla.normales[i];
      assert.ok(cerca(largo(n), 1));
      // Restar r·normal deja el vértice sobre el círculo grande: radio R y altura 0
      const eje = v.map((c, k) => c - r * n[k]);
      assert.ok(cerca(Math.hypot(eje[0], eje[2]), R) && cerca(eje[1], 0));
    });
  });

  test('el uv llega hasta 1 en la costura (si no, se ve una línea)', () => {
    const us = malla.uv.map(([u]) => u);
    const vs = malla.uv.map(([, v]) => v);
    assert.equal(Math.min(...us), 0);
    assert.equal(Math.max(...us), 1);
    assert.equal(Math.min(...vs), 0);
    assert.equal(Math.max(...vs), 1);
  });

  test('la costura repite la posición: el último vértice coincide con el primero', () => {
    const [primero, ultimo] = [malla.vertices[0], malla.vertices[malla.vertices.length - 1]];
    assert.ok(primero.every((c, k) => cerca(c, ultimo[k], 1e-12)));
  });

  test('las caras usan solo vértices que existen', () => {
    assert.ok(malla.caras.every((cara) => cara.every((i) => i >= 0 && i < malla.vertices.length)));
  });
});

describe('triangulos', () => {
  test('los triángulos pasan igual y cada cuadrilátero se parte en dos', () => {
    assert.deepEqual(triangulos([[0, 1, 2]]), [0, 1, 2]);
    assert.deepEqual(triangulos([[0, 1, 2, 3]]), [0, 1, 2, 0, 2, 3]);
    assert.equal(triangulos(toro(1, 0.4, 24, 10).caras).length, 240 * 6);
  });
});

describe('rotación', () => {
  test('rotar no cambia el largo de un vector', () => {
    const m = matrizRotacion(0.7, -1.3, 2.1);
    for (const v of [[1, 0, 0], [0.3, -2, 5], [-1, 1, 1]]) assert.ok(cerca(largo(producto(m, v)), largo(v)));
  });

  test('girar 90° en Y lleva el eje X al eje -Z', () => {
    const r = producto(matrizRotacion(0, Math.PI / 2, 0), [1, 0, 0]);
    assert.ok(cerca(r[0], 0) && cerca(r[1], 0) && cerca(r[2], -1));
  });

  test('matrizParaGL entrega los 9 números por columnas, como los lee WebGL', () => {
    const m = matrizRotacion(0.3, 0.8, -0.4);
    const gl = matrizParaGL(m);
    assert.equal(gl.length, 9);
    // En WebGL la columna c va en gl[3c..3c+2]; el producto M·v es la suma de columnas por v
    const v = [0.5, -1.2, 2];
    const esperado = producto(m, v);
    const desdeGL = [0, 1, 2].map((fila) => gl[fila] * v[0] + gl[3 + fila] * v[1] + gl[6 + fila] * v[2]);
    desdeGL.forEach((x, k) => assert.ok(cerca(x, esperado[k])));
  });
});

describe('normalizar', () => {
  test('deja el vector con largo 1 y no se rompe con el vector cero', () => {
    assert.ok(cerca(largo(normalizar([3, 4, 12])), 1));
    assert.deepEqual(normalizar([0, 0, 0]), [0, 0, 0]);
  });
});
