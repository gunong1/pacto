import { View, type ViewStyle } from 'react-native';
import Svg, { Ellipse, Path } from 'react-native-svg';

import { BRAND_COLORS, SYMBOL, SYMBOL_COLORS, WORDMARK } from './geometry';

type SymbolVariant = keyof typeof SYMBOL_COLORS;

/** 브랜드 심볼 (겹친 카드 3장). size = 높이 */
export function BrandSymbol({ size = 32, variant = 'color' }: { size?: number; variant?: SymbolVariant }) {
  const c = SYMBOL_COLORS[variant];
  const width = (size * SYMBOL.width) / SYMBOL.height;
  return (
    <Svg width={width} height={size} viewBox={SYMBOL.viewBox} accessibilityLabel="PACTO">
      <Path d={SYMBOL.back} fill={c.back} />
      <Path d={SYMBOL.middle} fill={c.middle} stroke={c.gap} strokeWidth={SYMBOL.middleGap * 2} strokeLinejoin="round" />
      <Path d={SYMBOL.middle} fill={c.middle} />
      <Path d={SYMBOL.front} fill={c.gap} stroke={c.gap} strokeWidth={SYMBOL.frontGap * 2} strokeLinejoin="round" />
      <Path d={SYMBOL.front} fill={c.front} />
    </Svg>
  );
}

/** 워드마크 "PACTO". height = 캡 높이 기준 높이 */
export function Wordmark({ height = 18, color = BRAND_COLORS.navy }: { height?: number; color?: string }) {
  const width = (height * WORDMARK.width) / WORDMARK.height;
  const stroke = { stroke: color, strokeWidth: WORDMARK.stroke, fill: 'none' } as const;
  return (
    <Svg width={width} height={height} viewBox={WORDMARK.viewBox} accessibilityLabel="PACTO">
      <Path d={WORDMARK.p} {...stroke} strokeLinejoin="miter" />
      <Path d={WORDMARK.a} fill={color} />
      <Path d={WORDMARK.c} {...stroke} />
      <Path d={WORDMARK.t} fill={color} />
      <Ellipse cx={WORDMARK.o.cx} cy={WORDMARK.o.cy} rx={WORDMARK.o.rx} ry={WORDMARK.o.ry} {...stroke} />
    </Svg>
  );
}

/** 가로형 로고 (심볼 + 워드마크). height = 심볼 높이 */
export function LogoHorizontal({ height = 32, mono, style }: { height?: number; mono?: boolean; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: height * 0.28 }, style]}>
      <BrandSymbol size={height} variant={mono ? 'mono' : 'color'} />
      <Wordmark height={height * 0.5} color={mono ? BRAND_COLORS.ink : BRAND_COLORS.navy} />
    </View>
  );
}

/** 앱 아이콘 형태 (네이비 라운드 사각형 + 흰 심볼) */
export function AppIconMark({ size = 56 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.23,
        backgroundColor: BRAND_COLORS.navyDeep,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <BrandSymbol size={size * 0.62} variant="inverse" />
    </View>
  );
}
