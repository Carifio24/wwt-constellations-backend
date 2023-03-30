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
import { ObjectId } from "mongodb";
import { create } from "xmlbuilder2";
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";

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
  offset_x: t.number,
  offset_y: t.number,
  projection: t.string,
  quad_tree_map: t.string,
  rotation: t.number,
  thumbnail_url: t.string,
  tile_levels: t.number,
  width_factor: t.number,
});

type ImageWwtT = t.TypeOf<typeof ImageWwt>;

const ImageStorage = t.type({
  legacy_url_template: t.union([t.string, t.undefined]),
});

type ImageStorageT = t.TypeOf<typeof ImageStorage>;

export function imageToImageset(image: MongoImage, root: XMLBuilder): XMLBuilder {
  const iset = root.ele("ImageSet");

  // Bad hardcodings!!
  iset.att("BandPass", "Visible");
  iset.att("DataSetType", "Sky");

  // Hardcodings that are probably OK:
  iset.att("BaseTileLevel", "0");
  iset.att("ElevationModel", "False");
  iset.att("Generic", "False");
  iset.att("Sparse", "True");
  iset.att("StockSet", "False");

  iset.att("BaseDegreesPerTile", String(image.wwt.base_degrees_per_tile));
  iset.att("BottomsUp", image.wwt.bottoms_up ? "True" : "False");
  iset.att("CenterX", String(image.wwt.center_x));
  iset.att("CenterY", String(image.wwt.center_y));
  iset.att("FileType", image.wwt.file_type);
  iset.att("Name", image.note);
  iset.att("OffsetX", String(image.wwt.offset_x));
  iset.att("OffsetY", String(image.wwt.offset_y));
  iset.att("Projection", image.wwt.projection);
  iset.att("QuadTreeMap", image.wwt.quad_tree_map);
  iset.att("Rotation", String(image.wwt.rotation));
  iset.att("TileLevels", String(image.wwt.tile_levels));
  iset.att("WidthFactor", String(image.wwt.width_factor));

  if (image.storage.legacy_url_template) {
    iset.att("Url", image.storage.legacy_url_template);
  } else {
    throw new Error("no derivable URL for imageset WTML");
  }

  // TODO: credits etc!!!

  iset.ele("Description").txt(image.note);
  iset.ele("ThumbnailUrl").txt(image.wwt.thumbnail_url);

  return iset;
}

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

  // POST /images/find-by-legacy-url - locate image records based on their WWT
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
        console.error("POST /images/find-by-legacy-url exception:", err);
        res.statusCode = 500;
        res.json({ error: true, message: "Database error in POST /images/find-by-legacy-url" });
      }
    }
  );

  // GET /image/:id/img.wtml - get WTML with a single imageset

  state.app.get(
    "/image/:id/img.wtml",
    async (req: JwtRequest, res: Response) => {
      try {
        const image = await state.images.findOne({ "_id": new ObjectId(req.params.id) });

        if (image === null) {
          res.statusCode = 404;
          res.json({ error: true, message: "Not found" });
          return;
        }

        const root = create().ele("Folder");
        root.att("Browseable", "True");
        root.att("Group", "Explorer");
        root.att("Name", image.note);
        root.att("Searchable", "True");
        root.att("Type", "Sky");

        imageToImageset(image, root);

        root.end({ prettyPrint: true });
        res.type("application/xml")
        res.send(root.toString());
      } catch (err) {
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.path}` });
      }
    }
  );
}
