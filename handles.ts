// Copyright 2023 the .NET Foundation

// A "handle" is a public-facing account such as `@jwst`. We distinguish between
// handles and Keycloak user accounts since we expect that handles will
// regularly be administered by multiple users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";

import { State } from "./globals";

export interface MongoHandle {
  handle: string;
  display_name: string;
  creation_date: Date;
  owner_accounts: string[];
}

//function isOwner(req: JwtRequest, handle: MongoHandle): boolean {
//  return req.auth && req.auth.sub && handle.owner_accounts.includes(req.auth.sub) || false;
//}

export function initializeHandleEndpoints(state: State) {
  // Get general information about a handle

  state.app.get("/handles/:handle", async (req: JwtRequest, res: Response) => {
    try {
      const result = await state.handles.findOne({ "handle": req.params.handle });

      if (result === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }

      res.json({
        handle: result.handle,
        display_name: result.display_name,
      });
    } catch (err) {
      res.statusCode = 500;
      res.json({ error: true, message: `Database error in ${req.path}` });
    }
  });
}