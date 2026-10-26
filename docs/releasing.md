# Releasing

Releases are built by CI (`.github/workflows/release.yml`) from a version tag.
It builds a universal app (Apple Silicon and Intel), publishes a GitHub release
with the `.dmg` and the updater's files, and points the Homebrew cask
(`Casks/markmode.rb`) at it.

## Once: the updater's key

`:update` installs only builds signed with the updater's key. That key is
Tauri's, not Apple's, and free. Its public half is in `tauri.conf.json`
(`plugins.updater.pubkey`); the private half is `~/.tauri/markmode.key`, with
no password. Add it to the repository's secrets as
`TAURI_SIGNING_PRIVATE_KEY` (Settings → Secrets and variables → Actions), with
the file's contents as its value.

Keep a copy of the key somewhere safe: without it, releases can't be signed,
and installed apps no longer accept updates until people reinstall a build
with a new public key.

## Each release

1. Set the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (the workflow fails when the tag differs from
   `tauri.conf.json`), and commit.
2. Tag and push:

   ```bash
   git tag v0.2.0 && git push origin main v0.2.0
   ```

3. When the workflow is done, the release is public, running apps announce it
   at their next start, and a commit on `main` has set the cask's version and
   checksum. Pull it.

## Signing

The app is signed ad hoc (`bundle.macOS.signingIdentity = "-"`), which Apple
Silicon requires before running it at all, but not with a Developer ID, and it
is not notarized: that takes the Apple Developer Program (99 USD a year). So
Gatekeeper blocks the first launch, and the README's Install section and the
cask's caveat say how to allow it. Updates installed by `:update` don't carry
the quarantine flag, so they open without asking.

To notarize later: join the program, set `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`
as secrets and pass them to `tauri-action`, remove `signingIdentity`, and drop
the caveats.
