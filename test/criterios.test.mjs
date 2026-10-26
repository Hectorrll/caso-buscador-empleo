import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirVeredicto, mapearEstudios, clasificarCriterios, juzgarOferta, extraerCampos, CAMPOS_EXTRACT, esUbicacionCiudad, esAreaMetropolitana, modalidadEfectiva, parseExperiencia, vehiculoDeFicha } from '../src/juez/criterios.mjs';
import { cargarConfig } from '../src/config.mjs';

const config = cargarConfig();
// Las reglas base se prueban sin el horario personal del candidato (tiene su test propio).
delete config.duros.horario_personal;
const base = {
  ingles: 'no_pide', estudios: 'bachillerato_o_tecnico', finDeSemana: 'si',
  horarioFlexible: 'si', modalidad: 'remoto', area: 'administrativa',
  perfilContable: 'no_contable', palancaIA: 'alta', nivel: 'entrada', modalidadFuente: 'etiqueta',
};
const caso = (sobrescribir = {}, extra = {}) =>
  decidirVeredicto({
    flags: { ...base, ...sobrescribir },
    salarioMensualQ: 4500,
    salarioTexto: 'Q4,500 al mes',
    ubicacionCard: 'Guatemala Ciudad, Guatemala',
    empresa: 'ACME',
    config,
    ...extra,
  });

test('modalidadEfectiva: la etiqueta del sitio manda', () => {
  assert.deepEqual(modalidadEfectiva(['Tiempo Completo', 'Remoto'], 'remoto'), { modalidad: 'remoto', fuente: 'etiqueta' });
  assert.deepEqual(modalidadEfectiva(['Tiempo Completo', 'Remoto'], 'no_dice'), { modalidad: 'remoto', fuente: 'etiqueta' });
  assert.deepEqual(modalidadEfectiva(['Presencial y remoto'], 'no_dice'), { modalidad: 'hibrido', fuente: 'etiqueta' });
  assert.deepEqual(modalidadEfectiva(['Presencial y remoto'], 'hibrido'), { modalidad: 'hibrido', fuente: 'etiqueta' });
  assert.deepEqual(modalidadEfectiva(['Tiempo Completo'], 'hibrido'), { modalidad: 'hibrido', fuente: 'texto' });
  assert.deepEqual(modalidadEfectiva([], 'remoto'), { modalidad: 'remoto', fuente: 'texto' });
  assert.deepEqual(modalidadEfectiva(['Tiempo Completo'], 'no_dice'), { modalidad: 'presencial', fuente: 'defecto' });
  assert.deepEqual(modalidadEfectiva(undefined, 'presencial'), { modalidad: 'presencial', fuente: 'defecto' });
});

test('modalidadEfectiva: el texto que contradice la etiqueta gana y queda marcado', () => {
  // tag Remoto contradicho por el texto → gana el texto, fuente 'contradiccion'
  assert.deepEqual(modalidadEfectiva(['Remoto'], 'presencial'), { modalidad: 'presencial', fuente: 'contradiccion', etiqueta: 'remoto' });
  assert.deepEqual(modalidadEfectiva(['Remoto'], 'hibrido'), { modalidad: 'hibrido', fuente: 'contradiccion', etiqueta: 'remoto' });
  // tag 'Presencial y remoto' solo se contradice con texto 'presencial'
  assert.deepEqual(modalidadEfectiva(['Presencial y remoto'], 'presencial'), { modalidad: 'presencial', fuente: 'contradiccion', etiqueta: 'hibrido' });
  assert.deepEqual(modalidadEfectiva(['Presencial y remoto'], 'remoto'), { modalidad: 'hibrido', fuente: 'etiqueta' });
  // la razón de contradicción va AL INICIO de razon, en DESCARTADO y en APTO/REVISAR
  const r = caso({ modalidad: 'presencial', modalidadTexto: 'presencial', modalidadFuente: 'contradiccion', modalidadEtiqueta: 'hibrido' }, { ubicacionCard: 'Mixco, Guatemala' });
  assert.equal(r.veredicto, 'DESCARTADO');
  assert.ok(r.razon[0].includes('La etiqueta del sitio dice hibrido pero el texto dice presencial'));
  const apto = caso({ modalidad: 'hibrido', modalidadTexto: 'hibrido', modalidadFuente: 'contradiccion', modalidadEtiqueta: 'remoto' });
  assert.equal(apto.veredicto, 'APTO');
  assert.ok(apto.razon[0].includes('La etiqueta del sitio dice remoto pero el texto dice hibrido'));
});

