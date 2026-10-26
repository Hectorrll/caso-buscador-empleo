import { asegurarTexto } from './seguridad.mjs';
import { parseSalario, salarioMensual } from './salario.mjs';
import { pool } from '../pool.mjs';

// Catálogos con descripciones FUERTES (definición, qué entra, qué no, precedencia y ejemplo):
const CATALOGOS = {
  ingles: {
    proposito: 'Determinar si la oferta exige inglés para un candidato que NO quiere puestos con inglés obligatorio.',
    clases: [
      { id: 'requerido', description: 'El inglés es requisito obligatorio o eliminatorio (ej: "inglés intermedio requerido", "indispensable manejo de inglés", "inglés básico" listado en el perfil requerido). Si se pide cualquier nivel como requisito, es requerido.' },
      { id: 'deseable', description: 'El inglés suma pero no elimina (ej: "inglés deseable", "constituye ventaja"). Precedencia: si además aparece como requisito, gana requerido.' },
      { id: 'no_pide', description: 'No se menciona inglés, o lo que se menciona no es un idioma.' },
      { id: 'ambiguo', description: 'Se menciona inglés de forma que no permite decidir si es requisito o deseable.' },
    ],
  },
  estudios: {
    proposito: 'Determinar el nivel de estudios MÍNIMO EXIGIDO como requisito eliminatorio para un candidato con bachillerato diversificado.',
    clases: [
      { id: 'sin_estudios', description: 'No exige estudios o pide solo primaria/secundaria (ej: "sin estudios", "estudios no son requisito").' },
      { id: 'bachillerato_o_tecnico', description: 'Exige bachillerato, diversificado, perito contador o técnico (cualquier carrera de diversificado). Ej: "Educación mínima: Educación Técnico/Profesional".' },
      { id: 'universitario_o_mas', description: 'Exige título universitario o posgrado como requisito (ej: "egresado o graduado de ingeniería", "título universitario en curso es indispensable"). NO cuenta si solo es "deseable".' },
      { id: 'ambiguo', description: 'No permite determinar el mínimo exigido.' },
    ],
  },
  finDeSemana: {
    proposito: 'Determinar si el puesto descansa el fin de semana (sábado y domingo).',
    clases: [
      { id: 'si', description: 'Descansa sábado Y domingo completos (ej: "lunes a viernes" sin mencionar sábado).' },
      { id: 'no', description: 'Trabaja sábado y/o domingo aunque sea medio día (ej: "lunes a viernes y sábado medio día", "sábados de 8 a 12", "lunes a sábado"). Precedencia: cualquier mención de trabajar sábado o domingo gana sobre "lunes a viernes".' },
      { id: 'rotativo', description: 'Descanso variable por turnos que incluye algunos fines de semana.' },
      { id: 'no_dice', description: 'El texto no dice nada sobre descanso.' },
    ],
  },
  horarioFlexible: {
    proposito: 'Determinar si el puesto ofrece horario flexible o por objetivos.',
    clases: [
      { id: 'si', description: 'Horario flexible, por objetivos, o elige tu horario (ej: "horario flexible", "manejo de tu tiempo").' },
      { id: 'no', description: 'Horario fijo declarado (ej: "8:00 a 17:00 fijo", "turnos rotativos fijos"). Precedencia: si lo que se pide es que EL CANDIDATO tenga flexibilidad o disponibilidad de horario para la empresa (ej: "flexibilidad horaria para cumplir con las necesidades del taller", "disponibilidad de horario", "disponibilidad para turnos"), eso NO es horario flexible: es no.' },
      { id: 'no_dice', description: 'El texto no dice nada sobre flexibilidad.' },
    ],
  },
  modalidad: {
    proposito: 'Determinar la modalidad de trabajo declarada.',
    clases: [
      { id: 'remoto', description: 'Trabajo 100% remoto o desde casa (ej: "home office", "remoto").' },
      { id: 'hibrido', description: 'Mezcla de presencial y remoto (ej: "híbrido", "3 días en oficina, 2 en casa"). Precedencia: si menciona home office, teletrabajo o días remotos, es hibrido aunque también nombre la sede.' },
      { id: 'presencial', description: 'Trabajo en oficina/sede/local declarado explícitamente SIN mencionar home office, teletrabajo ni días remotos (ej: "disponibilidad de trabajar en sede zona 4").' },
      { id: 'no_dice', description: 'El texto no declara modalidad.' },
    ],
  },
  area: {
    proposito: 'Clasificar el área del puesto para preferir administrativa o de computación.',
    clases: [
      { id: 'administrativa', description: 'Oficina: asistente, auxiliar, atención al cliente, facturación, recursos humanos, gestión de cobros/cartera desde oficina (correo, Excel, sistema).' },
      { id: 'computacion', description: 'Sistemas: soporte técnico, programación, redes, data entry, diseño digital, redes sociales/contenido digital, e-commerce.' },
      { id: 'call_center', description: 'Call center, contact center, telemarketing, televentas, cobro telefónico, agente que atiende o hace llamadas. Precedencia: si el trabajo principal es atender o hacer llamadas, es call_center aunque mencione Excel, reportes, WhatsApp o sistema.' },
      { id: 'ventas', description: 'Ventas en calle, cobro en campo o a domicilio, vendedor por comisiones.' },
      { id: 'servicio_cliente', description: 'Mesero, tienda, recepción, atención cara a cara (no llamadas).' },
      { id: 'otro', description: 'Cualquier otra área (operativo, industrial, logística, etc.).' },
    ],
  },
  perfilContable: {
    proposito: 'Determinar si el puesto exige formación o funciones contables centrales para un candidato que NO es contador.',
    clases: [
      { id: 'contable', description: 'Exige perito contador, contaduría o CPA SIN alternativa de otro bachillerato, o funciones contables centrales: partidas, conciliaciones, cierres, estados financieros, IVA/ISR, auditoría, tesorería, nómina contable.' },
      { id: 'administrativo_con_numeros', description: 'Facturación, cobros, caja chica, ingreso de facturas, cotizaciones o inventario en sistema, sin exigir formación contable. Precedencia: si exige formación o funciones contables centrales, gana contable.' },
      { id: 'no_contable', description: 'No exige formación contable ni funciones contables centrales.' },
    ],
  },
  palancaIA: {
    proposito: 'Determinar cuánto multiplica la IA (agentes de código, automatización) la productividad del puesto.',
    clases: [
      { id: 'alta', description: 'Trabajo 100% en computadora: datos, reportes, Excel/Sheets, documentación, correo/agenda, CRM, e-commerce, redes sociales, contenido, soporte IT, automatización, reclutamiento digital, soporte por chat o tickets escritos (no llamadas).' },
      { id: 'media', description: 'Administrativo mixto: parte digital, parte papeleo, recepción o atención presencial, llamadas telefónicas en vivo (call center de voz).' },
      { id: 'baja', description: 'Físico, calle, bodega, caja, manejo de efectivo, atención cara a cara, conducción, operativo.' },
    ],
  },
  nivel: {
    proposito: 'Determinar el nivel del puesto según el cargo y la experiencia exigida.',
    clases: [
      { id: 'entrada', description: 'Auxiliar, asistente, junior, trainee, practicante; sin experiencia o hasta 1 año.' },
      { id: 'intermedio', description: 'Analista, ejecutivo, especialista con 2+ años.' },
      { id: 'jefatura_o_senior', description: 'Jefe, gerente, supervisor, coordinador con personal a cargo, líder de equipo, senior, encargado de área.' },
    ],
  },
  experienciaExigencia: {
    proposito: 'Determinar si los años de experiencia que pide la oferta son un requisito estricto o flexible, para un candidato con MENOS de 1 año de experiencia.',
    clases: [
      { id: 'estricta', description: 'La experiencia es indispensable, excluyente o comprobable (ej: "mínimo 2 años indispensable", "experiencia comprobable de 2 años", "requisito: 2 años").' },
      { id: 'flexible', description: 'La experiencia es deseable, preferible o no indispensable, o se ofrece capacitación (ej: "deseable 2 años", "de preferencia con experiencia", "no necesitas experiencia, te capacitamos"). Precedencia: si además dice indispensable, gana estricta.' },
      { id: 'no_dice', description: 'Pide años de experiencia sin indicar si son indispensables o deseables.' },
    ],
  },
  formacionEspecifica: {
    proposito: 'Determinar si la oferta exige una carrera técnica o software especializado de otra disciplina, para un candidato Bachiller en Computación.',
    clases: [
      { id: 'general_o_computacion', description: 'Cualquier bachillerato/diversificado, computación, o sin carrera específica; paquetes de oficina, CRM, redes sociales.' },
      { id: 'otra_especialidad', description: 'Exige una carrera técnica distinta (dibujo de construcción, mecánica, electricidad, enfermería, magisterio, perito contador, conocimientos de un rubro específico como taller automotriz) o software de otra disciplina (AutoCAD, Revit, SolidWorks, SAP FI). Ej: "Bachiller en Dibujo en Construcción, manejo de AutoCAD".' },
      { id: 'ambiguo', description: 'Se menciona una carrera o software pero no se puede decidir si es de otra disciplina.' },
    ],
  },
  vehiculo: {
    proposito: 'Determinar si la oferta exige licencia de conducir o vehículo propio, para un candidato sin licencia que tiene acceso a carro pero nunca a moto.',
    clases: [
      { id: 'no_pide', description: 'No pide licencia de conducir ni vehículo propio.' },
      { id: 'carro_o_licencia', description: 'Pide licencia de conducir de carro/automóvil o vehículo de 4 ruedas, o acepta moto O carro (ej: "moto/carro", "licencia tipo B").' },
      { id: 'solo_moto', description: 'Exige moto propia o licencia de moto sin alternativa de carro (ej: "indispensable contar con moto", "mensajero motorizado", "licencia tipo M").' },
    ],
  },
};

