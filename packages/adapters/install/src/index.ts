export {
  buildInstallPlan,
  buildInstallScript,
  dockerInvocation,
  INSTALL_KINDS,
  installLabel,
  isAdapterInstallMethod,
  quoteShellArgument,
  sshInvocation,
  validateDockerTarget,
  validateKind,
  validateOpencodeUrl,
  validateSshTarget,
  type DockerInstallTarget,
  type InstallScriptInput,
  type SshInstallTarget,
} from './command.ts'
export { InstallRequestError, readInstallFailure, type InstallFailure } from './errors.ts'
export { InstallJobService, type InstallJobServiceOptions } from './job.ts'
export { runProcess } from './runner.ts'
export {
  listDockerTargets,
  listSshTargets,
  parseDockerPs,
  readSshHosts,
  type DockerTargetsOptions,
  type SshTargetsOptions,
} from './targets.ts'
export type {
  AdapterInstallJob,
  AdapterInstallJobState,
  AdapterInstallMethod,
  CommandResult,
  InstallPlan,
  InstallPlanInput,
  InstallRunResult,
  InstallRunner,
  RunCommand,
} from './types.ts'
