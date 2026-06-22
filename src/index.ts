// Public surface for `@useauthio/react`. Keep this file dependency-free
// of side-effects so consumers tree-shake cleanly — the package is
// declared `sideEffects: false` in package.json.

export { AuthioProvider, AuthioContext } from "./provider";

export { useAuthio, useAuthioRequired } from "./hooks";
export type {
  UseAuthioRequiredOptions,
  UseAuthioRequiredResult,
} from "./hooks";

export { SignedIn, SignedOut, RedirectToSignIn } from "./gates";
export type {
  SignedInProps,
  SignedOutProps,
  RedirectToSignInProps,
} from "./gates";

export { signInWithMagicLink, signInWithPasskey } from "./sign-in";

export {
  addPasskey,
  listPasskeys,
  renamePasskey,
  revokePasskey,
  mintPasskeyRegisterIntent,
  buildEnrollPasskeyUrl,
  enrollPasskey,
  signInOrigin,
  canEnrollPasskeyEmbedded,
} from "./passkeys";
export type {
  AuthioPasskey,
  PasskeyApiOptions,
  AddPasskeyOptions,
  EnrollPasskeyOptions,
} from "./passkeys";

export { usePasskeys } from "./usePasskeys";
export type { UsePasskeysResult } from "./usePasskeys";

export { PasskeyManager } from "./PasskeyManager";
export type { PasskeyManagerProps } from "./PasskeyManager";
export type {
  SignInWithMagicLinkOptions,
  SignInWithPasskeyOptions,
  SignInWithPasskeyResult,
} from "./sign-in";

export { captureClientLocation, verifyLocate } from "./locate";
export type {
  ClientLocationCapture,
  CaptureClientLocationOptions,
  LocateAction,
  VerifyLocateOptions,
  LocateVerifyResult,
} from "./locate";

export { AuthioError, wrapFetchError } from "./errors";

export type {
  AuthioUser,
  AuthioStatus,
  AuthioStorageMode,
  AuthioContextValue,
  AuthioProviderProps,
  AuthioTokenVerification,
  AuthioTokenVerifier,
} from "./types";

export type { AuthioTelemetryEvent } from "./telemetry";
