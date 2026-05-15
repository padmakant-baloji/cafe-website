#!/usr/bin/env bash
# Finds a working JDK for Android builds (keytool, bubblewrap).
# Source from other scripts: source "$(dirname "$0")/android-java-env.sh"

android_find_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/keytool" ]]; then
    return 0
  fi

  local candidate
  if candidate=$(/usr/libexec/java_home -v 17 2>/dev/null); then
    JAVA_HOME="$candidate"
    return 0
  fi
  if candidate=$(/usr/libexec/java_home 2>/dev/null); then
    JAVA_HOME="$candidate"
    return 0
  fi

  local studio_jbr="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  if [[ -x "${studio_jbr}/bin/keytool" ]]; then
    JAVA_HOME="$studio_jbr"
    return 0
  fi

  local bubblewrap_glob
  for bubblewrap_glob in \
    "$HOME/.bubblewrap/jdk"/jdk-*/Contents/Home \
    "$HOME/.bubblewrap/jdk"/*/Contents/Home; do
    if [[ -x "${bubblewrap_glob}/bin/keytool" ]]; then
      JAVA_HOME="$bubblewrap_glob"
      return 0
    fi
  done

  return 1
}

if ! android_find_java_home; then
  echo "No Java JDK found."
  echo ""
  echo "Install one of:"
  echo "  • Android Studio (https://developer.android.com/studio)"
  echo "  • Or run: cd android-twa && npx bubblewrap doctor"
  echo "    (Bubblewrap can install JDK to ~/.bubblewrap/jdk)"
  exit 1
fi

export JAVA_HOME
export PATH="${JAVA_HOME}/bin:${PATH}"
