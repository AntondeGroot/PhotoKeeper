#!/usr/bin/env bash
# Builds the frontend, packages it into the APK, and installs that on a phone.
#
# Installing is not deploying, and this script exists because the two used to be
# tangled. `./deploy.sh` publishes the site and updates the Pi — it is how other
# people get the app. This puts the code you have *right now* on a device, so a
# change can be tried on real hardware before anyone else sees it.
#
# What lands on the phone is the code in this working copy. The APK carries the
# frontend rather than loading the deployed site (see capacitor.config.ts), so a
# frontend change needs nothing on the server — only the backend does, and that
# still goes through ./deploy.sh before the phone can see it.
#
# The steps have to happen in order and each has a way of going wrong quietly,
# which is the rest of what this script is for:
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
  # Built with `--base-href /` (see build:mobile): the app serves its bundle from
  # the root of its own origin, while the deployed website lives under
  # /photokeeper/. Built with the website's prefix, every asset here resolves to
  # a path nothing serves and the app opens to a blank screen.
  echo "→ building the web app and syncing it into android/"
  echo "  (this build is what runs; api/... calls go to the deployed backend)"
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

printf '\nInstalled. Open PhotoKeeper on the phone — it is running your local build.\n'