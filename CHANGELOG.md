# Changelog

## [Unreleased]

### Changed

- Ran `notify.command` through omp's built-in POSIX shell so it behaves the same on every platform instead of spawning `sh -c`
- Required `@oh-my-pi/pi-natives` as a peer dependency in place of `@oh-my-pi/pi-utils`

## [0.1.13] - 2026-11-12

### Changed

- The plugin is published from the `release` branch by a daily release run: installs use `omp plugin install https://github.com/oh-my-omp/omp-ask-more#release`, and each release lists its changes in `CHANGELOG.md`.
