// Copyright 2023 the .NET Foundation

// Some authentication-related helpers.

import { RequestHandler } from "express";
import { expressjwt, GetVerificationKey } from "express-jwt";
import jwksClient from "jwks-rsa";

import { Config } from "./globals";

export function makeCheckAuthMiddleware(config: Config): RequestHandler {
  return expressjwt({
    secret: jwksClient.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${config.kcBaseUrl}realms/${config.kcRealm}/protocol/openid-connect/certs`
    }) as GetVerificationKey,

    credentialsRequired: false,
    audience: "account",
    issuer: `${config.kcBaseUrl}realms/${config.kcRealm}`,
    algorithms: ["RS256"]
  });
}
