export function rollDiceFormula(formula, random = Math.random) {
  if (!formula) return null;
  const value = String(formula).trim();
  if (/^\d+$/u.test(value)) {
    const fixed = Number(value);
    if (Number.isSafeInteger(fixed)) return fixed;
  }
  const match = value.match(/^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (!match) throw new Error(`Invalid value formula: ${formula}`);
  const dice = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[4] ?? 0) * (match[3] === '-' ? -1 : 1);
  if (!Number.isInteger(dice) || dice < 1 || dice > 100 || !Number.isInteger(sides) || sides < 1 || sides > 10000)
    throw new Error(`Invalid value formula: ${formula}`);
  return Array.from({ length: dice }, () => 1 + Math.floor(random() * sides)).reduce((sum, value) => sum + value, modifier);
}
