// Copyright 2023 the .NET Foundation

// An ultra-limited set of APIs for "superuser" operations that are hardcoded to
// one user account at runtime. The idea is to make the cross-section here as
// small as possible, with other admin-level operations happening through more
// standardized IAM channels.

import { NextFunction, Response, RequestHandler } from "express";
import { Request as JwtRequest } from "express-jwt";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";
import { isLeft } from "fp-ts/Either";

import { State } from "./globals";

export function initializeSuperuserEndpoints(state: State) {
  const amISuperuser = (req: JwtRequest) => {
    return req.auth && req.auth.sub === state.config.superuserAccountId;
  };

  // GET /misc/amisuperuser
  //
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
      res.status(403).json({
        error: true,
        message: "Forbidden"
      });
    } else {
      console.warn("executing superuser API call:", req.path);
      next();
    }
  }

  // POST /misc/config-database - Set up some configuration of our backing
  // database.
  //
  // This call must be run before importing anything, because (Azure's version
  // of?) MongoDB requires the indexes to be defined before inserting any
  // documents.
  state.app.post(
    "/misc/config-database",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      try {
        // Handle names are unique:
        await state.handles.createIndex({ "handle": 1 }, { unique: true });

        // Indexes for our sorts
        await state.images.createIndex({ "creation_date": -1 });
        await state.images.createIndex({ "builtin_background_sort_key": 1 });
        await state.scenes.createIndex({ "creation_date": 1 });

        res.json({ error: false });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // POST /handle/:handle - Superuser for now: creating a new handle.

  const HandleCreation = t.type({
    display_name: t.string,
  });

  type HandleCreationT = t.TypeOf<typeof HandleCreation>;

  state.app.post(
    "/handle/:handle",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      const handle = req.params.handle;

      // Validate inputs.
      //
      // Todo: when public, validate that the handle text meets requirements
      // (no spaces, etc.)

      const maybe = HandleCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: HandleCreationT = maybe.right;

      // OK to proceed.

      const new_rec = {
        handle: handle,
        display_name: input.display_name,
        creation_date: new Date(),
        owner_accounts: [],
      };

      // From my understanding of the Express docs, exceptions in await expressions
      // shouldn't crash the server, but a duplicate submission here does just
      // that.

      try {
        const result = await state.handles.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        // We'll call this a 400, not a 500, since this particular error is
        // likely a duplicate handle name.
        res.statusCode = 400;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // POST /handle/:handle/add-owner - Superuser for now: adding an owner on a handle.

  const HandleOwnerAdd = t.type({
    account_id: t.string,
  });

  type HandleOwnerAddT = t.TypeOf<typeof HandleOwnerAdd>;

  state.app.post(
    "/handle/:handle/add-owner",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      const handle = req.params.handle;
      const maybe = HandleOwnerAdd.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: HandleOwnerAddT = maybe.right;

      try {
        state.handles.findOneAndUpdate(
          { "handle": handle },
          { $addToSet: { "owner_accounts": input.account_id } },
          { returnDocument: "after" }
        ).then((_result) => {
          res.json({ error: false });
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );
}
