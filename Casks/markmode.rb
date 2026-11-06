# The Homebrew cask, in this repository rather than a tap of its own:
#   brew tap gprevot974/markmode https://github.com/gprevot974/markmode
#   brew install --cask markmode
# The release workflow sets the version and checksum on each release.
cask "markmode" do
  version "0.1.1"
  sha256 "208fddc57f204d6c37b983118f44ff5b00b925be276d2cdda225e52dd040d8fb"

  url "https://github.com/gprevot974/markmode/releases/download/v#{version}/Markmode_#{version}_universal.dmg"
  name "Markmode"
  desc "Markdown editor with Helix keybindings and live preview"
  homepage "https://github.com/gprevot974/markmode"

  # :update installs new releases in place.
  auto_updates true

  app "Markmode.app"
  binary "#{appdir}/Markmode.app/Contents/Resources/mde"

  zap trash: [
    "~/.config/markmode",
    "~/Library/Application Support/dev.gprevot.markmode",
    "~/Library/Caches/dev.gprevot.markmode",
    "~/Library/WebKit/dev.gprevot.markmode",
  ]

  caveats <<~EOS
    Markmode is not notarized by Apple, so macOS blocks its first launch.
    Allow it in System Settings > Privacy & Security > Open Anyway, or run:
      xattr -dr com.apple.quarantine #{appdir}/Markmode.app
  EOS
end
