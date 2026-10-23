# Mobile `npm audit` findings: are they in the Android bundle? (2026-10-19)

Docs only. No production code, config or infrastructure was changed. Nothing deployed.

## Method

1. `npm ls <pkg> --all` for the dependency path.
2. `npm audit --omit=dev --json` for the advisory text.
3. Searched app source for direct imports.
4. **Built the real Android bundle** (`npx expo export --platform android --dump-sourcemap`, output kept outside the repo) and listed every module in the sourcemap (2,319 modules). Presence in the dependency tree was not used as evidence.

Limits: this is the Hermes JS bundle only. Native code pulled in by autolinking (Gradle/Pods) is not visible in it. Nothing was run on a device.

## Results

| Package | Advisory | Path | In Android JS bundle? | Verdict |
|---|---|---|---|---|
| `@grpc/grpc-js` 1.9.16 (high) | auth-context cert check; server error messages sent to client | `@react-native-firebase/app` → `firebase` → `@firebase/firestore` → grpc-js | **No.** 0 modules from `@grpc`, `firebase/`, `@firebase/`. App only imports `@react-native-firebase/messaging` (35 modules, no grpc). | Not shipped. Both advisories concern gRPC *servers*, which a mobile client does not run. Remaining exposure: `firebase` JS SDK is a declared dependency of the RN package but unused here. |
| `uuid` 7.0.3 (moderate) | missing buffer bounds check in v3/v5/v6 with `buf` | `expo-sharing` → `@expo/config-plugins` → `xcode` → uuid | **No.** 0 modules from `uuid`, `xcode`, `@expo/config-plugins`. | Build-time only (config plugins run at prebuild on the build machine). Not in the app. **Build-tool exposure is real but separate**: it runs on the EAS/dev machine against our own `app.json`, not untrusted input. |
| `decode-uri-component` 0.2.2 (moderate) | DoS via exponential decoding of malformed percent-encoded input | `expo-router` → `query-string` 7.1.3 → decode-uri-component | **Yes.** `query-string/index.js` and `decode-uri-component/index.js` are both bundled. | **Shipped.** `query-string.parse(query)` is called in `expo-router/build/react-navigation/core/getStateFromPath.js:499`, the code that turns a URL into navigation state. App registers scheme `suuqplus`, so a crafted deep link can reach it. Impact is a client-side hang/crash of the app that opens the link (no data exposure). Not proven exploitable end to end; not tested on a device. |

Also seen in the bundle: one module under `@expo/cli/build/metro-require/require.js`. That is Expo's runtime `require` shim, not the CLI. Not a finding.

## What this means for the release policy

- `@grpc/grpc-js` and `uuid`: can be documented as **not shipped** (evidence above), with the date and Expo/Firebase versions, and re-checked whenever those change.
- `decode-uri-component`: **ships**. The npm "fix" is `expo-router` 58 (semver-major), which is a framework upgrade, not a quick patch. Options for the owner: accept the risk with a written note (moderate, DoS on a malformed deep link only), or schedule the Expo upgrade. Not decided here. Status wording until resolved: **known, unfixed, not proven exploitable** (no device run; not described as harmless or fixed). No Expo/React Native downgrade and no major upgrade is made as part of this record.
- The audit's other high findings (`@expo/cli`, `@expo/metro`, `node-forge`, ...) are Expo build tooling. Same method (bundle search) should be applied before calling them harmless; only `@expo/cli`'s runtime shim appeared, which is benign. They still execute on build machines.

## Not covered

- Native dependencies (Gradle) were not audited.
- The web app (`web/`) has its own `package.json` and was not traced here.
- Lint (102 errors, 39 warnings) and the `R2_PRESIGN_DISABLED` deployed test are separate items and untouched.

Reproduce: export the bundle as above, read the `.hbc.map` `sources` array, search for the package paths.
