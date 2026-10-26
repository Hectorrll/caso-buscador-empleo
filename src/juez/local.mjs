// Juez 100% local: reemplaza a Jev (servicio de IA de pago, ya sin suscripción) con
// reglas de texto deterministas. Devuelve los MISMOS ids de clase que los catálogos de
// criterios.mjs, así decidirVeredicto, el ranking y el reporte no cambian. Ante la duda
// se devuelve la clase neutra (no_dice/ambiguo): lo no declarado nunca descarta.

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Texto completo sin acentos: título + requerimientos + descripción. Sin tope de
// longitud (el recorte de 2,000 chars era un límite del endpoint de Jev).
export function textoDe({ titulo = '', descripcion = '', requerimientos = [] } = {}) {
  const reqs = (Array.isArray(requerimientos) ? requerimientos : []).map(String).join(' | ');
  return norm(`${titulo}\n${reqs}\n${descripcion}`);
}

// ¿Aparece `cerca` a menos de `ventana` caracteres (antes o después) de algún match de `ancla`?
function cercaDe(t, ancla, cerca, ventana = 60) {
  const re = new RegExp(ancla.source, 'g');
  for (const m of t.matchAll(re)) {
    const tramo = t.slice(Math.max(0, m.index - ventana), m.index + m[0].length + ventana);
    if (cerca.test(tramo)) return true;
  }
  return false;
}

const INGLES = /\b(ingles|english)\b/;
const DESEABLE = /deseable|plus|ventaja|valora|preferible|de preferencia|no (es )?indispensable|no excluyente|opcional/;
const NIVEL_IDIOMA = /requerid|indispensable|obligatori|necesari|excluyente|basico|intermedio|avanzado|fluid|conversacional|nativo|\d{2} ?%|b1|b2|c1|dominio|manejo|lectura|escritura/;

export function clasificarIngles(t) {
  if (/\bbilingue|bilingual\b/.test(t)) return 'requerido';
  if (!INGLES.test(t)) return 'no_pide';
  if (cercaDe(t, INGLES, DESEABLE, 50)) return 'deseable';
  if (/idiomas?:[^|\n]*\bingles\b/.test(t)) return 'requerido';
  if (cercaDe(t, INGLES, NIVEL_IDIOMA, 50)) return 'requerido';
  // "Inglés" suelto en una lista de requisitos o conocimientos.
  if (/(requisitos?|conocimientos?|requerimientos?)[^.\n]{0,200}\bingles\b/.test(t)) return 'requerido';
  return 'ambiguo';
}

const UNI_FICHA = /educacion minima:\s*(universi|postgrado|posgrado)/;
// Solo en contexto de requisito: "universidad"/"ingeniería" sueltos suelen describir
// a la empresa o al cliente, no lo que se le exige al candidato.
const UNI_TEXTO = /((estudiante|egresad|graduad|pensum|titulo|estudios|cursando|carrera|grado)[^.\n|]{0,40}(universitari|licenciatura|ingenieria|universidad)|licenciatura en|graduado universitario|nivel universitario|semestres? (aprobad|cursad)|\d+(er|do|to|vo|ro)? (anos?|semestres?) (de la carrera|aprobados|de universidad)|(bachelor|university) degree)/;

export function clasificarEstudios(t) {
  if (UNI_FICHA.test(t)) return 'universitario_o_mas';
  const ficha = t.match(/educacion minima:\s*([^|\n]+)/)?.[1] ?? '';
  // Universidad solo "deseable" no es requisito eliminatorio.
  const uniExigida = UNI_TEXTO.test(t) && !cercaDe(t, UNI_TEXTO, DESEABLE, 50);
  if (uniExigida && !/bachiller|diversificado|perito|tecnico/.test(ficha)) return 'universitario_o_mas';
  if (/bachillerato|diversificado|tecnico|perito/.test(ficha)) return 'bachillerato_o_tecnico';
  if (/primaria|secundaria|basica/.test(ficha)) return 'sin_estudios';
  if (/bachiller|diversificado|perito|secretari[ao] (comercial|bilingue|oficinista)|nivel medio|educacion media/.test(t)) return 'bachillerato_o_tecnico';
  if (/sin estudios|primaria|tercero basico|nivel basico/.test(t)) return 'sin_estudios';
  return 'ambiguo';
}