test('parseExperiencia: ficha primero, descripción de respaldo, nada = null', () => {
  assert.deepEqual(parseExperiencia(['1 año de experiencia'], ''), { anios: 1, fuente: 'ficha' });
  assert.deepEqual(parseExperiencia(['3 años de experiencia'], '1 año de experiencia'), { anios: 3, fuente: 'ficha' });
  assert.deepEqual(parseExperiencia(['Menos de 1 año de experiencia'], ''), { anios: 0, fuente: 'ficha' });
  assert.deepEqual(parseExperiencia([' años de experiencia'], 'Requisitos: 2 años de experiencia en ventas'), { anios: 2, fuente: 'descripcion' });
  assert.deepEqual(parseExperiencia([' años de experiencia'], 'mínimo un año de experiencia'), { anios: 1, fuente: 'descripcion' });
  assert.deepEqual(parseExperiencia([' años de experiencia'], 'sin requisitos'), { anios: null, fuente: null });
  assert.deepEqual(parseExperiencia(undefined, undefined), { anios: null, fuente: null });
});

test('parseExperiencia: devuelve el MÁXIMO entre ficha y descripción (empate → ficha)', () => {
  // patrón (b): "experiencia ... N años" en cualquier orden de la frase
  assert.deepEqual(parseExperiencia([], 'Experiencia mínima de 2 años en call center'), { anios: 2, fuente: 'descripcion' });
  assert.deepEqual(parseExperiencia([], 'Experiencia: cobranza: 1 año (Obligatorio)'), { anios: 1, fuente: 'descripcion' });
  // la ficha queda por debajo del requisito real del texto
  assert.deepEqual(parseExperiencia(['1 año de experiencia'], 'Experiencia mínima de 2 años en call center'), { anios: 2, fuente: 'descripcion' });
  // empate → ficha
  assert.deepEqual(parseExperiencia(['1 año de experiencia'], 'Experiencia: cobranza: 1 año (Obligatorio)'), { anios: 1, fuente: 'ficha' });
  // la ficha también puede ganar el máximo
  assert.deepEqual(parseExperiencia(['3 años de experiencia'], 'Experiencia mínima de 2 años'), { anios: 3, fuente: 'ficha' });
  // "Edad: entre 20 y 28 años" no es experiencia (N tope 15 y sin la palabra cerca)
  assert.deepEqual(parseExperiencia(['Edad: entre 20 y 28 años'], 'Edad: entre 20 y 28 años'), { anios: null, fuente: null });
});

test('reglas duras descartan', () => {
  assert.equal(caso().veredicto, 'APTO');
  assert.equal(caso({ ingles: 'requerido' }).veredicto, 'DESCARTADO');
  assert.equal(caso({ estudios: 'universitario_o_mas' }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { salarioMensualQ: 3500 }).veredicto, 'DESCARTADO');
  assert.equal(caso({ modalidad: 'presencial' }, { ubicacionCard: 'Mixco, Guatemala' }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { empresa: 'Call Center X' , config: { ...config, duros: { ...config.duros, empresas_excluidas: ['call center x'] } } }).veredicto, 'DESCARTADO');
  // sin etiqueta ni modalidad declarada la efectiva es presencial/defecto → fuera de ciudad descarta
  assert.equal(caso({ modalidad: 'presencial', modalidadFuente: 'defecto' }, { ubicacionCard: 'Mixco, Guatemala' }).veredicto, 'DESCARTADO');
});

test('sin datos duros → REVISAR, nunca descarte por silencio', () => {
  assert.equal(caso({}, { salarioMensualQ: null, salarioTexto: 'A convenir' }).veredicto, 'REVISAR');
  assert.equal(caso({ estudios: 'ambiguo' }).veredicto, 'REVISAR');
  // híbrido por etiqueta fuera de la ciudad: ya no es APTO, va a revisar
  assert.equal(caso({ modalidad: 'hibrido' }, { ubicacionCard: 'Cobán, Alta Verapaz' }).veredicto, 'REVISAR');
});

