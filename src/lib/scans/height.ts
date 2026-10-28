// Height unit conversion for the HOWBODY scan login.
// The scanner always receives centimetres; feet/inches is a display/input convenience only.

export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

export interface FeetInches {
  feet: number;
  inches: number;
}

/** Converts feet + inches to centimetres, rounded to one decimal. */
export function feetInchesToCm(feet: number, inches: number): number {
  const totalInches = feet * INCHES_PER_FOOT + inches;
  return Math.round(totalInches * CM_PER_INCH * 10) / 10;
}

/** Converts centimetres to whole feet + whole inches (inches rolls over to the next foot at 12). */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function isValidHeightCm(cm: number): boolean {
  return Number.isFinite(cm) && cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM;
}

export function formatFeetInches(cm: number): string {
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet} ft ${inches} in`;
}
