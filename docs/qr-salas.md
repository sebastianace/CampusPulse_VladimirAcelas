# Códigos QR de las salas

Cada sala tiene un QR para reportar un daño en 10 segundos desde el celular. Pedido por Campuslands (21 nov 2026),
solo para profesores y personal con cuenta.

## Cómo funciona

```
Cartel en la pared ──escanear──► <sitio>/movil.html?sala=apolo
                                      │
                       ¿hay sesión?   │
                  no ─► login.html?volver=/movil.html?sala=apolo ─► (entra) ─┐
                  sí ───────────────────────────────────────────────────────┤
                                                                            ▼
              "Estás reportando en Apolo" + formulario con la sala ya elegida
```

- **El QR solo contiene una dirección.** Ni claves, ni usuarios, ni datos. Quien lo fotografíe solo llega al inicio de
  sesión. La seguridad es la de siempre: toda la API exige sesión (`exigirSesion`), el QR no abre ninguna puerta.
- **La sala sale de `?sala=`** (`public/js/qr/enlaces.js`, `leerSala`). Si el id no existe (un QR viejo o mal impreso)
  se avisa y se sigue con el formulario normal. No se adivina nada.
- **En el formulario** la sala queda elegida en "Espacio afectado". Si la IA nombra otra sala porque el texto la
  menciona, gana la de la IA (`sugerencia.espacioId ?? salaDelQR`). La persona siempre puede cambiarla.
- **Volver tras el login:** `irALogin()` ahora guarda `pathname + search`. Antes solo guardaba `pathname` y se perdía el `?sala=`.

## La hoja de impresión (`qr.html`)

- La abre un admin desde **Usuarios → Abrir hoja para imprimir**. Un profesor que entre a la dirección ve "Solo para
  administradores". (Es comodidad de la interfaz: la hoja no usa ninguna ruta nueva del servidor y el QR no es secreto.)
- Un cartel por sala (las 10, incluida Zona Hunters), con filtro para imprimir una sola. Impresión A4, 2 columnas × 3
  filas, borde punteado para recortar. Cada cartel trae también la dirección escrita, por si no se puede escanear.
- **Dirección base.** El hosting no está definido, así que no va fija en el código. Se toma del sitio donde se abre la
  hoja, se puede cambiar y queda recordada en el navegador. Tipos de dirección:

  | Dirección | Qué pasa con el celular | Qué hace la hoja |
  |---|---|---|
  | `localhost`, `127.0.0.1` | No la encuentra | Avisa en ámbar |
  | `192.168.x.x`, `10.x.x.x`, `*.local` | Solo con el Wi-Fi del campus | Avisa: sirve para probar |
  | Dominio o IP pública | Funciona desde cualquier red | OK (avisa si es `http` sin cifrar) |

  Sin esquema, un dominio se asume `https` y una IP o `localhost`, `http` (si no, el QR quedaría roto).
- **Cuando se defina el hosting:** abrir `qr.html` desde la dirección final (o escribirla), imprimir de nuevo y
  cambiar los carteles. Los carteles de prueba con IP interna dejan de servir.

## Decisiones (para sustentar)

| Decisión | Por qué |
|---|---|
| **Librería de QR copiada en `public/js/vendor/`** (`qrcode-generator` 2.0.4, MIT) | Un QR necesita corrección de errores Reed-Solomon, máscaras y tablas por versión. Hacerlo a mano es fácil de equivocar y el fallo solo se ve cuando un celular no lo lee. Copiarla (no instalarla) evita una dependencia más en el servidor y funciona sin red. |
| **Dibujar el QR en el navegador, como SVG** | No hay ruta nueva ni archivos que guardar. El SVG es vectorial: impreso no se pixela. Se arma a partir de la matriz que da la librería, juntando cuadritos contiguos de una fila en un rectángulo (archivo corto). |
| **Corrección de errores nivel Q (25 %)** | Un cartel pegado en la pared se raya y se despega. Q deja leer el código aunque se dañe un cuarto; cuesta pocos cuadritos más con una dirección corta. |
| **Dirección base editable, no en una variable de entorno** | No se sabe el dominio y puede cambiar. Así no hay que reiniciar nada ni tocar el servidor. |
| **El QR lleva `?sala=<id>`, no el nombre** | El id no cambia si renombran la sala; el nombre se busca al abrir. |
| **No se agregó `origen: "qr"` a las incidencias** | Habría pedido migración y cambio de contrato. Queda como idea para el piloto: medir cuántos reportes entran por QR. |

## Cómo se comprobó

- `npm test`: `tests/qr.test.js` (direcciones, alcance, ida y vuelta del enlace, que el SVG conserve exactamente la
  matriz y que los tres cuadros de posición estén donde van).
- **Lectura real de los códigos:** se generó la hoja con una base desechable, se exportó a PDF desde Chrome y se
  decodificó cada cartel con OpenCV (`QRCodeDetector`): los 10 devolvieron su dirección exacta.
- **Recorrido en Chrome con celular emulado (390 px):** sin sesión → login → vuelve a `movil.html?sala=apolo`; el aviso
  dice "Apolo"; el formulario manual trae Apolo elegido; la incidencia se guarda con `espacioId: apolo`; `?sala=zeus`
  avisa y deja el formulario normal.
- **Todavía no comprobado:** escanear un cartel impreso con un celular real y una cámara real (luz, ángulo, papel). Hacerlo
  con la primera tanda antes de imprimir las 10.

## Pendiente

- Definir el hosting y volver a imprimir con la dirección final.
- Idea: `origen: "qr"` en la incidencia para medir el uso en el piloto.
- Idea: que el QR abra también la **agenda de la sala** (está en la [hoja de ruta](hoja-de-ruta.md)).
- Si se actualizan los documentos de `knowledge/`, correr `npm run conocimiento` (necesita la clave de Gemini en `.env`)
  para que el asistente aprenda esta sección.
