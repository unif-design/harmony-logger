export function hasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}
