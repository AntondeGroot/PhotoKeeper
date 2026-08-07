#!/usr/bin/env bash
# Builds the app and installs it on a connected Android device.
#
# The steps have to happen in order and each has a way of going wrong quietly,
# which is what this script is really for:
#
#   1. `cap sync` copies the *built* web bundle into android/. Skip it and Gradle
#      happily packages whatever was copied last time, so you test a stale app
#      and conclude the fix did not work.
#   2. Gradle needs JDK 21. The newest installed JDK is usually the default and
#      fails on class file major version, which reads as a project problem
#      rather than a toolchain one.
#   3. adb is not on the PATH from a normal shell, and a phone can be attached
#      without being usable — unauthorized, or still asleep.
#
# Note on what the APK actually renders: capacitor.config.ts sets `server.url`
# to the deployed site, so the installed app loads https://antondegroot.uk/
# photokeeper rather than the bundle inside the APK. Changing the frontend only
# needs `./deploy.sh` — reinstall only when the *native* shell changes (app id,
# name, icon, plugins, Capacitor version).
#
# Usage:
#   npm run android:install                  # build, then install
#   npm run android:install -- --skip-build  # reinstall the existing APK
#
# ANDROID_SERIAL picks a phone when more than one is attached.

set -euo pipefail

REQUIRED_JDK=21
APK="android/app/build/outputs/apk/debug/app-debug.apk"

# Run from the repo root whichever directory this was invoked from.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() {
  printf '\n%s\n' "$1" >&2
  exit 1
}

# ——— adb ———

sdk_root() {
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    printf '%s' "$ANDROID_SDK_ROOT"
  elif [[ -n "${ANDROID_HOME:-}" ]]; then
    printf '%s' "$ANDROID_HOME"
  elif [[ "$(uname)" == "Darwin" ]]; then
    printf '%s' "$HOME/Library/Android/sdk"
  else
    printf '%s' "$HOME/Android/Sdk"
  fi
}

ADB="$(sdk_root)/platform-tools/adb"
[[ -x "$ADB" ]] || fail "no adb at $ADB — set ANDROID_SDK_ROOT to your SDK location"

# ——— The one device to install onto ———
#
# Attached is not the same as usable: a phone that has not had the "Allow USB
# debugging?" prompt accepted shows up as `unauthorized`, and installing would
# fail with something far less obvious than saying so here.

if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  SERIAL="$ANDROID_SERIAL"
else
  listed="$("$ADB" devices | tail -n +2)"
  ready="$(printf '%s\n' "$listed" | awk '$2 == "device" { print $1 }')"
  unauthorized="$(printf '%s\n' "$listed" | awk '$2 == "unauthorized" { print $1 }')"

  if [[ -z "$ready" && -n "$unauthorized" ]]; then
    fail "unlock the phone and accept the 'Allow USB debugging?' prompt, then retry"
  fi
  if [[ -z "$ready" ]]; then
    fail "no device connected. Plug the phone in over USB with USB debugging on (Settings → search 'USB debugging')"
  fi
  if [[ "$(printf '%s\n' "$ready" | wc -l | tr -d ' ')" -gt 1 ]]; then
    fail "more than one device attached ($(printf '%s' "$ready" | tr '\n' ' ')) — disconnect the others, or set ANDROID_SERIAL"
  fi
  SERIAL="$ready"
fi

# ——— Build ———

if [[ "${1:-}" == "--skip-build" ]]; then
  [[ -f "$APK" ]] || fail "no APK at $APK — run without --skip-build first"
  echo "→ using the existing APK"
else
  echo "→ building the web app and syncing it into android/"
  npm run cap:sync

  echo "→ building the APK with JDK $REQUIRED_JDK"
  if [[ "$(uname)" == "Darwin" ]]; then
    JAVA_HOME="$(/usr/libexec/java_home -v "$REQUIRED_JDK" 2>/dev/null)" || fail \
      "no JDK $REQUIRED_JDK found. Gradle cannot read newer class files — install Temurin $REQUIRED_JDK and try again"
    export JAVA_HOME
  elif [[ -z "${JAVA_HOME:-}" ]]; then
    # Elsewhere JAVA_HOME is the convention; trust it rather than guess paths.
    fail "set JAVA_HOME to a JDK $REQUIRED_JDK install before running this"
  fi

  (cd android && ./gradlew assembleDebug)
fi

# ——— Install ———
#
# -r reinstalls in place and keeps app data, which is where the Lightroom access
# and refresh tokens live. Without it you have to log in to Adobe again.

echo "→ installing on $SERIAL"
"$ADB" -s "$SERIAL" install -r "$APK"

printf '\nInstalled. Open PhotoKeeper on the phone.\n'