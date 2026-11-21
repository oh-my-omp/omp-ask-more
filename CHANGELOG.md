# Changelog

## [Unreleased]

## [0.3.1] - 2026-11-22

### Changed

- Migrated `ask` tool documentation topic pointers from `xd://ask/*` to `help://ask/*` for omp 19.1.0 compatibility
- Updated the shared copy of `tern-plugin.ts` to oh-my-omp/shared@3d09cd4.

## [0.3.0] - 2026-11-22

### Breaking Changes

- Required `kind` on every `demos[]` entry: `file` with `path`, or `frames` with `frames[{body, caption?}]`

### Added

- Added a Tern plugin, shipped in the package, linked into Tern's plugins directory on load after removing any installed copy left under the same id, and reloaded when its version changes, whose stylesheet puts each option's tradeoff, description, holds-when and cost line on its own line under that option's name in Tern's omp view and whose `demo` block plays an open ask form's file demos beside the form in Tern's media viewer
- Added frame-by-frame and file demos to questions, rendering frames in order with captions and files as images or `file://` links
- Added a localized file-not-found notice for unreadable or missing demo files
- Added restoration of the model's option labels in answers, notes, and returned details

### Changed

- Shown option tradeoff, description, holds-when and cost lines as plain text, so backticks in them appear as written rather than as code
- Shown a file demo's caption on the line with its `file://` URL
- Moved each option's tradeoff, description, holds-when, and cost beneath the choice and placed option demos above the radio group
- Accepted any demo file path instead of only image extensions

### Fixed

- Fixed the plugin failing to load on omp 19.1.0, which removed `xd://` tool devices and the export the readability check used to recognize an `ask` sent through one; omp then offered its own `ask` instead

## [0.2.0] - 2026-11-20

### Breaking Changes

- Changed `ask` parameters to a single object containing a `questions[]` list, removing the `preview` option
- Changed `ask` result details from `results` to the host's `details.answers[]` form-answer array
- Removed the plugin's own full-screen answer page (the alternate-screen page and the Tern sheet); every session answers in omp's own `ask` form
- Removed the `timeout`, `returnTimeout`, `onExpiry`, `notify.terminal` and `notify.command` plugin settings and `OMP_ASK_MORE_NOTIFY_COMMAND` in favor of omp's `ask.timeout` and `ask.notify`
- Removed frames and video demos, leaving GIF, PNG, APNG and WebP image files as the only demo kind
- Removed the Tern companion plugin and its stylesheet

### Added

- Added label validation that rejects `ask` option labels which are not single-spaced one-liners

### Changed

- Compiled the whole question batch into one HTML form for the host's native `ask`, carrying each question's brief, file and quoted evidence, diagram as text, risks, option tradeoffs and image demos
- Rewrote the `ask` tool result text as `User answers:` lines in asked order with an appended `Option notes:` section
- Marked the recommended option instead of preselecting it, so the host's timeout submits nothing the user did not choose and every question left blank reaches the model as `(timed out: …)`
- Rejected option labels that start with `Other`, which the form keeps for the user's own answer
- Ran two `ask` calls from one response one after the other
- Rendered `ask` results and their descriptions through the host's ask card renderer so answers display like the built-in `ask`

### Fixed

- Showed `(no answer)` instead of `Cancelled` on answer cards for questions left blank
- Skipped the session judge for non-local agent sessions
- Let the `ask` after a readability rejection through unjudged when the rejected call came through omp's `xd://ask` device, which omp records as a `write`; before, the retry was judged and rejected again

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
