export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

export function power(base: number, exponent: number): number {
  return Math.pow(base, exponent);
}

export function matrixDeterminant2x2(matrix: number[][]): number {
  return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
}
