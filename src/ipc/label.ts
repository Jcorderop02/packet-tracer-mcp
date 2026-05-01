/**
 * Helpers para anotar generadores IPC con una etiqueta humana legible. El
 * bridge extrae el comentario de bloque inicial antes de pasar el código a
 * `__mcpEval`; la UI de la extensión lo muestra como cuerpo principal del
 * log y deja el JS bruto bajo un <details> plegable. El Script Engine de PT
 * ignora el comentario por completo.
 *
 * Convención editorial — para que el log se lea como una receta:
 *   - Verbo en gerundio al principio: "Creando ...", "Leyendo ...".
 *   - Nombre(s) del recurso afectado tras el verbo.
 *   - Detalle entre paréntesis cuando aporta valor (modelo, IP, formato).
 *   - Flechas Unicode "→" para flujos direccionales y "↔" para enlaces.
 *   - Sin punto final.
 *
 * Tildes y ñ están permitidas (la UI es UTF-8). Mantener corto: el panel
 * tiene poco ancho y un detalle muy largo dispersa la atención. Para
 * incrustar texto de longitud arbitraria (CLI, JS de pt_send_raw, notas
 * de canvas) usar `truncateForLabel`, que recorta limpiamente en el
 * último espacio antes del límite.
 */
export function withLabel(label: string, js: string): string {
  return `/* ${label} */ ${js}`;
}

/**
 * Aplana whitespace y trunca a `max` caracteres. Si el corte cae a mitad
 * de una palabra y hay un espacio razonablemente cerca, retrocede hasta
 * ese espacio para no dejar tokens cortados feos en la UI. La elipsis
 * Unicode "…" ahorra dos caracteres frente a "...".
 */
export function truncateForLabel(s: string, max = 60): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max - 1);
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace >= max - 15) return head.slice(0, lastSpace) + "…";
  return head + "…";
}