export const CAMPOS_EXTRACT = [
  // Salario: decimal OPCIONAL y Q/quetzales antes O después ("Q4,500 al mes" matchea).
  // El grupo 1 envuelve el match completo → el valor verbatim es el match entero ("Q4,500").
  { id: 'salario', pattern: '((?:quetzales?|Q)\\s*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,5})(?:\\.[0-9]{1,2})?|(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,5})(?:\\.[0-9]{1,2})?\\s*(?:quetzales?|Q))', flags: 'i', description: 'Monto de salario numérico con Q/quetzales antes O después (decimal opcional; ej: "Q4,500 al mes")' },
  { id: 'periodo_salario', pattern: '(mensual(?:es)?|al mes|quincenal(?:es)?|semanal(?:es)?|diari(?:o|os|a|as)|anual(?:es)?|por hora)', flags: 'i', description: 'Periodicidad del pago (mensual, quincenal, semanal, diario, anual, por hora)' },
  { id: 'estudios_minimos', pattern: '(posgrado|maestr[ií]a|universitari[oa]|t[ií]tulo profesional|educaci[oó]n t[eé]cnico|t[eé]cnico|diversificado|bachillerato|perito contador|secundaria|sin estudios)', flags: 'i', description: 'Nivel de estudios mínimo EXIGIDO como requisito (no lo deseable). Si hay varios, el de menor nivel' },
];

