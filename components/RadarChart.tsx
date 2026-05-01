'use client';

interface RadarItem {
  label: string;
  value: number; // 0 to 1
}

export default function RadarChart({ items, color = '#10b981', size = 180 }: {
  items: RadarItem[];
  color?: string;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.34;
  const n  = items.length;

  function pt(i: number, v: number) {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    return {
      x: cx + r * v * Math.cos(angle),
      y: cy + r * v * Math.sin(angle),
    };
  }

  function polyPath(vals: number[]) {
    return vals.map((v, i) => {
      const p = pt(i, v);
      return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }).join(' ') + ' Z';
  }

  const levels  = [0.25, 0.5, 0.75, 1];
  const dataPts = items.map((it, i) => pt(i, it.value));
  const dataPath = polyPath(items.map(it => it.value));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {levels.map(lv => (
        <path key={lv} d={polyPath(items.map(() => lv))}
          fill="none" stroke="#3f3f46"
          strokeWidth="0.5"
          strokeDasharray={lv < 1 ? '2,3' : undefined} />
      ))}
      {/* Axis lines */}
      {items.map((_, i) => {
        const end = pt(i, 1);
        return <line key={i} x1={cx.toFixed(1)} y1={cy.toFixed(1)} x2={end.x.toFixed(1)} y2={end.y.toFixed(1)} stroke="#3f3f46" strokeWidth="0.5" />;
      })}
      {/* Data area */}
      <path d={dataPath} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Data dots */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="2.5" fill={color} />
      ))}
      {/* Labels */}
      {items.map((it, i) => {
        const lp = pt(i, 1.35);
        return (
          <text key={i}
            x={lp.x.toFixed(1)} y={lp.y.toFixed(1)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="8" fill="#71717a" fontFamily="monospace">
            {it.label}
          </text>
        );
      })}
    </svg>
  );
}

