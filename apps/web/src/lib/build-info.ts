const build = import.meta.env.CLARA_BUILD
const builtAt = new Date(build.builtAt)
const pad = (value: number) => String(value).padStart(2, '0')

export const claraVersion = import.meta.env.CLARA_VERSION

/** Stable identity for this build; the service worker reports the same value. */
export const claraBuildId = __CLARA_BUILD_ID__

/** When this bundle was built; also compiled into the service worker. */
export const claraBuiltAt = build.builtAt

/** Version with the build commit, e.g. `0.1.0.90d9f352`. */
export const claraDisplayVersion = build.commit ? `${claraVersion}.${build.commit}` : claraVersion

/** Compact stamp shown in Settings: dev-server start or build time. */
export const claraBuildLabel = `${build.mode} ${pad(builtAt.getMonth() + 1)}-${pad(builtAt.getDate())} ${pad(builtAt.getHours())}:${pad(builtAt.getMinutes())}`

export const claraBuildTitle = [
  build.mode === 'dev'
    ? 'Clara dev server'
    : build.surface === 'desktop'
      ? 'Clara desktop build'
      : 'Clara preview build',
  build.commit
    ? `commit ${build.commit}${build.dirty ? ' with uncommitted changes' : ''}`
    : 'no git commit',
  `${build.mode === 'dev' ? 'started' : 'built'} ${builtAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`,
].join(' · ')
