declare module "passport-google-oauth20" {
  import { Strategy as PassportStrategy } from "passport";

  interface GoogleProfile {
    id: string;
    displayName: string;
    name?: { givenName?: string; familyName?: string };
    emails?: Array<{ value: string; verified?: boolean }>;
    photos?: Array<{ value: string }>;
    _json?: Record<string, unknown>;
  }

  interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
  }

  type VerifyCallback = (err: Error | null, user?: Record<string, unknown> | false) => void;
  type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ) => void | Promise<void>;

  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
  }
}
