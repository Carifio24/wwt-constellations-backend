import * as t from "io-ts";
import { isLeft } from "fp-ts/lib/Either.js";
import { PathReporter } from "io-ts/lib/PathReporter.js";
import { Response } from "express";
import { Request as JwtRequest } from "express-jwt";
import { ObjectId, WithId } from "mongodb";

import { State } from "./globals.js";
import { sceneToJson } from "./scenes.js";

export interface MongoSceneFeature {
  scene_id: ObjectId; 
  feature_time: Date;
}

function timeStrippedDate(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

export async function getFeatureForDate(state: State, date: Date): Promise<WithId<MongoSceneFeature> | null> {
  const day = timeStrippedDate(date);
  const nextDay = new Date(day);
  nextDay.setDate(nextDay.getDate() + 1);

  // We're assuming that there's only one feature!
  return state.features.findOne({
    "$and": [
      { feature_time: { "$gte": day } },
      { feature_time: { "$lt": nextDay } } 
    ]
  });
}

export async function getFeaturesForRange(state: State, startDate: Date, endDate: Date) {
  return state.features.find({
    "$and": [
      { feature_time: { "$gte": startDate } },
      { feature_time: { "$lt": endDate } }
    ]
  });
}

export function initializeFeatureEndpoints(state: State) {
  const FeatureCreation = t.type({
    scene_id: t.string,
    feature_time: t.Integer
  });

  type FeatureCreationT = t.TypeOf<typeof FeatureCreation>;

  // TODO: This is redundant with the middleware in superuser.ts
  const requireSuperuser = (req: JwtRequest) => {
    return req.auth && req.auth.sub === state.config.superuserAccountId;
  };

  state.app.post(
    "/feature",
    async (req: JwtRequest, res: Response) => {

      const maybe = FeatureCreation.decode(req.body);

      if (isLeft(maybe)) {
        res.statusCode = 400;
        res.json({ error: true, message: `Submission did not match schema: ${PathReporter.report(maybe).join("\n")}` });
        return;
      }

      const input: FeatureCreationT = maybe.right;

      const record: MongoSceneFeature = {
        scene_id: new ObjectId(input.scene_id),
        feature_time: new Date(input.feature_time),
      };

      try {
        const result = await state.features.insertOne(record);

        res.json({
          error: false,
          id: "" + result.insertedId,
        });
      } catch (err) {
        console.error(`${req.method} ${req.path} exception`, err);
        res.statusCode = 500;
        res.json({ error: true, message: `error serving ${req.method} ${req.path}` });
      }
    }
  );


  state.app.get(
    "/feature/:date",
    async (req: JwtRequest, res: Response) => {
      const date = new Date(req.params.date);
      if (isNaN(date.getTime())) {
        res.status(400).json({
          error: true,
          message: "Invalid date specified"
        });
        return;
      }

      const feature = await getFeatureForDate(state, date);
      if (feature === null) {
        res.status(404).json({
          error: true,
          message: "No feature found for given date"
        });
        return;
      }

      const scene = await state.scenes.findOne({ "_id": feature.scene_id });
      if (scene === null) {
          throw new Error(`Database consistency failure, feature ${feature._id} missing scene ${feature.scene_id}`);
      }

      const sceneJSON = await sceneToJson(scene, state, req.session);
      const featureHydrated = {
        _id: feature._id,
        feature_time: feature.feature_time,
        scene: sceneJSON
      };
      
      res.json({
        error: false,
        feature: featureHydrated
      });

    });

    state.app.get(
      "/features",
      async (req: JwtRequest, res: Response) => {
        const startDate = new Date(Number(req.query.start_date));
        const endDate = new Date(Number(req.query.end_date));

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          res.status(400).json({
            error: true,
            message: "Invalid start and end date formats"
          });
          return;
        }
      });

}
