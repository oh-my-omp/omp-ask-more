# Changelog

## [Unreleased]

### Breaking Changes

- Changed `ask` parameters to a single object containing a `questions[]` list, removing the `preview` option
- Changed `ask` result details from `results` to the host's `details.answers[]` form-answer array

### Added

- Added label validation that rejects `ask` option labels which are not single-spaced one-liners

### Changed

- Rendered `ask` results and their descriptions through the host's ask card renderer so answers display like the built-in `ask`
- Delegated the whole question batch to the host's native `ask` as one HTML form
- Changed the reserved option labels to `Other` and `Other…`

### Fixed

- Stopped `/tree` from reopening asks, with answer cards showing `(no answer)` instead of `Cancelled`
- Skipped the session judge for non-local agent sessions

## [0.1.15] - 2026-11-19

### Changed

- Updated the shared copy of `i18n.ts` to oh-my-omp/shared@33dbe00.

## [0.1.14] - 2026-11-15

### Changed

- Ran `notify.command` through omp's built-in POSIX shell so it behaves the same on every platform instead of spawning `sh -c`
- Required `@oh-my-pi/pi-natives` as a peer dependency in place of `@oh-my-pi/pi-utils`

## [0.1.13] - 2026-11-12

### Changed

- The plugin is published from the `release` branch by a daily release run: installs use `omp plugin install https://github.com/oh-my-omp/omp-ask-more#release`, and each release lists its changes in `CHANGELOG.md`.
