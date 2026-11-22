// Pantalla de inicio de sesión: dos tarjetas.
// - Derecha: entrar.
// - Izquierda: qué es Campus Pulse; mientras no exista ninguna cuenta, ahí se crea la primera (admin).
// Al terminar se vuelve a la página que pidió el login (?volver=/movil.html) o al tablero principal.

import { pedir } from './api.js';
import { conCarga } from './dom.js';
import * as toasts from './toasts.js';

const formLogin = document.getElementById('form-login');
const formRegistro = document.getElementById('form-registro');
// Con mouse se pone el foco en el primer campo; en el celular no, para que el teclado no tape la pantalla
const conMouse = window.matchMedia('(hover: hover)').matches;

// Solo se acepta volver a una ruta de este mismo sitio ("/algo", nunca "//otro-sitio")
function destino() {
  const volver = new URLSearchParams(location.search).get('volver') ?? '/';
  return volver.startsWith('/') && !volver.startsWith('//') ? volver : '/';
}

// Envía el formulario a la ruta indicada; si sale bien, entra a la app
async function enviar(evento, ruta, textoCargando) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const vacio = [...form.querySelectorAll('[required]')].find((campo) => !campo.value.trim());
  if (vacio) {
    toasts.error('Completa todos los campos.');
    vacio.focus();
    return;
  }
  const cuerpo = Object.fromEntries(new FormData(form));
  try {
    await conCarga(form.querySelector('button[type="submit"]'), textoCargando,
      () => pedir(ruta, { metodo: 'POST', cuerpo }));
    location.href = destino();
  } catch (error) {
    toasts.error(error);
    form.clave.value = '';
    form.clave.focus();
  }
}

// Mostrar u ocultar la contraseña: el botón dice lo que va a hacer y aria-pressed dice cómo está
function verClave(boton, visible) {
  document.getElementById(boton.getAttribute('aria-controls')).type = visible ? 'text' : 'password';
  boton.textContent = visible ? 'Ocultar' : 'Mostrar';
  boton.setAttribute('aria-pressed', String(visible));
}
document.querySelectorAll('.clave__ver').forEach((boton) => {
  boton.addEventListener('click', () => {
    verClave(boton, boton.getAttribute('aria-pressed') !== 'true');
    document.getElementById(boton.getAttribute('aria-controls')).focus();
  });
});

// Aviso de Bloq Mayús: la causa más común de "contraseña incorrecta" cuando la persona sí la sabe
document.querySelectorAll('.clave input').forEach((campo) => {
  const aviso = campo.closest('.campo').querySelector('.clave__mayus');
  const revisar = (e) => { aviso.hidden = !e.getModifierState?.('CapsLock'); };
  campo.addEventListener('keydown', revisar);
  campo.addEventListener('keyup', revisar);
  campo.addEventListener('blur', () => { aviso.hidden = true; });
});

// Al enviar, la contraseña vuelve a ocultarse (que no quede a la vista si el login falla)
function ocultarClaves(form) {
  form.querySelectorAll('.clave__ver').forEach((boton) => verClave(boton, false));
}
formLogin.addEventListener('submit', () => ocultarClaves(formLogin));
formRegistro.addEventListener('submit', () => ocultarClaves(formRegistro));

formLogin.addEventListener('submit', (e) => enviar(e, '/api/auth/login', 'Entrando…'));
formRegistro.addEventListener('submit', (e) => enviar(e, '/api/auth/registro', 'Creando cuenta…'));

// El registro público solo existe para la primera cuenta (admin): mientras no haya ninguna, la tarjeta de la
// izquierda muestra el formulario; después, la explicación (las cuentas las crea un admin en "Usuarios").
pedir('/api/auth/estado').then(({ registroAbierto }) => {
  formRegistro.hidden = !registroAbierto;
  document.getElementById('bloque-info').hidden = registroAbierto;
  if (registroAbierto && conMouse) formRegistro.nombre.focus();
}, () => {});

// Si ya hay una sesión abierta, entrar directo
pedir('/api/auth/yo').then(() => { location.href = destino(); }, () => {
  if (formRegistro.hidden && conMouse) formLogin.usuario.focus();
});

// El cielo animado es decoración: se carga aparte y, si falla, el login funciona igual
import('./acceso/espacio.js')
  .then(({ iniciarEspacio }) => iniciarEspacio(document.getElementById('cielo')))
  .catch(() => {});