test('estricto: contable, jefatura, experiencia, presencial fijo', () => {
  assert.ok(caso({ perfilContable: 'contable' }).motivos.includes('contable'));
  assert.equal(caso({ perfilContable: 'contable' }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { titulo: 'Auxiliar Contable' }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { titulo: 'Asistente de Impuestos' }).veredicto, 'DESCARTADO');
  assert.equal(caso({ perfilContable: 'administrativo_con_numeros' }, { titulo: 'Auxiliar de Facturación' }).veredicto, 'APTO');
  assert.equal(caso({ nivel: 'jefatura_o_senior' }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { experiencia: { anios: 3, fuente: 'ficha' } }).veredicto, 'DESCARTADO');
  assert.equal(caso({}, { experiencia: { anios: 2, fuente: 'ficha' } }).veredicto, 'REVISAR');
  assert.equal(caso({}, { experiencia: { anios: 5, fuente: 'descripcion' } }).veredicto, 'REVISAR');
  assert.equal(caso({}, { experiencia: { anios: 1, fuente: 'ficha' } }).veredicto, 'APTO');
  assert.equal(caso({}, { experiencia: { anios: null, fuente: null } }).veredicto, 'APTO');
  assert.equal(caso({ modalidad: 'presencial', modalidadFuente: 'defecto', horarioFlexible: 'no_dice' }).veredicto, 'DESCARTADO');
  assert.ok(caso({ modalidad: 'presencial', modalidadFuente: 'defecto', horarioFlexible: 'no' }).motivos.includes('presencial_fijo'));
  assert.equal(caso({ modalidad: 'presencial', modalidadFuente: 'defecto', horarioFlexible: 'si' }).veredicto, 'APTO');
});

test('estricto: modalidad solo por texto e híbrido fuera de la ciudad → REVISAR', () => {
  assert.ok(caso({ modalidad: 'remoto', modalidadFuente: 'texto' }).motivos.includes('modalidad_solo_texto'));
  assert.equal(caso({ modalidad: 'remoto', modalidadFuente: 'texto' }).veredicto, 'REVISAR');
  assert.equal(caso({ modalidad: 'hibrido' }, { ubicacionCard: 'Cobán, Alta Verapaz' }).veredicto, 'REVISAR');
  assert.equal(caso({ modalidad: 'remoto' }, { ubicacionCard: 'Cobán, Alta Verapaz' }).veredicto, 'APTO');
});

test('descarte gana a revisar y acumula motivos', () => {
  const r = caso({ nivel: 'jefatura_o_senior', ingles: 'ambiguo' }, { experiencia: { anios: 2, fuente: 'ficha' } });
  assert.equal(r.veredicto, 'DESCARTADO');
  assert.deepEqual(r.motivos, ['jefatura']);
});

test('horario_personal: presencial flexible → REVISAR (confirmar huecos); remoto no se toca', () => {
  const conHorario = { ...config, duros: { ...config.duros, horario_personal: 'jueves hasta las 14:00' } };
  const r = caso({ modalidad: 'presencial' }, { ubicacionCard: 'Zona 10, Guatemala', config: conHorario });
  assert.equal(r.veredicto, 'REVISAR');
  assert.deepEqual(r.motivos, ['horario_personal']);
  assert.match(r.razon.join(' '), /jueves hasta las 14:00/);
  assert.equal(caso({ modalidad: 'remoto' }, { config: conHorario }).veredicto, 'APTO');
  // Sin horario flexible el presencial sigue descartado: el horario personal no lo rescata.
  assert.equal(caso({ modalidad: 'presencial', horarioFlexible: 'no_dice' }, { ubicacionCard: 'Zona 10, Guatemala', config: conHorario }).veredicto, 'DESCARTADO');
});

test('inglés ambiguo → REVISAR con motivo ingles_ambiguo', () => {
  const r = caso({ ingles: 'ambiguo' });
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('ingles_ambiguo'));
});

