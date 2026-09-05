// Save schema and simulation rules are different versions. An unversioned log
// belongs to the original rules forever; future rules must never reinterpret it.
export const RULES_VERSION = 2
export const CONTENT_VERSION = 1
export interface RulesIdentity { rulesVersion?: number; contentVersion?: number }
export function rulesOf(identity: RulesIdentity): number {
  const rules = identity.rulesVersion ?? 1
  if (!Number.isInteger(rules) || rules < 1 || rules > RULES_VERSION ||
      (identity.contentVersion ?? 1) !== CONTENT_VERSION) {
    throw new Error('This career uses an unsupported rules or content version. Keep its export and open it with a compatible release.')
  }
  return rules
}
export function identityOf(identity: RulesIdentity): Required<RulesIdentity> {
  return { rulesVersion: rulesOf(identity), contentVersion: identity.contentVersion ?? 1 }
}
