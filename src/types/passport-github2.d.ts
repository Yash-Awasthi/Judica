declare module "passport-github2" {
  import { Strategy as PassportStrategy } from "passport";

  interface GitHubProfile {
    id: string;
    displayName: string;
    username?: string;
    emails?: Array<{ value: string }>;
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
    profile: GitHubProfile,
    done: VerifyCallback,
  ) => void | Promise<void>;

  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
  }
}