test('ubicación de ciudad: Guatemala Ciudad, Guatemala, Guatemala y Zona 10 sí; Mixco, Fraijanes y Cobán no', () => {
  assert.equal(esUbicacionCiudad('Guatemala Ciudad'), true);
  assert.equal(esUbicacionCiudad('Guatemala, Guatemala'), true);
  assert.equal(esUbicacionCiudad('Zona 10, Guatemala'), true);
  assert.equal(esUbicacionCiudad('Mixco, Guatemala'), false);
  assert.equal(esUbicacionCiudad('Fraijanes, Guatemala'), false);
  assert.equal(esUbicacionCiudad('Cobán, Alta Verapaz'), false);
  // presencial en la capital publicada como ciudad,departamento no se descarta
  assert.equal(caso({ modalidad: 'presencial' }, { ubicacionCard: 'Guatemala, Guatemala' }).veredicto, 'APTO');
  assert.equal(caso({ modalidad: 'presencial' }, { ubicacionCard: 'Zona 10, Guatemala' }).veredicto, 'APTO');
  assert.equal(caso({ modalidad: 'presencial' }, { ubicacionCard: 'Fraijanes, Guatemala' }).veredicto, 'DESCARTADO');
});

test('área metropolitana: ciudad + municipios del depto. con sufijo ", Guatemala"', () => {
  for (const u of ['Guatemala Ciudad', 'Guatemala, Guatemala', 'Zona 10, Guatemala',
    'Mixco, Guatemala', 'Villa Nueva, Guatemala', 'Villa Canales, Guatemala',
    'San Miguel Petapa, Guatemala', 'Chinautla, Guatemala', 'Santa Catarina Pinula, Guatemala',
    'San José Pinula, Guatemala', 'San Jose Pinula, Guatemala', 'Fraijanes, Guatemala',
    'Amatitlán, Guatemala', 'San Juan Sacatepéquez, Guatemala', 'San Pedro Ayampuc, Guatemala',
    'Palencia, Guatemala']) {
    assert.equal(esAreaMetropolitana(u), true, u);
  }
  assert.equal(esAreaMetropolitana('Palencia'), false);            // sin sufijo ", Guatemala"
  assert.equal(esAreaMetropolitana('San José, Escuintla'), false); // otro departamento
  assert.equal(esAreaMetropolitana('Cobán, Alta Verapaz'), false);
  assert.equal(esAreaMetropolitana('Mixco'), false);
  assert.equal(esAreaMetropolitana(''), false);
});

test('híbrido en el área metropolitana es APTO; fuera de ella sigue REVISAR', () => {
  // Mixco no es ciudad (presencial ahí sigue descartado) pero sí área metropolitana
  assert.equal(caso({ modalidad: 'hibrido' }, { ubicacionCard: 'Mixco, Guatemala' }).veredicto, 'APTO');
  assert.equal(caso({ modalidad: 'hibrido' }, { ubicacionCard: 'Villa Nueva, Guatemala' }).veredicto, 'APTO');
  assert.equal(caso({ modalidad: 'presencial' }, { ubicacionCard: 'Mixco, Guatemala' }).veredicto, 'DESCARTADO');
  const r = caso({ modalidad: 'hibrido' }, { ubicacionCard: 'Cobán, Alta Verapaz' });
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('hibrido_fuera_ciudad'));
  assert.ok(r.razon.some((x) => x.includes('área metropolitana')));
});

test('palanca IA baja descarta solo si el duro está activo', () => {
  const r = caso({ palancaIA: 'baja' });
  assert.equal(r.veredicto, 'DESCARTADO');
  assert.ok(r.motivos.includes('palanca_ia_baja'));
  assert.ok(r.razon.some((x) => x.includes('palanca IA baja')));
  // con la llave apagada no descarta
  const configSin = { ...config, duros: { ...config.duros, descartar_palanca_ia_baja: false } };
  assert.equal(caso({ palancaIA: 'baja' }, { config: configSin }).veredicto, 'APTO');
  // palanca media/alta no se toca
  assert.equal(caso({ palancaIA: 'media' }).veredicto, 'APTO');
});

test('fin de semana trabajado o rotativo → DESCARTADO (duro descartar_fin_de_semana)', () => {
  for (const v of ['no', 'rotativo']) {
    const r = caso({ finDeSemana: v });
    assert.equal(r.veredicto, 'DESCARTADO');
    assert.ok(r.motivos.includes('fin_de_semana'));
    assert.ok(r.razon.some((x) => x.includes('sábados ni domingos')));
  }
  const configSin = { ...config, duros: { ...config.duros, descartar_fin_de_semana: false } };
  assert.equal(caso({ finDeSemana: 'no' }, { config: configSin }).veredicto, 'APTO');
  for (const v of ['si', 'no_dice']) {
    assert.equal(caso({ finDeSemana: v }).veredicto, 'APTO');
  }
});

