import { NextFunction, Request, RequestHandler, Response } from "express";
import { AzureLogger } from "@azure/logger";

import { Config } from "./globals";

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  AzureLogger.log(`Incoming request to ${req.path}`);
  AzureLogger.log(`Request is coming from ${req.ip}`);
  AzureLogger.log(`X-Forwarded-For: ${req.ips.join(",")}`);
  AzureLogger.log("Header content:");
  AzureLogger.log(req.headers);
}

export function makeVerifyKeyMiddleware(config: Config): RequestHandler {
  function handler(req: Request, res: Response, next: NextFunction) {
    const cxKey = req.get("CX_KEY");
    if (cxKey !== config.constellationsKey) {
      res.status(401).json({
        error: true,
        message: "A valid Constellations key is required for this endpoint"
      });
      return;
    }
    next();
  }

  return handler;
}
