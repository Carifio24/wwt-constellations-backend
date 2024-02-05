import { NextFunction, Request, Response } from "express";
import { AzureLogger } from "@azure/logger";

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  AzureLogger.log(`Incoming request to ${req.path}`);
  AzureLogger.log(`Request is coming from ${req.ip}`);
  AzureLogger.log(`X-Forwarded-For: ${req.ips.join(",")}`);
  AzureLogger.log("Header content:");
  AzureLogger.log(req.headers);
}
