import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

import { useMoney } from './ui';

export type SankeyNode = { id: string; column: number; value: number; label: string; color: string };
export type SankeyLink = { source: string; target: string; value: number };

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const NODE_W = 12;
const PAD = 14;
const MIN_H = 3;

/**
 * Left-to-right flow chart. Node heights are proportional to money; each band is a link.
 * Tapping a node selects it: its links stay strong and the rest fade.
 * Wider than a phone, so it scrolls sideways on small screens.
 */
export function Sankey({
  nodes,
  links,
  selected,
  onSelect,
}: {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** One node, or several shown together (an income tag split into its sub-tags). */
  selected: string | string[] | null;
  onSelect: (id: string | null) => void;
}) {
  const picked = new Set(selected === null ? [] : Array.isArray(selected) ? selected : [selected]);
  // Tapping the one selected block again clears it; a group (a split tag or category) is tapped into instead.
  const only = typeof selected === 'string' ? selected : null;
  const theme = useTheme();
  const money = useMoney();
  const [box, setBox] = useState(0);

  const columns = Math.max(...nodes.map((n) => n.column)) + 1;
  const perCol = Array.from({ length: columns }, (_, c) => nodes.filter((n) => n.column === c));
  const busiest = Math.max(...perCol.map((c) => c.length));
  const width = Math.max(box, 320);
  const height = Math.max(340, busiest * 48);
  // Room above for the month label.
  const top = 24;
  const usable = height - top - 8;
  // One scale for every column, so equal money is equal height everywhere.
  const k = Math.min(...perCol.map((col) => (usable - PAD * (col.length - 1)) / Math.max(1, col.reduce((s, n) => s + n.value, 0))));

  // Columns spread evenly across the width. Labels each get their own gap:
  // the first column labels to its right, the middle (month) above, the rest to their left.
  const xOf = (c: number) => 1 + (c * (width - NODE_W - 2)) / (columns - 1);

  type Laid = SankeyNode & { x: number; y: number; h: number; outY: number; inY: number };
  const laid = new Map<string, Laid>();
  for (const col of perCol) {
    const colH = col.reduce((s, n) => s + Math.max(MIN_H, n.value * k), 0) + PAD * (col.length - 1);
    let y = top + (usable - colH) / 2;
    for (const n of col) {
      const h = Math.max(MIN_H, n.value * k);
      laid.set(n.id, { ...n, x: xOf(n.column), y, h, outY: y, inY: y });
      y += h + PAD;
    }
  }

  const order = (id: string) => nodes.findIndex((n) => n.id === id);
  const bands = links
    .slice()
    .sort((a, b) => order(a.source) - order(b.source) || order(a.target) - order(b.target))
    .map((l) => ({ ...l, w: Math.max(1, l.value * k) }));
  // Outgoing offsets follow target order; incoming offsets follow source order.
  for (const b of bands.slice().sort((a, c) => order(a.target) - order(c.target))) {
    const s = laid.get(b.source)!;
    (b as typeof b & { y0: number }).y0 = s.outY;
    s.outY += b.w;
  }
  for (const b of bands) {
    const t = laid.get(b.target)!;
    (b as typeof b & { y1: number }).y1 = t.inY;
    t.inY += b.w;
  }

  const related = (l: SankeyLink) => !picked.size || picked.has(l.source) || picked.has(l.target);
  const nodeOn = (id: string) =>
    !picked.size || picked.has(id) || links.some((l) => (picked.has(l.source) && l.target === id) || (picked.has(l.target) && l.source === id));

  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      <ScrollView horizontal scrollEnabled={width > box} showsHorizontalScrollIndicator={width > box}>
        <Svg width={width} height={height}>
          {bands.map((b) => {
            const s = laid.get(b.source)!;
            const t = laid.get(b.target)!;
            const y0 = (b as unknown as { y0: number }).y0 + b.w / 2;
            const y1 = (b as unknown as { y1: number }).y1 + b.w / 2;
            const x0 = s.x + NODE_W;
            const x1 = t.x;
            const mx = (x0 + x1) / 2;
            // Bands take the colour of whichever end is more specific: categories and types over the month total.
            const color = s.column === 1 ? t.color : s.color;
            return (
              <Path
                key={`${b.source}>${b.target}`}
                d={`M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`}
                stroke={color}
                strokeWidth={b.w}
                strokeOpacity={related(b) ? 0.45 : 0.1}
                fill="none"
                onPress={() => onSelect(only === b.target ? null : b.target)}
              />
            );
          })}
          {[...laid.values()].map((n) => {
            const above = n.column === 1 && columns > 2;
            const right = n.column === 0;
            const lx = above ? n.x + NODE_W / 2 : right ? n.x + NODE_W + 5 : n.x - 5;
            const anchor = above ? 'middle' : right ? 'start' : 'end';
            const cy = above ? n.y - 10 : n.y + n.h / 2;
            const on = nodeOn(n.id);
            const press = () => onSelect(only === n.id ? null : n.id);
            const two = !above && n.h >= 26;
            return (
              <G key={n.id} opacity={on ? 1 : 0.35}>
                <Rect x={n.x} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} onPress={press} />
                {[true, false].map((halo) => (
                  <G key={String(halo)}>
                    <SvgText
                      x={lx}
                      y={two ? cy - 3 : cy + 4}
                      fontSize={11.5}
                      fontWeight={picked.has(n.id) ? '700' : '600'}
                      fontFamily={FONT}
                      textAnchor={anchor}
                      fill={halo ? theme.surface : theme.text}
                      stroke={halo ? theme.surface : undefined}
                      strokeWidth={halo ? 4 : 0}
                      onPress={press}>
                      {two ? n.label : `${n.label} · ${money(n.value)}`}
                    </SvgText>
                    {two ? (
                      <SvgText
                        x={lx}
                        y={cy + 12}
                        fontSize={11}
                        fontFamily={FONT}
                        textAnchor={anchor}
                        fill={halo ? theme.surface : theme.textSecondary}
                        stroke={halo ? theme.surface : undefined}
                        strokeWidth={halo ? 4 : 0}
                        onPress={press}>
                        {money(n.value)}
                      </SvgText>
                    ) : null}
                  </G>
                ))}
              </G>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}
