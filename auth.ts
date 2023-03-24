import { ErrorRequestHandler } from "express";

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