const FINDE = /\b(sabados?|domingos?|fines? de semana|lunes a sabado|lunes a domingo)\b/;
const FINDE_LIBRE = /(sabados?|domingos?|fines? de semana)[^.\n]{0,15}\b(libres?|de descanso|descans)|(descans|libres?)[^.\n]{0,25}(sabados?|domingos?|fines? de semana)/;
// El fin de semana solo cuenta como día de trabajo si se habla de horario o jornada
// ("un bot que responda los fines de semana" no es el horario del candidato).
const CONTEXTO_HORARIO = /horario|jornada|turno|laborar|trabajar|disponibilidad|lunes|medio dia|\d ?(am|pm|hrs)|de \d{1,2}(:\d{2})? a \d/;

export function clasificarFinDeSemana(t) {
  if (/\b(turnos? rotativ|rotativos?|rol de turnos|turnos? 24|24\/7|4x3|5x2|6x1|descanso entre semana|dia de descanso (a la semana|rotativo))/.test(t)) return 'rotativo';
  const libre = FINDE_LIBRE.test(t);
  // Cualquier mención de trabajar sábado/domingo gana sobre "lunes a viernes",
  // salvo que la mención sea justamente que el fin de semana es libre.
  const sinLibre = t.replace(new RegExp(FINDE_LIBRE.source, 'g'), '');
  if (/lunes a (sabado|domingo)/.test(sinLibre) || cercaDe(sinLibre, FINDE, CONTEXTO_HORARIO, 40)) return 'no';
  if (libre || /lunes a viernes/.test(t)) return 'si';
  return 'no_dice';
}

// Flexibilidad PARA el trabajador. "Disponibilidad / flexibilidad de horario" exigida
// al candidato es lo contrario (se adapta a la empresa) → 'no'.
const FLEX_SI = /(horarios? flexibles?|flexibilidad (de |en el |en )?horari|manejas? tu (propio )?(tiempo|horario)|eliges? tu (horario|turno)|tu (pones|decides|organizas) (tu|el) horario|horario a (tu )?convenir|horario por (objetivos|metas)|metas? de horas|horas semanales a cumplir|horario libre|flexible (schedule|hours)|turnos? flexibles?)/;
const FLEX_EXIGIDA = /(disponibilidad|disposicion|contar con|tener|requisitos?)[^.\n|]{0,25}(flexibilidad|flexible|horario)/;
const HORARIO_FIJO = /(\b\d{1,2}(:\d{2})? ?(am|a\.m\.|hrs?|horas)? ?(a|-|hasta) ?\d{1,2}(:\d{2})? ?(pm|p\.m\.|hrs?|horas)?\b|jornada (diurna|matutina|vespertina|nocturna|mixta)|turnos?\b|horario de (trabajo|oficina|lunes)|horario fijo)/;

export function clasificarHorarioFlexible(t) {
  if (FLEX_SI.test(t)) {
    // La única mención de flexibilidad es un requisito al candidato → no.
    const sinExigida = t.replace(new RegExp(FLEX_EXIGIDA.source, 'g'), '');
    if (FLEX_SI.test(sinExigida)) return 'si';
    return 'no';
  }
  if (FLEX_EXIGIDA.test(t) || HORARIO_FIJO.test(t)) return 'no';
  return 'no_dice';
}

const REMOTO_NEGADO = /\bno (es |sera |hay |aplica |se trabaja )?(remoto|home office|teletrabajo|desde casa)/;

export function clasificarModalidad(t) {
  const negado = REMOTO_NEGADO.test(t);
  const limpio = t.replace(new RegExp(REMOTO_NEGADO.source, 'g'), '');
  if (/\bhibrid|modalidad mixta|presencial y remot|remoto y presencial|\d (dias?|veces) (a la semana )?(en|de) (oficina|home office|casa|remoto)/.test(limpio)) return 'hibrido';
  const remoto = /(100 ?% remot|trabajo remoto|\bremoto\b|home ?office|desde (tu |su )?casa|teletrabajo|\bremote\b|work from home)/.test(limpio);
  const sedeFuerte = /(\bpresencial|(trabajar|laborar|asistir|presentarse) en (zona|sede|oficina|planta|bodega|tienda|agencia|nuestras))/;
  const sede = sedeFuerte.test(limpio) || /(en (nuestras|las) (oficinas|instalaciones)|en (la )?sede|en oficina)/.test(limpio);
  // Con remoto declarado, solo una sede "fuerte" lo vuelve híbrido: "nuestras
  // oficinas" a secas suele describir a la empresa.
  if (remoto && sedeFuerte.test(limpio)) return 'hibrido';
  if (remoto) return 'remoto';
  if (sede || negado) return 'presencial';
  return 'no_dice';
}

