export const releaseRepoId = 1010982060
const organizationId = 273012487
const repositoryName = 'judicial-mcp'

function record(
  value: unknown,
  error = 'GitHub release repository identity mismatch',
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(error)
  return value as Record<string, unknown>
}

export function parseReleaseRepository(value: unknown) {
  const repo = record(value)
  const owner = record(repo.owner)
  if (
    repo.id !== releaseRepoId ||
    owner.id !== organizationId ||
    owner.type !== 'Organization' ||
    typeof owner.login !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(owner.login) ||
    repo.name !== repositoryName ||
    repo.full_name !== `${owner.login}/${repositoryName}` ||
    repo.default_branch !== 'main' ||
    repo.fork !== false
  )
    throw new Error('GitHub release repository identity mismatch')
  return { owner: owner.login, fullName: repo.full_name as string }
}

export function parseMainCommitSha(value: unknown): string {
  const error = 'Invalid GitHub main ref'
  const ref = record(value, error)
  const object = record(ref.object, error)
  if (
    ref.ref !== 'refs/heads/main' ||
    object.type !== 'commit' ||
    typeof object.sha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(object.sha)
  ) {
    throw new Error(error)
  }
  return object.sha
}
