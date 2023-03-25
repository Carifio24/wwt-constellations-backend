// Copyright 2023 the WorldWide Telescope project

// An ultra-limited set of APIs for "superuser" operations that are hardcoded to
// one user account at runtime. The idea is to make the cross-section here as
// small as possible, with other admin-level operations happening through more
// standardized IAM channels.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";

import { State } from "./globals";
import { noAuthErrorHandler } from "./auth";

export function initializeSuperuserEndpoints(state: State) {
  const amISuperuser = (req: JwtRequest) => {
    return req.auth && req.auth.sub === state.config.superuserAccountId;
  };

  // This endpoint only exists to potentially assist the frontend in determining
  // whether to show UI related to superuser activities. Since one can invoke
  // the superuser backend APIs directly, this is purely superficial
  // functionality.
  state.app.get("/misc/amisuperuser", state.requireAuth, noAuthErrorHandler, async (req: JwtRequest, res: Response) => {
    res.json({
      result: amISuperuser(req),
    });
  });
}