export function frameChangePercent(before, after) {
  if (!before || !after || before.length !== after.length || before.length === 0) return undefined;
  let changed = 0;
  for (let index = 0; index < before.length; index += 3) {
    const red = Math.abs(before[index] - after[index]);
    const green = Math.abs(before[index + 1] - after[index + 1]);
    const blue = Math.abs(before[index + 2] - after[index + 2]);
    if (Math.max(red, green, blue) >= 20) changed++;
  }
  return Math.round(100 * changed / (before.length / 3));
}

export function actionFeedback(changePercent) {
  if (changePercent === undefined) return '';
  return `After the previous action, ${changePercent}% of sampled image regions changed visibly. Check the frame for actual progress before repeating the action.`;
}
