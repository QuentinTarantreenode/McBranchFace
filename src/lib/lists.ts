/** The list with `value` taken out when it is in, added at the end when it is not: a chip, a filter, a pick. */
export const toggled = <T>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
