import {getInput, setFailed, info, warning} from '@actions/core'
import {ExecOptions, exec} from '@actions/exec'
import {findPackages, checkPackages, sortPackages} from './package'
import {awaitCrateVersion} from './crates'
import {githubHandle} from './github'

interface EnvVars {
    [name: string]: string
}

async function run(): Promise<void> {
    const token = getInput('token')
    const path = getInput('path')
    const args = getInput('args')
        .split(/[\n\s]+/)
        .filter(arg => arg.length > 0)
    const registry = getInput('registry')
    const registry_token = getInput('registry-token')
    const dry_run = getInput('dry-run') === 'true'
    const wait = getInput('wait') !== 'false'

    const env: EnvVars = {...(process.env as EnvVars)}
    if (registry_token) {
        let env_key = `CARGO_REGISTRY_TOKEN`
        if (registry) {
            env_key = `CARGO_REGISTRIES_${registry
                .replace(/-/g, `_`)
                .toUpperCase()}_TOKEN`
        }
        info(`Setting environment variable ${env_key}`)
        env[env_key] = registry_token
    }

    const github = githubHandle(token)

    try {
        info(`Searching cargo packages at '${path}'`)
        const packages = await findPackages(path)
        const package_names = Object.keys(packages).join(', ')
        info(`Found packages: ${package_names}`)

        info(`Checking packages consistency`)
        await checkPackages(packages, github)

        info(`Sorting packages according dependencies`)
        const sorted_packages = sortPackages(packages)

        for (const package_name of sorted_packages) {
            const package_info = packages[package_name]
            if (!package_info.published) {
                let exec_args = ['publish', ...args]
                if (registry) {
                    info(`Publishing to registry ${registry}`)
                    exec_args = [...exec_args, `--registry`, registry]
                }
                const exec_opts: ExecOptions = {
                    cwd: package_info.path,
                    env
                }
                if (dry_run) {
                    const args_str = exec_args.join(' ')
                    warning(
                        `Skipping exec 'cargo ${args_str}' in '${package_info.path}' due to 'dry-run: true'`
                    )
                    warning(
                        `Skipping awaiting when '${package_name} ${package_info.version}' will be available due to 'dry-run: true'`
                    )
                } else {
                    info(`Publishing package '${package_name}'`)
                    await exec('cargo', exec_args, exec_opts)
                    if (wait) {
                        info(`Waiting for crate to show up in registry...`)
                        await awaitCrateVersion(
                            package_name,
                            package_info.version
                        )
                        info(`Package '${package_name}' published successfully`)
                    } else {
                        info(
                            `Not waiting for crate to show up in registry ('wait: false' was specified)`
                        )
                    }
                }
            }
        }
    } catch (error) {
        setFailed(error.message)
    }
}

run()
