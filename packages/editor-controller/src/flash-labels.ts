const FLASH_HOME_BIAS_LETTERS = [..."fjdkslagheruiwovncmptyqbzx"];
const FLASH_ALL_LETTERS = [..."qwertyuiopasdfghjklzxcvbnm"];
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function keyboardPosition(letter: string): { row: number; col: number } | null {
  const normalized = letter.toLowerCase();

  for (let row = 0; row < KEYBOARD_ROWS.length; row += 1) {
    const col = KEYBOARD_ROWS[row]?.indexOf(normalized) ?? -1;
    if (col >= 0) {
      return { row, col };
    }
  }

  return null;
}

function keyboardDistance(target: string, candidate: string): number {
  const targetPosition = keyboardPosition(target);
  const candidatePosition = keyboardPosition(candidate);

  if (!targetPosition || !candidatePosition) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.abs(targetPosition.row - candidatePosition.row) + Math.abs(targetPosition.col - candidatePosition.col);
}

function flashAlphabet(target: string): string[] {
  const normalizedTarget = target.toLowerCase();
  const unique = new Set<string>([normalizedTarget, ...FLASH_ALL_LETTERS]);
  return [...unique].sort((left, right) => {
    if (left === normalizedTarget) {
      return -1;
    }

    if (right === normalizedTarget) {
      return 1;
    }

    const distanceDelta = keyboardDistance(normalizedTarget, left) - keyboardDistance(normalizedTarget, right);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return FLASH_HOME_BIAS_LETTERS.indexOf(left) - FLASH_HOME_BIAS_LETTERS.indexOf(right);
  });
}

export function buildFlashLabels(target: string, count: number): string[] {
  const alphabet = flashAlphabet(target);
  const labels: string[] = [];

  for (let index = 0; index < count; index += 1) {
    labels.push(alphabet[index % alphabet.length] ?? alphabet[0] ?? target.toLowerCase());
  }

  return labels;
}
