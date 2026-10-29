/** Normalize boolean-style answers without allowing "FALSE" to match the letter A. */
export function normalizeTrueFalseAnswer(answer: string): string {
  const value = answer.trim().toUpperCase().replace(/[\s.。]/g, '')
  const trueValues = new Set(['A', '√', 'TRUE', 'T', 'YES', 'Y', '1', '对', '是', '正确'])
  const falseValues = new Set(['B', '×', 'FALSE', 'F', 'NO', 'N', '0', '错', '否', '错误'])
  if (trueValues.has(value)) return 'TRUE'
  if (falseValues.has(value)) return 'FALSE'
  if (value.includes('错误') || value.includes('错') || value.includes('否')) return 'FALSE'
  if (value.includes('正确') || value.includes('对') || value.includes('是')) return 'TRUE'
  return value
}
