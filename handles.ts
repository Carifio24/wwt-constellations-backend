// Copyright 2023 the .NET Foundation

// A "handle" is a public-facing account such as `@jwst`. We distinguish between
// handles and Keycloak user accounts since we expect that handles will
// regularly be administered by multiple users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";

import { State } from "./globals";
import { sceneToJson } from "./scenes";

export interface MongoHandle {
  handle: string;
  display_name: string;
  creation_date: Date;
  owner_accounts: string[];
}

function isOwner(req: JwtRequest, handle: MongoHandle): boolean {
  return req.auth && req.auth.sub && handle.owner_accounts.includes(req.auth.sub) || false;
}

export type HandleCapability =
  "addImages" |
  "addScenes"
  ;

export function isAllowed(req: JwtRequest, handle: MongoHandle, _cap: HandleCapability): boolean {
  // One day we might have finer-grained permissions, but not yet.
  return isOwner(req, handle);
}

export function initializeHandleEndpoints(state: State) {
  // GET /handle/:handle - Get general information about a handle

  state.app.get("/handle/:handle", async (req: JwtRequest, res: Response) => {
    try {
      const result = await state.handles.findOne({ "handle": req.params.handle });

      if (result === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Not found" });
        return;
      }

      res.json({
        error: false,
        handle: result.handle,
        display_name: result.display_name,
      });
    } catch (err) {
      console.error(`${req.method} ${req.path} exception:`, err);
      res.statusCode = 500;
      res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
    }
  });

  // GET /handle/:handle/timeline?page=$int - get scenes for a handle's timeline
  //
  // This gives the scenes published by a handle in reverse chronological order.

  const page_size = 8;

  state.app.get(
    "/handle/:handle/timeline",
    async (req: JwtRequest, res: Response) => {
      try {
        // Handle parameters

        var page_num = 0;

        try {
          const qpage = parseInt(req.query.page as string, 10);

          if (qpage >= 0) {
            page_num = qpage;
          }
        } catch {
          res.statusCode = 400;
          res.json({ error: true, message: `invalid page number` });
        }

        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        // Now, the actual query

        const docs = await state.scenes
          .find({ "handle_id": { "$eq": handle._id } })
          .sort({ creation_date: -1 }) // todo: publish date; published vs. unpublished
          .skip(page_num * page_size)
          .limit(page_size)
          .toArray();
        const scenes = [];

        for (var doc of docs) {
          scenes.push(await sceneToJson(doc, state));
        }

        res.json({
          error: false,
          results: scenes,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );
}