const MUNICIPIOS_NO_CIUDAD = ['mixco', 'fraijanes', 'villa nueva', 'villa canales', 'san miguel petapa', 'amatitl[aá]n', 'chinautla', 'santa catarina pinula'];

export function esUbicacionCiudad(ubicacion) {
  const u = String(ubicacion ?? '').trim();
  if (!u) return false;
  if (/guatemala ciudad|ciudad de guatemala/i.test(u)) return true;
  if (MUNICIPIOS_NO_CIUDAD.some((m) => new RegExp(`\\b${m}\\b`, 'i').test(u))) return false;
  // "Zona 10, Guatemala" (zona urbana) — no "Cobán, Alta Verapaz" ni "Mixco, Guatemala".
  if (/^zona\s+\d{1,2}\s*,\s*guatemala$/i.test(u)) return true;
  // El sitio publica la capital como ciudad,departamento: "Guatemala, Guatemala".
  if (/^guatemala\s*,\s*guatemala$/i.test(u)) return true;
  return false;
}

// Municipios del departamento de Guatemala (área metropolitana): cuentan solo con el
// sufijo ", Guatemala" — "Mixco, Guatemala" sí; "Palencia" a secas o "San José,
// Escuintla" no.
const MUNICIPIOS_METRO = [
  'mixco', 'villa nueva', 'villa canales', 'san miguel petapa', 'chinautla',
  'santa catarina pinula', 'san jos[eé] pinula', 'fraijanes', 'amatitl[aá]n',
  'san juan sacatep[eé]quez', 'san pedro ayampuc', 'palencia',
];

export function esAreaMetropolitana(ubicacion) {
  const u = String(ubicacion ?? '').trim();
  if (esUbicacionCiudad(u)) return true;
  if (!/,\s*guatemala$/i.test(u)) return false;
  return MUNICIPIOS_METRO.some((m) => new RegExp(`\\b${m}\\b`, 'i').test(u));
}

// Las etiquetas del sitio que declaran modalidad. Son la fuente de verdad del flag
// (modalidadEfectiva) pero NUNCA pueden entrar como evidencia al verificarlo: si la
// etiqueta se cita a sí misma, "El puesto es híbrido" se auto-confirma (verify.mjs
// las filtra de la ficha — los call centers falsos "Presencial y remoto" pasaban así).
export const TAGS_MODALIDAD = { remoto: 'Remoto', hibrido: 'Presencial y remoto' };

