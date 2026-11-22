import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';
import { useMoney } from './ui';

/** Legend for the two-series charts. Always shown so identity is never colour-alone. */
export function ForecastActualLegend() {
  const theme = useTheme();
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendBar, { backgroundColor: theme.forecast }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Forecast
        </ThemedText>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendBar, { backgroundColor: theme.actual }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Actual
        </ThemedText>
      </View>
    </View>
  );
}

export type PairRow = { key: string; label: string; forecast: number; actual: number; swatch?: string };

/**
 * Forecast vs actual as paired horizontal bars, one row per category (or type).
 * Each row is labelled with its name and both numbers, so the chart reads as a table too.
 */
export function PairedBars({ rows, onPressRow }: { rows: PairRow[]; onPressRow?: (key: string) => void }) {
  const theme = useTheme();
  const money = useMoney();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.forecast, r.actual)));
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <View style={{ gap: Spacing.three }}>
      <ForecastActualLegend />
      {rows.map((r) => {
        const over = r.actual > r.forecast && r.forecast > 0;
        const diff = r.actual - r.forecast;
        const on = selected === r.key;
        return (
          <Pressable
            key={r.key}
            onPress={() => (onPressRow ? onPressRow(r.key) : setSelected(on ? null : r.key))}
            accessibilityLabel={`${r.label}: forecast ${money(r.forecast)}, actual ${money(r.actual)}`}
            style={{ gap: 4 }}>
            <View style={styles.rowHead}>
              {r.swatch ? <View style={[styles.swatch, { backgroundColor: r.swatch }]} /> : null}
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {r.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {money(r.actual)} of {money(r.forecast)}
              </ThemedText>
            </View>
            <Bar value={r.forecast} max={max} color={theme.forecast} track={theme.grid} />
            <Bar value={Math.max(0, r.actual)} max={max} color={theme.actual} track={theme.grid} />
            {over ? (
              <ThemedText type="small" style={{ color: theme.critical }}>
                ▲ {money(diff)} over forecast
              </ThemedText>
            ) : on ? (
              <ThemedText type="small" themeColor="textSecondary">
                {diff <= 0 ? `${money(-diff)} left` : `${money(diff)} spent with nothing forecast`}
              </ThemedText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Bar({ value, max, color, track }: { value: number; max: number; color: string; track: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <View style={[styles.track, { backgroundColor: track }]}>
      {pct > 0 ? <View style={[styles.fill, { width: `${Math.max(pct, 1)}%`, backgroundColor: color }]} /> : null}
    </View>
  );
}

export type ShareSlice = { key: string; label: string; value: number; color: string };

/** Share of spending as one segmented bar plus a labelled legend with amounts and percentages. */
export function ShareBar({ slices, emptyText }: { slices: ShareSlice[]; emptyText: string }) {
  const theme = useTheme();
  const money = useMoney();
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {emptyText}
      </ThemedText>
    );
  }
  return (
    <View style={{ gap: Spacing.three }}>
      <View style={[styles.shareBar, { backgroundColor: theme.surface }]}>
        {positive.map((s) => (
          <View key={s.key} style={{ flex: s.value, backgroundColor: s.color, borderRadius: 4 }} />
        ))}
      </View>
      <View style={{ gap: Spacing.two }}>
        {positive
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((s) => (
            <View key={s.key} style={styles.rowHead}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <ThemedText type="small" style={{ flex: 1 }}>
                {s.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {money(s.value)} · {Math.round((s.value / total) * 100)}%
              </ThemedText>
            </View>
          ))}
      </View>
    </View>
  );
}

export type TrendPoint = { key: string; label: string; forecast: number; actual: number };

/** Forecast (dashed) vs actual (solid) over the last months. Tap a month to read its values. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const theme = useTheme();
  const money = useMoney();
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<number>(points.length - 1);
  const height = 200;
  const pad = { top: 12, right: 12, bottom: 24, left: 12 };
  const max = niceMax(Math.max(1, ...points.flatMap((p) => [p.forecast, p.actual])));
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (Math.max(0, v) / max) * innerH;
  const path = (k: 'forecast' | 'actual') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ');
  const current = points[sel];

  return (
    <View style={{ gap: Spacing.two }}>
      <ForecastActualLegend />
      {current ? (
        <ThemedText type="small" themeColor="textSecondary">
          <ThemedText type="smallBold">{current.label}</ThemedText> · actual {money(current.actual)} · forecast{' '}
          {money(current.forecast)}
        </ThemedText>
      ) : null}
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[0, 0.5, 1].map((f) => (
              <Line key={f} x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke={theme.grid} strokeWidth={1} />
            ))}
            <SvgText x={width - pad.right} y={y(max) - 2} fontSize={11} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill={theme.textSecondary} textAnchor="end">
              {money(max)}
            </SvgText>
            {current ? <Line x1={x(sel)} x2={x(sel)} y1={pad.top} y2={pad.top + innerH} stroke={theme.border} strokeWidth={1} /> : null}
            <Path d={path('forecast')} stroke={theme.forecast} strokeWidth={2} strokeDasharray="6 4" fill="none" />
            <Path d={path('actual')} stroke={theme.actual} strokeWidth={2} fill="none" />
            {points.map((p, i) => (
              <Circle key={`f${p.key}`} cx={x(i)} cy={y(p.forecast)} r={4} fill={theme.forecast} stroke={theme.surface} strokeWidth={2} />
            ))}
            {points.map((p, i) => (
              <Circle key={`a${p.key}`} cx={x(i)} cy={y(p.actual)} r={i === sel ? 6 : 4} fill={theme.actual} stroke={theme.surface} strokeWidth={2} />
            ))}
            {points.map((p, i) => (
              <SvgText
                key={`l${p.key}`}
                x={x(i)}
                y={height - 6}
                fontSize={11} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
                fill={i === sel ? theme.text : theme.textSecondary}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
                {p.label}
              </SvgText>
            ))}
            {/* generous invisible hit areas, one per month */}
            {points.map((p, i) => (
              <Rect
                key={`h${p.key}`}
                x={x(i) - innerW / Math.max(1, points.length - 1) / 2}
                y={0}
                width={innerW / Math.max(1, points.length - 1)}
                height={height}
                fill="transparent"
                onPress={() => setSel(i)}
              />
            ))}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

function niceMax(v: number) {
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => n <= x) ?? 10;
  return step * mag;
}

export type DonutSlice = { key: string; label: string; value: number; color: string };

function arc(cx: number, cy: number, r: number, inner: number, a0: number, a1: number) {
  const pt = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  const [x2, y2] = pt(inner, a1);
  const [x3, y3] = pt(inner, a0);
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
}

/**
 * Pie (donut) chart with a tappable legend. Tapping a slice or its legend row selects it;
 * the selected slice is pulled out slightly and the others fade, and the centre shows its amount.
 */
export function Donut({
  slices,
  selected,
  onSelect,
  emptyText,
}: {
  slices: DonutSlice[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  emptyText: string;
}) {
  const theme = useTheme();
  const money = useMoney();
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {emptyText}
      </ThemedText>
    );
  }
  const size = 240;
  const c = size / 2;
  const r = 104;
  const inner = 62;
  const gap = positive.length > 1 ? 0.012 : 0;
  const ends = positive.reduce<number[]>((acc, s) => [...acc, (acc.at(-1) ?? 0) + (s.value / total) * Math.PI * 2], []);
  const sel = positive.find((s) => s.key === selected);
  return (
    <View style={{ gap: Spacing.three }}>
      <View style={{ alignItems: 'center' }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {positive.map((s, i) => {
            const a0 = i ? ends[i - 1] : 0;
            const a1 = ends[i];
            const on = s.key === selected;
            const mid = (a0 + a1) / 2;
            const push = on && positive.length > 1 ? 6 : 0;
            const press = () => onSelect(on ? null : s.key);
            return (
              <G key={s.key} transform={`translate(${push * Math.sin(mid)} ${-push * Math.cos(mid)})`}>
                {positive.length === 1 ? (
                  <Path
                    d={`${arc(c, c, r, inner, 0, Math.PI)} ${arc(c, c, r, inner, Math.PI, Math.PI * 2)}`}
                    fill={s.color}
                    onPress={press}
                  />
                ) : (
                  <Path
                    d={arc(c, c, r, inner, a0 + gap, a1 - gap)}
                    fill={s.color}
                    opacity={selected && !on ? 0.35 : 1}
                    onPress={press}
                  />
                )}
              </G>
            );
          })}
          <SvgText x={c} y={c - 4} fontSize={13} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill={theme.textSecondary} textAnchor="middle">
            {sel ? sel.label : 'Total'}
          </SvgText>
          <SvgText x={c} y={c + 18} fontSize={20} fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fontWeight="700" fill={theme.text} textAnchor="middle">
            {money(sel ? sel.value : total)}
          </SvgText>
        </Svg>
      </View>
      <View style={{ gap: 2 }}>
        {positive.map((s) => {
          const on = s.key === selected;
          return (
            <Pressable
              key={s.key}
              onPress={() => onSelect(on ? null : s.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${s.label}: ${money(s.value)}, ${Math.round((s.value / total) * 100)} percent`}
              style={[styles.rowHead, styles.legendRow, { backgroundColor: on ? theme.backgroundSelected : 'transparent' }]}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <ThemedText type={on ? 'smallBold' : 'small'} style={{ flex: 1 }}>
                {s.label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {money(s.value)} · {Math.round((s.value / total) * 100)}%
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A headline number with an optional comparison line. */
export function StatTile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'critical' | 'good' }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={{ fontSize: 26, lineHeight: 32, fontWeight: '700' }}>{value}</ThemedText>
      {note ? (
        <ThemedText type="small" style={{ color: tone ? theme[tone] : theme.textSecondary }}>
          {note}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendBar: { width: 16, height: 8, borderRadius: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  legendRow: { paddingVertical: 8, paddingHorizontal: Spacing.two, borderRadius: 8 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  track: { height: 10, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  shareBar: { flexDirection: 'row', height: 18, gap: 2, borderRadius: 4, overflow: 'hidden' },
  tile: { flex: 1, minWidth: 150, borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: 2 },
});
