/**
 * Gold lead over time, esports-broadcast style: teal area while my team leads, red while behind,
 * with the live value as a glowing dot at the end of the line.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, fonts } from '@/ui/theme';
import { formatGold, formatGameTime } from './util';

export function GoldGraph({ history, current, gameTime, height = 132 }: { history: [number, number][]; current: number; gameTime: number; height?: number }) {
  const [width, setWidth] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const points: [number, number][] = [...history.filter(([t]) => t < gameTime), [gameTime, current]];
  if (points.length < 2) points.unshift([0, 0]);
  const tMax = Math.max(60, points[points.length - 1]![0]);
  // Symmetric scale around 0, at least ±1.5k so early games don't look dramatic.
  const gMax = Math.max(1500, ...points.map(([, g]) => Math.abs(g))) * 1.15;
  const pad = 6;
  const x = (t: number) => pad + (t / tMax) * (width - pad * 2);
  const y = (g: number) => height / 2 - (g / gMax) * (height / 2 - pad);
  const zero = y(0);

  // Split the line where it crosses zero, so the ahead (teal) and behind (red) parts can be drawn
  // as separate shapes: no clipping needed (clip paths are unreliable across platforms).
  const split: [number, number][] = [];
  points.forEach(([t, g], i) => {
    const prev = points[i - 1];
    if (prev && Math.sign(prev[1]) * Math.sign(g) < 0) {
      const tz = prev[0] + ((t - prev[0]) * prev[1]) / (prev[1] - g);
      split.push([tz, 0]);
    }
    split.push([t, g]);
  });
  const pts = (clamp: (g: number) => number) => split.map(([t, g]) => `${x(t).toFixed(1)},${y(clamp(g)).toFixed(1)}`).join(' L');
  const areaOf = (clamp: (g: number) => number) =>
    `M${x(split[0]![0]).toFixed(1)},${zero} L${pts(clamp)} L${x(split[split.length - 1]![0]).toFixed(1)},${zero} Z`;
  const aheadArea = areaOf((g) => Math.max(g, 0));
  const behindArea = areaOf((g) => Math.min(g, 0));
  // Line segments, each colored by its side of zero.
  const segments = split.slice(1).map(([t, g], i) => {
    const [t0, g0] = split[i]!;
    return { d: `M${x(t0).toFixed(1)},${y(g0).toFixed(1)} L${x(t).toFixed(1)},${y(g).toFixed(1)}`, ahead: g0 + g >= 0 };
  });
  const [lastT, lastG] = points[points.length - 1]!;
  const lead = current >= 0;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="ahead" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.teal} stopOpacity="0.55" />
                <Stop offset="1" stopColor={colors.teal} stopOpacity="0.02" />
              </LinearGradient>
              <LinearGradient id="behind" x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={colors.danger} stopOpacity="0.55" />
                <Stop offset="1" stopColor={colors.danger} stopOpacity="0.02" />
              </LinearGradient>
            </Defs>
            <Line x1={0} x2={width} y1={zero} y2={zero} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 6" />
            <Path d={aheadArea} fill="url(#ahead)" />
            <Path d={behindArea} fill="url(#behind)" />
            {segments.map((seg, i) => (
              <Path key={i} d={seg.d} fill="none" stroke={seg.ahead ? colors.tealLight : '#FF8A9A'} strokeWidth={2.2} strokeLinecap="round" />
            ))}
            <Circle cx={x(lastT)} cy={y(lastG)} r={4.5} fill={lead ? colors.tealLight : '#FF8A9A'} />
          </Svg>
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: x(lastT) - 10,
              top: y(lastG) - 10,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: lead ? colors.teal : colors.danger,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
            }}
          />
          <Text style={{ position: 'absolute', left: 4, bottom: -2, fontFamily: fonts.medium, fontSize: 11, color: colors.faint }}>0:00</Text>
          <Text style={{ position: 'absolute', right: 4, bottom: -2, fontFamily: fonts.medium, fontSize: 11, color: colors.faint }}>{formatGameTime(lastT)}</Text>
          <Text style={{ position: 'absolute', right: 4, top: 0, fontFamily: fonts.medium, fontSize: 11, color: colors.faint }}>+{formatGold(gMax / 1.15)}</Text>
        </>
      ) : null}
    </View>
  );
}