// La etiqueta estructurada del sitio (otrosTags) es la fuente de verdad de la modalidad,
// SALVO cuando el texto la contradice explícitamente (call centers falsos "Presencial y
// remoto"): ahí gana el texto y queda marcado como 'contradiccion' para el reporte.
export function modalidadEfectiva(otrosTags, modalidadTexto) {
  const tags = Array.isArray(otrosTags) ? otrosTags : [];
  if (tags.includes(TAGS_MODALIDAD.remoto)) {
    if (modalidadTexto === 'presencial' || modalidadTexto === 'hibrido') {
      return { modalidad: modalidadTexto, fuente: 'contradiccion', etiqueta: 'remoto' };
    }
    return { modalidad: 'remoto', fuente: 'etiqueta' };
  }
  if (tags.includes(TAGS_MODALIDAD.hibrido)) {
    if (modalidadTexto === 'presencial') {
      return { modalidad: 'presencial', fuente: 'contradiccion', etiqueta: 'hibrido' };
    }
    return { modalidad: 'hibrido', fuente: 'etiqueta' };
  }
  if (modalidadTexto === 'remoto' || modalidadTexto === 'hibrido') return { modalidad: modalidadTexto, fuente: 'texto' };
  return { modalidad: 'presencial', fuente: 'defecto' };
}