const TIT_CALL = /\b(call ?cent(er|re)|contact ?cent(er|re)|telemarketing|televentas|telefonista|agente telefonic|cobros? telefonic|teleoperador|agente de (servicio|atencion) al cliente bilingue)/;
const TXT_CALL = /(llamadas (entrantes|salientes|telefonicas)|atencion telefonica|via telefonica|gestion telefonica|call ?center|contact ?center|telemarketing|televentas)/;
const AREAS = [
  ['ventas', /\b(vendedor|ventas de (campo|ruta)|asesor(a)? (comercial|de ventas)|ejecutiv[oa] (comercial|de ventas|de negocios)|promotor|impulsador|preventa|representante de ventas|key account|ventas)\b/],
  ['servicio_cliente', /\b(meser|cajer|recepcion|tienda|bartender|anfitri|dependiente|barista|hostess|atencion al cliente en (tienda|sala|agencia)|vendedor de mostrador|cocin|chef)/],
  ['computacion', /\b(soporte tecnico|help ?desk|programador|desarrollador|developer|sistemas|redes|\bit\b|informatic|data entry|digitador|disenador|diseno grafico|community manager|redes sociales|marketing digital|e-?commerce|analista de datos|datos|web|software|qa|tester)/],
  ['administrativa', /\b(asistente|auxiliar|administrativ|facturacion|recursos humanos|reclutador|reclutamiento|secretari|cobros|cartera|atencion al cliente|servicio al cliente|oficinista|compras|archivo|planilla|logistica administrativa)/],
];

export function clasificarArea(t, titulo = '') {
  const tt = norm(titulo);
  if (TIT_CALL.test(tt)) return 'call_center';
  for (const [area, re] of AREAS) if (re.test(tt)) return area;
  if (TXT_CALL.test(t)) return 'call_center';
  for (const [area, re] of AREAS) if (re.test(t)) return area;
  return 'otro';
}

// Señales contables CENTRALES; facturación, IVA en una factura o cobros no lo son.
const CONTABLE = /\b(perito contador|contador (general|publico)|contabilidad general|registros? contables?|conciliaciones? bancari|partidas contables|estados financieros|cierres? contables?|cierre mensual|declaraciones? (de )?(iva|isr)|auditoria|tesoreria|libros contables|nomina contable|estudiante de cpa|cpa\b)/;
const CON_NUMEROS = /\b(facturacion|factura|cobros|caja chica|cotizaciones|inventario|cuentas por (cobrar|pagar)|cartera|pagos a proveedores|contab)/;

export function clasificarPerfilContable(t) {
  const fuerte = new Set(t.match(new RegExp(CONTABLE.source, 'g')) ?? []).size;
  // "Perito contador o carrera afín / cualquier bachillerato" deja alternativa.
  const alternativa = /perito contador (o|u|y\/o) (bachiller|carrera afin|similar|cualquier)/.test(t);
  if (fuerte >= 2 && !alternativa) return 'contable';
  if (fuerte >= 1 || CON_NUMEROS.test(t)) return 'administrativo_con_numeros';
  return 'no_contable';
}

const IA_BAJA = /\b(herrer|caldera|aire acondicionado|a domicilio|de campo|fitness|entrenador|instructor de (gimnasio|manejo)|estilista|barber|bodega|bodeguer|picker|repositor|operari|piloto|mensajer|repartidor|motorista|conductor|chofer|cajer|meser|cocin|limpieza|conserje|guardia|agente de seguridad|montacargu|linea de produccion|planta de produccion|tecnico de mantenimiento|tecnico de campo|instalador|rutas? de (venta|reparto)|impulsador|promotor|mecanic|electricista|albanil|carga y descarga|cargador|despacho de|empaque|empacador|ayudante|jardiner|soldador|enfermer|vendedor de piso|dependiente|barista|bartender|tornero|costurer|operador de maquina)/;
const IA_ALTA = /\b(excel|google sheets|hojas de calculo|reportes|informes|base de datos|datos|crm|redes sociales|community|contenido digital|soporte tecnico|chat|tickets|correo electronico|e-?commerce|digital|power bi|automatiz|sistemas|software|data entry|digitacion|documentacion|analisis|dashboards?|marketing digital|programacion|web)\b/g;

