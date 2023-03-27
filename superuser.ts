// Copyright 2023 the .NET Foundation

// An ultra-limited set of APIs for "superuser" operations that are hardcoded to
// one user account at runtime. The idea is to make the cross-section here as
// small as possible, with other admin-level operations happening through more
// standardized IAM channels.

import { NextFunction, Response, RequestHandler } from "express";
import { Request as JwtRequest } from "express-jwt";
import * as t from "io-ts";
import { isLeft } from "fp-ts/Either";

import { State } from "./globals";

export function initializeSuperuserEndpoints(state: State) {
  const amISuperuser = (req: JwtRequest) => {
    return req.auth && req.auth.sub === state.config.superuserAccountId;
  };

  // This endpoint only exists to potentially assist the frontend in determining
  // whether to show UI related to superuser activities. Since one can invoke
  // the superuser backend APIs directly, this is purely superficial
  // functionality.
  state.app.get("/misc/amisuperuser", async (req: JwtRequest, res: Response) => {
    res.json({
      result: amISuperuser(req),
    });
  });

  // A middleware to require that the request comes from the superuser account.
  const requireSuperuser: RequestHandler = (req: JwtRequest, res: Response, next: NextFunction) => {
    if (!amISuperuser(req)) {
      res.status(401).json({
        error: true,
        message: "Not authorized"
      });
    } else {
      console.warn("executing superuser API call:", req.path);
      next();
    }
  }

  // Set up some configuration of our backing database.
  state.app.post(
    "/misc/config-database",
    requireSuperuser,
    async (_req: JwtRequest, res: Response) => {
      await state.handles.createIndex({ "handle": 1 }, { unique: true });
      res.json({ error: false });
    }
  );

  // Superuser for now: creating a new handle.

  const HandleCreation = t.type({
    handle: t.string,
    display_name: t.string,
  });

  type HandleCreationT = t.TypeOf<typeof HandleCreation>;

  state.app.post(
    "/handles/create",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      const maybe = HandleCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: "Submission did not match schema" });
        return;
      }

      const input: HandleCreationT = maybe.right;

      const new_rec = {
        handle: input.handle,
        display_name: input.display_name,
        creation_date: new Date(),
        owner_accounts: [],
      };

      // From my understand of the Express docs, exceptions in await expressions
      // shouldn't crash the server, but a duplicate submission here does just
      // that.

      try {
        const result = await state.handles.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId
        });
      } catch (err) {
        console.error("/handles/create exception:", err);
        // We'll call this a 400, not a 500, since this particular error is
        // likely a duplicate handle name.
        res.statusCode = 400;
        res.json({ error: true, message: "Database error creating new handle" });
      }
    }
  );

  // Superuser for now: adding an owner on a handle.

  const HandleOwnerAdd = t.type({
    handle: t.string,
    account_id: t.string,
  });

  type HandleOwnerAddT = t.TypeOf<typeof HandleOwnerAdd>;

  state.app.post(
    "/handles/add-owner",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      const maybe = HandleOwnerAdd.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: "Submission did not match schema" });
        return;
      }

      const input: HandleOwnerAddT = maybe.right;

      try {
        state.handles.findOneAndUpdate(
          { "handle": input.handle },
          { $addToSet: { "owner_accounts": input.account_id } },
          { returnDocument: "after" }
        ).then((_result) => {
          res.json({ error: false });
        });
      } catch (err) {
        console.error("/handles/add-owner exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in /handles/add-owner" });
      }
    }
  );
}
