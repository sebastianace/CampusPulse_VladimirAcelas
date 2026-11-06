// Pantalla de inicio de sesión: entrar o crear una cuenta.
// Al terminar se vuelve a la página que pidió el login (?volver=/movil.html)
// o al tablero principal.

import { pedir } from './api.js';
import { conCarga } from './dom.js';
import * as toasts from './toasts.js';

const formLogin = document.getElementById('form-login');
const formRegistro = document.getElementById('form-registro');

// Solo se acepta volver a una ruta de este mismo sitio ("/algo", nunca "//otro-sitio")
function destino() {
  const volver = new URLSearchParams(location.search).get('volver') ?? '/';
  return volver.startsWith('/') && !volver.startsWith('//') ? volver : '/';
}

// Cambia entre "Iniciar sesión" y "Crear cuenta"
function mostrar(cual) {
  formLogin.hidden = cual !== 'login';
  formRegistro.hidden = cual !== 'registro';
  (cual === 'login' ? formLogin : formRegistro).querySelector('input').focus();
}

document.querySelectorAll('[data-ir]').forEach((boton) => {
  boton.addEventListener('click', () => mostrar(boton.dataset.ir));
});

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

formLogin.addEventListener('submit', (e) => enviar(e, '/api/auth/login', 'Entrando…'));
formRegistro.addEventListener('submit', (e) => enviar(e, '/api/auth/registro', 'Creando cuenta…'));

// El registro público solo existe para la primera cuenta (admin): después se oculta
// y las cuentas las crea un admin desde la pestaña "Usuarios".
pedir('/api/auth/estado').then(({ registroAbierto }) => {
  if (!registroAbierto) document.querySelectorAll('[data-ir="registro"]').forEach((b) => { b.parentElement.hidden = true; });
}, () => {});

// Si ya hay una sesión abierta, entrar directo
pedir('/api/auth/yo').then(() => { location.href = destino(); }, () => mostrar('login'));
