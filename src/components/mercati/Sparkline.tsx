/**
 * Mini-chart SVG inline per la colonna "andamento" della tabella Mercati.
 *
 * Disegna una polyline normalizzata dei prezzi degli ultimi N giorni.
 * Colore: verde se l'ultimo prezzo > primo, rosso altrimenti, grigio se piatto.
 *
 * Volutamente SENZA librerie esterne (recharts, chart.js, ecc.): è un componente
 * minimale che deve renderizzare 30+ volte per pagina, ed è solo SVG statico.
 * Niente tooltip, niente assi — è una sparkline, deve solo dare un'idea della direzione.
 */

export type SparkPoint = { date: string | Date; close: number };

export function Sparkline({
  points,
  width = 120,
  height = 32,
  strokeWidth = 1.5,
  className,
}: {
  points: SparkPoint[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (!points || points.length < 2) {
    return (
      <span
        className={`inline-block text-[10px] text-sub ${className ?? ""}`}
        style={{ width, height, lineHeight: `${height}px`, textAlign: "center" }}
      >
        —
      </span>
    );
  }

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1; // evita divisione per zero su serie piatte

  // Normalizza ciascun punto a coordinate viewBox 0..width × 0..height.
  // Padding verticale di 2px così la linea non viene tagliata a bordo.
  const padY = 2;
  const usableH = height - padY * 2;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = padY + usableH - ((p.close - min) / range) * usableH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const first = closes[0];
  const last = closes[closes.length - 1];
  // Colori coerenti con la palette dell'app (ok = verde, err = rosso, sub = grigio).
  // Usiamo i CSS custom var del tema così se cambi tema cambiano anche le sparkline.
  let color = "var(--color-sub, #6b7280)";
  if (last > first) color = "var(--color-ok-600, #15803d)";
  else if (last < first) color = "var(--color-err-600, #dc2626)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Andamento ${points.length} punti, da ${first.toFixed(2)} a ${last.toFixed(2)}`}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