test('call center solo remoto: híbrido/presencial descarta, remoto no', () => {
  const r = caso({ area: 'call_center', modalidad: 'hibrido' });
  assert.equal(r.veredicto, 'DESCARTADO');
  assert.ok(r.motivos.includes('call_center_no_remoto'));
  assert.ok(r.razon.some((x) => x.includes('100% remotos')));
  assert.equal(caso({ area: 'call_center' }).veredicto, 'APTO'); // modalidad remoto (base)
  const configSin = { ...config, duros: { ...config.duros, call_center_solo_remoto: false } };
  assert.ok(!caso({ area: 'call_center', modalidad: 'hibrido' }, { config: configSin }).motivos.includes('call_center_no_remoto'));
});

test('experiencia estricta por encima del tope → REVISAR experiencia_estricta (sin duplicar experiencia_2)', () => {
  // 1 año "obligatorio" ya excede al candidato (<1 año): REVISAR aunque max_apto sea 1
  const r = caso({ experienciaExigencia: 'estricta' }, { experiencia: { anios: 1, fuente: 'ficha' } });
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('experiencia_estricta'));
  assert.ok(r.razon.some((x) => x.includes('obligatoria')));
  // si ya se agregó experiencia_2 no se duplica
  const r2 = caso({ experienciaExigencia: 'estricta' }, { experiencia: { anios: 2, fuente: 'ficha' } });
  assert.ok(r2.motivos.includes('experiencia_2'));
  assert.ok(!r2.motivos.includes('experiencia_estricta'));
  // flexible/no_dice no aplican; sin años declarados tampoco
  assert.ok(!caso({ experienciaExigencia: 'flexible' }, { experiencia: { anios: 1, fuente: 'ficha' } }).motivos.includes('experiencia_estricta'));
  assert.ok(!caso({ experienciaExigencia: 'estricta' }, { experiencia: { anios: null, fuente: null } }).motivos.includes('experiencia_estricta'));
});

test('formación de otra especialidad → REVISAR formacion_especifica', () => {
  const r = caso({ formacionEspecifica: 'otra_especialidad' });
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('formacion_especifica'));
  assert.equal(caso({ formacionEspecifica: 'general_o_computacion' }).veredicto, 'APTO');
  assert.equal(caso({ formacionEspecifica: 'ambiguo' }).veredicto, 'APTO'); // ambiguo no castiga
});

test('vehiculoDeFicha lee "Licencias de conducir" de la ficha', () => {
  assert.equal(vehiculoDeFicha(['Licencias de conducir: motos']), 'solo_moto');
  assert.equal(vehiculoDeFicha(['Licencias de conducir: automóviles / carros']), 'carro_o_licencia');
  assert.equal(vehiculoDeFicha(['Licencias de conducir: moto o carro']), 'carro_o_licencia'); // acepta carro
  assert.equal(vehiculoDeFicha(['Licencias de conducir: B']), 'carro_o_licencia'); // sin especificar = carro
  assert.equal(vehiculoDeFicha(['Educación mínima: Bachillerato']), null);
  assert.equal(vehiculoDeFicha(undefined), null);
});

test('vehículo: moto descarta, carro/licencia va a revisar (según duro vehiculo)', () => {
  const moto = caso({ vehiculo: 'solo_moto' });
  assert.equal(moto.veredicto, 'DESCARTADO');
  assert.ok(moto.motivos.includes('moto'));
  const carro = caso({ vehiculo: 'carro_o_licencia' });
  assert.equal(carro.veredicto, 'REVISAR');
  assert.ok(carro.motivos.includes('vehiculo_carro'));
  assert.ok(carro.razon.some((x) => x.includes('sacar licencia')));
  // 'ignorar' apaga cada regla por separado
  const configIgnora = { ...config, duros: { ...config.duros, vehiculo: { moto: 'ignorar', carro_o_licencia: 'ignorar' } } };
  assert.equal(caso({ vehiculo: 'solo_moto' }, { config: configIgnora }).veredicto, 'APTO');
  assert.equal(caso({ vehiculo: 'carro_o_licencia' }, { config: configIgnora }).veredicto, 'APTO');
});

