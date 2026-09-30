/** MVP accepts Thai mobile numbers (0xxxxxxxxx) or 13 digit national IDs. */
export function isValidPromptPay(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "");
  if (/^0[689]\d{8}$/.test(compact)) return true;
  if (!/^\d{13}$/.test(compact)) return false;

  const weightedSum = [...compact.slice(0, 12)].reduce(
    (sum, digit, index) => sum + Number(digit) * (13 - index),
    0,
  );
  const checkDigit = (11 - (weightedSum % 11)) % 10;
  return checkDigit === Number(compact[12]);
}
