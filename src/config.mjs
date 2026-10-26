// src/config.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Por defecto, el perfil de ejemplo del repo (así `npm test` corre desde un clon limpio).
// Para usar tu propio perfil: cargarConfig('ruta/a/tu-perfil.json').
const CONFIG_EJEMPLO = fileURLToPath(new URL('../config.ejemplo.json', import.meta.url));

export function cargarConfig(ruta = CONFIG_EJEMPLO) {
  const config = JSON.parse(readFileSync(ruta, 'utf8'));
  validarConfig(config);
  return config;
}

export function cargarEnv(ruta = '.env') {
  let contenido;
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch {
    return; // sin .env → se asume entorno ya configurado
  }
  for (const linea of contenido.split(/\r?\n/)) {
    // una línea que empiece con # nunca puede casar el regex (requiere [A-Z0-9_] al inicio),
    // así que las líneas comentario ya las descarta `!m` (la guarda extra era inalcanzable)
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let valor = m[2].trim(); // (.*) es greedy → espacios finales quedaban dentro del valor
      const q = valor.charAt(0);
      if ((q === '"' || q === "'") && valor.length >= 2 && valor.endsWith(q)) {
        valor = valor.slice(1, -1); // strip de comillas envolventes
      }
      process.env[m[1]] = valor;
    }
  }
}