test('juzgarOferta: el título call center fuerza area call_center y la ficha manda en moto', async () => {
  const jevFake = {
    call: async (herr) => {
      if (herr === 'jev_screen') return { probabilities: { injection: 0.01 } };
      if (herr === 'jev_extract') return { results: [] };
      throw new Error('herramienta inesperada ' + herr);
    },
  };
  const card = { id: 'X', titulo: 'Agente de Call Center', empresa: 'ACME', ubicacion: 'Guatemala Ciudad, Guatemala' };
  const detalle = {
    titulo: 'Agente de Call Center', salarioTag: 'Q5,000 mensuales',
    otrosTags: ['Presencial y remoto'], descripcion: 'Atención telefónica a clientes.',
    requerimientos: ['Educación mínima: Bachillerato', 'Licencias de conducir: motos'],
  };
  // el clasificador dijo 'administrativa'/'no_pide': el título y la ficha corrigen
  const r = await juzgarOferta(jevFake, { card, detalle, flags: { ...base, modalidad: 'hibrido', area: 'administrativa', vehiculo: 'no_pide' }, config });
  assert.equal(r.flags.area, 'call_center');
  assert.equal(r.flags.vehiculo, 'solo_moto');
  assert.ok(r.motivos.includes('call_center_no_remoto'));
  assert.ok(r.motivos.includes('moto'));
});

test('mapearEstudios mapea lo literal', () => {
  assert.equal(mapearEstudios('Educación Técnico/Profesional'), 'bachillerato_o_tecnico');
  assert.equal(mapearEstudios('Título Universitario'), 'universitario_o_mas');
  assert.equal(mapearEstudios(null), 'ambiguo');
});

test('clasificarCriterios arma los 12 flags y guarda las probabilidades de Jev', async () => {
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_classify');
      const clase = args.classes[0].id; // el falso devuelve siempre la primera clase
      return { results: args.items.map((i) => ({ id: i.id, classification: clase, probabilities: { [clase]: 0.9 }, decision: 'auto' })) };
    },
  };
  const mapa = await clasificarCriterios(jevFake, [{ id: 'X', texto: 'Asistente administrativo lunes a viernes' }]);
  assert.equal(mapa.get('X').ingles, 'requerido');
  assert.equal(mapa.get('X').modalidad, 'remoto');
  assert.equal(mapa.get('X').perfilContable, 'contable');
  assert.equal(mapa.get('X').palancaIA, 'alta');
  assert.equal(mapa.get('X').nivel, 'entrada');
  assert.equal(mapa.get('X').experienciaExigencia, 'estricta');
  assert.equal(mapa.get('X').formacionEspecifica, 'general_o_computacion');
  assert.equal(mapa.get('X').vehiculo, 'no_pide');
  // probabilidades por criterio (alimentan probabilidadApto); los defaults no las inventan
  assert.equal(mapa.get('X').probabilidades.ingles.requerido, 0.9);
  assert.equal(mapa.get('X').probabilidades.experienciaExigencia.estricta, 0.9);
});

test('juzgarOferta compone seguridad + extract + reglas', async () => {
  const llamadas = [];
  const jevFake = {
    call: async (herr, args) => {
      llamadas.push(herr);
      if (herr === 'jev_screen') return { probabilities: { injection: 0.01, substance: 0.5, relevance: 0.5 } };
      if (herr === 'jev_extract') {
        return { results: [
          { id: 'salario', value: null, status: 'not_found' },
          { id: 'periodo_salario', value: null, status: 'not_found' },
          { id: 'estudios_minimos', value: 'bachillerato', status: 'auto' },
        ] };
      }
      throw new Error('herramienta inesperada ' + herr);
    },
  };
  const card = { id: 'X', titulo: 'Asistente', empresa: 'ACME', ubicacion: 'Guatemala Ciudad, Guatemala' };
  const detalle = { salarioTag: 'A convenir', descripcion: 'Puesto administrativo.', requerimientos: ['Educación mínima: Bachillerato'] };
  const r = await juzgarOferta(jevFake, { card, detalle, flags: base, config });
  assert.equal(r.veredicto, 'REVISAR'); // "A convenir" → salario no publicado
  // Orden del escudo fijado: jev_screen (⓪) primero, jev_extract después — SIN .sort()
  assert.deepEqual(llamadas, ['jev_screen', 'jev_extract']);
  assert.ok(r.razon.some((x) => x.includes('Salario no publicado')));
});

