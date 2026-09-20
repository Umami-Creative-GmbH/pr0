export const trigramQuery = (points: string[]) => {
  const grams = new Set<string>();
  for (let index = 0; index + 2 < points.length; index += 1) {
    grams.add(
      `"${points
        .slice(index, index + 3)
        .join("")
        .replaceAll('"', '""')}"`
    );
  }
  return [...grams].join(" AND ");
};
