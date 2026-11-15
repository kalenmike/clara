import { displayVersion } from './version.ts'

const build = import.meta.env.CLARA_BUILD
const builtAt = new Date(build.builtAt)
const pad = (value: number) => String(value).padStart(2, '0')

/** Panel version with the build commit, e.g. `0.1.0.c8becb85`. */
export const panelDisplayVersion = displayVersion(import.meta.env.CLARA_VERSION, build.commit)

/** Compact stamp shown in the status-bar tooltip. */
const panelBuildLabel = `${build.mode} ${pad(builtAt.getMonth() + 1)}-${pad(builtAt.getDate())} ${pad(builtAt.getHours())}:${pad(builtAt.getMinutes())}`

export const panelBuildTitle = [
  build.mode === 'dev' ? 'Panel dev server' : 'Panel build',
  build.commit
    ? `commit ${build.commit}${build.dirty ? ' with uncommitted changes' : ''}`
    : 'no git commit',
  `${build.mode === 'dev' ? 'started' : 'built'} ${builtAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`,
  panelBuildLabel,
].join(' · ')
