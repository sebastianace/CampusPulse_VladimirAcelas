// =====================================================================
// TESTS DE LOS QR DE LAS SALAS (public/js/qr/)
// ---------------------------------------------------------------------
// El QR de cada sala lleva una dirección. Si la dirección sale mal armada
// (barra de más, página pegada, "localhost" sin aviso) el cartel impreso no
// sirve y se descubre cuando ya está pegado en la pared.
// Que un celular lo lea de verdad se comprobó aparte decodificando las
// imágenes (ver docs/qr-salas.md): aquí se prueba lo que se puede en Node.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  alcanceDeLaDireccion, enlaceSala, leerSala, normalizarBase,
} from '../public/js/qr/enlaces.js';
import { matrizQR, qrSvg } from '../public/js/qr/svg.js';

describe('normalizarBase', () => {
  test('quita la barra final, la página, el query y el #', () => {
    assert.equal(normalizarBase('https://campuspulse.ejemplo.com/'), 'https://campuspulse.ejemplo.com');
    assert.equal(normalizarBase('http://192.168.1.20:3000/login.html'), 'http://192.168.1.20:3000');
    assert.equal(normalizarBase('https://ejemplo.com/pulse/movil.html?sala=apolo#x'), 'https://ejemplo.com/pulse');
    assert.equal(normalizarBase('  https://ejemplo.com/pulse//  '), 'https://ejemplo.com/pulse');
  });

  test('sin esquema: un dominio es https; una IP o un nombre interno es http (si no, el QR queda roto)', () => {
    assert.equal(normalizarBase('campuspulse.ejemplo.com'), 'https://campuspulse.ejemplo.com');
    assert.equal(normalizarBase('192.168.1.20:3000'), 'http://192.168.1.20:3000');
    assert.equal(normalizarBase('192.168.1.20:3000/login.html'), 'http://192.168.1.20:3000');
    assert.equal(normalizarBase('localhost:3000'), 'http://localhost:3000');
    assert.equal(normalizarBase('equipo.local:3000'), 'http://equipo.local:3000');
    assert.equal(normalizarBase('https://192.168.1.20:3000'), 'https://192.168.1.20:3000'); // lo escrito con esquema se respeta
  });

  test('rechaza lo que no es una dirección web usable', () => {
    for (const malo of ['', '   ', null, undefined, 'javascript:alert(1)', 'ftp://ejemplo.com', 'mi sitio', 'https://', 'https://ana:clave@ejemplo.com']) {
      assert.equal(normalizarBase(malo), null, `debería rechazar ${JSON.stringify(malo)}`);
    }
  });
});

describe('alcanceDeLaDireccion', () => {
  test('localhost y 127.x solo se abren desde el mismo computador', () => {
    for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://0.0.0.0:3000', 'http://[::1]:3000']) {
      assert.equal(alcanceDeLaDireccion(base), 'local', base);
    }
  });

  test('las IP internas solo funcionan con el Wi-Fi del campus', () => {
    for (const base of ['http://192.168.1.20:3000', 'http://10.0.0.5', 'http://172.16.0.9', 'http://172.31.255.1', 'http://equipo.local:3000']) {
      assert.equal(alcanceDeLaDireccion(base), 'red', base);
    }
  });

  test('un dominio o una IP pública se abre desde cualquier lugar', () => {
    for (const base of ['https://campuspulse.ejemplo.com', 'http://172.32.0.1', 'http://8.8.8.8', 'http://192.169.1.1']) {
      assert.equal(alcanceDeLaDireccion(base), 'publica', base);
    }
  });
});

describe('enlaceSala y leerSala', () => {
  test('el enlace lleva la página de reporte y el id de la sala codificado', () => {
    assert.equal(enlaceSala('https://ejemplo.com', 'apolo'), 'https://ejemplo.com/movil.html?sala=apolo');
    assert.equal(enlaceSala('http://10.0.0.5:3000', 'sala a/b'), 'http://10.0.0.5:3000/movil.html?sala=sala%20a%2Fb');
  });

  test('lo que se escribe en el QR se vuelve a leer igual (ida y vuelta)', () => {
    const espacios = [{ id: 'apolo', nombre: 'Apolo' }, { id: 'sala a/b', nombre: 'Rara' }];
    for (const e of espacios) {
      const url = new URL(enlaceSala('https://ejemplo.com', e.id));
      assert.equal(leerSala(url.search, espacios).espacio, e);
    }
  });

  test('distingue "sin sala", "sala que existe" y "código que no corresponde a ninguna sala"', () => {
    const espacios = [{ id: 'apolo', nombre: 'Apolo' }];
    assert.deepEqual(leerSala('', espacios), { id: null, espacio: null });
    assert.deepEqual(leerSala('?sala=', espacios), { id: null, espacio: null });
    assert.deepEqual(leerSala('?sala=apolo', espacios), { id: 'apolo', espacio: espacios[0] });
    assert.deepEqual(leerSala('?sala=zeus', espacios), { id: 'zeus', espacio: null });
  });
});

describe('QR', () => {
  const direccion = enlaceSala('https://campuspulse.ejemplo.com', 'apolo');
  const { tamano, oscuro } = matrizQR(direccion);

  test('el tamaño cumple la fórmula del estándar: 17 + 4 × versión', () => {
    assert.equal((tamano - 17) % 4, 0);
    assert.ok(tamano >= 21 && tamano <= 177);
  });

  test('tiene los tres cuadros de posición en las esquinas (y no en la cuarta)', () => {
    const cuadro = (f0, c0) => [0, 1, 2, 3, 4, 5, 6].every((i) => oscuro(f0, c0 + i) && oscuro(f0 + 6, c0 + i) && oscuro(f0 + i, c0) && oscuro(f0 + i, c0 + 6))
      && !oscuro(f0 + 1, c0 + 1) && oscuro(f0 + 2, c0 + 2);
    assert.ok(cuadro(0, 0) && cuadro(0, tamano - 7) && cuadro(tamano - 7, 0));
    assert.ok(!cuadro(tamano - 7, tamano - 7));
  });

  test('es determinista: la misma dirección da el mismo dibujo', () => {
    assert.equal(qrSvg(direccion), qrSvg(direccion));
    assert.notEqual(qrSvg(direccion), qrSvg(enlaceSala('https://campuspulse.ejemplo.com', 'zeus')));
  });

  test('el SVG conserva exactamente la matriz: juntar cuadritos en rectángulos no pierde ninguno', () => {
    const margen = 4;
    const svg = qrSvg(direccion, { margen });
    assert.match(svg, new RegExp(`viewBox="0 0 ${tamano + margen * 2} ${tamano + margen * 2}"`));
    const trazo = svg.match(/<path d="([^"]*)"/)[1];
    const leido = Array.from({ length: tamano }, () => Array(tamano).fill(false));
    for (const [, x, y, ancho] of trazo.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(ancho); i++) leido[Number(y) - margen][Number(x) - margen + i] = true;
    }
    for (let f = 0; f < tamano; f++) for (let c = 0; c < tamano; c++) assert.equal(leido[f][c], oscuro(f, c), `módulo ${f},${c}`);
  });

  test('el título se escapa: un nombre de sala con < o " no rompe el SVG', () => {
    const svg = qrSvg(direccion, { titulo: 'Sala "A" <b>&' });
    assert.ok(!svg.includes('<b>'));
    assert.match(svg, /aria-label="Sala &quot;A&quot; &lt;b&gt;&amp;"/);
  });
});