test('extraerCampos parte docs >50,000 en trozos de 45,000 y combina el primer valor válido por id', async () => {
  const docs = [];
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_extract');
      docs.push(args.document);
      if (docs.length === 1) {
        // primer chunk: todo not_found
        return { results: args.fields.map((f) => ({ id: f.id, value: null, status: 'not_found' })) };
      }
      // segundo chunk: completa los ids que el primero dejó en not_found
      return { results: [
        { id: 'salario', value: 'Q4,500', status: 'auto' },
        { id: 'periodo_salario', value: 'mensuales', status: 'auto' },
        { id: 'estudios_minimos', value: null, status: 'not_found' },
      ] };
    },
  };
  const detalle = { descripcion: 'x'.repeat(52000) + ' Salario: Q4,500 mensuales.', requerimientos: [] };
  const r = await extraerCampos(jevFake, detalle);
  assert.equal(docs.length, 2); // ≥2 llamadas solo porque el doc > 50,000
  assert.ok(docs.every((d) => d.length <= 50000));
  assert.equal(r.salarioTexto, 'Q4,500'); // valor combinado desde el segundo chunk
  assert.equal(r.periodoSalario, 'mensuales');
  assert.equal(r.estudiosTexto, null); // sigue en not_found → null (prohibido adivinar)
});

test('clasificarCriterios ve requerimientos completos + cola de descripción (sin recorte a 1,800)', async () => {
  const textos = [];
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_classify');
      for (const it of args.items) textos.push(it.text);
      return { results: args.items.map((i) => ({ id: i.id, classification: args.classes[0].id, probabilities: {}, decision: 'auto' })) };
    },
  };
  // requisitos suelen ir AL FINAL: con el recorte viejo (slice 0..1800) 'Idiomas: Inglés' se perdía
  const tanda = [{
    id: 'X',
    requerimientos: ['Idiomas: Inglés', 'Educación mínima: Bachillerato'],
    descripcion: 'd'.repeat(3500) + ' cierre-X',
  }];
  await clasificarCriterios(jevFake, tanda);
  assert.equal(textos.length, 12); // 12 criterios × 1 lote
  for (const t of textos) {
    assert.ok(t.includes('Idiomas: Inglés')); // requerimiento completo, jamás recortado
    assert.ok(t.includes('Educación mínima: Bachillerato'));
    assert.ok(t.includes('cierre-X')); // cola de la descripción (los requisitos van al final)
    assert.ok(t.length <= 1950, `excerpt de ${t.length} chars supera el tope`); // límite server-side: 2,000
  }
});

test('clasificarCriterios parte en lotes de ≤20 items y marca _sinClasificar sin ninguna clase real', async () => {
  const llamadas = []; // {purpose, n} — el endpoint real rechaza >20 con HTTP 400
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_classify');
      llamadas.push({ purpose: args.purpose, n: args.items.length });
      const clase = args.classes[0].id;
      return {
        results: args.items.flatMap((i) => {
          if (i.id === 'ausente') return []; // el endpoint nunca la devolvió (lote rechazado → error como texto)
          if (i.id === 'nula') return [{ id: i.id, classification: null }];
          return [{ id: i.id, classification: clase, probabilities: { [clase]: 0.9 }, decision: 'auto' }];
        }),
      };
    },
  };
  const tanda = [
    ...Array.from({ length: 39 }, (_, i) => ({ id: `id-${i}`, texto: 'x' })),
    { id: 'ausente', texto: 'x' },
    { id: 'nula', texto: 'x' },
  ]; // 41 items → 3 llamadas por criterio (20 + 20 + 1)
  const mapa = await clasificarCriterios(jevFake, tanda);
  assert.equal(llamadas.length, 36); // 12 criterios × 3 lotes
  assert.ok(llamadas.every((l) => l.n <= 20));
  const porCriterio = {};
  for (const l of llamadas) porCriterio[l.purpose] = (porCriterio[l.purpose] ?? 0) + 1;
  assert.ok(Object.values(porCriterio).every((n) => n === 3));
  // sin ninguna clasificación real → _sinClasificar (quedó en defaults, no en datos reales);
  // el resto clasificó normal y no lleva la marca
  assert.equal(mapa.get('ausente')._sinClasificar, true);
  assert.equal(mapa.get('ausente').ingles, 'ambiguo');
  assert.equal(mapa.get('nula')._sinClasificar, true);
  assert.equal(mapa.get('id-0')._sinClasificar, undefined);
  assert.equal(mapa.get('id-0').ingles, 'requerido');
});