export function clasificarPalancaIA(t, titulo = '', area = 'otro', modalidad = 'no_dice') {
  const tt = norm(titulo);
  if (IA_BAJA.test(tt)) return 'baja';
  // Lo 100% remoto se hace en computadora por definición.
  if (modalidad === 'remoto') return area === 'call_center' ? 'media' : 'alta';
  if (area === 'call_center' || area === 'servicio_cliente') return 'media';
  const alta = new Set(t.match(IA_ALTA) ?? []).size;
  if (area === 'computacion' && alta >= 1) return 'alta';
  if (alta >= 3 && (area === 'administrativa' || area === 'computacion')) return 'alta';
  if (area === 'ventas' && /(campo|ruta|visitas?|calle)/.test(t)) return 'baja';
  if (IA_BAJA.test(t) && alta < 2) return 'baja';
  return 'media';
}

const JEFATURA = /\b(jefe|jefa|gerente|supervisor|coordinador|lider|senior|sr\b|encargad|director|head|manager|lead|subgerente|superintendente)/;

const ENTRADA_TITULO = /\b(auxiliar|asistente|junior|jr|trainee|practicante|pasante|pasantia|aprendiz|becari)/;

export function clasificarNivel(t, titulo = '') {
  // "Community/Social Media Manager" es un oficio, no una jefatura; "Asistente de
  // gerencia" es de entrada aunque diga gerente.
  const tt = norm(titulo).replace(/\b(community|social media|content|ads|account) manager\b/g, '');
  if (ENTRADA_TITULO.test(tt) && !/\bsenior\b/.test(tt)) return 'entrada';
  if (JEFATURA.test(tt)) return 'jefatura_o_senior';
  if (/personal a (su )?cargo|equipo a (su )?cargo|liderar (un |el )?equipo|manejo de personal/.test(t)) return 'jefatura_o_senior';
  if (/sin experiencia|no (se )?requiere experiencia|primer empleo|recien graduad|menos de 1 ano de experiencia|0 anos de experiencia/.test(t)) return 'entrada';
  if (/\b(analista|ejecutiv|especialista|consultor|ingenier|profesional)/.test(tt)) return 'intermedio';
  if (/\b([2-9]|1\d) anos de experiencia/.test(t)) return 'intermedio';
  if (/\b1 ano de experiencia/.test(t)) return 'entrada';
  return 'intermedio';
}

const EXPERIENCIA = /experiencia/;

export function clasificarExperienciaExigencia(t) {
  if (cercaDe(t, EXPERIENCIA, /indispensable|excluyente|comprobable|obligatori|minim[oa]|requisito|requerid|necesari/, 40)) return 'estricta';
  if (/sin experiencia|no (se )?requiere experiencia|no necesitas experiencia|te capacitamos|capacitacion (constante|pagada|completa)|no es necesaria (la )?experiencia/.test(t)) return 'flexible';
  if (cercaDe(t, EXPERIENCIA, DESEABLE, 40)) return 'flexible';
  return 'no_dice';
}

const OTRA_ESPECIALIDAD = /\b(autocad|revit|solidworks|sap fi|sketchup|archicad|civil 3d|enfermer|magisterio|perito contador|mecanica automotriz|electricidad|electronica|electromecanic|dibujo (de |en )?construccion|dibujante|arquitect|ingenier[oa] (civil|industrial|mecanic|electric|quimic|agronom)|quimic|farmac|medic[oa]|odontolog|nutricion|psicolog|abogad|derecho|notari|veterinari|laboratorista|radiolog|fisioterap|maestro de obra|topograf|refrigeracion|soldadura|tornero)/;

export function clasificarFormacionEspecifica(t) {
  if (OTRA_ESPECIALIDAD.test(t)) return 'otra_especialidad';
  return 'general_o_computacion';
}

export function clasificarVehiculo(t) {
  const moto = /\b(moto propia|motocicleta propia|contar con moto|tener moto|licencia (tipo )?m\b|licencia de moto|motorizad)/.test(t);
  const carro = /\b(licencia (de conducir|tipo [abc]\b|liviana|vigente)|vehiculo propio|carro propio|automovil propio|licencia tipo b|licencias de conducir)/.test(t);
  const alternativa = /(moto|carro|vehiculo) (o|y\/o|u) (moto|carro|vehiculo)/.test(t);
  if (moto && !carro && !alternativa) return 'solo_moto';
  if (moto || carro) return 'carro_o_licencia';
  return 'no_pide';
}