const NUMEROS = { un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

// Dos patrones en la descripción: (a) "N años de experiencia" y
// (b) "experiencia ... N años" (ej: "Experiencia: cobranza: 1 año (Obligatorio)").
// N tope 15 y con \b: "entre 20 y 28 años" (edad) no es experiencia.
const EXP_A = /\b([1-9]|1[0-5]|un|uno|dos|tres|cuatro|cinco)\s+años?\s+de\s+experiencia/gi;
const EXP_B = /experiencia[^.|\n]{0,30}?\b([1-9]|1[0-5]|un|uno|dos|tres|cuatro|cinco)\s+años?/gi;
const aNumero = (t) => NUMEROS[t.toLowerCase()] ?? Number(t);

// El sitio publica " años de experiencia" sin número en la ficha: el número suele estar en
// la descripción. Devuelve el MÁXIMO entre ficha y descripción (la ficha a veces queda
// por debajo del requisito real del texto). Lo leído de la descripción nunca descarta.
export function parseExperiencia(requerimientos, descripcion) {
  const ficha = (Array.isArray(requerimientos) ? requerimientos : []).find((r) => /experiencia/i.test(r)) ?? '';
  const f = ficha.match(/(\d+)\s+años?\s+de\s+experiencia/i);
  const aniosFicha = /menos de 1 año/i.test(ficha) ? 0 : (f ? Number(f[1]) : null);
  let aniosDesc = null;
  for (const m of String(descripcion ?? '').matchAll(EXP_A)) {
    const n = aNumero(m[1]);
    if (aniosDesc == null || n > aniosDesc) aniosDesc = n;
  }
  for (const m of String(descripcion ?? '').matchAll(EXP_B)) {
    const n = aNumero(m[1]);
    if (aniosDesc == null || n > aniosDesc) aniosDesc = n;
  }
  if (aniosFicha == null && aniosDesc == null) return { anios: null, fuente: null };
  if (aniosFicha != null && aniosFicha >= (aniosDesc ?? -1)) return { anios: aniosFicha, fuente: 'ficha' };
  return { anios: aniosDesc, fuente: 'descripcion' };
}

// La ficha puede traer "Licencias de conducir: ..." estructurado: dato más confiable
// que el clasificador sobre el texto. Una licencia sin especificar cuenta como carro
// (en GT la licencia común es la de automóvil).
export function vehiculoDeFicha(requerimientos) {
  const req = (Array.isArray(requerimientos) ? requerimientos : []).find((r) => /licencias? de conducir/i.test(r));
  if (!req) return null;
  if (/carros?|autom[oó]viles?|\bautos?\b/i.test(req)) return 'carro_o_licencia';
  if (/motos?\b/i.test(req)) return 'solo_moto';
  return 'carro_o_licencia';
}

export function mapearEstudios(valor) {
  if (!valor) return 'ambiguo';
  const v = String(valor).toLowerCase();
  if (/universitari|posgrado|maestr|t[ií]tulo profesional/.test(v)) return 'universitario_o_mas';
  if (/bachillerato|diversificado|t[eé]cnico|perito/.test(v)) return 'bachillerato_o_tecnico';
  if (/sin estudios|ning[uú]n estudio|secundaria/.test(v)) return 'sin_estudios';
  return 'ambiguo';
}

// Límite server-side de jev_classify: 2,000 chars por item. El clasificador SIEMPRE ve los
// requerimientos completos (donde suele estar "inglés requerido") + la cola de la descripción:
// recortar los primeros 1,800 chars producía falsos APTO cuando el requisito estaba al final.
const TOPE_CLASIFICAR = 1950;
const COLA_DESCRIPCION = 1200;

function excerptParaClasificar(o) {
  const reqs = (Array.isArray(o.requerimientos) ? o.requerimientos : []).map(String).join(' | ');
  const fuente = String(o.descripcion ?? o.texto ?? '');
  if (!reqs) return fuente.slice(-TOPE_CLASIFICAR); // sin reqs: cola del texto (los requisitos van al final)
  const reqsFinal = reqs.slice(0, TOPE_CLASIFICAR); // prioridad: que requerimientos entre completo
  const presupuesto = Math.max(0, TOPE_CLASIFICAR - reqsFinal.length - 3);
  const cola = fuente.slice(-Math.min(COLA_DESCRIPCION, presupuesto));
  return cola ? `${reqsFinal} | ${cola}` : reqsFinal;
}

// Límite del endpoint: máx. 20 preguntas (items) por llamada a jev_classify — más
// devuelve HTTP 400 ("at most 20 questions per call") y el cliente lo entrega como
// texto, no como error. Provider-agnóstico: el mismo tope cubre a TypeSafe.
const LOTE_CLASIFICAR = 20;

export async function clasificarCriterios(jev, tanda, concurrencia = 1) {
  // Juez local (crearJevLocal): reglas sobre el texto completo, sin lotes ni red.
  if (jev.local) return new Map(tanda.map((o) => [o.id, jev.clasificar(o)]));
  const salida = new Map(tanda.map((o) => [o.id, {}]));
  const conClasificacion = new Set(); // ids con ≥1 classification real (anti-degradación)
  // Trabajos planos (criterio × lote de ≤20): son independientes entre sí → pool
  // con `concurrencia` en vuelo. Los Maps se escriben por tramos síncronos
  // (single thread) → el chequeo salida.has(item.id) sigue siendo seguro.
  const trabajos = [];
  for (const [criterio, cat] of Object.entries(CATALOGOS)) {
    for (let i = 0; i < tanda.length; i += LOTE_CLASIFICAR) {
      trabajos.push({ criterio, cat, lote: tanda.slice(i, i + LOTE_CLASIFICAR) });
    }
  }
  await pool(trabajos, concurrencia, async ({ criterio, cat, lote }) => {
    const r = await jev.call('jev_classify', {
      items: lote.map((o) => ({ id: o.id, text: excerptParaClasificar(o) })),
      classes: cat.clases,
      purpose: cat.proposito,
    });
    for (const item of r.results ?? []) {
      if (!salida.has(item.id)) continue;
      const flags = salida.get(item.id);
      flags[criterio] = item.classification;
      if (item.classification != null) conClasificacion.add(item.id);
      // Las probabilidades por clase alimentan probabilidadApto (dudas del ranking);
      // solo se guardan si Jev las devolvió — los defaults no las inventan.
      if (item.probabilities) (flags.probabilidades ??= {})[criterio] = item.probabilities;
    }
  });
  // completa lo que Jev no haya respondido con no_dice/ambiguo (prohibido adivinar)
  const porDefecto = { ingles: 'ambiguo', estudios: 'ambiguo', finDeSemana: 'no_dice', horarioFlexible: 'no_dice', modalidad: 'no_dice', area: 'otro', perfilContable: 'no_contable', palancaIA: 'media', nivel: 'intermedio', experienciaExigencia: 'no_dice', formacionEspecifica: 'general_o_computacion', vehiculo: 'no_pide' };
  for (const [, flags] of salida) for (const [k, v] of Object.entries(porDefecto)) flags[k] ??= v;
  // Anti-degradación silenciosa: un item ausente de TODOS los results (o con
  // classification null en todos) quedó con puros defaults — basura que parece
  // dato. Se marca para que el caller lo salte y lo reintente en la próxima corrida.
  for (const [id, flags] of salida) if (!conClasificacion.has(id)) flags._sinClasificar = true;
  return salida;
}

// Global-constraints: NUNCA truncar la descripción hacia el juez. Si el doc supera el límite de
// jev_extract (50,000), se parte en trozos de 45,000 y se combinan los resultados por id.
const LIMITE_EXTRACT = 50000;
const TROZO_EXTRACT = 45000;

export async function extraerCampos(jev, detalle) {
  const doc = `${detalle.descripcion ?? ''}\nRequerimientos: ${(detalle.requerimientos ?? []).join(' | ')}`;
  const trozos = [];
  if (doc.length > LIMITE_EXTRACT) {
    for (let i = 0; i < doc.length; i += TROZO_EXTRACT) trozos.push(doc.slice(i, i + TROZO_EXTRACT));
  } else {
    trozos.push(doc);
  }
  const porId = {};
  for (const trozo of trozos) {
    const r = await jev.call('jev_extract', {
      document: trozo,
      fields: CAMPOS_EXTRACT,
      purpose: 'Extraer salario y estudios mínimos EXIGIDOS de una oferta de empleo guatemalteca',
    });
    // combinación: primer valor con status ∉ {not_found, invalid} por id
    // (los chunks siguientes completan ids que el primero dejó en not_found)
    for (const x of r.results ?? []) {
      if (porId[x.id] != null) continue;
      if (x.status === 'not_found' || x.status === 'invalid' || x.value == null) continue;
      porId[x.id] = x.value;
    }
  }
  return {
    salarioTexto: porId.salario ?? null,
    periodoSalario: porId.periodo_salario ?? null,
    estudiosTexto: porId.estudios_minimos ?? null,
  };
}

const TITULO_CONTABLE = /\b(contador|contable|contabilidad|auditor|auditor[ií]a|tesorer[oaí]a?|impuestos)\b/i;
const TITULO_CALL_CENTER = /\b(call ?cent(?:er|re)|contact ?cent(?:er|re)|telemarketing|televentas|telefonista|cobros? telef[oó]nic[oa]s?)\b/i;

export function decidirVeredicto({ flags, salarioMensualQ, salarioTexto, ubicacionCard, empresa, config, experiencia = { anios: null, fuente: null }, titulo = '' }) {
  const motivos = [];
  const razon = [];
  const piso = config.duros.salario_piso_Q;
  const maxApto = config.duros.experiencia_max_apto;
  const maxRevisar = config.duros.experiencia_max_revisar;
  const anios = experiencia?.anios ?? null;
  const accionVehiculo = config.duros.vehiculo ?? {};

  // La etiqueta del sitio puede contradecir el texto: ya ganó el texto en
  // modalidadEfectiva, pero la discrepancia se anota al inicio de las razones
  // (sale igual en DESCARTADO que en REVISAR/APTO).
  if (flags.modalidadFuente === 'contradiccion') {
    razon.push(`La etiqueta del sitio dice ${flags.modalidadEtiqueta} pero el texto dice ${flags.modalidadTexto ?? flags.modalidad}`);
  }

  // El sitio publica la capital como "Guatemala Ciudad", "Guatemala, Guatemala" o "Zona N, Guatemala".
  // Municipios del depto (Mixco, Fraijanes) y otros deptos (Cobán, Alta Verapaz) NO son la ciudad.
  const enGuatemalaCiudad = esUbicacionCiudad(ubicacionCard);
  const excluida = (config.duros.empresas_excluidas ?? [])
    .some((e) => (empresa ?? '').toLowerCase().includes(e.toLowerCase()));

  if (excluida) {
    motivos.push('empresa_excluida');
    razon.push(`Empresa "${empresa}" está en tu lista negra`);
  }
  if (flags.ingles === 'requerido') {
    motivos.push('ingles_requerido');
    razon.push('La oferta exige inglés (tú lo excluiste)');
  }
  if (flags.estudios === 'universitario_o_mas') {
    motivos.push('universidad');
    razon.push('Exige estudios universitarios');
  }
  if (flags.perfilContable === 'contable' || TITULO_CONTABLE.test(titulo)) {
    motivos.push('contable');
    razon.push('Puesto contable (no eres contador)');
  }
  if (flags.nivel === 'jefatura_o_senior') {
    motivos.push('jefatura');
    razon.push('Puesto de jefatura/senior');
  }
  if (config.duros.descartar_palanca_ia_baja && flags.palancaIA === 'baja') {
    motivos.push('palanca_ia_baja');
    razon.push('Trabajo físico o de campo (palanca IA baja): buscas trabajo en computadora');
  }
  if (config.duros.descartar_fin_de_semana && (flags.finDeSemana === 'no' || flags.finDeSemana === 'rotativo')) {
    motivos.push('fin_de_semana');
    razon.push('Trabaja fines de semana (el candidato no trabaja sábados ni domingos)');
  }
  if (config.duros.call_center_solo_remoto && flags.area === 'call_center' && flags.modalidad !== 'remoto') {
    motivos.push('call_center_no_remoto');
    razon.push('Call center no remoto (solo se aceptan call centers 100% remotos)');
  }
  if (accionVehiculo.moto === 'descartar' && flags.vehiculo === 'solo_moto') {
    motivos.push('moto');
    razon.push('Exige moto (el candidato no usa moto)');
  }
  if (accionVehiculo.carro_o_licencia === 'descartar' && flags.vehiculo === 'carro_o_licencia') {
    motivos.push('vehiculo_carro');
    razon.push('Pide licencia/carro: tendrías que sacar licencia (hay carro disponible)');
  }
  // Solo la ficha descarta: el número leído de la descripción puede ser "deseable".
  if (experiencia?.fuente === 'ficha' && anios != null && anios > maxRevisar) {
    motivos.push('experiencia');
    razon.push(`Pide ${anios} años de experiencia (máx. ${maxRevisar})`);
  }
  if (flags.modalidad === 'presencial' && !enGuatemalaCiudad) {
    motivos.push('ubicacion');
    razon.push(`Presencial fuera de la ciudad (ubicación: "${ubicacionCard}")`);
  }
  if (config.duros.presencial_requiere_flexible
    && flags.modalidad === 'presencial' && enGuatemalaCiudad && flags.horarioFlexible !== 'si') {
    motivos.push('presencial_fijo');
    razon.push('Presencial sin horario flexible declarado');
  }
  if (salarioMensualQ != null && salarioMensualQ < piso) {
    motivos.push('salario');
    razon.push(`Salario mensual Q${salarioMensualQ} < piso Q${piso} (texto: "${salarioTexto}")`);
  }
  if (motivos.length > 0) {
    return { veredicto: 'DESCARTADO', motivos, razon };
  }
  // lo NO declarado jamás se descarta: va a "Por revisar"
  if (flags.modalidadFuente === 'texto') {
    motivos.push('modalidad_solo_texto');
    razon.push(`Modalidad "${flags.modalidad}" solo aparece en el texto, sin etiqueta del sitio`);
  }
  if (flags.modalidad === 'hibrido' && !esAreaMetropolitana(ubicacionCard)) {
    motivos.push('hibrido_fuera_ciudad');
    razon.push(`Híbrido fuera del área metropolitana (ubicación: "${ubicacionCard}")`);
  }
  if (anios != null && anios > maxApto && (experiencia.fuente === 'descripcion' || anios <= maxRevisar)) {
    motivos.push('experiencia_2');
    razon.push(`Pide ${anios} años de experiencia (máx. apto ${maxApto})`);
  }
  // Experiencia declarada obligatoria por el clasificador: pesa aunque el número
  // esté dentro de lo apto (el candidato tiene menos de 1 año).
  if (flags.experienciaExigencia === 'estricta' && anios != null
    && anios > config.duros.experiencia_estricta_max_apto && !motivos.includes('experiencia_2')) {
    motivos.push('experiencia_estricta');
    razon.push(`Pide ${anios} año(s) de experiencia obligatoria (tienes menos de 1)`);
  }
  if (flags.formacionEspecifica === 'otra_especialidad') {
    motivos.push('formacion_especifica');
    razon.push('Exige formación o software de otra especialidad');
  }
  if (accionVehiculo.moto === 'revisar' && flags.vehiculo === 'solo_moto') {
    motivos.push('moto');
    razon.push('Exige moto (el candidato no usa moto)');
  }
  if (accionVehiculo.carro_o_licencia === 'revisar' && flags.vehiculo === 'carro_o_licencia') {
    motivos.push('vehiculo_carro');
    razon.push('Pide licencia/carro: tendrías que sacar licencia (hay carro disponible)');
  }
  // "Horario flexible" no garantiza los huecos fijos del candidato (duros.horario_personal):
  // el presencial flexible nunca es APTO directo, se confirma al postular.
  if (config.duros.horario_personal && flags.modalidad === 'presencial') {
    motivos.push('horario_personal');
    razon.push(`Horario flexible: confirma que encaja con tu semana (${config.duros.horario_personal})`);
  }
  if (flags.ingles === 'ambiguo') {
    motivos.push('ingles_ambiguo');
    razon.push('Se menciona inglés pero no se puede decidir si es requisito');
  }
  if (flags.estudios === 'ambiguo') {
    motivos.push('estudios_ambiguos');
    razon.push('No se declara el nivel de estudios exigido');
  }
  if (salarioMensualQ == null) {
    motivos.push('salario_no_publicado');
    razon.push(`Salario no publicado (texto: "${salarioTexto ?? 'sin datos'}") → lista "Por revisar"`);
  }
  if (motivos.length > 0) {
    return { veredicto: 'REVISAR', motivos, razon };
  }
  razon.push(`Cumple los duros: salario Q${salarioMensualQ} ≥ Q${piso}, sin inglés/universidad obligatorios, ${flags.modalidad}, experiencia ${anios ?? 'no declarada'}`);
  return { veredicto: 'APTO', motivos, razon };
}

// Combina la ficha con el clasificador (100% local): la etiqueta del sitio manda
// la modalidad salvo contradicción del texto; la ficha manda en moto (carro/
// licencia lo exige cualquiera de las dos fuentes); el título desempata el área
// ("Ejecutivo Call Center" es call_center aunque el clasificador haya leído
// administrativa). Lo comparten juzgarOferta y el descarte preliminar (run.mjs).
function flagsEfectivos({ card, detalle, flags }) {
  const m = modalidadEfectiva(detalle.otrosTags, flags.modalidad);
  const vehiculoFicha = vehiculoDeFicha(detalle.requerimientos);
  const vehiculo = vehiculoFicha === 'solo_moto' || flags.vehiculo === 'solo_moto' ? 'solo_moto'
    : vehiculoFicha === 'carro_o_licencia' || flags.vehiculo === 'carro_o_licencia' ? 'carro_o_licencia'
    : 'no_pide';
  const flagsEf = {
    ...flags, modalidad: m.modalidad, modalidadTexto: flags.modalidad,
    modalidadFuente: m.fuente, modalidadEtiqueta: m.etiqueta, vehiculo,
  };
  if (TITULO_CALL_CENTER.test(detalle.titulo || card.titulo || '')) flagsEf.area = 'call_center';
  return flagsEf;
}

// Veredicto preliminar 100% local (sin Jev): las reglas duras solo leen flags +
// ficha (salarioTag, tags de modalidad, licencias, experiencia, ubicación,
// empresa). Si ya da DESCARTADO, nada que traiga el escudo/extract puede mejorar
// el veredicto y los motivos quedan completos — la oferta no gasta llamadas.
// Cuando NO descarta, el camino completo (juzgarOferta) decide igual que antes:
// el salario aún puede caer de la descripción vía extract, o bloquear el escudo.
export function juzgarPreliminar({ card, detalle, flags, config }) {
  const flagsEf = flagsEfectivos({ card, detalle, flags });
  const experiencia = parseExperiencia(detalle.requerimientos, detalle.descripcion);
  const salarioMensualQ = salarioMensual(parseSalario(detalle.salarioTag));
  const resultado = decidirVeredicto({
    flags: flagsEf,
    salarioMensualQ,
    // salarioTexto solo adorna la razón de 'salario': el tag alcanza (sin tag,
    // salarioMensualQ es null → no descarta por salario → camino completo).
    salarioTexto: detalle.salarioTag ?? null,
    // Misma preferencia detalle > card que juzgarOferta (FIX RATING-UBICACION).
    ubicacionCard: (detalle.ubicacion && detalle.ubicacion.trim()) ? detalle.ubicacion : card.ubicacion,
    empresa: card.empresa,
    config,
    experiencia,
    titulo: detalle.titulo || card.titulo,
  });
  return { ...resultado, literal: {}, salarioMensualQ, flags: flagsEf, experiencia };
}

export async function juzgarOferta(jev, { card, detalle, flags, config }) {
  // ⓪+① escudo y extract son independientes (ambos leen el detalle, ninguno usa
  // el resultado del otro) → corren en paralelo. Si el escudo bloquea, el extract
  // ya corrió igual: gasto extra mínimo y raro frente a la latencia que ahorra.
  const [escudo, literal] = await Promise.all([
    asegurarTexto(jev, detalle.descripcion ?? '', 'descripción de oferta de empleo scrapeada antes de juzgarla'),
    extraerCampos(jev, detalle),
  ]);
  if (escudo.accion === 'bloquear') {
    return {
      veredicto: 'DESCARTADO', motivos: ['inyeccion'],
      razon: [`Contenido sospechoso (inyección=${escudo.injection.toFixed(2)}) — no se juzgó`],
      literal: {}, salarioMensualQ: null, flags,
    };
  }

  // ① valores literales que citan el texto
  const reqEducacion = (detalle.requerimientos ?? []).find((r) => /educaci[oó]n m[ií]nima/i.test(r));
  const estudiosLiteral = reqEducacion ?? literal.estudiosTexto ?? null;

  const desdeTag = parseSalario(detalle.salarioTag);
  const desdeDescripcion = literal.salarioTexto
    ? parseSalario(`${literal.salarioTexto} ${literal.periodoSalario ?? ''}`)
    : null;
  const p = desdeTag ?? desdeDescripcion;
  const salarioMensualQ = salarioMensual(p);

  const flagsEf = flagsEfectivos({ card, detalle, flags });
  const experiencia = parseExperiencia(detalle.requerimientos, detalle.descripcion);

  const resultado = decidirVeredicto({
    flags: flagsEf,
    salarioMensualQ,
    salarioTexto: detalle.salarioTag ?? literal.salarioTexto,
    // FIX RATING-UBICACION (defensa en profundidad): preferir la ubicación del
    // DETALLE (parseada junto al h1) sobre la de la card, que puede ser un rating
    // ("4.4") colado por el parser del listado y provocar falsos descartes.
    ubicacionCard: (detalle.ubicacion && detalle.ubicacion.trim()) ? detalle.ubicacion : card.ubicacion,
    empresa: card.empresa,
    config,
    experiencia,
    titulo: detalle.titulo || card.titulo,
  });
  if (escudo.accion === 'revisar' && resultado.veredicto === 'APTO') {
    resultado.veredicto = 'REVISAR';
    resultado.motivos.push('inyeccion_dudosa');
    resultado.razon.push(`Inyección dudosa (${escudo.injection.toFixed(2)}) — revisar manual`);
  }
  return { ...resultado, literal: { ...literal, estudiosLiteral }, salarioMensualQ, flags: flagsEf, experiencia };
}
