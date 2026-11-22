// =====================================================================
// OBJETOS DE CRISTAL DEL LOGIN (WebGL directo, sin librerías)
// ---------------------------------------------------------------------
// Dibuja donas y esferas 3D lisas y brillantes, con degradé iridiscente.
// Un programa de GPU tiene dos partes (shaders):
//   - Vértices: por cada punto de la malla, lo gira con la matriz de rotación y lo
//     proyecta en perspectiva (lo lejano se ve más pequeño).
//   - Fragmentos: por cada píxel, calcula su color: degradé según hacia dónde mira la
//     superficie, luz, destello blanco y borde claro. Al hacerse píxel por píxel el
//     resultado es liso, sin facetas.
// crearCristal devuelve null si el navegador no tiene WebGL: el login sigue funcionando
// con el cielo de estrellas, solo sin los objetos.
// =====================================================================

import {
  icosfera, matrizParaGL, matrizRotacion, toro, triangulos,
} from './geometria.js';

const VERTICES = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;

uniform mat3 uGiro;        // rotación del objeto
uniform vec2 uCentro;      // centro del objeto en pantalla (px CSS)
uniform float uTamano;     // radio base en px
uniform float uDistancia;  // distancia de la cámara al centro (en radios)
uniform vec2 uPantalla;    // ancho y alto del canvas (px CSS)

varying vec3 vNormal;
varying vec2 vUV;

void main() {
  vec3 p = uGiro * aPos;
  // Perspectiva: la cámara está en z = -distancia mirando hacia +z; lo lejano (z mayor) se achica
  float escala = uDistancia / (uDistancia + p.z);
  vec2 px = uCentro + vec2(p.x, -p.y) * uTamano * escala; // en pantalla la y crece hacia abajo
  vec2 ndc = vec2(px.x / uPantalla.x * 2.0 - 1.0, 1.0 - px.y / uPantalla.y * 2.0);
  gl_Position = vec4(ndc, p.z * 0.4, 1.0); // z sirve para que lo cercano tape a lo lejano
  vNormal = uGiro * aNormal;
  vUV = aUV;
}
`;

const FRAGMENTO = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec3 vNormal;
varying vec2 vUV;

uniform float uFase;       // corre el degradé con el tiempo
uniform float uOnda;       // fuerza de las ondulaciones (0 en la esfera)
uniform float uOpacidad;

// Degradé iridiscente: azul profundo, azul, violeta, blanco lila, rosa, cian, y vuelve al azul
vec3 degrade(float p) {
  float x = fract(p) * 6.0;
  vec3 c0 = vec3(0.102, 0.188, 0.839);
  vec3 c1 = vec3(0.259, 0.376, 1.000);
  vec3 c2 = vec3(0.580, 0.424, 0.980);
  vec3 c3 = vec3(0.933, 0.894, 1.000);
  vec3 c4 = vec3(1.000, 0.729, 0.918);
  vec3 c5 = vec3(0.455, 0.808, 1.000);
  vec3 c = mix(c0, c1, clamp(x, 0.0, 1.0));
  c = mix(c, c2, clamp(x - 1.0, 0.0, 1.0));
  c = mix(c, c3, clamp(x - 2.0, 0.0, 1.0));
  c = mix(c, c4, clamp(x - 3.0, 0.0, 1.0));
  c = mix(c, c5, clamp(x - 4.0, 0.0, 1.0));
  return mix(c, c0, clamp(x - 5.0, 0.0, 1.0));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 luz = normalize(vec3(-0.6, 0.55, -0.6));          // arriba a la izquierda, hacia la cámara
  vec3 medio = normalize(luz + vec3(0.0, 0.0, -1.0));    // entre la luz y la cámara, para el destello

  // 1. Color del degradé según hacia dónde mira la superficie, con ondulaciones a lo largo del tubo
  float onda = uOnda * sin(vUV.y * 12.566 + vUV.x * 12.566) + uOnda * 0.5 * sin(vUV.y * 25.133 - vUV.x * 6.283);
  vec3 base = degrade(0.5 + 0.4 * n.y + 0.22 * n.x + onda + uFase);

  // 2. Luz difusa (Lambert): lo que da la espalda a la luz se oscurece hacia un azul intenso
  float difusa = max(dot(n, luz), 0.0);
  vec3 color = mix(vec3(0.03, 0.07, 0.5), base, 0.4 + 0.6 * difusa);

  // 3. Borde claro cian donde la superficie casi no mira de frente (Fresnel)
  float borde = pow(1.0 - max(-n.z, 0.0), 3.0) * 0.4;
  color = mix(color, vec3(0.455, 0.808, 1.0), borde);

  // 4. Destello blanco donde la superficie refleja la luz hacia la cámara (Blinn-Phong)
  float destello = pow(max(dot(n, medio), 0.0), 40.0);
  color = mix(color, vec3(1.0), min(1.0, destello * 0.9));

  gl_FragColor = vec4(color * uOpacidad, uOpacidad); // el canvas espera color premultiplicado
}
`;