// Los 12 criterios de una oferta, con los mismos ids que CATALOGOS (criterios.mjs).
// Sin `probabilidades`: probabilidadApto cae a sus valores por defecto.
export function clasificarOferta(o) {
  const t = textoDe(o);
  const titulo = o.titulo ?? '';
  const area = clasificarArea(t, titulo);
  const modalidad = clasificarModalidad(t);
  return {
    ingles: clasificarIngles(t),
    estudios: clasificarEstudios(t),
    finDeSemana: clasificarFinDeSemana(t),
    horarioFlexible: clasificarHorarioFlexible(t),
    modalidad,
    area,
    perfilContable: clasificarPerfilContable(t),
    palancaIA: clasificarPalancaIA(t, titulo, area, modalidad),
    nivel: clasificarNivel(t, titulo),
    experienciaExigencia: clasificarExperienciaExigencia(t),
    formacionEspecifica: clasificarFormacionEspecifica(t),
    vehiculo: clasificarVehiculo(t),
  };
}

// Relevancia 0-1 para el ranking (reemplaza jev_rerank): cuánto se parece el texto al
// trabajo que busca el candidato — en computadora, administrativo/digital, de entrada.
export function relevanciaLocal(texto) {
  const t = norm(texto);
  const area = clasificarArea(t);
  let r = 0.3 + Math.min(0.35, 0.07 * new Set(t.match(IA_ALTA) ?? []).size);
  if (area === 'administrativa' || area === 'computacion') r += 0.15;
  if (area === 'call_center') r -= 0.15;
  if (area === 'ventas' || area === 'servicio_cliente') r -= 0.1;
  if (/sin experiencia|te capacitamos|junior|\bjr\b|trainee|practicante|auxiliar|asistente/.test(t)) r += 0.1;
  if (/\b(ia|inteligencia artificial|automatizacion|chatgpt|claude|ai)\b/.test(t)) r += 0.1;
  return Math.max(0, Math.min(1, Math.round(r * 100) / 100));
}

// Verificación de claims (reemplaza jev_verify). Las afirmaciones que salen de una
// regla de texto ya están respaldadas por el mismo texto; la que NO lo está es la
// modalidad, que suele venir de la etiqueta del sitio (híbridos falsos de call center):
// sin mención de remoto/híbrido en el texto queda sin respaldo (p baja en el ranking).
function verificarClaimLocal(claim, t) {
  const modalidad = clasificarModalidad(t);
  const pide = /100% remoto/.test(norm(claim)) ? ['remoto'] : /hibrido/.test(norm(claim)) ? ['hibrido', 'remoto'] : null;
  if (!pide) return { claim, verdict: 'verified', probabilities: { supports: 0.9, contradicts: 0.05 } };
  if (pide.includes(modalidad)) return { claim, verdict: 'verified', probabilities: { supports: 0.9, contradicts: 0.05 } };
  if (modalidad === 'presencial' || modalidad === 'hibrido') return { claim, verdict: 'contradicted', probabilities: { supports: 0.1, contradicts: 0.8 } };
  return { claim, verdict: 'unsupported', probabilities: { supports: 0.25, contradicts: 0.2 } };
}

// Cliente con la misma forma que crearJevClient (call/cerrar): el pipeline no cambia.
// `local: true` hace que clasificarCriterios use clasificarOferta sobre el texto
// completo (sin el recorte de 2,000 chars que imponía el endpoint).
export function crearJevLocal() {
  return {
    local: true,
    clasificar: clasificarOferta,
    async call(herramienta, args = {}) {
      if (herramienta === 'jev_extract') {
        const doc = String(args.document ?? '');
        return {
          results: (args.fields ?? []).map((f) => {
            const m = doc.match(new RegExp(f.pattern, f.flags ?? 'i'));
            return m ? { id: f.id, value: m[0].trim(), status: 'ok' } : { id: f.id, value: null, status: 'not_found' };
          }),
        };
      }
      if (herramienta === 'jev_screen') return { probabilities: { injection: 0 } };
      if (herramienta === 'jev_verify') {
        const t = norm((args.evidence ?? []).filter((e) => e.id !== 'ficha').map((e) => e.text).join('\n'));
        return { results: (args.claims ?? []).map((c) => verificarClaimLocal(c, t)) };
      }
      if (herramienta === 'jev_rerank') {
        return { ranked: (args.candidates ?? []).map((c) => ({ id: c.id, relevance: relevanciaLocal(c.text) })) };
      }
      if (herramienta === 'jev_find') return { exists: 1 };
      if (herramienta === 'jev_classify') throw new Error('jev_classify no existe en el juez local: usa clasificar()');
      throw new Error(`Herramienta desconocida en el juez local: ${herramienta}`);
    },
    cerrar() {},
  };
}
