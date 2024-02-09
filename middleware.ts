import { NextFunction, RequestHandler, Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { AzureLogger } from "@azure/logger";

import { Config, State } from "./globals.js";
import { amISuperuser } from "./superuser.js";

export function requestLoggingMiddleware(req: JwtRequest, _res: Response, next: NextFunction) {
  AzureLogger.log(`Incoming request to ${req.originalUrl}`);
  AzureLogger.log(`Request is coming from ${req.ip}`);
  AzureLogger.log(`X-Forwarded-For: ${req.ips.join(",")}`);
  AzureLogger.log("Header content:");
  AzureLogger.log(req.headers);
  next();
}

function validConstellationsKey(req: JwtRequest, config: Config): boolean {
  const cxFrontendKey = req.get("CX_FRONTEND_AUTONOMOUS_KEY");
  return cxFrontendKey === config.frontendAutonomousKey;
}

export function makeRequireKeyOrSuperuserMiddleware(state: State): RequestHandler {
  return (req: JwtRequest, res: Response, next: NextFunction) => {
    const allowed = amISuperuser(req, state) || validConstellationsKey(req, state.config);
    if (!allowed) {
      res.status(401).json({
        error: true,
        message: "You must be a superuser or provide a valid Constellations key to use this endpoint"
      });
      return;
    }
    next();
  };
}