function compilar(gl, tipo, fuente) {
  const sombreador = gl.createShader(tipo);
  gl.shaderSource(sombreador, fuente);
  gl.compileShader(sombreador);
  return gl.getShaderParameter(sombreador, gl.COMPILE_STATUS) ? sombreador : null;
}

/** Sube una malla a la tarjeta gráfica: posición, normal y uv de cada vértice, más los índices de los triángulos. */
function subirMalla(gl, malla) {
  const n = malla.vertices.length;
  const datos = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    datos.set(malla.vertices[i], i * 8);
    datos.set(malla.normales[i], i * 8 + 3);
    datos.set(malla.uv ? malla.uv[i] : [0, 0], i * 8 + 6);
  }
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(gl.ARRAY_BUFFER, datos, gl.STATIC_DRAW);
  const lista = triangulos(malla.caras);
  const indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lista), gl.STATIC_DRAW);
  return { vertices, indices, cantidad: lista.length };
}

/**
 * Prepara el dibujo en el canvas. Devuelve {dibujar(objetos, ancho, alto, densidad)} o null sin WebGL.
 * Cada objeto: {malla: 'dona' | 'esfera', cx, cy, tamano, giro: [ax, ay, az], fase, opacidad}.
 */
export function crearCristal(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;
  const vs = compilar(gl, gl.VERTEX_SHADER, VERTICES);
  const fs = compilar(gl, gl.FRAGMENT_SHADER, FRAGMENTO);
  if (!vs || !fs) return null;
  const programa = gl.createProgram();
  gl.attachShader(programa, vs);
  gl.attachShader(programa, fs);
  gl.linkProgram(programa);
  if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) return null;
  gl.useProgram(programa);

  const mallas = {
    dona: subirMalla(gl, toro(1, 0.4, 128, 64)),
    esfera: subirMalla(gl, icosfera(4)),
  };
  const lugar = Object.fromEntries(['aPos', 'aNormal', 'aUV'].map((nombre) => [nombre, gl.getAttribLocation(programa, nombre)]));
  const u = Object.fromEntries(['uGiro', 'uCentro', 'uTamano', 'uDistancia', 'uPantalla', 'uFase', 'uOnda', 'uOpacidad']
    .map((nombre) => [nombre, gl.getUniformLocation(programa, nombre)]));
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  return {
    dibujar(objetos, ancho, alto, densidad) {
      const [w, h] = [Math.round(ancho * densidad), Math.round(alto * densidad)];
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform2f(u.uPantalla, ancho, alto);
      for (const o of objetos) {
        const malla = mallas[o.malla];
        gl.clear(gl.DEPTH_BUFFER_BIT); // cada objeto se ordena solo contra sí mismo
        gl.bindBuffer(gl.ARRAY_BUFFER, malla.vertices);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, malla.indices);
        gl.enableVertexAttribArray(lugar.aPos);
        gl.vertexAttribPointer(lugar.aPos, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(lugar.aNormal);
        gl.vertexAttribPointer(lugar.aNormal, 3, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(lugar.aUV);
        gl.vertexAttribPointer(lugar.aUV, 2, gl.FLOAT, false, 32, 24);
        gl.uniformMatrix3fv(u.uGiro, false, matrizParaGL(matrizRotacion(...o.giro)));
        gl.uniform2f(u.uCentro, o.cx, o.cy);
        gl.uniform1f(u.uTamano, o.tamano);
        gl.uniform1f(u.uDistancia, 4);
        gl.uniform1f(u.uFase, o.fase);
        gl.uniform1f(u.uOnda, o.malla === 'dona' ? 0.085 : 0);
        gl.uniform1f(u.uOpacidad, o.opacidad);
        gl.drawElements(gl.TRIANGLES, malla.cantidad, gl.UNSIGNED_SHORT, 0);
      }
    },
  };
}
