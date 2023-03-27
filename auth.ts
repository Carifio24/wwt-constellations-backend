// Copyright 2023 the .NET Foundation

// Some authentication-related helpers.

import { ErrorRequestHandler, RequestHandler } from "express";
import { expressjwt, GetVerificationKey } from "express-jwt";
import jwksClient from "jwks-rsa";

import { Config } from "./globals";

export function makeRequireAuthMiddleware(config: Config): RequestHandler {
  return expressjwt({
    secret: jwksClient.expressJwtSecret({
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
      jwksUri: `${config.kcBaseUrl}realms/${config.kcRealm}/protocol/openid-connect/certs`
    }) as GetVerificationKey,

    // can add `credentialsRequired: false` to make auth optional
    audience: "account",
    issuer: `${config.kcBaseUrl}realms/${config.kcRealm}`,
    algorithms: ["RS256"]
  });
}

export const noAuthErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err.name === "UnauthorizedError") {
    res.status(401).json({
      error: true,
      message: "Invalid authentication token"
    });
  } else {
    next(err);
  }
};
