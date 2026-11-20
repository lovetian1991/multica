const { withProjectBuildGradle } = require("expo/config-plugins");

const marker = "// @hongyi/react-native-fbjni";

function patchRootBuildGradle(contents) {
  if (contents.includes(marker)) return contents;
  // Shiki requests fbjni:+; newer fbjni binaries need a different C++ runtime.
  // Keep this aligned with React Native's gradle/libs.versions.toml.
  return `${contents}
${marker}
allprojects {
    configurations.configureEach {
        resolutionStrategy {
            force "com.facebook.fbjni:fbjni:0.7.0"
        }
    }
}
`;
}

module.exports = function withAndroidFbjni(config) {
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("The Android fbjni pin requires a Groovy build.gradle");
    }
    mod.modResults.contents = patchRootBuildGradle(mod.modResults.contents);
    return mod;
  });
};

module.exports.patchRootBuildGradle = patchRootBuildGradle;
