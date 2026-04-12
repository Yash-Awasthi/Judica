declare module "passport-google-oauth20" {
  import { Strategy as PassportStrategy } from "passport";

  interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string[];
  }

  type VerifyCallback = (err: Error | null, user?: any) => void;
  type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ) => void | Promise<void>;

  export class Strategy extends PassportStrategy {
    constructor(options: StrategyOptions, verify: VerifyFunction);
  }
}
