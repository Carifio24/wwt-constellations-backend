// Copyright 2023 the .NET Foundation

// A "handle" is a public-facing account such as `@jwst`. We distinguish between
// handles and Keycloak user accounts since we expect that handles will
// regularly be administered by multiple users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { isLeft } from "fp-ts/Either";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";
import { UpdateFilter } from "mongodb";

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
  "addScenes" |
  "editScenes" |
  "editSettings" |
  "viewDashboard"
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
          scenes.push(await sceneToJson(doc, state, req.session));
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

  // GET /handle/:handle/permissions - get information about the logged-in user's
  // permissions with regards to this handle.
  //
  // This API is only informative -- of course, direct API calls are the final
  // arbiters of what is and isn't allowed. But the frontend can use this
  // information to decide what UI elements to expose to a user.
  state.app.get(
    "/handle/:handle/permissions",
    async (req: JwtRequest, res: Response) => {
      try {
        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const output = {
          error: false,
          handle: handle.handle,
          view_dashboard: isAllowed(req, handle, "viewDashboard"),
        };

        res.json(output);
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // GET /handle/:handle/stats - get some statistics about this handle
  //
  // This information is only accessible to dashboard-capable users.
  state.app.get(
    "/handle/:handle/stats",
    async (req: JwtRequest, res: Response) => {
      try {
        // Validate input(s)

        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        // Check authorization

        if (!isAllowed(req, handle, "viewDashboard")) {
          res.statusCode = 403;
          res.json({ error: true, message: "Forbidden" });
          return;
        }

        // OK, actually do it

        const imageStats = (await state.images.aggregate([
          {
            "$match": { handle_id: handle._id },
          },
          {
            "$group": {
              "_id": null,
              "count": { "$count": {} },
            }
          },
        ]).next())!;

        const sceneStats = (await state.scenes.aggregate([
          {
            "$match": { handle_id: handle._id },
          },
          {
            "$group": {
              "_id": null,
              "count": { "$count": {} },
              "impressions": { "$sum": "$impressions" },
              "likes": { "$sum": "$likes" },
            }
          },
        ]).next())!;

        // Construct the output

        const output = {
          error: false,
          handle: handle.handle,
          images: {
            count: imageStats.count,
          },
          scenes: {
            count: sceneStats.count,
            impressions: sceneStats.impressions,
            likes: sceneStats.likes,
          },
        };

        res.json(output);
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );

  // PATCH /handle/:handle - update various handle properties

  const HandlePatch = t.partial({
    display_name: t.string,
  });

  type HandlePatchT = t.TypeOf<typeof HandlePatch>;

  state.app.patch(
    "/handle/:handle",
    async (req: JwtRequest, res: Response) => {
      try {
        // Validate inputs

        const handle = await state.handles.findOne({ "handle": req.params.handle });

        if (handle === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const maybe = HandlePatch.decode(req.body);

        if (isLeft(maybe)) {
          res.statusCode = 400;
          res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
          return;
        }

        const input: HandlePatchT = maybe.right;

        // For this operation, we might require different permissions depending
        // on what changes are exactly being requested. Note that patch
        // operations should either fully succeed or fully fail -- no partial
        // applications.

        let allowed = true;

        // For convenience, this value should be pre-filled with whatever
        // operations we might use below. We have to hack around the typing
        // below, though, because TypeScript takes some elements here to be
        // read-only.
        let operation: UpdateFilter<MongoHandle> = { "$set": {} };

        if (input.display_name) {
          allowed = allowed && isAllowed(req, handle, "editSettings");

          // Validate this particular input. (TODO: I think io-ts could do this?)
          if (input.display_name.length > 64) {
            res.statusCode = 400;
            res.json({ error: true, message: "Invalid input display_name: too long" });
            return;
          }

          (operation as any)["$set"]["display_name"] = input.display_name;
        }

        // How did we do?

        if (!allowed) {
          res.statusCode = 403;
          res.json({ error: true, message: "Forbidden" });
          return;
        }

        await state.handles.findOneAndUpdate(
          { "handle": req.params.handle },
          operation
        );

        res.json({
          error: false,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception:`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );
}