function validarConfig(c) {
  const d = c.duros ?? {};
  if (typeof d.salario_piso_Q !== 'number' || d.salario_piso_Q <= 0) {
    throw new Error('duros.salario_piso_Q debe ser un número > 0');
  }
  if (typeof d.sin_ingles_requerido !== 'boolean' || typeof d.sin_universidad !== 'boolean') {
    throw new Error('duros.sin_ingles_requerido y duros.sin_universidad deben ser booleanos');
  }
  if (!Array.isArray(d.ubicacion) || d.ubicacion.length === 0) {
    throw new Error('duros.ubicacion debe ser un arreglo no vacío');
  }
  if (!Array.isArray(d.empresas_excluidas)) {
    throw new Error('duros.empresas_excluidas debe ser un arreglo');
  }
  if (typeof d.salario_nota !== 'string') {
    throw new Error('duros.salario_nota debe ser un string');
  }
  d.experiencia_max_apto ??= 1;
  d.experiencia_max_revisar ??= 2;
  d.presencial_requiere_flexible ??= true;
  d.descartar_palanca_ia_baja ??= true;
  d.experiencia_estricta_max_apto ??= 0;
  d.descartar_fin_de_semana ??= true;
  d.call_center_solo_remoto ??= true;
  d.vehiculo ??= { moto: 'descartar', carro_o_licencia: 'revisar' };
  if (!Number.isInteger(d.experiencia_max_apto) || d.experiencia_max_apto < 0) {
    throw new Error('duros.experiencia_max_apto debe ser un entero ≥ 0');
  }
  if (!Number.isInteger(d.experiencia_max_revisar) || d.experiencia_max_revisar < d.experiencia_max_apto) {
    throw new Error('duros.experiencia_max_revisar debe ser un entero ≥ experiencia_max_apto');
  }
  if (!Number.isInteger(d.experiencia_estricta_max_apto) || d.experiencia_estricta_max_apto < 0) {
    throw new Error('duros.experiencia_estricta_max_apto debe ser un entero ≥ 0');
  }
  if (typeof d.presencial_requiere_flexible !== 'boolean' || typeof d.descartar_palanca_ia_baja !== 'boolean'
    || typeof d.descartar_fin_de_semana !== 'boolean' || typeof d.call_center_solo_remoto !== 'boolean') {
    throw new Error('duros.presencial_requiere_flexible, duros.descartar_palanca_ia_baja, duros.descartar_fin_de_semana y duros.call_center_solo_remoto deben ser booleanos');
  }
  if (d.horario_personal != null && typeof d.horario_personal !== 'string') {
    throw new Error('duros.horario_personal debe ser un string (o no estar)');
  }
  const accionesVehiculo = ['descartar', 'revisar', 'ignorar'];
  if (typeof d.vehiculo !== 'object' || d.vehiculo === null
    || !accionesVehiculo.includes(d.vehiculo.moto) || !accionesVehiculo.includes(d.vehiculo.carro_o_licencia)) {
    throw new Error('duros.vehiculo.moto y duros.vehiculo.carro_o_licencia deben ser "descartar", "revisar" o "ignorar"');
  }
  // Probabilidades del ranking unificado: piso para entrar al ranking y p
  // asignado a "híbrido fuera del área metropolitana" (no se estima del texto).
  const rv = c.revisar ?? (c.revisar = {});
  rv.p_minima ??= 0.35;
  rv.p_hibrido_fuera_metro ??= 0.15;
  for (const k of ['p_minima', 'p_hibrido_fuera_metro']) {
    if (typeof rv[k] !== 'number' || rv[k] < 0 || rv[k] > 1) {
      throw new Error(`revisar.${k} debe ser un número entre 0 y 1`);
    }
  }
  const cand = c.candidato ?? {};
  for (const k of ['estudios', 'zona', 'area', 'resumen']) {
    if (typeof cand[k] !== 'string' || cand[k].trim() === '') {
      throw new Error(`candidato.${k} debe ser un string no vacío`);
    }
  }
  if (!Array.isArray(c.preferencias) || c.preferencias.length === 0) {
    throw new Error('preferencias debe ser un arreglo no vacío');
  }
  const b = c.busqueda ?? {};
  for (const k of ['base_url', 'paginas_max', 'detalles_max_por_corrida', 'pausa_ms']) {
    if (b[k] === undefined) throw new Error(`busqueda.${k} es obligatorio`);
  }
  if (typeof b.base_url !== 'string' || b.base_url.trim() === '') {
    throw new Error('busqueda.base_url debe ser un string no vacío');
  }
  for (const k of ['paginas_max', 'detalles_max_por_corrida', 'pausa_ms']) {
    if (typeof b[k] !== 'number' || b[k] <= 0) {
      throw new Error(`busqueda.${k} debe ser un número > 0`);
    }
  }
  // Llamadas Jev en vuelo a la vez: >12 arriesga saturar el endpoint/stdin del
  // servidor MCP sin ganancia real (los lotes server-side ya son de a ≤20).
  b.concurrencia_jev ??= 6;
  if (!Number.isInteger(b.concurrencia_jev) || b.concurrencia_jev < 1 || b.concurrencia_jev > 12) {
    throw new Error('busqueda.concurrencia_jev debe ser un entero entre 1 y 12');
  }
  // busqueda.sitios es opcional: si falta, la corrida es solo Computrabajo.
  const sitios = b.sitios;
  if (sitios !== undefined) {
    if (typeof sitios !== 'object' || sitios === null || Array.isArray(sitios)) {
      throw new Error('busqueda.sitios debe ser un objeto');
    }
    for (const [nombre, s] of Object.entries(sitios)) {
      if (typeof s !== 'object' || s === null || Array.isArray(s)) {
        throw new Error(`busqueda.sitios.${nombre} debe ser un objeto`);
      }
      s.activo ??= false; // sin `activo` declarado, el sitio no entra (conservador)
      if (typeof s.activo !== 'boolean') {
        throw new Error(`busqueda.sitios.${nombre}.activo debe ser booleano`);
      }
      if (!Array.isArray(s.fuentes) || s.fuentes.length === 0
        || !s.fuentes.every((f) => typeof f === 'string' && f.trim() !== '')) {
        throw new Error(`busqueda.sitios.${nombre}.fuentes debe ser un arreglo no vacío de strings`);
      }
      s.por_pagina ??= 100;
      if (!Number.isInteger(s.por_pagina) || s.por_pagina < 1 || s.por_pagina > 100) {
        throw new Error(`busqueda.sitios.${nombre}.por_pagina debe ser un entero entre 1 y 100`);
      }
      s.usd_a_q ??= 7.7;
      if (typeof s.usd_a_q !== 'number' || !(s.usd_a_q > 0)) {
        throw new Error(`busqueda.sitios.${nombre}.usd_a_q debe ser un número > 0`);
      }
      // Opcionales por sitio (cualquiera): cadencia propia de pausa y relectura,
      // y `telegram` para sacar al sitio de los avisos sin sacarlo del ranking.
      for (const k of ['pausa_ms', 'releer_ms']) {
        if (s[k] !== undefined && (typeof s[k] !== 'number' || !(s[k] > 0))) {
          throw new Error(`busqueda.sitios.${nombre}.${k} debe ser un número > 0`);
        }
      }
      if (s.telegram !== undefined && typeof s.telegram !== 'boolean') {
        throw new Error(`busqueda.sitios.${nombre}.telegram debe ser booleano`);
      }
      if (nombre === 'tecoloco') s.base_url ??= 'https://www.tecoloco.com.gt';
      if (s.base_url !== undefined && (typeof s.base_url !== 'string' || s.base_url.trim() === '')) {
        throw new Error(`busqueda.sitios.${nombre}.base_url debe ser un string no vacío`);
      }
      if (nombre === 'linkedin') {
        for (const f of s.fuentes) {
          if (!/^(guatemala|latam)(:.+)?$/.test(f)) {
            throw new Error(`busqueda.sitios.linkedin.fuentes: «${f}» debe ser guatemala o latam[:palabras]`);
          }
        }
        s.ventana_horas ??= 48;
        if (!Number.isInteger(s.ventana_horas) || s.ventana_horas < 1 || s.ventana_horas > 720) {
          throw new Error('busqueda.sitios.linkedin.ventana_horas debe ser un entero entre 1 y 720');
        }
      }
      if (nombre === 'workana') {
        for (const f of s.fuentes) {
          if (!/^(admin-support|sales-marketing|writing-translation|finance-management|it-programming|design-multimedia|legal|engineering-manufacturing)(\/[a-z0-9-]+)?$/.test(f)) {
            throw new Error(`busqueda.sitios.workana.fuentes: «${f}» debe ser <categoria>[/<subcategoria>] de Workana`);
          }
        }
        s.publicacion ??= '3d';
        if (!['1d', '3d', '1w'].includes(s.publicacion)) {
          throw new Error('busqueda.sitios.workana.publicacion debe ser "1d", "3d" o "1w"');
        }
        s.max_propuestas ??= 30;
        if (!Number.isInteger(s.max_propuestas) || s.max_propuestas < 1) {
          throw new Error('busqueda.sitios.workana.max_propuestas debe ser un entero ≥ 1');
        }
      }
    }
  }
}
