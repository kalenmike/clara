/** Compare two release versions. A release outranks its prerelease. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index]! - b.numbers[index]!
  }
  if (!a.prerelease && !b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumber = /^\d+$/.test(one)
    const twoNumber = /^\d+$/.test(two)
    if (oneNumber && twoNumber) {
      const difference = Number(one) - Number(two)
      if (difference !== 0) return difference
    } else if (oneNumber) return -1
    else if (twoNumber) return 1
    else if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

function parseVersion(value: string): { numbers: number[]; prerelease?: string[] } {
  const [core, ...rest] = value.split('-')
  const numbers = (core ?? '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const prerelease = rest.join('-')
  return { numbers, ...(prerelease ? { prerelease: prerelease.split('.') } : {}) }
}
