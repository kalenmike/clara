const build = import.meta.env.CLARA_BUILD
const builtAt = new Date(build.builtAt)
const pad = (value: number) => String(value).padStart(2, '0')

/** Lab version with the build commit, e.g. `0.1.0-dev+abc1234`. */
export const labDisplayVersion = import.meta.env.CLARA_VERSION

/** Compact stamp shown in the status-bar tooltip. */
const labBuildLabel = `${build.mode} ${pad(builtAt.getMonth() + 1)}-${pad(builtAt.getDate())} ${pad(builtAt.getHours())}:${pad(builtAt.getMinutes())}`

export const labBuildTitle = [
  build.mode === 'dev' ? 'Lab dev server' : 'Lab build',
  build.commit
    ? `commit ${build.commit}${build.dirty ? ' with uncommitted changes' : ''}`
    : 'no git commit',
  `${build.mode === 'dev' ? 'started' : 'built'} ${builtAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`,
  labBuildLabel,
].join(' · ')
