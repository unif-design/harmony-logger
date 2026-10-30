export default function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total: number, item: T): number => total + select(item), 0);
}
