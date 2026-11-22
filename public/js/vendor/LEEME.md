# Código de terceros

- **qrcode.js** — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4, de Kazuhiko Arase. Licencia MIT (el aviso está al inicio del archivo). Se copió **sin cambios** desde `dist/qrcode.mjs` del paquete de npm.

Por qué una librería y no código propio: un QR necesita corrección de errores Reed-Solomon, máscaras y tablas por versión. Es fácil equivocarse y el fallo no se nota hasta que un celular no lo lee. Se copia en vez de instalarla con npm para no agregar dependencias al servidor: el QR se dibuja en el navegador.

Para actualizarla: descargar la versión nueva, reemplazar el archivo, correr `npm test` y comprobar con un celular que un QR impreso se lee.