test('patrón salario: decimal opcional y Q antes O después ("Q4,500 al mes" matchea)', () => {
  const campo = CAMPOS_EXTRACT.find((c) => c.id === 'salario');
  assert.ok(campo.pattern.length <= 500);
  const re = new RegExp(campo.pattern, campo.flags); // compila
  const m = re.exec('Salario: Q4,500 al mes');
  assert.ok(m, '"Q4,500 al mes" debe matchear');
  assert.equal(m[0], 'Q4,500');
  assert.equal(m[1], 'Q4,500'); // grupo 1 = match completo → valor verbatim estable
  assert.equal(new RegExp(campo.pattern, campo.flags).exec('Salario: 4,500 quetzales al mes')[0], '4,500 quetzales'); // Q después
  assert.equal(new RegExp(campo.pattern, campo.flags).exec('Salario: Q4,500.50 al mes')[0], 'Q4,500.50'); // decimal opcional
  assert.equal(re.exec('2 años de experiencia, 8 horas'), null); // sin Q/quetzales no es dinero
});

test('extraerCampos devuelve Q4,500 (stub que emula el match del patrón real)', async () => {
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_extract');
      return { results: args.fields.map((f) => {
        const m = new RegExp(f.pattern, f.flags).exec(args.document);
        return m ? { id: f.id, value: m[1] ?? m[0], status: 'auto' } : { id: f.id, value: null, status: 'not_found' };
      }) };
    },
  };
  const r = await extraerCampos(jevFake, { descripcion: 'Salario: Q4,500 al mes', requerimientos: [] });
  assert.equal(r.salarioTexto, 'Q4,500');
  assert.equal(r.periodoSalario, 'al mes');
  assert.equal(r.estudiosTexto, null);
});

test('juzgarOferta prefiere la ubicación del DETALLE sobre el rating colado en la card (defensa en profundidad)', async () => {
  const jevFake = {
    call: async (herr, args) => {
      if (herr === 'jev_screen') return { probabilities: { injection: 0.01, substance: 0.5, relevance: 0.5 } };
      if (herr === 'jev_extract') {
        return { results: args.fields.map((f) => ({ id: f.id, value: null, status: 'not_found' })) };
      }
      throw new Error('herramienta inesperada ' + herr);
    },
  };
  // card con el bug del parser: ubicacion = '4.4' (rating de evaluación de empresa)
  const card = { id: 'X', titulo: 'Ejecutivo de Ventas', empresa: 'Identity', ubicacion: '4.4' };
  const detalle = {
    salarioTag: 'Q6,000 mensual',
    ubicacion: 'Guatemala Ciudad, Guatemala', // del bloque "empresa - ubicacion" junto al h1
    descripcion: 'Ventas de productos financieros, lunes a viernes.',
    requerimientos: ['Educación mínima: Bachillerato'],
  };
  const r = await juzgarOferta(jevFake, {
    card,
    detalle,
    flags: { ...base, modalidad: 'presencial' },
    config,
  });
  assert.equal(r.veredicto, 'APTO'); // NO falso descarte por 'ubicacion'
  assert.ok(!r.motivos.includes('ubicacion'));

  // contraste (sensibilidad del test): sin la ubicación del detalle, el rating de
  // la card SÍ produciría el falso descarte del bug original.
  const sinDetalle = await juzgarOferta(jevFake, {
    card,
    detalle: { ...detalle, ubicacion: '' },
    flags: { ...base, modalidad: 'presencial' },
    config,
  });
  assert.equal(sinDetalle.veredicto, 'DESCARTADO');
  assert.ok(sinDetalle.motivos.includes('ubicacion'));
});
