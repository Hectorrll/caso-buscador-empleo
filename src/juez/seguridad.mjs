// src/juez/seguridad.mjs
export async function asegurarTexto(jev, texto, proposito) {
  const r = await jev.call('jev_screen', { text: texto, purpose: proposito });
  const crudo = r?.probabilities?.injection;
  // Fail-SAFE: sin probabilities.injection numérico finito → 0.25 ('revisar'), jamás 'pasar'.
  const injection = Number.isFinite(crudo) ? crudo : 0.25;
  const accion = injection >= 0.75 ? 'bloquear' : injection >= 0.25 ? 'revisar' : 'pasar';
  return { accion, injection };
}
