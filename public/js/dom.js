// Ayudante para crear elementos sin usar innerHTML (los datos de la API
// nunca se interpretan como HTML).
//   el('p', { className: 'nota' }, 'Texto', otroElemento)

export function el(etiqueta, propiedades = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);

  for (const [clave, valor] of Object.entries(propiedades)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave === 'style') Object.assign(nodo.style, valor);
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2).toLowerCase(), valor);
    else if (clave in nodo) nodo[clave] = valor;
    else nodo.setAttribute(clave, valor);
  }

  nodo.append(...hijos.flat().filter((h) => h !== null && h !== undefined && h !== false));
  return nodo;
}

/**
 * Ejecuta una acción asíncrona mostrando "cargando" en el botón:
 * lo deshabilita, cambia su texto y lo restaura al terminar.
 */
export async function conCarga(boton, textoCargando, accion) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.setAttribute('aria-busy', 'true');
  boton.textContent = textoCargando;
  try {
    return await accion();
  } finally {
    boton.disabled = false;
    boton.removeAttribute('aria-busy');
    boton.textContent = textoOriginal;
  }
}
