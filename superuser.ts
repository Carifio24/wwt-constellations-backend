// Copyright 2023 the .NET Foundation

// An ultra-limited set of APIs for "superuser" operations that are hardcoded to
// one user account at runtime. The idea is to make the cross-section here as
// small as possible, with other admin-level operations happening through more
// standardized IAM channels.

import { NextFunction, Response, RequestHandler } from "express";
import { Request as JwtRequest } from "express-jwt";
import * as t from "io-ts";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { isLeft } from "fp-ts/lib/Either.js";
import { AnyBulkWriteOperation, ObjectId, WithId } from "mongodb";

import { constructFeed } from "./algorithm.js";
import { State } from "./globals.js";
import { MongoScene } from "./scenes.js";
import { createGlobalTessellation } from "./tessellation.js";
import { getFeaturesForDate, nextQueuedScene } from "./features.js";

export function amISuperuser(req: JwtRequest, state: State): boolean {
  return req.auth !== undefined && req.auth.sub === state.config.superuserAccountId;
}

export function makeRequireSuperuserMiddleware(state: State): RequestHandler {
  return (req: JwtRequest, res: Response, next: NextFunction) => {
    if (!amISuperuser(req, state)) {
      res.status(403).json({
        error: true,
        message: "Forbidden"
      });
    } else {
      console.warn("executing superuser API call:", req.path);
      next();
    }
  };
}


export function initializeSuperuserEndpoints(state: State) {

  // GET /misc/amisuperuser
  //
  // This endpoint only exists to potentially assist the frontend in determining
  // whether to show UI related to superuser activities. Since one can invoke
  // the superuser backend APIs directly, this is purely superficial
  // functionality.
  state.app.get("/misc/amisuperuser", async (req: JwtRequest, res: Response) => {
    res.json({
      result: amISuperuser(req, state),
    });
  });

  // A middleware to require that the request comes from the superuser account.
  const requireSuperuser = makeRequireSuperuserMiddleware(state);

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
        await state.scenes.createIndex({ "home_timeline_sort_key": 1 });
        await state.events.createIndex({ "date": 1 });
        await state.tessellations.createIndex({ "name": 1 }, { unique: true });

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

  // POST /misc/update-timeline?initial_id=$id
  //
  // Note that we're using URL query parameters even though this is a POST request.

  state.app.post(
    "/misc/update-timeline",
    requireSuperuser,
    async (req: JwtRequest, res: Response) => {
      const initialIDInput = req.query.initial_id;
      let initialSceneID: ObjectId | null;
      try {
        initialSceneID = initialIDInput ? new ObjectId(initialIDInput as string) : null;
      } catch (err) {
        res.statusCode = 404;
        res.json({ error: true, message: "invalid ID for initial scene" });
        return;
      }

      let initialScene: WithId<MongoScene> | null = null;
      if (initialSceneID === null) {
        // Basic implementation for now:
        // If no initial ID is given in the request, then take the
        // either the first featured scene for the given day, or the first scene
        // in the feature queue if there are no features that day.
        // We can make this better once we have the scheduler set up
        //
        // NB: Once the scheduler is set up, we can avoid any sort of
        // fiddly date logic by just passing in the ID of the desired
        // scene in the request (in the scheduled job)
        const features = await getFeaturesForDate(state, new Date());
        const firstFeature = await features.next();
        if (firstFeature !== null) {
          initialSceneID = firstFeature.scene_id;
        } else {
          initialSceneID = await nextQueuedScene(state);
        }
      }
      if (initialSceneID !== null) {
        initialScene = await state.scenes.findOne({ "_id": new ObjectId(initialSceneID) });
      }

      const scenes = await state.scenes.find({ published: true }).toArray();
      const orderedFeed = constructFeed({ scenes, initialScene });
      const operations: AnyBulkWriteOperation<MongoScene>[] = [];

      orderedFeed.forEach((scene, index) => {
        // The actual scoring value for each scene doesn't matter
        // All we need is the index that tells us the order
        const operation: AnyBulkWriteOperation<MongoScene> = {
          updateOne: {
            filter: { _id: scene._id },
            update: { $set: { home_timeline_sort_key: index } }
          }
        };
        operations.push(operation);
      });

      state.scenes.bulkWrite(operations);
      res.json({ error: false });
    }
  );

  // POST /misc/update-global-tessellation

  state.app.post(
    "/misc/update-global-tessellation",
    requireSuperuser,
    async (_req: JwtRequest, res: Response) => {
      const MIN_DISTANCE_RAD = 0.01; // about 0.6 deg
      const tess = await createGlobalTessellation(state, MIN_DISTANCE_RAD);
      await state.tessellations.updateOne({ name: tess.name }, { $set: tess }, { upsert: true });
      res.json({ error: false });
    }
  );
}
