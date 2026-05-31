export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function rgbToHex(color: Pick<RgbaColor, 'r' | 'g' | 'b'>): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

export function hexToRgb(hex: string): RgbaColor {
  const clean = hex.replace('#', '');
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
    a: 255
  };
}

export function nearestHexColor(color: RgbaColor, palette: string[]): string {
  let best = palette[0] ?? '#000000';
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hex of palette) {
    const candidate = hexToRgb(hex);
    const distance =
      (color.r - candidate.r) ** 2 + (color.g - candidate.g) ** 2 + (color.b - candidate.b) ** 2;

    if (distance < bestDistance) {
      best = hex;
      bestDistance = distance;
    }
  }

  return best;
}

export function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function darkenHex(hex: string, amount = 0.55): string {
  const color = hexToRgb(hex);
  return rgbToHex({
    r: clampByte(color.r * amount),
    g: clampByte(color.g * amount),
    b: clampByte(color.b * amount)
  });
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0');
}

