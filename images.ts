// Copyright 2023 the .NET Foundation

// An image corresponds to a WWT imageset. It is owned by a handle. One or more
// images are combined into "scenes", which are the things that we show to
// users.
//
// See `SCHEMA.md` for more information about the schema used here.

import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { isLeft } from "fp-ts/Either";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";
import { ObjectId, WithId } from "mongodb";

import { State } from "./globals";
import { canAddImages } from "./handles";

export interface MongoImage {
  handle_id: ObjectId;
  creation_date: Date;
  wwt: ImageWwtT;
  storage: ImageStorageT;
  note: string;
}

export interface MongoImageStorage {
  legacy_url_template: string | undefined;
}

const ImageWwt = t.type({
  base_degrees_per_tile: t.number,
  bottoms_up: t.boolean,
  center_x: t.number,
  center_y: t.number,
  file_type: t.string,
  projection: t.string,
  quad_tree_map: t.string,
  rotation: t.number,
  tile_levels: t.number,
  width_factor: t.number,
  thumbnail_url: t.string,
});

type ImageWwtT = t.TypeOf<typeof ImageWwt>;

const ImageStorage = t.type({
  legacy_url_template: t.union([t.string, t.undefined]),
});

type ImageStorageT = t.TypeOf<typeof ImageStorage>;

export function initializeImageEndpoints(state: State) {
  // POST /handle/:handle/image: post a new image record (data have already
  // been processed and uploaded)

  const ImageCreation = t.type({
    wwt: ImageWwt,
    storage: ImageStorage,
    note: t.string,
  });

  type ImageCreationT = t.TypeOf<typeof ImageCreation>;

  state.app.post(
    "/handle/:handle/image",
    async (req: JwtRequest, res: Response) => {
      const handle_name = req.params.handle;

      // Are we authorized?

      const handle = await state.handles.findOne({ "handle": handle_name });

      if (handle === null) {
        res.statusCode = 404;
        res.json({ error: true, message: "Handle not found" });
        return;
      }

      if (!canAddImages(req, handle)) {
        res.statusCode = 401;
        res.json({ error: true, message: "Not authorized" });
        return;
      }

      // Does the input look valid?

      const maybe = ImageCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: ImageCreationT = maybe.right;

      // OK, looks good.

      const new_rec = {
        handle_id: handle._id,
        creation_date: new Date(),
        wwt: input.wwt,
        storage: input.storage,
        note: input.note,
      };

      try {
        const result = await state.images.insertOne(new_rec);

        res.json({
          error: false,
          id: "" + result.insertedId,
          rel_url: "/image/" + encodeURIComponent("" + result.insertedId),
        });
      } catch (err) {
        console.error("POST /handle/:handle/image exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in POST /handle/:handle/image" });
      }
    }
  );

  // GET /images/find-by-legacy-url - locate image records based on their WWT
  // "legacy URL" field.
  //
  // This helps us bootstrap the collection by allowing us to associate existing
  // images with new scenes (~WWT places). It should probably eventually become
  // part of a more generic query interface.
  //
  // We don't (yet?) filter results by handle or anything.

  const FindByLegacy = t.type({
    wwt_legacy_url: t.string,
  });

  type FindByLegacyT = t.TypeOf<typeof FindByLegacy>;

  state.app.post(
    "/images/find-by-legacy-url",
    async (req: JwtRequest, res: Response) => {
      // No authentication required.

      // Does the input look valid?

      const maybe = FindByLegacy.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: FindByLegacyT = maybe.right;

      // OK, looks good.

      try {
        // Don't include the WWT astrometric/data-format info, which is more
        // specific than callers will generally want.
        const items = await state.images.find(
          { "storage.legacy_url_template": { $eq: input.wwt_legacy_url } },
        ).project(
          { "wwt": false }
        ).toArray();

        res.json({
          error: false,
          results: items,
        });
      } catch (err) {
        console.error("GET /images/find-by-legacy-url exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in GET /images/find-by-legacy-url" });
      }
    }
  );
}