// When a closed contract froze a directory, only checks still named by a
// standing claim remain frozen. Both hosts use this rule.
export function supersededClaims(contracts) {
  return new Set(contracts.flatMap((c) => (c.supersedes ?? []).map((s) => s.contract + '/' + s.claim)));
}

export function standingClaims(contract, target, frozen, replaced) {
  const namedFolder = (path) => {
    const escaped = path.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s"'=:(])${escaped}/?($|[\\s"')])`);
  };
  return (contract.claims ?? []).filter((claim) => {
    if (
      claim.status !== 'proven' ||
      !['flow', 'test'].includes(claim.shownBy?.kind) ||
      replaced.has(contract.id + '/' + claim.id)
    )
      return false;
    const ref = String(claim.shownBy.ref ?? '');
    return (
      ref.includes(target) || frozen.some((path) => path.replace(/\/$/, '') !== target && namedFolder(path).test(ref))
    );
  });
}
