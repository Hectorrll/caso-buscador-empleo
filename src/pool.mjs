// src/pool.mjs
// Concurrencia acotada sobre async fn: corre fn(item) con a lo sumo `limite`
// tareas en vuelo y devuelve los resultados EN EL ORDEN DEL INPUT, aunque se
// completen desordenados. Single thread: el índice compartido es seguro —
// cada trabajador toma su item de forma atómica entre awaits.
export async function pool(items, limite, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(Math.trunc(limite) || 1, items.length));
  // allSettled: si una tarea falla, el resto drena la cola (y sus rechazos no
  // quedan sin manejar); se relanza el primer error al final.
  const res = await Promise.allSettled(Array.from({ length: n }, trabajador));
  const fallo = res.find((r) => r.status === 'rejected');
  if (fallo) throw fallo.reason;
  return resultados;
}
